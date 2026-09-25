// 062 — dynamic duration slider contract: every video duration control is the
// shared contract-driven slider (options list or min..max range), not a
// button wall, with a mobile-size touch band.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const readSource = (path) => readFileSync(join(root, path), "utf8");

describe("dynamic duration slider contract", () => {
  it("snaps to contract values by index and exposes slider semantics", () => {
    const slider = readSource("ui/src/components/controls/DurationSlider.tsx");
    assert.match(slider, /type="range"/);
    assert.match(slider, /max=\{values\.length - 1\}/);
    assert.match(slider, /aria-valuetext=\{`\$\{values\[nearestIndex\]\}s`\}/);
    assert.match(slider, /onChange\(values\[Number\(event\.target\.value\)\] \?\? values\[0\]\)/);
  });

  it("renders MCP duration parameters through the slider with Auto support", () => {
    const presets = readSource("ui/src/components/settings/McpModelPresetControls.tsx");
    assert.match(presets, /parameter\.name === "duration" && parameter\.type === "number"/);
    assert.match(presets, /<DurationSlider/);
    assert.match(presets, /allowAuto=\{!parameter\.required\}/);
  });

  it("renders the core video length through the same slider", () => {
    const panel = readSource("ui/src/components/VideoControlsPanel.tsx");
    assert.match(panel, /<DurationSlider/);
    assert.match(panel, /values=\{DURATIONS\.filter\(\(d\) => d <= maxDuration\)\}/);
    assert.doesNotMatch(panel, /DURATIONS\.filter\(\(d\) => d <= maxDuration\)\.map/);
  });

  it("keeps a mobile-grade touch band and non-stretching Auto chip", () => {
    const css = readSource("ui/src/styles/controls.css");
    assert.match(css, /\.ctl-duration__range \{[^}]*height: 32px/s);
    assert.match(css, /@media \(max-width: 720px\) \{\s*\.ctl-duration__range \{\s*height: 44px/);
    assert.match(css, /\.ctl-duration__head \.option-btn\.ctl-duration__auto \{[^}]*flex: 0 0 auto/s);
  });
});
