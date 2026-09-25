import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("comfy UI model routing", () => {
  it("never falls back to the OpenAI option list for comfy", () => {
    // The default branch returns OPENAI_IMAGE_MODEL_OPTIONS, so without an
    // explicit arm a ComfyUI selection would show gpt-5.6-luna and send a
    // model the lane cannot execute.
    const source = read("ui/src/lib/imageModels.ts");
    const fn = source.slice(source.indexOf("export function getImageModelOptionsForProvider"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    const comfyAt = body.indexOf('provider === "comfy"');
    const fallbackAt = body.indexOf("return OAUTH_IMAGE_MODEL_OPTIONS");
    assert.ok(comfyAt > 0, "comfy must have its own branch");
    assert.ok(comfyAt < fallbackAt, "the comfy branch must precede the OpenAI fallback");
    assert.match(body.slice(comfyAt, fallbackAt), /return \[\]/, "comfy returns an empty static list");
  });

  // Actual first-visit/no-auto-selection and lane-return behavior is covered in
  // core-selection-actions.test.ts, including genuine store reinitialization.

  it("reads comfy models from the live lane catalog, not the generated list", () => {
    const source = read("ui/src/components/GenProviderModelSelect.tsx");
    assert.match(source, /useLaneCatalog/, "the selector consumes the shared lane catalog");
    assert.match(source, /value: "comfy", label: "ComfyUI"/, "comfy is offered as a provider");
    // An offline workflow stays listed but unselectable: removing it reads as
    // "my workflow disappeared", leaving it live starts a doomed generation.
    assert.match(source, /isComfyModelAvailable\(entry\)/);
  });

  it("shows catalog-only Comfy video workflows as disabled rows", () => {
    const source = read("ui/src/components/GenProviderModelSelect.tsx");
    assert.match(source, /comfyLane\.video/);
    assert.match(source, /COMFY_VIDEO_PREFIX/);
    assert.match(source, /disabled: true/);
    assert.match(source, /entry\.lockReason/);
    assert.match(source, /videoCatalogShort/);
    assert.match(source, /title: entry\.reason/);
    assert.match(source, /stacked: true/);
    assert.match(source, /disabled: true/);
    assert.match(source, /gen-provider-model__catalog-state/);
  });
});

describe("comfy workflow manager", () => {
  const source = read("ui/src/components/settings/ComfyWorkflowManager.tsx");

  it("detects the workflow file by magic bytes, like the CLI", () => {
    assert.match(source, /PNG_SIGNATURE/);
    assert.match(source, /0x89, 0x50, 0x4e, 0x47/);
  });

  it("blocks submit until every ambiguous binding is chosen", () => {
    // Preselecting a guess would let a user click through with positive and
    // negative swapped, which surfaces much later as "the model ignores my
    // prompt" with nothing pointing back at this dialog.
    assert.match(source, /if \(candidate\.unambiguous\) preset\[candidate\.field\]/);
    assert.match(source, /unresolved\.length === 0/);
    assert.match(source, /disabled=\{!canSubmit\}/);
  });

  it("probes the origin through the server rather than fetching a typed URL", () => {
    assert.match(source, /probeComfyOrigin/);
    assert.doesNotMatch(source, /fetch\(origin/, "the browser must not fetch a typed origin directly");
    // A malformed address and an unreachable one are different problems.
    assert.match(source, /originUnreachable/);
    assert.match(source, /originInvalid/);
  });

  it("does not encode status by colour alone", () => {
    assert.match(source, /t\("comfy\.statusReady"\)/);
    assert.match(source, /t\("comfy\.statusOffline"\)/);
    assert.match(source, /aria-describedby=\{statusId\}/);
  });

  it("carries media kind through inspect and create", () => {
    assert.match(source, /setMediaKind\(result\.mediaKind \?\? "image"\)/);
    assert.match(source, /mediaKind,/);
    assert.match(source, /comfy\.videoKindHint/);
  });
});

describe("comfy i18n", () => {
  it("carries the comfy section in all four dictionaries with matching keys", () => {
    const locales = ["en", "ko", "zh-Hans", "zh-Hant"];
    const sections = locales.map((locale) => JSON.parse(read(`ui/src/i18n/${locale}.json`)).comfy);
    for (const [index, section] of sections.entries()) {
      assert.ok(section, `${locales[index]} is missing the comfy section`);
    }
    const reference = JSON.stringify(Object.keys(sections[0]).sort());
    for (const [index, section] of sections.entries()) {
      assert.equal(JSON.stringify(Object.keys(section).sort()), reference, `${locales[index]} key set differs`);
    }
    // Empty state must name the next action, not just report emptiness.
    for (const [index, section] of sections.entries()) {
      assert.match(section.empty, /Export \(API\)/, `${locales[index]} empty state must tell the user what to do`);
    }
  });
});
