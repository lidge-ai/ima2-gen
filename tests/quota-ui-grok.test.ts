import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
type ElementNode = { type: string; props: Record<string, unknown>; children: unknown[] };
type Component = (props: Record<string, unknown>) => ElementNode;
let currentMount: { states: unknown[]; cursor: number; effects: (() => void)[]; update: () => void } | undefined;
function loadComponent(file: string, name: string): Component {
  const source = readFileSync(`ui/src/components/settings/${file}.tsx`, "utf8");
  const compiled = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  const mod = { exports: {} as Record<string, Component> };
  const jsx = (type: string, props: Record<string, unknown>): ElementNode => ({
    type, props, children: Array.isArray(props.children) ? props.children : [props.children],
  });
  const requireStub = (id: string): unknown => {
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
  return mod.exports[name]!;
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

it("loads the coupon account and unresolved operations without redeeming", async () => {
  const calls: string[] = [];
  const transport = { list: async () => { calls.push("list"); return { accountLabel: "coupon@example.test", coupons: [{ tokenId: "token", validityEnd: 2000000000 }] }; },
    getOperations: async () => { calls.push("operations"); return [{ operation_id: "old", state: "unknown" }]; }, redeem: async () => { calls.push("redeem"); } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport });
  await Promise.resolve();
  assert.deepEqual(calls, ["list", "operations"]);
  assert.match(textContent(panel.tree()), /coupon@example.test/);
  assert.match(textContent(panel.tree()), /old/);
  assert.ok(findNode(panel.tree(), n => n.type === "button" && n.props.disabled === true));
});
it("requires confirmation before redeeming the selected coupon", async () => {
  const calls: string[] = [];
  const transport = { list: async () => ({ accountLabel: "account", coupons: [{ tokenId: "token", validityEnd: null }] }),
    getOperations: async () => [], redeem: async (id: string) => { calls.push(id); return { result: { outcome: "success" } }; } };
  const panel = mountPanel(loadComponent("GrokCouponsPanel", "GrokCouponsPanel"), { transport });
  await Promise.resolve();
  const button = findNode(panel.tree(), n => n.type === "button" && n.props["data-coupon"] === "token");
  assert.ok(button); (button.props.onClick as () => void)();
  assert.deepEqual(calls, []);
  assert.ok(findNode(panel.tree(), n => n.props.role === "dialog"));
});
it("loads auto-redeem settings and exposes bounded lead minutes", async () => {
  const transport = { getOperations: async () => [], redeem: async () => {}, getSettings: async () => ({ enabled: false, leadMinutes: 10 }), saveSettings: async () => {} };
  const panel = mountPanel(loadComponent("ResetCreditsPanel", "ResetCreditsPanel"), { transport });
  await Promise.resolve();
  const input = findNode(panel.tree(), n => n.type === "input" && n.props.type === "number");
  assert.ok(input); assert.equal(input.props.min, 1); assert.equal(input.props.max, 60);
  assert.match(textContent(panel.tree()), /autoRedeem.warning/);
});
it("sends a target-bound Grok confirmation before redeem", async () => {
  const source = readFileSync("ui/src/components/settings/grokCouponsTransport.ts", "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const mod = { exports: {} as { grokCouponsTransport: { redeem(id: string): Promise<unknown> } } };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const request = async (url: string, init: { body: string }) => { calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> }); return { token: "confirmation" }; };
  runInNewContext(compiled, { module: mod, exports: mod.exports, require: () => ({ jsonFetch: request }), crypto: { randomUUID: () => "op" } });
  await mod.exports.grokCouponsTransport.redeem("coupon");
  assert.deepEqual(calls.map(c => c.url), ["/api/quota/reset-confirmations", "/api/quota/grok/reset-coupons/redeem"]);
  assert.equal(calls[0]?.body.provider, "grok"); assert.equal(calls[0]?.body.target, "coupon");
  assert.equal(calls[1]?.body.target, "coupon"); assert.equal(calls[1]?.body.confirmationToken, "confirmation");
});
after(() => assert.equal(sentinelCount(), 0));
