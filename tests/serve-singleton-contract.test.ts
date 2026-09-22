import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findRunningServer } from "../bin/lib/client.js";

function listen(handler: (req: unknown, res: import("node:http").ServerResponse) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

test("ima2 serve refuses a duplicate instance unless --force", () => {
  const src = readFileSync(join(process.cwd(), "bin", "ima2.ts"), "utf8");
  const serveBody = src.slice(src.indexOf("async function serve("));
  const guardAt = serveBody.indexOf("findRunningServer");
  const spawnAt = serveBody.indexOf("spawn(");
  assert.ok(guardAt > -1, "serve() must probe for a running server");
  assert.ok(spawnAt > -1 && guardAt < spawnAt, "guard must run before the server spawn");
  assert.match(serveBody, /--force/, "serve() must offer a --force escape hatch");
  assert.match(serveBody, /includeEnv:\s*false/, "guard must ignore IMA2_SERVER (may be remote)");
});

test("findRunningServer resolves a live advertised server", async () => {
  const live = await listen((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, pid: 4242, version: "test" }));
  });
  const home = mkdtempSync(join(tmpdir(), "ima2-singleton-"));
  const advertiseFile = join(home, "server.json");
  writeFileSync(advertiseFile, JSON.stringify({ port: live.port, url: `http://127.0.0.1:${live.port}` }));
  const prev = process.env.IMA2_ADVERTISE_FILE;
  process.env.IMA2_ADVERTISE_FILE = advertiseFile;
  try {
    const found = await findRunningServer({ includeEnv: false });
    assert.ok(found, "should find the advertised server");
    assert.equal(found?.health.pid, 4242);
  } finally {
    if (prev === undefined) delete process.env.IMA2_ADVERTISE_FILE;
    else process.env.IMA2_ADVERTISE_FILE = prev;
    live.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("findRunningServer skips a dead advertised candidate", async () => {
  const home = mkdtempSync(join(tmpdir(), "ima2-singleton-"));
  const advertiseFile = join(home, "server.json");
  writeFileSync(advertiseFile, JSON.stringify({ port: 1, url: "http://127.0.0.1:1" }));
  const prev = process.env.IMA2_ADVERTISE_FILE;
  process.env.IMA2_ADVERTISE_FILE = advertiseFile;
  try {
    // Default-port probe may still hit a developer's live server, so only
    // assert the dead advertised candidate is never returned.
    //
    // That live server may also be bound past loopback and asking for a token
    // (npm run serve:tailscale). Discovery deliberately carries no token - the
    // CLI binds one only to a server named explicitly - so the probe comes back
    // 401. That is the environment answering, not the thing under test.
    let found: Awaited<ReturnType<typeof findRunningServer>> = null;
    try {
      found = await findRunningServer({ includeEnv: false });
    } catch (e) {
      const ma = (e as { code?: string }).code;
      assert.ok(
        ma === "LAN_TOKEN_REQUIRED" || ma === "SERVER_ACCESS_DENIED",
        `probe hong vi ly do khac: ${String(ma)}`,
      );
    }
    if (found) assert.notEqual(found.base, "http://127.0.0.1:1");
  } finally {
    if (prev === undefined) delete process.env.IMA2_ADVERTISE_FILE;
    else process.env.IMA2_ADVERTISE_FILE = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
