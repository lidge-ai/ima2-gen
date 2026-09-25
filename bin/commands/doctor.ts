import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildHardeningDoctorLines, type DoctorCheckLine } from "../lib/doctor-checks.js";
import { buildStorageDoctorLines } from "../lib/storage-doctor.js";
import { detectCodexAuth } from "../../lib/codexDetect.js";
import { gptAuthStatus } from "../../lib/authStatus.js";
import { runImageDoctorProbe } from "../../lib/responsesDoctor.js";
import { config as runtimeConfig } from "../../config.js";
import { exitFlushed } from "../lib/output.js";
import { buildProviderDoctorLines, verifyConfiguredKeys } from "../lib/doctor-providers.js";
import { buildMediaDoctorLines } from "../lib/doctor-media.js";
import { buildDoctorBundle } from "../lib/doctor-bundle.js";
import { buildDoctorReport, renderDoctorReport } from "../lib/doctor-report.js";
import { buildInstallationDoctorLines, checkNodeEngine, missingRuntimeDeps, probeDoctorRuntime } from "../lib/doctor-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CONFIG_FILE = runtimeConfig.storage.configFile;
const LEGACY_CONFIG_FILE = join(ROOT, ".ima2", "config.json");

let pkg: { version: string; name: string; engines?: { node?: unknown } } = { version: "?", name: "ima2-gen" };
try {
  const metadata = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  if (metadata && typeof metadata.version === "string" && typeof metadata.name === "string") pkg = metadata;
} catch {}

function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  if (existsSync(LEGACY_CONFIG_FILE)) {
    try { return JSON.parse(readFileSync(LEGACY_CONFIG_FILE, "utf-8")); } catch {}
  }
  return {};
}

function valueAfter(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value || null;
}

function showImageProbeHelp() {
  console.log(`
  Usage: ima2 doctor image-probe [options]

  Runs live, sanitized Responses probes for EMPTY_RESPONSE diagnosis.
  The output never includes prompt text, auth tokens, URLs with credentials, or base64 image data.

  Options:
    --json                 Emit machine-readable JSON
    --matrix               Add current-payload web_search/tool_choice probes
    --provider <api|oauth> Override configured provider
    --model <model>        Override image-capable Responses model
    --size <size>          Default: 1024x1024
    --quality <quality>    Default: low
    --moderation <value>   Default: low
    --prompt <text>        Override built-in cat prompt
    --oauth-url <url>      Override GPT OAuth proxy URL
    --timeout-ms <ms>      Per-probe timeout
`);
}

export function showDoctorHelp() {
  console.log(`
  Usage: ima2 doctor [image-probe] [options]

  Diagnose environment, storage, dependencies, and authentication.
  --json                 Emit one machine-readable diagnostic report
  --bundle               Emit a safe compatibility bundle (--json for JSON only)
  --installation         Offline installation checks; no account/config reads
  --verify-keys          Explicit non-generating remote authentication checks
  --runtime <origin>     Explicit loopback health/version check; no credentials
  Installation mode cannot combine with bundle, verify-keys or runtime.
  image-probe performs live billed generation; ordinary doctor never runs it.
  Run 'ima2 doctor image-probe --help' for live image probe options.
`);
}

async function imageProbe(args: string[]) {
  if (args.includes("-h") || args.includes("--help")) {
    showImageProbeHelp();
    return;
  }
  console.error("Warning: ima2 doctor image-probe performs live billed image generation.");
  const fileConfig = loadConfig();
  const result = await runImageDoctorProbe({
    provider: valueAfter(args, "--provider") || fileConfig.provider || "oauth",
    apiKey: typeof fileConfig.apiKey === "string" ? fileConfig.apiKey : undefined,
    oauthUrl: valueAfter(args, "--oauth-url") || undefined,
    model: valueAfter(args, "--model") || runtimeConfig.imageModels?.default || "gpt-6-luna",
    size: valueAfter(args, "--size") || "1024x1024",
    quality: valueAfter(args, "--quality") || "low",
    moderation: valueAfter(args, "--moderation") || "low",
    prompt: valueAfter(args, "--prompt") || undefined,
    matrix: args.includes("--matrix"),
    timeoutMs: Number(valueAfter(args, "--timeout-ms")) || undefined,
    ctx: { config: runtimeConfig },
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    exitFlushed(result.summary.ok ? 0 : 1);
  }
  console.log(`\n  ${pkg.name} v${pkg.version} — Image Probe\n`);
  console.log(`  Provider: ${result.provider}`);
  console.log(`  Model: ${result.model}`);
  console.log(`  Prompt: ${result.promptId} (${result.promptChars} chars, redacted)`);
  for (const probe of result.probes) {
    const mark = probe.ok ? "✓" : "✗";
    const reason = probe.diagnosticReason ? ` — ${probe.diagnosticReason}` : "";
    console.log(`  ${mark} ${probe.id}${reason}`);
    console.log(
      `      status=${probe.response.httpStatus ?? "n/a"} events=${probe.response.eventCount} images=${probe.response.imageResultCount} textChars=${probe.response.textOutputChars}`,
    );
  }
  console.log(`\n  ${result.summary.passed} passed, ${result.summary.failed} failed\n`);
  exitFlushed(result.summary.ok ? 0 : 1);
}

async function standardDoctor(args: string[] = []) {
  console.log(`\n  ${pkg.name} v${pkg.version} — Doctor\n`);

  let ok = 0;
  let fail = 0;

  const node = checkNodeEngine(process.version, pkg.engines?.node);
  console.log(`  ${node.kind === "pass" ? "✓" : "✗"} ${node.text}`);
  if (node.kind === "pass") ok++; else fail++;

  if (existsSync(join(ROOT, "package.json"))) {
    console.log("  ✓ package.json found");
    ok++;
  } else {
    console.log("  ✗ package.json missing");
    fail++;
  }

  const missingDeps = missingRuntimeDeps(ROOT);
  if (missingDeps.length === 0) {
    console.log("  ✓ runtime dependencies resolvable");
    ok++;
  } else {
    console.log(`  ✗ missing runtime dependencies: ${missingDeps.join(", ")}`);
    fail++;
  }

  if (existsSync(join(ROOT, ".env"))) {
    console.log("  ✓ .env file exists");
    ok++;
  } else {
    console.log("  ⚠ .env file not found (optional — copy from .env.example)");
  }

  const fileConfig = loadConfig();
  if (fileConfig.provider) {
    console.log(`  ✓ Configured: ${fileConfig.provider}`);
    ok++;
  } else {
    console.log("  ⚠ Not configured — run 'ima2 setup'");
  }

  const advPath = runtimeConfig.storage.advertiseFile;
  const adv = existsSync(advPath) ? JSON.parse(readFileSync(advPath, "utf-8")) : null;
  console.log(`  ℹ Preferred backend port: ${runtimeConfig.server.port}`);
  if (adv?.backend || adv?.port) {
    console.log(`  ℹ Backend actual URL: ${adv?.backend?.url || adv?.url || `http://localhost:${adv.port}`}`);
    if (adv?.oauth) console.log(`  ℹ GPT OAuth actual URL: ${adv.oauth.url} (${adv.oauth.status || "unknown"})`);
  }

  const hardeningLines = await buildHardeningDoctorLines({
    root: ROOT,
    configFile: CONFIG_FILE,
    fileConfig,
  });
  for (const line of hardeningLines) {
    const prefix =
      line.kind === "pass" ? "✓"
      : line.kind === "fail" ? "✗"
      : line.kind === "warn" ? "⚠"
      : "ℹ";
    console.log(`  ${prefix} ${line.text}`);
    if (line.kind === "pass") ok++;
    if (line.kind === "fail") fail++;
  }

  const storageLines = await buildStorageDoctorLines({
    rootDir: ROOT,
    config: runtimeConfig,
  });
  console.log("");
  for (const line of storageLines) console.log(line);

  const gpt = gptAuthStatus();
  if (fileConfig.provider === "oauth" && !gpt.loggedIn) {
    const keyringOnly = gpt.reason === "no_session" && detectCodexAuth().probe === "authed";
    console.log(
      keyringOnly
        ? "  ✗ Codex is keyring-authenticated, but GPT OAuth needs a session file; run 'ima2 login'"
        : `  ✗ GPT OAuth ${gpt.reason === "no_refresh_token" ? "session cannot refresh" : "has no ChatGPT session"}; run 'ima2 login'`,
    );
    fail++;
  } else if (gpt.loggedIn) {
    console.log(`  ${gpt.health === "warning" ? "⚠" : "✓"} GPT OAuth ChatGPT session ready (${gpt.source}${gpt.email ? `, ${gpt.email}` : ""})`);
    if (gpt.health === "warning") console.log("    Shared with the Codex CLI; run 'ima2 login' for an ima2-owned session");
    else ok++;
  }

  const providerLines = buildProviderDoctorLines(fileConfig as Record<string, unknown>);
  console.log("");
  console.log("  Providers");
  for (const line of providerLines) {
    const prefix = line.kind === "pass" ? "✓" : line.kind === "fail" ? "✗" : line.kind === "warn" ? "⚠" : "ℹ";
    console.log(`    ${prefix} ${line.text}`);
    if (line.kind === "pass") ok++;
    if (line.kind === "fail") fail++;
  }
  if (args.includes("--verify-keys")) {
    const verified = await verifyConfiguredKeys(fileConfig as Record<string, unknown>);
    for (const line of verified) {
      const prefix = line.kind === "pass" ? "✓" : "✗";
      console.log(`    ${prefix} ${line.text}`);
      if (line.kind === "pass") ok++;
      if (line.kind === "fail") fail++;
    }
  }
  const mediaLines = await buildMediaDoctorLines();
  for (const line of mediaLines) {
    const prefix = line.kind === "pass" ? "✓" : line.kind === "warn" ? "⚠" : "ℹ";
    console.log(`  ${prefix} ${line.text}`);
    if (line.kind === "pass") ok++;
  }
  if (args.includes("--bundle")) {
    const bundle = buildDoctorBundle({ version: pkg.version, providerLines });
    if (args.includes("--json")) {
      console.log(JSON.stringify(bundle, null, 2));
      exitFlushed(fail > 0 ? 1 : 0);
    }
    console.log("");
    console.log("  Bundle");
    console.log(`    ${JSON.stringify(bundle)}`);
  }
  console.log(`
  ${ok} passed, ${fail} failed
`);
  exitFlushed(fail > 0 ? 1 : 0);
}

export async function doctor(args: string[] = []) {
  if (args.includes("-h") || args.includes("--help")) {
    if (args[0] === "image-probe") showImageProbeHelp();
    else showDoctorHelp();
    return;
  }
  if (args[0] === "image-probe") {
    await imageProbe(args.slice(1));
    return;
  }
  if (!validDoctorArguments(args)) {
    console.error("Invalid doctor options; use ima2 doctor --help."); exitFlushed(2);
  }
  if (args.includes("--json") || args.includes("--bundle") || args.includes("--runtime") || args.includes("--installation")) {
    await machineDoctor(args); return;
  }
  await standardDoctor(args);
}

function validDoctorArguments(args: string[]): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg) || !["--json", "--bundle", "--installation", "--verify-keys", "--runtime"].includes(arg)) return false;
    seen.add(arg);
    if (arg === "--runtime" && (!args[++i] || args[i]!.startsWith("--"))) return false;
  }
  return !seen.has("--installation") || !["--bundle", "--verify-keys", "--runtime"].some((flag) => seen.has(flag));
}

function diagnosticConfig(lines: DoctorCheckLine[]): Record<string, unknown> {
  try {
    const path = existsSync(CONFIG_FILE) ? CONFIG_FILE : existsSync(LEGACY_CONFIG_FILE) ? LEGACY_CONFIG_FILE : null;
    const value: unknown = path ? JSON.parse(readFileSync(path, "utf8")) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("CONFIG_INVALID");
    return value as Record<string, unknown>;
  } catch { lines.push({ code: "CONFIG_INVALID", kind: "fail", text: "Configuration is not a JSON object" }); return {}; }
}

async function machineDoctor(args: string[]): Promise<void> {
  const installation = args.includes("--installation"), lines = buildInstallationDoctorLines(ROOT);
  let providerLines: ReturnType<typeof buildProviderDoctorLines> = [];
  try { if (!installation) {
    const fileConfig = diagnosticConfig(lines);
    lines.push({ code: fileConfig.provider ? "CONFIG_PRESENT" : "CONFIG_MISSING", kind: fileConfig.provider ? "info" : "warn", text: "Configuration selection" });
    try {
      if (existsSync(runtimeConfig.storage.advertiseFile)) {
        const value: unknown = JSON.parse(readFileSync(runtimeConfig.storage.advertiseFile, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid");
      }
    } catch { lines.push({ code: "ADVERTISEMENT_INVALID", kind: "warn", text: "Invalid server advertisement" }); }
    lines.push(...await buildHardeningDoctorLines({ root: ROOT, configFile: CONFIG_FILE, fileConfig, includeInstallationChecks: false }));
    providerLines = buildProviderDoctorLines(fileConfig); lines.push(...providerLines);
    if (args.includes("--verify-keys")) lines.push(...await verifyConfiguredKeys(fileConfig));
    lines.push(...await buildMediaDoctorLines());
    const url = valueAfter(args, "--runtime");
    if (url) lines.push(...await probeDoctorRuntime({ url, expectedVersion: pkg.version, timeoutMs: runtimeConfig.diagnostics.runtimeTimeoutMs }));
  } } catch { lines.push({ code: "DIAGNOSTIC_UNKNOWN", kind: "fail", text: "A diagnostic could not complete" }); }
  const report = buildDoctorReport({ version: pkg.version, mode: installation ? "installation" : "standard", lines });
  if (args.includes("--json")) console.log(JSON.stringify(args.includes("--bundle") ? buildDoctorBundle({ version: pkg.version, providerLines, report }) : report));
  else console.log(renderDoctorReport(report));
  exitFlushed(report.summary.exitCode);
}
