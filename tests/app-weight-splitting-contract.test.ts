import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

function visitStaticImports(manifest, chunk, seen: Set<any> = new Set()) {
  if (!chunk || seen.has(chunk.file)) return seen;
  seen.add(chunk.file);
  for (const importId of chunk.imports ?? []) {
    visitStaticImports(manifest, manifest[importId], seen);
  }
  return seen;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoStaticImport(source, modulePath) {
  const pattern = new RegExp(`from ["']${escapeRegExp(modulePath)}["']`);
  assert.ok(!pattern.test(source), `${modulePath} must not be statically imported`);
}

function readEntryStaticJs(manifest, entry) {
  const files = Array.from(visitStaticImports(manifest, entry));
  return files.map((file) => readSource(join("ui/dist", file))).join("\n");
}

test("release builds use manifest and opt-in sourcemaps", () => {
  const viteConfig = readSource("ui/vite.config.ts");

  assert.match(viteConfig, /manifest:\s*true/);
  assert.match(viteConfig, /sourcemap:\s*process\.env\.VITE_SOURCEMAP === "1"/);
  assert.doesNotMatch(viteConfig, /sourcemap:\s*true/);
});

test("default app path lazy-loads non-classic heavy surfaces", () => {
  const app = readSource("ui/src/App.tsx");

  assert.match(app, /const LazyNodeCanvas = lazy\(\(\) =>\s*import\("\.\/components\/NodeCanvas"\)/);
  assert.match(app, /const LazySettingsWorkspace = lazy\(\(\) =>\s*import\("\.\/components\/SettingsWorkspace"\)/);
  assert.match(app, /const LazyCardNewsWorkspace = lazy\(\(\) =>\s*import\("\.\/components\/card-news\/CardNewsWorkspace"\)/);
  assert.match(app, /const LazyPromptLibraryPanel = lazy\(\(\) =>\s*import\("\.\/components\/PromptLibraryPanel"\)/);
  assert.match(app, /<Suspense fallback=\{<WorkspaceFallback \/>}/);
  assert.match(app, /<Canvas \/>/);
  assert.match(app, /<LazyNodeCanvas \/>/);
  assert.match(app, /<LazyCardNewsWorkspace \/>/);
  assert.doesNotMatch(app, /import \{ NodeCanvas \}/);
  assert.doesNotMatch(app, /import \{ SettingsWorkspace \}/);
  assert.doesNotMatch(app, /import \{ CardNewsWorkspace \}/);
  assert.doesNotMatch(app, /import \{ PromptLibraryPanel \}/);
});

test("prompt library and import subflows are loaded on demand", () => {
  const rightPanel = readSource("ui/src/components/RightPanel.tsx");
  const promptLibrary = readSource("ui/src/components/PromptLibraryPanel.tsx");
  const promptImport = readSource("ui/src/components/PromptImportDialog.tsx");

  assert.match(rightPanel, /const LazyPromptLibraryPanel = lazy\(\(\) =>\s*import\("\.\/PromptLibraryPanel"\)/);
  assert.match(rightPanel, /<LazyPromptLibraryPanel variant="embedded" \/>/);
  assert.doesNotMatch(rightPanel, /import \{ PromptLibraryPanel \}/);

  assert.match(promptLibrary, /const LazyPromptImportDialog = lazy\(\(\) =>\s*import\("\.\/PromptImportDialog"\)/);
  assert.match(promptLibrary, /importOpen \? \(/);
  assert.match(promptLibrary, /<LazyPromptImportDialog/);
  assert.doesNotMatch(promptLibrary, /import \{ PromptImportDialog \}/);

  assert.match(promptImport, /const LazyPromptImportDiscoverySection = lazy\(\(\) =>/);
  assert.match(promptImport, /const LazyPromptImportFolderSection = lazy\(\(\) =>/);
  assert.match(promptImport, /<LazyPromptImportDiscoverySection/);
  assert.match(promptImport, /<LazyPromptImportFolderSection/);
  assert.doesNotMatch(promptImport, /import \{ PromptImportDiscoverySection \}/);
  assert.doesNotMatch(promptImport, /import \{ PromptImportFolderSection \}/);
});

test("canvas mode workspace is lazy-loaded through the feature boundary", () => {
  const canvas = readSource("ui/src/components/Canvas.tsx");
  const featureIndexPath = join(root, "ui/src/components/canvas-mode/index.ts");
  const workspacePath = join(root, "ui/src/components/canvas-mode/CanvasModeWorkspace.tsx");

  assert.ok(existsSync(featureIndexPath), "canvas-mode feature barrel must exist");
  assert.ok(existsSync(workspacePath), "CanvasModeWorkspace must exist");

  const featureIndex = readSource("ui/src/components/canvas-mode/index.ts");
  const workspace = readSource("ui/src/components/canvas-mode/CanvasModeWorkspace.tsx");

  assert.match(canvas, /const LazyCanvasModeWorkspace = lazy\(\(\) =>\s*import\("\.\/canvas-mode"\)/);
  assert.doesNotMatch(canvas, /import\("\.\/canvas-mode\/Canvas/);
  assert.doesNotMatch(
    canvas,
    /LazyCanvasAnnotationLayer|LazyCanvasMemoOverlay|LazyCanvasToolbar|LazyCanvasViewportMiniMap|LazyCanvasZoomControl/,
  );

  assert.match(featureIndex, /export \{ CanvasModeWorkspace \} from "\.\/CanvasModeWorkspace";/);
  assert.match(featureIndex, /export type \{ CanvasModeWorkspaceProps \} from "\.\/canvasModeTypes";/);
  assert.doesNotMatch(featureIndex, /export \*/);
  assert.doesNotMatch(
    featureIndex,
    /CanvasModeShell|CanvasToolbar|CanvasAnnotationLayer|CanvasMemoOverlay|CanvasViewportMiniMap|CanvasZoomControl/,
  );

  assert.match(workspace, /import \{ CanvasModeFloatingToolbar \} from "\.\/CanvasModeFloatingToolbar";/);
  assert.match(readSource("ui/src/components/canvas-mode/CanvasModeFloatingToolbar.tsx"), /import \{ CanvasToolbar \} from "\.\/CanvasToolbar";/);
  assert.doesNotMatch(workspace, /lazy\(\(\) =>\s*import\("\.\/Canvas/);
  assert.doesNotMatch(workspace, /CanvasModeShell/);
});

test("classic Canvas shell does not own Canvas Mode internals", () => {
  const canvas = readSource("ui/src/components/Canvas.tsx");

  for (const modulePath of [
    "../hooks/useCanvasAnnotations",
    "../lib/canvas/coordinates",
    "../lib/canvas/mergeRenderer",
    "../lib/canvas/maskRenderer",
    "../lib/canvas/hitTest",
    "../lib/canvas/objectKeys",
    "../lib/canvas/exportRenderer",
    "../lib/canvas/alphaDetect",
    "../lib/canvas/backgroundRemoval",
  ]) {
    assertNoStaticImport(canvas, modulePath);
  }

  assert.doesNotMatch(canvas, /useCanvasAnnotations\(/);
  assert.doesNotMatch(canvas, /fetchCanvasAnnotations|saveCanvasAnnotations|deleteCanvasAnnotations/);
  assert.doesNotMatch(canvas, /createCanvasVersion|updateCanvasVersion|postEdit/);
  assert.doesNotMatch(canvas, /NormalizedPoint/);
  assert.doesNotMatch(canvas, /CanvasModeShell/);
});

test("built output splits mode and prompt-import chunks when dist exists", () => {
  const manifestPath = join(root, "ui/dist/.vite/manifest.json");
  assert.ok(existsSync(manifestPath), "build manifest must exist; run npm run ui:build before bundle verification");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const keys = Object.keys(manifest).join("\n");
  const assetsDir = join(root, "ui/dist/assets");
  const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith(".js"));
  const entries = Object.values<any>(manifest).filter((chunk) => chunk.isEntry);
  assert.equal(entries.length, 1, `expected one Vite entry chunk, got ${entries.length}`);
  const staticInitialFiles = visitStaticImports(manifest, entries[0]);
  // The preauth shell now lazy-loads App before App's existing feature chunks.
  const appChunks = (entries[0].dynamicImports ?? []).map((id) => manifest[id])
    .filter((chunk) => chunk?.name === "App");
  assert.equal(appChunks.length, 1, "preauth entry must dynamically reach App");
  const dynamicImports = new Set(appChunks.flatMap((chunk) => chunk.dynamicImports ?? []));
  const staticAppFiles = visitStaticImports(manifest, appChunks[0]);
  for (const feature of ["src/components/NodeCanvas.tsx", "src/components/card-news/CardNewsWorkspace.tsx",
    "src/components/PromptLibraryPanel.tsx", "src/components/canvas-mode/index.ts"]) {
    assert.ok(!staticAppFiles.has(manifest[feature]?.file), `${feature} must remain lazy after authentication`);
  }

  assert.match(keys, /src\/components\/NodeCanvas\.tsx/);
  assert.match(keys, /src\/components\/card-news\/CardNewsWorkspace\.tsx/);
  assert.match(keys, /src\/components\/PromptLibraryPanel\.tsx/);
  assert.match(keys, /src\/components\/PromptImportDialog\.tsx/);
  assert.match(keys, /src\/components\/canvas-mode\/index\.ts/);
  assert.ok(jsFiles.length > 1, "build should emit multiple JS chunks after lazy splitting");
  assert.ok(
    jsFiles.some((file) => file.startsWith("NodeCanvas-")),
    "NodeCanvas should be emitted as its own lazy chunk",
  );
  assert.ok(
    jsFiles.some((file) => file.startsWith("index-") && file !== basename(entries[0].file)),
    "Canvas Mode should be emitted as its own lazy feature chunk",
  );
  assert.ok(
    dynamicImports.has("src/components/NodeCanvas.tsx"),
    "NodeCanvas should be reachable through a dynamic import from the entry",
  );
  assert.ok(
    dynamicImports.has("src/components/card-news/CardNewsWorkspace.tsx"),
    "CardNewsWorkspace should be reachable through a dynamic import from the entry",
  );
  assert.ok(
    dynamicImports.has("src/components/PromptLibraryPanel.tsx"),
    "PromptLibraryPanel should be reachable through a dynamic import from the entry",
  );
  assert.ok(
    dynamicImports.has("src/components/canvas-mode/index.ts"),
    "Canvas Mode should be reachable through a dynamic import from the entry",
  );
  assert.ok(
    !staticInitialFiles.has(manifest["src/components/NodeCanvas.tsx"]?.file),
    "NodeCanvas chunk should not be part of the entry's static import graph",
  );
  assert.ok(
    !staticInitialFiles.has(manifest["src/components/card-news/CardNewsWorkspace.tsx"]?.file),
    "CardNewsWorkspace chunk should not be part of the entry's static import graph",
  );
  assert.ok(
    !staticInitialFiles.has(manifest["src/components/PromptLibraryPanel.tsx"]?.file),
    "PromptLibraryPanel chunk should not be part of the entry's static import graph",
  );
  assert.ok(
    !staticInitialFiles.has(manifest["src/components/canvas-mode/index.ts"]?.file),
    "Canvas Mode chunk should not be part of the entry's static import graph",
  );

  const entryStaticJs = readEntryStaticJs(manifest, entries[0]);
  for (const sentinel of [
    "useCanvasAnnotations",
    "renderMergedCanvasImage",
    "renderMaskFromBoxes",
    "renderBackgroundRemovalPreview",
    "removeContiguousBackground",
    "imageUsesAlpha",
    "@xyflow/react",
    "react-flow__renderer",
    "react-flow__node",
  ]) {
    assert.doesNotMatch(entryStaticJs, new RegExp(escapeRegExp(sentinel)));
  }
});
