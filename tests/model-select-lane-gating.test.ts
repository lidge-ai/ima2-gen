import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_IMAGE_MODEL,
  resolveCoreModelValue,
  COMFY_VIDEO_VALUE_PREFIX,
  VIDEO_VALUE_PREFIX,
} from "../ui/src/lib/imageModels.ts";
import { reconcileCoreSelection, selectCoreProvider } from "../ui/src/lib/coreSelection.ts";

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const base = {
  imageModel: DEFAULT_IMAGE_MODEL,
  videoModel: false as string | false,
  comfyVideoWorkflow: null as string | null,
};

// The model Select finds its trigger label by matching the selected value
// against the option rows it rendered. A value no row carries produces an EMPTY
// label, so the control names its lane ("GPT") and then names no model at all —
// the reported bug. These are value assertions rather than source regexes
// because a source match would still pass if the returned value were wrong.
describe("model select value: lane gating", () => {
  it("ignores a comfy video workflow stranded outside the comfy lane", () => {
    // Reported state: the user is on GPT with luna selected, but a comfy video
    // workflow chosen earlier is still in the store, and used to win outright.
    for (const provider of ["oauth", "api", "grok", "gemini-api", "nai"] as const) {
      assert.equal(
        resolveCoreModelValue({ ...base, provider, comfyVideoWorkflow: "wf-anim-1" }),
        DEFAULT_IMAGE_MODEL,
        `${provider} must not display a comfy workflow`,
      );
    }
  });

  it("ignores a stale grok video model outside the grok lanes", () => {
    // Same failure shape, different carrier: video rows are only rendered for
    // the grok lanes, so a leftover video selection is equally unmatched.
    for (const provider of ["oauth", "api", "gemini-api", "comfy"] as const) {
      assert.equal(
        resolveCoreModelValue({ ...base, provider, videoModel: "grok-imagine-video-1.5" }),
        provider === "comfy" ? "" : DEFAULT_IMAGE_MODEL,
        `${provider} must not display a grok video model`,
      );
    }
  });

  it("still shows each lane its own selection", () => {
    assert.equal(
      resolveCoreModelValue({ ...base, provider: "comfy", comfyVideoWorkflow: "wf-anim-1" }),
      `${COMFY_VIDEO_VALUE_PREFIX}wf-anim-1`,
    );
    assert.equal(
      resolveCoreModelValue({ ...base, provider: "grok", videoModel: "grok-imagine-video-1.5" }),
      `${VIDEO_VALUE_PREFIX}grok-imagine-video-1.5`,
    );
    assert.equal(
      resolveCoreModelValue({ ...base, provider: "grok-api", videoModel: "grok-imagine-video" }),
      `${VIDEO_VALUE_PREFIX}grok-imagine-video`,
    );
  });

  it("leaves unselected Comfy empty and keeps static lane image fallbacks", () => {
    assert.equal(resolveCoreModelValue({ ...base, provider: "comfy" }), "");
    assert.equal(resolveCoreModelValue({ ...base, provider: "grok" }), DEFAULT_IMAGE_MODEL);
    assert.equal(resolveCoreModelValue({ ...base, provider: "oauth" }), DEFAULT_IMAGE_MODEL);
  });

  it("shows a Comfy image workflow without treating the static model as a workflow", () => {
    assert.equal(resolveCoreModelValue({
      ...base, provider: "comfy", comfyWorkflow: "wf-image-missing",
    }), "wf-image-missing");
    assert.equal(resolveCoreModelValue({
      ...base, provider: "comfy", comfyWorkflow: "wf-image", comfyVideoWorkflow: "wf-video",
    }), "comfy-video:wf-video");
    for (const comfyWorkflow of [null, undefined]) {
      assert.equal(resolveCoreModelValue({ ...base, provider: "comfy", comfyWorkflow }), "");
    }
    assert.equal(resolveCoreModelValue({
      ...base, provider: "oauth", comfyWorkflow: "wf-image-missing",
    }), DEFAULT_IMAGE_MODEL);
  });

  it("accepts the undefined slices the persisted-defaults type allows", () => {
    assert.equal(
      resolveCoreModelValue({
        provider: "oauth",
        imageModel: DEFAULT_IMAGE_MODEL,
        videoModel: undefined,
        comfyVideoWorkflow: undefined,
      }),
      DEFAULT_IMAGE_MODEL,
    );
  });

  it("computes the displayed value through the shared resolver", () => {
    // Guards the wiring the value tests above cannot see: the component must
    // call the resolver instead of recomputing the precedence inline.
    const component = readSource("ui/src/components/GenProviderModelSelect.tsx");
    assert.match(component, /const coreModelValue = resolveCoreModelValue\(\{/);
    assert.doesNotMatch(component, /const coreModelValue = comfyVideoWorkflow/);
    // One source for the encodings, so an option row cannot drift off the value.
    assert.match(component, /const VIDEO_PREFIX = VIDEO_VALUE_PREFIX;/);
    assert.match(component, /const COMFY_VIDEO_PREFIX = COMFY_VIDEO_VALUE_PREFIX;/);
  });

  it("keeps a selection this lane no longer lists visible instead of blank", () => {
    // Lane gating cannot save a value that belongs to the CURRENT lane but has
    // disappeared from it: a deleted comfy workflow is still a legal
    // comfyVideoWorkflow and is persisted with no membership check, so the
    // trigger would go blank exactly like the original report. The component
    // adds a row for an unlisted value, the way the MCP branch already does.
    const component = readSource("ui/src/components/GenProviderModelSelect.tsx");
    assert.match(component, /const listedValues = new Set\(modelGroups\.flatMap\(/);
    assert.match(component, /if \(coreModelValue && !listedValues\.has\(coreModelValue\)\) \{/);
    assert.match(component, /modelGroups\.unshift\(\{/);
  });
});

describe("comfy lane exit: stranded selection cleanup", () => {
  it("clears comfy-only selections when leaving the comfy lane", () => {
    const current = reconcileCoreSelection({
      provider: "comfy", imageModel: "gpt-5.6-sol",
      comfyWorkflow: "wf-image", comfyVideoWorkflow: "wf-video",
    });
    assert.deepEqual(selectCoreProvider(current, "oauth"), {
      provider: "oauth", imageModel: "gpt-6-sol", videoModelSelected: false,
      comfyWorkflow: null, comfyVideoWorkflow: null,
    });
    assert.equal(current.comfyWorkflow, "wf-image");
    assert.equal(current.comfyVideoWorkflow, "wf-video");
  });

  it("converges a workflow id left in imageModel by union membership", () => {
    const current = reconcileCoreSelection({ provider: "comfy", imageModel: "wf-legacy" });
    assert.equal(current.comfyWorkflow, "wf-legacy");
    assert.deepEqual(selectCoreProvider(current, "oauth"), {
      provider: "oauth", imageModel: "gpt-6-luna", videoModelSelected: false,
      comfyWorkflow: null, comfyVideoWorkflow: null,
    });
  });

  it("keeps the 260823 contract: re-selecting comfy preserves the workflow", () => {
    const current = reconcileCoreSelection({
      provider: "comfy", comfyWorkflow: "wf-image", comfyVideoWorkflow: "wf-video",
    });
    assert.strictEqual(selectCoreProvider(current, "comfy"), current);
    const outside = selectCoreProvider(current, "oauth");
    assert.deepEqual(selectCoreProvider(outside, "comfy", {
      kind: "video", image: "wf-image", video: "wf-video",
    }), current);
  });
});
