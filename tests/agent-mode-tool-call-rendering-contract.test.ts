import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Agent Mode tool call rendering contract", () => {
  it("labels tool rows in the reader's language instead of raw tool ids", () => {
    const formatting = readSource("ui/src/lib/agentToolFormatting.ts");
    const row = readSource("ui/src/components/agent/AgentToolCallRow.tsx");
    const group = readSource("ui/src/components/agent/AgentToolGroup.tsx");

    assert.match(formatting, /agentToolLabelKey/);
    assert.match(formatting, /"ima2\.generate_image": "agent\.toolLabel\.generateImage"/);
    assert.match(row, /agentToolLabelKey\(call\.name\)/);
    // The group header used to join raw ids with " + ".
    assert.doesNotMatch(group, /names\.join\(" \+ "\)/);
    assert.match(group, /agentToolLabelKey/);

    for (const locale of ["ko", "en", "zh-Hans", "zh-Hant"]) {
      const dict = JSON.parse(readSource(`ui/src/i18n/${locale}.json`));
      const labels = dict.agent.toolLabel;
      assert.ok(labels, `${locale} is missing agent.toolLabel`);
      for (const key of ["getImageContext", "webSearch", "generateImage", "generateVideo", "getGenerationErrors"]) {
        assert.equal(typeof labels[key], "string", `${locale}.agent.toolLabel.${key} must be a string`);
        assert.ok(labels[key].length > 0, `${locale}.agent.toolLabel.${key} must not be empty`);
      }
      assert.equal(typeof dict.agent.toolsPanel, "string");
    }
  });

  it("shows an argument preview on the collapsed row and keeps status in text", () => {
    const row = readSource("ui/src/components/agent/AgentToolCallRow.tsx");
    const css = readSource("ui/src/styles/agent-workspace-sidebar.css");

    assert.match(row, /formatToolArgPreview/);
    assert.match(row, /agent-tool-call-row__preview/);
    // Colour alone must not carry status (WCAG 1.4.1).
    assert.match(row, /agent-sr-only">\{statusLabel\}/);
    assert.match(row, /aria-hidden="true"/);
    assert.match(css, /\.agent-tool-call-row__preview/);
    // The preview needs its own line; sharing the name's row left it ~137px.
    // Every child is placed by name: pinning only the badges to a row let grid
    // auto-place them into the first free cells, which measured the tool name
    // pushed to x=265 with the duration stretched across the flexible column.
    assert.match(css, /grid-template-areas:\s*\n\s*"status name count duration chevron"\s*\n\s*"\. preview preview preview preview"/);
    for (const area of ["status", "name", "preview", "count", "duration", "chevron"]) {
      assert.match(css, new RegExp(`grid-area: ${area}`), `${area} must be placed explicitly`);
    }
    assert.doesNotMatch(css, /\.agent-tool-call-row__meta \{[^}]*grid-row: 1/);

    // A fixed row height clipped the preview line by 4px in the chat pane.
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");
    const toggleBlock = panelCss.slice(panelCss.indexOf(".agent-tool-call-row__toggle {"));
    const toggleRule = toggleBlock.slice(0, toggleBlock.indexOf("}"));
    assert.doesNotMatch(toggleRule, /\n\s*height:/, "the tool row must not pin a fixed height");
    assert.match(toggleRule, /min-height/);
    assert.match(css, /font-family: var\(--mono\)/);
  });

  it("does not cap expanded payload text with a competing scroll box", () => {
    const sidebarCss = readSource("ui/src/styles/agent-workspace-sidebar.css");
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");

    // A 120px max-height plus overflow:auto fought the 3-line clamp and made
    // "More" a no-op inside a scroll box.
    const ddBlock = sidebarCss.slice(sidebarCss.indexOf(".agent-tool-call-details dd {"));
    const ddRule = ddBlock.slice(0, ddBlock.indexOf("}"));
    assert.doesNotMatch(ddRule, /max-height/);
    assert.doesNotMatch(ddRule, /overflow-y/);
    assert.match(panelCss, /-webkit-line-clamp: 3/);
    assert.match(panelCss, /\.agent-tool-call-details dd\.is-expanded > span/);
  });

  it("uses the mono token for technical metadata, never the sans display font", () => {
    for (const file of ["ui/src/styles/agent-workspace-sidebar.css", "ui/src/styles/agent-workspace-panels.css"]) {
      assert.doesNotMatch(readSource(file), /font-family: var\(--font\)/, `${file} still uses the sans token for technical text`);
    }
  });
});
