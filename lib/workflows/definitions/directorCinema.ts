import type { WorkflowDefinition } from "../types.js";
import { aspectField, checkLook, lookFields } from "./shared.js";
import { imageSlot, promptField, resolutionField, stillStep } from "./stillsShared.js";

export const directorCinema: WorkflowDefinition = {
  id: "director-cinema", label: "Director cinema", description: "Create a cinematic film still.",
  equivalents: ["sume/sume-director-cinema-1"], slots: [imageSlot],
  fields: [
    promptField,
    { name: "images", type: "media", label: "Scene reference", accept: "image", min: 0, max: 1, required: false },
    { name: "characterImage", type: "media", label: "Character reference", help: "One character to keep as they look.", accept: "image", min: 0, max: 1, required: false },
    aspectField(["9:16", "3:4", "2:3", "1:1", "4:3", "16:9", "3:2", "21:9"], "1:1"),
    resolutionField(["1k", "2k"]), ...lookFields(),
  ],
  check: checkLook,
  plan(values, models) {
    return { workflowId: "director-cinema", steps: [stillStep(values, models.image!,
      "Create a single cinematic film still, like a frame from a feature film, with deliberate composition, depth and lighting.", "1:1", true)] };
  },
};
