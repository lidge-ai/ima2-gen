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

describe("reset credit locale contracts", () => {
  for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"]) {
    it(`defines reset credit labels in ${locale}`, () => {
      const strings = JSON.parse(readFileSync(`ui/src/i18n/${locale}.json`, "utf8")) as Record<string, unknown>;
      for (const key of ["settings.quota.credits.balance", "settings.quota.resetCredits.count",
        "settings.quota.redeem.confirm", "settings.quota.redeem.unknown"]) {
        const value = key.split(".").reduce<unknown>((current, part) =>
          current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, strings);
        assert.equal(typeof value, "string", `${locale}: ${key}`);
      }
    });
  }
});

describe("reset credit locale interpolation parity", () => {
  it("uses the same variables for every reset quota key in all locales", () => {
    const locales = ["en", "ko", "zh-Hans", "zh-Hant"];
    const entries = locales.map(locale => {
      const dict = JSON.parse(readFileSync(`ui/src/i18n/${locale}.json`, "utf8"));
      const quota = dict.settings.quota as Record<string, unknown>;
      const result: Record<string, string> = {};
      const visit = (value: unknown, path: string): void => {
        if (typeof value === "string") result[path] = value;
        else if (value && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
        }
      };
      for (const key of ["window", "credits", "resetCredits", "redeem"]) visit(quota[key], key);
      return result;
    });
    const keys = [...new Set(entries.flatMap(entry => Object.keys(entry)))];
    assert.ok(keys.length > 0, "reset quota translations are missing");
    for (const key of keys) {
      const variables = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      for (const entry of entries) {
        assert.equal(typeof entry[key], "string", key);
        assert.deepEqual(variables(entry[key]), variables(entries[0][key]), key);
      }
    }
  });
});
