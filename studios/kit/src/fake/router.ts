import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { makeCatalog, wireCatalog } from "./catalog.ts";
import { workflows, estimateWorkflow } from "./workflows.ts";
import { fakeShowcase } from "./showcase.ts";
import type { Jobs } from "./jobs.ts";
import type { Keys } from "./keys.ts";

class Fault extends Error {
  readonly code: string;
  readonly status: number;
  readonly category: string;
  readonly field: string | undefined;
  constructor(status: number, code: string, message: string, category = "invalid-request", field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.category = category;
    this.field = field;
  }
}
const invalid = () => new Fault(400, "MEDIA_INVALID_REQUEST", "Invalid request");
const missing = () => new Fault(404, "NOT_FOUND", "Not found", "not-found");
async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const data: unknown = JSON.parse((await body(req)).toString());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw invalid();
    return data as Record<string, unknown>;
  } catch {
    throw invalid();
  }
}
const scrubbers = new WeakMap<ServerResponse, Keys>();
function send(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(scrubbers.get(res)?.scrub(value) ?? value));
}
function file(req: IncomingMessage, res: ServerResponse, data: Buffer, mime: string): void {
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", data.length);
    res.end(data);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) throw new Fault(416, "INVALID_RANGE", "Range not satisfiable");
  const start = match[1] ? Number(match[1]) : Math.max(0, data.length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
  if (start >= data.length || start > end) throw new Fault(416, "INVALID_RANGE", "Range not satisfiable");
  res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": end - start + 1 });
  res.end(data.subarray(start, end + 1));
}
function route(modelId: string, adapter: string | undefined, keys: Keys) {
  const model = makeCatalog(keys.keyed).models.find((m) => m.id === modelId);
  if (!model) throw new Fault(404, "MEDIA_MODEL_UNKNOWN", "Unknown model", "not-found");
  const selected = adapter
    ? model.routes.find((r) => r.providerId === adapter)
    : model.routes.find((r) => r.keyConfigured);
  if (adapter && !selected) throw invalid();
  if (!selected || !selected.keyConfigured) throw new Fault(400, "MEDIA_KEY_MISSING", "Provider key required", "auth");
  return { model, selected };
}
async function submit(req: IncomingMessage, res: ServerResponse, jobs: Jobs, keys: Keys): Promise<void> {
  const data = await json(req);
  if (
    typeof data.model !== "string" ||
    typeof data.task !== "string" ||
    (data.inputs !== undefined && !Array.isArray(data.inputs)) ||
    (data.adapter !== undefined && typeof data.adapter !== "string") ||
    (data.requestId !== undefined && typeof data.requestId !== "string")
  )
    throw invalid();
  const requestId = (data.requestId as string | undefined) ?? randomUUID();
  if (jobs.jobs.has(requestId)) throw new Fault(409, "MEDIA_DUPLICATE_REQUEST", "Duplicate request");
  const { model, selected } = route(data.model, data.adapter as string | undefined, keys);
  if (!model.tasks.includes(data.task as never)) throw new Fault(400, "MEDIA_TASK_UNSUPPORTED", "Unsupported task");
  jobs.start({
    requestId,
    jobKind: "media",
    model: model.id,
    adapter: selected.providerId,
    task: data.task,
    prompt: typeof data.prompt === "string" ? data.prompt : "",
    kind: model.kind,
    ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}),
    ...(typeof data.aspectRatio === "string" ? { aspectRatio: data.aspectRatio } : {}),
  });
  send(res, 202, { requestId, model: model.id, adapter: selected.providerId });
}
function validateWorkflowFields(
  fields: readonly import("../wire.ts").WireField[],
  values: Record<string, unknown>,
): void {
  for (const field of fields) {
    const value = values[field.name];
    if (field.required && (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))) {
      throw new Fault(400, "WORKFLOW_INPUT_INVALID", "Required field missing", "invalid-request", field.name);
    }
  }
}
async function workflow(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  jobs: Jobs,
  keys: Keys,
): Promise<void> {
  const def = workflows.find((w) => w.id === parts[2]);
  if (!def) throw new Fault(404, "WORKFLOW_UNKNOWN", "Unknown workflow", "not-found");
  const data = await json(req),
    values = data.values;
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Fault(400, "WORKFLOW_INPUT_INVALID", "Invalid values");
  const fields = values as Record<string, unknown>;
  validateWorkflowFields(def.fields, fields);
  const plan = estimateWorkflow(
    def,
    fields,
    makeCatalog(keys.keyed),
    (data.selection ?? {}) as Record<string, unknown>,
  );
  if (parts[3] === "estimate") {
    send(res, 200, plan);
    return;
  }
  const requestId = typeof data.requestId === "string" ? data.requestId : randomUUID();
  if (jobs.jobs.has(requestId)) throw new Fault(409, "MEDIA_DUPLICATE_REQUEST", "Duplicate request");
  const first = plan.steps[0]!,
    prompt = def.fields
      .filter((f) => f.type === "text")
      .map((f) => fields[f.name])
      .find((v) => typeof v === "string") as string | undefined;
  const kind = def.id.startsWith("director-") && def.id !== "director-studio" ? "image" : "video";
  jobs.start({
    requestId,
    jobKind: "workflow",
    model: first.model ?? "",
    adapter: first.route ?? "fal",
    task: "workflow",
    prompt: prompt ?? "",
    kind,
    workflow: def.id,
    plan,
    ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}),
  });
  send(res, 202, { requestId, workflow: def.id, ...plan });
}
async function key(req: IncomingMessage, res: ServerResponse, parts: string[], keys: Keys): Promise<void> {
  const provider = makeCatalog(keys.keyed).providers.find((p) => p.keyVocabulary === parts[2]);
  if (!provider) throw missing();
  if (req.method === "DELETE") {
    if (keys.env.has(provider.id)) throw new Fault(400, "ENV_KEY_IMMUTABLE", "Environment key cannot be removed");
    keys.keyed.delete(provider.id);
    keys.extras.delete(provider.id);
    send(res, 200, { ok: true, removed: true });
    return;
  }
  if (req.method !== "PUT") throw missing();
  const data = await json(req);
  if (typeof data.apiKey !== "string" || !data.apiKey) throw invalid();
  keys.secrets.add(data.apiKey);
  const extra = data.extra && typeof data.extra === "object" ? (data.extra as Record<string, unknown>) : {};
  for (const value of Object.values(extra)) if (typeof value === "string" && value) keys.secrets.add(value);
  if (data.apiKey.includes("rejected"))
    throw new Fault(400, "KEY_VALIDATION_FAILED", "API key validation failed: rejected");
  for (const field of provider.extraFields ?? [])
    if (field.required && !extra[field.name]) throw new Fault(400, "MISSING_EXTRA", "Required extra field missing");
  keys.extras.set(provider.id, new Set(Object.keys(extra)));
  keys.keyed.add(provider.id);
  send(res, 200, { ok: true, provider: provider.id, source: "config", valid: true });
}
function jobRoute(req: IncomingMessage, res: ServerResponse, parts: string[], url: URL, jobs: Jobs): void {
  if (req.method === "GET" && !parts[3]) {
    const session = url.searchParams.get("sessionId");
    const all = [...jobs.jobs.values()].filter((j) => !session || j.meta?.sessionId === session);
    send(res, 200, {
      jobs: all.filter((j) => !j.status),
      terminalJobs: url.searchParams.get("status") === "all" ? all.filter((j) => j.status) : [],
    });
    return;
  }
  const job = jobs.jobs.get(parts[3] ?? "");
  if (!job) throw new Fault(404, "MEDIA_JOB_UNKNOWN", "Unknown job", "not-found");
  send(res, 200, { job });
}
async function history(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  url: URL,
  jobs: Jobs,
): Promise<void> {
  const browser = String(req.headers["x-ima2-browser-id"] ?? "default");
  if (req.method === "GET" && !parts[2]) {
    send(res, 200, jobs.history.list(url.searchParams, browser));
    return;
  }
  if (req.method === "POST" && parts[2] === "favorite") {
    const data = await json(req);
    if (typeof data.filename !== "string" || !jobs.history.items.some((i) => i.filename === data.filename))
      throw missing();
    send(res, 200, { isFavorite: jobs.history.toggle(data.filename, browser) });
    return;
  }
  const index = jobs.history.items.findIndex((i) => i.filename === parts[2]);
  if (req.method === "DELETE" && index >= 0) {
    jobs.history.items.splice(index, 1);
    send(res, 200, { ok: true });
    return;
  }
  throw missing();
}
async function upload(req: IncomingMessage, res: ServerResponse, jobs: Jobs): Promise<void> {
  const data = await body(req);
  const mimeType = req.headers["content-type"] ?? "application/octet-stream";
  const ext =
    ({ "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "audio/wav": "wav" } as Record<string, string>)[
      mimeType
    ] ?? "bin";
  const ref = `input:${randomUUID()}.${ext}`;
  jobs.files.set(ref, { data, mime: mimeType });
  send(res, 201, { ref, mimeType, bytes: data.length });
}
async function dispatch(req: IncomingMessage, res: ServerResponse, jobs: Jobs, keys: Keys): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost"),
    p = url.pathname.split("/").filter(Boolean),
    method = req.method;
  if (method === "GET" && url.pathname === "/api/events") {
    jobs.events.connect(req, res);
    return;
  }
  if (method === "GET" && p[0] === "generated") {
    const found = jobs.files.get(p[1] ?? "");
    if (!found) throw missing();
    file(req, res, found.data, found.mime);
    return;
  }
  if (method === "GET" && url.pathname === "/api/media/catalog") {
    const catalog = wireCatalog(keys);
    send(res, 200, {
      ...catalog,
      models: catalog.models.filter((m) => !url.searchParams.has("kind") || m.kind === url.searchParams.get("kind")),
    });
    return;
  }
  if (p[1] === "keys" && p[2]) {
    await key(req, res, p, keys);
    return;
  }
  if (method === "POST" && url.pathname === "/api/media/inputs") {
    await upload(req, res, jobs);
    return;
  }
  if (method === "POST" && url.pathname === "/api/media") {
    await submit(req, res, jobs, keys);
    return;
  }
  if (p[1] === "media" && p[2] === "jobs") {
    jobRoute(req, res, p, url, jobs);
    return;
  }
  if (method === "POST" && p[1] === "media" && p[3] === "cancel") {
    if (!jobs.jobs.has(p[2] ?? "")) throw new Fault(404, "MEDIA_JOB_UNKNOWN", "Unknown job", "not-found");
    jobs.cancel(p[2]!);
    send(res, 200, { ok: true });
    return;
  }
  await dispatchOther(req, res, p, url, jobs, keys);
}
async function dispatchOther(
  req: IncomingMessage,
  res: ServerResponse,
  p: string[],
  url: URL,
  jobs: Jobs,
  keys: Keys,
): Promise<void> {
  const method = req.method;
  if (p[1] === "history") {
    await history(req, res, p, url, jobs);
    return;
  }
  if (method === "GET" && url.pathname === "/api/workflows") {
    send(res, 200, { workflows });
    return;
  }
  if (method === "GET" && url.pathname === "/api/showcase") {
    send(res, 200, fakeShowcase(jobs));
    return;
  }
  if (method === "POST" && p[1] === "workflows" && p[2]) {
    await workflow(req, res, p, jobs, keys);
    return;
  }
  throw missing();
}
export async function router(req: IncomingMessage, res: ServerResponse, jobs: Jobs, keys: Keys): Promise<void> {
  scrubbers.set(res, keys);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Last-Event-ID,X-Ima2-Filename,X-Ima2-Browser-Id");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    await dispatch(req, res, jobs, keys);
  } catch (error) {
    const fault = error instanceof Fault ? error : new Fault(500, "INTERNAL_ERROR", "Internal error", "unknown");
    send(res, fault.status, {
      ok: false,
      code: fault.code,
      error: fault.message,
      status: fault.status,
      category: fault.category,
      retryable: false,
      ...(fault.field ? { field: fault.field } : {}),
    });
  }
}
