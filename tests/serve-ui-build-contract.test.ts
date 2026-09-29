import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getUiDistBuildStatus } from "../bin/lib/ui-build.js";

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "ima2-ui-build-"));
  mkdirSync(join(root, "ui", "src"), { recursive: true });
  mkdirSync(join(root, "ui", "dist"), { recursive: true });
  writeFileSync(join(root, "ui", "package.json"), "{}");
  writeFileSync(join(root, "ui", "src", "main.tsx"), "console.log('src');");
  writeFileSync(join(root, "ui", "dist", "index.html"), "<div></div>");
  return root;
}

function setMtime(path: string, seconds: number) {
  const date = new Date(seconds * 1000);
  utimesSync(path, date, date);
}

test("ima2 serve delegates UI dist freshness to helper", () => {
  const src = readFileSync(join(process.cwd(), "bin", "ima2.ts"), "utf8");
  assert.match(src, /ensureFreshUiDist\(ROOT\)/);
  assert.doesNotMatch(src, /ui\/dist missing/);
});

test("ui dist freshness detects stale Vite source", () => {
  const root = makeProject();
  try {
    setMtime(join(root, "ui", "dist", "index.html"), 100);
    setMtime(join(root, "ui", "src", "main.tsx"), 200);
    assert.deepEqual(getUiDistBuildStatus(root), { needsBuild: true, reason: "stale" });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("ui dist freshness accepts newer dist", () => {
  const root = makeProject();
  try {
    setMtime(join(root, "ui", "src", "main.tsx"), 100);
    setMtime(join(root, "ui", "package.json"), 100);
    setMtime(join(root, "ui", "dist", "index.html"), 200);
    assert.deepEqual(getUiDistBuildStatus(root), { needsBuild: false, reason: "fresh" });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("ui dist freshness still builds when dist is missing and source exists", () => {
  const root = mkdtempSync(join(tmpdir(), "ima2-ui-build-"));
  try {
    mkdirSync(join(root, "ui"), { recursive: true });
    writeFileSync(join(root, "ui", "package.json"), "{}");
    assert.deepEqual(getUiDistBuildStatus(root), { needsBuild: true, reason: "missing" });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
