import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("generation controls custom plus UX contract", () => {
  it("keeps the right panel as the generation control home", () => {
    const rightPanel = readSource("ui/src/components/RightPanel.tsx");
    const controls = readSource("ui/src/components/GenerationControlsPanel.tsx");

    assert.match(rightPanel, /import \{ GenerationControlsPanel \} from "\.\/GenerationControlsPanel"/);
    assert.match(rightPanel, /lazy\(\(\) =>\s*import\("\.\/PromptLibraryPanel"\)/);
    assert.match(rightPanel, /<GenerationControlsPanel \/>/);
    assert.match(rightPanel, /promptLibraryOpen/);
    assert.match(rightPanel, /<LazyPromptLibraryPanel variant="embedded" \/>/);
    assert.match(rightPanel, /right-panel-tabs/);
    assert.doesNotMatch(rightPanel, /COUNT_ITEMS/);
    assert.match(controls, /import \{ SizePicker \} from "\.\/SizePicker"/);
    assert.match(controls, /import \{ CountPicker \} from "\.\/CountPicker"/);
    assert.match(controls, /<SizePicker \/>/);
    assert.doesNotMatch(controls, /isGrok \? null : \(\s*<>\s*<SizePicker \/>/);
    assert.match(controls, /<CountPicker \/>/);
    assert.match(controls, /<ProviderStatusSelect mcpProviders=\{mcpProviders\} \/>/);
    assert.match(controls, /const showMultimodeControls = uiMode === "classic"/);
  });

  it("preserves the existing size preset grid and visible auto option", () => {
    const sizePicker = readSource("ui/src/components/SizePicker.tsx");
    const sizeLib = readSource("ui/src/lib/size.ts");

    for (const row of ["SIZE_PRESETS_ROW1", "SIZE_PRESETS_ROW2", "SIZE_PRESETS_ROW3", "SIZE_PRESETS_ROW4"]) {
      assert.match(sizePicker, new RegExp(`toItems\\(${row}\\)`));
    }
    assert.match(sizePicker, /getSizePresetsRow5\(\)\.filter\(\(item\) => item\.value === "auto"\)/);
    assert.match(sizeLib, /value: "auto"/);
    assert.match(sizeLib, /value: "3840x2160"/);
    assert.match(sizeLib, /value: "2160x3840"/);
    assert.doesNotMatch(sizeLib, /3824x2160/);
    assert.doesNotMatch(sizeLib, /2160x3824/);
  });

  it("keeps arbitrary custom slot sizes out of the SizePreset union", () => {
    const types = readSource("ui/src/types.ts");

    assert.match(types, /export type SizePreset =/);
    assert.match(types, /"3840x2160"/);
    assert.match(types, /"2160x3840"/);
    assert.match(types, /"custom"/);
    assert.doesNotMatch(types, /"2400x1024"/);
    assert.doesNotMatch(types, /"3840x1648"/);
  });

  it("caps saved custom size slots at three and uses explicit replace behavior", () => {
    const sizeLib = readSource("ui/src/lib/size.ts");
    const slotLib = readSource("ui/src/lib/customSizeSlots.ts");
    const sizePicker = readSource("ui/src/components/SizePicker.tsx");

    assert.match(sizeLib, /export const MAX_CUSTOM_SIZE_SLOTS = 3/);
    assert.match(slotLib, /CUSTOM_SIZE_SLOTS_STORAGE_KEY = "ima2\.customSizeSlots"/);
    assert.match(slotLib, /replaceCustomSizeSlot/);
    assert.match(sizePicker, /slots\.length >= MAX_CUSTOM_SIZE_SLOTS/);
    assert.match(sizePicker, /setReplaceSlotId/);
    assert.match(sizePicker, /replaceCustomSizeSlot\(slots, replaceSlotId, normalized\)/);
  });

  it("collapses the custom editor when another size option is selected or saved", () => {
    const sizePicker = readSource("ui/src/components/SizePicker.tsx");

    assert.match(sizePicker, /function selectPreset\(nextPreset: SizePreset\)/);
    assert.match(sizePicker, /if \(nextPreset !== "custom"\) \{[\s\S]*?setEditorOpen\(false\);[\s\S]*?setReplaceSlotId\(null\);[\s\S]*?\}/);
    assert.match(sizePicker, /onChange=\{selectPreset\}/);
    assert.match(sizePicker, /onClick=\{\(\) => selectPreset\(item\.value\)\}/);
    assert.match(sizePicker, /setEditorOpen\(false\);[\s\S]*?\}\r?\n\r?\n  const reasonText =/);
  });

  it("offers 21:9 only as a custom ratio preset", () => {
    const sizeLib = readSource("ui/src/lib/size.ts");

    assert.match(sizeLib, /CUSTOM_RATIO_PRESETS/);
    assert.match(sizeLib, /id: "21:9"/);
    assert.doesNotMatch(sizeLib, /value: "21:9"/);
  });

  it("supports manual count input clamped to the shared generation count limit", () => {
    const countPicker = readSource("ui/src/components/CountPicker.tsx");
    const limits = readSource("ui/src/lib/generationLimits.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    const persistence = readSource("ui/src/store/storePersistence.ts");

    assert.match(countPicker, /const QUICK_COUNTS = \[1, 2, 4\] as const/);
    assert.match(countPicker, /inputMode="numeric"/);
    assert.match(countPicker, /normalizeGenerationCount\(Number\.parseInt\(value, 10\)\)/);
    assert.match(limits, /export const MAX_GENERATION_COUNT = 24/);
    assert.match(limits, /Math\.min\(MAX_GENERATION_COUNT, Math\.max\(1, Math\.trunc\(value \|\| 1\)\)\)/);
    assert.match(persistence, /function normalizeCount\(value: number\): Count/);
    assert.match(persistence, /return normalizeGenerationCount\(value\);/);
    assert.match(store, /const next = normalizeCount\(count\);/);
    assert.match(store, /saveGenerationDefaultsPatch\(\{ count: next \}\);/);
  });

  it("persists prompt and generation presets across refresh", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /GENERATION_DEFAULTS_STORAGE_KEY = "ima2\.generationDefaults"/);
    assert.match(store, /function loadGenerationDefaults\(\): GenerationDefaults/);
    assert.match(store, /function saveGenerationDefaultsPatch\(patch: GenerationDefaults\): void/);
    assert.match(store, /prompt: storedGenerationDefaults\.prompt \?\? ""/);
    assert.match(store, /sizePreset: storedGenerationDefaults\.sizePreset \?\? "1024x1024"/);
    assert.match(store, /setPromptImpl[\s\S]*?saveGenerationDefaultsPatch\(\{ prompt \}\)/);
    assert.match(store, /setSizePresetImpl[\s\S]*?saveGenerationDefaultsPatch\(\{ sizePreset \}\)/);
    assert.match(store, /saveGenerationDefaultsPatch\(\{ insertedPrompts \}\);/);
  });

  it("exposes reasoning effort in the sidebar model quick menu", () => {
    const menu = readSource("ui/src/components/ImageModelSelect.tsx");
    const css = readSource("ui/src/index.css");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(menu, /REASONING_EFFORT_OPTIONS/);
    assert.match(menu, /const reasoningEffort = useAppStore\(\(s\) => s\.reasoningEffort\)/);
    assert.match(menu, /const setReasoningEffort = useAppStore\(\(s\) => s\.setReasoningEffort\)/);
    assert.match(menu, /const menuItemRefs = useRef<Array<HTMLButtonElement \| null>>\(\[\]\)/);
    assert.match(menu, /KeyboardEvent as ReactKeyboardEvent/);
    assert.match(menu, /const handleMenuKeyDown = \(event: ReactKeyboardEvent<HTMLDivElement>\) =>/);
    assert.match(menu, /event\.key === "ArrowDown" \|\| event\.key === "ArrowRight"/);
    assert.match(menu, /event\.key === "Home"/);
    assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
    assert.match(menu, /aria-haspopup="menu"/);
    assert.match(menu, /onKeyDown=\{handleMenuKeyDown\}/);
    assert.match(menu, /role="menuitemradio"/);
    assert.match(menu, /aria-checked=\{option\.value === reasoningEffort\}/);
    assert.match(menu, /tabIndex=\{-1\}/);
    assert.match(menu, /setReasoningEffort\(option\.value as ReasoningEffort\)/);
    assert.match(css, /\.image-model-select__section-title/);
    assert.match(css, /\.image-model-select__trigger-effort/);
    assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*?\.image-model-select__trigger-effort\s*\{[\s\S]*?display:\s*none/);
    assert.match(en, /"quickSettingsMenu":\s*"Model and reasoning quick settings"/);
    assert.match(ko, /"quickSettingsMenu":\s*"모델 및 추론 빠른 설정"/);
  });

  it("generation defaults survive reload simulation", () => {
    const src = readSource("ui/src/store/useAppStore.ts");

    for (const f of [
      "provider",
      "quality",
      "sizePreset",
      "customW",
      "customH",
      "format",
      "moderation",
      "count",
      "multimode",
      "multimodeMaxImages",
      "promptMode",
      "prompt",
      "insertedPrompts",
    ]) {
      assert.match(src, new RegExp(`\\bparsed\\.${f}\\b`), `loadGenerationDefaults missing ${f}`);
    }
  });

  it("updates 3840 constraints across cost, i18n, and contracts", () => {
    const cost = readSource("ui/src/lib/cost.ts");
    const sizeLib = readSource("ui/src/lib/size.ts");
    const sizePicker = readSource("ui/src/components/SizePicker.tsx");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(cost, /"3840x2160"/);
    assert.match(cost, /"2160x3840"/);
    assert.doesNotMatch(cost, /3824x2160/);
    assert.match(sizeLib, /export const IMAGE_SIZE_MAX_SQUARE/);
    assert.match(sizePicker, /squareMaxHint/);
    assert.match(sizePicker, /preview\.reasons\.includes\("maxPixels"\)/);
    assert.match(sizePicker, /IMAGE_SIZE_MAX_SQUARE/);
    assert.match(en, /max edge 3840/);
    assert.match(en, /Square maximum is \{size\}/);
    assert.match(ko, /최대 변 3840/);
    assert.match(ko, /정사각형 최대는 \{size\}/);
    for (const source of [en, ko]) {
      assert.match(source, /"customPlus"/);
      assert.match(source, /"customSlotLimit"/);
      assert.match(source, /"count"/);
      assert.match(source, /"highCountHint"/);
    }
  });
});
