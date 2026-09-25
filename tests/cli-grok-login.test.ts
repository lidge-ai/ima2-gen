import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ima2-grok-login-"));
writeFileSync(join(root, "config.json"), "{}");

// A stand-in for a running ima2 server: healthy, hands out a switch session, then
// reports it gone. The login is expected to read that 404 as an expired login.
const server = createServer((req, response) => {
  if (req.method === "GET" && req.url === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    return;
  }
  if (req.method === "POST" && req.url === "/api/auth/switch") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ sessionId: "sw_gone", userCode: "ABCD-1234", verificationUrl: "https://x.ai/device", expiresIn: 60 }),
    );
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"unknown session"}');
});

let base = "";
before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  // Point server discovery at the stub through the advertise file.
  writeFileSync(join(root, "server.json"), JSON.stringify({ backend: { url: base } }));
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rmSync(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
});

test("ima2 grok login reports a reaped server session as expired, not HTTP 404", async () => {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    HOME: root, USERPROFILE: root, IMA2_CONFIG_DIR: root,
    IMA2_LOG_LEVEL: "silent",
  };
  const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", "grok", "login"], { env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

  assert.equal(code, 1, `expected exit 1, stdout: ${stdout}, stderr: ${stderr}`);
  assert.match(stderr, /expired before it was approved/);
  assert.doesNotMatch(stderr, /HTTP 404/);
});
