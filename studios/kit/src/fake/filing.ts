/** Folders and filed results of the fake server: the same routes and refusals as routes/assets.ts, kept in memory. */
import { randomUUID } from "node:crypto";
import type { Jobs } from "./jobs.ts";

export interface FakeFolder { id: string; name: string; parentId: null; createdAt: number; updatedAt: number }
export interface FiledAsset { id: string; kind: "image" | "video" | "audio"; name: string; filePath: string; folderId: string | null; notes: null; metadata: null; tags: string[]; createdAt: number; updatedAt: number }
interface Shelf { folders: FakeFolder[]; filed: FiledAsset[] }
const shelves = new WeakMap<Jobs, Shelf>();
const of = (jobs: Jobs) => shelves.get(jobs) ?? shelves.set(jobs, { folders: [], filed: [] }).get(jobs)!;
export const FILE_KINDS = ["image", "video", "audio"];

export class FilingRefusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The folder a result's file is in, as GET /api/history reports it. The latest filing wins. */
export function folderOf(jobs: Jobs, filename: string): string | null {
  const rows = of(jobs).filed.filter((asset) => asset.filePath === filename && asset.folderId).sort((a, b) => a.updatedAt - b.updatedAt);
  return rows.at(-1)?.folderId ?? null;
}

const named = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim().slice(0, 80) : "";
  if (!name) throw new FilingRefusal(400, "INVALID_NAME", "folder name required");
  return name;
};
function folderId(jobs: Jobs, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !of(jobs).folders.some((folder) => folder.id === value)) throw new FilingRefusal(400, "INVALID_FOLDER", "folder not found");
  return value;
}

/** /api/assets/folders. Returns the status and body, or null when the request is not a folder route. */
export function folders(jobs: Jobs, method: string, id: string | undefined, body: Record<string, unknown>): { status: number; body: unknown } | null {
  const shelf = of(jobs), now = Date.now();
  if (method === "GET" && !id) return { status: 200, body: { folders: [...shelf.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })) } };
  if (method === "POST" && !id) {
    const folder: FakeFolder = { id: "af_" + randomUUID().slice(0, 12), name: named(body.name), parentId: null, createdAt: now, updatedAt: now };
    shelf.folders.push(folder);
    return { status: 201, body: { folder } };
  }
  const folder = shelf.folders.find((entry) => entry.id === id);
  if (!id || (method !== "PATCH" && method !== "DELETE")) return null;
  if (!folder) throw new FilingRefusal(404, "FOLDER_NOT_FOUND", "Folder not found");
  if (method === "PATCH") {
    if (body.name !== undefined) folder.name = named(body.name);
    folder.updatedAt = now;
    return { status: 200, body: { folder } };
  }
  if (shelf.filed.some((asset) => asset.folderId === id)) throw new FilingRefusal(409, "FOLDER_NOT_EMPTY", "folder still contains assets or subfolders");
  shelf.folders.splice(shelf.folders.indexOf(folder), 1);
  return { status: 200, body: { ok: true } };
}

/** GET /api/assets narrowed to filed results (by file or by folder). */
export function listFiled(jobs: Jobs, query: URLSearchParams): FiledAsset[] {
  return of(jobs).filed.filter((asset) =>
    (!query.get("filePath") || asset.filePath === query.get("filePath")) &&
    (!query.get("folderId") || asset.folderId === query.get("folderId")) &&
    (!query.get("kind") || asset.kind === query.get("kind")));
}

/** POST /api/assets for an image, video or audio result. */
export function fileResult(jobs: Jobs, body: Record<string, unknown>): FiledAsset {
  const path = typeof body.filePath === "string" ? body.filePath.trim() : "";
  if (!path || !jobs.files.has(path)) throw new FilingRefusal(400, "INVALID_FILENAME", path ? "file does not exist in generated storage" : "filePath required for image/video/audio assets");
  const now = Date.now();
  const asset: FiledAsset = {
    id: "a_" + randomUUID().slice(0, 12), kind: body.kind as FiledAsset["kind"], name: (typeof body.name === "string" && body.name.trim() ? body.name.trim() : path).slice(0, 80),
    filePath: path, folderId: folderId(jobs, body.folderId), notes: null, metadata: null, tags: [], createdAt: now, updatedAt: now,
  };
  of(jobs).filed.unshift(asset);
  return asset;
}

/** PATCH and DELETE /api/assets/:id for a filed result. Returns null when the id is not one of them. */
export function changeFiled(jobs: Jobs, method: string, id: string, body: Record<string, unknown>): { status: number; body: unknown } | null {
  const shelf = of(jobs), asset = shelf.filed.find((entry) => entry.id === id);
  if (!asset) return null;
  if (method === "DELETE") {
    shelf.filed.splice(shelf.filed.indexOf(asset), 1);
    return { status: 200, body: { ok: true } };
  }
  if (body.folderId !== undefined) asset.folderId = folderId(jobs, body.folderId);
  asset.updatedAt = Date.now();
  return { status: 200, body: { asset } };
}
