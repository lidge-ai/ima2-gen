import { parseArgs, type FlagDef, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { err, json, out } from "../lib/output.js";
import { catalog, estimate, jobs, cancel, tools, workflows, workflowSchema, workflowEstimate } from "../lib/mediaApi.js";
import { cliErrorJson, formatMediaError, toMediaApiError } from "../lib/mediaErrors.js";
import { printModels } from "../lib/media/catalogCmd.js";
import { runBody, pairs, type Dict } from "../lib/media/common.js";
import { submit } from "../lib/media/runCmd.js";
import { keyCommand } from "../lib/media/keysCmd.js";
import { jobCommand } from "../lib/media/jobCmd.js";
import { workflowInput } from "../lib/media/workflowCmd.js";
import { studioCommand } from "../lib/media/studioCmd.js";

const HELP = `ima2 media models [--kind image|video|audio] [--vendor V] [--task T] [--model ID] [--adapter ID] [--keyed] [--max-usd N] [--json]
ima2 media estimate --model ID --task TASK [run options] [--price-variant V] [--json]
ima2 media run --model ID --task TASK [--prompt TEXT] [--adapter ID] [--duration N] [--resolution R] [--aspect A] [--seed N] [--audio|--no-audio] [--negative TEXT] [--count N] [--input role=path|https-url|filename]... [--vendor-option key=value]... [--vendor-json JSON] [--request-id ID] [--no-wait] [--quiet] [--out DIR] [--json]
ima2 media status ID | wait ID [--timeout SEC] | result ID [--out DIR] | jobs [--all] | cancel ID
ima2 media keys | keys set VOCABULARY (--key-stdin | --stdin-json) [--extra name=value]... | keys validate VOCABULARY [--key-stdin | --stdin-json] [--extra name=value]... | keys delete VOCABULARY [--yes]
ima2 media workflows | workflow ID --schema | workflow ID [--input name=value]... [--slot-model slot=model]... [--slot-route slot=route]... [--estimate] [--request-id ID] [--no-wait] [--quiet] [--out DIR]
ima2 media studios | studio open NAME | studio default NAME
ima2 media tools
All commands accept --server URL and --json. Secrets are read from stdin only and never printed; --extra takes non-secret fields only.
Billed: run, and workflow without --estimate. --max-usd on models filters by the cheapest published price; it is not a spending limit.`;
const boolean = { type: "boolean" }, string = { type: "string" }, repeat = { type: "string", repeatable: true };
const FLAGS: Record<string, FlagDef> = { server: string, json: boolean, help: { ...boolean, short: "h" }, kind: string,
  model: string, task: string, prompt: string, adapter: string, duration: string, resolution: string, aspect: string,
  seed: string, audio: boolean, "no-audio": boolean, negative: string, count: string, input: repeat,
  "vendor-option": repeat, "no-wait": boolean, out: string, all: boolean, estimate: boolean, "key-stdin": boolean, extra: repeat,
  vendor: string, keyed: boolean, "max-usd": string, "price-variant": string, "vendor-json": string, "request-id": string,
  quiet: boolean, timeout: string, "stdin-json": boolean, yes: boolean, schema: boolean, "slot-model": repeat, "slot-route": repeat };
const OLD = "kind model task prompt adapter duration resolution aspect seed audio no-audio negative count input vendor-option no-wait out all estimate key-stdin extra".split(" ");
const NEW: Record<string, string[]> = {
  models: ["vendor", "keyed", "max-usd"], estimate: ["price-variant", "vendor-json"], run: ["vendor-json", "request-id", "quiet"],
  keys: ["stdin-json", "yes"], wait: ["timeout"], workflow: ["schema", "slot-model", "slot-route", "request-id", "quiet"],
};
function validate(argv: string[], args: ParsedArgs): void {
  if (args._unknown.length) throw new Error(`Unknown option: ${args._unknown.join(", ")}`);
  if (argv.some((arg) => arg.startsWith("--yes="))) throw new Error("--yes does not take a value");
  const sub = args.positional[0] ?? "";
  for (const flag of args._present) if (!["server", "json", "help", ...OLD, ...(NEW[sub] ?? [])].includes(flag)) throw new Error(`Invalid --${flag} for ${sub}`);
}
async function workflow(base: string, id: string, args: ParsedArgs): Promise<unknown> {
  if (args.schema) return workflowSchema(base, id);
  const values = await workflowInput(base, id, args.input);
  const selection = { models: pairs(args["slot-model"]), routes: pairs(args["slot-route"]) };
  if (args.estimate) return workflowEstimate(base, id, values, selection);
  return submit(base, `/api/workflows/${encodeURIComponent(id)}`, { values, selection }, args);
}
async function execute(base: string, args: ParsedArgs): Promise<unknown> {
  const [sub, id] = args.positional;
  if (sub === "models") {
    if (args.kind && !["image", "video", "audio"].includes(String(args.kind))) throw new Error("Invalid --kind");
    const maxUsd = args["max-usd"] === undefined ? undefined : Number(args["max-usd"]);
    if (maxUsd !== undefined && !Number.isFinite(maxUsd)) throw new Error("Invalid --max-usd");
    return catalog(base, { kind: args.kind as string | undefined, vendor: args.vendor as string | undefined, task: args.task as string | undefined,
      model: args.model as string | undefined, adapter: args.adapter as string | undefined, keyed: args.keyed ? true : undefined, maxUsd });
  }
  if (sub === "estimate") return estimate(base, { ...await runBody(base, args), ...(args["price-variant"] && { priceVariant: args["price-variant"] }) });
  if (sub === "run") return submit(base, "/api/media", await runBody(base, args), args);
  if (sub === "jobs") return jobs(base, Boolean(args.all));
  if (sub === "cancel" && id) return cancel(base, id);
  if (["status", "wait", "result"].includes(sub ?? "") && id) return jobCommand(base, sub!, id, args);
  if (sub === "keys") return keyCommand(base, args);
  if (sub === "workflows") return workflows(base);
  if (sub === "workflow" && id) return workflow(base, id, args);
  if (sub === "studios") return studioCommand(base, args);
  if (sub === "studio") return studioCommand(base, args);
  if (sub === "tools") return tools(base);
  throw new Error("Unknown media command; run ima2 media --help");
}
async function printSchema(base: string, id: string, data: Dict): Promise<void> {
  const list = await request<{ workflows: Dict[] }>(base, "/api/workflows");
  const fields = (list.workflows.find((w) => w.id === id)?.fields ?? []) as Dict[];
  const properties = (data.properties ?? {}) as Dict;
  const required = Array.isArray(data.required) ? data.required : [];
  out("name  type  required  constraints  help");
  for (const [name, value] of Object.entries(properties)) {
    const prop = value as Dict, field = fields.find((f) => f.name === name);
    const { type, ...constraints } = prop;
    out(`${name}  ${String(type ?? "")}  ${required.includes(name) ? "yes" : "no"}  ${JSON.stringify(constraints)}  ${String(field?.help ?? "")}`);
  }
}
export default async function mediaCmd(argv: string[]): Promise<void> {
  const beforeDash = argv.slice(0, argv.indexOf("--") < 0 ? argv.length : argv.indexOf("--"));
  if (!argv.length || beforeDash.some((arg) => arg === "--help" || arg === "-h")) { out(HELP); return; }
  const args = parseArgs(argv, { flags: FLAGS });
  try {
    validate(argv, args);
    const server = await resolveServer({ serverFlag: args.server });
    const result = await execute(server.base, args) as Dict;
    if (args.json) json(result);
    else if (args.positional[0] === "models") printModels(result);
    else if (args.positional[0] === "workflow" && args.schema) await printSchema(server.base, args.positional[1]!, result);
    else if (args.positional[0] === "studio" && args.positional[1] === "open") out(String(result.url));
    else if (Array.isArray(result.paths)) for (const path of result.paths as string[]) out(path);
    else out(JSON.stringify(result, null, 2));
  } catch (error) {
    const e = toMediaApiError(error);
    if (args.json) json(cliErrorJson(e)); else err(formatMediaError(e));
    process.exitCode = 1;
  }
}
