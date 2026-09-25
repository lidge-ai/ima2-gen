import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Agent Mode layout contract", () => {
  it("resolves layout purely by viewport dimensions (auto only)", () => {
    const layout = readSource("ui/src/lib/agentLayout.ts");
    const hook = readSource("ui/src/hooks/useAgentWorkspaceLayout.ts");
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const css = readSource("ui/src/styles/agent-workspace.css");

    assert.match(layout, /export function resolveAgentLayout/);
    assert.match(layout, /desktop-three-pane/);
    assert.match(layout, /desktop-rail/);
    assert.match(layout, /tablet-stacked/);
    assert.match(layout, /mobile-chat-image-sheet/);
    assert.match(hook, /resolveAgentLayout\(/);
    assert.match(hook, /getAgentWorkspaceWidth/);
    assert.match(hook, /querySelector<HTMLElement>/);
    assert.match(hook, /\.app\[data-ui-mode=/);
    assert.match(hook, /\.sidebar/);
    assert.match(hook, /window\.innerWidth - width/);
    assert.match(workspace, /useAgentWorkspaceLayout/);
    assert.match(workspace, /layoutMode === "tablet-stacked" \|\| layoutMode === "mobile-chat-image-sheet"/);
    assert.doesNotMatch(workspace, /panePreference/);
    assert.match(css, /grid-template-columns: 64px minmax\(0, 1fr\)/);
    assert.match(css, /\.agent-workspace\s*\{[\s\S]*?grid-column: 1;/);
    assert.match(css, /\.agent-workspace__body\s*\{[\s\S]*?grid-column: 2;/);
    assert.match(css, /grid-template-columns: minmax\(360px, 0\.42fr\) minmax\(520px, 0\.58fr\)/);
    assert.match(css, /grid-template-columns: minmax\(340px, 1fr\) minmax\(440px, 1\.2fr\)/);
  });

  it("does not have pane switcher or sidebar collapse toggle", () => {
    const topbar = readSource("ui/src/components/agent/AgentTopBar.tsx");
    const css = readSource("ui/src/styles/agent-workspace.css");

    assert.doesNotMatch(topbar, /AgentPaneToggle/);
    assert.doesNotMatch(topbar, /UIModeSwitch/);
    assert.doesNotMatch(topbar, /onToggleSidebar/);
    assert.doesNotMatch(css, /agent-workspace--collapsed/);
  });

  it("reserves the fixed mobile tab bar strip so the composer send button stays clickable", () => {
    const css = readSource("ui/src/styles/agent-workspace.css");
    const navRailCss = readSource("ui/src/styles/nav-rail.css");

    // The mobile tab bar is fixed to the bottom of the viewport and paints above
    // the workspace, so a full-height agent workspace would hide the composer's
    // send button behind the nav icons and make submit unclickable.
    assert.match(navRailCss, /\.nav-rail--mobile\s*\{[\s\S]*?position:\s*fixed[\s\S]*?bottom:\s*0/);
    assert.match(navRailCss, /\.nav-rail--mobile\s*\{[\s\S]*?z-index:\s*160/);
    assert.match(
      css,
      /\.app\[data-ui-mode="agent"\]\[data-mobile="1"\] \.agent-workspace\s*\{[\s\S]*?height:\s*calc\(100dvh - 56px - env\(safe-area-inset-bottom, 0px\)\)/,
      "agent mode must subtract the mobile tab bar height from the workspace height",
    );
  });
});
