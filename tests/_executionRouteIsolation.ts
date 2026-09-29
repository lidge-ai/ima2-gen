import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { installGrokImageTransportFixture, type ImageTransportFixture } from "./_grokImageTransportFixture.ts";
import { isolateAdditionalNetwork } from "./_executionNetworkIsolation.ts";

export async function isolateExecution() {
  const rootDir = await realpath(await mkdtemp(join(tmpdir(), "ima2-execution-")));
  const saved = new Map<string, string | undefined>();
  const nativeFetch = globalThis.fetch;
  const restoreMocks: Array<() => void> = [];
  let imageTransport: ImageTransportFixture | undefined;
  let network: ReturnType<typeof isolateAdditionalNetwork> | undefined;
  const restore = async () => {
    // A timed-out pump retains every trap and its owned storage for a later drain.
    await imageTransport?.restore();
    network?.restore();
    globalThis.fetch = nativeFetch;
    for (const restoreMock of restoreMocks) restoreMock();
    syncBuiltinESMExports();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
  imageTransport = installGrokImageTransportFixture();
  const env = {
    IMA2_CONFIG_DIR: rootDir, IMA2_DB_PATH: join(rootDir, "test.db"),
    IMA2_GENERATED_DIR: join(rootDir, "generated"), IMA2_TRASH_DIR: join(rootDir, "trash"),
    IMA2_GENERATION_REQUEST_LOG_FILE: join(rootDir, "requests.json"),
    IMA2_LOG_LEVEL: "silent", DOTENV_CONFIG_PATH: join(rootDir, "empty.env"),
  };
  for (const key of new Set([...Object.keys(process.env).filter((k) => k.startsWith("IMA2_") || k === "DOTENV_CONFIG_PATH"), ...Object.keys(env)])) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, env);
  await writeFile(join(rootDir, "config.json"), "{}");
  await writeFile(join(rootDir, "empty.env"), "");
  const violations: unknown[] = [];
  network = isolateAdditionalNetwork(violations, nativeFetch);
  globalThis.fetch = async () => {
    const error = new Error("Network request outside active execution fixture");
    violations.push(error);
    throw error;
  };
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(childProcess, name);
    assert.ok(descriptor && typeof descriptor.value === "function", `Missing native process method: ${name}`);
    // Fresh functions must not retain native util.promisify.custom executors.
    const denied = () => {
      const error = new Error(`Provider process launch forbidden: ${name}`);
      violations.push(error);
      throw error;
    };
    Object.defineProperty(childProcess, name, { ...descriptor, value: denied });
    restoreMocks.push(() => Object.defineProperty(childProcess, name, descriptor));
  }
  syncBuiltinESMExports();
  return { rootDir, nativeFetch, fetchOwned: network.fetchOwned, violations, imageTransport, async close() {
    try {
      await imageTransport!.drain();
      assert.equal(violations.length, 0, `Isolation violations: ${violations.map(String).join("; ")}`);
      assert.deepEqual(imageTransport!.violations, [], "Image transport isolation violations");
    } finally {
      await restore();
    }
  } };
  } catch (error) { await restore(); throw error; }
}

export function assertOwned(root: string, path: string): void {
  const rel = relative(root, path);
  assert.ok(rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)), `Store escapes owned root: ${path}`);
}
