import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const readSource = (path) => readFileSync(join(root, path), "utf8");

function leafPaths(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("MCP provider UI contract", () => {
  it("uses the canonical APIs and pre-opens then cleans up the OAuth popup", () => {
    const source = readSource("ui/src/lib/mcpProviders.ts");

    assert.match(source, /jsonFetch<McpProvidersResponse>\("\/api\/mcp\/providers"/);
    assert.match(source, /window\.open\("about:blank"/);
    assert.match(source, /popup\.location\.href = authorizationUrl/);
    assert.match(source, /catch \(error\) \{\s*popup\?\.close\(\)/);
    assert.match(source, /\/api\/contracts\/\$\{encodeURIComponent\(toolId\)\}/);
    assert.match(source, /inputSchema\?\.properties\?\.model\?\.enum/);
    assert.match(source, /jsonFetch<\{ ok: boolean; requestId: string \}>\("\/api\/mcp\/generate"/);
  });

  it("normalizes MCP completion through history refresh without classic image injection", () => {
    const api = readSource("ui/src/lib/mcpProviders.ts");
    const settings = readSource("ui/src/store/storeSettingsImpl.ts");

    assert.match(api, /subscribe\(requestId, null/);
    assert.match(api, /event === "done"/);
    assert.match(api, /filename: data\.filename/);
    assert.match(api, /mediaType: data\.mediaType/);
    assert.match(settings, /onDone: \(\) => \{\s*get\(\)\.hydrateHistory\(\);\s*settleGeneration\(\)/);
    assert.match(settings, /`mcp_ui_\$\{Date\.now\(\)\}`/);
    assert.doesNotMatch(settings, /res\.image|addGeneratedHistoryItem/);
  });

  it("merges asset candidates and owns temporary local-reference cleanup through SSE settlement", () => {
    const slots = readSource("ui/src/components/settings/McpReferenceSlots.tsx");
    const settings = readSource("ui/src/store/storeSettingsImpl.ts");

    assert.match(slots, /state\.assets/);
    assert.match(slots, /asset\.kind === "image" \|\| asset\.kind === "element"/);
    assert.match(slots, /mp4\|mov/);
    assert.match(slots, /readFileAsDataURL/);
    assert.match(slots, /referenceTagInvalid/);
    assert.match(settings, /"\/api\/mcp\/temp-references"/);
    assert.match(settings, /body: JSON\.stringify\(\{ images:/);
    assert.match(settings, /await generationSettled;\s*if \(followupError\) throw followupError/);
    assert.match(settings, /hasInvalidMcpReferenceTags\(referenceSelection\)/);
    assert.match(settings, /finally \{\s*if \(tempBatchId\) await deleteMcpTempReferences\(tempBatchId\)/);
    assert.match(settings, /\/api\/mcp\/temp-references\/\$\{encodeURIComponent\(batchId\)\}/);
  });

  it("keeps core and MCP lanes exclusive and persists opaque provider ids", () => {
    const types = readSource("ui/src/store/storeTypes.ts");
    const settings = readSource("ui/src/store/storeSettingsImpl.ts");
    const persistence = readSource("ui/src/store/storePersistence.ts");

    assert.match(types, /mcpProvider\?: string \| null/);
    assert.match(types, /mcpModel\?: string \| null/);
    assert.match(types, /mcpMediaKind\?: "image" \| "video"/);
    assert.match(settings, /setMcpProviderImpl/);
    assert.match(settings, /clearMcpLane\(set\)/);
    assert.match(settings, /count: 1/);
    assert.match(settings, /multimode: false/);
    assert.match(persistence, /typeof mcpProvider === "string"/);
    assert.match(
      persistence,
      /saveMcpSelection\(\s*provider: string \| null,\s*model: string \| null,\s*kind: "image" \| "video" = "image",?\s*\)/,
    );
    assert.match(persistence, /parsed\.mcpMediaKind === "image" \|\| parsed\.mcpMediaKind === "video"/);
  });

  it("routes MCP media kind through the store lane, not the core video flag", () => {
    const settings = readSource("ui/src/store/storeSettingsImpl.ts");
    const select = readSource("ui/src/components/GenProviderModelSelect.tsx");
    const selection = readSource("ui/src/lib/mcpSelection.ts");

    assert.match(settings, /buildMcpGenerationInput\(/);
    assert.doesNotMatch(settings, /state\.videoModelSelected \? "video" : "image"/);
    assert.match(settings, /setMcpMediaKindImpl/);
    assert.match(settings, /setMcpModelWithKindImpl/);
    assert.match(settings, /persistedKind \?\? get\(\)\.mcpMediaKind \?\? "image"/);
    assert.match(select, /getMcpModelCatalog/);
    assert.match(select, /encodeMcpModelValue\("image", entry\.id\)/);
    assert.match(select, /encodeMcpModelValue\("video", entry\.id\)/);
    assert.doesNotMatch(select, /const mediaKind = videoModel/);
    assert.match(selection, /\.\.\.\(ratio \? \{ ratio \} : \{\}\)/);
  });

  it("pins the provider dropdown on top of Settings and swaps per-provider sections (060)", () => {
    const panel = readSource("ui/src/components/GenerationControlsPanel.tsx");
    const providerSelect = readSource("ui/src/components/settings/ProviderStatusSelect.tsx");
    const mcpControls = readSource("ui/src/components/settings/McpGenerationControls.tsx");
    const presetControls = readSource("ui/src/components/settings/McpModelPresetControls.tsx");
    const settings = readSource("ui/src/store/storeSettingsImpl.ts");
    const persistence = readSource("ui/src/store/storePersistence.ts");

    // The Variant D dropdown is the first child in BOTH panel branches; the
    // retired grid + status strip must stay deleted (060).
    assert.match(panel, /<div className="right-panel-settings" role="tabpanel">\s*<ProviderStatusSelect mcpProviders=\{mcpProviders\} \/>\s*<McpGenerationControls/);
    assert.match(panel, /<div className="right-panel-settings" role="tabpanel">\s*<ProviderStatusSelect mcpProviders=\{mcpProviders\} \/>/);
    assert.doesNotMatch(panel, /ProviderStatusStrip|<ProviderSelect /);
    assert.equal(existsSync(join(root, "ui/src/components/ProviderSelect.tsx")), false);
    assert.equal(existsSync(join(root, "ui/src/components/settings/ProviderStatusStrip.tsx")), false);
    // Single-parent poller: the dropdown receives providers via props.
    assert.doesNotMatch(providerSelect, /useMcpProviders\(/);
    assert.match(panel, /const \{ providers: mcpProviders \} = useMcpProviders\(\)/);
    // No simultaneous core+MCP active state: the selected value is derived
    // from mcpProvider first, so an active MCP lane never shows a core value.
    assert.match(providerSelect, /const selectedValue = mcpProvider \? `\$\{MCP_PREFIX\}\$\{mcpProvider\}` : `\$\{CORE_PREFIX\}\$\{provider\}`/);
    // MCP entry invariant matches the sidebar selector (enabled && connected).
    assert.match(providerSelect, /!record \|\| !record\.enabled \|\| record\.status\.state !== "connected"/);
    // mcpRatio lifecycle: whitelist parse, persistent clear-to-Auto, Auto omission.
    assert.match(persistence, /normalizeMcpRatio\(parsed\.mcpRatio\)/);
    assert.match(settings, /saveGenerationDefaultsPatch\(\{ mcpRatio: null, mcpParameters: \{\} \}\)/);
    assert.match(settings, /setMcpRatioImpl/);
    assert.match(mcpControls, /McpModelPresetControls/);
    assert.doesNotMatch(mcpControls, /models\.map\(/);
    assert.match(presetControls, /parameterPresetValues/);
    assert.match(presetControls, /advancedPresetsLabel/);
    assert.match(presetControls, /toolInputsLabel/);
    assert.match(settings, /setMcpParameterImpl/);
    assert.match(mcpControls, /higgsfieldLocked/);
  });

  it("uses one canonical enriched catalog endpoint and preserves retry semantics", () => {
    const api = readSource("ui/src/lib/mcpProviders.ts");
    const select = readSource("ui/src/components/GenProviderModelSelect.tsx");

    assert.match(api, /\/api\/mcp\/providers\/\$\{encodeURIComponent\(provider\)\}\/models/);
    assert.doesNotMatch(api, /Promise\.all\(\[settle\("image"\), settle\("video"\)\]\)/);
    assert.match(select, /setCatalogError\(true\)/);
    assert.match(select, /setCatalogRetryToken/);
    assert.match(select, /reconcileMcpPresetStateImpl/);
  });

  it("renders the sidebar selector with the shared ctl-select skin, not native selects", () => {
    const select = readSource("ui/src/components/GenProviderModelSelect.tsx");
    const kit = readSource("ui/src/components/controls/Select.tsx");

    assert.doesNotMatch(select, /<select/);
    assert.match(select, /<Select\b/);
    assert.match(select, /portal/);
    assert.match(kit, /groups\?: ReadonlyArray<SelectGroup<V>>/);
    assert.match(kit, /createPortal\(list, document\.body\)/);
    assert.match(kit, /listRef\.current\?\.contains\(target\)/);
    // Issue #119: the capture-phase scroll listener stays, but it now runs a
    // guarded handler so scrolling the portaled list itself does not dismiss it.
    assert.match(kit, /window\.addEventListener\("scroll", closeOnScroll, true\)/);
    assert.match(kit, /shouldDismissOnScroll\(event, listRef\.current\)/);
    assert.match(kit, /triggerRef\.current\?\.focus\(\)/);
  });

  it("derives the execution lock from the server record, never a provider-id hardcode (260723)", () => {
    const select = readSource("ui/src/components/GenProviderModelSelect.tsx");
    const settings = readSource("ui/src/store/storeSettingsImpl.ts");
    const controls = readSource("ui/src/components/settings/McpGenerationControls.tsx");
    const connections = readSource("ui/src/components/settings/McpProviderConnections.tsx");
    const adapter = readSource("lib/mcp/adapters/higgsfield.ts");
    const catalog = readSource("lib/mcp/modelsCatalog.ts");
    const api = readSource("ui/src/lib/mcpProviders.ts");

    // Browse unlock: no provider-item disable, no selection rejection, no synthetic locked row.
    assert.doesNotMatch(select, /disabled: entry\.id === "higgsfield"/);
    assert.doesNotMatch(select, /record\.id === "higgsfield" \|\|/);
    assert.doesNotMatch(select, /higgsfield-locked/);
    assert.match(select, /lockedNotice/);
    // Server-derived lock: executable flag drives every surface, no id hardcode.
    assert.match(settings, /getCachedMcpProviders/);
    assert.match(settings, /mcpRecord\?\.executable === false/);
    assert.doesNotMatch(settings, /state\.mcpProvider === "higgsfield"/);
    assert.match(settings, /higgsfieldLocked/);
    assert.match(controls, /record\?\.executable === false/);
    assert.doesNotMatch(controls, /mcpProvider === "higgsfield"/);
    assert.match(connections, /provider\.executable === false/);
    assert.doesNotMatch(connections, /provider\.id === "higgsfield"/);
    assert.match(api, /executable\?: boolean/);
    assert.match(api, /lockReason\?: string/);
    // Adapter stays executable with the billing denylist intact.
    assert.match(adapter, /executable: true/);
    assert.match(adapter, /confirm_billing_purchase/);
    // Catalog resolver: single read-only tool constant; UI fallback endpoint.
    assert.match(catalog, /READONLY_CATALOG_TOOL = "models_explore"/);
    assert.doesNotMatch(catalog, /generate_image|generate_video|upscale|billing/);
    assert.match(api, /\/api\/mcp\/providers\/\$\{encodeURIComponent\(provider\)\}\/models/);
    // Settings: catalog effect no longer gated by the lock; presets remain visible but disabled.
    assert.doesNotMatch(controls, /!mcpProvider \|\| locked \|\| !connected/);
    assert.match(controls, /disabled=\{locked\}/);
    assert.doesNotMatch(controls, /mcp-generation-controls__models/);
  });

  it("shows connected MCP providers only, preserves unknown selection, and surfaces lock notices", () => {
    const select = readSource("ui/src/components/GenProviderModelSelect.tsx");

    assert.match(select, /status\.state === "connected"/);
    assert.match(select, /mcpProvider && !connectedMcpProviders\.some/);
    assert.match(select, /selectedMcpRecord\?\.executable === false/);
    assert.doesNotMatch(select, /selectedMcpRecord\?\.id === "higgsfield"/);
    assert.match(select, /disabled=\{Boolean\(unavailableReason\)\}/);
    assert.match(select, /REASONING_EFFORT_OPTIONS/);
    assert.match(select, /getImageModelOptionsForProvider/);
    assert.match(select, /getMcpModelCatalog/);
    assert.match(select, /mcpModel && !mcpModelKnown/);
  });

  it("uses the split selector only outside Agent mode", () => {
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const mobile = readSource("ui/src/components/MobileAppBar.tsx");

    assert.match(sidebar, /<GenProviderModelSelect compact=\{isMobile\} \/>/);
    assert.doesNotMatch(sidebar, /<ImageModelSelect/);
    assert.match(mobile, /<GenProviderModelSelect compact \/>/);
    assert.doesNotMatch(mobile, /<ImageModelSelect/);
  });

  it("resyncs MCP generation and action jobs after reload", () => {
    const types = readSource("ui/src/store/storeTypes.ts");
    const helpers = readSource("ui/src/store/storeHelpers.ts");

    assert.match(types, /"mcp-image" \| "mcp-video" \| `mcp-action-\$\{string\}`/);
    assert.match(helpers, /if \(!matchesInflightScope\(job, scopes\)\)/);
    assert.match(helpers, /const kind = job\.kind \?\? "classic";[\s\S]*?kind === scope\.kind/);
    assert.match(helpers, /value === "mcp-image" \|\| value === "mcp-video"/);
    assert.match(helpers, /value\.startsWith\("mcp-action-"\)/);
  });

  it("keeps Korean and English MCP copy in recursive parity", () => {
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    assert.deepEqual(leafPaths(ko.mcp).sort(), leafPaths(en.mcp).sort());
    assert.equal(ko.mcp.billingUnknown, "미확인");
    assert.equal(en.mcp.billingUnknown, "Unknown");
  });
});
