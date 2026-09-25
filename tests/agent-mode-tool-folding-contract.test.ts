import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Agent Mode tool folding contract", () => {
  it("uses an outer tool group and nested per-call rows", () => {
    const messageList = readSource("ui/src/components/agent/AgentMessageList.tsx");
    const runGroup = readSource("ui/src/components/agent/AgentRunGroup.tsx");
    const group = readSource("ui/src/components/agent/AgentToolGroup.tsx");
    const row = readSource("ui/src/components/agent/AgentToolCallRow.tsx");
    const details = readSource("ui/src/components/agent/AgentToolCallDetails.tsx");
    const formatting = readSource("ui/src/lib/agentToolFormatting.ts");

    assert.match(messageList, /kind: "run"/);
    assert.match(runGroup, /turn\.role === "tool"/);
    assert.match(runGroup, /<AgentToolGroup/);
    assert.match(group, /agent-message__tool-toggle/);
    assert.match(group, /aria-expanded={expanded}/);
    assert.match(group, /AgentToolCallRow/);
    assert.match(row, /agent-tool-call-row__toggle/);
    assert.match(row, /aria-controls={detailsId}/);
    assert.match(row, /AgentToolCallDetails/);
    assert.match(details, /agent-tool-call-details__artifacts/);
    assert.match(formatting, /getAgentToolCalls/);
    assert.match(formatting, /toolCalls\?\.length/);
  });

  it("keeps generated image thumbnails outside the outer disclosure button", () => {
    const group = readSource("ui/src/components/agent/AgentToolGroup.tsx");
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");
    const sidebarCss = readSource("ui/src/styles/agent-workspace-sidebar.css");

    assert.match(group, /agent-message__tool-thumbs/);
    assert.doesNotMatch(group, /agent-message__tool-toggle[\s\S]*AgentResultThumb[\s\S]*<\/button>/);
    assert.match(panelCss, /\.agent-message__tool-thumbs/);
    assert.match(panelCss, /\.agent-message__tool-details\[hidden\]/);
    assert.match(sidebarCss, /\.agent-tool-call-list/);
    assert.match(sidebarCss, /\.agent-tool-call-row__toggle/);
  });
});
