import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// devlog/_plan/260929_background_runtime/020: the real server publishes its
// launcher, boot id and root, and a pinned port that is taken ends the boot
// with one clear line instead of a hop.

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => resolve(server));
  });
}

function serverEnv(port: number, home: string, generated: string, extra: Record<string, string>) {
  return { ...process.env, IMA2_PORT: String(port), IMA2_HOST: "127.0.0.1", IMA2_CONFIG_DIR: home, IMA2_GENERATED_DIR: generated, IMA2_NO_OAUTH_PROXY: "1", ...extra };
}

test("a strict port that is busy exits 1 with the strict-port line", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows GitHub runners do not reliably hold the probe port for the spawned server");
    return;
  }
  const port = 5100 + Math.floor(Math.random() * 300);
  const blocker = await occupy(port);
  const home = mkdtempSync(join(tmpdir(), "ima2-strict-"));
  const generated = mkdtempSync(join(tmpdir(), "ima2-strict-gen-"));
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: serverEnv(port, home, generated, { IMA2_STRICT_PORT: "1" }) });
    let stderr = "";
    child.stderr.on("data", (b) => { stderr += String(b); });
    const code = await new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
    assert.equal(code, 1);
    assert.match(stderr, new RegExp(`strict port ${port} busy`));
    assert.ok(!existsSync(join(home, "server.json")), "nothing was advertised");
  } finally {
    await new Promise((r) => blocker.close(() => r(null)));
    rmSync(home, { recursive: true, force: true });
    rmSync(generated, { recursive: true, force: true });
  }
});

test("the server advertises and reports launcher, boot id and root", async () => {
  const port = 5400 + Math.floor(Math.random() * 300);
  const home = mkdtempSync(join(tmpdir(), "ima2-identity-"));
  const generated = mkdtempSync(join(tmpdir(), "ima2-identity-gen-"));
  const bootId = randomUUID();
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: serverEnv(port, home, generated, { IMA2_LAUNCHER: "background", IMA2_BOOT_ID: bootId }) });
  try {
    const file = join(home, "server.json");
    const deadline = Date.now() + 20_000;
    let entry: Record<string, unknown> | null = null;
    while (Date.now() < deadline && !entry) {
      try { if (existsSync(file)) entry = JSON.parse(readFileSync(file, "utf-8")); } catch { /* being replaced */ }
      if (!entry) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(entry, "advertise file appeared");
    assert.equal(entry!.bootId, bootId);
    assert.equal(entry!.launcher, "background");
    assert.equal(entry!.root, process.cwd());
    const health = await (await fetch(`${String(entry!.url)}/api/health`)).json() as Record<string, unknown>;
    assert.equal(health.bootId, bootId);
    assert.equal(health.launcher, "background");
    assert.equal(health.pid, child.pid);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(home, { recursive: true, force: true });
    rmSync(generated, { recursive: true, force: true });
  }
});
