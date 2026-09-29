import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeHealth, spawnDetached } from "../bin/lib/runtime.ts";

// devlog/_plan/260929_background_runtime/000 G4: the detached spawn must write
// its output to the log, report the pid the health check sees, and not keep
// the parent's log handle open. Runs on every CI platform, Windows included.

const STUB = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const server = createServer((req, res) => {
  if (req.url !== "/api/health") { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, pid: process.pid, bootId: process.env.IMA2_BOOT_ID }));
});
server.listen(0, "127.0.0.1", () => {
  console.log("stub listening");
  writeFileSync(process.env.STUB_PORT_FILE, String(server.address().port));
});
`;

test("spawnDetached runs a child that logs to the file and answers health", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-spawn-"));
  const stub = join(dir, "stub.mjs");
  const log = join(dir, "server.log");
  const portFile = join(dir, "port");
  writeFileSync(stub, STUB);
  const bootId = randomUUID();
  const fd = openSync(log, "a");
  const child = spawnDetached(process.execPath, [stub], { cwd: dir, env: { ...process.env, IMA2_BOOT_ID: bootId, STUB_PORT_FILE: portFile }, logFd: fd });
  try {
    const deadline = Date.now() + 15_000;
    while (!existsSync(portFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const port = Number(readFileSync(portFile, "utf-8"));
    const probe = await probeHealth(`http://127.0.0.1:${port}`, fetch, 3000);
    assert.equal(probe.kind, "ima2");
    if (probe.kind === "ima2") {
      assert.equal(probe.health.pid, child.pid);
      assert.equal(probe.health.bootId, bootId);
    }
    while (!readFileSync(log, "utf-8").includes("stub listening") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.match(readFileSync(log, "utf-8"), /stub listening/);
  } finally {
    try { process.kill(child.pid!); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 200));
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
