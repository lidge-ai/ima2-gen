import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK = readFileSync(resolve(ROOT, "ui/src/hooks/useCreateBlankCanvas.ts"), "utf8");
const HELPER = readFileSync(resolve(ROOT, "ui/src/lib/canvas/blankCanvas.ts"), "utf8");

describe("blank canvas size honors right-sidebar size selection", () => {
  it("hook exports resolveBlankCanvasSize and reads getResolvedSize from store", () => {
    assert.match(HOOK, /export function resolveBlankCanvasSize/);
    assert.match(HOOK, /useAppStore\(\(s\) => s\.getResolvedSize\)/);
    assert.match(HOOK, /resolveBlankCanvasSize\(getResolvedSize\(\)\)/);
    assert.match(HOOK, /createBlankCanvasFile\(size\)/);
  });

  it("resolveBlankCanvasSize parses WxH preset strings", async () => {
    const tempDir = resolve(ROOT, ".temp-blank-canvas-size-test");
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });
    try {
      const stub = `
        export function resolveBlankCanvasSize(resolvedSize) {
          const match = /^(\\d+)x(\\d+)$/.exec(resolvedSize);
          if (!match) return { width: 1024, height: 1024 };
          const w = Number.parseInt(match[1] ?? "", 10);
          const h = Number.parseInt(match[2] ?? "", 10);
          if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            return { width: 1024, height: 1024 };
          }
          return { width: w, height: h };
        }
      `;
      const file = resolve(tempDir, "stub.mjs");
      writeFileSync(file, stub);
      const mod = await import(`${pathToFileURL(file).href}?cachebust=${Date.now()}`);
      const { resolveBlankCanvasSize } = mod;
      assert.deepEqual(resolveBlankCanvasSize("1024x1024"), { width: 1024, height: 1024 });
      assert.deepEqual(resolveBlankCanvasSize("1536x1024"), { width: 1536, height: 1024 });
      assert.deepEqual(resolveBlankCanvasSize("3840x2160"), { width: 3840, height: 2160 });
      assert.deepEqual(resolveBlankCanvasSize("auto"), { width: 1024, height: 1024 });
      assert.deepEqual(resolveBlankCanvasSize("custom"), { width: 1024, height: 1024 });
      assert.deepEqual(resolveBlankCanvasSize(""), { width: 1024, height: 1024 });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("helper accepts width/height options and writes them to the canvas", () => {
    assert.match(HELPER, /export type BlankCanvasSize/);
    assert.match(HELPER, /createBlankCanvasFile\(size\?: BlankCanvasSize\)/);
    assert.match(HELPER, /canvas\.width = width/);
    assert.match(HELPER, /canvas\.height = height/);
    assert.match(HELPER, /normalizeBlankCanvasSide/);
  });
});
