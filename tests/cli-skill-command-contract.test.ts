import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

function runSkillCli(args) {
  return spawnSync(process.execPath, ["bin/ima2.js", "skill", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runCli(args) {
  return spawnSync(process.execPath, ["bin/ima2.js", ...args], {
    encoding: "utf8",
  });
}

describe("CLI packaged skill contract", () => {
  it("ships a Markdown ima2 skill with agent usage guidance", () => {
    const skill = readSource("skills/ima2/SKILL.md");
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const configKeys = readSource("lib/configKeys.ts");

    assert.match(skill, /name:\s*ima2/);
    assert.match(skill, /ima2 capabilities --json/);
    assert.match(skill, /ima2 defaults --json/);
    assert.match(skill, /ima2 edit input\.png --prompt/);
    assert.match(skill, /--quality high/);
    assert.match(skill, /There is no `--parallel` flag/);
    assert.match(skill, /generic OpenAI image-generation/);
    assert.match(skill, /GPT Image 2/);
    assert.match(skill, /exact words in the target language/);
    assert.match(skill, /reduce garbled lettering/);
    assert.match(skill, /manga panel/);
    assert.match(skill, /webtoon style/);
    assert.match(skill, /photorealistic product photo/);
    assert.match(skill, /not a typesetting engine/);
    for (const label of [
      en.canvas.toolbar.exportAs.vector,
      en.canvas.toolbar.exportAs.svg,
      en.nai.positivePrompt.label,
      en.nai.negativePrompt.label,
    ]) assert.ok(skill.includes(label), `packaged skill missing runtime label: ${label}`);
    for (const key of ["promptBuilder.backend", "promptBuilder.model"]) {
      assert.ok(configKeys.includes(`"${key}"`), `runtime config key missing: ${key}`);
      assert.ok(skill.includes(key), `packaged skill missing runtime config key: ${key}`);
    }
  });

  it("documents Grok video continuity contracts and audio prompt controls", () => {
    const skill = readSource("skills/ima2/SKILL.md");

    // CONTRACT REVERSED (v3.8.x): these two lines used to require the skill to say
    // reference-to-video caps at 10s and that 1.5 cannot take reference images. Both
    // became false — the clamp was ours and was removed, and 1.5 does take references —
    // so the test was holding the documentation at the old behavior.
    assert.match(skill, /reference-to-video \| 15s/);
    assert.doesNotMatch(skill, /does not support `reference_images` Ref2V/);
    assert.match(skill, /Preset Voices \(1\.5 only\)/);
    assert.match(skill, /white-canvas image-to-video anchor/);
    assert.match(skill, /requestedModel/);
    assert.match(skill, /effectiveModel/);
    assert.match(skill, /modelFallback/);
    assert.match(skill, /video\.effectiveModel/);
    assert.match(skill, /jq -r '\.path'/);
    assert.match(skill, /jq -r '\.filename'/);
    assert.doesNotMatch(skill, /jq -r '\.url'/);
    assert.match(skill, /Structured Video Prompt Template/);
    assert.match(skill, /duration pacing/);
    assert.match(skill, /beat structure scales with length/);
    assert.match(skill, /Motivated movement/);
    assert.match(skill, /Dialogue/);
    assert.match(skill, /Settling final frame/);
    assert.match(skill, /no background music/);
    assert.match(skill, /specific SFX/);
    assert.match(skill, /self-explanatory for continuation/);
    assert.match(skill, /Video edit\/extend: grok-imagine-video only/);
  });

  it("documents the complete NovelAI lane without overstating ima2 surfaces", () => {
    const skill = readSource("skills/ima2/SKILL.md");
    for (const model of [
      "nai-diffusion-5-full",
      "nai-diffusion-5-curated",
      "nai-diffusion-4-5-full",
      "nai-diffusion-4-5-curated",
    ]) assert.match(skill, new RegExp(model));
    assert.match(skill, /models --kind image --lane nai --json/);
    assert.match(skill, /defaults set image nai\/nai-diffusion-5-full/);
    assert.match(skill, /--nai-negative-prompt/);
    assert.match(skill, /--nai-auto-smea/);
    assert.match(skill, /--nai-decrisper/);
    assert.match(skill, /--nai-straight-alpha/);
    assert.match(skill, /English and Japanese/i);
    assert.match(skill, /natural language\s+and tags/i);
    assert.match(skill, /no base|no source image/i);
    assert.match(skill, /28 steps/);
    assert.match(skill, /usage limit/i);
    assert.match(skill, /text-to-image only/i);
    assert.match(skill, /Character Positioning/);
    assert.match(skill, /Vibe Transfer/);
  });

  it("skill command wraps Markdown content instead of inventing a schema skill", () => {
    const src = readSource("bin/commands/skill.ts");

    assert.match(src, /KNOWN_SKILLS/);
    assert.match(src, /dir:\s*"ima2"/);
    assert.match(src, /dir:\s*"ima2-front"/);
    assert.match(src, /dir:\s*"ima2-uiux"/);
    assert.match(src, /join\(SKILLS_DIR, entry\.dir, "SKILL\.md"\)/);
    assert.match(src, /positional\[0\] === "ls" \|\| positional\[0\] === "list"/);
    assert.match(src, /format:\s*"markdown-skill"/);
    assert.match(src, /formatVersion:\s*"1"/);
    assert.match(src, /packageVersion: readPackageVersion\(\)/);
    assert.match(src, /content,/);
    assert.match(src, /packaged skill not found/);
  });

  it("ships frontend and uiux skill documents with frontmatter names", () => {
    const front = readSource("skills/ima2-front/SKILL.md");
    const uiux = readSource("skills/ima2-uiux/SKILL.md");

    assert.match(front, /name:\s*ima2-front/);
    assert.match(uiux, /name:\s*ima2-uiux/);
  });

  it("top-level CLI dispatch lets skill help reach the subcommand", () => {
    const src = readSource("bin/ima2.ts");

    assert.match(src, /Agent skills/);
    assert.match(src, /"skill"/);
    assert.match(src, /case "skill":/);
  });

  it("top-level help exposes frontend, uiux, and install commands directly", () => {
    const res = runCli(["--help"]);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ima2 skill front\s+Print frontend implementation skill/);
    assert.match(res.stdout, /ima2 skill uiux\s+Print design direction skill/);
    assert.match(res.stdout, /ima2 skill install --dir <path>\s+Install all skills/);
    assert.match(res.stdout, /ima2 skill install --tmp\s+Install to temp dir/);
  });
});

describe("CLI packaged skill behavior (executes built CLI)", () => {
  it("skill ls lists all packaged skills as installed", () => {
    const res = runSkillCli(["ls"]);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /✓\s+ima2\s/);
    assert.match(res.stdout, /✓\s+front\s/);
    assert.match(res.stdout, /✓\s+uiux\s/);
  });

  it("skill <name> path resolves each packaged skill file", () => {
    for (const [name, dir] of [
      ["front", "ima2-front"],
      ["uiux", "ima2-uiux"],
    ]) {
      const res = runSkillCli([name, "path"]);
      assert.equal(res.status, 0, res.stderr);
      const printed = res.stdout.trim().replaceAll("\\", "/");
      assert.ok(
        printed.endsWith(`skills/${dir}/SKILL.md`),
        `expected ${name} path to end with skills/${dir}/SKILL.md, got: ${printed}`,
      );
    }
  });

  it("skill --json wraps the core skill; skill front --json wraps the frontend skill", () => {
    const core = runSkillCli(["--json"]);
    assert.equal(core.status, 0, core.stderr);
    const corePayload = JSON.parse(core.stdout);
    assert.equal(corePayload.name, "ima2");
    assert.equal(corePayload.format, "markdown-skill");
    assert.equal(corePayload.formatVersion, "1");
    assert.match(corePayload.content, /name:\s*ima2/);

    const front = runSkillCli(["front", "--json"]);
    assert.equal(front.status, 0, front.stderr);
    const frontPayload = JSON.parse(front.stdout);
    assert.equal(frontPayload.name, "ima2-front");
    assert.match(frontPayload.path.replaceAll("\\", "/"), /skills\/ima2-front\/SKILL\.md$/);
  });

  it("documents current fallback: unknown skill names print the core skill", () => {
    // Current contract: an unregistered positional falls back to the core skill
    // instead of erroring. Pinned here so a behavior change is a conscious one.
    const res = runSkillCli(["nope"]);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /name:\s*ima2\b/);
  });
});
