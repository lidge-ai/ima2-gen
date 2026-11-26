import type { WorkflowDefinition } from "../types.js";
import { finishRemix, imageList, referenceImagesField, REMIX_FIELDS_TAIL, renderSlot, renderStep, sourceVideoField, tierField } from "./remixShared.js";
import { refsOf } from "./shared.js";

function instruction(count: number): string {
  return [
    "Edit the source video. Replace the people or things performing in it with the subjects shown in the reference images ("
      + imageList(count) + "), in that order unless the notes below say otherwise.",
    "Keep the source's body motion, gestures, timing, camera movement and framing. Take faces, bodies, outfits and materials from the references.",
  ].join(" ");
}

export const remixMotionTransfer: WorkflowDefinition = {
  id: "remix-motion-transfer",
  label: "Remix: motion transfer",
  description: "Your subjects perform the motion of a 4-15 second clip; camera, timing and sound follow the clip.",
  equivalents: ["sume/sume-remix-motion-transfer", "sume/sume-remix-lite-motion-transfer"],
  fields: [
    sourceVideoField(),
    referenceImagesField("1-8 images of the people or things that should perform, in order."),
    { name: "prompt", type: "text", label: "Notes", required: false, maxLength: 4000, multiline: true, help: "Optional: which subject each image becomes, what must stay." },
    tierField(),
    ...REMIX_FIELDS_TAIL,
  ],
  slots: [renderSlot(true)],
  tierField: "tier",
  plan(values, models) {
    const slot = models.render;
    if (!slot) throw new Error("render slot missing");
    const render = renderStep({ slot, values, dependsOn: [], instruction: instruction(refsOf(values, "images").length), includeUserImages: true });
    return { workflowId: "remix-motion-transfer", steps: finishRemix(values, [], render) };
  },
};
