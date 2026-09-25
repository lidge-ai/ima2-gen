#!/usr/bin/env node
// Global update smoke: installs the packed tarball over a registry baseline and
// probes the installed CLI. Every subprocess has a deadline and a label so a
// stall fails fast and names its culprit (run 31605449399 hung 15 minutes with
// no per-child instrumentation — see devlog/_plan/260813_maturity_roadmap/020).
//
// Two execution mechanisms:
//   - sync calls (no grandchildren): spawnSync + timeout via commandOptions()
//   - tree-owning calls (grandchildren possible): scripts/subprocess-deadline.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { npmInvocation, spawnNpmSync } from "./npm-subprocess.mjs";
import { parsePackOutput } from "./release-artifact-contract.mjs";
import { runWithDeadline, deadlineError } from "./subprocess-deadline.mjs";

// Generous multiples of the observed success distribution (median 6:03,
// max 8:16 for the whole step). Tighten only after the step logging shows the
// real distribution. IMA2_SMOKE_TIMEOUT_MS overrides every deadline — that is
// how the timeout path is activation-tested.
export const DEADLINES = {
  "npm-version": 60_000,
  "npm-root": 60_000,
  "shim-version": 60_000,
  "baseline-install": 420_000,
  // Same work as baseline-install: a full global install of this package with
  // native builds. It had the smaller budget for no reason the distribution
  // supports, and a slow Windows runner hit exactly that gap at 300s while the
  // node 22 leg of the same run finished the step in 141s.
  "tarball-install": 420_000,
  "pack": 900_000,
  "codex-login-status": 120_000,
  "ima2-status": 120_000,
  "ima2-doctor": 120_000,
};

// Tree-owning steps (async runner) vs sync steps. The contract test pins this
// split: moving a tree-owning call back to sync re-opens the orphan defect.
export const ASYNC_LABELS = [
  "pack",
  "baseline-install",
  "tarball-install",
  "codex-login-status",
  "ima2-status",
  "ima2-doctor",
];
export const SYNC_LABELS = ["npm-version", "npm-root", "shim-version"];

// publish.yml supplies a prepacked tarball, so `pack` is not part of this path.
// Keep the sequence explicit: the workflow's outer timeout must be large enough
// for every labeled child deadline to fire and clean up first.
export const PREPACKED_CI_SEQUENCE = [
  "npm-version",
  "tarball-install",
  "npm-root",
  "npm-version",
  "baseline-install",
  "shim-version",
  "npm-version",
  "tarball-install",
  "npm-root",
  "codex-login-status",
  "ima2-status",
  "ima2-doctor",
  "shim-version",
];

export function minimumPrepackedWorkflowTimeoutMinutes() {
  const childBudgetMs = PREPACKED_CI_SEQUENCE.reduce((total, label) => total + DEADLINES[label], 0);
  const cleanupMarginMinutes = 1;
  return Math.ceil(childBudgetMs / 60_000) + cleanupMarginMinutes;
}

let deadlineTrace = null;

export function beginDeadlineTrace(expected) {
  assert.equal(deadlineTrace, null, "deadline trace already active");
  deadlineTrace = { expected: [...expected], index: 0 };
}

export function finishDeadlineTrace() {
  const trace = deadlineTrace;
  deadlineTrace = null;
  assert.ok(trace, "deadline trace is not active");
  assert.equal(trace.index, trace.expected.length, `deadline trace stopped before ${trace.expected[trace.index]}`);
}

function traceDeadline(label) {
  if (!deadlineTrace) return;
  const expected = deadlineTrace.expected[deadlineTrace.index];
  if (label !== expected) deadlineTrace = null;
  assert.equal(label, expected, `deadline trace expected ${expected || "end"}, got ${label}`);
  deadlineTrace.index += 1;
}

function deadlineFor(label) {
  traceDeadline(label);
  const override = Number(process.env.IMA2_SMOKE_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  const value = DEADLINES[label];
  if (!value) throw new Error(`no deadline configured for smoke step: ${label}`);
  return value;
}

export function commandOptions(options = {}) {
  return {
    encoding: "utf8",
    timeout: deadlineFor(options.label || "npm-version"),
    ...options,
    env: {
      ...process.env,
      npm_config_loglevel: "error",
      ...(options.env || {}),
    },
  };
}

function assertSuccess(result, label) {
  if (result && result.timedOut) throw deadlineError(result, label);
  assert.equal(
    result.status,
    0,
    `${label} failed\nerror:\n${result.error?.message || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
  );
  return result;
}

function logStart(label) {
  console.log(`[smoke] ${label} start`);
  return Date.now();
}

function logDone(label, started) {
  console.log(`[smoke] ${label} done ${Date.now() - started}ms`);
}

function runNpm(args, options = {}) {
  const label = options.label || `npm ${args.join(" ")}`;
  const started = logStart(label);
  const result = assertSuccess(spawnNpmSync(args, commandOptions(options)), label);
  logDone(label, started);
  return result;
}

async function runTreeOwned(command, args, options = {}) {
  const label = options.label || `${command} ${args.join(" ")}`;
  const result = await runWithDeadline(command, args, {
    ...options,
    label,
    deadlineMs: deadlineFor(label),
  });
  return assertSuccess(result, label);
}

function npmMajor() {
  return Number(runNpm(["--version"], { label: "npm-version" }).stdout.trim().split(".")[0]);
}

async function installGlobal(prefix, spec, label) {
  const args = ["install", "--global", "--prefix", prefix, spec];
  if (npmMajor() >= 12) args.push("--allow-scripts=ima2-gen,better-sqlite3,sharp");
  const invocation = npmInvocation(args);
  await runTreeOwned(invocation.command, invocation.args, { label });
}

async function candidateTarball(root) {
  if (process.env.IMA2_PACKAGE_TARBALL) {
    assert.equal(existsSync(process.env.IMA2_PACKAGE_TARBALL), true);
    return process.env.IMA2_PACKAGE_TARBALL;
  }
  const packDir = join(root, "pack");
  mkdirSync(packDir, { recursive: true });
  const invocation = npmInvocation(["pack", "--json", "--pack-destination", packDir]);
  const packed = await runTreeOwned(invocation.command, invocation.args, {
    label: "pack",
    cwd: process.cwd(),
  });
  return join(packDir, parsePackOutput(packed.stdout).filename);
}

function assertPackagedZod(prefix) {
  const globalRoot = runNpm(["root", "--global", "--prefix", prefix], { label: "npm-root" }).stdout.trim();
  const packageRoot = join(globalRoot, "ima2-gen");
  const installedRequire = createRequire(join(packageRoot, "package.json"));
  const zodRoot = realpathSync(join(packageRoot, "node_modules", "zod"));
  const zodV4Entry = realpathSync(installedRequire.resolve("zod/v4"));
  assert.ok(
    zodV4Entry.startsWith(`${zodRoot}${sep}`),
    `zod/v4 should resolve from the packaged ima2-gen tree: ${zodV4Entry}`,
  );
  return packageRoot;
}

function runGlobalShim(prefix, args, options = {}) {
  const shim = process.platform === "win32" ? join(prefix, "ima2.cmd") : join(prefix, "bin", "ima2");
  assert.equal(existsSync(shim), true, `global ima2 shim should exist: ${shim}`);
  return assertSuccess(
    spawnSync(
      shim,
      args,
      commandOptions({ label: "shim-version", ...options, shell: process.platform === "win32" }),
    ),
    `${shim} ${args.join(" ")}`,
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "ima2-global-update-"));
  const prefix = join(root, "prefix");
  const home = join(root, "home");
  const config = join(root, "config");
  const unrelatedCwd = join(root, "unrelated cwd");
  try {
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(config, { recursive: true });
    mkdirSync(unrelatedCwd, { recursive: true });
    writeFileSync(join(config, "config.json"), JSON.stringify({ provider: "oauth" }));

    const tarball = await candidateTarball(root);
    const tracesPrepackedPath = Boolean(process.env.IMA2_PACKAGE_TARBALL);
    if (tracesPrepackedPath) beginDeadlineTrace(PREPACKED_CI_SEQUENCE);
    const cleanPrefix = join(root, "clean-prefix");
    await installGlobal(cleanPrefix, tarball, "tarball-install");
    assertPackagedZod(cleanPrefix);

    const baseline = process.env.IMA2_UPDATE_BASELINE || "ima2-gen@latest";
    await installGlobal(prefix, baseline, "baseline-install");
    const baselineVersion = runGlobalShim(prefix, ["--version"], { cwd: unrelatedCwd }).stdout.trim();

    await installGlobal(prefix, tarball, "tarball-install");
    const packageRoot = assertPackagedZod(prefix);
    const cliPath = join(packageRoot, "bin", "ima2.js");
    const installed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const installedRequire = createRequire(join(packageRoot, "package.json"));
    const codexManifestPath = installedRequire.resolve("@openai/codex/package.json");
    const codexManifest = JSON.parse(readFileSync(codexManifestPath, "utf8"));
    const codexBin = join(dirname(codexManifestPath), codexManifest.bin.codex);

    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(home, ".codex"),
      IMA2_CONFIG_DIR: config,
      IMA2_GENERATED_DIR: join(root, "generated"),
      IMA2_DB_PATH: join(config, "sessions.db"),
      IMA2_ADVERTISE_FILE: join(config, "server.json"),
      PATH: "",
    };
    // login status exits 1 when logged out; that is the expected probe result,
    // so run it through the raw runner rather than the success-asserting one.
    const codexStatus = await runWithDeadline(process.execPath, [codexBin, "login", "status"], {
      label: "codex-login-status",
      deadlineMs: deadlineFor("codex-login-status"),
      cwd: unrelatedCwd,
      env,
    });
    if (codexStatus.timedOut) throw deadlineError(codexStatus, "codex-login-status");
    assert.equal(codexStatus.status, 1);
    assert.match(`${codexStatus.stdout}\n${codexStatus.stderr}`, /Not logged in/i);
    const status = await runTreeOwned(process.execPath, [cliPath, "status"], {
      label: "ima2-status",
      cwd: unrelatedCwd,
      env,
    });
    assert.doesNotMatch(status.stdout, /codex CLI not found/i);
    assert.match(status.stdout, /not logged in/i);
    const doctor = await runWithDeadline(process.execPath, [cliPath, "doctor"], {
      label: "ima2-doctor",
      deadlineMs: deadlineFor("ima2-doctor"),
      cwd: unrelatedCwd,
      env,
    });
    if (doctor.timedOut) throw deadlineError(doctor, "ima2-doctor");
    assert.equal(doctor.status, 1, "doctor should fail when OAuth is configured without a file-backed session");
    assert.match(doctor.stdout, /runtime dependencies resolvable/i);
    assert.match(doctor.stdout, /GPT OAuth has no ChatGPT session; run 'ima2 login'/);

    const updatedVersion = runGlobalShim(prefix, ["--version"], { cwd: unrelatedCwd }).stdout.trim();
    assert.equal(updatedVersion, installed.version);
    if (tracesPrepackedPath) finishDeadlineTrace();
    console.log(JSON.stringify({ baselineVersion, updatedVersion, packageRoot, oauthProbe: "unauthed" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const invokedAsScript = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
