import type { WireField, WireSlot, WireWorkflow, WireEstimateResponse } from "../wire.ts";
import type { Catalog } from "../types.ts";

const text = (name: string, label: string, required = false): WireField => ({
  name,
  label,
  required,
  type: "text",
  maxLength: 4000,
  multiline: true,
});
const media = (
  name: string,
  label: string,
  accept: "image" | "video" | "audio",
  required = false,
  max = 1,
): WireField => ({ name, label, required, type: "media", accept, min: 1, max });
const select = (name: string, label: string, values: string[]): WireField => ({
  name,
  label,
  required: false,
  type: "enum",
  options: values.map((value) => ({ value, label: value })),
});
const slot = (
  name: string,
  label: string,
  task: WireSlot["task"],
  model: string,
  alternatives: string[] = [],
): WireSlot => ({
  name,
  label,
  task,
  defaultModel: model,
  alternatives,
  rationale: "Development fixture for this workflow slot.",
  available: Object.fromEntries([model, ...alternatives].map((id) => [id, true])),
});
const video: WireField = {
    ...media("video", "Source video", "video", true),
    minDurationSec: 4,
    maxDurationSec: 15,
  } as WireField,
  images = media("images", "Reference images", "image", true, 8);
const render = slot("render", "Video edit", "video-to-video", "bytedance/seedance-2.5", [
  "bytedance/seedance-2.5-flash",
  "bytedance/seedance-2",
  "bytedance/seedance-2-mini",
  "xai/grok-imagine-video",
]);
const composite = slot("composite", "Put the subject into a frame (GPT)", "image-to-image", "openai/gpt-image-2");
const pin = slot(
  "render",
  "Regenerate the clip between pinned frames (Grok 1.5)",
  "reference-to-video",
  "xai/grok-imagine-video-1.5",
);
const still = slot("image", "Image", "text-to-image", "google/nano-banana-pro", [
  "bytedance/seedream-5.5",
  "openai/gpt-image-2",
]);
const look: WireField[] = [
  select("camera", "Camera", ["modern", "35mm-film", "16mm-film", "8mm-film", "dv-camcorder"]),
  select("lens", "Lens", ["clean-sharp", "anamorphic", "vintage-anamorphic", "vintage-soft", "halation"]),
  select("palette", "Color palette", [
    "teal-orange",
    "bleach-bypass",
    "golden-hour",
    "neon-noir",
    "pastel-dream",
    "silver-mono",
    "forest-moss",
    "desert-ochre",
    "arctic-blue",
    "candlelight",
    "pop-primary",
    "faded-instant",
  ]),
  { name: "paletteColors", type: "colors", label: "Custom palette", required: false, min: 2, max: 15 },
];
const tail: WireField[] = [
  select("resolution", "Resolution", ["480p", "720p", "1080p"]),
  select("sound", "Sound", ["source", "generate", "none"]),
];
const aspect = select("aspectRatio", "Aspect ratio", ["16:9", "9:16", "1:1"]);
const resolution = select("resolution", "Resolution", ["1k", "2k", "4k"]);
const count: WireField = { name: "n", type: "integer", label: "Count", required: false, min: 1, max: 4, default: 1 };
/** Same descriptions the real workflow definitions (lib/workflows/definitions) publish. */
const DESCRIPTIONS: Record<string, string> = {
  "remix-motion-transfer":
    "Your subjects perform the motion of a 4-15 second clip; camera, timing and sound follow the clip.",
  "remix-object-swap": "Swap selected people, products or objects in a 4-15 second clip and keep the rest of the shot.",
  "remix-restyle": "Redraw a whole 4-15 second clip in another style while keeping its motion and sound.",
  "remix-restyle-subscription":
    "Restyles a 4-15 second clip with Grok's video edit, in segments of up to 8.7 seconds, and puts the source sound back.",
  "director-cast": "Create a consistent character reference sheet.",
  "director-cinema": "Create a cinematic film still.",
  "director-locations": "Create a cinematic location study.",
};
const simple = (id: string, label: string, fields: WireField[], slots: WireSlot[]): WireWorkflow => ({
  id,
  label,
  description: DESCRIPTIONS[id] ?? "Development fixture for " + label.toLowerCase() + ".",
  fields,
  slots,
});
const base: WireWorkflow[] = [
  simple(
    "remix-motion-transfer",
    "Remix: motion transfer",
    [video, images, text("prompt", "Notes"), select("tier", "Quality", ["standard", "lite"]), ...tail],
    [render],
  ),
  simple(
    "remix-object-swap",
    "Remix: object swap",
    [
      video,
      images,
      text("target", "What to replace"),
      text("prompt", "Notes"),
      select("tier", "Quality", ["standard", "lite"]),
      ...tail,
    ],
    [render],
  ),
  simple(
    "remix-restyle",
    "Remix: restyle",
    [
      video,
      select("style", "Style", [
        "cel-anime",
        "clay-stop-motion",
        "felt-craft",
        "low-poly",
        "toy-cgi",
        "comic-ink",
        "watercolor",
        "gouache",
        "oil-paint",
        "pixel-art",
        "retro-console-3d",
        "yarn-world",
        "ink-noir",
        "neon-synth",
      ]),
      media("styleImage", "Style reference", "image"),
      text("prompt", "Notes"),
      ...tail,
    ],
    [slot("stylize", "Restyle the first frame", "image-to-image", "bytedance/seedream-5.5"), render],
  ),
  simple(
    "director-cast",
    "Director cast",
    [text("prompt", "Prompt", true), media("images", "Reference images", "image", false, 4), aspect, resolution, count],
    [still],
  ),
  simple(
    "director-locations",
    "Director locations",
    [text("prompt", "Prompt", true), media("images", "Reference image", "image"), aspect, resolution, count, ...look],
    [still],
  ),
  simple(
    "director-cinema",
    "Director cinema",
    [
      text("prompt", "Prompt", true),
      media("images", "Scene reference", "image"),
      media("characterImage", "Character reference", "image"),
      aspect,
      resolution,
      ...look,
    ],
    [still],
  ),
  simple(
    "director-studio",
    "Director studio",
    [
      text("prompt", "Scene", true),
      { name: "duration", type: "integer", label: "Length (seconds)", required: false, min: 4, max: 30, default: 5 },
      tail[0]!,
      aspect,
      { name: "generateAudio", type: "boolean", label: "Sound", required: false, default: true },
      media("images", "Image references", "image", false, 30),
      media("videos", "Video references", "video", false, 10),
      media("audios", "Audio references", "audio", false, 10),
      select("continuity", "Between shots", ["first-frame", "independent"]),
      ...look,
    ],
    [
      slot("render", "Video", "reference-to-video", "bytedance/seedance-2.5"),
      slot("sound", "Sound bed", "video-to-audio", "mirelo/mirelo-sfx-2.0"),
    ],
  ),
];
export const workflows: WireWorkflow[] = [
  ...base,
  simple(
    "remix-motion-transfer-subscription",
    "Remix: motion transfer (subscriptions only)",
    [
      video,
      images,
      text("prompt", "Notes"),
      { name: "anchors", type: "integer", label: "Pinned keyframes", required: false, min: 0, max: 4, default: 4 },
      ...tail,
    ],
    [composite, pin],
  ),
  simple(
    "remix-object-swap-subscription",
    "Remix: object swap (subscriptions only)",
    [
      video,
      images,
      text("target", "What to replace"),
      text("prompt", "Notes"),
      { name: "anchors", type: "integer", label: "Pinned keyframes", required: false, min: 0, max: 4, default: 4 },
      ...tail,
    ],
    [composite, pin],
  ),
  simple(
    "remix-restyle-subscription",
    "Remix: restyle (subscriptions only)",
    [
      video,
      select("style", "Style", [
        "cel-anime",
        "clay-stop-motion",
        "felt-craft",
        "low-poly",
        "toy-cgi",
        "comic-ink",
        "watercolor",
        "gouache",
        "oil-paint",
        "pixel-art",
        "retro-console-3d",
        "yarn-world",
        "ink-noir",
        "neon-synth",
      ]),
      text("prompt", "Look"),
      tail[1]!,
    ],
    [slot("edit", "Restyle each segment (Grok edit)", "video-to-video", "xai/grok-imagine-video")],
  ),
];
for (const workflow of workflows) {
  if (workflow.id === "remix-motion-transfer" || workflow.id === "remix-object-swap") workflow.tierField = "tier";
}
export function estimateWorkflow(
  def: WireWorkflow,
  values: Record<string, unknown>,
  catalog: Catalog,
  selection: Record<string, unknown> = {},
): WireEstimateResponse {
  const models = (selection.models ?? {}) as Record<string, string>,
    routes = (selection.routes ?? {}) as Record<string, string>;
  const steps = def.slots.map((slot, index) => ({
    id: slot.name,
    label: slot.label,
    kind: "media",
    dependsOn: index ? [def.slots[index - 1]!.name] : [],
    model: models[slot.name] ?? slot.defaultModel,
    route:
      routes[slot.name] ??
      catalog.models.find((m) => m.id === (models[slot.name] ?? slot.defaultModel))?.routes.find((r) => r.keyConfigured)
        ?.providerId ??
      "fal",
    final: index === def.slots.length - 1,
  }));
  const estimates = steps.map((step) => {
    const model = catalog.models.find((m) => m.id === step.model),
      price = model?.routes.find((r) => r.providerId === step.route)?.pricing[0];
    const quantity = price?.unit === "second" ? Number(values.duration ?? 5) : 1;
    return {
      stepId: step.id,
      model: step.model,
      usd: price ? price.usd * quantity : null,
      ...(price
        ? { units: { unit: price.unit, quantity }, source: price.source, checkedAt: price.checkedAt }
        : { note: "No published price" }),
    };
  });
  return {
    steps,
    estimate: {
      usd: estimates.reduce((sum, e) => sum + (e.usd ?? 0), 0),
      complete: estimates.every((e) => e.usd !== null),
      steps: estimates,
    },
  };
}
