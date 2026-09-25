import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

function lineCount(path) {
  return readSource(path).split("\n").length;
}

describe("prompt studio UI contract", () => {
  it("wires the workspace profile settings section without broken nav keys", () => {
    const settings = readSource("ui/src/components/SettingsWorkspace.tsx");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(settings, /"providers",\s*"workspace",\s*"general"/);
    assert.match(settings, /workspace:\s*null/);
    assert.match(settings, /providers:\s*null/);
    assert.match(settings, /general:\s*null/);
    assert.match(settings, /WorkspaceProfileSettings/);
    assert.equal(typeof en.settings.sections.workspace.title, "string");
    assert.equal(typeof en.settings.sections.workspace.hint, "string");
    assert.equal(typeof ko.settings.sections.workspace.title, "string");
    assert.equal(typeof ko.settings.sections.workspace.hint, "string");
  });

  it("keeps prompt builder styles split, imported, and under the file budget", () => {
    const main = readSource("ui/src/main.tsx");
    const builderCss = readSource("ui/src/styles/prompt-builder.css");
    const messageCss = readSource("ui/src/styles/prompt-builder-messages.css");

    assert.match(main, /styles\/prompt-builder\.css/);
    assert.match(main, /styles\/prompt-builder-messages\.css/);
    assert.match(builderCss, /\.prompt-builder\s*\{/);
    assert.match(messageCss, /\.prompt-builder__message\s*\{/);
    assert.ok(lineCount("ui/src/styles/prompt-builder.css") < 500);
    assert.ok(lineCount("ui/src/styles/prompt-builder-messages.css") < 500);
  });

  it("uses the server-projected backend model list in the shared portaled Select", () => {
    const menu = readSource("ui/src/components/prompt-builder/PromptBuilderModelMenu.tsx");
    const css = readSource("ui/src/styles/prompt-builder.css");

    assert.match(menu, /Select<string>/);
    assert.match(menu, /portal/);
    assert.match(menu, /modelOptions\.map/);
    assert.match(menu, /updateConfig\(backend, value\)/);
    assert.doesNotMatch(menu, /const MODELS|const MODEL_ITEMS|gpt-5\.6-luna/);
    assert.doesNotMatch(menu, /useState|role="listbox"|prompt-builder__model-option/);
    assert.match(css, /\.prompt-builder__model-picker \.ctl-select__trigger/);
    assert.doesNotMatch(css, /\.prompt-builder__model-(?:trigger|menu|option)/);
  });

  it("wires Prompt Builder settings, hydration guard, backend badge, and visible errors", () => {
    const settings = readSource("ui/src/components/SettingsWorkspace.tsx");
    const builderSettings = readSource("ui/src/components/settings/PromptBuilderSettings.tsx");
    const store = readSource("ui/src/store/promptBuilderStore.ts");
    const panel = readSource("ui/src/components/prompt-builder/PromptBuilderPanel.tsx");
    const composer = readSource("ui/src/components/prompt-builder/PromptBuilderComposer.tsx");
    const messages = readSource("ui/src/components/prompt-builder/PromptBuilderMessageList.tsx");

    assert.match(settings, /<PromptBuilderSettings \/>/);
    assert.match(builderSettings, /settings\.promptBuilder\.title/);
    assert.match(builderSettings, /locked\.backend \|\| locked\.model/);
    assert.match(store, /getPromptBuilderConfig/);
    assert.match(store, /putPromptBuilderConfig/);
    assert.match(store, /if \(!state\.configLoaded\)/);
    assert.match(composer, /!configLoaded/);
    assert.match(panel, /lastBackend/);
    assert.match(panel, /prompt-builder__backend-badge/);
    assert.match(messages, /prompt-builder__error/);
    assert.match(messages, /role="alert"/);
  });

  it("keeps functional panels solid while preserving semantic media gradients", () => {
    const controls = readSource("ui/src/styles/controls.css");
    const mentions = readSource("ui/src/styles/element-mention.css");
    const builder = readSource("ui/src/styles/prompt-builder.css");
    const gallery = readSource("ui/src/styles/gallery-modal.css");
    const actions = readSource("ui/src/styles/right-panel.css");
    const assets = readSource("ui/src/styles/assetgen-workspace.css");

    assert.match(controls, /\.ctl-select__list\s*\{[\s\S]*?background:\s*var\(--surface\)/);
    assert.doesNotMatch(controls, /\.ctl-select__list\s*\{[\s\S]*?backdrop-filter/);
    assert.match(controls, /\.ctl-select__item\s*\{[\s\S]*?min-height:\s*44px/);
    assert.match(mentions, /\.element-mention-menu\s*\{[\s\S]*?background:\s*var\(--surface\)/);
    assert.doesNotMatch(mentions, /backdrop-filter/);
    assert.doesNotMatch(builder, /linear-gradient|radial-gradient/);
    assert.match(gallery, /\.gallery__storage-bar--notice\s*\{\s*background:\s*var\(--surface\)/);
    assert.match(gallery, /\.gallery__caption\s*\{[\s\S]*?linear-gradient/);
    assert.match(actions, /\.result-actions__menu-item\s*\{[\s\S]*?min-height:\s*44px/);
    assert.match(actions, /\.result-actions__menu-item:focus-visible/);
    assert.match(assets, /repeating-conic-gradient/);
  });

  it("stores builder output after the main prompt and exposes block movement controls", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const composer = readSource("ui/src/components/PromptComposer.tsx");
    const structuredCard = readSource("ui/src/components/prompt-builder/PromptBuilderStructuredCard.tsx");
    const css = readSource("ui/src/styles/composer-flow.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(store, /placement\?: "before" \| "after"/);
    assert.match(store, /const before = insertedPrompts\.filter\(\(prompt\) => prompt\.placement !== "after"\)/);
    assert.match(store, /const after = insertedPrompts\.filter\(\(prompt\) => prompt\.placement === "after"\)/);
    assert.match(store, /moveInsertedPromptInComposer: \(id: string, direction: "up" \| "down"\) => void/);
    assert.match(store, /moveInsertedPromptInComposer: \(id, direction\) =>/);
    assert.match(structuredCard, /placement:\s*"after"/);
    assert.match(composer, /moveInsertedPromptInComposer/);
    assert.match(composer, /composer__prompt-chips--after/);
    assert.match(css, /\.composer__prompt-chip-move/);
    assert.equal(typeof en.prompt.moveBlockUp, "string");
    assert.equal(typeof en.prompt.moveBlockDown, "string");
    assert.equal(typeof en.prompt.afterBlocks, "string");
    assert.equal(typeof ko.prompt.moveBlockUp, "string");
    assert.equal(typeof ko.prompt.moveBlockDown, "string");
    assert.equal(typeof ko.prompt.afterBlocks, "string");
  });

  it("persists composer snapshots through generation, multimode, and history rows", () => {
    const types = readSource("ui/src/types.ts");
    const api = readSource("ui/src/lib/api.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    const generateRoute = (readSource("routes/generate.ts") + readSource("lib/generatePipeline.ts"));
    const multimodeRoute = (readSource("routes/multimode.ts") + readSource("lib/multimodePipeline.ts"));
    const historyList = readSource("lib/historyList.ts");
    const snapshot = readSource("lib/composerSnapshot.ts");
    const snapshotRuntime = readSource("lib/composerSnapshot.js");

    assert.match(types, /export type ComposerInsertedPromptSnapshot/);
    assert.match(types, /composerPrompt\?: string \| null/);
    assert.match(types, /composerInsertedPrompts\?: ComposerInsertedPromptSnapshot\[\] \| null/);
    assert.match(api, /composerPrompt\?: string \| null/);
    assert.match(api, /composerInsertedPrompts\?: import\("\.\.\/types"\)\.ComposerInsertedPromptSnapshot\[\] \| null/);
    assert.match(snapshot, /normalizeComposerInsertedPrompts/);
    assert.match(snapshotRuntime, /export function normalizeComposerInsertedPrompts/);
    assert.match(store, /const composerPrompt = s\.prompt/);
    assert.match(store, /const composerInsertedPrompts = cloneInsertedPrompts\(s\.insertedPrompts\)/);
    assert.match(store, /composerPrompt,/);
    assert.match(store, /composerInsertedPrompts,/);
    assert.match(store, /getHistoryComposerPatch/);
    assert.match(generateRoute, /normalizeComposerPrompt/);
    assert.match(generateRoute, /composerPrompt,/);
    assert.match(generateRoute, /composerInsertedPrompts,/);
    assert.match(multimodeRoute, /normalizeComposerPrompt/);
    assert.match(multimodeRoute, /composerPrompt,/);
    assert.match(multimodeRoute, /composerInsertedPrompts,/);
    assert.match(historyList, /composerPrompt: meta\?\.composerPrompt/);
    assert.match(historyList, /composerInsertedPrompts: meta\?\.composerInsertedPrompts/);
  });

  it("adds grouped sidebar history without replacing the legacy history strip", () => {
    const main = readSource("ui/src/main.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const sidebarHistory = readSource("ui/src/components/history/SidebarHistory.tsx");
    const historyLib = readSource("ui/src/lib/history/sidebarHistory.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    const css = readSource("ui/src/styles/sidebar-history.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(main, /styles\/sidebar-history\.css/);
    assert.match(sidebar, /SidebarHistory/);
    assert.match(sidebar, /workspaceSettings\.multimodeHistoryGrouping === "sequence"/);
    assert.match(sidebarHistory, /groupSidebarHistoryEntries/);
    assert.match(sidebarHistory, /showHistorySequence/);
    assert.match(sidebarHistory, /trashHistorySequence/);
    assert.match(historyLib, /export function groupSidebarHistoryEntries/);
    assert.match(historyLib, /sequence:/);
    assert.match(store, /showHistorySequence: \(sequenceId: string\) => void/);
    assert.match(store, /trashHistorySequence: \(sequenceId: string\) => Promise<void>/);
    assert.match(store, /const previewId = `history:\$\{sequenceId\}`/);
    assert.match(store, /removeImageFromMultimodeSequences/);
    assert.match(css, /\.sidebar-history__sequence-grid/);
    assert.equal(typeof en.history.recentTitle, "string");
    assert.equal(typeof en.history.deleteSequenceConfirm, "string");
    assert.equal(typeof ko.history.recentTitle, "string");
    assert.equal(typeof ko.history.deleteSequenceConfirm, "string");
    assert.ok(lineCount("ui/src/components/history/SidebarHistory.tsx") < 500);
    assert.ok(lineCount("ui/src/styles/sidebar-history.css") < 500);
  });

  it("routes prompt studio classic desktop to bottom composer layout", () => {
    const app = readSource("ui/src/App.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const workspaceProfile = readSource("ui/src/lib/workspaceProfile.ts");
    const classicWorkspace = readSource("ui/src/components/classic/ClassicWorkspace.tsx");
    const promptComposer = readSource("ui/src/components/PromptComposer.tsx");
    const css = readSource("ui/src/styles/classic-workspace.css");

    assert.match(workspaceProfile, /composerPlacement: "bottom"/);
    assert.match(app, /app--prompt-studio/);
    assert.match(app, /const showHistoryStrip = !promptStudioClassic/);
    assert.match(app, /promptStudioClassic \? <ClassicWorkspace \/> : <Canvas \/>/);
    assert.match(sidebar, /promptStudioDesktop \?/);
    assert.match(sidebar, /<SidebarHistory \/>/);
    assert.match(classicWorkspace, /<PromptComposer variant="bottom" \/>/);
    assert.match(classicWorkspace, /<GenerateButton \/>/);
    assert.match(promptComposer, /variant\?: "sidebar" \| "bottom"/);
    assert.match(promptComposer, /composer--\$\{variant\}/);
    assert.match(css, /\.classic-workspace\s*\{/);
    assert.match(css, /\.composer--bottom/);
    assert.ok(lineCount("ui/src/components/classic/ClassicWorkspace.tsx") < 500);
    assert.ok(lineCount("ui/src/styles/classic-workspace.css") < 500);
  });

  it("caps prompt studio bottom composer before it can starve the image viewer", () => {
    const promptComposer = readSource("ui/src/components/PromptComposer.tsx");
    const css = readSource("ui/src/styles/classic-workspace.css");

    assert.match(promptComposer, /parseCssPixelValue/);
    assert.match(promptComposer, /window\.getComputedStyle\(el\)\.maxHeight/);
    assert.match(promptComposer, /Math\.min\(.*scrollHeight.*,.*maxHeight/);
    assert.match(css, /grid-template-rows:\s*minmax\(280px, 1fr\) auto/);
    assert.match(css, /\.classic-workspace__dock\s*\{[\s\S]*?max-height:\s*min\(34dvh, 260px\)/);
    assert.match(css, /\.classic-workspace__dock\s*\{[\s\S]*?overflow:\s*hidden/);
    assert.match(css, /\.composer--bottom\s*\{[\s\S]*?--composer-textarea-max-height:\s*148px/);
    assert.match(css, /\.composer--bottom \.composer__prompt-chips\s*\{[\s\S]*?max-height:\s*min\(10dvh, 82px\)/);
    assert.match(css, /\.classic-workspace__stage \.result-img\s*\{[\s\S]*?max-height:\s*100%/);
  });

  it("renders video items with thumbnail img + play badge in sidebar history cards and supports drag", () => {
    const imageCard = readSource("ui/src/components/history/SidebarHistoryImageCard.tsx");
    const sequenceCard = readSource("ui/src/components/history/SidebarHistorySequenceCard.tsx");

    assert.match(imageCard, /isVideoItem/);
    assert.match(imageCard, /buildVideoDragPayload/);
    assert.match(imageCard, /play-badge/);
    assert.match(imageCard, /item\.thumb/);
    assert.match(imageCard, /draggable/);
    assert.match(imageCard, /onDragStart/);
    assert.match(imageCard, /application\/ima2-ref/);
    assert.match(imageCard, /title=\{item\.prompt/);

    assert.match(sequenceCard, /item\.thumb/);
  });

  it("extracts classic viewer zoom and pan controls into hook, component, and CSS", () => {
    const main = readSource("ui/src/main.tsx");
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const hook = readSource("ui/src/hooks/useViewerTransform.ts");
    const controls = readSource("ui/src/components/viewer/ViewerControls.tsx");
    const css = readSource("ui/src/styles/viewer-workflow.css");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.match(main, /styles\/viewer-workflow\.css/);
    assert.match(canvas, /useViewerTransform\(imageKey\)/);
    assert.ok(
      canvas.indexOf("useViewerTransform(imageKey)") <
        canvas.indexOf("if (canvasOpen && currentImage)"),
      "viewer transform hook must run before canvas-mode early return",
    );
    assert.match(canvas, /ViewerControls/);
    assert.match(canvas, /canvas-annotation-frame--zoomed/);
    assert.match(hook, /export const VIEWER_MAX_ZOOM = 5/);
    assert.match(hook, /handlePointerDown/);
    assert.match(hook, /handleWheel/);
    assert.match(controls, /viewer-control-btn--label/);
    assert.match(css, /--canvas-empty-dot-rgb/);
    assert.match(css, /\.viewer-controls/);
    assert.equal(typeof en.viewer.controls, "string");
    assert.equal(typeof ko.viewer.controls, "string");
    assert.ok(lineCount("ui/src/hooks/useViewerTransform.ts") < 500);
    assert.ok(lineCount("ui/src/components/viewer/ViewerControls.tsx") < 500);
    assert.ok(lineCount("ui/src/styles/viewer-workflow.css") < 500);
  });
});
