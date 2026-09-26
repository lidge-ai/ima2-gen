import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES = join(import.meta.dirname, "..", "ui", "src", "styles");
const read = (name: string) => readFileSync(join(STYLES, name), "utf8");

/** Selectors that must have a 44px ::after hit area. */
const AFTER_TARGETS = [
  { file: "agent-workspace-sidebar.css", selector: ".agent-model-select__open-tab" },
  { file: "composer-flow.css", selector: ".composer__prompt-chip-remove" },
  { file: "progress-composer.css", selector: ".composer__prompt-chip-remove" },
  { file: "canvas-annotations.css", selector: ".canvas-style-swatch" },
  { file: "canvas-annotations.css", selector: ".canvas-toolbar__button--split-menu" },
  { file: "toast-modal.css", selector: ".metadata-modal__close" },
  { file: "viewer-workflow.css", selector: ".viewer-control-btn" },
  { file: "sidebar-history.css", selector: ".sidebar-history__gallery-button" },
  { file: "sidebar.css", selector: ".settings-button" },
  { file: "node-workspace.css", selector: ".image-node__del" },
  { file: "canvas-background-cleanup.css", selector: ".canvas-toolbar__zoom-button" },
  { file: "sprite-curator.css", selector: ".sprite-rail__actions button" },
  { file: "agent-stage.css", selector: ".agent-right-sidebar__overlay-header button" },
  { file: "right-panel.css", selector: ".right-panel-toggle" },
];

/** Selectors with actual 44px dimensions. */
const SIZE_TARGETS = [
  { file: "assets-workspace.css", pattern: /width: 44px; height: 44px/, note: "asset-element-toggle" },
  { file: "agent-workspace-panels.css", pattern: /width: 44px/, note: "agent-result-thumb--compact" },
  { file: "canvas-annotations.css", pattern: /input\[type="color"\][^}]*width: 44px/, note: "color input" },
];

describe("ui-touch-target-contract", () => {
  for (const { file, selector } of AFTER_TARGETS) {
    it(selector + " in " + file + " has 44px ::after hit area", () => {
      const css = read(file);
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const afterRe = new RegExp(escaped + "::after[^}]*width:\\s*44px");
      assert.ok(afterRe.test(css), selector + "::after should have width: 44px in " + file);
      const posRe = new RegExp(escaped + "\\s*\\{[^}]*position:\\s*relative");
      assert.ok(posRe.test(css), selector + " should have position: relative in " + file);
    });
  }

  for (const { file, pattern, note } of SIZE_TARGETS) {
    it(note + " has 44px actual dimensions", () => {
      const css = read(file);
      assert.ok(pattern.test(css), note + " should match " + pattern + " in " + file);
    });
  }

  it("element-mention-chip has min-height 44px and remove button width 44px", () => {
    const css = read("element-mention.css");
    assert.ok(/min-height: 44px/.test(css), "chip should have min-height: 44px");
    assert.ok(/element-mention-chip__remove[^}]*width: 44px/.test(css), "remove should be 44px wide");
  });

  it("card-news text controls meet 24px AA minimum", () => {
    const css = read("card-news-templates.css");
    const chips = css.match(/\.card-news-placement-chip[\s\S]*?min-height:\s*(\d+)px/);
    assert.ok(chips && parseInt(chips[1]) >= 24, "placement chip min-height >= 24px");
    const actions = css.match(/\.gallery-card-news-actions[\s\S]*?min-height:\s*(\d+)px/);
    assert.ok(actions && parseInt(actions[1]) >= 24, "card-news actions min-height >= 24px");
  });

  it("agent-session-row actions are at least 24px on both axes", () => {
    const css = read("agent-workspace.css");
    const widthMatch = css.match(/\.agent-session-row__actions button[\s\S]*?width:\s*(\d+)px/);
    const heightMatch = css.match(/\.agent-session-row__actions button[\s\S]*?height:\s*(\d+)px/);
    if (widthMatch) assert.ok(parseInt(widthMatch[1]) >= 24, "session action width >= 24");
    if (heightMatch) assert.ok(parseInt(heightMatch[1]) >= 24, "session action height >= 24");
  });
});
