import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import { pathToFileURL } from "node:url";
import { basename } from "node:path";
import { buildMediaToolDescriptors, withClientMediaPaths, type MediaToolDescriptor } from "../../lib/providers/media/toolSchema.js";
import { mimeFromName } from "../../lib/providers/media/mime.js";
import { normalizeMediaBody, tools, workflowSchema } from "./mediaApi.js";
import { formatMediaError, mcpErrorStructured, MediaApiError, toMediaApiError } from "./mediaErrors.js";
import { handleMedia } from "./mcpMediaHandlers.js";
import { handleWorkflow } from "./mcpWorkflowHandlers.js";
import type { SseEvent } from "./sse.js";

type Dict = Record<string, unknown>;
type Options = { resolveBase: () => Promise<string>; version: string; log: (message: string) => void;
  fetchDescriptors?: (base: string) => Promise<{ tools: MediaToolDescriptor[] }>; signal?: AbortSignal };
type DescriptorCache = { descriptors: MediaToolDescriptor[]; offline: boolean; expires: number };
const validator = new AjvJsonSchemaValidator();
const instructions = "Local ima2 media studio on the user's own provider keys. Read media_catalog and media_estimate before media_submit or workflow_run; those two are billed by the provider. If you cancel after the job was submitted, it keeps running; check media_job_status with your requestId.";

function codeOf(error: unknown): unknown { return (error as { code?: unknown } | null)?.code; }
function validate(schema: object, value: unknown): void {
  const result = validator.getValidator(schema as JsonSchemaType)(value);
  if (!result.valid) throw new MediaApiError("MCP_ARGUMENT_INVALID", result.errorMessage);
}
function listed(descriptor: MediaToolDescriptor) {
  const { name, title, description, inputSchema, outputSchema, annotations } = descriptor;
  return { name, title, description, inputSchema, outputSchema, annotations: { title, ...annotations } };
}
function links(base: string, data: Dict) {
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];
  const paths = Array.isArray(data.paths) ? data.paths : [];
  const remote = outputs.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const { filename, mimeType } = item as Dict;
    if (typeof filename !== "string" || !filename || basename(filename) !== filename) return [];
    const mime = typeof mimeType === "string" ? mimeType : mimeFromName(filename);
    return [{ type: "resource_link" as const, uri: `${base.replace(/\/$/, "")}/generated/${encodeURIComponent(filename)}`,
      name: filename, ...(mime ? { mimeType: mime } : {}) }];
  });
  return [...remote, ...paths.flatMap((path: unknown) => {
    if (typeof path !== "string") return [];
    const mime = mimeFromName(path);
    return [{ type: "resource_link" as const, uri: pathToFileURL(path).href, name: basename(path), ...(mime ? { mimeType: mime } : {}) }];
  })];
}
function progressCallback(token: string | number | undefined, send: (value: number, message: string) => void) {
  let last = 0, lastAt = 0;
  return (event: SseEvent) => {
    if (token === undefined || (event.event !== "progress" && event.event !== "step")) return;
    const now = Date.now();
    if (lastAt && now - lastAt < 1000) return;
    const data = event.data && typeof event.data === "object" ? event.data as Dict : {};
    const value = typeof data.progress === "number" && Number.isFinite(data.progress) ? data.progress : last;
    last = Math.max(last, Math.min(100, Math.max(0, value))); lastAt = now;
    send(last, event.event === "step" ? "Working on step" : "Working");
  };
}
async function offlineWorkflowValidation(base: string, name: string, args: Dict, offline: boolean) {
  if (!offline || (name !== "workflow_run" && name !== "workflow_estimate")) return;
  const response = await workflowSchema(base, String(args.id));
  const schema = response.schema;
  if (!schema || typeof schema !== "object") throw new MediaApiError("MCP_SCHEMA_INVALID", "Workflow schema is invalid");
  validate(withClientMediaPaths(schema as Parameters<typeof withClientMediaPaths>[0]), args.values ?? {});
}
function descriptorLoader(options: Options): () => Promise<DescriptorCache> {
  let cache: DescriptorCache | undefined;
  let loading: Promise<DescriptorCache> | undefined;
  return async function descriptors(): Promise<DescriptorCache> {
    if (cache && cache.expires > Date.now()) return cache;
    if (loading) return loading;
    loading = (async () => {
      let base: string;
      try { base = await options.resolveBase(); }
      catch (error) {
        if (codeOf(error) !== "SERVER_UNREACHABLE") throw error;
        return { descriptors: buildMediaToolDescriptors([]), offline: true, expires: Date.now() + 30000 };
      }
      try {
        const result = options.fetchDescriptors ? await options.fetchDescriptors(base) : await tools(base);
        if (!Array.isArray(result.tools)) throw new Error("Invalid media tools response");
        return { descriptors: result.tools as MediaToolDescriptor[], offline: false, expires: Date.now() + 30000 };
      } catch (error) {
        if (codeOf(error) !== "NETWORK_FAILED") throw error;
        return { descriptors: buildMediaToolDescriptors([]), offline: true, expires: Date.now() + 30000 };
      }
    })();
    try { cache = await loading; return cache; } finally { loading = undefined; }
  };
}
function registerTools(server: Server, options: Options, descriptors: () => Promise<DescriptorCache>): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await descriptors()).descriptors.map(listed) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const start = Date.now(), name = request.params.name;
    let logName = "unknown";
    let outcome = "ok";
    try {
      const list = await descriptors();
      const descriptor = list.descriptors.find((item) => item.name === name);
      if (!descriptor) throw new MediaApiError("MCP_TOOL_UNKNOWN", "Unknown tool");
      logName = /^(media|workflow)_[a-z_]+$/.test(name) ? name : "unknown";
      const raw = request.params.arguments ?? {};
      const args = name === "media_submit" || name === "media_estimate" ? normalizeMediaBody(raw) : raw;
      validate(descriptor.inputSchema, args);
      const signal = options.signal ? AbortSignal.any([extra.signal, options.signal]) : extra.signal;
      if (signal.aborted) throw new MediaApiError("MEDIA_WAIT_ABORTED", "Request aborted");
      const base = await options.resolveBase();
      await offlineWorkflowValidation(base, name, args, list.offline);
      if (signal.aborted) throw new MediaApiError("MEDIA_WAIT_ABORTED", "Request aborted");
      const token = extra._meta?.progressToken;
      const onEvent = progressCallback(token, (progress, message) => {
        if (token !== undefined) void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total: 100, message } }).catch(() => {});
      });
      const handler = name.startsWith("workflow_") ? handleWorkflow : handleMedia;
      const result: unknown = await handler(base, name, args, { signal, onEvent });
      const data = result && typeof result === "object" && !Array.isArray(result) ? result as Dict : { result };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }, ...links(base, data)], structuredContent: data };
    } catch (error) {
      const e = toMediaApiError(error); outcome = /^[A-Z][A-Z0-9_]{2,63}$/.test(e.code) ? e.code : "ERROR";
      return { isError: true, content: [{ type: "text" as const, text: formatMediaError(e) }], structuredContent: mcpErrorStructured(e) };
    } finally { options.log(`[ima2-mcp] ${logName} ${outcome} ${Date.now() - start}ms`); }
  });
}
export function createMediaMcpServer(options: Options): Server {
  const server = new Server({ name: "ima2-gen", version: options.version }, { capabilities: { tools: {} }, instructions });
  registerTools(server, options, descriptorLoader(options));
  return server;
}
