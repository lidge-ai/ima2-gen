import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Agent Mode streaming a11y contract", () => {
  it("announces the transcript as an append-only log, not a re-read live region", () => {
    const list = readSource("ui/src/components/agent/AgentMessageList.tsx");

    // aria-live="polite" on the scroll container made assistive tech re-read the
    // thread on every streamed append. role="log" is implicitly polite and
    // non-atomic, so only new entries are announced.
    assert.match(list, /role="log"/);
    assert.doesNotMatch(list, /aria-live/);
    assert.match(list, /aria-label=\{t\("agent\.workspace"\)\}/);

    // The jump control must live outside the log so showing it is not announced
    // as transcript content.
    assert.match(list, /agent-message-list-wrap/);
    const wrapBlock = list.slice(list.indexOf("agent-message-list-wrap"));
    const jumpIndex = wrapBlock.indexOf("agent-message-list__jump");
    assert.ok(jumpIndex > 0, "the jump control must still exist");
    assert.ok(
      wrapBlock.indexOf("</div>") < jumpIndex,
      "the log element must close before the jump control renders",
    );
  });

  it("stops every indefinite agent animation under reduced motion", () => {
    const sidebar = readSource("ui/src/styles/agent-workspace-sidebar.css");
    const panels = readSource("ui/src/styles/agent-workspace-panels.css");

    // Measured in Chrome: 8 animated agent selectors, of which the session
    // spinner and the running tool-call dot had no reduced-motion coverage.
    assert.match(sidebar, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(sidebar, /\.agent-session-spinner > span,\s*\n\s*\.agent-tool-call-row--running \.agent-tool-call-row__status/);
    assert.match(panels, /@media \(prefers-reduced-motion: reduce\)/);

    // Every animated agent selector must be named in some reduce block.
    const css = sidebar + panels;
    const reduceBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map((match) => match[1])
      .join("\n");
    for (const selector of [
      ".agent-status__dot",
      ".agent-run-status__indicator",
      ".agent-session-spinner > span",
      ".agent-tool-call-row--running .agent-tool-call-row__status",
    ]) {
      assert.ok(reduceBlocks.includes(selector), `${selector} must stop animating under reduced motion`);
    }
  });

  it("keeps the jump control positioned by its wrapper, not the scroll flow", () => {
    const css = readSource("ui/src/styles/agent-workspace-panels.css");
    const wrapBlock = css.slice(css.indexOf(".agent-message-list-wrap {"));
    assert.match(wrapBlock.slice(0, wrapBlock.indexOf("}")), /position: relative/);
    const jumpBlock = css.slice(css.indexOf(".agent-message-list__jump {"));
    const jumpRule = jumpBlock.slice(0, jumpBlock.indexOf("}"));
    assert.match(jumpRule, /position: absolute/);
    assert.doesNotMatch(jumpRule, /position: sticky/);
  });

  it("keys a run by its first turn so appending does not remount the group", () => {
    const list = readSource("ui/src/components/agent/AgentMessageList.tsx");

    // A key built from every turn id changed whenever the run grew, remounting
    // the whole AgentRunGroup: inside role="log" that re-announces settled
    // content, and it discarded tool details the user had expanded mid-run.
    assert.doesNotMatch(list, /runBatch\.map\(\(t\) => t\.id\)\.join/);
    assert.match(list, /key: `run-\$\{runBatch\[0\]\.id\}`/);
  });
});
