import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoreBundle } from "./_storeBundle.mjs";

const root = process.cwd();

function readSource(path) {
  if (path === "ui/src/store/useAppStore.ts") return readStoreBundle();
  return readFileSync(join(root, path), "utf8");
}

describe("browser attention badge contract", () => {
  it("shows unseen generated results in the browser favicon/title, not in app chrome", () => {
    const app = readSource("ui/src/App.tsx");
    const badge = readSource("ui/src/hooks/useBrowserAttentionBadge.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(app, /import \{ useBrowserAttentionBadge \}/);
    assert.match(app, /const unseenGeneratedCount = useAppStore\(\(s\) => s\.unseenGeneratedCount\)/);
    assert.match(app, /useBrowserAttentionBadge\(unseenGeneratedCount\)/);
    assert.doesNotMatch(app, /UnseenGenerationIndicator/);
    assert.doesNotMatch(app, /app-status-layer/);

    assert.match(badge, /document\.title = `\(\$\{count\}\) \$\{baseTitle\}`/);
    assert.match(badge, /link\[rel~="icon"\]/);
    assert.match(badge, /document\.createElement\("canvas"\)/);
    assert.match(badge, /setAppBadge/);
    assert.match(badge, /clearAppBadge/);
    assert.match(badge, /renderBadgeFavicon/);
    assert.match(badge, /new Path2D\(BRAND_MARK_PATH\)/, "the badge draws the brand mark synchronously");

    assert.match(store, /unseenGeneratedCount:\s*0/);
    assert.match(store, /unseenGeneratedCount:\s*state\.unseenGeneratedCount \+ 1/);
    assert.match(store, /markGeneratedResultsSeen:\s*\(\) => set\(\{ unseenGeneratedCount:\s*0 \}\)/);
    assert.match(canvas, /markGeneratedResultsSeen\(\)/);
    assert.doesNotMatch(css, /\.app-status-layer/);
    assert.doesNotMatch(css, /\.unseen-generation-indicator/);
  });
});
