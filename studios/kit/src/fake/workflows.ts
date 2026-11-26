/**
 * Development workflow definitions. They mirror the shape lib/workflows (lane L6)
 * serves; step models are catalog ids so the UI can show per-step cost.
 */
import { estimateCost, sumEstimates } from "../pricing.ts";
import { chooseRoute } from "../routing.ts";
import type {
  Catalog,
  CostEstimate,
  WorkflowDef,
  WorkflowEstimate,
  WorkflowInputSpec,
  WorkflowParamSpec,
  WorkflowRunBody,
} from "../types.ts";

const SOURCE: WorkflowInputSpec = {
  name: "source",
  label: "Source video",
  kind: "video",
  role: "source-video",
  required: true,
  accept: "video/*",
  description: "4 to 30 seconds",
};
const CAST: WorkflowInputSpec = {
  name: "cast",
  label: "Characters, products or clothes",
  kind: "image",
  role: "reference-image",
  required: false,
  accept: "image/*",
  maxCount: 4,
};
const PROMPT: WorkflowInputSpec = { name: "prompt", label: "Direction", kind: "text", required: false };
const RES: WorkflowParamSpec = {
  name: "resolution",
  label: "Resolution",
  type: "select",
  options: [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
  ],
  default: "720p",
};
const DURATION: WorkflowParamSpec = {
  name: "duration",
  label: "Shot length",
  type: "select",
  options: [
    { value: "5", label: "5 s" },
    { value: "8", label: "8 s" },
    { value: "10", label: "10 s" },
  ],
  default: "5",
};
const GENRE: WorkflowParamSpec = {
  name: "genre",
  label: "Genre",
  type: "select",
  options: ["General", "Drama", "Action", "Horror", "Comedy", "Documentary"].map((g) => ({
    value: g.toLowerCase(),
    label: g,
  })),
  default: "general",
};
const CAMERA: WorkflowParamSpec = {
  name: "camera",
  label: "Camera",
  type: "select",
  options: ["Auto", "Static", "Dolly", "Handheld", "Crane", "Orbit"].map((c) => ({ value: c.toLowerCase(), label: c })),
  default: "auto",
};
const VIDEO_MODELS = ["kling/kling-3-omni", "alibaba/wan-3.0"];

export const workflows: WorkflowDef[] = [
  {
    id: "remix-motion-transfer",
    family: "remix",
    label: "Motion transfer",
    output: "video",
    description: "Keep the movement of a source clip and recast it with your characters or products.",
    inputs: [SOURCE, { ...CAST, required: true, description: "Who or what should perform the motion" }, PROMPT],
    params: [RES, { name: "keepAudio", label: "Keep source sound", type: "boolean", default: true }],
    steps: [
      { id: "analyze", label: "Read motion and framing" },
      {
        id: "first-frame",
        label: "Compose the first frame",
        model: "google/nano-banana-pro",
        modelChoices: ["google/nano-banana-pro", "openai/gpt-image-2"],
      },
      {
        id: "animate",
        label: "Drive it with the source motion",
        model: "kling/kling-3-omni",
        modelChoices: VIDEO_MODELS,
      },
    ],
  },
  {
    id: "remix-subject-swap",
    family: "remix",
    label: "Subject swap",
    output: "video",
    description: "Replace one thing in a clip and keep everything else as it was.",
    inputs: [
      SOURCE,
      {
        name: "target",
        label: "What to replace",
        kind: "text",
        required: true,
        description: "For example: the red car",
      },
      { ...CAST, required: true, maxCount: 2, label: "Replace it with" },
    ],
    params: [RES],
    steps: [
      { id: "locate", label: "Find the subject in every frame" },
      {
        id: "swap-frame",
        label: "Swap it in a key frame",
        model: "google/nano-banana-pro",
        modelChoices: ["google/nano-banana-pro", "black-forest-labs/flux-2-pro"],
      },
      {
        id: "propagate",
        label: "Carry the swap through the clip",
        model: "alibaba/wan-3.0",
        modelChoices: VIDEO_MODELS,
      },
    ],
  },
  {
    id: "remix-restyle",
    family: "remix",
    label: "Restyle",
    output: "video",
    description: "Redraw a clip in another look while the motion stays put.",
    inputs: [
      SOURCE,
      {
        name: "style",
        label: "Style reference",
        kind: "image",
        role: "reference-image",
        required: false,
        accept: "image/*",
        maxCount: 1,
      },
      PROMPT,
    ],
    params: [
      {
        name: "look",
        label: "Look",
        type: "select",
        options: ["Film", "Anime", "Clay", "Watercolor", "Noir", "Custom"].map((l) => ({
          value: l.toLowerCase(),
          label: l,
        })),
        default: "film",
      },
      RES,
    ],
    steps: [
      {
        id: "style-frame",
        label: "Restyle a key frame",
        model: "black-forest-labs/flux-2-pro",
        modelChoices: ["black-forest-labs/flux-2-pro", "google/nano-banana-pro"],
      },
      { id: "restyle", label: "Apply the look to the clip", model: "kling/kling-3-omni", modelChoices: VIDEO_MODELS },
    ],
  },
  {
    id: "director-cast",
    family: "director",
    label: "Cast",
    output: "image",
    description: "Turn photos or a description into a character sheet you can reuse across shots.",
    inputs: [
      { name: "description", label: "Character", kind: "text", required: true, description: "Age, look, wardrobe" },
      { ...CAST, label: "Photos", maxCount: 3 },
    ],
    params: [],
    steps: [
      {
        id: "sheet",
        label: "Draw the character sheet",
        model: "google/nano-banana-pro",
        modelChoices: ["google/nano-banana-pro", "bytedance/seedream-5.5"],
      },
    ],
  },
  {
    id: "director-locations",
    family: "director",
    label: "Locations",
    output: "image",
    description: "Build a location plate to place your scenes in.",
    inputs: [
      {
        name: "description",
        label: "Location",
        kind: "text",
        required: true,
        description: "Place, time of day, weather",
      },
      {
        name: "photo",
        label: "Reference photo",
        kind: "image",
        role: "reference-image",
        required: false,
        accept: "image/*",
        maxCount: 1,
      },
    ],
    params: [
      {
        name: "aspect",
        label: "Frame",
        type: "select",
        options: [
          { value: "16:9", label: "16:9" },
          { value: "21:9", label: "21:9" },
          { value: "9:16", label: "9:16" },
        ],
        default: "16:9",
      },
    ],
    steps: [
      {
        id: "plate",
        label: "Render the plate",
        model: "bytedance/seedream-5.5",
        modelChoices: ["bytedance/seedream-5.5", "black-forest-labs/flux-2-pro"],
      },
    ],
  },
  {
    id: "director-studio",
    family: "director",
    label: "Studio shot",
    output: "video",
    description: "One directed shot from your cast, location and a scene description.",
    inputs: [
      { name: "prompt", label: "Scene", kind: "text", required: true },
      { ...CAST, label: "Cast" },
      {
        name: "location",
        label: "Location",
        kind: "image",
        role: "reference-image",
        required: false,
        accept: "image/*",
        maxCount: 1,
      },
    ],
    params: [GENRE, CAMERA, DURATION],
    steps: [
      {
        id: "keyframe",
        label: "Compose the key frame",
        model: "google/nano-banana-pro",
        modelChoices: ["google/nano-banana-pro", "openai/gpt-image-2"],
      },
      {
        id: "shot",
        label: "Shoot it",
        model: "bytedance/seedance-2.5",
        modelChoices: ["bytedance/seedance-2.5", "google/veo-3.1", "kling/kling-3"],
      },
    ],
  },
  {
    id: "director-cinema",
    family: "director",
    label: "Cinema",
    output: "video",
    description: "A short scene from a script: shot list, key frames, shots and sound, cut together.",
    inputs: [
      {
        name: "script",
        label: "Script",
        kind: "text",
        required: true,
        description: "A few lines of action and dialogue",
      },
      { ...CAST, label: "Cast" },
      {
        name: "location",
        label: "Location",
        kind: "image",
        role: "reference-image",
        required: false,
        accept: "image/*",
        maxCount: 1,
      },
    ],
    params: [GENRE, { name: "shots", label: "Shots", type: "number", min: 1, max: 6, step: 1, default: 3 }, DURATION],
    steps: [
      { id: "plan", label: "Break the script into shots" },
      {
        id: "keyframes",
        label: "Compose key frames",
        model: "google/nano-banana-pro",
        modelChoices: ["google/nano-banana-pro", "openai/gpt-image-2"],
      },
      {
        id: "shots",
        label: "Shoot every shot",
        model: "google/veo-3.1",
        modelChoices: ["google/veo-3.1", "bytedance/seedance-2.5", "kling/kling-3"],
      },
      { id: "sound", label: "Add sound", model: "mirelo/mirelo-sfx-2" },
    ],
  },
];

function stepEstimate(catalog: Catalog, body: WorkflowRunBody, step: WorkflowDef["steps"][number]): CostEstimate {
  const modelId = body.steps?.[step.id]?.model ?? step.model;
  if (!modelId) return { usd: 0, basis: "Runs locally" };
  const model = catalog.models.find((m) => m.id === modelId);
  if (!model) return { usd: null, basis: "Unknown model " + modelId };
  const choice = chooseRoute(model, body.steps?.[step.id]?.provider);
  const pricing = choice.kind === "unavailable" ? [] : choice.route.pricing;
  const shots = Number(body.params?.shots ?? 1);
  return estimateCost(pricing, {
    durationSec: Number(body.params?.duration ?? 5),
    count: shots,
    resolution: String(body.params?.resolution ?? ""),
  });
}

export function estimateWorkflow(def: WorkflowDef, body: WorkflowRunBody, catalog: Catalog): WorkflowEstimate {
  const steps = def.steps.map((step) => ({ id: step.id, estimate: stepEstimate(catalog, body, step) }));
  return { steps, total: sumEstimates(steps.map((s) => s.estimate)) };
}
