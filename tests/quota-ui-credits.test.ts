import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { transformSync } from "esbuild";
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
