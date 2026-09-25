import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), "utf8");

describe("MCP settings state contracts (F10-F13)", () => {
  it("tracks the catalog lifecycle with retry and abort-safe cleanup", () => {
    const source = readSource("ui/src/components/settings/McpGenerationControls.tsx");

    assert.match(source, /useState<"idle" \| "loading" \| "ready" \| "error">\("idle"\)/);
    assert.match(source, /const \[catalogRetryToken, setCatalogRetryToken\] = useState\(0\)/);
    assert.match(source, /setCatalogState\("loading"\)/);
    assert.match(source, /setCatalogState\("ready"\)/);
    assert.match(source, /setCatalogState\("error"\)/);
    assert.match(source, /name\?: string \}\)\.name === "AbortError"/);
    assert.match(source, /return \(\) => controller\.abort\(\)/);
    assert.match(source, /\[mcpProvider, connected, catalogRetryToken\]/);
  });

  it("renders distinct loading, error/retry, and ready-empty catalog states", () => {
    const source = readSource("ui/src/components/settings/McpGenerationControls.tsx");

    assert.match(source, /catalogState === "loading"[\s\S]*role="status"[\s\S]*t\("mcp\.loadingModels"\)/);
    assert.match(source, /catalogState === "error"[\s\S]*role="alert"[\s\S]*setCatalogRetryToken\(\(value\) => value \+ 1\)[\s\S]*t\("mcp\.retryModels"\)/);
    assert.match(source, /catalogState === "ready" && models\.length === 0[\s\S]*t\("mcp\.noModels"\)/);
  });

  it("orders transient catalog states before provider-default help", () => {
    const source = readSource("ui/src/components/settings/McpGenerationControls.tsx");
    const fallback = source.indexOf('t("mcp.providerDefaultsHelp")');
    const loading = source.indexOf('catalogState === "loading"');
    const error = source.indexOf('catalogState === "error"');
    const empty = source.indexOf('catalogState === "ready" && models.length === 0');

    assert.ok(fallback >= 0);
    assert.ok(loading >= 0 && loading < fallback);
    assert.ok(error >= 0 && error < fallback);
    assert.ok(empty >= 0 && empty < fallback);
  });

  it("guards empty Select opening and clears stale open state", () => {
    const source = readSource("ui/src/components/controls/Select.tsx");

    assert.match(source, /const isEmpty = flat\.length === 0/);
    assert.match(source, /const openList = \(\) => \{\s*if \(isEmpty\) return/);
    assert.match(source, /useEffect\(\(\) => \{\s*if \(!isEmpty\) return;\s*setOpen\(false\);\s*setActiveIndex\(0\);\s*\}, \[isEmpty\]\)/);
    assert.match(source, /aria-activedescendant=\{open && flat\[activeIndex\] \? optionId\(activeIndex\) : undefined\}/);
  });

  it("disables empty Select triggers without disabling non-empty all-disabled lists", () => {
    const source = readSource("ui/src/components/controls/Select.tsx");

    assert.match(source, /disabled=\{disabled \|\| isEmpty\}/);
    assert.match(source, /const list = open && !isEmpty \? \(/);
    assert.match(source, /aria-disabled=\{it\.disabled \|\| undefined\}/);
    assert.doesNotMatch(source, /const isEmpty = flat\.every/);
  });

  it("keeps portaled Selects inside narrow viewports and skips disabled edge options", () => {
    const source = readSource("ui/src/components/controls/Select.tsx");

    assert.match(source, /const availableWidth = Math\.max\(0, window\.innerWidth - gutter \* 2\)/);
    assert.match(source, /const width = Math\.min\(300, availableWidth, Math\.max\(190, rect\.width\)\)/);
    assert.match(source, /const maxLeft = Math\.max\(gutter, window\.innerWidth - width - gutter\)/);
    assert.match(source, /const above = rect\.top - gutter/);
    assert.match(source, /const direction = below >= 160 \|\| below >= above \? "down" : "up"/);
    assert.match(source, /const availableHeight = Math\.max\(0, direction === "down" \? below : above\)/);
    assert.match(source, /const maxHeight = Math\.min\(420, availableHeight\)/);
    assert.match(source, /const renderedHeight = listRef\.current\?\.scrollHeight \?\? estimatedHeight/);
    assert.match(source, /const height = Math\.min\(renderedHeight, maxHeight\)/);
    assert.match(source, /Math\.max\(gutter, rect\.top - height - 4\)/);
    assert.match(source, /enabledEdgeIndex\(flat, "first", activeIndex\)/);
    assert.match(source, /enabledEdgeIndex\(flat, "last", activeIndex\)/);
    assert.match(source, /if \(!items\[index\]\?\.disabled\) return index/);
  });

  it("mirrors every MCP selection button active state through aria-pressed", () => {
    const generation = readSource("ui/src/components/settings/McpGenerationControls.tsx");
    const presets = readSource("ui/src/components/settings/McpModelPresetControls.tsx");
    const duration = readSource("ui/src/components/controls/DurationSlider.tsx");

    assert.match(generation, /aria-pressed=\{mcpMediaKind === "image"\}/);
    assert.match(generation, /aria-pressed=\{mcpMediaKind === "video"\}/);
    assert.match(presets, /aria-pressed=\{value === undefined\}/);
    assert.match(presets, /aria-pressed=\{value === option\}/);
    assert.match(presets, /aria-pressed=\{ratio === null\}/);
    assert.match(presets, /aria-pressed=\{ratio === value\}/);
    assert.match(duration, /aria-pressed=\{isAuto\}/);
  });

  it("locks list refresh synchronously and always releases it", () => {
    const source = readSource("ui/src/components/settings/McpProviderConnections.tsx");

    assert.match(source, /const \[listRefreshBusy, setListRefreshBusy\] = useState\(false\)/);
    assert.match(source, /if \(listRefreshBusy\) return;\s*setListRefreshBusy\(true\)/);
    assert.match(source, /try \{\s*await refresh\(\);\s*\} finally \{\s*setListRefreshBusy\(false\)/);
    assert.match(source, /disabled=\{loading \|\| listRefreshBusy\}/);
    assert.match(source, /aria-busy=\{loading \|\| listRefreshBusy\}/);
    assert.match(source, /\{error \? \([\s\S]*t\("mcp\.providersLoadFailed"\)/);
    assert.doesNotMatch(source, /error && providers\.length === 0/);
  });

  it("preserves provider action kind for busy labels and duplicate-action locks", () => {
    const source = readSource("ui/src/components/settings/McpProviderConnections.tsx");

    assert.match(source, /useState<\{ provider: string; action: "connect" \| "refresh" \| "disconnect" \} \| null>\(null\)/);
    assert.match(source, /setBusyAction\(\{ provider: provider\.id, action \}\)/);
    assert.match(source, /const activeAction = busyAction\?\.provider === provider\.id \? busyAction\.action : null/);
    assert.match(source, /const busy = activeAction !== null/);
    assert.match(source, /aria-busy=\{activeAction === "refresh"\}/);
    assert.match(source, /activeAction === "refresh" \? t\("mcp\.refreshingConnection"\) : t\("mcp\.refreshConnection"\)/);
  });

  it("adds only the three WP4 MCP copy leaves with English/Korean parity", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));
    const expected = ["retryModels", "noModels", "refreshingConnection"];

    for (const key of expected) {
      assert.equal(typeof en.mcp[key], "string");
      assert.equal(typeof ko.mcp[key], "string");
      assert.ok(en.mcp[key].length > 0);
      assert.ok(ko.mcp[key].length > 0);
    }
    const connections = readSource("ui/src/components/settings/McpProviderConnections.tsx");
    assert.doesNotMatch(connections, /listRefreshFailed|setListRefreshFailed/);
  });

  it("keeps the existing MCP provider and duration contract suites in the gate", () => {
    const providerContract = readSource("tests/mcp-provider-ui-contract.test.ts");
    const durationContract = readSource("tests/duration-slider-contract.test.ts");

    assert.match(providerContract, /describe\("MCP provider UI contract"/);
    assert.match(durationContract, /describe\("dynamic duration slider contract"/);
  });
});
