import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readStoreBundle } from "./_storeBundle.mjs";

const root = process.cwd();

function readSource(path) {
  if (path === "ui/src/store/useAppStore.ts") return readStoreBundle();
  return readFileSync(join(root, path), "utf8");
}

async function importSidebarHistory() {
  const ts = await import(pathToFileURL(join(root, "ui/node_modules/typescript/lib/typescript.js")).href);
  const compilerOptions = {
    module: ts.default.ModuleKind.ES2022,
    target: ts.default.ScriptTarget.ES2022,
  };
  const navSource = readSource("ui/src/lib/galleryNavigation.ts");
  const historySource = readSource("ui/src/lib/history/sidebarHistory.ts");
  const navOutput = ts.default.transpileModule(navSource, { compilerOptions }).outputText;
  const historyOutput = ts.default.transpileModule(historySource, { compilerOptions })
    .outputText
    .replace("../galleryNavigation", "../galleryNavigation.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ima2-sidebar-history-"));
  mkdirSync(join(dir, "history"));
  writeFileSync(join(dir, "galleryNavigation.mjs"), navOutput);
  writeFileSync(join(dir, "history/sidebarHistory.mjs"), historyOutput);
  try {
    return {
      module: await import(pathToFileURL(join(dir, "history/sidebarHistory.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

describe("issue #75 Prompt Studio state contract", () => {
  it("does not restore image prompts into the Prompt Studio composer on selection", () => {
    const workspace = readSource("ui/src/lib/workspaceProfile.ts");
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(workspace, /PROMPT_STUDIO_WORKSPACE_PRESET[\s\S]*restoreComposerFromHistory:\s*false/);
    assert.match(store, /resolveWorkspaceSettings\(get\(\)\.workspaceProfile\)\.restoreComposerFromHistory/);
    assert.match(store, /const composerPatch =\s+shouldRestoreComposer && target && !isComposerDirty/);
    assert.match(store, /getHistoryComposerPatch\(target\)/);
  });

  it("navigates Prompt Studio shortcuts through the grouped sidebar history domain", () => {
    const sidebarHistory = readSource("ui/src/lib/history/sidebarHistory.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    const sidebar = readSource("ui/src/components/history/SidebarHistory.tsx");
    const hook = readSource("ui/src/hooks/useGalleryViewerNavigation.ts");

    assert.match(sidebarHistory, /export function getSidebarHistoryShortcutTarget/);
    assert.match(sidebarHistory, /groupSidebarHistoryEntries\(history\)\.slice\(0, limit\)/);
    assert.match(sidebarHistory, /SIDEBAR_HISTORY_RENDER_LIMIT/);
    assert.match(store, /workspaceSettings\.multimodeHistoryGrouping === "sequence"/);
    assert.match(store, /getSidebarHistoryShortcutTarget\(/);
    assert.match(store, /target\.type === "sequence"/);
    assert.match(sidebar, /getSidebarHistoryActiveKey/);
    assert.match(sidebar, /activePreviewSequenceId/);
    assert.match(hook, /Boolean\(s\.currentImage\) \|\| Boolean\(s\.multimodePreviewFlightId\)/);
    assert.doesNotMatch(hook, /if \(!currentImage\) return/);
  });

  it("keeps the gallery opener fixed in the recent-history header", () => {
    const sidebar = readSource("ui/src/components/history/SidebarHistory.tsx");
    const css = readSource("ui/src/styles/sidebar-history.css");

    assert.match(sidebar, /className="sidebar-history__header-actions"/);
    assert.match(sidebar, /className="sidebar-history__gallery-button"/);
    assert.doesNotMatch(sidebar, /className="sidebar-history__gallery-card"/);
    assert.match(css, /\.sidebar-history__gallery-button/);
  });

  it("preserves gallery scroll across favorite mutations and filter switches", () => {
    const gallery = readSource("ui/src/components/GalleryModal.tsx");

    assert.match(gallery, /previousViewRef/);
    assert.match(gallery, /shouldCenterSelected/);
    assert.match(gallery, /previous\.selectedKey !== selectedKey/);
    assert.match(gallery, /scrollRef\.current\.scrollTop = lastScrollTopRef\.current/);
  });

  it("clamps sidebar shortcut targets to the visible grouped render limit", async () => {
    const { module, cleanup } = await importSidebarHistory();
    try {
      const a = { filename: "a.png", image: "a" };
      const s0 = { filename: "s0.png", image: "s0", sequenceId: "seq", sequenceIndex: 0 };
      const s1 = { filename: "s1.png", image: "s1", sequenceId: "seq", sequenceIndex: 1 };
      const b = { filename: "b.png", image: "b" };
      const history = [a, s1, s0, b];

      assert.deepEqual(
        module.groupSidebarHistoryEntries(history).map((entry) => entry.key),
        ["a.png", "sequence:seq", "b.png"],
      );
      assert.deepEqual(
        module.getSidebarHistoryShortcutTarget(history, null, "next", "seq"),
        { type: "image", item: b },
      );
      assert.equal(
        module.getSidebarHistoryShortcutTarget(history, null, "next", "seq", 2),
        null,
      );
    } finally {
      cleanup();
    }
  });
});
