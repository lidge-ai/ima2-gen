import { config } from "../../config.js";
import { migrateOAuthImageModel } from "../../lib/oauthLegacyModels.js";
import { parseArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import type { LaneInfo } from "../lib/modelResolver.js";
import {
  buildEffectiveConfig,
  deleteNestedKey,
  displayPath,
  envOverrideForKey,
  getNestedKey,
  loadCliDefaults,
  loadFileCfg,
  restartNotice,
  saveFileCfg,
  setNestedKey,
  CONFIG_FILE,
} from "../lib/config-store.js";
import { color, die, exitCodeForError, fail, json, out } from "../lib/output.js";

const MODEL_KEYS = ["imageModels.default", "apiProvider.defaultImageModel"] as const;
const REASONING_KEYS = ["imageModels.reasoningEffort", "apiProvider.defaultReasoningEffort"] as const;
type CliKind = "image" | "video";

const HELP = `
  ima2 defaults [subcommand] [options]

  Inspect or change persistent model/reasoning and CLI generation defaults.

  Subcommands:
    ls                         Show effective defaults
    set model <model>          Persist default model for GPT OAuth and API paths
    set reasoning <effort>     Persist default reasoning effort for GPT OAuth and API paths
    set image <lane>/<model>    Persist the CLI image generation target
    set video <lane>/<model>    Persist the CLI video generation target
    reset model                Remove persisted model defaults
    reset reasoning            Remove persisted reasoning defaults
    reset image                Remove the CLI image generation target
    reset video                Remove the CLI video generation target

  Options:
    --json                     Print JSON
    --local                    Do not query running server
    --server <url>             Query a specific running server for ls/default output
`;

const FLAGS = {
  json: { type: "boolean" },
  local: { type: "boolean" },
  server: { type: "string" },
  help: { short: "h", type: "boolean" },
};

function localDefaults() {
  const effective = buildEffectiveConfig();
  return {
    ok: true,
    source: "local",
    server: null,
    defaults: {
      oauth: {
        model: getNestedKey(effective, "imageModels.default"),
        reasoningEffort: getNestedKey(effective, "imageModels.reasoningEffort"),
      },
      api: {
        model: getNestedKey(effective, "apiProvider.defaultImageModel"),
        reasoningEffort: getNestedKey(effective, "apiProvider.defaultReasoningEffort"),
        size: getNestedKey(effective, "apiProvider.defaultSize"),
        webSearchEnabled: getNestedKey(effective, "apiProvider.allowWebSearch"),
      },
      cli: loadCliDefaults(),
    },
  };
}

async function readDefaults(args: ReturnType<typeof parseArgs>) {
  if (args.local) return localDefaults();
  try {
    const server = await resolveServer({ serverFlag: args.server });
    const capabilities = await request(server.base, "/api/capabilities", { timeoutMs: 5000 });
    return {
      ok: true,
      source: "server",
      server: server.base,
      defaults: { ...(capabilities.defaults ?? {}), cli: loadCliDefaults() },
    };
  } catch (error) {
    if (args.server !== undefined || process.env.IMA2_SERVER !== undefined
      || (error as { code?: string })?.code !== "SERVER_UNREACHABLE") throw error;
    return localDefaults();
  }
}

function printDefaults(payload: any): void {
  out(`ima2 defaults (${payload.source})`);
  out(`server: ${payload.server || "none"}`);
  out("");
  out(`oauth model: ${payload.defaults?.oauth?.model}`);
  out(`oauth reasoning: ${payload.defaults?.oauth?.reasoningEffort}`);
  out(`api model: ${payload.defaults?.api?.model}`);
  out(`api reasoning: ${payload.defaults?.api?.reasoningEffort}`);
  if (payload.defaults?.api?.size) out(`api size: ${payload.defaults.api.size}`);
  if (payload.defaults?.api?.webSearchEnabled !== undefined) {
    out(`api web search: ${payload.defaults.api.webSearchEnabled ? "enabled" : "disabled"}`);
  }
  out(`cli image: ${payload.defaults?.cli?.image ?? "none"}`);
  out(`cli video: ${payload.defaults?.cli?.video ?? "none"}`);
}

function validateModel(value: string): void {
  if (!config.imageModels.valid.has(migrateOAuthImageModel(value)) && !config.apiProvider.validImageModels.has(value)) {
    const choices = [...new Set([...config.imageModels.valid, ...config.apiProvider.validImageModels])];
    die(2, `model must be one of: ${choices.join(", ")}`);
  }
}

/**
 * GPT OAuth keeps only GPT-6 and the API-key lane its own list, so one `defaults set model` value
 * lands on each lane only in a form that lane serves: the OAuth default takes the GPT-6 tier of a
 * legacy id, and the API default changes only when the id is an API model.
 */
function laneValue(key: string, value: string): string | undefined {
  if (key === "imageModels.default") {
    const oauth = migrateOAuthImageModel(value);
    return config.imageModels.valid.has(oauth) ? oauth : undefined;
  }
  if (key === "apiProvider.defaultImageModel") return config.apiProvider.validImageModels.has(value) ? value : undefined;
  return value;
}

function validateReasoning(value: string): void {
  if (!config.imageModels.validReasoningEfforts.has(value)) {
    die(2, `reasoning must be one of: ${Array.from(config.imageModels.validReasoningEfforts).join(", ")}`);
  }
}

function warnOverrides(keys: readonly string[]): void {
  for (const key of keys) {
    const override = envOverrideForKey(key);
    if (!override) continue;
    out(color.yellow(`warning: env ${override.envVar}=${override.value} is currently overriding ${key}.`));
  }
}

function setDefaults(keys: readonly string[], value: string): void {
  const fileCfg = loadFileCfg();
  const written: string[] = [];
  for (const key of keys) {
    const next = laneValue(key, value);
    if (next === undefined) continue;
    setNestedKey(fileCfg, key, next);
    written.push(next === value ? key : `${key} (as ${next})`);
  }
  saveFileCfg(fileCfg);
  warnOverrides(keys);
  out(color.green("✓ ") + `wrote ${written.join(", ")}=${JSON.stringify(value)} to ${displayPath(CONFIG_FILE)}`);
  out(color.dim(restartNotice()));
}

function resetDefaults(keys: readonly string[]): void {
  const fileCfg = loadFileCfg();
  let changed = false;
  for (const key of keys) changed = deleteNestedKey(fileCfg, key) || changed;
  if (!changed) {
    out(color.dim(`(no persisted defaults found for ${keys.join(", ")})`));
    return;
  }
  saveFileCfg(fileCfg);
  out(color.green("✓ ") + `removed ${keys.join(", ")} from ${displayPath(CONFIG_FILE)}`);
  out(color.dim(restartNotice()));
}

function parseCliTarget(value: string, isJson: boolean): { lane: string; model: string } {
  const slash = value.indexOf("/");
  if (slash < 1 || slash === value.length - 1) {
    fail({ json: isJson, code: "INVALID_MODEL_TARGET", message: "target must be <lane>/<model>" });
  }
  return { lane: value.slice(0, slash), model: value.slice(slash + 1) };
}

async function fetchModelCatalog(args: ReturnType<typeof parseArgs>): Promise<Record<string, LaneInfo>> {
  try {
    const server = await resolveServer({ serverFlag: args.server });
    const catalog = await request(server.base, "/api/models", { timeoutMs: 5000 });
    return catalog.lanes ?? {};
  } catch (error) {
    fail({
      json: Boolean(args.json), code: (error as { code?: string })?.code ?? "SERVER_REQUEST_FAILED",
      message: (error as Error)?.message || "server request failed", exitCode: exitCodeForError(error),
    });
  }
}

async function validateCliTarget(kind: CliKind, value: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const target = parseCliTarget(value, Boolean(args.json));
  const lane = (await fetchModelCatalog(args))[target.lane];
  if (!lane) fail({ json: Boolean(args.json), code: "LANE_NOT_FOUND", message: `unknown lane: ${target.lane}` });
  if (lane.status !== "ready") {
    fail({
      json: Boolean(args.json), code: "LANE_UNAVAILABLE",
      message: `${target.lane} is ${lane.status}${lane.reason ? `: ${lane.reason}` : ""}`,
      extra: { lane: target.lane, status: lane.status, ...(lane.reason ? { reason: lane.reason } : {}) },
    });
  }
  if (!(lane.models?.[kind] ?? []).some((entry) => entry.id === target.model)) {
    fail({ json: Boolean(args.json), code: "MODEL_NOT_FOUND", message: `${value} is not an available ${kind} model` });
  }
}

function setCliDefault(kind: CliKind, value: string, isJson: boolean): void {
  const key = `defaults.${kind}`;
  const fileCfg = loadFileCfg();
  setNestedKey(fileCfg, key, value);
  saveFileCfg(fileCfg);
  if (isJson) json({ ok: true, kind, value });
  else out(color.green("✓ ") + `wrote ${key}=${JSON.stringify(value)} to ${displayPath(CONFIG_FILE)}`);
}

function resetCliDefault(kind: CliKind, isJson: boolean): void {
  const key = `defaults.${kind}`;
  const fileCfg = loadFileCfg();
  const changed = deleteNestedKey(fileCfg, key);
  if (changed) saveFileCfg(fileCfg);
  if (isJson) json({ ok: true, kind, reset: changed });
  else if (changed) out(color.green("✓ ") + `removed ${key} from ${displayPath(CONFIG_FILE)}`);
  else out(color.dim(`(no persisted default found for ${key})`));
}

async function listSub(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { flags: FLAGS });
  try {
    const payload = await readDefaults(args);
    if (args.json) json(payload);
    else printDefaults(payload);
  } catch (error) {
    fail({ json: Boolean(args.json), code: (error as { code?: string })?.code ?? "SERVER_REQUEST_FAILED",
      message: (error as Error)?.message || "server request failed", exitCode: exitCodeForError(error) });
  }
}

async function setSub(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { flags: FLAGS });
  const [target, value] = args.positional;
  if (!target || !value) die(2, "usage: defaults set <model|reasoning|image|video> <value>");
  if (target === "model") {
    validateModel(value);
    setDefaults(MODEL_KEYS, value);
    return;
  }
  if (target === "reasoning") {
    validateReasoning(value);
    setDefaults(REASONING_KEYS, value);
    return;
  }
  if (target === "image" || target === "video") {
    await validateCliTarget(target, value, args);
    setCliDefault(target, value, Boolean(args.json));
    return;
  }
  die(2, "target must be one of: model, reasoning, image, video");
}

async function resetSub(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { flags: FLAGS });
  const target = args.positional[0];
  if (target === "model") {
    resetDefaults(MODEL_KEYS);
    return;
  }
  if (target === "reasoning") {
    resetDefaults(REASONING_KEYS);
    return;
  }
  if (target === "image" || target === "video") {
    resetCliDefault(target, Boolean(args.json));
    return;
  }
  die(2, "usage: defaults reset <model|reasoning|image|video>");
}

export default async function defaultsCmd(argv: string[]) {
  const sub = argv[0];
  if (sub === "--help" || sub === "-h") {
    out(HELP);
    return;
  }
  if (!sub || sub === "ls" || sub.startsWith("-")) return listSub(sub === "ls" ? argv.slice(1) : argv);
  if (sub === "set") return setSub(argv.slice(1));
  if (sub === "reset") return resetSub(argv.slice(1));
  die(2, `unknown subcommand: ${sub}\n${HELP}`);
}
