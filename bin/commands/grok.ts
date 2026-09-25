/**
 * ima2 grok — xAI OAuth session management.
 *
 * There is no proxy left to manage: the Grok lanes call https://api.x.ai directly with the
 * session in ~/.progrok/auth.json (lib/xaiAuth.ts). `login` prefers a running ima2 server so
 * the CLI and the web UI drive the same device-code session, and falls back to running the
 * flow in-process when no server answers.
 */
import { parseArgs } from "../lib/args.js";
import { findRunningServer, request, type CliRequestError } from "../lib/client.js";
import { color, die, json, out } from "../lib/output.js";
import {
  clearGrokCredentials,
  grokAuthFilePath,
  loadGrokCredentials,
  type GrokCredentials,
} from "../../lib/xaiAuth.js";
import { runXaiDeviceLogin, type XaiDeviceCodeInfo } from "../../lib/xaiDeviceLogin.js";
import { fetchWithGrokAuth, getGrokEndpoint } from "../../lib/grokRuntime.js";
import type { RouteRuntimeContext } from "../../lib/runtimeContext.js";

const HELP = `
  ima2 grok <subcommand> [options]

  Manage the xAI (Grok) OAuth session used by the grok image and video lanes.
  Requests go straight to https://api.x.ai; no local proxy is involved.

  Subcommands:
    login                  Log in to xAI with the OAuth device-code flow
    status [--json]        Show the stored session (add --probe to call /v1/models)
    logout                 Remove the stored xAI session

  Notes:
    The session is stored in ~/.progrok/auth.json and is shared with the
    progrok CLI if you have it installed.
    ima2 grok login uses a running 'ima2 serve' when one is available so the
    CLI and the web UI share one login; otherwise it runs the flow directly.
`;

const LOGIN_HELP = `
  ima2 grok login

  Log in to xAI with the OAuth device-code flow. Prints a verification URL and a
  user code, then waits for the approval. Uses a running 'ima2 serve' when one
  answers so the CLI and the web UI share a single session.

  Options:
    -h, --help             Show this help
`;

const STATUS_HELP = `
  ima2 grok status [--json] [--probe]

  Show the stored xAI OAuth session: account, expiry, and whether a refresh
  token is present.

  Options:
        --json             Print the status as one JSON object
        --probe            Call /v1/models and list the visible grok-imagine models
    -h, --help             Show this help
`;

const LOGOUT_HELP = `
  ima2 grok logout

  Remove the stored xAI OAuth session from ~/.progrok/auth.json. The progrok CLI
  shares that file, so this logs both out.

  Options:
    -h, --help             Show this help
`;

/** login and logout take no options of their own; only help is valid. */
const HELP_ONLY_SPEC = {
  flags: {
    help: { short: "h", type: "boolean" },
  },
};

const STATUS_SPEC = {
  flags: {
    json: { type: "boolean" },
    probe: { type: "boolean" },
    help: { short: "h", type: "boolean" },
  },
};

function rejectUnknownFlags(args: { _unknown?: string[] }): void {
  if (args._unknown?.length) die(2, `unknown option: ${args._unknown[0]}`);
}

const POLL_INTERVAL_MS = 3_000;

interface GrokStatusJson {
  auth: "oauth" | "none";
  email?: string;
  expiresAt?: string;
  refreshable: boolean;
}

/** --probe result, merged into the JSON shape only when --probe was asked for. */
interface GrokProbeJson {
  imagineModels?: string[];
  probeError?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printUserCode(info: XaiDeviceCodeInfo): void {
  out("");
  out(`  Open ${color.cyan(info.verificationUrl)}`);
  out(`  and enter the code ${color.bold(info.userCode)}`);
  out(color.dim(`  The code expires in ${Math.round(info.expiresIn / 60)} minutes.`));
  out("");
}

/** Relative rendering of an absolute epoch-ms expiry, e.g. "in 58m" or "expired 2h ago". */
function relativeTime(epochMs: number): string {
  const deltaMs = epochMs - Date.now();
  const minutes = Math.round(Math.abs(deltaMs) / 60_000);
  const span = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return deltaMs >= 0 ? `in ${span}` : `expired ${span} ago`;
}

function statusJson(creds: GrokCredentials | null): GrokStatusJson {
  if (!creds) return { auth: "none", refreshable: false };
  return {
    auth: "oauth",
    ...(creds.email !== undefined ? { email: creds.email } : {}),
    ...(creds.expiresAt !== undefined ? { expiresAt: new Date(creds.expiresAt).toISOString() } : {}),
    refreshable: typeof creds.refreshToken === "string" && creds.refreshToken.length > 0,
  };
}

interface SwitchStart { sessionId: string; userCode: string; verificationUrl: string; expiresIn: number }
interface SwitchPoll { status: "pending" | "complete" | "error" | "expired"; error?: string }

/** Drives the server-side device-code session so the CLI and web UI share one login. */
async function loginViaServer(base: string): Promise<void> {
  const start = await request(base, "/api/auth/switch", { method: "POST", body: { provider: "grok" } }) as SwitchStart;
  printUserCode({ userCode: start.userCode, verificationUrl: start.verificationUrl, expiresIn: start.expiresIn });
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    // A 404 means the session is gone (server restarted or reaped it): report it as the
    // expired login it is, not as a bare HTTP status the user cannot act on.
    const poll = await request(base, `/api/auth/switch/${encodeURIComponent(start.sessionId)}`)
      .catch((error: unknown) => {
        if ((error as CliRequestError).status === 404) return { status: "expired" } satisfies SwitchPoll;
        throw error;
      }) as SwitchPoll;
    if (poll.status === "complete") return;
    if (poll.status === "error") throw new Error(poll.error || "xAI device login failed");
    if (poll.status === "expired") throw new Error("xAI device login expired before it was approved");
  }
  throw new Error("xAI device login expired before it was approved");
}

async function loginCmd(argv: string[]): Promise<void> {
  // Help is answered before anything observable happens. Until 3.16.1 this
  // function started server discovery and a real device-code flow for
  // 'ima2 grok login --help' (#244).
  const args = parseArgs(argv, HELP_ONLY_SPEC);
  if (args.help) { out(LOGIN_HELP); return; }
  rejectUnknownFlags(args);
  let server: { base: string } | null = null;
  try {
    server = await findRunningServer({ includeEnv: false });
  } catch {
    // An unreachable or misconfigured server is not a login failure; run the flow locally.
  }
  try {
    if (server) await loginViaServer(server.base);
    else await runXaiDeviceLogin({ onUserCode: printUserCode });
  } catch (error) {
    die(1, `Grok login failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  out(color.green("✓ ") + `Grok OAuth session saved to ${grokAuthFilePath()}`);
}

interface ModelListResponse { data?: Array<{ id?: unknown }> }

/** Lists the grok-imagine model ids the stored session can actually see. */
async function probeImagineModels(): Promise<string[]> {
  // The grok lane reads only grokAuthHomeDir off the context, and the CLI always wants the
  // real ~/.progrok session, so an empty context is the whole dependency here.
  const ctx: RouteRuntimeContext = {};
  const response = await fetchWithGrokAuth(ctx, "grok", (credential) => {
    const endpoint = getGrokEndpoint("/v1/models", credential);
    return fetch(endpoint.url, { headers: endpoint.headers, signal: AbortSignal.timeout(20_000) });
  });
  if (!response.ok) throw new Error(`xAI /v1/models failed: HTTP ${response.status}`);
  const body = await response.json() as ModelListResponse;
  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.includes("imagine"));
}

/** A probe failure is reported, never thrown, so --json still emits one parseable object. */
async function probeResult(): Promise<GrokProbeJson> {
  try {
    return { imagineModels: await probeImagineModels() };
  } catch (error) {
    return { probeError: error instanceof Error ? error.message : String(error) };
  }
}

async function statusCmd(argv: string[]): Promise<void> {
  const args = parseArgs(argv, STATUS_SPEC);
  if (args.help) { out(STATUS_HELP); return; }
  rejectUnknownFlags(args);
  const creds = loadGrokCredentials();
  const probe = args.probe === true && creds !== null ? await probeResult() : undefined;
  if (args.json) {
    json({ ...statusJson(creds), ...(probe ?? {}) });
    return;
  }
  if (!creds) {
    out(color.yellow("○ ") + "Not logged in to Grok. Run: ima2 grok login");
    return;
  }
  out(color.green("✓ ") + `Grok OAuth session (${creds.email ?? "email unknown"})`);
  out(`  expires: ${creds.expiresAt === undefined ? "unknown" : relativeTime(creds.expiresAt)}`);
  out(`  refresh token: ${creds.refreshToken ? "present" : "absent"}`);
  out(color.dim(`  file: ${grokAuthFilePath()}`));
  if (!probe) return;
  if (probe.probeError !== undefined) die(1, `Grok model probe failed: ${probe.probeError}`);
  const ids = probe.imagineModels ?? [];
  out(ids.length ? `  imagine models: ${ids.join(", ")}` : color.yellow("  no grok-imagine model is visible to this session"));
}

function logoutCmd(argv: string[]): void {
  // Same reason as loginCmd: 'ima2 grok logout --help' used to delete the
  // stored session before anyone read the help text (#244).
  const args = parseArgs(argv, HELP_ONLY_SPEC);
  if (args.help) { out(LOGOUT_HELP); return; }
  rejectUnknownFlags(args);
  clearGrokCredentials();
  out(color.green("✓ ") + "Removed the stored Grok OAuth session");
}

export default async function grokCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    out(HELP);
    return;
  }
  const rest = argv.slice(1);
  if (sub === "login") return loginCmd(rest);
  if (sub === "status") return statusCmd(rest);
  if (sub === "logout") return logoutCmd(rest);
  die(2, `unknown subcommand '${sub}'. Run 'ima2 grok --help'.`);
}
