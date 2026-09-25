import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("multimode frontend UX contract", () => {
  it("reuses the existing count picker row while binding multimode to max images", () => {
    const countPicker = readSource("ui/src/components/CountPicker.tsx");
    const controls = readSource("ui/src/components/GenerationControlsPanel.tsx");

    assert.match(countPicker, /const QUICK_COUNTS = \[1, 2, 4\] as const/);
    assert.match(countPicker, /const uiMode = useAppStore\(\(s\) => s\.uiMode\)/);
    assert.match(countPicker, /const multimodeEnabled = useAppStore\(\(s\) => s\.multimode\)/);
    assert.match(countPicker, /const multimodeMaxImages = useAppStore\(\(s\) => s\.multimodeMaxImages\)/);
    assert.match(countPicker, /const multimode = uiMode === "classic" && multimodeEnabled/);
    assert.match(countPicker, /const value = multimode \? multimodeMaxImages : count/);
    assert.match(countPicker, /normalizeGenerationCount\(Number\.parseInt\(value, 10\)\)/);
    assert.match(controls, /const showMultimodeControls = uiMode === "classic"/);
    assert.match(controls, /className=\{`multimode-toggle__button/);
    assert.doesNotMatch(controls, /disabled=\{activeGenerations > 0\}/);
    assert.doesNotMatch(controls, /toggleDisabledGenerating/);
  });

  it("branches generate into a separate multimode streaming flow", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const api = readSource("ui/src/lib/api.ts");

    assert.match(store, /multimodeMaxImages: Count/);
    assert.match(store, /activeFlightIds:\s*Set<string>/);
    assert.match(store, /multimodeSequences:\s*Record<string,\s*MultimodeSequenceState>/);
    assert.match(store, /multimodePreviewFlightId:\s*string\s*\|\s*null/);
    // Behavior is independently exercised by core-generation-mode and actual transport tests.
    assert.match(store, /const mode = effectiveCoreGenerationMode\(s\)/);
    assert.match(store, /const useMultimode = mode === "multimode"/);
    assert.match(store, /if \(useMultimode\) \{[\s\S]*?await get\(\)\.generateMultimode\(\);[\s\S]*?return;[\s\S]*?\}/);
    assert.match(store, /if \(enabled && get\(\)\.uiMode !== "classic"\) return/);
    assert.match(store, /if \(s\.uiMode !== "classic"\) return/);
    assert.match(store, /postMultimodeGenerateStream\(/);
    assert.match(store, /signal: controller\.signal/);
    assert.match(store, /cancelMultimode: \(\) =>/);
    assert.match(api, /postMultimodeGenerateStream/);
    assert.match(api, /signal\?: AbortSignal/);
  });

  it("keeps multimode sequence rendering separate from currentImage", () => {
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const preview = readSource("ui/src/components/MultimodeSequencePreview.tsx");
    const types = readSource("ui/src/types.ts");
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(canvas, /multimodeSequence \? \(/);
    assert.match(canvas, /<MultimodeSequencePreview \/>/);
    assert.match(preview, /sequence\.requested/);
    assert.match(preview, /cancelMultimode/);
    assert.match(types, /export type MultimodeSequenceStatus = "pending" \| "partial" \| "complete" \| "empty" \| "error" \| "canceled"/);
    assert.match(types, /sequenceId\?: string \| null/);
    assert.match(types, /sequenceTotalRequested\?: number \| null/);
    assert.match(store, /sequenceId: it\.sequenceId \?\? null/);
    assert.match(store, /sequenceStatus: it\.sequenceStatus \?\? null/);
  });

  it("reconciles multimode in-flight phase and treats user cancellation as canceled", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const api = readSource("ui/src/lib/api.ts");
    const preview = readSource("ui/src/components/MultimodeSequencePreview.tsx");

    assert.match(api, /kind\?: "classic" \| "node" \| "multimode"/);
    assert.match(store, /type InflightQueryScope = \{/);
    assert.match(store, /kind: NonNullable<PersistedInFlight\["kind"\]>/);
    assert.match(store, /job\.kind === "multimode"/);
    assert.match(store, /scopes\.push\(\{ kind: "multimode" \}\)/);
    // Real phase/scope outcomes for both public reconciliation actions are covered
    // by inflight-reload-reconcile-contract.test.ts, including storage-only multimode.
    assert.doesNotMatch(store, /hasMultimode && state\.uiMode !== "node"/);
    assert.match(store, /status: "canceled"/);
    assert.doesNotMatch(store, /status: current\.images\.length > 0 \? "partial" : "empty"/);
    assert.match(preview, /canCancelSequence/);
    assert.match(preview, /activeFlightIds\.has\(id\)/);
    assert.match(preview, /s\.inFlight\.some\(\(job\) => job\.id === id\)/);
    assert.doesNotMatch(preview, /activeGenerations > 0/);
    assert.match(preview, /loosePartials\.shift\(\)/);
    assert.match(preview, /multimode\.notReturned/);
    assert.match(preview, /sequence\.status === "canceled"/);
    assert.match(preview, /multimode\.canceled/);
  });

  it("adds multimode copy and upper-bound cost display", () => {
    const cost = readSource("ui/src/components/CostEstimate.tsx");
    const composer = readSource("ui/src/components/PromptComposer.tsx");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");
    const css = readSource("ui/src/index.css");

    assert.match(cost, /multimodeMaxImages/);
    assert.match(cost, /cost \* multimodeMaxImages/);
    assert.match(composer, /const multimode = useAppStore\(composerUsesMultimode\)/);
    assert.match(composer, /composer--multimode/);
    assert.match(composer, /role="group"/);
    assert.match(composer, /multimode\.composerAriaLabel/);
    assert.match(composer, /multimode\.composerBadge/);
    assert.match(composer, /multimode\.promptPlaceholder/);
    assert.match(en, /"multimode"/);
    assert.match(en, /"multimodeApprox"/);
    assert.match(en, /"composerBadge"/);
    assert.match(en, /"composerAriaLabel"/);
    assert.match(en, /"promptPlaceholder"/);
    assert.match(ko, /"multimode"/);
    assert.match(ko, /"multimodeApprox"/);
    assert.match(ko, /"composerBadge"/);
    assert.match(ko, /"composerAriaLabel"/);
    assert.match(ko, /"promptPlaceholder"/);
    assert.match(css, /\.multimode-sequence/);
    assert.match(css, /\.multimode-toggle__button/);
    assert.match(css, /\.composer--multimode/);
    assert.match(css, /\.composer__mode-badge/);
  });
});
