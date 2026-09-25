import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// WP-C: user-facing text must come from the translation dictionaries. A hardcoded
// English string leaves Korean users staring at an English panel — which is exactly what
// ElementDetail/ElementRefGrid did before this cycle.

const ko = JSON.parse(readFileSync("ui/src/i18n/ko.json", "utf8"));
const en = JSON.parse(readFileSync("ui/src/i18n/en.json", "utf8"));
const zhHant = JSON.parse(readFileSync("ui/src/i18n/zh-Hant.json", "utf8"));
const zhHans = JSON.parse(readFileSync("ui/src/i18n/zh-Hans.json", "utf8"));

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return componentFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Attributes that reach the user directly: screen readers, tooltips, empty fields. */
const USER_FACING_ATTRS = /\b(?:aria-label|ariaLabel|placeholder|title)="([A-Z][^"]{2,})"/g;
const TEMPLATE_ARIA = /\baria-label=\{`([A-Z][^`]*)`\}/g;
const JSX_TEXT = /<[a-z][^>]*>\s*([A-Z][A-Za-z ]{2,})\s*<\//g;

/**
 * Not every capitalized attribute is prose. File paths, filenames and code samples read
 * the same in every locale, so translating them would make the hint wrong.
 */
function isTranslatable(value: string): boolean {
  if (/\.(md|json|png|jpe?g|webp|mp4|ts|tsx|js|mjs)\b/i.test(value)) return false;
  if (/^[\w./-]+$/.test(value)) return false;
  return true;
}

/**
 * Modules that Node-side contract tests import directly must stay free of the i18n hook.
 *
 * `ui/src/i18n` reaches `devMode.ts`, which reads Vite's `import.meta.env` — undefined
 * under plain Node, so importing it here crashes the whole test file. These three sit in
 * the import chain of tests/element-mention-ui-contract.test.ts. Their few English
 * strings are ARIA names on decorative chips; localizing them needs the strings lifted
 * out of the pure module first, which is a separate change.
 */
const PURE_MODULES = [
  "ui/src/components/controls/Chip.tsx",
  "ui/src/components/ElementMentionChip.tsx",
  "ui/src/components/ElementMentionMenu.tsx",
];

test("all locale dictionaries stay structurally identical", () => {
  const flatten = (obj: unknown, prefix = ""): string[] =>
    Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? flatten(value, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    );
  const enKeys = flatten(en).sort();
  for (const [locale, dictionary] of [["ko", ko], ["zh-Hant", zhHant], ["zh-Hans", zhHans]] as const) {
    const keys = flatten(dictionary).sort();
    assert.deepEqual(keys.filter((k) => !enKeys.includes(k)), [], `keys present in ${locale} but missing in en`);
    assert.deepEqual(enKeys.filter((k) => !keys.includes(k)), [], `keys present in en but missing in ${locale}`);
  }
});

test("element panels are translated rather than hardcoded English", () => {
  // These two were fully English regardless of locale.
  for (const path of [
    "ui/src/components/assets/ElementDetail.tsx",
    "ui/src/components/assets/ElementRefGrid.tsx",
  ]) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /useI18n/, `${path} must use the translation hook`);
    assert.doesNotMatch(src, /aria-label="[A-Z]/, `${path} still has a hardcoded aria-label`);
    assert.doesNotMatch(src, /placeholder="[A-Z]/, `${path} still has a hardcoded placeholder`);
  }
  for (const [locale, dictionary] of [["en", en], ["ko", ko], ["zh-Hant", zhHant], ["zh-Hans", zhHans]] as const) {
    assert.ok(dictionary.element?.notesHelp, `${locale}.element must exist`);
  }
});

test("no component hardcodes a user-facing English attribute", () => {
  const offenders: string[] = [];
  for (const file of componentFiles("ui/src/components")) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(USER_FACING_ATTRS)) {
      if (!isTranslatable(match[1])) continue;
      offenders.push(`${file.split(sep).join("/")}: ${match[0]}`);
    }
    for (const match of src.matchAll(TEMPLATE_ARIA)) {
      offenders.push(`${file.split(sep).join("/")}: ${match[0]}`);
    }
    for (const match of src.matchAll(JSX_TEXT)) {
      if (["Runway", "Higgsfield", "ESC", "MCP"].includes(match[1].trim())) continue;
      offenders.push(`${file.split(sep).join("/")}: >${match[1].trim()}<`);
    }
  }
  assert.deepEqual(offenders, [], `hardcoded user-facing strings:\n${offenders.join("\n")}`);
});

test("the pure-module exemption stays honest", () => {
  // If one of these ever gains the hook, the exemption is stale and should be removed
  // rather than silently hiding a growing set of English strings.
  for (const path of PURE_MODULES) {
    const src = readFileSync(path, "utf8");
    assert.doesNotMatch(
      src,
      /from "\.\.?\/(\.\.\/)?i18n"/,
      `${path} now imports i18n — drop it from PURE_MODULES`,
    );
  }
});

test("pure mention and chip modules receive user-facing labels through props", () => {
  const menu = readFileSync("ui/src/components/ElementMentionMenu.tsx", "utf8");
  assert.match(menu, /ariaLabel: string/);
  assert.match(menu, /emptyLabel: string/);
  assert.match(menu, /kindLabel\(kind: ElementMentionKind\): string/);
  assert.doesNotMatch(menu, /Element suggestions|No matching elements/);

  const mention = readFileSync("ui/src/components/ElementMentionChip.tsx", "utf8");
  assert.match(mention, /ariaLabel: string/);
  assert.match(mention, /unavailableLabel: string/);
  assert.match(mention, /removeLabel: string/);
  assert.doesNotMatch(mention, /Character|Product|Reference|Remove /);

  const chip = readFileSync("ui/src/components/controls/Chip.tsx", "utf8");
  assert.match(chip, /removeLabel\?: string/);
  assert.match(chip, /aria-label=\{removeLabel\}/);
  assert.doesNotMatch(chip, /aria-label="Remove"/);
});

test("Korean labels are actually Korean, not passthrough English", () => {
  // A key that exists in both files but carries identical ASCII text usually means the
  // Korean side was never translated.
  const suspicious: string[] = [];
  const walk = (koNode: unknown, enNode: unknown, prefix = "") => {
    if (!koNode || typeof koNode !== "object") return;
    for (const [key, koValue] of Object.entries(koNode as Record<string, unknown>)) {
      const enValue = (enNode as Record<string, unknown> | undefined)?.[key];
      if (koValue && typeof koValue === "object") {
        walk(koValue, enValue, `${prefix}${key}.`);
      } else if (
        typeof koValue === "string"
        && koValue === enValue
        && /[A-Za-z]{4,}/.test(koValue)
        // Product names, model ids and units are legitimately identical.
        && !/^[\d.,\s]*$/.test(koValue)
        && !/(GPT|Grok|Gemini|OAuth|API|MCP|PNG|JPEG|WebP|SVG|PPTX|ComfyUI|Runway|Higgsfield|ima2|npm)/i.test(koValue)
      ) {
        suspicious.push(`${prefix}${key} = "${koValue}"`);
      }
    }
  };
  walk(ko.element, en.element, "element.");
  assert.deepEqual(suspicious, [], `untranslated Korean values:\n${suspicious.join("\n")}`);
});
