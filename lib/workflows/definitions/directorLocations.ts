import type { WorkflowDefinition } from "../types.js";
import { aspectField, checkLook, lookFields } from "./shared.js";
import { countField, imageSlot, promptField, resolutionField, stillStep } from "./stillsShared.js";

export const directorLocations: WorkflowDefinition = {
  id: "director-locations", label: "Director locations", description: "Create a cinematic location study.",
  equivalents: ["sume/sume-director-locations-1"], slots: [imageSlot],
  fields: [
    promptField,
    { name: "images", type: "media", label: "Reference image", accept: "image", min: 0, max: 1, required: false },
    aspectField(["16:9", "21:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"], "16:9"),
    resolutionField(["1k", "2k", "4k"]), countField, ...lookFields(),
  ],
  check: checkLook,
  plan(values, models, env) {
    return { workflowId: "director-locations", steps: [stillStep(values, models.image!,
      "Show an empty film location with no people, dressed and lit as a shooting set. Use motivated practical lighting, believable scale and a wide establishing composition.", "16:9", false, env)] };
  },
};

