import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("provider UI contract", () => {
  it("renders provider selection as one grouped logo-free dropdown (060)", () => {
    const select = readSource("ui/src/components/settings/ProviderStatusSelect.tsx");

    assert.match(select, /CORE_ENTRIES/);
    assert.match(select, /status-dot/);
    assert.match(select, /value: "grok-api"/);
    assert.match(select, /value: "gemini-api"/);
    assert.match(select, /value: "comfy"/);
    assert.match(select, /CORE_PROVIDER_IDS/);
    assert.match(select, /comfy\.display\.localMethod/);
    assert.doesNotMatch(select, /authActive.*comfy/);
    assert.match(select, /setProvider\(next\)/);
    assert.doesNotMatch(select, /ProviderCard/);
    assert.doesNotMatch(select, /getProviderIdentity/);
  });

  it("owns logo-free provider pill styles outside toast-modal css", () => {
    const indexCss = readSourceTree("ui/src/index.css");
    const providerCss = readSource("ui/src/styles/provider-controls.css");
    const toastCss = readSource("ui/src/styles/toast-modal.css");

    assert.match(indexCss, /@import "\.\/styles\/provider-controls\.css";/);
    assert.match(providerCss, /\.provider-status-select/);
    assert.match(providerCss, /\.provider-status-line/);
    assert.match(providerCss, /\.provider-auth-chip/);
    assert.match(providerCss, /\.status-dot--ok/);
    assert.match(providerCss, /\.status-dot--bad/);
    assert.match(providerCss, /\.status-dot--warn/);
    assert.doesNotMatch(providerCss, /provider-card/);
    assert.doesNotMatch(providerCss, /provider-card__mark/);
    assert.doesNotMatch(toastCss, /\.provider-grid/);
  });

  it("keeps the provider dropdown accessible and stable", () => {
    const select = readSource("ui/src/components/settings/ProviderStatusSelect.tsx");
    const primitive = readSource("ui/src/components/controls/Select.tsx");
    const css = readSource("ui/src/styles/provider-controls.css");

    assert.match(select, /ariaLabel=\{t\("provider\.authTitle"\)\}/);
    // Select-only combobox contract (060 audit A2).
    assert.match(primitive, /role="combobox"/);
    // wp4 (040_mcp_settings_states): activedescendant only references options that exist.
    assert.match(primitive, /aria-activedescendant=\{open && flat\[activeIndex\] \? optionId\(activeIndex\) : undefined\}/);
    assert.match(primitive, /const typeahead = /);
    assert.match(css, /min-height:\s*44px/);
  });

  it("keeps Agent mode model control on the existing dropdown pattern", () => {
    const agent = readSource("ui/src/components/agent/AgentModelSelector.tsx");
    const css = readSource("ui/src/styles/provider-controls.css");

    assert.match(agent, /image-model-select__trigger--pill/);
    assert.match(agent, /image-model-select__menu/);
    assert.match(agent, /AGENT_LLM_MODEL_OPTIONS/);
    assert.match(agent, /getAgentLlmModelOption/);
    assert.match(agent, /REASONING_EFFORT_OPTIONS/);
    assert.match(agent, /provider: option\.provider/);
    assert.doesNotMatch(agent, /OPENAI_IMAGE_MODEL_OPTIONS/);
    assert.doesNotMatch(agent, /<select value=\{settings\.provider\}/);
    assert.doesNotMatch(agent, /ProviderCard/);
    assert.doesNotMatch(agent, /getProviderIdentity/);
    assert.doesNotMatch(agent, /agent-provider-options/);
    assert.doesNotMatch(css, /\.agent-provider-options/);
  });

  it("moves Gemini API compatibility copy and grid layout out of inline React branches", () => {
    const controls = readSource("ui/src/components/GenerationControlsPanel.tsx");
    const settings = readSource("ui/src/components/SettingsWorkspace.tsx");
    const css = readSource("ui/src/styles/provider-controls.css");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(controls, /providerCompat/);
    assert.match(controls, /t\("provider\.geminiApiCompatTitle"\)/);
    assert.match(controls, /t\("provider\.geminiApiCompatBody"\)/);
    assert.match(controls, /OptionGroup<GeminiImageModel>/);
    assert.match(controls, /className="gemini-resolution-grid"/);
    assert.doesNotMatch(controls, /Google Gemini API\. Supports aspect ratio/);
    assert.doesNotMatch(controls, /style=\{\{ lineHeight/);
    assert.doesNotMatch(controls, /gridTemplateColumns/);
    assert.match(settings, /t\("provider\.geminiApiCompatBodyLong"\)/);
    assert.doesNotMatch(settings, /Google Gemini API direct/);
    assert.match(css, /\.gemini-resolution-grid/);
    assert.match(en, /"geminiApiCompatBody"/);
    assert.match(ko, /"geminiApiCompatBody"/);
  });
});
