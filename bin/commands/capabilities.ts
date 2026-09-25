import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "../../config.js";
import { buildIma2Capabilities } from "../../lib/capabilities.js";
import { parseArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { color, exitCodeForError, fail, json, out } from "../lib/output.js";

type Ima2Capabilities = ReturnType<typeof buildIma2Capabilities>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE_PATH = join(ROOT, "package.json");

const HELP = `
  ima2 capabilities [--json] [--server <url>] [--require-server]

  Print agent-friendly capability metadata.

  Options:
    --json             Print JSON
    --server <url>     Query a specific running server
    --require-server   Fail instead of falling back to local package metadata
`;

const FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  "require-server": { type: "boolean" },
  help: { short: "h", type: "boolean" },
};

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_PATH, "utf-8")) as { version?: string };
    return pkg.version || "?";
  } catch {
    return "?";
  }
}

function localCapabilities() {
  return buildIma2Capabilities({
    appConfig: config,
    packageVersion: packageVersion(),
    source: "local",
    server: null,
  });
}

async function readCapabilities(args: ReturnType<typeof parseArgs>): Promise<Ima2Capabilities> {
  try {
    const server = await resolveServer({ serverFlag: args.server });
    return await request(server.base, "/api/capabilities", { timeoutMs: 5000 });
  } catch (error) {
    if (args.server !== undefined || process.env.IMA2_SERVER !== undefined || args["require-server"]
      || (error as { code?: string })?.code !== "SERVER_UNREACHABLE") throw error;
    return localCapabilities();
  }
}

/**
 * Prints which lanes can actually run right now.
 *
 * `valid.providers` above is the flag vocabulary — every id the CLI accepts.
 * This is the runtime answer, and the two differ constantly: four lanes are
 * usually missing a key. Without it an agent reads the vocabulary as
 * availability and picks a lane that cannot work.
 */
function printLanes(capabilities: Ima2Capabilities): void {
  const lanes = capabilities.lanes;
  if (!lanes || typeof lanes !== "object") {
    // Only a running server knows this, and `source` already says which we got.
    if (capabilities.source !== "server") {
      out(color.dim("lanes: unknown (no server; run 'ima2 serve' for live lane state)"));
      out("");
    }
    return;
  }
  out("lanes:");
  for (const [id, lane] of Object.entries(lanes)) {
    const counts = `image=${lane?.models?.image ?? 0} video=${lane?.models?.video ?? 0}`;
    const detail = lane?.status === "ready"
      ? counts
      : `${lane?.status}${lane?.reason ? ` — ${lane.reason}` : ""}, ${counts}`;
    out(`  ${id.padEnd(12)} ${detail}`);
  }
  out("");
}

function printText(capabilities: Ima2Capabilities): void {
  out(`ima2 capabilities (${capabilities.source})`);
  out(`version: ${capabilities.version}`);
  out(`server: ${capabilities.server || "none"}`);
  out("");
  out("defaults:");
  out(`  gpt-oauth model: ${capabilities.defaults?.oauth?.model}`);
  out(`  gpt-oauth reasoning: ${capabilities.defaults?.oauth?.reasoningEffort}`);
  out(`  api model: ${capabilities.defaults?.api?.model}`);
  out(`  api reasoning: ${capabilities.defaults?.api?.reasoningEffort}`);
  out(`  grok model: ${capabilities.defaults?.grok?.model}`);
  out(`  grok planner: ${capabilities.defaults?.grok?.plannerModel}`);
  out("");
  out("valid:");
  out(`  models: ${capabilities.valid?.imageModels?.supported?.join(", ")}`);
  if (capabilities.valid?.imageModels?.grokSupported?.length) {
    out(`  grok models: ${capabilities.valid.imageModels.grokSupported.join(", ")}`);
  }
  if (capabilities.valid?.videoModels?.supported?.length) {
    out(`  video models: ${capabilities.valid.videoModels.supported.join(", ")}`);
    out(`  video resolutions: ${capabilities.valid.videoModels.resolutions?.join(", ")}`);
    out(`  video aspect ratios: ${capabilities.valid.videoModels.aspectRatios?.join(", ")}`);
    out(`  video duration: ${capabilities.valid.videoModels.durationRange?.[0]}-${capabilities.valid.videoModels.durationRange?.[1]}s`);
  }
  out(`  reasoning: ${capabilities.valid?.reasoningEfforts?.join(", ")}`);
  out(`  quality: ${capabilities.valid?.quality?.join(", ")}`);
  out(`  modes: ${capabilities.valid?.modes?.join(", ")}`);
  out(`  moderation: ${capabilities.valid?.moderation?.join(", ")}`);
  out(`  providers: ${capabilities.valid?.providers?.join(", ")}`);
  out("");
  printLanes(capabilities);
  out(`config keys: ${capabilities.configKeys?.writable?.length ?? 0} writable`);
  out(color.dim("run: ima2 config keys --json"));
  out("");
  out(`limits: refs=${capabilities.limits?.maxRefCount}, images=${capabilities.limits?.maxGeneratedImages}`);
  out(color.dim(`maxParallel: ${capabilities.limits?.maxParallel?.value} (${capabilities.limits?.maxParallel?.note})`));
}

export default async function capabilitiesCmd(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  if (args.help) {
    out(HELP);
    return;
  }

  try {
    const capabilities = await readCapabilities(args);
    if (args.json) json(capabilities);
    else printText(capabilities);
  } catch (error) {
    fail({ json: Boolean(args.json), code: (error as { code?: string })?.code ?? "SERVER_REQUEST_FAILED",
      message: (error as Error)?.message || "server request failed", exitCode: exitCodeForError(error) });
  }
}
