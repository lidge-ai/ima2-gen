// The NovelAI lane must be selectable in the UI without any raw id or missing
// label leaking through, and it must not offer affordances the server refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { errorCodes, resolveErrorSpec, type ImaErrorCode } from "../ui/src/lib/errorCodes.ts";
import { effectiveReferenceLimit } from "../ui/src/lib/referenceLimits.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
const LOCALES = ["en", "ko", "zh-Hans", "zh-Hant"] as const;
const NAI_MODELS = [
  "nai-diffusion-5-full",
  "nai-diffusion-5-curated",
  "nai-diffusion-4-5-full",
  "nai-diffusion-4-5-curated",
] as const;

function dictionary(locale: string): Record<string, unknown> {
  return JSON.parse(read(`ui/src/i18n/${locale}.json`)) as Record<string, unknown>;
}

function lookup(dict: Record<string, unknown>, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    dict,
  );
}

test("the generated catalog carries the nai lane and its models", () => {
  const generated = read("ui/src/generated/providers.ts");
  assert.match(generated, /"nai"/);
  for (const model of NAI_MODELS) assert.match(generated, new RegExp(model));
  // Codegen output: a hand edit here would be overwritten by the next run.
  assert.match(generated, /Do not edit/);
});

test("every nai model has a label option, so no raw id reaches the UI", () => {
  const source = read("ui/src/lib/imageModels.ts");
  for (const model of NAI_MODELS) {
    assert.match(source, new RegExp(`value: "${model}"`), `${model} has no option row`);
  }
  assert.match(source, /provider === "nai"/, "no option list is returned for the nai provider");
});

test("every nai label key resolves in all four dictionaries", () => {
  const keys = [
    "provider.naiApiKeyRequired",
    "settings.apiKeys.nai.label",
    "settings.apiKeys.nai.placeholder",
    "settings.imageModel.naiDiffusion5Full",
    "settings.imageModel.naiDiffusion5Curated",
    "settings.imageModel.naiDiffusion45Full",
    "settings.imageModel.naiDiffusion45Curated",
  ];
  for (const locale of LOCALES) {
    const dict = dictionary(locale);
    for (const key of keys) {
      const value = lookup(dict, key);
      assert.equal(typeof value, "string", `${locale} is missing ${key}`);
      assert.notEqual(String(value).trim(), "", `${locale} has an empty ${key}`);
    }
  }
});

test("NovelAI native Auto SMEA and Decrisper controls have panel wiring and localized copy", () => {
  const panel = read("ui/src/components/settings/NaiControlsPanel.tsx");
  for (const key of ["autoSmea", "decrisper"]) {
    assert.match(panel, new RegExp(`setNaiOption\\("${key}"`), `${key} has no setter wiring`);
    assert.match(panel, new RegExp(`nai\\.field\\.${key}`), `${key} has no field label`);
    assert.match(panel, new RegExp(`nai\\.help\\.${key}`), `${key} has no help copy`);
  }

  const keys = [
    "nai.field.autoSmea",
    "nai.help.autoSmea",
    "nai.field.decrisper",
    "nai.help.decrisper",
  ];
  for (const locale of LOCALES) {
    const dict = dictionary(locale);
    for (const key of keys) {
      const value = lookup(dict, key);
      assert.equal(typeof value, "string", `${locale} is missing ${key}`);
      assert.notEqual(String(value).trim(), "", `${locale} has an empty ${key}`);
    }
  }
});

test("the provider is offered everywhere a user picks one", () => {
  assert.match(read("ui/src/components/GenProviderModelSelect.tsx"), /value: "nai", label: "NovelAI"/);
  assert.match(read("ui/src/components/settings/ProviderStatusSelect.tsx"), /value: "nai"/);
  assert.match(read("ui/src/components/home/HomePromptComposer.tsx"), /nai: "NovelAI"/);
  assert.match(read("ui/src/components/ResultMetadataModal.tsx"), /nai: "NovelAI API"/);
  assert.match(read("ui/src/components/AccountSettings.tsx"), /provider="nai"/);
});

// Provider/model transitions now run as real actions in core-selection-actions.test.ts:
// "NovelAI provider fallback and model action preserve count/multimode preferences".

test("the UI offers no reference attachment for nai", () => {
  const base = { serverLimit: 12, videoModelSelected: false, mcpProvider: null };
  assert.equal(effectiveReferenceLimit({ ...base, provider: "nai" }), 0);
  // Empty numeric caps on OAuth/API still defer to the server; only an actual
  // no-reference capability disables attachments. Assert behavior, not a set name.
  assert.equal(effectiveReferenceLimit({ ...base, provider: "oauth" }), 12);
  assert.equal(effectiveReferenceLimit({ ...base, provider: "api" }), 12);
  assert.equal(effectiveReferenceLimit({ ...base, provider: "nai", mcpProvider: "runway" }), 3);
});

test("every NAI_* code the server can throw has UI text", () => {
  // wp4 audit blocker #1: the adapter grew codes the registry never learned, so
  // real NovelAI failures collapsed into a generic card. Enumerate the throw
  // sites instead of hand-listing, so a new throw fails here rather than in prod.
  const sources = [
    "lib/naiImageAdapter.ts",
    "lib/naiSubscription.ts",
    "lib/naiZip.ts",
    "lib/generatePipeline.ts",
    "lib/nodeGeneration.ts",
    "lib/multimodePipeline.ts",
    "lib/providers/execution/admission.ts",
    "routes/edit.ts",
  ];
  const thrown = new Set<string>();
  for (const rel of sources) {
    for (const match of read(rel).matchAll(/"(NAI_[A-Z0-9_]+)"/g)) thrown.add(match[1]);
  }
  assert.ok(thrown.size >= 13, `expected the NAI throw sites to be discovered, found ${thrown.size}`);
  for (const code of thrown) {
    assert.ok(code in errorCodes, `${code} is thrown by the server but absent from errorCodes`);
  }
});

test("every registered NAI_* code resolves to real copy in all four locales", () => {
  // Registry membership alone still lets the dictionary leaves be deleted, which
  // renders the raw key. Follow each spec to the leaves it actually reads.
  const naiCodes = (Object.keys(errorCodes) as ImaErrorCode[]).filter((code) => code.startsWith("NAI_"));
  assert.ok(naiCodes.length >= 15, `expected the nai codes to be registered, found ${naiCodes.length}`);
  for (const locale of LOCALES) {
    const dict = dictionary(locale);
    for (const code of naiCodes) {
      const spec = errorCodes[code];
      const leaves = spec.surface === "card"
        ? [`${spec.cardKey}.title`, `${spec.cardKey}.body`]
        : [String(spec.toastKey)];
      if (spec.surface === "card" && (spec.cta === "reauth" || spec.cta === "reload")) {
        leaves.push(`${spec.cardKey}.cta`);
      }
      for (const leaf of leaves) {
        const value = leaf.split(".").reduce<unknown>((node, part) => {
          return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
        }, dict);
        assert.equal(typeof value, "string", `${locale} is missing ${leaf} for ${code}`);
        assert.notEqual(String(value).trim(), "", `${locale} has an empty ${leaf} for ${code}`);
      }
    }
  }
});

test("nai auth and billing failures keep NovelAI copy instead of the sign-in card", () => {
  // The server tags these with an errorClass, and the priority class card says
  // "sign in again from Settings" — wrong for a lane that uses a pasted token.
  const cases: Array<[ImaErrorCode, string]> = [
    ["NAI_API_KEY_MISSING", "AUTH_INVALID"],
    ["NAI_AUTH_FAILED", "AUTH_INVALID"],
    ["NAI_SUBSCRIPTION_REQUIRED", "BILLING_REQUIRED"],
    ["NAI_USAGE_EXHAUSTED", "BILLING_REQUIRED"],
  ];
  for (const [code, errorClass] of cases) {
    const resolved = resolveErrorSpec(Object.assign(new Error("nai failure"), { code, errorClass }));
    assert.equal(resolved.code, code, `${code} was reclassified`);
    assert.notEqual(resolved.spec.cardKey, "errorCard.authClass", `${code} fell back to the sign-in card`);
  }
  // A code with no NovelAI-specific copy must still defer to the class card.
  const generic = resolveErrorSpec(Object.assign(new Error("expired"), { code: "AUTH_CHATGPT_EXPIRED", errorClass: "AUTH_EXPIRED" }));
  assert.equal(generic.spec.cardKey, "errorCard.authClass");
});

// The TSX module is compiled by esbuild below; tsconfig.tests.json has no --jsx, so the
// props type is declared locally instead of importing the component type.
type NaiQuotaFixture = {
  provider: string; account?: { email: null; plan: string } | null;
  windows: { label: string; percent: number; resetsAt: string | null }[];
  nai?: { active: boolean; isNegative: boolean; anlasFixed: number; anlasPurchased: number; meter: "charge" | "missing" };
  authenticated?: boolean; error?: boolean;
};
type NaiQuotaProps = { loading: boolean; data: { nai?: NaiQuotaFixture } | null };
type NaiQuotaComponent = (props: NaiQuotaProps) => null;
const requireUi = createRequire(join(repoRoot, "ui/package.json"));
const react = requireUi("react") as typeof import("../ui/node_modules/@types/react/index");
const renderer = requireUi("react-dom/server") as { renderToStaticMarkup(element: unknown): string };
const quotaSource = transformSync(read("ui/src/components/settings/QuotaCard.tsx"), {
  loader: "tsx", format: "cjs", jsx: "automatic",
}).code;
const quotaNow = Date.parse("2026-09-08T00:00:00Z");

function renderNaiQuota(props: NaiQuotaProps, locale = "en"): string {
  const dict = dictionary(locale);
  const module = { exports: {} as { NaiQuota: NaiQuotaComponent } };
  const t = (key: string, vars: Record<string, string | number> = {}) =>
    String(lookup(dict, key)).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name]));
  runInNewContext(quotaSource, {
    module, exports: module.exports, Date: { now: () => quotaNow, parse: Date.parse },
    require(name: string) {
      if (name === "react" || name === "react/jsx-runtime") return requireUi(name);
      if (name === "../../i18n") return { useI18n: () => ({ t }) };
      if (name === "../../lib/api-core" || name === "../../lib/lanSession") return {};
      if (name === "../../hooks/useOAuthStatus") return { OAUTH_CHANGED_EVENT: "ima2:oauth-changed" };
      throw new Error(`Unexpected quota dependency: ${name}`);
    },
  }, { timeout: 2000 });
  return renderer.renderToStaticMarkup(react.createElement(module.exports.NaiQuota, props));
}

function quotaFixture(percent = 75, resetsAt: string | null = null): NaiQuotaProps {
  return { loading: false, data: { nai: {
    provider: "nai", account: { email: null, plan: "Tier 3" },
    windows: [{ label: "v5-battery", percent, resetsAt }],
    nai: { active: true, isNegative: false, anlasFixed: 4000, anlasPurchased: 50, meter: "charge" },
  } } };
}

test("NovelAI quota renders loading, invalid token, fetch failure and absent data separately", () => {
  const cases: Array<[NaiQuotaProps, string]> = [
    [{ ...quotaFixture(), loading: true }, "Loading"],
    [{ loading: false, data: { nai: { provider: "nai", authenticated: false, windows: [] } } }, "NovelAI token is not configured or is invalid."],
    [{ loading: false, data: { nai: { provider: "nai", error: true, windows: [] } } }, "Could not load quota"],
    [{ loading: false, data: null }, "Could not load quota"],
  ];
  for (const [props, text] of cases) {
    const html = renderNaiQuota(props);
    assert.ok(html.includes(text), html);
    assert.doesNotMatch(html, /role="meter"|Anlas:|<button/);
  }
});

test("NovelAI battery renders remaining charge colors and next-percent ETA, never reset time", () => {
  for (const [percent, color] of [[51, "blue"], [50, "amber"], [20, "amber"], [19, "red"], [0, "red"]] as const) {
    const html = renderNaiQuota(quotaFixture(percent, "2026-09-08T00:02:01Z"));
    assert.ok(html.includes(`background:var(--${color})`), html);
    assert.ok(html.includes(`aria-valuenow="${percent}"`), html);
    assert.ok(html.includes("+1% in 3 min"), html);
    assert.doesNotMatch(html, /2026-|9\/8/);
  }
  assert.doesNotMatch(renderNaiQuota(quotaFixture()), /quota-bar__reset/);
  assert.match(renderNaiQuota(quotaFixture(75, "2026-09-07T23:59:00Z")), /\+1% in 0 min/);
});

test("NovelAI missing meter preserves Anlas, and empty negative charge exposes fallback", () => {
  const missing = quotaFixture();
  missing.data!.nai!.nai!.meter = "missing";
  missing.data!.nai!.windows = [];
  const missingHtml = renderNaiQuota(missing);
  assert.match(missingHtml, /V5 battery meter unavailable/);
  assert.match(missingHtml, /Anlas: 4000 \+ 50/);
  assert.doesNotMatch(missingHtml, /role="meter"|<button/);
  const empty = quotaFixture(0);
  empty.data!.nai!.nai!.isNegative = true;
  const emptyHtml = renderNaiQuota(empty);
  assert.match(emptyHtml, /Tier 3/);
  assert.match(emptyHtml, /Recharging \(negative\)/);
  assert.match(emptyHtml, /generation can continue using Anlas/);
  empty.data!.nai!.nai!.anlasFixed = 0;
  empty.data!.nai!.nai!.anlasPurchased = 0;
  const exhaustedHtml = renderNaiQuota(empty);
  assert.match(exhaustedHtml, /Anlas: 0 \+ 0/);
  assert.doesNotMatch(exhaustedHtml, /generation can continue using Anlas/);
});
