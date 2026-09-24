/**
 * ima2 gpt — ChatGPT (GPT OAuth) session management.
 *
 * The session lives in ima2's own store (lib/chatgptAuth.ts, ~/.ima2/chatgpt-auth.json) and
 * is read by the openai-oauth proxy. Codex CLI files are still accepted as a fallback, but
 * logging in here gives ima2 an independent session that the Codex CLI never refreshes.
 */
import { parseArgs } from "../lib/args.js";
import { findRunningServer, request } from "../lib/client.js";
import { color, die, json, out } from "../lib/output.js";
import { openUrl } from "../lib/platform.js";
import {
  chatgptAuthFilePath,
  clearChatgptCredentials,
  resolveChatgptSession,
  type ChatgptSession,
} from "../../lib/chatgptAuth.js";
import { runChatgptLogin, type ChatgptLoginPrompt } from "../../lib/chatgptLogin.js";

const HELP = `
  ima2 gpt <subcommand> [options]

  Manage the ChatGPT (GPT OAuth) session used by the GPT image lane.

  Subcommands:
    login [--device]       Log in with your ChatGPT account (browser, or device code)
    status [--json]        Show which session the GPT OAuth proxy uses
    logout                 Remove ima2's stored ChatGPT session

  Notes:
    The session is stored in ${"~"}/.ima2/chatgpt-auth.json. Existing Codex CLI sessions
    (~/.codex/auth.json) are used only when ima2 has none of its own.
`;

const LOGIN_HELP = `
  ima2 gpt login [--device] [--no-open]

  Log in with your ChatGPT account. The default opens the browser and receives the
  callback on http://localhost:1455. Use --device on a headless or remote machine:
  it prints a code to enter at https://auth.openai.com/codex/device.

  Options:
        --device           Use the device-code flow instead of the browser callback
        --no-open          Print the URL instead of opening a browser
    -h, --help             Show this help
`;

const STATUS_HELP = `
  ima2 gpt status [--json]

  Show the ChatGPT session the GPT OAuth proxy will read: source file, account,
  plan, access-token expiry, and whether a refresh token is present.

  Options:
        --json             Print the status as one JSON object
    -h, --help             Show this help
`;

const LOGOUT_HELP = `
  ima2 gpt logout

  Remove ima2's stored ChatGPT session. Codex CLI files are never touched.

  Options:
    -h, --help             Show this help
`;

const LOGIN_SPEC = {
  flags: {
    device: { type: "boolean" },
    "no-open": { type: "boolean" },
    help: { short: "h", type: "boolean" },
  },
};
const STATUS_SPEC = { flags: { json: { type: "boolean" }, help: { short: "h", type: "boolean" } } };
const HELP_ONLY_SPEC = { flags: { help: { short: "h", type: "boolean" } } };

function rejectUnknownFlags(args: { _unknown?: string[] }): void {
  if (args._unknown?.length) die(2, `unknown option: ${args._unknown[0]}`);
}

export type GptSessionState = "ready" | "access_expired" | "no_refresh_token" | "none";

export interface GptStatusJson {
  auth: "oauth" | "none";
  state: GptSessionState;
  source?: ChatgptSession["source"];
  file?: string;
  email?: string;
  plan?: string;
  accountId?: string;
  expiresAt?: string;
  refreshable: boolean;
}

/**
 * An expired access token with a refresh token is still a usable session: the proxy refreshes
 * it on the next request (OpenCodex getLoginStatus treats it the same way).
 */
export function gptSessionState(session: ChatgptSession | null, now = Date.now()): GptSessionState {
  if (!session) return "none";
  if (session.accessExpiresAt !== undefined && session.accessExpiresAt <= now) {
    return session.refreshable ? "access_expired" : "no_refresh_token";
  }
  return session.refreshable ? "ready" : "no_refresh_token";
}

export function gptStatusJson(session: ChatgptSession | null): GptStatusJson {
  if (!session) return { auth: "none", state: "none", refreshable: false };
  return {
    auth: "oauth",
    state: gptSessionState(session),
    source: session.source,
    file: session.path,
    ...(session.email ? { email: session.email } : {}),
    ...(session.plan ? { plan: session.plan } : {}),
    ...(session.accountId ? { accountId: `${session.accountId.slice(0, 8)}…` } : {}),
    ...(session.accessExpiresAt !== undefined ? { expiresAt: new Date(session.accessExpiresAt).toISOString() } : {}),
    refreshable: session.refreshable,
  };
}

export function relativeTime(epochMs: number): string {
  const deltaMs = epochMs - Date.now();
  const minutes = Math.round(Math.abs(deltaMs) / 60_000);
  const span = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return deltaMs >= 0 ? `in ${span}` : `expired ${span} ago`;
}

function sourceLabel(source: ChatgptSession["source"]): string {
  return source === "ima2" ? "ima2 (own session)" : `${source} (shared with Codex CLI)`;
}

/** Human status lines shared by `ima2 gpt status` and `ima2 status`. */
export function gptStatusLines(session: ChatgptSession | null, indent = "  "): string[] {
  const state = gptSessionState(session);
  if (!session) return [`${color.yellow("○ ")}Not logged in to ChatGPT. Run: ima2 login`];
  const who = [session.email ?? "email unknown", session.plan].filter(Boolean).join(" · ");
  const head = state === "no_refresh_token"
    ? `${color.red("✗ ")}ChatGPT session cannot refresh (${who}). Run: ima2 login`
    : `${color.green("✓ ")}ChatGPT session (${who})`;
  const lines = [
    head,
    `${indent}source: ${sourceLabel(session.source)}`,
    `${indent}access token: ${session.accessExpiresAt === undefined ? "expiry unknown" : relativeTime(session.accessExpiresAt)}${state === "access_expired" ? " (refreshes on next use)" : ""}`,
    `${indent}refresh token: ${session.refreshable ? "present" : "absent"}`,
    color.dim(`${indent}file: ${session.path}`),
  ];
  if (session.source !== "ima2") {
    lines.push(color.dim(`${indent}tip: 'ima2 login' gives ima2 its own session so Codex CLI refreshes cannot log it out`));
  }
  return lines;
}

function printPrompt(prompt: ChatgptLoginPrompt, openBrowser: boolean): void {
  out("");
  if (prompt.flow === "device") {
    out(`  Open ${color.cyan(prompt.url)}`);
    out(`  and enter the code ${color.bold(prompt.userCode ?? "")}`);
    out(color.dim(`  The code expires in ${Math.round(prompt.expiresIn / 60)} minutes.`));
  } else {
    const opened = openBrowser ? openUrl(prompt.url).ok : false;
    out(opened ? "  Opened the ChatGPT login page in your browser." : "  Open this URL in a browser on this machine:");
    out(`  ${color.cyan(prompt.url)}`);
    out(color.dim("  Waiting for the callback on http://localhost:1455 (5 minutes)."));
  }
  out("");
}

/** Tell a running server to pick the new session up. Best effort: an old server may lack the route. */
export async function notifyServerOfGptLogin(): Promise<boolean> {
  try {
    const server = await findRunningServer({ includeEnv: false });
    if (!server) return false;
    await request(server.base, "/api/oauth/restart", { method: "POST", body: {} });
    return true;
  } catch {
    return false;
  }
}

export async function gptLogin(options: { device?: boolean; open?: boolean } = {}): Promise<ChatgptSession> {
  const openBrowser = options.open !== false;
  return runChatgptLogin({
    flow: options.device ? "device" : "browser",
    onPrompt: (prompt) => printPrompt(prompt, openBrowser),
  });
}

async function loginCmd(argv: string[]): Promise<void> {
  const args = parseArgs(argv, LOGIN_SPEC);
  if (args.help) { out(LOGIN_HELP); return; }
  rejectUnknownFlags(args);
  let session: ChatgptSession;
  try {
    session = await gptLogin({ device: args.device === true, open: args["no-open"] !== true });
  } catch (error) {
    die(1, `ChatGPT login failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  out(color.green("✓ ") + `ChatGPT session saved to ${session.path}${session.email ? ` (${session.email})` : ""}`);
  if (await notifyServerOfGptLogin()) out(color.dim("  The running ima2 server reloaded the GPT OAuth proxy."));
}

function statusCmd(argv: string[]): void {
  const args = parseArgs(argv, STATUS_SPEC);
  if (args.help) { out(STATUS_HELP); return; }
  rejectUnknownFlags(args);
  const session = resolveChatgptSession();
  if (args.json) {
    json(gptStatusJson(session));
    return;
  }
  for (const line of gptStatusLines(session)) out(line);
}

async function logoutCmd(argv: string[]): Promise<void> {
  const args = parseArgs(argv, HELP_ONLY_SPEC);
  if (args.help) { out(LOGOUT_HELP); return; }
  rejectUnknownFlags(args);
  const removed = clearChatgptCredentials();
  out(removed
    ? color.green("✓ ") + `Removed ${chatgptAuthFilePath()}`
    : color.yellow("○ ") + "ima2 had no stored ChatGPT session");
  const fallback = resolveChatgptSession();
  if (fallback) out(color.dim(`  The GPT OAuth proxy will now use ${fallback.path} (${fallback.source}).`));
  await notifyServerOfGptLogin();
}

export default async function gptCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    out(HELP);
    return;
  }
  const rest = argv.slice(1);
  if (sub === "login") return loginCmd(rest);
  if (sub === "status") return statusCmd(rest);
  if (sub === "logout") return logoutCmd(rest);
  die(2, `unknown subcommand '${sub}'. Run 'ima2 gpt --help'.`);
}
