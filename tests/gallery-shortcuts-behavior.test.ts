import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

async function importGalleryShortcuts() {
  const ts = await import(pathToFileURL(join(root, "ui/node_modules/typescript/lib/typescript.js")).href);
  const source = readFileSync(join(root, "ui/src/lib/galleryShortcuts.ts"), "utf8");
  const output = ts.default.transpileModule(source, {
    compilerOptions: {
      module: ts.default.ModuleKind.ES2022,
      target: ts.default.ScriptTarget.ES2022,
    },
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), "ima2-gallery-shortcuts-"));
  const modulePath = join(dir, "galleryShortcuts.mjs");
  writeFileSync(modulePath, output);
  try {
    return {
      module: await import(pathToFileURL(modulePath).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

const sourceA = { filename: "a.png", image: "a" };
const sourceB = { filename: "b.png", image: "b" };
const sourceC = { filename: "c.png", image: "c" };
const sourceD = { filename: "d.png", image: "d" };
const sourceE = { filename: "e.png", image: "e" };
const sourceF = { filename: "f.png", image: "f" };
const sourceG = { filename: "g.png", image: "g" };
const sourceH = { filename: "h.png", image: "h" };
const sourceI = { filename: "i.png", image: "i" };
const sourceJ = { filename: "j.png", image: "j" };
const sourceK = { filename: "k.png", image: "k" };
const sourceL = { filename: "l.png", image: "l" };
const sourceM = { filename: "m.png", image: "m" };
const sourceN = { filename: "n.png", image: "n" };
const canvasB = {
  filename: "b.canvas.png",
  image: "b-canvas",
  canvasVersion: true,
  canvasSourceFilename: "b.png",
  canvasEditableFilename: "b.png",
};
const history = [sourceA, canvasB, sourceB, sourceC];
const pageHistory = [
  sourceA,
  sourceB,
  { filename: "hidden.canvas.png", image: "hidden", canvasVersion: true },
  sourceC,
  sourceD,
  sourceE,
  sourceF,
  sourceG,
  sourceH,
  sourceI,
  sourceJ,
  sourceK,
  sourceL,
  sourceM,
  sourceN,
];

describe("gallery shortcut behavior", () => {
  it("skips hidden canvas versions for previous, next, first, and last", async () => {
    const { module, cleanup } = await importGalleryShortcuts();
    try {
      assert.deepEqual(module.getVisibleGalleryItems(history), [sourceA, sourceB, sourceC]);
      assert.equal(module.getShortcutTarget(history, sourceA, "next"), sourceB);
      assert.equal(module.getShortcutTarget(history, sourceB, "previous"), sourceA);
      assert.equal(module.getShortcutTarget(history, sourceA, "first"), sourceA);
      assert.equal(module.getShortcutTarget(history, sourceA, "last"), sourceC);
    } finally {
      cleanup();
    }
  });

  it("resolves stale hidden canvas current items back to their visible source", async () => {
    const { module, cleanup } = await importGalleryShortcuts();
    try {
      assert.equal(module.resolveVisibleShortcutCurrent(history, canvasB), sourceB);
      assert.equal(module.getShortcutTarget(history, canvasB, "previous"), sourceA);
      assert.equal(module.getShortcutTarget(history, canvasB, "next"), sourceC);
    } finally {
      cleanup();
    }
  });

  it("keeps delete replacement candidates in the visible gallery domain", async () => {
    const { module, cleanup } = await importGalleryShortcuts();
    try {
      assert.equal(module.getNeighborAfterRemoval(history, "a.png"), sourceB);
      assert.equal(module.getNeighborAfterRemoval(history, "b.png"), sourceC);
      assert.equal(module.getNeighborAfterRemoval(history, "c.png"), sourceB);
    } finally {
      cleanup();
    }
  });

  it("moves PageDown and PageUp by a fixed visible-gallery step", async () => {
    const { module, cleanup } = await importGalleryShortcuts();
    try {
      assert.equal(module.GALLERY_PAGE_STEP, 10);
      assert.equal(module.getShortcutTarget(pageHistory, sourceA, "pageNext"), sourceK);
      assert.equal(module.getShortcutTarget(pageHistory, sourceK, "pagePrevious"), sourceA);
    } finally {
      cleanup();
    }
  });

  it("clamps PageDown and PageUp at visible gallery edges", async () => {
    const { module, cleanup } = await importGalleryShortcuts();
    try {
      assert.equal(module.getShortcutTarget(pageHistory, sourceH, "pageNext"), sourceN);
      assert.equal(module.getShortcutTarget(pageHistory, sourceC, "pagePrevious"), sourceA);
    } finally {
      cleanup();
    }
  });

  it("keeps PageDown and PageUp out of hidden canvasVersion rows", async () => {
    const { module, cleanup } = await importGalleryShortcuts();
    try {
      assert.equal(module.getShortcutTarget(pageHistory, sourceA, "pageNext"), sourceK);
      assert.notEqual(module.getShortcutTarget(pageHistory, sourceA, "pageNext")?.filename, "hidden.canvas.png");
      assert.equal(module.getShortcutTarget(pageHistory, sourceK, "pagePrevious"), sourceA);
    } finally {
      cleanup();
    }
  });
});
