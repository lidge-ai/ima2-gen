import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const UI_SRC = join(import.meta.dirname, "..", "ui", "src");
const STYLES_DIR = join(UI_SRC, "styles");
const INDEX_CSS = join(UI_SRC, "index.css");

function collectCss(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCss(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

const cssFiles = [INDEX_CSS, ...collectCss(STYLES_DIR)];

type Category = "functional" | "state" | "scrim" | "decorative";

interface ManifestEntry {
  file: string;
  count: number;
  category: Category;
  note: string;
}

const MANIFEST: ManifestEntry[] = [
  { file: "styles/assetgen-workspace.css", count: 6, category: "functional", note: "checkerboard + alpha grids" },
  { file: "styles/canvas-annotations.css", count: 4, category: "functional", note: "alpha frame 4-layer" },
  { file: "styles/canvas-mode.css", count: 1, category: "functional", note: "canvas dot grid" },
  { file: "styles/node-workspace.css", count: 1, category: "functional", note: "node dot grid" },
  { file: "styles/node-canvas-extras.css", count: 1, category: "functional", note: "template preview grid" },
  { file: "styles/sprite-curator.css", count: 1, category: "functional", note: "alpha grid" },
  { file: "index.css", count: 1, category: "state", note: "--skeleton-shimmer definition" },
  { file: "styles/progress-composer.css", count: 4, category: "state", note: "progress layers + success" },
  { file: "styles/gallery-modal.css", count: 1, category: "scrim", note: "caption scrim" },
  { file: "styles/canvas-mode.css", count: 1, category: "scrim", note: "top scrim" },
  { file: "index.css", count: 3, category: "decorative", note: "body::before tint + prism + chrome defs" },
  { file: "styles/sidebar.css", count: 2, category: "decorative", note: "logo-title--gen + theme toggle dot" },
  { file: "styles/prompt-builder-messages.css", count: 3, category: "decorative", note: "assistant msg surfaces" },
  { file: "styles/card-news-layout.css", count: 3, category: "decorative", note: "empty card + skeleton text" },
  { file: "styles/viewer-workflow.css", count: 2, category: "decorative", note: "blank sheet dot + paper" },
  { file: "styles/settings-controls.css", count: 1, category: "decorative", note: "radio check dot" },
];

function countGradients(file: string): number {
  const content = readFileSync(file, "utf8");
  return (content.match(/(?:linear|radial|conic)-gradient\(/g) || []).length;
}

describe("ui-gradient-manifest-contract", () => {
  it("manifest covers every gradient function call exhaustively", () => {
    const manifestTotal: Record<string, number> = {};
    for (const entry of MANIFEST) {
      manifestTotal[entry.file] = (manifestTotal[entry.file] || 0) + entry.count;
    }
    const mismatches: string[] = [];
    const seen = new Set<string>();
    for (const [relFile, expected] of Object.entries(manifestTotal)) {
      const fullPath = join(UI_SRC, relFile);
      const actual = countGradients(fullPath);
      seen.add(relFile);
      if (actual !== expected) {
        mismatches.push(relFile + ": manifest=" + expected + " actual=" + actual);
      }
    }
    for (const file of cssFiles) {
      const rel = relative(UI_SRC, file).split(sep).join("/");
      if (seen.has(rel)) continue;
      const count = countGradients(file);
      if (count > 0) {
        mismatches.push(rel + ": unlisted file has " + count + " gradient(s)");
      }
    }
    assert.deepStrictEqual(mismatches, [], "Manifest mismatches");
  });

  it("total is exactly 35 (functional 14 + state 5 + scrim 2 + decorative 14)", () => {
    const byCategory: Record<Category, number> = { functional: 0, state: 0, scrim: 0, decorative: 0 };
    for (const entry of MANIFEST) {
      byCategory[entry.category] += entry.count;
    }
    assert.equal(byCategory.functional, 14, "functional");
    assert.equal(byCategory.state, 5, "state");
    assert.equal(byCategory.scrim, 2, "scrim");
    assert.equal(byCategory.decorative, 14, "decorative");
    const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
    assert.equal(total, 35, "total");
  });

  it("--skeleton-shimmer is defined once and referenced by 6 consumers", () => {
    const indexContent = readFileSync(INDEX_CSS, "utf8");
    const defs = (indexContent.match(/--skeleton-shimmer\s*:/g) || []).length;
    assert.equal(defs, 1, "--skeleton-shimmer should be defined exactly once");

    const expectedConsumers = [
      "styles/node-workspace.css",
      "styles/right-panel.css",
      "styles/sidebar-history.css",
      "styles/progress-composer.css",
    ];
    const actualConsumers: string[] = [];
    let refs = 0;
    for (const file of cssFiles) {
      if (file === INDEX_CSS) continue;
      const content = readFileSync(file, "utf8");
      const count = (content.match(/var\(--skeleton-shimmer\)/g) || []).length;
      if (count > 0) actualConsumers.push(relative(UI_SRC, file).split(sep).join("/"));
      refs += count;
    }
    assert.equal(refs, 6, "--skeleton-shimmer should be referenced by 6 consumers");
    assert.deepStrictEqual(
      actualConsumers.sort(),
      expectedConsumers.sort(),
      "shimmer consumers must be exactly these 4 files"
    );
  });

  it(".canvas__blank-sheet has background in exactly one file", () => {
    const filesWithBg: string[] = [];
    for (const file of cssFiles) {
      const content = readFileSync(file, "utf8");
      if (/\.canvas__blank-sheet\s*\{[^}]*(?:background|background-image)\s*:/.test(content)) {
        filesWithBg.push(relative(UI_SRC, file).split(sep).join("/"));
      }
    }
    assert.deepStrictEqual(filesWithBg, ["styles/viewer-workflow.css"]);
  });

  it("no file exceeds 3 decorative gradients", () => {
    const decorByFile: Record<string, number> = {};
    for (const entry of MANIFEST) {
      if (entry.category === "decorative") {
        decorByFile[entry.file] = (decorByFile[entry.file] || 0) + entry.count;
      }
    }
    const violations = Object.entries(decorByFile)
      .filter(([, n]) => n > 3)
      .map(([f, n]) => f + ": " + n + " decorative");
    assert.deepStrictEqual(violations, [], "Files exceeding decorative budget");
  });
});
