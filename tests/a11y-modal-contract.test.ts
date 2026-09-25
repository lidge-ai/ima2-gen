import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// WP1 (devlog/_plan/260726_zero-backlog-frontend-qa/010_a11y_foundation.md):
// every dialog surface must declare modal semantics and delegate focus handling to the
// shared hook. Rolling your own Escape listener drops focus trapping and focus restore,
// which is exactly the regression this contract exists to prevent.

const DIALOG_SURFACES = [
  "ui/src/components/PromptDetailModal.tsx",
  "ui/src/components/GalleryModal.tsx",
  "ui/src/components/GenerationLogDetailModal.tsx",
  "ui/src/components/CustomSizeConfirmModal.tsx",
  "ui/src/components/OnboardingPopup.tsx",
  "ui/src/components/ProviderReadinessPopup.tsx",
  "ui/src/components/MetadataRestoreDialog.tsx",
  "ui/src/components/ApiDisabledModal.tsx",
  "ui/src/components/StarPrompt.tsx",
];

test("dialog surfaces declare modal semantics", () => {
  for (const path of DIALOG_SURFACES) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /role="dialog"/, `${path} must declare role="dialog"`);
    assert.match(src, /aria-modal="true"/, `${path} must declare aria-modal`);
    assert.match(
      src,
      /aria-label(ledby)?=/,
      `${path} must name its dialog via aria-label or aria-labelledby`,
    );
  }
});

test("dialog surfaces use the shared focus hook", () => {
  for (const path of DIALOG_SURFACES) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /useModalFocus/, `${path} must use useModalFocus`);
  }
});

test("dialog surfaces do not register their own Escape listener", () => {
  for (const path of DIALOG_SURFACES) {
    const src = readFileSync(path, "utf8");
    assert.doesNotMatch(
      src,
      /addEventListener\(\s*"keydown"/,
      `${path} must not add a competing keydown listener; useModalFocus owns Escape`,
    );
  }
});

test("gallery tablists support roving tabindex and arrow keys", () => {
  const tabs = readFileSync("ui/src/components/gallery/GalleryFilterTabs.tsx", "utf8");
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /useTablistKeys/, "the tablist must wire arrow/Home/End navigation");
  assert.match(tabs, /tabIndex=\{tab\.value === rovingValue \? 0 : -1\}/, "roving tabindex required");
  // The gallery must not hand-roll tablists that bypass the shared keyboard contract.
  const gallery = readFileSync("ui/src/components/GalleryModal.tsx", "utf8");
  assert.doesNotMatch(gallery, /role="tablist"/, "gallery tablists must use GalleryFilterTabs");
});

test("a disabled tab never leaves its tablist without a focusable entry", () => {
  const tabs = readFileSync("ui/src/components/gallery/GalleryFilterTabs.tsx", "utf8");
  // The scope tablist can have its selected tab disabled (no active session). Deriving
  // the roving index from selection alone would put every tab at -1 and make the group
  // unreachable by keyboard, so it falls through to the first enabled tab.
  assert.match(
    tabs,
    /selected && !selected\.disabled[\s\S]*?tabs\.find\(\(tab\) => !tab\.disabled\)/,
    "roving index must fall back to the first enabled tab",
  );
  const gallery = readFileSync("ui/src/components/GalleryModal.tsx", "utf8");
  assert.match(gallery, /disabled: !currentSessionId/, "scope tab stays disabled without a session");
});

test("gallery keeps an explicit initial focus target", () => {
  const src = readFileSync("ui/src/components/GalleryModal.tsx", "utf8");
  // useModalFocus focuses the first focusable element, which is a filter tab. Without an
  // explicit marker the search field silently loses the focus it used to take.
  assert.match(src, /data-modal-initial-focus/, "gallery must mark its initial focus target");
  assert.doesNotMatch(
    src,
    /\n\s+autoFocus\n/,
    "autoFocus competes with the hook's initial focus; use data-modal-initial-focus",
  );
});

test("in-flight progress is announced by progressbar semantics, not a list live region", () => {
  const src = readFileSync("ui/src/components/InFlightList.tsx", "utf8");
  // Each row already exposes role="progressbar" with aria-valuenow/aria-label, so the
  // per-job state is announced on change. Wrapping the list in aria-live on top of that
  // double-announces every tick — with up to 12 parallel jobs it floods the screen
  // reader. This contract is owned by tests/inflight-popup-polish-contract.test.js and
  // is restated here so the modal/a11y sweep cannot silently reintroduce the overlap.
  assert.match(src, /role="progressbar"/, "progress rows must expose progressbar semantics");
  assert.doesNotMatch(src, /aria-live/, "the list itself must not duplicate live output");
});

test("gallery session loading is announced", () => {
  const src = readFileSync("ui/src/components/GalleryModal.tsx", "utf8");
  assert.match(src, /className="gallery__empty" role="status" aria-live="polite"/);
});
