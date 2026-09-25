import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function occupy(port) {
  return new Promise<any>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => resolve(server));
  });
}

async function assertPortOccupied(port) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (err: any) => {
      if (err?.code === "EADDRINUSE") resolve();
      else reject(err);
    });
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      probe.close(() => reject(new Error(`expected port ${port} to be occupied`)));
    });
  });
}

async function waitForAdvertise(path, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastInfo = null;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        lastInfo = JSON.parse(readFileSync(path, "utf-8"));
        if (predicate(lastInfo)) return lastInfo;
      } catch {
        // Another process may be replacing the advertisement; retry its final state.
      }
    }
    await new Promise<any>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`final server advertisement did not appear: ${JSON.stringify(lastInfo)}`);
}

test("server falls back when advertised localhost port is occupied", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows GitHub runners do not reliably hold the probe port for the spawned server");
    return;
  }
  const preferred = 4700 + Math.floor(Math.random() * 300);
  const blocker = await occupy(preferred);
  await assertPortOccupied(preferred);
  const home = mkdtempSync(join(tmpdir(), "ima2-server-fallback-"));
  const generated = mkdtempSync(join(tmpdir(), "ima2-server-fallback-generated-"));
  let child;
  try {
    child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        IMA2_PORT: String(preferred),
        IMA2_HOST: "127.0.0.1",
        IMA2_CONFIG_DIR: home,
        IMA2_GENERATED_DIR: generated,
        IMA2_NO_OAUTH_PROXY: "1",
      },
    });
    const advertisePath = join(home, "server.json");
    const info = await waitForAdvertise(
      advertisePath,
      (candidate) => candidate?.backend?.actualPort !== preferred,
    );
    assert.equal(info.backend.configuredPort, preferred);
    assert.notEqual(info.backend.actualPort, preferred, "should have fallen back to a different port");
    assert.ok(info.backend.actualPort > preferred, "fallback port should be higher than preferred");
    assert.equal(info.backend.url, `http://127.0.0.1:${info.backend.actualPort}`);
  } finally {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => child?.once("exit", resolve) || resolve());
    await new Promise<any>((resolve) => blocker.close(resolve));
    rmSync(home, { recursive: true, force: true });
    rmSync(generated, { recursive: true, force: true });
  }
});
