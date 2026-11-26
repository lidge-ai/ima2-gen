import type { MediaInput } from "../../providers/media/contract.js";
import type { EnumField, StepRuntime, WorkflowField, WorkflowMediaRef, WorkflowValues } from "../types.js";

export function option(value: string, label: string): { value: string; label: string } {
  return { value, label };
}

export function refsOf(values: WorkflowValues, name: string): readonly WorkflowMediaRef[] {
  return (values[name] as readonly WorkflowMediaRef[] | undefined) ?? [];
}

export function textOf(values: WorkflowValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

export function intOf(values: WorkflowValues, name: string, fallback: number): number {
  const value = values[name];
  return typeof value === "number" ? value : fallback;
}

/** Billable whole seconds of a probed clip. */
export function wholeSeconds(ref: WorkflowMediaRef | undefined): number {
  return Math.max(1, Math.ceil((ref?.durationSec ?? 0) - 0.05));
}

export async function inputsFrom(rt: StepRuntime, refs: readonly WorkflowMediaRef[], role: MediaInput["role"]): Promise<MediaInput[]> {
  return Promise.all(refs.map((ref) => rt.asInput(ref, role)));
}

export const VIDEO_RESOLUTIONS = [option("480p", "480p"), option("720p", "720p"), option("1080p", "1080p")] as const;

export function videoResolutionField(): EnumField {
  return { name: "resolution", type: "enum", label: "Resolution", required: false, options: VIDEO_RESOLUTIONS, default: "720p" };
}

export const ASPECTS = ["16:9", "21:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"] as const;

export function aspectField(values: readonly string[], fallback: string): EnumField {
  return { name: "aspectRatio", type: "enum", label: "Aspect ratio", required: false, options: values.map((v) => option(v, v)), default: fallback };
}

/* ---------- Look: camera, lens, palette. Our own wording; applied as prompt direction. ---------- */

export const CAMERAS: Readonly<Record<string, string>> = {
  "modern": "a modern digital cinema camera with a clean, low-noise image and wide dynamic range",
  "35mm-film": "35mm motion picture film with fine grain and soft highlight roll-off",
  "16mm-film": "16mm film with visible grain, slightly lifted blacks and documentary texture",
  "8mm-film": "8mm home-movie film with heavy grain, gate weave and faded color",
  "dv-camcorder": "an early-2000s DV camcorder with interlaced softness, video sharpening and clipped highlights",
};

export const LENSES: Readonly<Record<string, string>> = {
  "clean-sharp": "modern spherical primes, sharp edge to edge, minimal flare",
  "anamorphic": "anamorphic lenses with oval bokeh, horizontal flares and a wide frame",
  "vintage-anamorphic": "vintage anamorphic glass with blue streak flares, soft corners and gentle distortion",
  "vintage-soft": "vintage spherical lenses with low contrast, warm cast and soft focus fall-off",
  "halation": "uncoated lenses with strong halation glow around highlights",
};

export const PALETTES: Readonly<Record<string, { label: string; colors: readonly string[] }>> = {
  "teal-orange": { label: "Teal and orange", colors: ["#0f4c5c", "#1f7a8c", "#e36414", "#fb8b24", "#f2e8cf"] },
  "bleach-bypass": { label: "Bleach bypass", colors: ["#2b2d2f", "#5c6266", "#8d9499", "#c3c7c9", "#e8e4d9"] },
  "golden-hour": { label: "Golden hour", colors: ["#3d2c1e", "#a0522d", "#e09f3e", "#f6d186", "#fff3d6"] },
  "neon-noir": { label: "Neon noir", colors: ["#0b0c1a", "#1b1f4b", "#ff2e88", "#00e5ff", "#7b2ff7"] },
  "pastel-dream": { label: "Pastel dream", colors: ["#f7cad0", "#fbe7c6", "#b4f8c8", "#a0e7e5", "#cdb4db"] },
  "silver-mono": { label: "Silver monochrome", colors: ["#111111", "#444444", "#7a7a7a", "#b5b5b5", "#efefef"] },
  "forest-moss": { label: "Forest moss", colors: ["#1b2b1a", "#344e41", "#588157", "#a3b18a", "#dad7cd"] },
  "desert-ochre": { label: "Desert ochre", colors: ["#3e2723", "#8d5524", "#c68642", "#e0ac69", "#f1dcb4"] },
  "arctic-blue": { label: "Arctic blue", colors: ["#0d1b2a", "#1b263b", "#415a77", "#778da9", "#e0e1dd"] },
  "candlelight": { label: "Candlelight", colors: ["#1a0f0a", "#4a2511", "#9c4a1a", "#e8a04c", "#ffe0a3"] },
  "pop-primary": { label: "Pop primaries", colors: ["#d62828", "#f77f00", "#fcbf49", "#003049", "#eae2b7"] },
  "faded-instant": { label: "Faded instant photo", colors: ["#5e548e", "#9f86c0", "#e0b1cb", "#f2d0a4", "#f7ede2"] },
};

export function lookFields(): WorkflowField[] {
  return [
    { name: "camera", type: "enum", label: "Camera", required: false, help: "Leave empty for automatic.", options: Object.keys(CAMERAS).map((k) => option(k, k)) },
    { name: "lens", type: "enum", label: "Lens", required: false, help: "Leave empty for automatic.", options: Object.keys(LENSES).map((k) => option(k, k)) },
    { name: "palette", type: "enum", label: "Color palette", required: false, options: Object.entries(PALETTES).map(([k, p]) => option(k, p.label)) },
    { name: "paletteColors", type: "colors", label: "Custom palette", required: false, min: 2, max: 15, help: "Your own #rrggbb colors; used instead of a preset palette." },
  ];
}

/** Rejects a preset palette and custom colors together. */
export function checkLook(values: WorkflowValues): string | null {
  return values.palette !== undefined && values.paletteColors !== undefined ? "choose a palette preset or custom colors, not both" : null;
}

/** Turns camera, lens and palette choices into prompt direction. Empty when nothing is set. */
export function lookPrompt(values: WorkflowValues): string {
  const parts: string[] = [];
  const camera = CAMERAS[textOf(values, "camera") ?? ""];
  const lens = LENSES[textOf(values, "lens") ?? ""];
  if (camera) parts.push("Shot on " + camera + ".");
  if (lens) parts.push("Lensing: " + lens + ".");
  const preset = PALETTES[textOf(values, "palette") ?? ""];
  const colors = (values.paletteColors as readonly string[] | undefined) ?? preset?.colors;
  if (colors) parts.push("Grade the colors around this palette: " + colors.join(", ") + (preset ? " (" + preset.label.toLowerCase() + ")" : "") + ".");
  return parts.join(" ");
}

export function joinPrompt(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join("\n\n");
}
