import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { config } from "../../config.js";
import { parsePngInfo } from "../../lib/pngInfo.js";
import { sizeDrifted } from "../../lib/sizeNudge.js";
import { errInfo } from "../../lib/errInfo.js";
import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { wasFlagPassed } from "../lib/argsExplicit.js";
import { resolveServer, request, normalizeGenerate, fetchServer } from "../lib/client.js";
import { fileToDataUri, dataUriToFile, defaultOutName, readStdin } from "../lib/files.js";
import { loadCliDefaults } from "../lib/config-store.js";
import { runMcpJob } from "../lib/mcpJob.js";
import { characterElementIdForMcp } from "../lib/characterResolve.js";
import { resolveTarget, type ModelCatalog, type ModelEntry, type ResolveResult } from "../lib/modelResolver.js";
import { out, die, dieWithError, color, err, exitCodeForError, fail, json } from "../lib/output.js";
import { createCliRequestId, recoverGeneratedOutputs, formatRecoveryHint } from "../lib/recover-output.js";
import { deriveProviderIds } from "../../lib/providers/derive.js";
import { listProviders } from "../../lib/mcp/providerRegistry.js";
import { BACKGROUND_PRESETS } from "../../lib/backgroundPresets.js";
import { NAI_CLI_FLAGS, NAI_CLI_HELP, finalizeNaiCliTarget, parseNaiCliOptions,
  unwrapNaiCliResult, type NaiCliPreflight } from "../lib/nai-options.js";
const VALID_MODES = new Set(["auto", "direct"]);
const VALID_MODERATION = new Set(["auto", "low"]);
const MAX_GENERATION_COUNT = Math.max(1, Math.trunc(Number(config.limits.maxGeneratedImages) || 24));
const MAX_REFERENCE_COUNT = Math.max(1, Math.trunc(Number(config.limits.maxRefCount) || 5));
const MCP_IMAGE_TIMEOUT_MS = 5 * 60_000 + 120_000 + 30_000;
const MCP_LANES = new Set(["runway", "higgsfield"]);
const PROVIDER_VALUES = [
  ...deriveProviderIds(),
  ...listProviders([]).map((provider) => provider.id),
];

const SPEC = {
  flags: {
    "image-tool-model": { type: "string" },
    quality: { short: "q", type: "string", default: "low" },
    size: { short: "s", type: "string", default: "1024x1024" },
    "no-size-nudge": { type: "boolean" },
    count: { short: "n", type: "string", default: "1" },
    ref: { type: "string", repeatable: true },
    out: { short: "o", type: "string" },
    "out-dir": { short: "d", type: "string" },
    json: { type: "boolean" }, "no-save": { type: "boolean" }, force: { type: "boolean" },
    stdin: { type: "boolean" }, timeout: { type: "string", default: "180" }, server: { type: "string" },
    model: { type: "string" }, provider: { type: "string" }, mode: { type: "string", default: "auto" },
    moderation: { type: "string", default: "low" }, bg: { type: "string" }, session: { type: "string" },
    character: { type: "string" },
    "reasoning-effort": { type: "string" }, "web-search": { type: "boolean" },
    "no-web-search": { type: "boolean" }, help: { short: "h", type: "boolean" },
    ...NAI_CLI_FLAGS,
  },
};

const HELP = `
  ima2 gen <prompt...> [options]

  Generate image(s) via a configured core or MCP lane.
  Set a default with 'ima2 defaults set image <lane>/<model>' or inspect lanes with 'ima2 models'.

  Batch/async note:
    Use -n <N> for multiple core-lane candidates. Independent CLI commands can
    run concurrently; monitor requestIds with 'ima2 ps --json' and cancel with
    'ima2 cancel <requestId>'. MCP lanes support -n 1 only.

  Options:
    -q, --quality <low|medium|high|xhigh|max>         Core lanes only. Default: low
    -s, --size <WxH | auto>                 Core lanes only. Default: 1024x1024
        --no-size-nudge                     Do not restate --size in the prompt
    -n, --count <1..${MAX_GENERATION_COUNT}>                     MCP lanes: 1 only
        --ref <file|generated-file[:tag]>   Local file on core; generated filename on MCP
        --character <element-id|name>       MCP lanes only: character binding element
    -o, --out <file>                        Single-image output path
    -d, --out-dir <dir>                     Output directory
        --json                              Print one JSON result to stdout
        --no-save                           Core lanes only
        --stdin                              Read prompt from stdin (core lanes only)
        --timeout <sec>                     Default: 180
        --server <url>                      Override server URL
        --model <model|lane/model>          Bare IDs must be unique across lanes
                                            Core aliases: luna, astra, sol, terra, spark
        --image-tool-model <id>             API only: gpt-image-2.5-sunburst|gpt-image-2.5-flare
        --provider <${PROVIDER_VALUES.join("|")}>
                                            'auto' was removed; choose a lane explicitly
        --mode <auto|direct>                Core lanes only. Default: auto
        --moderation <auto|low>             Core lanes only. Default: low
        --bg <chroma-green|white|black|transparent>
                                            Core lanes only. 'transparent' asks GPT Image 2
                                            for a real alpha channel (saved as PNG)
        --session <id>                      Core lanes only
        --reasoning-effort <none|low|medium|high|xhigh|max>
                                            Core lanes only
        --web-search / --no-web-search      Core lanes only
${NAI_CLI_HELP}

  Examples:
    ima2 defaults set image oauth/gpt-5.6-luna
    ima2 gen "a shiba in space"
    ima2 gen "poster" --model oauth/luna --mode direct
    ima2 gen "fox logo mark" --bg transparent -o logo.png
    ima2 gen "campaign still" --model runway/gen-4 --ref 1780000000000_abcd.png
    ima2 gen "transparent character sprite" --provider nai --model nai-diffusion-5-full --nai-straight-alpha --nai-negative-prompt "watermark"
`;

type ResolvedTarget = Extract<ResolveResult, { ok: true }>;
type ImageContext = {
  server: { base: string };
  catalog: ModelCatalog;
  target: ResolvedTarget;
  prompt: string;
  refs: string[];
  explicitOut: string | null;
  outDir: string | null;
  naiOptions: NaiCliPreflight["payload"];
};

/**
 * Resolves --out against --out-dir.
 *
 * These two used to be mutually exclusive by accident: a ternary took --out and
 * never looked at --out-dir, so a relative name landed in the process cwd and a
 * caller who named a directory got their file somewhere else entirely, under a
 * success line that showed only the bare filename (#170).
 *
 * An absolute --out still wins, because someone who typed a full path means it.
 */
function resolveOutTarget(out: string, outDir: string | null): string {
  if (!outDir || isAbsolute(out)) return out;
  return join(outDir, out);
}

/** Absolute path for the success line, so "where did it go" is never a question. */
function displayPath(target: string): string {
  return isAbsolute(target) ? target : resolve(target);
}

/**
 * Reads the delivered pixel size back off disk.
 *
 * The requested size is a hint on some lanes, and the CLI used to print a bare
 * checkmark either way, so a rotated or resampled image looked identical to a
 * correct one until someone ran `sips` (#173).
 */
async function measureSaved(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const info = parsePngInfo(await readFile(path));
    if ("error" in info || typeof info.width !== "number") return null;
    return { width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** "✓ /abs/path.png  (1254x1254)" plus a drift line when it is not what was asked. */
function savedLine(path: string, actual: { width: number; height: number } | null, requested: unknown): string[] {
  const head = color.green("✓ ") + displayPath(path) + (actual ? `  (${actual.width}x${actual.height})` : "");
  if (!actual || !sizeDrifted(requested, actual)) return [head];
  return [head, color.dim(`  ! requested ${String(requested)}; the provider returned a different size`)];
}

function failServer(jsonMode: boolean, error: unknown): never {
  const code = (error as { code?: string })?.code ?? "SERVER_REQUEST_FAILED";
  const message = (error as Error)?.message || "server unreachable";
  if (code !== "SERVER_UNREACHABLE") fail({ json: jsonMode, code, message, exitCode: exitCodeForError(error) });
  if (jsonMode) err("Hint: start the server with `ima2 serve`.");
  fail({ json: jsonMode, code: "SERVER_UNREACHABLE", message: `${message}\nHint: run ima2 serve`, exitCode: 3 });
}

async function fetchCatalog(serverFlag: unknown, jsonMode: boolean) {
  try {
    const server = await resolveServer({ serverFlag });
    const catalog = await request(server.base, "/api/models", { timeoutMs: 5000 }) as ModelCatalog;
    return { server, catalog };
  } catch (error) {
    failServer(jsonMode, error);
  }
}

function resolveImageTarget(args: ParsedArgs, catalog: ModelCatalog): ResolvedTarget {
  const result = resolveTarget("image", {
    ...(args.model ? { model: String(args.model) } : {}),
    ...(args.provider ? { provider: String(args.provider) } : {}),
  }, catalog, loadCliDefaults());
  if (!result.ok) {
    fail({ json: Boolean(args.json), code: result.code, message: result.message, ...(result.extra ? { extra: result.extra } : {}) });
  }
  return result;
}

function inputRoles(entry: ModelEntry | undefined): string[] {
  const capabilities = entry?.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
  const roles = (capabilities as Record<string, unknown>).inputRoles;
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : [];
}

function generatedFilename(value: string): boolean {
  return /^\d{10,}_[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value);
}

function rejectUnsupportedMcpFlags(argv: string[], args: ParsedArgs): void {
  const forbidden: Array<[string, string[]]> = [
    ["--image-tool-model", ["--image-tool-model"]],
    ["--quality", ["--quality", "-q"]], ["--size", ["--size", "-s"]],
    ["--no-save", ["--no-save"]], ["--force", ["--force"]], ["--stdin", ["--stdin"]],
    ["--mode", ["--mode"]], ["--moderation", ["--moderation"]], ["--bg", ["--bg"]],
    ["--session", ["--session"]], ["--reasoning-effort", ["--reasoning-effort"]],
    ["--web-search", ["--web-search"]], ["--no-web-search", ["--no-web-search"]],
  ];
  const match = forbidden.find(([, flags]) => wasFlagPassed(argv, ...flags));
  if (match) fail({ json: Boolean(args.json), code: "FLAG_NOT_SUPPORTED", message: `${match[0]} is not supported for MCP image lanes`, extra: { flag: match[0] } });
  const count = Number(args.count);
  if (!Number.isInteger(count) || count !== 1) fail({ json: Boolean(args.json), code: "FLAG_NOT_SUPPORTED", message: "MCP image lanes support --count 1 only", extra: { flag: "--count" } });
}

type McpImageReference = { filename: string; tag?: string | undefined };

function parseMcpReference(value: string, jsonMode: boolean): McpImageReference {
  const separator = value.lastIndexOf(":");
  const filename = separator > 0 ? value.slice(0, separator) : value;
  const tag = separator > 0 ? value.slice(separator + 1) : undefined;
  if (!generatedFilename(filename)) {
    fail({ json: jsonMode, code: "MCP_REF_MUST_BE_GENERATED", message: `MCP references must be generated filenames: ${filename}` });
  }
  if (tag !== undefined && !/^[\p{L}\p{N}_-]{1,32}$/u.test(tag)) {
    fail({ json: jsonMode, code: "MCP_REF_TAG_INVALID", message: `MCP reference tag is invalid: ${tag || "(empty)"}` });
  }
  return { filename, ...(tag ? { tag } : {}) };
}

function supportingModels(catalog: ModelCatalog, role: string): string[] {
  const supported: string[] = [];
  for (const [lane, info] of Object.entries(catalog.lanes)) {
    if (!MCP_LANES.has(lane)) continue;
    for (const entry of info.models.image) {
      if (inputRoles(entry).includes(role)) supported.push(`${lane}/${entry.id}`);
    }
  }
  return supported;
}

function validateMcpRefs(refs: string[], context: ImageContext, roles: string[], jsonMode: boolean): McpImageReference[] {
  const parsed = refs.map((ref) => parseMcpReference(ref, jsonMode));
  if (refs.length > 0 && !roles.includes("image_references")) {
    const supportedModels = supportingModels(context.catalog, "image_references");
    const support = supportedModels.length ? supportedModels.join(", ") : "none listed";
    fail({
      json: jsonMode, code: "INPUT_ROLE_UNSUPPORTED",
      message: `${context.target.lane}/${context.target.model} does not support --ref; supporting MCP models: ${support}`,
      extra: { flag: "--ref", role: "image_references", supportedModels },
    });
  }
  if (refs.length === 0 && roles.includes("start_image") && !roles.includes("text")) {
    fail({ json: jsonMode, code: "MISSING_START_FRAME", message: "selected model requires a generated start image" });
  }
  return parsed;
}

async function downloadMcpResult(serverBase: string, url: string, target: string): Promise<void> {
  const response = await fetchServer(serverBase, url);
  if (!response.ok) die(1, `failed to download image: HTTP ${response.status}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function runMcpImage(argv: string[], args: ParsedArgs, context: ImageContext): Promise<void> {
  rejectUnsupportedMcpFlags(argv, args);
  const refs = (Array.isArray(args.ref) ? args.ref : []) as string[];
  const entry = context.catalog.lanes[context.target.lane]?.models.image.find((item) => item.id === context.target.model);
  const references = validateMcpRefs(refs, context, inputRoles(entry), Boolean(args.json));
  const requestId = createCliRequestId("req_cli_gen");
  const characterElementId = args.character
    ? await characterElementIdForMcp({
        serverBase: context.server.base, idOrName: String(args.character),
        lane: context.target.lane, inputRoles: inputRoles(entry), json: Boolean(args.json),
      })
    : null;
  const body = { provider: context.target.lane, kind: "image", prompt: context.prompt, model: context.target.model,
    requestId, parameters: {}, ...(references.length ? { references } : {}),
    ...(characterElementId ? { characterElementId } : {}) };
  try {
    const result = await runMcpJob({ serverBase: context.server.base, kind: "image", body, requestId,
      timeoutMs: MCP_IMAGE_TIMEOUT_MS, json: Boolean(args.json), onProgress: (phase: unknown) => err(`[${String(phase)}]`) });
    const target = args.out
      ? resolveOutTarget(String(args.out), args["out-dir"] ? String(args["out-dir"]) : null)
      : args["out-dir"] ? join(String(args["out-dir"]), result.filename) : undefined;
    if (target) await downloadMcpResult(context.server.base, result.url, target);
    if (args.json) json({ ok: true, requestId, filename: result.filename, url: result.url, ...(target ? { path: target } : {}) });
    else out(color.green("✓ ") + (target ? displayPath(target) : `${context.server.base}${result.url}`));
  } catch (error) {
    const typed = error as Error & { code?: string | undefined };
    fail({ json: Boolean(args.json), code: typed.code ?? "MCP_GENERATION_FAILED", message: typed.message,
      exitCode: exitCodeForError(error) === 4 ? 4 : 1 });
  }
}

function validateCoreFlags(args: ParsedArgs): void {
  if (!VALID_MODES.has(String(args.mode))) die(2, "--mode must be one of: auto, direct");
  if (!VALID_MODERATION.has(String(args.moderation))) die(2, "--moderation must be one of: auto, low");
  // Fail locally on a typo instead of spending a round trip to learn the
  // server rejected it.
  if (args.bg && !BACKGROUND_PRESETS.includes(String(args.bg) as (typeof BACKGROUND_PRESETS)[number])) {
    die(2, `--bg must be one of: ${BACKGROUND_PRESETS.join(", ")}`);
  }
  const validReasoning = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
  if (args["reasoning-effort"] && !validReasoning.has(String(args["reasoning-effort"]))) die(2, "--reasoning-effort must be one of: none, low, medium, high, xhigh, max");
  if (args["web-search"] && args["no-web-search"]) die(2, "--web-search and --no-web-search are mutually exclusive");
}

async function requestCoreImage(args: ParsedArgs, context: ImageContext, n: number, requestId: string) {
  const references = await Promise.all(context.refs.map((path: string) => fileToDataUri(path)));
  const body: Record<string, unknown> = { prompt: context.prompt, quality: args.quality, size: args.size, n, references,
    ...(args["no-size-nudge"] ? { sizeNudge: false } : {}),
    model: context.target.model, mode: args.mode, moderation: args.moderation, sessionId: args.session,
    provider: context.target.lane, ...context.naiOptions };
  body.requestId = requestId;
  if (args.bg) body.backgroundPreset = String(args.bg);
  if (args["image-tool-model"]) body.imageToolModel = args["image-tool-model"];
  if (args["reasoning-effort"]) body.reasoningEffort = args["reasoning-effort"];
  if (args["no-web-search"]) body.webSearchEnabled = false;
  else if (args["web-search"]) body.webSearchEnabled = true;
  return request(context.server.base, "/api/generate", { method: "POST", body,
    timeoutMs: (parseInt(String(args.timeout)) || 180) * 1000, headers: { "X-Request-Id": requestId } });
}

async function recoverCoreTimeout(args: ParsedArgs, context: ImageContext, requestId: string, n: number): Promise<boolean> {
  if (!context.explicitOut && !context.outDir) return false;
  const result = await recoverGeneratedOutputs(context.server.base, requestId, { explicitOut: context.explicitOut,
    outDir: context.outDir, expectedCount: n, json: Boolean(args.json) });
  if (!result.recovered) { if (!args.json) out(formatRecoveryHint(result)); return false; }
  if (args.json) json({ ok: true, requestId, recovered: true, images: result.paths.map((path) => ({ path })) });
  else for (const path of result.paths) out(color.green("✓ ") + path + color.dim(" (recovered)"));
  return true;
}

async function runCoreImage(args: ParsedArgs, context: ImageContext): Promise<void> {
  validateCoreFlags(args);
  const n = Math.max(1, Math.min(MAX_GENERATION_COUNT, parseInt(String(args.count)) || 1));
  const requestId = createCliRequestId("req_cli_gen");
  let response;
  try { response = await requestCoreImage(args, context, n, requestId); }
  catch (error) {
    const info = errInfo(error);
    const timedOut = info.name === "TimeoutError" || info.name === "AbortError";
    if (timedOut && await recoverCoreTimeout(args, context, requestId, n)) return;
    if (args.json) json({ ok: false, error: info.message, code: info.code, status: info.status, requestId });
    dieWithError(error);
  }
  const norm = normalizeGenerate(response);
  if (norm.images.length === 0) die(1, "server returned no images");
  if (args["no-save"]) {
    const bytes = norm.images.reduce((sum: number, image) => sum + (image.image?.length ?? 0), 0);
    if (process.stdout.isTTY && bytes > 2 * 1024 * 1024 && !args.force) die(2, "refusing to print >2MB of b64 to TTY; use --force or drop --no-save");
    for (const image of norm.images) out(image.image);
    return;
  }
  if (context.explicitOut && norm.images.length > 1) die(2, "--out only supports a single image; use --out-dir for n>1");
  const paths: string[] = [];
  for (let i = 0; i < norm.images.length; i += 1) {
    let target: string;
    if (context.explicitOut) target = resolveOutTarget(context.explicitOut, context.outDir);
    else if (context.outDir) target = `${context.outDir}/${defaultOutName(i, norm.images.length)}`;
    else target = `${config.storage.generatedDir}/${defaultOutName(i, norm.images.length)}`;
    const image = norm.images[i];
    if (!image) continue;
    await dataUriToFile(String(image.image), target);
    paths.push(target);
  }
  const measured = await Promise.all(paths.map((path) => measureSaved(path)));
  if (args.json) json({ ok: true, requestId: norm.requestId, elapsed: norm.elapsed,
    images: paths.map((path, index) => ({
      path,
      filename: norm.images[index]?.filename,
      // Split so an agent can spot drift without opening the file (#173).
      requestedSize: args.size ? String(args.size) : null,
      actualSize: measured[index] ? `${measured[index]!.width}x${measured[index]!.height}` : null,
    })) });
  else {
    paths.forEach((path, index) => { for (const line of savedLine(path, measured[index] ?? null, args.size)) out(line); });
    if (norm.elapsed) out(color.dim(`elapsed ${norm.elapsed}s`));
  }
}

export default async function genCmd(argv: string[]): Promise<void> {
  try { await generate(argv); }
  catch (error) {
    if (!(error instanceof Error)) throw error; // Preserve the output owner's exit marker.
    fail({ json: argv.includes("--json"), code: (error as { code?: string }).code ?? "GENERATION_FAILED",
      message: error.message, exitCode: exitCodeForError(error) });
  }
}

async function generate(argv: string[]): Promise<void> {
  const args = parseArgs(argv, SPEC);
  if (args.help) { out(HELP); return; }
  if (args._unknown.length) die(2, `unknown option: ${args._unknown[0]}`);
  const naiPreflight = unwrapNaiCliResult(parseNaiCliOptions(args, "allow-unknown"), Boolean(args.json));
  let prompt = args.positional.join(" ");
  if (!prompt && !args.stdin) die(2, "prompt is required (positional or via --stdin)");
  const refs = (Array.isArray(args.ref) ? args.ref : []) as string[];
  if (refs.length > MAX_REFERENCE_COUNT) die(2, `max ${MAX_REFERENCE_COUNT} --ref attachments`);
  const { server, catalog } = await fetchCatalog(args.server, Boolean(args.json));
  const target = resolveImageTarget(args, catalog);
  const naiFinal = unwrapNaiCliResult(finalizeNaiCliTarget(naiPreflight, target), Boolean(args.json));
  if (args.character && target.transport !== "mcp") {
    fail({ json: Boolean(args.json), code: "CAPABILITY_MISMATCH",
      message: "--character is only supported on MCP lanes (runway/higgsfield); core lanes use element mentions",
      exitCode: 2 });
  }
  let context = { server, catalog, target, prompt, refs, explicitOut: args.out ? String(args.out) : null,
    outDir: args["out-dir"] ? String(args["out-dir"]) : null, naiOptions: naiFinal.payload };
  if (target.transport === "mcp") return runMcpImage(argv, args, context);
  if (args.stdin) { const piped = await readStdin(); if (piped) prompt = prompt ? `${prompt} ${piped}` : piped; }
  if (!prompt) die(2, "prompt is required (positional or via --stdin)");
  context = { ...context, prompt };
  return runCoreImage(args, context);
}
