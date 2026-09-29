import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ima2-cli-unknown-"));
writeFileSync(join(root, "config.json"), "{}");
const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  // No provider transport exists. An old implementation can only fail this boundary.
  response.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"unexpected fixture request"}');
});
let base = "";
before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  assert.notEqual(address.port, 3333);
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(server.listening, false);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  assert.equal(existsSync(root), false);
});

async function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    HOME: root, USERPROFILE: root, IMA2_CONFIG_DIR: root, IMA2_DB_PATH: join(root, "test.db"),
    IMA2_GENERATED_DIR: join(root, "generated"), IMA2_LOG_LEVEL: "silent" };
  const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", ...args, "--server", base], { env });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.signal, null, "bounded CLI must close normally");
    return { ...result, stdout, stderr };
  } finally { clearTimeout(timer); }
}

for (const command of ["gen", "upscale"] as const) {
  for (const flag of ["--qa-unknown-flag", "-Z"]) {
    for (const input of [false, true]) {
      test(`${command} rejects ${flag} before ${input ? "server access" : "positional validation"}`, async () => {
        requests.length = 0;
        const args = [command, ...(input ? [command === "gen" ? "owned prompt" : "owned.png"] : []), flag];
        const result = await run(args);
        assert.equal(result.code, 2);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, new RegExp(`unknown option: ${flag}`));
        assert.deepEqual(requests, []);
      });
    }
  }
  test(`${command} help remains available before unknown-option validation`, async () => {
    requests.length = 0;
    const result = await run([command, "--help", "--qa-unknown-flag"]);
    assert.equal(result.code, 0); assert.match(result.stdout, /Options:/);
    assert.deepEqual(requests, []);
  });
}
