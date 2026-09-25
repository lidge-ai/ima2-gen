import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("sidebar swaps the desktop classic inflight list for a controlled badge popup", () => {
  const sidebar = read("ui/src/components/Sidebar.tsx");

  assert.match(sidebar, /InFlightBadge/);
  assert.match(sidebar, /panelId=\{DESKTOP_INFLIGHT_PANEL_ID\}/);
  assert.match(sidebar, /<GenerateButton \/>[\s\S]*?<InFlightBadge/);
  assert.equal(
    sidebar.match(/<InFlightList \/>/g)?.length,
    1,
    "only the node-mode compact list should remain in Sidebar",
  );
});

test("badge hides at zero and exposes hover, pin, and disclosure semantics", () => {
  const badge = read("ui/src/components/composer/InFlightBadge.tsx");

  assert.match(badge, /useAppStore\(\(s\) => s\.inFlight\.length\)/);
  assert.match(badge, /count === 0/);
  assert.match(badge, /aria-live="polite"/);
  assert.match(badge, /aria-expanded=\{open\}/);
  assert.match(badge, /aria-controls=\{panelId\}/);
  assert.match(badge, /aria-haspopup=\{variant === "popup" \? "dialog" : undefined\}/);
  assert.match(badge, /HOVER_OPEN_DELAY_MS/);
  assert.match(badge, /CLOSE_DELAY_MS/);
  assert.match(badge, /setMode\("pinned"\)/);
  assert.match(badge, /onToggle\?\.\(nextOpen\)/);
  assert.match(badge, /variant === "inline"/);
});

test("popup portals above the canvas and follows the audited anchor rule", () => {
  const popup = read("ui/src/components/composer/InFlightPopup.tsx");
  const css = read("ui/src/styles/inflight-tray.css");
  const progressCss = read("ui/src/styles/progress-composer.css");

  assert.match(popup, /createPortal/);
  assert.match(popup, /document\.body/);
  assert.match(popup, /role="dialog"/);
  assert.match(popup, /aria-modal="false"/);
  assert.match(popup, /closest\("\.sidebar"\)/);
  assert.match(popup, /sidebarRect \? sidebarRect\.right : badgeRect\.right/);
  assert.match(popup, /Math\.min\(Math\.max\(/);
  assert.match(popup, /ResizeObserver/);
  assert.match(popup, /addEventListener\("scroll", schedulePosition, true\)/);
  assert.match(popup, /addEventListener\("pointerdown"/);
  assert.match(popup, /event\.key !== "Escape"/);
  assert.match(popup, /<InFlightList variant="popup" panelId=\{panelId\} \/>/);
  assert.match(css, /\.inflight-popup\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.inflight-popup\s*\{[\s\S]*?z-index:\s*210/);
  assert.match(css, /@media \(max-width:\s*800px\)[\s\S]*?\.inflight-popup/);
  assert.match(progressCss, /@import "\.\/inflight-tray\.css"/);
});

test("rich list owns panel ids and only one video job gets determinate progress", () => {
  const list = read("ui/src/components/InFlightList.tsx");

  assert.match(list, /variant:\s*"popup" \| "inline"; panelId: string/);
  assert.match(list, /panelId: string/);
  assert.match(list, /id=\{props\.panelId\}/);
  assert.match(list, /const videoJobs = props\.jobs\.filter/);
  assert.match(list, /videoJobs\.length === 1/);
  assert.match(list, /role="progressbar"/);
  assert.match(list, /aria-valuenow=\{progressPercent \?\? undefined\}/);
  assert.match(list, /className="in-flight-cancel"/);
  assert.match(list, /cancelInFlightJob\(f\.id\)/);
  assert.match(list, /in-flight-placeholder/);
});

test("AssetGen keeps the default compact InFlightList render contract", () => {
  const assetGen = read("ui/src/components/assetgen/AssetGenWorkspace.tsx");
  const list = read("ui/src/components/InFlightList.tsx");

  assert.match(assetGen, /<InFlightList \/>/);
  assert.doesNotMatch(assetGen, /<InFlightList\s+variant=/);
  assert.match(list, /if \(!\("panelId" in props\)\)/);
  assert.match(list, /className="in-flight-list"/);
  assert.match(list, /\{truncate\(f\.prompt\)\}/);
});

test("sidebar suppresses the legacy Generate count where the new badge owns status", () => {
  const css = read("ui/src/styles/inflight-tray.css");
  assert.match(css, /\.sidebar-generate-with-inflight \.generate-btn__count\s*\{[\s\S]*?display:\s*none/);
});

test("popup copy is localized with English and Korean parity", () => {
  const en = JSON.parse(read("ui/src/i18n/en.json"));
  const ko = JSON.parse(read("ui/src/i18n/ko.json"));

  for (const locale of [en, ko]) {
    assert.equal(typeof locale.inflight.title, "string");
    assert.equal(typeof locale.inflight.badgeOpen, "string");
    assert.equal(typeof locale.inflight.badgeClose, "string");
    assert.equal(typeof locale.inflight.footerHint, "string");
    assert.equal(typeof locale.inflight.kindImage, "string");
    assert.equal(typeof locale.inflight.kindVideo, "string");
    assert.equal(typeof locale.inflight.kindNode, "string");
    assert.equal(typeof locale.inflight.kindMcp, "string");
  }
  assert.equal(en.inflight.footerHint, "You can close this panel — generations will continue.");
});
