import type { WorkflowDefinition } from "../types.js";
import { aspectField } from "./shared.js";
import { countField, imageSlot, promptField, resolutionField, stillStep } from "./stillsShared.js";

export const directorCast: WorkflowDefinition = {
  id: "director-cast", label: "Director cast", description: "Create a consistent character reference sheet.",
  slots: [imageSlot],
  fields: [
    promptField,
    { name: "images", type: "media", label: "Reference images", accept: "image", min: 1, max: 4, required: false },
    aspectField(["16:9", "1:1", "4:3", "3:2"], "16:9"), resolutionField(["1k", "2k", "4k"]), countField,
  ],
  plan(values, models, env) {
    return { workflowId: "director-cast", steps: [stillStep(values, models.image!,
      "Create a character reference sheet on a plain neutral background. Show full-body front, three-quarter, side and back views, a row of facial expressions, and close-ups of wardrobe and props. Maintain the same identity across every view and preserve identity from any reference images.", "16:9", false, env)] };
  },
};

