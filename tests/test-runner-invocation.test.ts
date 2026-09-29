import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { executionChildEnv } from "./_executionTestProcess.ts";

const runner = fileURLToPath(new URL("../scripts/run-tests.mjs", import.meta.url));
const modules = fileURLToPath(new URL("../node_modules", import.meta.url));
const marker = "WP05_CANONICAL_MODULE_MOCK_COMPLETE";
const passingProbe = `
import assert from "node:assert/strict";
import { mock, test } from "node:test";
test("actual canonical child activates native module mocks", () => {
  assert.equal(process.execArgv.filter(value => value === "--experimental-test-module-mocks").length, 1);
  assert.equal(process.env.NODE_OPTIONS, undefined);
  assert.equal(process.env.IMA2_GROK_API_KEY, undefined);
});
test("mock replaces the real dependency", async () => {
  const url = new URL("../probe-dependency.mjs", import.meta.url).href;
  const original = await import(url);
  assert.equal(original.value, 7);
  const handle = mock.module(url, { namedExports: { value: 42 } });
  try {
    assert.equal((await import(url)).value, 42);
    console.log("${marker}", process.version);
  } finally { handle.restore(); }
});
`;

async function invokeRunner(root: string) {
  const child = spawn(process.execPath, [runner], {
    cwd: root, env: executionChildEnv(), stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let output = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const stop = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { env: executionChildEnv(), timeout: 5_000 });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 15_000);
  try {
    const result = await closed;
    assert.equal(timedOut, false, output);
    assert.equal(result.signal, null, output);
    return { ...result, output };
  } finally {
    clearTimeout(timer);
    stop();
    await closed;
  }
}

async function withTinyDiscovery(probe: string, check: (result: Awaited<ReturnType<typeof invokeRunner>>) => void) {
  const root = await mkdtemp(join(tmpdir(), "ima2-runner-invocation-"));
  try {
    await mkdir(join(root, "tests"));
    await writeFile(join(root, "tests", "probe.test.mjs"), probe);
    await writeFile(join(root, "probe-dependency.mjs"), "export const value = 7;\n");
    await symlink(modules, join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    check(await invokeRunner(root));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("actual runner supplies exactly one native-mock flag without inherited execArgv", () =>
  withTinyDiscovery(passingProbe, ({ code, output }) => {
    assert.equal(code, 0, output);
    assert.ok(output.includes(`${marker} ${process.version}`), output);
  }));

test("actual runner propagates a deliberately failing tiny child as exit 1", () =>
  withTinyDiscovery('import assert from "node:assert/strict"; assert.equal(true, false, "WP05_EXPECTED_CHILD_FAILURE");', ({ code, output }) => {
    assert.equal(code, 1, output);
    assert.match(output, /WP05_EXPECTED_CHILD_FAILURE/);
    assert.ok(!output.includes(marker), output);
  }));
