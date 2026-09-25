import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI feature parity contract", () => {
  it("gen, multimode, and node share the NovelAI option contract", () => {
    const helper = readSource("bin/lib/nai-options.ts");
    for (const flag of ["nai-negative-prompt", "nai-auto-smea", "nai-decrisper", "nai-straight-alpha"]) {
      assert.match(helper, new RegExp(`"${flag}"`));
    }
    for (const command of ["gen", "multimode", "node"]) {
      const src = readSource(`bin/commands/${command}.ts`);
      assert.match(src, /\.\.\.NAI_CLI_FLAGS/);
      assert.match(src, /parseNaiCliOptions/);
      assert.match(src, /NAI_CLI_HELP/);
    }
  });

  it("public CLI docs describe NovelAI native flags and target rules", () => {
    const docs = readSource("docs/CLI.md");
    for (const flag of [
      "--nai-negative-prompt", "--nai-sampler", "--nai-noise-schedule",
      "--nai-steps", "--nai-scale", "--nai-cfg-rescale", "--nai-seed",
      "--nai-uc-preset", "--nai-quality-preset", "--nai-auto-smea",
      "--nai-decrisper", "--nai-variety-plus", "--nai-straight-alpha",
    ]) {
      assert.match(docs, new RegExp(flag));
    }
    assert.match(docs, /gen[\s\S]+persisted NovelAI default/i);
    assert.match(docs, /multimode[\s\S]+explicit NovelAI target/i);
    assert.match(docs, /node generate[\s\S]+explicit NovelAI target/i);
    assert.match(docs, /NAI_V5_MODEL_REQUIRED/);
    assert.match(docs, /defaults set image nai\/nai-diffusion-5-full/);
    assert.match(docs, /text-to-image only/i);
  });

  it("gen exposes provider and preserves web-search request mapping", () => {
    const src = readSource("bin/commands/gen.ts");

    assert.match(src, /provider:\s*\{\s*type:\s*"string"\s*\}/);
    // 010 CLI strict routing: gen.ts validates providers/models through the
    // resolver + GET /api/models catalog instead of a local enum, and lanes
    // now include the MCP providers. `--provider auto` is removed (v3).
    assert.match(src, /resolveTarget\(\s*"image"/);
    assert.match(src, /const PROVIDER_VALUES = \[/);
    assert.match(src, /\.\.\.deriveProviderIds\(\)/);
    assert.match(src, /\.\.\.listProviders\(\[\]\)/);
    assert.match(src, /--provider <\$\{PROVIDER_VALUES\.join\("\|"\)\}>/);
    assert.match(src, /'auto' was removed/);
    assert.match(src, /body\.webSearchEnabled = false/);
    assert.match(src, /body\.webSearchEnabled = true/);
  });

  it("edit exposes provider, preserves web-search mapping, and does not expose mask", () => {
    const src = readSource("bin/commands/edit.ts");
    const docs = readSource("docs/CLI.md");

    assert.match(src, /provider:\s*\{\s*type:\s*"string"\s*\}/);
    assert.match(src, /const PROVIDER_VALUES = \["auto", \.\.\.deriveProviderIds\(\)\]/);
    assert.match(src, /VALID_PROVIDERS = new Set\(PROVIDER_VALUES\)/);
    assert.match(src, /--provider <\$\{PROVIDER_VALUES\.join\("\|"\)\}>/);
    assert.match(src, /deriveCliImageModelSet\(\)/);
    assert.match(src, /--provider must be one of: \$\{PROVIDER_VALUES\.join\(", "\)\}/);
    assert.match(src, /if \(args\.provider\) editBody\.provider = args\.provider/);
    assert.match(src, /editBody\.webSearchEnabled = false/);
    assert.match(src, /editBody\.webSearchEnabled = true/);
    assert.doesNotMatch(src, /mask:\s*\{\s*type:/);
    assert.doesNotMatch(src, /args\.mask/);
    assert.match(docs, /edit --mask[\s\S]+deferred to #31/i);
  });

  it("multimode exposes provider, mode, repeatable refs, and forwards references", () => {
    const src = readSource("bin/commands/multimode.ts");

    assert.match(src, /fileToDataUri/);
    assert.match(src, /provider:\s*\{\s*type:\s*"string"\s*\}/);
    assert.match(src, /--provider <\$\{PROVIDER_VALUES\.join\("\|"\)\}>/);
    // The model list is derived from the registry now, the way edit.ts does it,
    // so pinning literal ids here would just re-freeze what we unfroze. Pin the
    // derivation instead.
    assert.match(src, /deriveCliImageModelSet\(\)/);
    assert.match(src, /KNOWN_IMAGE_MODELS/);
    assert.match(src, /mode:\s*\{\s*type:\s*"string",\s*default:\s*"auto"\s*\}/);
    assert.match(src, /ref:\s*\{\s*type:\s*"string",\s*repeatable:\s*true\s*\}/);
    assert.match(src, /VALID_PROVIDERS = new Set\(PROVIDER_VALUES\)/);
    assert.match(src, /VALID_MODES = new Set\(\["auto", "direct"\]\)/);
    assert.match(src, /MAX_REFERENCE_COUNT/);
    assert.match(src, /refs\.length > MAX_REFERENCE_COUNT/);
    assert.match(src, /refs\.map\(\(p: string\) => fileToDataUri\(p\)\)/);
    assert.match(src, /mode: args\.mode/);
    assert.match(src, /references,/);
    assert.match(src, /if \(args\.provider\) body\.provider = args\.provider/);
    assert.match(src, /body\.webSearchEnabled = false/);
    assert.match(src, /body\.webSearchEnabled = true/);
  });

  it("node generate exposes provider and preserves web-search request mapping", () => {
    const src = readSource("bin/commands/node.ts");

    assert.match(src, /provider:\s*\{\s*type:\s*"string"\s*\}/);
    assert.match(src, /VALID_PROVIDERS = new Set\(PROVIDER_VALUES\)/);
    assert.match(src, /--provider must be one of: \$\{PROVIDER_VALUES\.join\(", "\)\}/);
    assert.match(src, /if \(args\.provider\) body\.provider = args\.provider/);
    assert.match(src, /body\.webSearchEnabled = false/);
    assert.match(src, /body\.webSearchEnabled = true/);
  });

  it("inflight CLI help names multimode jobs", () => {
    const ps = readSource("bin/commands/ps.ts");
    const observability = readSource("bin/commands/observability.ts");

    assert.match(ps, /classic\|node\|multimode/);
    assert.match(observability, /classic\|node\|multimode/);
  });

  it("ls favorites uses server-side favorites filtering with defensive client filtering", () => {
    const src = readSource("bin/commands/ls.ts");

    assert.match(src, /qs\.set\("favoritesOnly", "1"\)/);
    assert.match(src, /qs\.set\("limit", String\(limit\)\)/);
    assert.match(src, /it\.isFavorite === true/);
    assert.doesNotMatch(src, /Math\.max\(limit, args\.favorites \? 200 : limit\)/);
  });

  it("public CLI docs describe provider semantics and multimode parity", () => {
    const docs = readSource("docs/CLI.md");

    assert.match(docs, /--provider <auto\|oauth\|api\|grok\|grok-api\|agy\|gemini-api\|atlascloud\|minimax\|nai>/);
    assert.match(docs, /api` forces the API-key Responses path/);
    assert.match(docs, /oauth` forces the local OAuth proxy path/);
    assert.match(docs, /auto` preserves route default behavior/);
    assert.match(docs, /multimode[\s\S]+--ref <file>/i);
    assert.match(docs, /multimode[\s\S]+--mode <auto\|direct>/i);
    assert.match(docs, /classic\\\|node\\\|multimode/);
    assert.match(docs, /server-side favorites filtering/);
  });

  it("public docs describe sanitized EMPTY_RESPONSE support bundle", () => {
    const cliDocs = readSource("docs/CLI.md");
    const faq = readSource("docs/FAQ.md");
    const faqKo = readSource("docs/FAQ.ko.md");
    const readme = readSource("README.md");

    for (const docs of [cliDocs, faq, faqKo, readme]) {
      assert.match(docs, /ima2 doctor image-probe --json/);
      // 3.0.0 fail-closed contract: diagnostic examples pass an explicit lane model.
      assert.match(docs, /ima2 gen "고양이" --model oauth\/gpt-6-luna --no-web-search --json/);
      assert.match(docs, /OAuth token|OAuth token 파일|OAuth token files/);
      assert.match(docs, /API key|API keys|API 키/);
      assert.match(docs, /base64/);
    }
  });
});
