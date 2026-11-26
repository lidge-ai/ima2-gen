import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { mimeFromName } from "../../lib/providers/media/mime.js";
import { fetchServer, request, type RequestOptions } from "./client.js";
import { MediaApiError, toMediaApiError } from "./mediaErrors.js";
import { openMediaSse, waitForJob, type WaitOptions } from "./mediaWait.js";
export { waitForJob } from "./mediaWait.js";
type Dict = Record<string, unknown>;
type Input = Dict & { role?: string; path?: string };
type Cursor = { before: string | number; beforeFilename: string };
type Catalog = { adapters: Dict[]; models: (Dict & { routes: Dict[] })[] };
type Filters = { kind?: string; vendor?: string; task?: string; model?: string; adapter?: string; keyed?: boolean; maxUsd?: number };
async function call<T>(base: string, path: string, options?: RequestOptions, secrets: string[] = []): Promise<T> {
  try { return await request<T>(base, path, options); } catch (error) { throw toMediaApiError(error, secrets); }
}
const post = <T>(base: string, path: string, body: unknown) => call<T>(base, path, { method: "POST", body });
const enc = encodeURIComponent;
export function normalizeMediaBody(body: Dict): Dict {
  return Object.fromEntries(Object.entries(body).flatMap(([key, value]) => {
    if (key !== "model" && key !== "task" && (value === null || value === "")) return [];
    if (key === "inputs" && Array.isArray(value)) return [[key, value.map((entry: Dict) => Object.fromEntries(Object.entries(entry).filter(([k, v]) => !["ref", "url", "filename", "path", "data", "mimeType"].includes(k) || (v !== "" && v !== null))))]];
    return [[key, value]];
  }));
}
export function filterCatalog<T extends Catalog>(data: T, filters: Filters): T {
  const models = data.models.filter((m) => (!filters.kind || m.kind === filters.kind) && (!filters.vendor || m.vendor === filters.vendor) && (!filters.model || m.id === filters.model) && (!filters.task || (Array.isArray(m.tasks) && m.tasks.includes(filters.task)))).map((m) => ({ ...m, routes: m.routes.filter((r) => {
    if (filters.adapter && r.adapter !== filters.adapter) return false;
    if (filters.keyed !== undefined && Boolean(r.hasKey) !== filters.keyed) return false;
    if (filters.maxUsd !== undefined) {
      const prices = (Array.isArray(r.pricing) ? r.pricing as Dict[] : []).map((p) => p.usd).filter((n): n is number => typeof n === "number");
      if (!prices.length || Math.min(...prices) > filters.maxUsd) return false;
    }
    return true;
  }) })).filter((m) => m.routes.length > 0);
  return { ...data, models };
}
function redactAdapter(adapter: Dict): Dict {
  const { maskedKey: _maskedKey, ...rest } = adapter;
  if (Array.isArray(rest.extraFields)) rest.extraFields = (rest.extraFields as Dict[]).map(({ value: _value, ...field }) => field);
  if (rest.status && typeof rest.status === "object") { const { maskedKey: _key, ...status } = rest.status as Dict; rest.status = status; }
  return rest;
}
export function publicCatalog<T extends Catalog>(data: T): T { return { ...data, adapters: data.adapters.map(redactAdapter) }; }
export async function catalog(base: string, filters: Filters = {}) {
  const data = await call<Catalog>(base, `/api/media/catalog${filters.kind ? `?kind=${enc(filters.kind)}` : ""}`);
  return filterCatalog(data, filters);
}
export async function keyStatus(base: string, options: { redact?: boolean } = {}) {
  const [vocab, status] = await Promise.all([call<{ vocabularies: Dict[] }>(base, "/api/keys/vocabulary"), call<Dict>(base, "/api/keys/status")]);
  return { vocabularies: vocab.vocabularies.map((v) => {
    const state = status[String(v.vocabulary)] as Dict | undefined;
    const item = { ...v, status: state ? { configured: state.configured, source: state.source, valid: state.valid, maskedKey: state.maskedKey } : null };
    return options.redact ? redactAdapter(item) : item;
  }) };
}
export function validateKey(base: string, vocab: string, body: { apiKey?: string; extra?: Record<string, string> }) {
  return call<Dict>(base, `/api/keys/${enc(vocab)}/validate`, { method: "POST", body }, [body.apiKey ?? "", ...Object.values(body.extra ?? {})]);
}
export function deleteKey(base: string, vocab: string) { return call<Dict>(base, `/api/keys/${enc(vocab)}`, { method: "DELETE" }); }
export async function uploadInputs(base: string, inputs: Input[]): Promise<Input[]> {
  for (const input of inputs) if (input.path && !existsSync(input.path)) throw new MediaApiError("MEDIA_INPUT_NOT_FOUND", `Input file not found: ${input.path}`);
  return Promise.all(inputs.map(async (input) => {
    if (!input.path) return input;
    const mime = mimeFromName(input.path);
    if (!mime) throw new MediaApiError("MEDIA_INPUT_INVALID", `Unknown input MIME type: ${input.path}`);
    const uploaded = await call<{ ref: string }>(base, "/api/media/inputs", { method: "POST", raw: true, body: await readFile(input.path), headers: { "Content-Type": mime } });
    const { path: _path, ...rest } = input;
    return { ...rest, ref: uploaded.ref };
  }));
}
export function estimate(base: string, body: Dict) { return post<Dict>(base, "/api/media/estimate", normalizeMediaBody(body)); }
function terminal(status: unknown): boolean { return ["completed", "done", "error", "failed", "canceled", "cancelled"].includes(String(status)); }
export async function jobStatus(base: string, id: string) {
  const response = await call<Dict>(base, `/api/media/jobs/${enc(id)}`);
  const job = (response.job && typeof response.job === "object" ? response.job : response) as Dict;
  return { ...response, pollAfterSeconds: terminal(job.status) ? 0 : 5 };
}
export function jobs(base: string, all = false) { return call<Dict>(base, `/api/media/jobs${all ? "?status=all" : ""}`); }
export function cancel(base: string, id: string) { return post<Dict>(base, `/api/media/${enc(id)}/cancel`, {}); }
async function ensureUnused(base: string, id: string): Promise<void> {
  let found = false;
  try { await jobStatus(base, id); found = true; }
  catch (error) { const e = toMediaApiError(error); if (e.code !== "MEDIA_JOB_UNKNOWN" || e.status !== 404) throw e; }
  if (!found) {
    const history = await call<{ items: Dict[] }>(base, `/api/history?requestId=${enc(id)}&includeAudio=true`);
    found = history.items.length > 0;
  }
  if (found) throw new MediaApiError("REQUEST_ID_IN_USE", `requestId ${id} was already submitted; check media_job_status / media_result`, { category: "invalid-request" });
}
type SubmitOptions = WaitOptions & { requestId?: string; wait: boolean };
async function submit(base: string, path: string, body: Dict, options: SubmitOptions, checked = false): Promise<Dict> {
  const id = options.requestId ?? `media_${randomUUID()}`;
  if (options.requestId && !checked) await ensureUnused(base, id);
  if (!options.wait) return post<Dict>(base, path, { ...body, requestId: id });
  const stream = await openMediaSse(base, options.signal);
  try { await post(base, path, { ...body, requestId: id }); return await waitForJob(stream, id, options); }
  finally { stream.close(); }
}
export async function submitMedia(base: string, body: Dict, options: SubmitOptions) {
  if (options.requestId) await ensureUnused(base, options.requestId);
  const normalized = normalizeMediaBody(body);
  if (Array.isArray(normalized.inputs)) normalized.inputs = await uploadInputs(base, normalized.inputs as Input[]);
  return submit(base, "/api/media", normalized, options, true);
}
export async function waitJob(base: string, id: string, options: WaitOptions) {
  const stream = await openMediaSse(base, options.signal);
  try {
    const status = await jobStatus(base, id);
    if (status.pollAfterSeconds === 0) return status;
    await waitForJob(stream, id, { ...options, timeoutMs: Math.min(options.timeoutMs, 60000) });
    return await jobStatus(base, id);
  } finally { stream.close(); }
}
export async function result(base: string, id: string) {
  const data = await call<{ items: Dict[] }>(base, `/api/history?requestId=${enc(id)}&includeAudio=true`);
  const outputs = data.items.map(({ filename, url, mediaType, mimeType }) => ({ filename, url, mediaType, ...(mimeType !== undefined && { mimeType }) }));
  if (outputs.length) return { requestId: id, outputs };
  const status = await jobStatus(base, id);
  throw new MediaApiError(status.pollAfterSeconds ? "MEDIA_RESULT_PENDING" : "MEDIA_RESULT_MISSING", status.pollAfterSeconds ? "Job is still running" : "No saved outputs found");
}
export async function saveOutputs(base: string, outputs: Dict[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const output of outputs) {
    const filename = output.filename;
    if (typeof filename !== "string" || !filename || basename(filename) !== filename || filename === "." || filename === "..") throw new MediaApiError("MEDIA_OUTPUT_INVALID", "Invalid output filename");
    let response: Response;
    try { response = await fetchServer(base, `/generated/${enc(filename)}`); } catch (error) { throw toMediaApiError(error); }
    if (!response.ok) throw new MediaApiError("MEDIA_OUTPUT_DOWNLOAD_FAILED", `Output download failed: HTTP ${response.status}`, { status: response.status });
    const path = join(dir, filename); await writeFile(path, Buffer.from(await response.arrayBuffer())); paths.push(path);
  }
  return paths;
}
export async function history(base: string, options: { limit?: number; kind?: string; cursor?: Cursor } = {}) {
  const limit = options.limit ?? 50, items: Dict[] = [];
  let cursor = options.cursor;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: "50", includeAudio: "true" });
    if (cursor) { params.set("before", String(cursor.before)); params.set("beforeFilename", cursor.beforeFilename); }
    const data = await call<{ items: Dict[]; nextCursor?: Cursor | null }>(base, `/api/history?${params}`);
    for (const item of data.items) if (typeof item.provider === "string" && /^(media|workflow):/.test(item.provider) && (!options.kind || item.mediaType === options.kind)) {
      items.push(item);
      if (items.length === limit) return { items };
    }
    if (!data.nextCursor) return { items };
    cursor = data.nextCursor;
  }
  return { items, truncated: true, cursor };
}
export function workflows(base: string) { return call<Dict>(base, "/api/workflows"); }
export function workflowSchema(base: string, id: string) { return call<Dict>(base, `/api/workflows/${enc(id)}/schema`); }
async function workflowValues(base: string, values: Dict): Promise<Dict> {
  const entries = await Promise.all(Object.entries(values).map(async ([key, value]) => {
    if (!Array.isArray(value)) return [key, value];
    return [key, await uploadInputs(base, value.map((v: unknown) => v && typeof v === "object" ? v as Input : { value: v })).then((items) => items.map((v, i) => "value" in v && Object.keys(v).length === 1 ? value[i] : v))];
  }));
  return Object.fromEntries(entries);
}
export async function workflowEstimate(base: string, id: string, values: Dict, selection: Dict) {
  return post<Dict>(base, `/api/workflows/${enc(id)}/estimate`, { values: await workflowValues(base, values), selection });
}
export async function workflowRun(base: string, id: string, values: Dict, selection: Dict, options: SubmitOptions) {
  if (options.requestId) await ensureUnused(base, options.requestId);
  return submit(base, `/api/workflows/${enc(id)}`, { values: await workflowValues(base, values), selection }, options, true);
}
export function tools(base: string) { return call<Dict>(base, "/api/media/tools"); }
