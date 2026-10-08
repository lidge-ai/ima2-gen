import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";
import test from "node:test";
import { GENERATION_ERROR_CLASSES } from "../lib/errors/classes.ts";
import {
  DYNAMIC_PROVIDER_CODE_SITES,
  PROVIDER_ERROR_MAP,
} from "../lib/errors/providerMap.ts";

// Scan the whole server surface, not a hand-listed set of adapters: provider
// codes are also emitted from routes and pipelines (routes/edit.ts mask
// rejections, generatePipeline/nodeGeneration reference caps, video routes).
// A curated file list let ten emitted codes stay unmapped while green.
function serverSourceFiles(): string[] {
  const roots = ["lib", "routes"];
  const files: string[] = [];
  // The map itself must not count as an emitter: including it makes every key
  // "found" and turns the dead-mapping check into a tautology.
  const excluded = new Set(["lib/errors/providerMap.ts", "lib/errors/classes.ts"]);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !excluded.has(path)) files.push(path);
    }
  };
  for (const root of roots) walk(root);
  return files.sort();
}

const ADAPTER_FILES = serverSourceFiles();

const PROVIDER_CODE_PATTERN = /\b(?:MINIMAX|GEMINI_API|GROK|AGY|ATLASCLOUD|API88|NAI)_[A-Z0-9_]+\b/g;
const LEXICAL_EXCEPTIONS = new Set([
  "API88_VIDEO_SPECS",
  "API88_DEFAULT_VIDEO_MODEL",
  "AGY_OUTPUT_RESOLUTION",
  "AGY_PROCESS_POLICY",
  "AGY_ARTIFACT_POLICY",
  "ATLASCLOUD_API_KEY",
  "ATLASCLOUD_EDIT_MODEL",
  "ATLASCLOUD_FALLBACK_IMAGE_MODEL",
  "ATLASCLOUD_TEXT_TO_IMAGE_MODEL",
  "GEMINI_API_FALLBACK_IMAGE_MODEL",
  "GEMINI_API_KEY",
  "GROK_BILLING_URL",
  "GROK_CLIENT_ID",
  "GROK_CREDITS_URL",
  "GROK_FALLBACK_IMAGE_MODEL",
  "GROK_FALLBACK_VIDEO_MODEL",
  "GROK_PLANNER",
  "GROK_PLANNER_MODELS",
  "GROK_QUALITY_IMAGE_MODEL",
  "GROK_SCOPE",
  "GROK_SEARCH",
  "GROK_TOKEN_URL",
  "GROK_USER_URL",
  "GROK_VIDEO_MODEL_15",
  "GROK_VIDEO_MODEL_15_DATED_ALIAS",
  "GROK_VIDEO_MODEL_15_PREVIEW_ALIAS",
  "GROK_VIDEO_MODEL_BASE",
  "MINIMAX_API_KEY",
  // NovelAI constants, not error codes: config/model/enum names that share the
  // NAI_ prefix (lib/naiImageAdapter.ts, lib/naiZip.ts).
  "NAI_DEFAULT_IMAGE_MODEL",
  "NAI_FALLBACK_IMAGE_MODEL",
  "NAI_NOISE_SCHEDULES",
  "NAI_QUALITY_PRESET_IDS",
  "NAI_SAMPLERS",
  "NAI_TIMEOUT_MS",
  "NAI_UC_PRESET_IDS",
  "NAI_ZIP_",
  "MINIMAX_FALLBACK_IMAGE_MODEL",
  "MINIMAX_IMAGE_TO_IMAGE_MODEL",
  "MINIMAX_TEXT_TO_IMAGE_MODEL",
  "MINIMAX_TIMEOUT_MS",
]);
const DYNAMIC_CONSTRUCTION_PATTERN = /\$\{([A-Za-z_$][\w$]*)\}_([A-Z][A-Z0-9_]*)/g;

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function lexicalProviderCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of ADAPTER_FILES) {
    for (const code of source(file).match(PROVIDER_CODE_PATTERN) ?? []) codes.add(code);
  }
  return codes;
}

function dynamicSitesFromSource(): string[] {
  const sites: string[] = [];
  for (const file of ADAPTER_FILES) {
    for (const match of source(file).matchAll(DYNAMIC_CONSTRUCTION_PATTERN)) {
      sites.push(`${posix.normalize(file.split(sep).join("/"))}:${match[1]}:${match[2]}`);
    }
  }
  return sites.sort();
}

function declaredPrefixDomain(file: string, variable: string): string[] {
  const declaration = source(file).match(new RegExp(`const\\s+${variable}\\s*=([^;]+);`));
  assert.ok(declaration, `missing dynamic prefix declaration ${file}:${variable}`);
  return [...new Set(declaration[1].match(PROVIDER_CODE_PATTERN) ?? [])].sort();
}

test("every provider map key has one of the common error classes", () => {
  const classes = new Set<string>(GENERATION_ERROR_CLASSES);
  for (const [code, errorClass] of Object.entries(PROVIDER_ERROR_MAP)) {
    assert.ok(classes.has(errorClass), `${code} has invalid class ${errorClass}`);
  }
  assert.ok(Object.keys(PROVIDER_ERROR_MAP).length > 0);
});

test("lexically emitted provider codes are mapped or explicitly excepted", () => {
  const unmapped = [...lexicalProviderCodes()]
    .filter((code) => !(code in PROVIDER_ERROR_MAP) && !LEXICAL_EXCEPTIONS.has(code))
    .sort();
  assert.deepEqual(unmapped, []);
});

test("no mapped code is dead: every key is emitted somewhere", () => {
  // The reverse direction. Without it the map can accumulate invented codes
  // that no adapter ever throws, which makes the coverage number meaningless.
  const emitted = lexicalProviderCodes();
  const dynamic = new Set<string>(DYNAMIC_PROVIDER_CODE_SITES.flatMap((site) => [...site.expandedCodes]));
  const dead = Object.keys(PROVIDER_ERROR_MAP)
    .filter((code) => !emitted.has(code) && !dynamic.has(code))
    .sort();
  assert.deepEqual(dead, []);
});

test("dynamic provider-code sites and expanded outputs stay pinned", () => {
  const expectedSites = DYNAMIC_PROVIDER_CODE_SITES
    .map((site) => `${site.file}:${site.prefixVariable}:${site.suffix}`)
    .sort();
  assert.deepEqual(dynamicSitesFromSource(), expectedSites);

  for (const site of DYNAMIC_PROVIDER_CODE_SITES) {
    assert.deepEqual(declaredPrefixDomain(site.file, site.prefixVariable), [...site.prefixDomain].sort());
    const expanded = site.prefixDomain.map((prefix) => `${prefix}_${site.suffix}`).sort();
    assert.deepEqual(expanded, [...site.expandedCodes].sort());
    for (const code of expanded) assert.ok(code in PROVIDER_ERROR_MAP, `dynamic code is unmapped: ${code}`);
  }
});
