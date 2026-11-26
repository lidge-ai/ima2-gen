import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { config } from "../../config.js";
import { mimeFromName } from "../../lib/providers/media/mime.js";
import { parseArgs, type FlagDef, type ParsedArgs } from "../lib/args.js";
import { fetchServer, request, resolveServer } from "../lib/client.js";
import { err, json, out } from "../lib/output.js";
import { openSse, sseFields } from "../lib/sse.js";

const HELP = `ima2 media models [--kind video|image|audio] [--json]
ima2 media run --model ID --task TASK [--prompt TEXT] [--adapter ID] [--duration N] [--resolution R] [--aspect A] [--seed N] [--audio|--no-audio] [--negative TEXT] [--count N] [--input role=path|https-url|filename]... [--vendor-option key=value]... [--no-wait] [--out DIR] [--json]
ima2 media jobs [--all] | cancel REQUEST_ID | keys [set VOCABULARY --key-stdin [--extra name=value]...]
ima2 media workflows | workflow ID [--input name=value]... [--estimate] [--no-wait] [--out DIR]
All commands accept --server URL and --json. Keys may only be supplied on stdin.`;
const boolean = { type: "boolean" };
const string = { type: "string" };
const repeat = { type: "string", repeatable: true };
const FLAGS: Record<string, FlagDef> = { server: string, json: boolean, help: { ...boolean, short: "h" }, kind: string,
  model: string, task: string, prompt: string, adapter: string, duration: string, resolution: string, aspect: string,
  seed: string, audio: boolean, "no-audio": boolean, negative: string, count: string, input: repeat,
  "vendor-option": repeat, "no-wait": boolean, out: string, all: boolean, estimate: boolean, "key-stdin": boolean, extra: repeat };

type Dict = Record<string, unknown>;
function pairs(values: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of (values as string[] ?? [])) {
    const i = value?.indexOf("=") ?? -1;
    if (i < 1 || !value.slice(i + 1)) throw new Error("Expected name=value");
    result[value.slice(0, i)] = value.slice(i + 1);
  }
  return result;
}
function numberFlag(args: ParsedArgs, key: string): number | undefined {
  if (args[key] === undefined) return undefined;
  const n = Number(args[key]);
  if (!Number.isFinite(n) || args[key] === "") throw new Error(`Invalid --${key}`);
  return n;
}
async function inputs(base: string, values: unknown): Promise<Dict[]> {
  const result: Dict[] = [];
  for (const entry of (values as string[] ?? [])) {
    const i = entry?.indexOf("=") ?? -1;
    if (i < 1 || !entry.slice(i + 1)) throw new Error("Expected --input role=value");
    const role = entry.slice(0, i), value = entry.slice(i + 1);
    if (value.startsWith("https://")) result.push({ role, url: value });
    else if (existsSync(value)) {
      const mime = mimeFromName(value);
      if (!mime) throw new Error(`Unknown input MIME type: ${value}`);
      const uploaded = await request<{ ref: string }>(base, "/api/media/inputs", { method: "POST", raw: true, body: await readFile(value), headers: { "Content-Type": mime } });
      result.push({ role, ref: uploaded.ref });
    } else if (basename(value) === value) result.push({ role, filename: value });
    else throw new Error(`Input file not found: ${value}`);
  }
  return result;
}
async function runBody(base: string, args: ParsedArgs): Promise<Dict> {
  if (!args.model || !args.task) throw new Error("--model and --task are required");
  if (args.audio && args["no-audio"]) throw new Error("Choose --audio or --no-audio");
  return { model: args.model, task: args.task, ...(args.prompt && { prompt: args.prompt }), ...(args.adapter && { adapter: args.adapter }),
    ...(args.negative && { negativePrompt: args.negative }), ...(args.resolution && { resolution: args.resolution }),
    ...(args.aspect && { aspectRatio: args.aspect }), ...(args.duration !== undefined && { durationSec: numberFlag(args, "duration") }),
    ...(args.seed !== undefined && { seed: numberFlag(args, "seed") }), ...(args.count !== undefined && { count: numberFlag(args, "count") }),
    ...(args.audio || args["no-audio"] ? { audio: Boolean(args.audio) } : {}),
    inputs: await inputs(base, args.input), vendorOptions: pairs(args["vendor-option"]) };
}
async function outputFiles(base: string, data: Dict, target?: string): Promise<string[]> {
  const outputs = Array.isArray(data.outputs) ? data.outputs as Dict[] : [];
  const paths: string[] = [];
  if (target) await mkdir(target, { recursive: true });
  for (const item of outputs) {
    if (typeof item.filename !== "string" || basename(item.filename) !== item.filename) throw new Error("Invalid output filename");
    if (!target) { paths.push(join(config.storage.generatedDir, item.filename)); continue; }
    const res = await fetchServer(base, `/generated/${encodeURIComponent(item.filename)}`);
    if (!res.ok) throw new Error(`Output download failed: HTTP ${res.status}`);
    const path = join(target, item.filename);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    paths.push(path);
  }
  return paths;
}
async function submit(base: string, path: string, body: Dict, args: ParsedArgs): Promise<unknown> {
  const requestId = `media_${randomUUID()}`;
  if (args["no-wait"]) return request(base, path, { method: "POST", body: { ...body, requestId } });
  const stream = await openSse(new URL("/api/events", base).href);
  const cancel = () => { void request(base, `/api/media/${encodeURIComponent(requestId)}/cancel`, { method: "POST" }).catch((e: Error) => err(e.message)); };
  process.once("SIGINT", cancel);
  try {
    await request(base, path, { method: "POST", body: { ...body, requestId } });
    for await (const event of stream.events) {
      if (event.event === "replay-gap") throw new Error("SSE replay gap; inspect media jobs");
      const data = sseFields(event.data);
      if (data.jobId !== requestId) continue;
      if (event.event === "error") throw Object.assign(new Error(String(data.error ?? "Media job failed")), { code: data.code, body: data });
      if (event.event === "done") return { ...data, paths: await outputFiles(base, data, typeof args.out === "string" ? args.out : undefined) };
    }
    throw new Error("Event stream ended before job completed; inspect media jobs");
  } finally { process.off("SIGINT", cancel); stream.close(); }
}
function printModels(data: Dict): void {
  for (const model of data.models as Dict[]) {
    out(`${model.id}  ${model.kind}  ${model.vendor}`);
    for (const route of model.routes as Dict[]) {
      const prices = (route.pricing as Dict[] ?? []).filter((p) => typeof p.usd === "number").sort((a, b) => Number(a.usd) - Number(b.usd));
      const price = prices[0];
      out(`  ${route.adapter} ${route.route} key:${route.hasKey ? "yes" : "no"} ${price ? `$${price.usd}/${price.unit}${price.variant ? ` (${price.variant})` : ""}` : "price unknown"}`);
    }
  }
}
async function keyCommand(base: string, args: ParsedArgs): Promise<unknown> {
  if (args.positional[1] === "set") {
    const name = args.positional[2];
    if (!name || !args["key-stdin"]) throw new Error("keys set requires VOCABULARY --key-stdin");
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const apiKey = Buffer.concat(chunks).toString("utf8").trim();
    if (!apiKey) throw new Error("Empty key on stdin");
    try {
      await request(base, `/api/keys/${encodeURIComponent(name)}`, { method: "PUT", body: { apiKey, extra: pairs(args.extra) } });
      return { ok: true, vocabulary: name };
    } catch (error) {
      const e = error as Error & { code?: string };
      throw Object.assign(new Error(e.message.replaceAll(apiKey, "[redacted]")), { code: e.code });
    }
  }
  const [vocab, status] = await Promise.all([request<Dict>(base, "/api/keys/vocabulary"), request<Dict>(base, "/api/keys/status")]);
  return { vocabularies: (vocab.vocabularies as Dict[]).map((v) => {
    const state = status[String(v.vocabulary)] as Dict | undefined;
    return { ...v, status: state ? { configured: state.configured, source: state.source, valid: state.valid, maskedKey: state.maskedKey } : null };
  }) };
}
function groupPairs(values: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of (values as string[] ?? [])) {
    const i = entry?.indexOf("=") ?? -1;
    if (i < 1) throw new Error("Expected --input name=value");
    out.set(entry.slice(0, i), [...(out.get(entry.slice(0, i)) ?? []), entry.slice(i + 1)]);
  }
  return out;
}
// Field types come from the L6 workflow schema (GET /api/workflows fields[]). Repeat --input for lists.
async function workflowInput(base: string, id: string, values: unknown): Promise<Dict> {
  const catalog = await request<{ workflows: Dict[] }>(base, "/api/workflows");
  const workflow = catalog.workflows.find((item) => item.id === id);
  if (!workflow) throw new Error(`Unknown workflow: ${id}`);
  const fields = workflow.fields as Dict[];
  const result: Dict = {};
  for (const [name, list] of groupPairs(values)) {
    const type = String(fields.find((field) => field.name === name)?.type ?? "");
    if (!type) throw new Error(`Unknown workflow field: ${name}`);
    if (type === "media") {
      result[name] = (await inputs(base, list.map((v) => `source=${v}`))).map(({ role: _role, ...source }) => source);
    } else if (type === "colors") {
      result[name] = list.flatMap((v) => v.split(","));
    } else if (type === "integer") {
      const n = Number(list[0]); if (!Number.isInteger(n)) throw new Error(`Invalid integer: ${name}`); result[name] = n;
    } else if (type === "boolean") {
      if (list[0] !== "true" && list[0] !== "false") throw new Error(`Invalid boolean: ${name}`); result[name] = list[0] === "true";
    } else result[name] = list[0];
  }
  return result;
}
async function execute(base: string, args: ParsedArgs): Promise<unknown> {
  const [sub, id] = args.positional;
  if (sub === "models") {
    if (args.kind && !["image", "video", "audio"].includes(String(args.kind))) throw new Error("Invalid --kind");
    return request(base, `/api/media/catalog${args.kind ? `?kind=${encodeURIComponent(String(args.kind))}` : ""}`);
  }
  if (sub === "run") return submit(base, "/api/media", await runBody(base, args), args);
  if (sub === "jobs") return request(base, `/api/media/jobs${args.all ? "?status=all" : ""}`);
  if (sub === "cancel" && id) return request(base, `/api/media/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  if (sub === "keys") return keyCommand(base, args);
  if (sub === "workflows") return request(base, "/api/workflows");
  if (sub === "workflow" && id) {
    const path = `/api/workflows/${encodeURIComponent(id)}`;
    const body = { values: await workflowInput(base, id, args.input) };
    return args.estimate ? request(base, `${path}/estimate`, { method: "POST", body }) : submit(base, path, body, args);
  }
  throw new Error("Unknown media command; run ima2 media --help");
}
export default async function mediaCmd(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { flags: FLAGS });
  if (args.help || argv.length === 0) { out(HELP); return; }
  try {
    if (args._unknown.length) throw new Error(`Unknown option: ${args._unknown.join(", ")}`);
    const server = await resolveServer({ serverFlag: args.server });
    const result = await execute(server.base, args);
    if (args.json) json(result);
    else if (args.positional[0] === "models") printModels(result as Dict);
    else if (Array.isArray((result as Dict).paths)) for (const path of (result as Dict).paths as string[]) out(path);
    else out(JSON.stringify(result, null, 2));
  } catch (error) {
    const e = error as Error & { code?: string; body?: Dict };
    const body = e.body && typeof e.body === "object" ? e.body : {};
    const details = { code: body.code ?? e.code ?? "MEDIA_CLI_ERROR", error: body.error ?? e.message, ...(body.category ? { category: body.category } : {}) };
    if (args.json) json({ ok: false, ...details }); else err(`${details.code}: ${details.error}${details.category ? ` (${details.category})` : ""}`);
    process.exitCode = 1;
  }
}
