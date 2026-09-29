import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopRuntime, type StopOptions } from "../bin/lib/stopRuntime.ts";
import type { ManagerState } from "../bin/lib/serviceManager.ts";
import { STOP_SCHEMA } from "../bin/lib/runtimeReport.ts";

// devlog/_plan/260929_background_runtime/020: ima2 stop --json is the contract
// the desktop takeover consumes. A real child process stands in for the server
// so pid liveness is real; HTTP is faked so nothing listens on a port.

interface Fixture { child: ChildProcess; pid: number; dir: string; file: string; calls: string[] }

async function fixture(entry: Record<string, unknown> = {}): Promise<Fixture> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise((r) => child.once("spawn", r));
  const dir = mkdtempSync(join(tmpdir(), "ima2-stop-json-"));
  const file = join(dir, "server.json");
  writeFileSync(file, JSON.stringify({ pid: child.pid, url: "http://127.0.0.1:1", adminNonce: "nonce", startedAt: 111, ...entry }));
  return { child, pid: child.pid!, dir, file, calls: [] };
}

function refused(): never {
  throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
}

/** /api/health answers as the fixture; /api/admin/stop kills it (the server's own teardown). */
function fakeServer(f: Fixture, health: Record<string, unknown> = {}): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    f.calls.push(url.replace("http://127.0.0.1:1", ""));
    if (f.child.exitCode !== null || f.child.signalCode !== null) refused();
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, pid: f.pid, startedAt: 111, ...health }));
    if (url.endsWith("/api/admin/stop")) {
      f.child.kill("SIGKILL");
      return new Response("{}", { status: 202 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const absent = (): ManagerState => ({ state: "absent" });

async function run(f: Fixture, opts: Partial<StopOptions> = {}, health: Record<string, unknown> = {}) {
  return stopRuntime({ advertiseFile: f.file, fetchFn: fakeServer(f, health), inspect: absent, gracefulWaitMs: 3000, stayDownMs: 50, ...opts });
}

async function done(f: Fixture): Promise<void> {
  if (f.child.exitCode === null && f.child.signalCode === null) f.child.kill("SIGKILL");
  rmSync(f.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test("no advertisement is an idempotent not-running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-stop-json-"));
  try {
    const report = await stopRuntime({ advertiseFile: join(dir, "server.json"), inspect: absent });
    assert.equal(report.schema, STOP_SCHEMA);
    assert.equal(report.outcome, "not-running");
    assert.equal(report.ok, true);
    assert.equal(report.runtimeDown, true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a verified server stops gracefully through the admin API", async () => {
  const f = await fixture({ launcher: "background" });
  try {
    const report = await run(f, {}, { launcher: "background" });
    assert.equal(report.outcome, "stopped");
    assert.equal(report.method, "graceful");
    assert.equal(report.launcher, "background");
    assert.ok(f.calls.includes("/api/admin/stop"));
  } finally {
    await done(f);
  }
});

test("a changed boot id refuses before anything is signalled", async () => {
  const f = await fixture();
  try {
    const report = await run(f, { expectPid: f.pid, expectBoot: "approved-boot" }, { bootId: "other-boot" });
    assert.equal(report.outcome, "refused");
    assert.equal(report.code, "identity-changed");
    assert.equal(report.ok, false);
    assert.ok(!f.calls.includes("/api/admin/stop"));
    assert.equal(f.child.exitCode, null, "the server is still running");
  } finally {
    await done(f);
  }
});

test("a pre-upgrade server without a boot id is approved by its start time", async () => {
  const f = await fixture();
  try {
    const report = await run(f, { expectPid: f.pid, expectStarted: 111 });
    assert.equal(report.outcome, "stopped");
  } finally {
    await done(f);
  }
});

test("a service-owned server is refused without --service, even without a launcher field", async () => {
  const f = await fixture();
  try {
    const managed = (): ManagerState => ({ state: "bound", kind: "launchd", pid: f.pid, active: true, configDir: null });
    const report = await run(f, { inspect: managed });
    assert.equal(report.outcome, "refused");
    assert.equal(report.code, "service-managed");
    assert.equal(f.child.exitCode, null);
  } finally {
    await done(f);
  }
});

test("--service stops the manager, not the process, and confirms the server stays down", async () => {
  const f = await fixture({ launcher: "service" });
  try {
    let managerStops = 0;
    const managed = (): ManagerState => ({ state: "bound", kind: "systemd", pid: f.pid, active: true, configDir: null });
    const stopManager = async () => { managerStops++; f.child.kill("SIGKILL"); return { ok: true, message: "Service stopped." }; };
    const report = await run(f, { inspect: managed, service: true, stopManager }, { launcher: "service" });
    assert.equal(report.outcome, "stopped");
    assert.equal(report.method, "service");
    assert.equal(managerStops, 1);
    assert.ok(!f.calls.includes("/api/admin/stop"));
  } finally {
    await done(f);
  }
});

test("an unanswerable service manager refuses instead of guessing", async () => {
  const f = await fixture();
  try {
    const report = await run(f, { inspect: () => ({ state: "unknown", reason: "launchctl failed" }) });
    assert.equal(report.code, "ownership-unknown");
    assert.equal(f.child.exitCode, null);
  } finally {
    await done(f);
  }
});

test("a desktop server beside a dormant service registration is not refused", async () => {
  const f = await fixture({ launcher: "desktop" });
  try {
    const dormant = (): ManagerState => ({ state: "bound", kind: "launchd", pid: null, active: false, configDir: null });
    const report = await run(f, { inspect: dormant }, { launcher: "desktop" });
    assert.equal(report.outcome, "stopped");
    assert.equal(report.launcher, "desktop");
  } finally {
    await done(f);
  }
});

test("another pid answering at the advertised address is refused, not reported as down", async () => {
  const f = await fixture();
  try {
    const report = await run(f, {}, { pid: 1 });
    assert.equal(report.outcome, "refused");
    assert.equal(report.code, "advertise-stale");
    assert.equal(report.runtimeDown, false);
    assert.equal(report.ok, false);
  } finally {
    await done(f);
  }
});

test("--force never overrides unknown service ownership", async () => {
  const f = await fixture();
  try {
    const report = await run(f, { force: true, inspect: () => ({ state: "unknown", reason: "launchctl failed" }) });
    assert.equal(report.code, "ownership-unknown");
    assert.equal(f.child.exitCode, null);
  } finally {
    await done(f);
  }
});

test("--service refuses a server the login service does not run", async () => {
  const f = await fixture({ launcher: "foreground" });
  try {
    const report = await run(f, { service: true }, { launcher: "foreground" });
    assert.equal(report.outcome, "refused");
    assert.equal(report.code, "not-service-managed");
    assert.ok(!f.calls.includes("/api/admin/stop"));
    assert.equal(f.child.exitCode, null);
  } finally {
    await done(f);
  }
});
