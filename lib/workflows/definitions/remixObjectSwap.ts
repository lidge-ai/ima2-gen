import type { WorkflowDefinition } from "../types.js";
import { checkRemixFit, finishRemix, imageList, referenceImagesField, REMIX_FIELDS_TAIL, renderSlot, renderStep, sourceVideoField, tierField } from "./remixShared.js";
import { joinPrompt, refsOf, textOf } from "./shared.js";

function instruction(count: number, target: string | undefined): string {
  return joinPrompt(
    "Edit the source video. Swap only the elements named here for the ones in the reference images (" + imageList(count) + ").",
    target ? "Replace: " + target + "." : "Replace the main subject.",
    "Keep everything else as filmed: background, other people, lighting, camera movement and timing.",
  );
}

export const remixObjectSwap: WorkflowDefinition = {
  id: "remix-object-swap",
  label: "Remix: object swap",
  description: "Swap selected people, products or objects in a 4-15 second clip and keep the rest of the shot.",
  equivalents: ["sume/sume-remix-object-swap", "sume/sume-remix-lite-object-swap"],
  fields: [
    sourceVideoField(),
    referenceImagesField("1-8 images of the replacements, in order."),
    { name: "target", type: "text", label: "What to replace", required: false, maxLength: 500, help: "For example: the red car, the man on the left." },
    { name: "prompt", type: "text", label: "Notes", required: false, maxLength: 4000, multiline: true },
    tierField(),
    ...REMIX_FIELDS_TAIL,
  ],
  slots: [renderSlot(true)],
  tierField: "tier",
  plan(values, models, env) {
    const slot = models.render;
    if (!slot) throw new Error("render slot missing");
    checkRemixFit(env, slot.model, values, refsOf(values, "images").length);
    const text = instruction(refsOf(values, "images").length, textOf(values, "target"));
    const render = renderStep({ slot, values, dependsOn: [], instruction: text, includeUserImages: true, catalog: env.catalog });
    return { workflowId: "remix-object-swap", steps: finishRemix(values, [], render) };
  },
};

