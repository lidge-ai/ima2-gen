import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
type ElementNode = { type: string; props: Record<string, unknown>; children: unknown[] };
type Component = (props: Record<string, unknown>) => ElementNode;
let currentMount: { states: unknown[]; cursor: number; effects: (() => unknown)[]; update: () => void } | undefined;
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
    if (id === "./ResetCreditsPanel") return { trapKey: () => {} };
    if (id === "./QuotaDetails") return loadModule("QuotaDetails");
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react") return {
      useState: (initial: unknown) => {
        const mount = currentMount!;
        const index = mount.cursor++;
        if (!(index in mount.states)) mount.states[index] = initial;
        return [mount.states[index], (value: unknown) => { mount.states[index] = value; mount.update(); }];
      },
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => unknown) => { currentMount!.effects.push(effect); },
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
  const mount = { states: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[], update: () => {
    mount.cursor = 0;
    currentMount = mount;
    tree = component(props);
    currentMount = undefined;
  } };
  mount.update();
  const cleanups = mount.effects.splice(0).map(effect => effect());
  return { tree: () => tree!, unmount: () => { for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup(); } };
}

for (const switchAt of ["open", "confirm"]) it(`rejects a changed Grok coupon account at ${switchAt}`, async () => {
  let current = "account-a"; let refreshes = 0;
  const posts: string[] = [];
  const transport = { list: async () => ({ accountLabel: current, accountRef: current, coupons: [{ tokenId: "token", validityEnd: null }] }),
    getOperations: async () => [], redeem: async () => { posts.push("confirmation", "consume"); return {}; } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport, onRefresh: () => { refreshes++; } });
  await new Promise(resolve => setImmediate(resolve));
  if (switchAt === "open") current = "account-b";
  (findNode(panel.tree(), n => n.props["data-coupon"] === "token")!.props.onClick as (event: unknown) => void)({ currentTarget: { focus() {} } });
  await new Promise(resolve => setImmediate(resolve));
  if (switchAt === "confirm") {
    const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog); current = "account-b";
    (findNode(dialog, n => n.type === "button" && textContent(n).includes("redeem.action"))!.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(findNode(panel.tree(), n => n.props.role === "dialog"), undefined);
  assert.match(textContent(panel.tree()), /redeem.identityChanged/);
  assert.deepEqual(posts, []); assert.equal(refreshes, 1);
});
it("identifies the account and selected coupon in the Grok confirmation without email", async () => {
  const accountRef = "abcdefgh12345678"; const tokenId = "couponAB12345678"; const validityEnd = 2000000000;
  const transport = { list: async () => ({ accountLabel: null, accountRef, coupons: [{ tokenId, validityEnd }] }),
    getOperations: async () => [], redeem: async () => { throw new Error("unexpected redemption"); } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport, t: (key: string, values?: { date?: string }) => `${key} ${values?.date ?? ""}` });
  await new Promise(resolve => setImmediate(resolve));
  (findNode(panel.tree(), n => n.props["data-coupon"] === tokenId)!.props.onClick as (event: unknown) => void)({ currentTarget: { focus() {} } });
  await new Promise(resolve => setImmediate(resolve));
  const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
  const text = textContent(dialog);
  assert.match(text, /abcdefgh.*5678/); assert.doesNotMatch(text, /abcdefgh12345678/);
  assert.match(text, /couponAB.*5678/); assert.doesNotMatch(text, /couponAB12345678/);
  assert.ok(text.includes(new Date(validityEnd * 1000).toLocaleString()));
});
it("identifies the Codex account by shortened reference without email", async () => {
  const accountRef = "abcdefgh12345678";
  const transport = { getOperations: async () => [], list: async () => ({ accountRef, credits: [] }), redeem: async () => {} };
  const panel = mountPanel(loadComponent("ResetCreditsPanel", "ResetCreditsPanel"), { transport, accountRef, availableCount: 1 });
  await new Promise(resolve => setImmediate(resolve));
  (findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"))!.props.onClick as () => void)();
  await new Promise(resolve => setImmediate(resolve));
  const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
  assert.match(textContent(dialog), /abcdefgh.*5678/); assert.doesNotMatch(textContent(dialog), /abcdefgh12345678/);
});
it("loads the coupon account and unresolved operations without redeeming", async () => {
  const calls: string[] = [];
  const transport = { list: async () => { calls.push("list"); return { accountLabel: "coupon@example.test", coupons: [{ tokenId: "token", validityEnd: 2000000000 }] }; },
    getOperations: async () => { calls.push("operations"); return [{ operation_id: "old", state: "unknown" }]; }, redeem: async () => { calls.push("redeem"); } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["list", "operations"]);
  assert.match(textContent(panel.tree()), /coupon@example.test/);
  assert.match(textContent(panel.tree()), /old/);
  assert.ok(findNode(panel.tree(), n => n.type === "button" && n.props.disabled === true));
});
it("requires confirmation before redeeming the selected coupon", async () => {
  const calls: string[] = [];
  const transport = { list: async () => ({ accountLabel: "account", accountRef: "displayed-ref", coupons: [{ tokenId: "token", validityEnd: null }] }),
    getOperations: async () => [], redeem: async (id: string) => { calls.push(id); return { result: { outcome: "success" } }; } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport });
  await new Promise(resolve => setImmediate(resolve));
  const button = findNode(panel.tree(), n => n.type === "button" && n.props["data-coupon"] === "token");
  assert.ok(button); (button.props.onClick as (event: unknown) => void)({ currentTarget: { focus() {} } });
  assert.deepEqual(calls, []);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findNode(panel.tree(), n => n.props.role === "dialog"));
});
it("passes the displayed coupon account into confirmation", async () => {
  const calls: string[] = [];
  const transport = { list: async () => ({ accountLabel: "account", accountRef: "displayed-ref", coupons: [{ tokenId: "token", validityEnd: null }] }),
    getOperations: async () => [], redeem: async (_id: string, accountRef: string) => { calls.push(accountRef); return {}; } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport });
  await new Promise(resolve => setImmediate(resolve));
  (findNode(panel.tree(), n => n.props["data-coupon"] === "token")!.props.onClick as (event: unknown) => void)({ currentTarget: { focus() {} } });
  await new Promise(resolve => setImmediate(resolve));
  const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
  (findNode(dialog, n => n.type === "button" && textContent(n).includes("redeem.action"))!.props.onClick as () => void)();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, ["displayed-ref"]);
});
for (const [outcome, message] of [["reset", "success"], ["nothing_to_reset", "nothingToReset"],
  ["no_credit", "noCredit"], ["already_redeemed", "alreadyRedeemed"], ["unknown", "unknown"]]) {
  it(`shows the Codex ${outcome} message`, async () => {
    const transport = { getOperations: async () => [], list: async () => ({ accountRef: "account", credits: [] }),
      redeem: async () => ({ result: { outcome } }) };
    const panel = mountPanel(loadComponent("ResetCreditsPanel", "ResetCreditsPanel"), { transport, accountRef: "account", availableCount: 1 });
    await new Promise(resolve => setImmediate(resolve));
    const open = findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("redeem.action"));
    assert.ok(open); (open.props.onClick as (event: unknown) => void)({ currentTarget: { focus() {} } });
    await new Promise(resolve => setImmediate(resolve));
    const dialog = findNode(panel.tree(), n => n.props.role === "dialog"); assert.ok(dialog);
    const button = findNode(dialog, n => n.type === "button" && textContent(n).includes("redeem.action"));
    assert.ok(button); (button.props.onClick as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(textContent(panel.tree()), new RegExp(`redeem\\.${message}`));
  });
}
it("loads auto-redeem settings and exposes bounded lead minutes", async () => {
  const transport = { getOperations: async () => [], redeem: async () => {}, getSettings: async () => ({ enabled: false, leadMinutes: 10 }), saveSettings: async () => {} };
  const panel = mountPanel(loadComponent("ResetCreditsPanel", "ResetCreditsPanel"), { transport });
  await Promise.resolve();
  const input = findNode(panel.tree(), n => n.type === "input" && n.props.type === "number");
  assert.ok(input); assert.equal(input.props.min, 1); assert.equal(input.props.max, 60);
  assert.match(textContent(panel.tree()), /autoRedeem.warning/);
  assert.ok(findNode(panel.tree(), n => n.type === "Toggle"), "shared toggle");
  assert.equal(input.props.className, "custom-size-input");
  assert.ok(findNode(panel.tree(), n => n.props.className === "settings-row"));
});
it("shows an account-bound fence and resumes it on request", async () => {
  const calls: string[] = []; let fenced = true;
  const transport = { getOperations: async () => [], redeem: async () => {},
    getFence: async () => ({ accountRef: "account", fence: fenced ? { fenced: true, operation_id: "old", outcome: "reset", settled_at: 1, cause: "unconfirmed" } : { fenced: false } }),
    releaseFence: async (id: string, ref: string) => { calls.push(id, ref); fenced = false; } };
  const panel = mountPanel(loadComponent("ResetCreditsPanel", "ResetCreditsPanel"), { transport, accountRef: "account" });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(textContent(panel.tree()), /autoRedeem.paused/);
  assert.match(textContent(panel.tree()), /autoRedeem.resumeExplanation/);
  const button = findNode(panel.tree(), n => n.type === "button" && textContent(n).includes("autoRedeem.resume"));
  assert.ok(button); (button.props.onClick as () => void)();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["old", "account"]); assert.doesNotMatch(textContent(panel.tree()), /autoRedeem.paused/);
});
// What a person sees: hidden subtrees are skipped.
function visibleText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (typeof node !== "object") return String(node);
  if ((node as ElementNode).props?.hidden === true) return "";
  return (node as ElementNode).children.map(visibleText).join(" ");
}
const withParams = (key: string, params?: Record<string, string | number>) => params ? `${key}(${Object.values(params).join(",")})` : key;
it("folds Grok coupons behind a count summary until expanded", async () => {
  const transport = { getOperations: async () => [], redeem: async () => ({}),
    list: async () => ({ accountLabel: "coupon@example.test", accountRef: "acct", coupons: [{ tokenId: "late", validityEnd: 2000000000 }, { tokenId: "early", validityEnd: 1900000000 }] }) };
  const view = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport, t: withParams });
  await new Promise(resolve => setImmediate(resolve));
  const header = findNode(view.tree(), n => n.type === "button" && n.props["aria-expanded"] !== undefined);
  assert.ok(header); assert.equal(header.props["aria-expanded"], false);
  assert.ok(findNode(view.tree(), n => n.props.id === header.props["aria-controls"]));
  const earliest = new Date(1900000000 * 1000).toLocaleDateString();
  assert.ok(visibleText(view.tree()).includes(`settings.quota.grokCoupons.summaryExpiry(2,${earliest})`));
  assert.doesNotMatch(visibleText(view.tree()), /settings\.quota\.redeem\.action|coupon@example\.test/);
  (header.props.onClick as () => void)();
  assert.equal(findNode(view.tree(), n => n.type === "button" && n.props["aria-expanded"] !== undefined)!.props["aria-expanded"], true);
  assert.match(visibleText(view.tree()), /settings\.quota\.redeem\.action/);
  assert.match(visibleText(view.tree()), /coupon@example\.test/);
});
it("flags an unresolved coupon operation in the folded summary", async () => {
  const transport = { getOperations: async () => [{ operationId: "op", state: "unknown" }], redeem: async () => ({}),
    list: async () => ({ accountLabel: null, accountRef: "acct", coupons: [] }) };
  const view = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport, t: withParams });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(visibleText(view.tree()), /settings\.quota\.details\.attention/);
});
it("shows a fence created in the background while the panel stays open", async () => {
  let fenced = false; let poll: (() => void) | undefined; let stopped = 0;
  const transport = { getOperations: async () => [], redeem: async () => {},
    getFence: async () => ({ accountRef: "account", fence: fenced ? { fenced: true, operation_id: "auto", outcome: "reset", settled_at: 1, cause: "unconfirmed" } : { fenced: false } }) };
  const fencePoller = (refresh: () => void) => { poll = refresh; return () => { stopped++; }; };
  const panel = mountPanel(loadComponent("ResetCreditsPanel", "ResetCreditsPanel"), { transport, accountRef: "account", fencePoller });
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(textContent(panel.tree()), /autoRedeem.paused/);
  fenced = true; assert.ok(poll); poll();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(textContent(panel.tree()), /autoRedeem.paused/);
  panel.unmount(); assert.equal(stopped, 1);
});
it("sends a target-bound Grok confirmation before redeem", async () => {
  const source = readFileSync("ui/src/components/settings/grokCouponsTransport.ts", "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const mod = { exports: {} as { grokCouponsTransport: { redeem(id: string, accountRef: string): Promise<unknown> } } };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const request = async (url: string, init: { body: string }) => { calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> }); return { token: "confirmation" }; };
  runInNewContext(compiled, { module: mod, exports: mod.exports, require: () => ({ jsonFetch: request }), crypto: { randomUUID: () => "op" } });
  await mod.exports.grokCouponsTransport.redeem("coupon", "displayed-account");
  assert.deepEqual(calls.map(c => c.url), ["/api/quota/reset-confirmations", "/api/quota/grok/reset-coupons/redeem"]);
  assert.equal(calls[0]?.body.provider, "grok"); assert.equal(calls[0]?.body.target, "coupon");
  assert.equal(calls[0]?.body.accountRef, "displayed-account");
  assert.equal(calls[1]?.body.target, "coupon"); assert.equal(calls[1]?.body.confirmationToken, "confirmation");
});
after(() => assert.equal(sentinelCount(), 0));

it("shows Grok weekly source, product use and prepaid balance", () => {
  const source = readFileSync("ui/src/components/settings/QuotaCard.tsx", "utf8");
  const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  const mod = { exports: {} as { GrokQuota: Component } };
  const jsx = (type: string, props: Record<string, unknown>): ElementNode => ({ type, props, children: Array.isArray(props.children) ? props.children : [props.children] });
  runInNewContext(code, { module: mod, exports: mod.exports, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "../../i18n") return { useI18n: () => ({ t: (key: string) => key }) };
    return {};
  } });
  const tree = mod.exports.GrokQuota({ loading: false, data: { grok: { source: "grok-cli", windows: [{ label: "weekly", percent: 20 }], productUsage: [{ product: "chat", percent: 25 }], prepaidBalance: 12 } } });
  const contents = textContent(tree);
  assert.match(contents, /grok-cli/); assert.match(contents, /accountMayDiffer/); assert.match(contents, /chat.*25\s*%/); assert.match(contents, /12/);
  const monthly = mod.exports.GrokQuota({ loading: false, data: { grok: { source: "grok-cli", windows: [{ label: "monthly", percent: 20 }] } } });
  assert.match(textContent(monthly), /accountMayDiffer/);
});
it("defines matching new labels and interpolation variables in all locales", () => {
  const locales = ["en", "ko", "zh-Hans", "zh-Hant"];
  const entries = locales.map(locale => (JSON.parse(readFileSync(`ui/src/i18n/${locale}.json`, "utf8")) as { settings: { quota: Record<string, Record<string, string>> } }).settings.quota);
  for (const family of ["grokSource", "grokCoupons", "autoRedeem"]) {
    const keys = Object.keys(entries[0]![family]!).sort();
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry[family]!).sort(), keys);
      for (const key of keys) assert.deepEqual([...entry[family]![key]!.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort(), [...entries[0]![family]![key]!.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort());
    }
  }
  for (const entry of entries) assert.ok(entry.window?.weekly);
});
