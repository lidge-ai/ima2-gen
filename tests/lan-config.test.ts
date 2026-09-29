import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build, stop } from "esbuild";

const repository = fileURLToPath(new URL("../", import.meta.url));
const SECRET = "synthetic-legacy-credential";

// Execute the actual config/command modules, not the application CLI bootstrap.
// import.meta.url points to the owned synthetic package; the child receives no
// inherited credentials and has no network/runtime/provider imports.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ima2-lan-config-"));
  const primary = join(root, "primary", "config.json"), legacy = join(root, ".ima2", "config.json");
  await mkdir(join(root, "primary")); await mkdir(join(root, ".ima2"));
  let source: string;
  try {
    const compiled = await build({
      stdin: { resolveDir: repository, contents: `
        import {config} from './config.ts';
        import configCommand from './bin/commands/config.ts';
        try {
          const action = JSON.parse(process.env.IMA2_TEST_CONFIG_ACTION || 'null');
          if (action) await configCommand(action);
          else console.log(JSON.stringify({origins:config.server.publicOrigins,security:config.security}));
        } catch(error) {
          if (error instanceof Error) { console.error(error.message); console.error(error.code || ''); process.exitCode=2; }
        }
      ` },
      bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
      external: ["readline/promises"],
      plugins: [{ name: "current-typescript", setup(builder) {
        builder.onResolve({ filter: /^\..*\.js$/ }, (args) => {
          const sourcePath = resolve(args.resolveDir, args.path).slice(0, -3) + ".ts";
          return sourcePath.startsWith(repository) && existsSync(sourcePath) ? { path: sourcePath } : undefined;
        });
      } }],
      define: { "import.meta.url": JSON.stringify(pathToFileURL(join(root, "config.js")).href) },
    });
    source = compiled.outputFiles[0].text;
  } catch (error) { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); throw error; }
  finally { stop(); }
  const run = (action: string[] | null = null, overrides: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { IMA2_CONFIG_DIR: join(root, "primary"),
      IMA2_TEST_CONFIG_ACTION: JSON.stringify(action), ...overrides };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return spawnSync(process.execPath, ["--input-type=module"], {
      input: source, cwd: root, env, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
    });
  };
  return { root, primary, legacy, run, close: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

test("LAN config: env/file/default chain and immutable security bounds", async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    assert.deepEqual(JSON.parse(f.run().stdout).origins, []);
    await writeFile(f.primary, JSON.stringify({ server: { publicOrigins: ["https://file.example/"] }, security: { lanMaxSessions: 1 } }));
    const file = JSON.parse(f.run().stdout);
    assert.deepEqual(file.origins, ["https://file.example"]);
    assert.equal(file.security.lanMaxSessions, 256);
    assert.equal(file.security.lanSessionTtlMs, 28_800_000);
    assert.deepEqual(JSON.parse(f.run(null, { IMA2_PUBLIC_ORIGINS: '["http://env.example:8080"]' }).stdout).origins, ["http://env.example:8080"]);
    const invalid = f.run(null, { IMA2_PUBLIC_ORIGINS: `["https://user:${SECRET}@host"]` });
    assert.equal(invalid.status, 2); assert.match(invalid.stderr, /INVALID_PUBLIC_ORIGINS/);
    assert.doesNotMatch(invalid.stdout + invalid.stderr, new RegExp(SECRET));
    await writeFile(f.primary, JSON.stringify({ server: { publicOrigins: null } }));
    assert.equal(f.run().status, 2, "an explicit non-array value cannot become the default");
  } finally { await f.close(); }
});

for (const placement of ["primary", "legacy", "legacy-over-invalid-primary"] as const) {
  test(`LAN config: ${placement} invalid-origin rm preserves settings and writes privately`, async () => {
    const f = await fixture();
    try {
      const data = { server: { publicOrigins: "invalid", port: 4321 }, apiKey: SECRET, log: { level: "warn" } };
      const source = placement === "primary" ? f.primary : f.legacy;
      await writeFile(source, JSON.stringify(data), { mode: 0o600 });
      if (placement === "legacy-over-invalid-primary") await writeFile(f.primary, "invalid JSON");
      if (placement !== "legacy" && process.platform !== "win32") await chmod(f.primary, 0o644);
      const before = f.run(); assert.equal(before.status, 2); assert.match(before.stderr, /INVALID_PUBLIC_ORIGINS/);
      const result = f.run(["rm", "server.publicOrigins", "--yes"]);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(SECRET));
      assert.deepEqual(JSON.parse(await readFile(f.primary, "utf8")), { server: { port: 4321 }, apiKey: SECRET, log: { level: "warn" } });
      if (placement !== "primary") assert.deepEqual(JSON.parse(await readFile(f.legacy, "utf8")), data);
      if (process.platform !== "win32") assert.equal((await stat(f.primary)).mode & 0o077, 0);
      const fresh = f.run(); assert.equal(fresh.status, 0, fresh.stderr);
      assert.deepEqual(JSON.parse(fresh.stdout).origins, []);
    } finally { await f.close(); }
  });
}

test("LAN config: set validates before save and never echoes a rejected env override", async () => {
  const f = await fixture();
  try {
    await writeFile(f.primary, JSON.stringify({ log: { level: "warn" } }));
    const invalid = f.run(["set", "server.publicOrigins", `["https://user:${SECRET}@host"]`, "--yes"]);
    assert.equal(invalid.status, 2); assert.doesNotMatch(invalid.stdout + invalid.stderr, new RegExp(SECRET));
    assert.deepEqual(JSON.parse(await readFile(f.primary, "utf8")), { log: { level: "warn" } });
    const valid = f.run(["set", "server.publicOrigins", '["HTTPS://Studio.Example:443/"]', "--yes"], {
      IMA2_PUBLIC_ORIGINS: `["https://user:${SECRET}@env"]`,
    });
    assert.equal(valid.status, 0, valid.stderr); assert.doesNotMatch(valid.stdout + valid.stderr, new RegExp(SECRET));
    assert.deepEqual(JSON.parse(await readFile(f.primary, "utf8")).server.publicOrigins, ["https://studio.example"]);
  } finally { await f.close(); }
});

test("LAN config: listing migrated/file/effective trees never prints nested credentials", async () => {
  const f = await fixture();
  try {
    await writeFile(f.legacy, JSON.stringify({ apiKey: SECRET, server: { publicOrigins: [`https://user:${SECRET}@host`] } }));
    const file = f.run(["ls", "--json"]);
    assert.equal(file.status, 0, file.stderr);
    assert.doesNotMatch(file.stdout + file.stderr, new RegExp(SECRET));
    assert.equal(JSON.parse(file.stdout).apiKey, "<redacted>");
    assert.equal(JSON.parse(file.stdout).server.publicOrigins, "<invalid public origins>");
    assert.equal(f.run(["rm", "server.publicOrigins", "--yes"]).status, 0);
    const effective = f.run(["ls", "--effective", "--json"], { IMA2_LAN_TOKEN: SECRET });
    assert.equal(effective.status, 0, effective.stderr);
    assert.doesNotMatch(effective.stdout + effective.stderr, new RegExp(SECRET));
    assert.equal(JSON.parse(effective.stdout).server.lanToken, "<redacted>");
    assert.equal(JSON.parse(effective.stdout).security.lanTokenMaxBytes, 4096);
    const nested = f.run(["get", "server", "--json"], { IMA2_LAN_TOKEN: SECRET });
    assert.equal(nested.status, 0); assert.doesNotMatch(nested.stdout + nested.stderr, new RegExp(SECRET));
  } finally { await f.close(); }
});
