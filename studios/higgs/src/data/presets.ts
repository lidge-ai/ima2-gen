/**
 * ima2's own starting points. A preset fills the prompt and settings; it never
 * hides what will be sent. Sample media under public/samples was made for ima2.
 */
export interface Preset {
  id: string;
  kind: "image" | "video";
  label: string;
  category: string;
  prompt: string;
  aspectRatio?: string;
  durationSec?: number;
  /** Preferred model when the catalog has it; the person can change it. */
  model?: string;
  sample: string;
  sampleKind: "image" | "video";
}

export const PRESETS: readonly Preset[] = [
  {
    id: "slow-push",
    kind: "video",
    label: "Slow push in",
    category: "Camera",
    prompt: "Slow dolly push toward the subject, shallow depth of field, steady framing",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/slow-push.mp4",
    sampleKind: "video",
  },
  {
    id: "orbit",
    kind: "video",
    label: "Orbit",
    category: "Camera",
    prompt: "Camera orbits 90 degrees around the subject at eye level, smooth parallax",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/orbit.mp4",
    sampleKind: "video",
  },
  {
    id: "crane-up",
    kind: "video",
    label: "Crane up",
    category: "Camera",
    prompt: "Camera rises from ground level to a high wide view, revealing the scene",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/crane-up.mp4",
    sampleKind: "video",
  },
  {
    id: "handheld",
    kind: "video",
    label: "Handheld follow",
    category: "Camera",
    prompt: "Handheld camera follows the subject from behind, natural sway",
    durationSec: 5,
    aspectRatio: "9:16",
    sample: "samples/handheld.mp4",
    sampleKind: "video",
  },
  {
    id: "rain-neon",
    kind: "video",
    label: "Neon rain",
    category: "Mood",
    prompt: "Night street in light rain, neon reflections on wet asphalt, slow motion drops",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/rain-neon.mp4",
    sampleKind: "video",
  },
  {
    id: "product-turn",
    kind: "video",
    label: "Product turntable",
    category: "Product",
    prompt: "Product rotates slowly on a seamless studio backdrop, soft key light",
    durationSec: 5,
    aspectRatio: "1:1",
    sample: "samples/product-turn.mp4",
    sampleKind: "video",
  },
  {
    id: "editorial",
    kind: "image",
    label: "Editorial portrait",
    category: "Portrait",
    prompt: "Editorial portrait, window light, muted palette, 85mm lens, film grain",
    aspectRatio: "3:4",
    sample: "samples/editorial.jpg",
    sampleKind: "image",
  },
  {
    id: "isometric",
    kind: "image",
    label: "Isometric room",
    category: "Illustration",
    prompt: "Isometric cutaway of a tiny studio apartment, clean soft shading, pastel palette",
    aspectRatio: "1:1",
    sample: "samples/isometric.jpg",
    sampleKind: "image",
  },
  {
    id: "packshot",
    kind: "image",
    label: "Packshot",
    category: "Product",
    prompt: "Minimal product packshot on colored paper, hard shadow, top light",
    aspectRatio: "4:5",
    sample: "samples/packshot.jpg",
    sampleKind: "image",
  },
  {
    id: "landscape",
    kind: "image",
    label: "Wide landscape",
    category: "Scene",
    prompt: "Wide landscape at blue hour, layered mountains, low fog, cinematic",
    aspectRatio: "16:9",
    sample: "samples/landscape.jpg",
    sampleKind: "image",
  },
];

export function presetsFor(kind: "image" | "video"): readonly Preset[] {
  return PRESETS.filter((preset) => preset.kind === kind);
}

export function findPreset(id: string | undefined): Preset | undefined {
  return id ? PRESETS.find((preset) => preset.id === id) : undefined;
}
