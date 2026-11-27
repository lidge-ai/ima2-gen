import type { LocalStep, MediaStep, ModelSlot, ResolvedSlot, WorkflowDefinition, WorkflowValues } from "../types.js";
import { checkRemixFit, finishRemix, REMIX_FIELDS_TAIL, renderSlot, renderStep, sourceOf, sourceVideoField } from "./remixShared.js";
import { joinPrompt, option, refsOf, textOf } from "./shared.js";
import { checkReferenceLimit } from "../validate.js";
import { STYLE_PRESETS } from "./styles.js";

const STYLIZE_SLOT: ModelSlot = {
  name: "stylize", label: "Restyle the first frame", task: "image-to-image",
  description: "Redraws the first frame of the source in the chosen style.",
  defaultModel: "bytedance/seedream-5.5",
  alternatives: ["openai/gpt-image-2.6", "google/nano-banana-pro", "black-forest-labs/flux-2-max", "black-forest-labs/flux-3-image", "black-forest-labs/flux-kontext-max"],
  rationale: "Volcengine Ark image API (https://docs.volcengine.com/docs/ark/image-generation-api?lang=en, read 2026-11-26): "
    + "Seedream 5.5 edits one source image with up to 10 references at a low per-image price.",
};

function firstFrameStep(): LocalStep {
  return {
    id: "first-frame", label: "Take the first frame", kind: "local", op: "frame", dependsOn: [],
    async run(rt) {
      const source = sourceOf(rt.values);
      if (!source.path) throw new Error("source file missing");
      const out = rt.tempPath("first.png");
      await rt.local.frame(source.path, out, "first", rt.signal);
      return [{ kind: "image", mimeType: "image/png", path: out }];
    },
  };
}

function stylePrompt(values: WorkflowValues): string {
  const preset = STYLE_PRESETS[textOf(values, "style") ?? ""];
  const plate = refsOf(values, "styleImage").length > 0;
  return joinPrompt(
    "Redraw image 1 in a new visual style. Keep its composition, framing, poses, and every person and object in place.",
    preset ? "Style: " + preset.prompt : undefined,
    plate ? "Match the look of image 2: medium, palette, line and texture." : undefined,
    textOf(values, "prompt"),
  );
}

function stylizeStep(slot: ResolvedSlot, values: WorkflowValues): MediaStep {
  const step: MediaStep = {
    id: "style-frame", label: "Restyle the first frame", kind: "media", slot: "stylize", model: slot.model,
    outputKind: "image", dependsOn: ["first-frame"], units: { unit: "image", quantity: 1 },
    async build(rt) {
      const frame = rt.artifactsOf("first-frame")[0];
      if (!frame) throw new Error("first frame missing");
      const inputs = [await rt.asInput(frame, "source-image")];
      for (const plate of refsOf(values, "styleImage")) inputs.push(await rt.asInput(plate, "reference-image"));
      return { model: slot.model, task: "image-to-image", prompt: stylePrompt(values), count: 1, inputs };
    },
  };
  if (slot.route) step.route = slot.route;
  return step;
}

const RENDER_INSTRUCTION = "Edit the source video so the whole clip takes the look of image 1, which is its first frame redrawn in the target style. "
  + "Keep the source's motion, timing, camera movement and composition; change only the rendering style.";

export const remixRestyle: WorkflowDefinition = {
  id: "remix-restyle",
  label: "Remix: restyle",
  description: "Redraw a whole 4-15 second clip in another style while keeping its motion and sound.",
  equivalents: ["sume/sume-remix-restyle"],
  fields: [
    sourceVideoField(),
    { name: "style", type: "enum", label: "Style", required: false, options: Object.entries(STYLE_PRESETS).map(([k, s]) => option(k, s.label)) },
    { name: "styleImage", type: "media", accept: "image", label: "Style reference", required: false, min: 1, max: 1, help: "Optional image whose look to copy; use with or instead of a style." },
    { name: "prompt", type: "text", label: "Notes", required: false, maxLength: 2000, multiline: true, help: "Added after the style direction." },
    ...REMIX_FIELDS_TAIL,
  ],
  slots: [STYLIZE_SLOT, renderSlot(false)],
  check(values) {
    return values.style === undefined && values.styleImage === undefined ? "choose a style or add a style reference" : null;
  },
  plan(values, models, env) {
    const stylize = models.stylize;
    const render = models.render;
    if (!stylize || !render) throw new Error("restyle slots missing");
    checkReferenceLimit(env, stylize.model, refsOf(values, "styleImage").length, "styleImage");
    checkRemixFit(env, render.model, values, 1);
    const renderSpec = renderStep({
      slot: render, values, dependsOn: ["style-frame"], instruction: RENDER_INSTRUCTION, includeUserImages: false, catalog: env.catalog,
      async extraInputs(rt) {
        const styled = rt.artifactsOf("style-frame")[0];
        if (!styled) throw new Error("styled frame missing");
        return [await rt.asInput(styled, "reference-image")];
      },
    });
    return { workflowId: "remix-restyle", steps: finishRemix(values, [firstFrameStep(), stylizeStep(stylize, values)], renderSpec) };
  },
};

