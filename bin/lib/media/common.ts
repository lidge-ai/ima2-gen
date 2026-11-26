import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { config } from "../../../config.js";
import { mimeFromName } from "../../../lib/providers/media/mime.js";
import type { ParsedArgs } from "../args.js";
import { fetchServer, request } from "../client.js";

export type Dict = Record<string, unknown>;
export function pairs(values: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of (values as string[] ?? [])) {
    const i = value?.indexOf("=") ?? -1;
    if (i < 1 || !value.slice(i + 1)) throw new Error("Expected name=value");
    result[value.slice(0, i)] = value.slice(i + 1);
  }
  return result;
}
export function numberFlag(args: ParsedArgs, key: string): number | undefined {
  if (args[key] === undefined) return undefined;
  const n = Number(args[key]);
  if (!Number.isFinite(n) || args[key] === "") throw new Error(`Invalid --${key}`);
  return n;
}
export async function inputs(base: string, values: unknown): Promise<Dict[]> {
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
export async function runBody(base: string, args: ParsedArgs): Promise<Dict> {
  if (!args.model || !args.task) throw new Error("--model and --task are required");
  if (args.audio && args["no-audio"]) throw new Error("Choose --audio or --no-audio");
  return { model: args.model, task: args.task, ...(args.prompt && { prompt: args.prompt }), ...(args.adapter && { adapter: args.adapter }),
    ...(args.negative && { negativePrompt: args.negative }), ...(args.resolution && { resolution: args.resolution }),
    ...(args.aspect && { aspectRatio: args.aspect }), ...(args.duration !== undefined && { durationSec: numberFlag(args, "duration") }),
    ...(args.seed !== undefined && { seed: numberFlag(args, "seed") }), ...(args.count !== undefined && { count: numberFlag(args, "count") }),
    ...(args.audio || args["no-audio"] ? { audio: Boolean(args.audio) } : {}),
    inputs: await inputs(base, args.input), vendorOptions: { ...vendorJson(args["vendor-json"]), ...pairs(args["vendor-option"]) } };
}
export async function outputFiles(base: string, data: Dict, target?: string): Promise<string[]> {
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

function vendorJson(value: unknown): Dict {
  if (value === undefined) return {};
  const parsed: unknown = JSON.parse(String(value));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--vendor-json must be an object");
  return parsed as Dict;
}
