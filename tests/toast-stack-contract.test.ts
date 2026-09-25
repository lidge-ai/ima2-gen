import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSourceTree } from "./_readTree.mjs";

const storeSource = readSourceTree("ui/src/store/useAppStore.ts");
const toastSource = readFileSync("ui/src/components/Toast.tsx", "utf8");
const errorCardSource = readFileSync("ui/src/components/ErrorCard.tsx", "utf8");
const cssSource = readSourceTree("ui/src/index.css");

test("WP03 source constraints isolate wrapping and action geometry to cards", () => {
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = cssSource.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
    assert.ok(match, `missing CSS rule ${selector}`);
    return match[1];
  };
  assert.match(rule(".toast--card"), /grid-template-columns:\s*minmax\(0,\s*1fr\) 44px/);
  assert.match(rule(".toast--card"), /width:\s*min\(560px,\s*100%\)/);
  const message = rule(".toast--card .toast__message");
  for (const declaration of [/white-space:\s*normal/, /overflow:\s*visible/, /text-overflow:\s*clip/,
    /overflow-wrap:\s*anywhere/, /grid-row:\s*1/]) assert.match(message, declaration);
  const cta = rule(".toast--card .toast__cta");
  for (const declaration of [/grid-column:\s*1 \/ -1/, /grid-row:\s*2/, /min-height:\s*44px/,
    /max-width:\s*100%/]) assert.match(cta, declaration);
  const dismiss = rule(".toast--card .toast__dismiss");
  for (const declaration of [/width:\s*44px/, /height:\s*44px/, /grid-column:\s*2/]) assert.match(dismiss, declaration);
  assert.ok(cssSource.indexOf(".toast--card .toast__message") > cssSource.indexOf(".toast__dismiss:hover"));
  const stack = rule(".toast-stack:has(.toast--card)");
  for (const declaration of [/max-height:\s*calc\(100dvh - 48px\)/, /overflow-y:\s*auto/,
    /overflow-x:\s*hidden/, /padding:\s*4px/, /pointer-events:\s*auto/]) assert.match(stack, declaration);
  assert.match(rule(".toast-stack:has(.toast--card) > .toast"), /flex-shrink:\s*0/);
  assert.match(rule(".toast--card .toast__dismiss:focus-visible"), /outline:\s*2px solid var\(--accent\)/);
});

test("toast store keeps an append-only visible log with dismiss support", () => {
  assert.match(
    storeSource,
    /type ToastEntry = \{ message: string; error: boolean; id: number; createdAt: number \}/,
    "toast entries should preserve message, severity, id, and creation time",
  );
  assert.match(storeSource, /toastLog: ToastEntry\[\]/, "app state should expose a visible toast log");
  assert.match(storeSource, /errorCardLog: ErrorCardEntry\[\]/, "app state should expose a visible error-card log");
  assert.match(storeSource, /dismissToast: \(id: number\) => void/, "app state should expose per-toast dismissal");
  assert.match(storeSource, /dismissErrorCard: \(id\?: number\) => void/, "app state should expose per-error-card dismissal");
  assert.match(storeSource, /toastLog: \[\]/, "initial state should start with an empty toast log");
  assert.match(storeSource, /errorCardLog: \[\]/, "initial state should start with an empty error-card log");
  assert.match(
    storeSource,
    /toastLog: \[\.\.\.s\.toastLog, entry\]/,
    "showToast should append instead of replacing the visible stack",
  );
  assert.match(
    storeSource,
    /toastLog\.filter\(\(toast\) => toast\.id !== id\)/,
    "dismissToast should remove only the requested toast row",
  );
  assert.match(
    storeSource,
    /errorCardLog\.filter\(\(card\) => card\.id !== id\)/,
    "dismissErrorCard should remove only the requested error row",
  );
});

test("toast component renders a bottom-right stack with active-tab timeout behavior", () => {
  assert.match(toastSource, /TOAST_VISIBLE_TIMEOUT_MS = 3_000/, "active-tab timeout should be 3 seconds");
  assert.match(toastSource, /TOAST_MAX_VISIBLE = 5/, "visible toasts should be capped at 5");
  assert.match(toastSource, /\.slice\(-TOAST_MAX_VISIBLE\)/, "rows should be sliced to max visible");
  assert.match(toastSource, /document\.visibilityState === "visible"/, "tab activity should use visibility state");
  assert.match(toastSource, /visibilitychange/, "component should react to tab visibility changes");
  assert.match(toastSource, /className="toast-stack"/, "component should render a stack container");
  assert.match(toastSource, /errorCards = useAppStore\(\(s\) => s\.errorCardLog\)/, "error cards should join the same stack");
  assert.match(toastSource, /kind: "error-card"/, "central error cards should be converted into stack rows");
  assert.match(toastSource, /className="toast__dismiss"/, "each toast row should include a close button");
  assert.match(toastSource, /dismissToast\(toast\.id\)/, "close button and timeout should dismiss by toast id");
  assert.match(toastSource, /dismissErrorCard\(card\.id\)/, "error-card timeout should dismiss by card id");
  assert.doesNotMatch(errorCardSource, /error-card-backdrop/, "ErrorCard should not render a central blocking backdrop");
  assert.match(cssSource, /\.toast-stack\s*\{[\s\S]*bottom:\s*24px/, "toast stack should be bottom-aligned");
  assert.match(cssSource, /\.toast-stack\s*\{[\s\S]*right:\s*24px/, "toast stack should be right-aligned");
  assert.match(cssSource, /\.toast__message\s*\{[\s\S]*white-space:\s*nowrap/, "toast rows should stay one line");
  assert.match(cssSource, /\.toast__message\s*\{[\s\S]*text-overflow:\s*ellipsis/, "long toast rows should ellipsize");
});
