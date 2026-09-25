import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const popup = read("ui/src/components/composer/InFlightPopup.tsx");
const badge = read("ui/src/components/composer/InFlightBadge.tsx");
const list = read("ui/src/components/InFlightList.tsx");
const inflightCss = read("ui/src/styles/inflight-tray.css");
const controlsCss = read("ui/src/styles/controls.css");

test("popup close reuses the canonical focus-restoring close path", () => {
  assert.match(
    popup,
    /<button[\s\S]*?type="button"[\s\S]*?className="inflight-popup__close"[\s\S]*?aria-label=\{t\("common\.close"\)\}[\s\S]*?title=\{t\("common\.close"\)\}[\s\S]*?onClick=\{\(\) => onRequestClose\(true\)\}[\s\S]*?<span aria-hidden="true">×<\/span>[\s\S]*?<\/button>/,
  );
  assert.match(popup, /addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.match(popup, /onRequestClose\(false\)/);
  assert.match(popup, /event\.key !== "Escape"[\s\S]*?event\.preventDefault\(\);[\s\S]*?onRequestClose\(true\)/);
  assert.match(badge, /const closePopup = \(restoreFocus: boolean\) => \{[\s\S]*?clearTimers\(\);[\s\S]*?setMode\("closed"\);[\s\S]*?setFocusOnOpen\(false\);[\s\S]*?if \(restoreFocus\) triggerRef\.current\?\.focus\(\);[\s\S]*?\};/);
  assert.match(badge, /onRequestClose=\{closePopup\}/);
});

test("popup close has a 44px target and visible interaction states", () => {
  const closeRule = inflightCss.match(/\.inflight-popup__close\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.match(closeRule, /width:\s*44px/);
  assert.match(closeRule, /height:\s*44px/);
  assert.match(inflightCss, /\.inflight-popup__close:hover\s*\{/);
  assert.match(inflightCss, /\.inflight-popup__close:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(inflightCss, /@media \(forced-colors: active\)[\s\S]*?\.inflight-popup__close[\s\S]*?border-color:\s*ButtonText/);
});

test("progress tracks expose determinate and indeterminate semantics without duplicate live output", () => {
  assert.match(list, /<ProgressTrack progressPercent=\{progressPercent\} phaseLabel=\{phaseLabel\} t=\{t\} \/>/);
  assert.match(list, /function ProgressTrack\(\{ progressPercent, phaseLabel, t \}/);
  assert.match(list, /role="progressbar"/);
  assert.match(list, /aria-label=\{progressPercent == null \? phaseLabel : t\("inflight\.progressAria", \{ n: progressPercent \}\)\}/);
  assert.match(list, /aria-valuemin=\{progressPercent == null \? undefined : 0\}/);
  assert.match(list, /aria-valuemax=\{progressPercent == null \? undefined : 100\}/);
  assert.match(list, /aria-valuenow=\{progressPercent \?\? undefined\}/);
  assert.doesNotMatch(list, /aria-live/);
  assert.match(list, /const determinateVideoId = videoJobs\.length === 1 \? videoJobs\[0\]\?\.id : null/);
});

test("overlay layers remain ordered above the mobile sheet and below Select portals", () => {
  const popupZ = Number(inflightCss.match(/\.inflight-popup\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  const bridgeZ = Number(inflightCss.match(/\.inflight-badge__bridge\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  const selectZ = Number(controlsCss.match(/\.ctl-select__list--portal\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);

  assert.equal(popupZ, 210);
  assert.equal(bridgeZ, 211);
  assert.equal(selectZ, 220);
  assert.ok(180 < popupZ && popupZ < bridgeZ && bridgeZ < selectZ);
  assert.match(inflightCss, /@media \(max-width:\s*800px\)[\s\S]*?\.inflight-badge-wrap--popup,[\s\S]*?\.inflight-popup,[\s\S]*?\.inflight-badge__bridge\s*\{[\s\S]*?display:\s*none/);
  assert.match(inflightCss, /@media \(max-width:\s*800px\)[\s\S]*?\.in-flight-list--inline\s*\{/);
});
