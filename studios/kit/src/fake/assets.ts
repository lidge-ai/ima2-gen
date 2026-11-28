/** The element part of the fake server: the same routes and refusals as routes/assets.ts, kept in memory. */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Jobs } from "./jobs.ts";

interface Stored { id: string; kind: "element"; name: string; notes: string | null; metadata: { elementKind: string; name: string; refs: string[] }; tags: string[]; createdAt: number; updatedAt: number }
const KINDS = ["character", "product", "style", "scene"];
const stores = new WeakMap<Jobs, Stored[]>();
const of = (jobs: Jobs) => stores.get(jobs) ?? stores.set(jobs, []).get(jobs)!;

class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
}

function checked(jobs: Jobs, raw: unknown, stored: readonly string[] = []): { elementKind: string; name: string; refs: string[] } {
  const meta = (raw ?? {}) as { elementKind?: unknown; name?: unknown; refs?: unknown };
  if (typeof meta.elementKind !== "string" || !KINDS.includes(meta.elementKind)) throw new Refusal(400, "INVALID_ELEMENT_KIND", "elementKind required for element assets");
  if (!Array.isArray(meta.refs) || meta.refs.length < 1 || meta.refs.length > 6 || meta.refs.some((ref) => typeof ref !== "string" || !ref)) {
    throw new Refusal(400, "INVALID_ELEMENT_REFS", "element refs must contain 1-6 paths");
  }
  const refs = meta.refs as string[];
  for (const ref of refs) if (!stored.includes(ref) && !jobs.files.has(ref)) throw new Refusal(400, "INVALID_FILENAME", "file does not exist in generated storage");
  return { elementKind: meta.elementKind, name: typeof meta.name === "string" && meta.name ? meta.name : "Element", refs };
}

function create(jobs: Jobs, name: unknown, metadata: Stored["metadata"]): Stored {
  const now = Date.now();
  const asset: Stored = { id: "as_" + randomUUID().slice(0, 12), kind: "element", name: (typeof name === "string" && name.trim() ? name.trim() : metadata.name).slice(0, 80), notes: null, metadata, tags: [], createdAt: now, updatedAt: now };
  of(jobs).unshift(asset);
  return asset;
}

/** Handles /api/assets requests; returns false when the path is not one of them. */
export async function assets(req: IncomingMessage, res: ServerResponse, url: URL, jobs: Jobs): Promise<boolean> {
  const p = url.pathname.split("/").filter(Boolean);
  if (p[0] !== "api" || p[1] !== "assets") return false;
  const list = of(jobs);
  try {
    if (req.method === "GET" && p.length === 2) {
      const kind = url.searchParams.get("elementKind");
      if (kind && !KINDS.includes(kind)) throw new Refusal(400, "INVALID_ELEMENT_KIND", "elementKind must be one of " + KINDS.join("|"));
      send(res, 200, { assets: url.searchParams.get("kind") === "element" || !url.searchParams.has("kind") ? list.filter((a) => !kind || a.metadata.elementKind === kind) : [], nextCursor: null });
    } else if (req.method === "POST" && p[2] === "promote-element") {
      const body = await json(req);
      const result = (body.result ?? {}) as { path?: unknown; filePath?: unknown };
      const path = result.path ?? result.filePath ?? body.path ?? body.filePath;
      if (body.inputRef !== undefined && path !== undefined) throw new Refusal(400, "INVALID_ELEMENT_REFS", "give an uploaded image or a result, not both");
      let ref = typeof path === "string" ? path : "";
      if (body.inputRef !== undefined) {
        const file = typeof body.inputRef === "string" ? jobs.files.get(body.inputRef) : undefined;
        if (!file) throw new Refusal(400, "INVALID_ELEMENT_REFS", "inputRef is not an upload this server holds");
        if (!file.mime.startsWith("image/")) throw new Refusal(400, "INVALID_ELEMENT_REFS", "an element is made from an image");
        ref = "elements/" + randomUUID().replaceAll("-", "").slice(0, 24) + "." + (file.mime === "image/jpeg" ? "jpg" : "png");
        jobs.files.set(ref, file);
      }
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : ref.split("/").at(-1)!;
      send(res, 201, { asset: create(jobs, name, checked(jobs, { elementKind: body.elementKind ?? "character", name, refs: [ref] })) });
    } else if (req.method === "POST" && p.length === 2) {
      const body = await json(req);
      if (body.kind !== "element") throw new Refusal(400, "INVALID_KIND", "only elements are kept by this server");
      send(res, 201, { asset: create(jobs, body.name, checked(jobs, body.metadata)) });
    } else if (p.length === 3 && (req.method === "PATCH" || req.method === "DELETE")) {
      const index = list.findIndex((a) => a.id === p[2]);
      if (index < 0) throw new Refusal(404, "ASSET_NOT_FOUND", "Asset not found");
      if (req.method === "DELETE") {
        list.splice(index, 1);
        send(res, 200, { ok: true });
      } else {
        const body = await json(req), asset = list[index]!;
        if (body.metadata !== undefined) asset.metadata = checked(jobs, body.metadata, asset.metadata.refs);
        if (typeof body.name === "string" && body.name.trim()) asset.name = body.name.trim().slice(0, 80);
        asset.updatedAt = Date.now();
        send(res, 200, { asset });
      }
    } else throw new Refusal(404, "NOT_FOUND", "Not found");
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    send(res, error.status, { error: { code: error.code, message: error.message } });
  }
  return true;
}
