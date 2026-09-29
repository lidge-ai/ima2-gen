#!/usr/bin/env node
import { exitFlushed, installExitFlushGuard } from "./lib/output.js";
installExitFlushGuard();
import { createInterface } from "readline/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, execFileSync } from "child_process";
import { confirmDestructiveAction } from "./lib/destructive-confirm.js";
import { openUrl, killProcessTree } from "./lib/platform.js";
import { ensureFreshUiDist } from "./lib/ui-build.js";
import { renderHelp } from "./lib/helpText.js";
import { detectCodexAuth } from "../lib/codexDetect.js";
import { resolveChatgptSession } from "../lib/chatgptAuth.js";

import { errInfo } from "../lib/errInfo.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
let pkg = { version: "?", name: "ima2-gen" };
try {
  const metadata = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  if (metadata && typeof metadata.version === "string" && typeof metadata.name === "string") pkg = metadata;
} catch { /* best-effort: package.json metadata is optional; keep the placeholder version */ }

// Installation diagnosis must run before any account/config initialization.
if (process.argv[2] === "doctor" && process.argv.slice(3).includes("--installation")) {
  const options = process.argv.slice(3);
  const allowed = new Set(["--installation", "--json", "--help", "-h"]);
  if (options.some((option) => !allowed.has(option)) || new Set(options).size !== options.length) {
    console.error("Installation doctor accepts only --installation, --json and --help.");
    exitFlushed(2);
  }
  if (options.includes("--help") || options.includes("-h")) {
    console.log("Usage: ima2 doctor --installation [--json]\nOffline package, Node, native binding, skill and UI checks. No config, account or network checks.");
    exitFlushed(0);
  }
  const { buildInstallationDoctorLines } = await import("./lib/doctor-runtime.js");
  const { buildDoctorReport, renderDoctorReport } = await import("./lib/doctor-report.js");
  const report = buildDoctorReport({ version: pkg.version, mode: "installation", lines: buildInstallationDoctorLines(ROOT) });
  console.log(options.includes("--json") ? JSON.stringify(report) : renderDoctorReport(report));
  exitFlushed(report.summary.exitCode);
}

const { config: runtimeConfig } = await import("../config.js");
const { doctor } = await import("./commands/doctor.js");
const { maybePromptGithubStar } = await import("./lib/star-prompt.js");
// Config lives under runtimeConfig.storage.configDir (honors IMA2_CONFIG_DIR).
// Legacy installs that stored config at <packageRoot>/.ima2/config.json will be
// migrated on first write.
const CONFIG_DIR = runtimeConfig.storage.configDir;
const CONFIG_FILE = runtimeConfig.storage.configFile;
const LEGACY_CONFIG_FILE = join(ROOT, ".ima2", "config.json");

function runSelf(args: string[]) {
  execFileSync(process.execPath, [join(ROOT, "bin", "ima2.js"), ...args], { stdio: "inherit" });
}

/** Native ChatGPT login into ima2's own store (lib/chatgptLogin.ts); no Codex CLI child. */
async function runGptLogin() {
  const { gptLogin, notifyServerOfGptLogin } = await import("./commands/gpt.js");
  const session = await gptLogin();
  console.log(`\n  ChatGPT session saved to ${session.path}${session.email ? ` (${session.email})` : ""}\n`);
  await notifyServerOfGptLogin();
}

function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  // One-time read from legacy location so users who set up on <1.0.4 don't lose auth.
  if (existsSync(LEGACY_CONFIG_FILE)) {
    try { return JSON.parse(readFileSync(LEGACY_CONFIG_FILE, "utf-8")); } catch { /* best-effort: unreadable legacy config falls through to defaults */ }
  }
  return {};
}

function saveConfig(config: Record<string, unknown>) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadAdvertisement() {
  const p = runtimeConfig.storage.advertiseFile;
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function advertisedServerUrl() {
  const adv = loadAdvertisement();
  return adv?.backend?.url || adv?.url || (adv?.port ? `http://localhost:${adv.port}` : null);
}

async function setup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n  ima2-gen — GPT Image 2 Generator\n");
  console.log("  Choose authentication method:\n");
  console.log("    1) GPT OAuth   — login with ChatGPT account (free, images only)");
  console.log("    2) Grok OAuth  — login with xAI/Grok account (images + video)");
  console.log("    3) Both        — GPT OAuth + Grok OAuth");
  console.log("    4) Web setup   — configure everything in the web UI\n");

  const choice = await rl.question("  Enter 1-4: ");
  const config = loadConfig();

  if (choice.trim() === "4") {
    config.provider = "oauth";
    delete config.apiKey;
    saveConfig(config);
    console.log("\n  You can set up everything from the web UI.");
    console.log("  Run 'ima2 serve', then open Settings in the browser to sign in or add API keys.\n");
  } else if (choice.trim() === "2") {
    config.provider = "grok";
    config.oauth = config.oauth || {};
    config.oauth.disableAutoStart = true;
    delete config.apiKey;
    saveConfig(config);
    console.log("\n  Starting Grok OAuth login...\n");
    try {
      runSelf(["grok", "login"]);
    } catch {
      console.log("\n  Grok login failed or cancelled. You can retry with 'ima2 grok login'.\n");
      rl.close();
      exitFlushed(1);
    }
    console.log("  Grok configured. Run 'ima2 serve' to start.\n");
  } else if (choice.trim() === "3") {
    config.provider = "oauth";
    delete config.apiKey;
    if (config.oauth) delete config.oauth.disableAutoStart;
    saveConfig(config);
    console.log("\n  Setting up both GPT OAuth + Grok OAuth...\n");
    // GPT OAuth
    const existing = resolveChatgptSession();
    if (existing?.source === "ima2" && existing.refreshable) {
      console.log(`  GPT OAuth session found (${existing.email ?? existing.path}).\n`);
    } else {
      console.log("  Running GPT OAuth login...\n");
      try {
        await runGptLogin();
      } catch (e) {
        console.log(`\n  GPT login failed: ${(e as Error).message}\n  Continuing with Grok...\n`);
      }
    }
    // Grok OAuth
    console.log("  Running Grok OAuth login...\n");
    try {
      runSelf(["grok", "login"]);
    } catch {
      console.log("\n  Grok login failed. You can retry with 'ima2 grok login'.\n");
    }
    console.log("  Both providers configured.\n");
  } else {
    // Default: GPT OAuth (choice 1 or anything else)
    config.provider = "oauth";
    config.oauth = config.oauth || {};
    config.oauth.disableAutoStart = false;
    delete config.apiKey;
    saveConfig(config);
    console.log("\n  Starting GPT OAuth login...\n");

    // Setup reuses an ima2 session it already has; 'ima2 login' always signs in again.
    const existing = resolveChatgptSession();
    const reuse = existing?.source === "ima2" && existing.refreshable;
    if (!reuse) {
      console.log("  Signing in with your ChatGPT account — follow the browser prompt.\n");
      try {
        await runGptLogin();
      } catch (e) {
        console.log(`\n  Login failed: ${(e as Error).message}`);
        console.log("  Retry with 'ima2 login' (or 'ima2 login --device' on a headless machine).\n");
        rl.close();
        exitFlushed(1);
      }
    } else {
      console.log(`  Existing GPT OAuth session found (${existing.email ?? existing.path}).\n`);
    }

    saveConfig(config);
    console.log("  GPT OAuth configured. Starting server...\n");
  }

  rl.close();
  return config;
}

async function serve(serveArgs: string[] = []) {
  // Singleton guard: one ima2 server per machine unless --force is given.
  // Probes the advertise file + default port only (IMA2_SERVER may point at a
  // remote server and must not block starting a local one).
  if (!serveArgs.includes("--force")) {
    try {
      const { findRunningServer } = await import("./lib/client.js");
      const running = await findRunningServer({ includeEnv: false });
      if (running?.health?.ok) {
        const pid = running.health.pid ?? "?";
        const version = running.health.version ?? "?";
        console.log(`\n  ima2 server already running at ${running.base} (pid ${pid}, v${version}).`);
        console.log("  Open it with 'ima2 open', or stop that process to restart.");
        console.log("  To intentionally run a second instance: ima2 serve --force\n");
        return;
      }
    } catch (e) {
      const err = errInfo(e);
      console.error(`[ima2] Running-server check skipped: ${err.message || err.raw}`);
    }
  }

  try {
    await maybePromptGithubStar();
  } catch (e) {
    const err = errInfo(e);
    console.error(`[ima2] Star prompt skipped: ${err.message || err.raw}`);
  }

  let config = loadConfig();

  if (!config.provider) {
    config = await setup();
  }

  const uiDist = ensureFreshUiDist(ROOT);
  if (!uiDist.ok) {
    console.log(`\n  ${uiDist.error}`);
    console.log(
      uiDist.reason === "missing-source-and-dist"
        ? "  This installation appears broken. Reinstall: npm i -g ima2-gen\n"
        : "",
    );
    exitFlushed(1);
  }

  const env = { ...process.env };
  const serveDev = serveArgs.includes("--dev");
  if (serveDev) {
    env.IMA2_DEV = "1";
    env.IMA2_LOG_LEVEL = env.IMA2_LOG_LEVEL || "debug";
  }

  if (config.provider === "api" && config.apiKey) {
    env.OPENAI_API_KEY = config.apiKey;
  }

  const serverPath = join(ROOT, "server.js");
  const child = spawn(process.execPath, [serverPath], {
    stdio: "inherit",
    env,
    cwd: ROOT,
  });

  child.on("error", (err) => {
    console.error(`[ima2] Failed to start server: ${err.message}`);
    exitFlushed(1);
  });
  child.on("exit", (code) => exitFlushed(code ?? 0));

  process.on("SIGINT", () => killProcessTree(child.pid));
  process.on("SIGTERM", () => killProcessTree(child.pid));
  if (process.platform === "win32") {
    process.on("SIGBREAK", () => killProcessTree(child.pid));
  }
}

async function showStatus() {
  const config = loadConfig();
  console.log(`\n  ${pkg.name} v${pkg.version}\n`);
  console.log(`  Config file: ${CONFIG_FILE}`);
  console.log(`  Exists: ${existsSync(CONFIG_FILE) ? "yes" : "no"}\n`);
  console.log(`  Generated dir: ${runtimeConfig.storage.generatedDir}`);
  console.log(`  Advertised server: ${advertisedServerUrl() || "none"}`);
  const { collectRuntimeStatus, describeRuntime } = await import("./commands/runtimeStatus.js");
  console.log(`  Runtime: ${describeRuntime(await collectRuntimeStatus())} (details: ima2 status --runtime)\n`);

  if (config.provider) {
    console.log(`  Provider: ${config.provider}`);
    if (config.provider === "api") {
      const key = config.apiKey || "";
      console.log(`  API Key: ${key ? key.slice(0, 8) + "..." + key.slice(-4) : "not set"}`);
    }
    console.log("");
  } else {
    console.log("  Status: not configured");
    console.log("  Run 'ima2 setup' to configure.\n");
  }

  const report = await buildAuthReport();
  console.log("  Logins");
  const { authStatusLines } = await import("./commands/gpt.js");
  for (const line of authStatusLines("GPT OAuth (ChatGPT)", report.gpt, report.gptFile, "      ")) console.log(`    ${line}`);
  if (report.keyringOnly) {
    console.log("      Codex CLI is signed in through the OS keyring only; the GPT OAuth proxy cannot read that.");
  }
  for (const line of authStatusLines("Grok OAuth (xAI)", report.grok, undefined, "      ")) console.log(`    ${line}`);
  console.log("");
  if (report.server) {
    const proxy = report.server.proxy ?? "unknown";
    const mark = proxy === "ready" ? "✓" : proxy === "starting" ? "…" : "✗";
    console.log(`  Server ${report.server.url}: GPT OAuth proxy ${mark} ${proxy}`);
  } else {
    console.log("  Server: not running (start it with 'ima2 serve')");
  }
  console.log("");
}

/**
 * Auth verdicts for `ima2 status`. When a server is advertised, its live proxy verdict is
 * folded in: a session file can look fine while ChatGPT has already revoked it.
 */
async function buildAuthReport() {
  const { gptAuthStatus, grokAuthStatus } = await import("../lib/authStatus.js");
  const { resolveChatgptSession } = await import("../lib/chatgptAuth.js");
  const session = resolveChatgptSession();
  let server: { url: string; proxy?: "ready" | "auth_required" | "starting" | "offline" } | null = null;
  const url = advertisedServerUrl();
  if (url) {
    try {
      const res = await fetch(`${url}/api/oauth/status`, { signal: AbortSignal.timeout(2500) });
      const body = await res.json() as { status?: string };
      const proxy = body.status;
      server = proxy === "ready" || proxy === "auth_required" || proxy === "starting" || proxy === "offline"
        ? { url, proxy }
        : { url };
    } catch {
      server = null;
    }
  }
  const gpt = gptAuthStatus(session, server?.proxy ? { proxyStatus: server.proxy } : {});
  const keyringOnly = !session && detectCodexAuth().probe === "authed";
  return { gpt, gptFile: session?.path, grok: grokAuthStatus(), keyringOnly, server };
}

function openBrowser() {
  const url = advertisedServerUrl() || `http://localhost:${runtimeConfig.server.port}`;
  const res = openUrl(url);
  if (res.ok) {
    console.log(`\n  Opening ${url} ...\n`);
  } else {
    console.log(`\n  Could not open browser. Visit: ${url}\n`);
  }
}

function showHelp() {
  console.log(renderHelp(pkg));
}

// ── CLI ──
const args = process.argv.slice(2);
const command = args[0];

if (args.includes("-v") || args.includes("--version")) {
  console.log(pkg.version);
  exitFlushed(0);
}

const helpOwningCommands = ["doctor", "gen", "video", "edit", "vectorize", "ls", "show", "ps", "cancel", "session", "history", "prompt", "multimode", "node", "annotate", "canvas-versions", "metadata", "comfy", "cardnews", "inflight", "storage", "billing", "providers", "oauth", "grok", "gpt", "login", "config", "defaults", "models", "capabilities", "tools", "skill", "ping", "backfill-thumbs", "service", "start", "restart", "stop", "logs"];
if (!command) {
  showHelp();
  exitFlushed(1);
}
if ((args.includes("-h") || args.includes("--help")) && !helpOwningCommands.includes(command)) {
  showHelp();
  exitFlushed(0);
}

switch (command) {
  case "serve":
    if (args.includes("--background")) {
      const { runRuntimeCommand } = await import("./commands/runtimeCommands.js");
      await runRuntimeCommand("start", args.slice(1).filter((a) => a !== "--background"));
      exitFlushed(Number(process.exitCode ?? 0));
    }
    void serve(args.slice(1));
    break;
  case "start":
  case "restart":
  case "logs":
  case "stop":
  case "service": {
    const { runRuntimeCommand } = await import("./commands/runtimeCommands.js");
    await runRuntimeCommand(command, args.slice(1));
    exitFlushed(Number(process.exitCode ?? 0));
    break;
  }
  case "login": {
    // 'ima2 login' signs in to ChatGPT now; it no longer rewrites the provider config.
    const { default: gptCmd } = await import("./commands/gpt.js");
    await gptCmd(["login", ...args.slice(1)]);
    break;
  }
  case "setup":
    setup().then(() => console.log("  Done. Run 'ima2 serve' to start.")).catch((e) => {
      console.error(`Setup failed: ${e?.message || e}`);
      exitFlushed(1);
    });
    break;
  case "status":
    if (args.includes("--runtime")) {
      const { runtimeStatus } = await import("./commands/runtimeStatus.js");
      await runtimeStatus(args.slice(1).filter((a) => a !== "--runtime"));
      exitFlushed(Number(process.exitCode ?? 0));
    } else if (args.includes("--json")) {
      const report = await buildAuthReport();
      console.log(JSON.stringify({ version: pkg.version, provider: loadConfig().provider ?? null, ...report }, null, 2));
    } else {
      await showStatus();
    }
    break;
  case "doctor":
    await doctor(args.slice(1));
    break;
  case "open":
    openBrowser();
    break;
  case "reset":
    if (existsSync(CONFIG_FILE)) {
      try {
        const yes = args.includes("--yes") || args.includes("-y");
        const confirmed = await confirmDestructiveAction("Reset all ima2 config?", yes);
        if (!confirmed) {
          console.log("  Aborted.");
          break;
        }
      } catch (err) {
        console.error(`  ${err instanceof Error ? err.message : String(err)}`);
        exitFlushed(2);
      }
      writeFileSync(CONFIG_FILE, "{}");
      console.log("  Config reset. Run 'ima2 serve' to reconfigure.");
    } else {
      console.log("  No config to reset.");
    }
    break;
  case "gen":
  case "video":
  case "upscale":
  case "edit":
  case "vectorize":
  case "ls":
  case "show":
  case "ps":
  case "cancel":
  case "session":
  case "history":
  case "prompt":
  case "multimode":
  case "node":
  case "annotate":
  case "canvas-versions":
  case "metadata":
  case "comfy":
  case "cardnews":
  case "config":
  case "defaults":
  case "models":
  case "capabilities":
  case "tools":
  case "skill":
  case "grok":
  case "gpt":
  case "ping": {
    const { setCliVersion } = await import("./lib/client.js");
    setCliVersion(pkg.version);
    const mod = await import(`./commands/${command}.js`);
    await mod.default(args.slice(1));
    break;
  }
  case "backfill-thumbs": {
    const { backfillThumbs } = await import("./commands/backfillThumbs.js");
    try {
      const result = await backfillThumbs(args.slice(1));
      if (result && result.failed > 0) process.exitCode = 1;
    } catch {
      process.exitCode = 1;
    }
    break;
  }
  case "storage":
  case "billing":
  case "providers":
  case "oauth":
  case "inflight": {
    const { setCliVersion } = await import("./lib/client.js");
    setCliVersion(pkg.version);
    const mod = await import("./commands/observability.js");
    await mod.default([command, ...args.slice(1)]);
    break;
  }
  default:
    console.log(`  Unknown command: "${command}"`);
    console.log("  Run 'ima2 --help' for usage.\n");
    exitFlushed(1);
}
