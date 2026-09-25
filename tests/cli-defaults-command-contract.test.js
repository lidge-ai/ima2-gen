import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI defaults command contract", () => {
  it("defaults set model/reasoning writes OAuth and API provider keys together", () => {
    const src = readSource("bin/commands/defaults.ts");

    assert.match(src, /MODEL_KEYS = \["imageModels\.default", "apiProvider\.defaultImageModel"\]/);
    assert.match(src, /REASONING_KEYS = \["imageModels\.reasoningEffort", "apiProvider\.defaultReasoningEffort"\]/);
    assert.match(src, /validateModel\(value\)/);
    assert.match(src, /validateReasoning\(value\)/);
    assert.match(src, /setDefaults\(MODEL_KEYS, value\)/);
    assert.match(src, /setDefaults\(REASONING_KEYS, value\)/);
  });

  it("shared config-store owns writable keys and env override warnings", () => {
    const keys = readSource("lib/configKeys.ts");
    const store = readSource("bin/lib/config-store.ts");
    const configCmd = readSource("bin/commands/config.ts");

    assert.match(keys, /"apiProvider\.defaultImageModel"/);
    assert.match(keys, /"apiProvider\.defaultReasoningEffort"/);
    assert.match(keys, /"apiProvider\.defaultImageModel": "IMA2_API_IMAGE_MODEL_DEFAULT"/);
    assert.match(keys, /"apiProvider\.defaultReasoningEffort": "IMA2_API_REASONING_EFFORT"/);
    assert.match(store, /from "\.\.\/\.\.\/lib\/configKeys\.js"/);
    assert.match(configCmd, /from "\.\.\/lib\/config-store\.js"/);
    assert.match(configCmd, /isWritableConfigKey\(key\)/);
  });

  it("top-level CLI dispatch lets defaults and capabilities show their own help", () => {
    const src = readSource("bin/ima2.ts");

    assert.match(src, /defaults <sub> Inspect\/change model defaults/);
    assert.match(src, /capabilities\s+Agent capability metadata/);
    assert.match(src, /"defaults"/);
    assert.match(src, /"capabilities"/);
    assert.match(src, /case "defaults":/);
    assert.match(src, /case "capabilities":/);
  });

  it("declares image/video CLI-only targets without exposing them through config set", () => {
    const src = readSource("bin/commands/defaults.ts");
    const keys = readSource("lib/configKeys.ts");
    assert.match(src, /set image <lane>\/<model>/);
    assert.match(src, /set video <lane>\/<model>/);
    assert.match(src, /loadCliDefaults\(\)/);
    assert.doesNotMatch(keys, /"defaults\.(?:image|video)"/);
  });
});

function runCli(args, configDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", ...args], {
      cwd: process.cwd(), env: { ...process.env, NO_COLOR: "1", IMA2_SERVER: "", IMA2_CONFIG_DIR: configDir },
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("CLI image/video defaults behavior", () => {
  it("defaults set model writes each GPT lane only a model it serves", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "ima2-defaults-model-"));
    const saved = () => JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    try {
      // A legacy id: GPT OAuth takes its GPT-6 tier, the API-key lane keeps the id it serves.
      assert.equal((await runCli(["defaults", "set", "model", "gpt-5.6-luna"], configDir)).code, 0);
      assert.equal(saved().imageModels.default, "gpt-6-luna");
      assert.equal(saved().apiProvider.defaultImageModel, "gpt-5.6-luna");
      // A GPT OAuth-only id never becomes the API-key default.
      assert.equal((await runCli(["defaults", "set", "model", "gpt-6-sol"], configDir)).code, 0);
      assert.equal(saved().imageModels.default, "gpt-6-sol");
      assert.equal(saved().apiProvider.defaultImageModel, "gpt-5.6-luna");
      const bad = await runCli(["defaults", "set", "model", "gpt-9"], configDir);
      assert.equal(bad.code, 2);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("validates ready targets, persists raw CLI keys, lists, and resets without restart notice", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "ima2-defaults-ready-"));
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/health") { res.end('{"ok":true}'); return; }
      if (req.url === "/api/models") {
        res.end(JSON.stringify({ ok: true, lanes: { runway: { status: "ready", defaults: {}, models: {
          image: [{ id: "gen-4" }], video: [{ id: "veo-3.1" }],
        } } } })); return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const set = await runCli(["defaults", "set", "image", "runway/gen-4", "--server", base], configDir);
      assert.equal(set.code, 0);
      assert.doesNotMatch(set.stdout, /restart/i);
      assert.equal(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).defaults.image, "runway/gen-4");
      const listed = await runCli(["defaults", "ls", "--local", "--json"], configDir);
      assert.equal(JSON.parse(listed.stdout).defaults.cli.image, "runway/gen-4");
      const reset = await runCli(["defaults", "reset", "image", "--json"], configDir);
      assert.deepEqual(JSON.parse(reset.stdout), { ok: true, kind: "image", reset: true });
      assert.equal(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).defaults.image, undefined);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed, locked, missing-model, and unreachable validation paths", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "ima2-defaults-errors-"));
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/health") { res.end('{"ok":true}'); return; }
      if (req.url === "/api/models") { res.end(JSON.stringify({ ok: true, lanes: { higgsfield: {
        status: "locked", reason: "catalog only", defaults: {}, models: { image: [{ id: "x" }], video: [] },
      }, runway: { status: "ready", defaults: {}, models: { image: [], video: [] } } } })); return; }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const malformed = await runCli(["defaults", "set", "image", "gen-4", "--json"], configDir);
      assert.equal(malformed.code, 2); assert.equal(JSON.parse(malformed.stdout).code, "INVALID_MODEL_TARGET");
      const locked = await runCli(["defaults", "set", "image", "higgsfield/x", "--json", "--server", base], configDir);
      assert.equal(locked.code, 2); assert.equal(JSON.parse(locked.stdout).code, "LANE_UNAVAILABLE");
      const missing = await runCli(["defaults", "set", "video", "runway/nope", "--json", "--server", base], configDir);
      assert.equal(missing.code, 2); assert.equal(JSON.parse(missing.stdout).code, "MODEL_NOT_FOUND");
      const down = await runCli(["defaults", "set", "image", "runway/gen-4", "--json", "--server", "http://127.0.0.1:1"], configDir);
      assert.equal(down.code, 3); assert.equal(JSON.parse(down.stdout).code, "SERVER_UNREACHABLE");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
