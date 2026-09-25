import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveDevApiTarget } from "../ui/dev/resolveDevApiTarget.mjs";

test("resolveDevApiTarget prefers explicit env", () => {
  const result = resolveDevApiTarget({
    env: { VITE_IMA2_API_TARGET: "http://localhost:4444/" },
  });
  assert.deepEqual(result, { url: "http://localhost:4444", source: "env" });
});

test("resolveDevApiTarget reads backend.url from advertise file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-vite-target-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "server.json"), JSON.stringify({
      port: 3334,
      backend: { url: "http://localhost:3335" },
    }));
    const result = resolveDevApiTarget({ env: { IMA2_CONFIG_DIR: dir } });
    assert.deepEqual(result, { url: "http://localhost:3335", source: "server.json" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveDevApiTarget falls back through legacy port", () => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-vite-target-"));
  try {
    writeFileSync(join(dir, "server.json"), JSON.stringify({ port: 3336 }));
    const result = resolveDevApiTarget({ env: { IMA2_CONFIG_DIR: dir } });
    assert.deepEqual(result, { url: "http://localhost:3336", source: "server.json" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
