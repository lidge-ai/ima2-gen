import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { buildSync, transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
const requireUi = createRequire(join(process.cwd(), "ui/package.json"));
const react = requireUi("react") as typeof import("../ui/node_modules/@types/react/index");
const renderer = requireUi("react-dom/server") as { renderToStaticMarkup(element: unknown): string };
function renderCharge(percent: number | null): string {
  const source = readFileSync("ui/src/components/settings/QuotaCard.tsx", "utf8") + "\nexport { ChargeBar };";
  const compiled = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  const mod = { exports: {} as { ChargeBar: (props: { window: { label: string; percent: number | null; resetsAt: null } }) => null } };
  const requireStub = (name: string): unknown => {
    if (name === "react" || name === "react/jsx-runtime") return requireUi(name);
    if (name === "../../i18n") return { useI18n: () => ({ t: (key: string) => key }) };
    return {};
  };
  runInNewContext(compiled, { module: mod, exports: mod.exports, require: requireStub }, { timeout: 2000 });
  return renderer.renderToStaticMarkup(react.createElement(mod.exports.ChargeBar,
    { window: { label: "battery", percent, resetsAt: null } }));
}
describe("quota UI unknown values", () => {
  it("shows unknown NovelAI charge without a numeric meter value", () => {
    const html = renderCharge(null);
    assert.match(html, /—/);
    assert.doesNotMatch(html, /aria-valuenow=/);
  });
});
describe("quota UI controls", () => {
  it("renders a known NovelAI charge", () => {
    const html = renderCharge(75);
    assert.match(html, /75%/);
    assert.match(html, /aria-valuenow="75"/);
  });
});

it("keeps reset controls out of the readiness and composer dependency graphs", () => {
  const inputs = (entry: string) => Object.keys(buildSync({
    entryPoints: [entry], bundle: true, write: false, metafile: true,
    platform: "browser", format: "esm", loader: { ".css": "empty" },
  }).metafile!.inputs);
  const resetModule = /\/(?:ResetCreditsPanel|GrokCouponsPanel|resetCreditsTransport|grokCouponsTransport)\.[tj]sx?$/;
  for (const entry of ["ui/src/components/ProviderReadinessPopup.tsx", "ui/src/components/PromptComposer.tsx"]) {
    assert.deepEqual(inputs(entry).filter(path => resetModule.test(path)), [], entry);
  }
  assert.ok(inputs("ui/src/components/SettingsWorkspace.tsx").some(path => resetModule.test(path)));
});

type ElementNode = { type: string; props: Record<string, unknown>; children: unknown[] };
type Component = (props: Record<string, unknown>) => ElementNode;
let currentMount: { states: unknown[]; cursor: number; effects: (() => void)[]; update: () => void } | undefined;
function loadComponent(file: string, name: string): Component { return loadModule(file)[name]!; }
function loadModule(file: string): Record<string, Component> {
  const source = readFileSync(`ui/src/components/settings/${file}.tsx`, "utf8");
  const compiled = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  const mod = { exports: {} as Record<string, Component> };
  const jsx = (type: string, props: Record<string, unknown>): ElementNode => ({
    type, props, children: Array.isArray(props.children) ? props.children : [props.children],
  });
  const requireStub = (id: string): unknown => {
    if (id === "../controls") return { Toggle: "Toggle" };
    if (id === "./QuotaDetails") return loadModule("QuotaDetails");
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react") return {
      useState: (initial: unknown) => {
        const mount = currentMount!;
        const index = mount.cursor++;
        if (!(index in mount.states)) mount.states[index] = initial;
        return [mount.states[index], (value: unknown) => { mount.states[index] = value; mount.update(); }];
      },
      useEffect: (effect: () => void) => { currentMount!.effects.push(effect); },
      useRef: (initial: unknown) => {
        const mount = currentMount!;
        const index = mount.cursor++;
        if (!(index in mount.states)) mount.states[index] = { current: initial };
        return mount.states[index];
      },
    };
    throw new Error(`unexpected dependency: ${id}`);
  };
  runInNewContext(compiled, { module: mod, exports: mod.exports, require: requireStub }, { timeout: 2000 });
  return mod.exports;
}
function textContent(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (typeof node !== "object") return String(node);
  return (node as ElementNode).children.map(textContent).join(" ");
}
function findNode(node: ElementNode, predicate: (node: ElementNode) => boolean): ElementNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findNode(child as ElementNode, predicate); if (found) return found; }
    return undefined;
  }
  if (predicate(node)) return node;
  for (const child of node.children) {
    if (child && typeof child === "object") {
      const found = findNode(child as ElementNode, predicate);
      if (found) return found;
    }
  }
  return undefined;
}
function mountPanel(component: Component, props: Record<string, unknown>) {
  let tree: ElementNode;
  const mount = { states: [] as unknown[], cursor: 0, effects: [] as (() => void)[], update: () => {
    mount.cursor = 0;
    currentMount = mount;
    tree = component(props);
    currentMount = undefined;
  } };
  mount.update();
  for (const effect of mount.effects.splice(0)) effect();
  return { tree: () => tree! };
}
const Credits = loadComponent("CodexCredits", "CodexCredits");
const Panel = loadComponent("ResetCreditsPanel", "ResetCreditsPanel");
const renderCredits = (props: Record<string, unknown>) => mountPanel(Credits, props).tree();
// What a person sees: hidden subtrees are skipped.
function visibleText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (typeof node !== "object") return String(node);
  if ((node as ElementNode).props?.hidden === true) return "";
  return (node as ElementNode).children.map(visibleText).join(" ");
}
const withParams = (key: string, params?: Record<string, string | number>) => params ? `${key}(${Object.values(params).join(",")})` : key;
const disclosure = (tree: ElementNode) => findNode(tree, n => n.type === "button" && n.props["aria-expanded"] !== undefined);
describe("quota details start folded", () => {
  it("shows the credit balance but folds the credit details until expanded", () => {
    const view = mountPanel(Credits, { balance: "12.5", locale: "en", resetCreditCount: 3, usableNow: 2, overage: true, t: withParams });
    const header = disclosure(view.tree());
    assert.ok(header); assert.equal(header.props["aria-expanded"], false);
    assert.ok(findNode(view.tree(), n => n.props.id === header.props["aria-controls"]));
    assert.match(visibleText(view.tree()), /12\.5/);
    assert.doesNotMatch(visibleText(view.tree()), /settings\.quota\.credits\.overage|usableNow/);
    (header.props.onClick as () => void)();
    assert.equal(disclosure(view.tree())!.props["aria-expanded"], true);
    assert.match(visibleText(view.tree()), /settings\.quota\.credits\.overage/);
    assert.match(visibleText(view.tree()), /settings\.quota\.resetCredits\.usableNow\(2\)/);
  });
  it("folds reset credits behind a count and earliest-expiry summary", async () => {
    const transport = { getOperations: async () => [], redeem: async () => {},
      list: async () => ({ accountRef: "acct", complete: true, credits: [{ expiresAt: "2026-12-05T00:00:00Z" }, { expiresAt: "2026-12-01T00:00:00Z" }] }) };
    const view = mountPanel(Panel, { transport, accountRef: "acct", availableCount: 2, applicableAvailableCount: 2, t: withParams });
    await new Promise(resolve => setImmediate(resolve));
    const earliest = new Date("2026-12-01T00:00:00Z").toLocaleDateString();
    const header = disclosure(view.tree());
    assert.ok(header); assert.equal(header.props["aria-expanded"], false);
    assert.ok(visibleText(view.tree()).includes(`settings.quota.resetCredits.summaryExpiry(2,${earliest})`));
    assert.doesNotMatch(visibleText(view.tree()), /settings\.quota\.redeem\.action|settings\.quota\.autoRedeem/);
    (header.props.onClick as () => void)();
    assert.equal(disclosure(view.tree())!.props["aria-expanded"], true);
    assert.match(visibleText(view.tree()), /settings\.quota\.redeem\.action/);
    assert.match(visibleText(view.tree()), /settings\.quota\.resetCredits\.list/);
  });
  it("reads numeric expiry timestamps for the summary and the credit list", async () => {
    const seconds = Date.parse("2026-12-03T00:00:00Z") / 1000;
    const transport = { getOperations: async () => [], redeem: async () => {},
      list: async () => ({ accountRef: "acct", complete: true, credits: [{ title: "credit", expiresAt: seconds }] }) };
    const view = mountPanel(Panel, { transport, accountRef: "acct", availableCount: 1, t: withParams });
    await new Promise(resolve => setImmediate(resolve));
    const date = new Date(seconds * 1000).toLocaleDateString();
    assert.ok(visibleText(view.tree()).includes(`settings.quota.resetCredits.summaryExpiry(1,${date})`));
    (disclosure(view.tree())!.props.onClick as () => void)();
    const list = findNode(view.tree(), n => n.type === "button" && textContent(n).includes("resetCredits.list"));
    (list!.props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(visibleText(view.tree()).includes(`settings.quota.resetCredits.expires(${date})`));
  });
  it("shows only the newest credit list for the displayed account", async () => {
    const listed = (accountRef: string, title: string) => ({ accountRef, complete: true, credits: [{ title, expiresAt: "2026-12-05T00:00:00Z" }] });
    const pending: Array<(value: unknown) => void> = []; let calls = 0;
    const transport = { getOperations: async () => [], redeem: async () => {},
      list: () => ++calls === 1 ? Promise.resolve(listed("acct", "mount")) : new Promise(resolve => { pending.push(resolve); }) };
    const view = mountPanel(Panel, { transport, accountRef: "acct", availableCount: 1, t: withParams });
    await new Promise(resolve => setImmediate(resolve));
    (disclosure(view.tree())!.props.onClick as () => void)();
    const show = () => (findNode(view.tree(), n => n.type === "button" && textContent(n).includes("resetCredits.list"))!.props.onClick as () => void)();
    show(); show();
    pending[1]!(listed("acct", "newest-credit")); await new Promise(resolve => setImmediate(resolve));
    pending[0]!(listed("acct", "older-credit")); await new Promise(resolve => setImmediate(resolve));
    assert.match(visibleText(view.tree()), /newest-credit/);
    assert.doesNotMatch(visibleText(view.tree()), /older-credit/);
    show(); pending[2]!(listed("other-account", "other-account-credit")); await new Promise(resolve => setImmediate(resolve));
    assert.doesNotMatch(visibleText(view.tree()), /other-account-credit/);
  });
  it("ignores an older summary response that arrives after a newer list", async () => {
    const stale = { accountRef: "acct", complete: true, credits: [{ expiresAt: "2026-12-01T00:00:00Z" }] };
    const fresh = { accountRef: "acct", complete: true, credits: [{ expiresAt: "2026-12-09T00:00:00Z" }] };
    let releaseFirst!: () => void; let calls = 0;
    const transport = { getOperations: async () => [], redeem: async () => {},
      list: () => ++calls === 1 ? new Promise(resolve => { releaseFirst = () => resolve(stale); }) : Promise.resolve(fresh) };
    const view = mountPanel(Panel, { transport, accountRef: "acct", availableCount: 1, t: withParams });
    (disclosure(view.tree())!.props.onClick as () => void)();
    (findNode(view.tree(), n => n.type === "button" && textContent(n).includes("resetCredits.list"))!.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    releaseFirst(); await new Promise(resolve => setImmediate(resolve));
    const summary = textContent(findNode(view.tree(), n => n.props.className === "quota-details__summary")!);
    assert.ok(summary.includes(new Date("2026-12-09T00:00:00Z").toLocaleDateString()), summary);
  });
  it("refreshes the earliest-expiry summary after a redemption", async () => {
    let credits = [{ expiresAt: "2026-12-01T00:00:00Z" }, { expiresAt: "2026-12-09T00:00:00Z" }];
    const transport = { getOperations: async () => [], list: async () => ({ accountRef: "acct", complete: true, credits }),
      redeem: async () => { credits = credits.slice(1); return { result: { outcome: "reset" } }; } };
    const view = mountPanel(Panel, { transport, accountRef: "acct", availableCount: 2, t: withParams });
    await new Promise(resolve => setImmediate(resolve));
    (disclosure(view.tree())!.props.onClick as () => void)();
    const open = findNode(view.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"));
    (open!.props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
    const dialog = findNode(view.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
    (findNode(dialog, n => n.type === "button" && textContent(n).includes("redeem.action"))!.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    assert.ok(visibleText(view.tree()).includes(new Date("2026-12-09T00:00:00Z").toLocaleDateString()));
  });
});
it("shows a partial list and the opt-in account while a different account is off", async () => {
  const transport = { getOperations: async () => [], redeem: async () => {},
    getSettings: async () => ({ enabled: true, leadMinutes: 10, accountRef: "account-a" }),
    list: async () => ({ accountRef: "account-b", complete: false, credits: [{ title: "visible credit" }] }) };
  const panel = mountPanel(Panel, { transport, accountRef: "account-b", t: (key: string, values?: { account?: string }) => values?.account ? `${key} ${values.account}` : key });
  await Promise.resolve();
  assert.equal(findNode(panel.tree(), n => n.type === "Toggle")?.props.checked, false);
  assert.match(textContent(panel.tree()), /account-a/);
  const button = findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("resetCredits.list"));
  assert.ok(button); (button.props.onClick as () => void)(); await Promise.resolve();
  assert.match(textContent(panel.tree()), /resetCredits.partial/); assert.match(textContent(panel.tree()), /visible credit/);
});
function fakeTransport() {
  const calls: string[] = [];
  return { calls, getOperations: async () => { calls.push("GET"); return [{ operationId: "op-1", state: "unknown" }]; },
    list: async () => ({ accountRef: "displayed", credits: [] }),
    redeem: async () => { calls.push("POST"); } };
}

describe("quota UI credits and reset behavior", () => {
  for (const switchAt of ["open", "confirm"]) it(`rejects a changed Codex account at ${switchAt}`, async () => {
    let current = "account-a"; let refreshes = 0;
    const posts: string[] = [];
    const transport = { getOperations: async () => [], list: async () => ({ accountRef: current, credits: [] }),
      redeem: async () => { posts.push("confirmation", "consume"); } };
    const panel = mountPanel(Panel, { transport, availableCount: 1, accountRef: "account-a", onRefresh: () => { refreshes++; } });
    await Promise.resolve();
    if (switchAt === "open") current = "account-b";
    (findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"))!.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    if (switchAt === "confirm") {
      const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
      current = "account-b";
      (findNode(dialog, n => n.type === "button" && textContent(n).includes("redeem.action"))!.props.onClick as () => void)();
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(findNode(panel.tree(), n => n.props.role === "dialog"), undefined);
    assert.match(textContent(panel.tree()), /redeem.identityChanged/);
    assert.deepEqual(posts, []); assert.equal(refreshes, 1);
  });
  it("shows balance separately from the reset-credit count", () => {
    const tree = renderCredits({ balance: "12.50", resetCreditCount: 3 });
    assert.match(textContent(tree), /12\.5/);
    assert.ok(findNode(tree, node => node.props["data-testid"] === "reset-credit-count"), "separate reset-credit count");
    assert.match(textContent(tree), /3/);
  });
  it("formats numeric balances for the UI locale and preserves the raw value", () => {
    const tree = renderCredits({ balance: "62384.0276815000", resetCreditCount: 0, locale: "en" });
    const balance = findNode(tree, n => n.props["data-testid"] === "balance");
    assert.ok(balance); assert.equal(textContent(balance), "62,384.03");
    assert.equal(balance.props.title, "62384.0276815000");
    assert.match(textContent(renderCredits({ balance: "not numeric", resetCreditCount: 0, locale: "ko" })), /not numeric/);
  });
  it("disables redeem for zero or unknown usable credits but leaves listing available", async () => {
    const transport = { getOperations: async () => [], list: async () => ({ credits: [] }), redeem: async () => {} };
    for (const counts of [{ availableCount: 0 }, { availableCount: null }, { availableCount: 2, applicableAvailableCount: 0 }, { availableCount: 2, applicableAvailableCount: null }]) {
      const panel = mountPanel(Panel, { transport, ...counts }); await Promise.resolve();
      const button = findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"));
      assert.equal(button?.props.disabled, true); assert.match(textContent(panel.tree()), /redeem.noCredit|redeem.creditUnknown/);
      assert.equal(findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("resetCredits.list"))?.props.disabled, undefined);
    }
    for (const counts of [{ availableCount: 2 }, { availableCount: 0, applicableAvailableCount: 1 }]) {
      const panel = mountPanel(Panel, { transport, ...counts }); await Promise.resolve();
      assert.equal(findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"))?.props.disabled, false);
    }
  });
  it("shows empty and error states after requesting the credit list", async () => {
    for (const fail of [false, true]) {
      const transport = { getOperations: async () => [], list: async () => { if (fail) throw new Error("offline"); return { credits: [] }; }, redeem: async () => {} };
      const panel = mountPanel(Panel, { transport }); await Promise.resolve();
      const button = findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("resetCredits.list"));
      (button!.props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
      assert.match(textContent(panel.tree()), fail ? /resetCredits.loadError/ : /resetCredits.empty/);
    }
  });
  it("distinguishes zero reset credits from an unknown count", () => {
    const zero = textContent(renderCredits({ balance: "12.50", resetCreditCount: 0 }));
    const unknown = textContent(renderCredits({ balance: "12.50", resetCreditCount: null }));
    assert.notEqual(zero, unknown);
    assert.match(zero, /\b0\b/);
    assert.match(unknown, /—/);
  });
  it("opens a confirmation dialog before any POST", async () => {
    const transport = fakeTransport();
    const mounted = mountPanel(Panel, { transport, accountRef: "displayed" });
    const button = findNode(mounted.tree(), node => node.type === "button" && textContent(node).includes("redeem.action"));
    assert.ok(button);
    (button.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(transport.calls.filter(call => call === "POST").length, 0);
    assert.ok(findNode(mounted.tree(), node => node.props.role === "dialog"), "confirmation dialog");
  });
  it("sends the account reference shown in the confirmation dialog", async () => {
    let account = "";
    const transport = { getOperations: async () => [], list: async () => ({ accountRef: "displayed-ref", credits: [] }),
      redeem: async (ref: string) => { account = ref; } };
    const panel = mountPanel(Panel, { transport, availableCount: 1, accountRef: "displayed-ref" }); await Promise.resolve();
    const open = findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"));
    (open!.props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
    const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
    assert.match(textContent(dialog), /displayed-ref/);
    const confirm = findNode(dialog, n => n.type === "button" && textContent(n).includes("redeem.action"));
    (confirm!.props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(account, "displayed-ref");
  });
  it("reloads an unresolved operation on remount without another POST", async () => {
    const transport = fakeTransport();
    mountPanel(Panel, { transport });
    await Promise.resolve();
    const remounted = mountPanel(Panel, { transport });
    await Promise.resolve();
    assert.deepEqual(transport.calls, ["GET", "GET"]);
    assert.match(textContent(remounted.tree()), /op-1|unknown/i);
  });
});

describe("quota UI fake transport controls", () => {
  it("loads operations without dispatching a POST on mount", async () => {
    const transport = fakeTransport();
    mountPanel(Panel, { transport });
    await Promise.resolve();
    assert.deepEqual(transport.calls, ["GET"]);
  });
  it("sends the confirmation before a redeem with the same operation id", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const source = readFileSync("ui/src/components/settings/resetCreditsTransport.ts", "utf8");
    const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
    const mod = { exports: {} as { resetCreditsTransport: { redeem(accountRef: string): Promise<unknown> } } };
    const request = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return calls.length === 1 ? { token: "confirmation" } : { result: { outcome: "reset" } };
    };
    runInNewContext(compiled, { module: mod, exports: mod.exports,
      require: () => ({ jsonFetch: request }), crypto: { randomUUID: () => "operation-1" } });
    await mod.exports.resetCreditsTransport.redeem("displayed-account");
    assert.deepEqual(calls.map(({ url }) => url), ["/api/quota/reset-confirmations", "/api/quota/codex/reset-credits/redeem"]);
    assert.equal(calls[0]?.body.operationId, "operation-1");
    assert.equal(calls[0]?.body.accountRef, "displayed-account");
    assert.equal(calls[1]?.body.operationId, "operation-1");
    assert.equal(calls[1]?.body.confirmationToken, "confirmation");
    assert.equal(Object.keys(calls[1]!.body).length, 2);
  });
});

const requiredKeys = [
  "window.5h", "window.7d", "window.30d", "window.other",
  "credits.balance", "credits.unknown", "credits.unlimited",
  "resetCredits.empty", "resetCredits.loadError", "redeem.creditUnknown", "resetCredits.count", "resetCredits.unknown", "resetCredits.usableNow", "resetCredits.list", "resetCredits.expires",
  "redeem.action", "redeem.confirm", "redeem.cancel", "redeem.redeeming", "redeem.success",
  "redeem.nothingToReset", "redeem.noCredit", "redeem.identityChanged", "redeem.unknown",
  "acknowledge.action", "acknowledge.explanation", "acknowledge.blocked",
  "upsell.buyReset", "upsell.viewUsage",
];
function quotaStrings(locale: string): Record<string, string> {
  const dict = JSON.parse(readFileSync(`ui/src/i18n/${locale}.json`, "utf8")) as { settings: { quota: Record<string, unknown> } };
  const result: Record<string, string> = {};
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") result[path] = value;
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
  };
  for (const family of ["window", "credits", "resetCredits", "redeem", "acknowledge", "upsell"]) {
    visit(dict.settings.quota[family], family);
  }
  return result;
}
describe("reset credit locale contracts", () => {
  for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"]) {
    it(`defines every required quota label in ${locale}`, () => {
      const entries = quotaStrings(locale);
      assert.deepEqual(requiredKeys.filter(key => typeof entries[key] !== "string"), [], `${locale}: missing required keys`);
    });
  }
  it("uses matching interpolation variables for every required key in all locales", () => {
    const locales = ["en", "ko", "zh-Hans", "zh-Hant"];
    const entries = locales.map(quotaStrings);
    const keys = [...new Set([...requiredKeys, ...entries.flatMap(entry => Object.keys(entry))])];
    const missing = keys.flatMap(key => locales.filter((_, index) => typeof entries[index]![key] !== "string")
      .map(locale => `${locale}:${key}`));
    assert.deepEqual(missing, [], "all keys must exist before interpolation comparison");
    const variables = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const key of keys) for (const entry of entries) {
      assert.deepEqual(variables(entry[key]!), variables(entries[0]![key]!), key);
    }
  });
});
after(() => assert.equal(sentinelCount(), 0, "no non-loopback socket attempts"));
