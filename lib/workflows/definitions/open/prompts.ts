/**
 * Prompt templates for the open-pipeline Remix presets. Our own wording. The stage layout follows
 * the public open reproductions (D3voz/openjutsu MIT, SydFloyd/openjutsu Apache-2.0,
 * alisson-anjos/Henge MIT): describe the source shot with a vision model, prepare the subject in
 * the first frame, then let a guided video model carry the source motion. No code or graph is copied.
 */
import { joinPrompt } from "../shared.js";

export interface Caption {
  scene?: string;
  subjects?: string;
  motion?: string;
  camera?: string;
  lighting?: string;
  references?: string;
}

export const CAPTION_SYSTEM = [
  "You describe a short source video for a video model that must recreate its motion.",
  "You get frames from the clip in time order, then any reference images the user supplied.",
  "Return JSON only: {\"scene\": string, \"subjects\": string, \"motion\": string, \"camera\": string, \"lighting\": string, \"references\": string}.",
  "scene: setting and background. subjects: each moving person or object and where it is in frame.",
  "motion: what each subject does over time, with direction and speed. camera: shot size, angle and camera movement.",
  "lighting: light direction, quality and colour. references: what each reference image shows, in order (empty if none).",
  "Be concrete and visual; no opinions, no names of real people.",
].join(" ");

export function captionUser(frameCount: number, refCount: number, durationSec: number): string {
  return "Frames: " + frameCount + " from a " + durationSec.toFixed(1) + " s clip, in time order." + (refCount > 0 ? " Then " + refCount + " reference image(s)." : "");
}

function captionLines(c: Caption | undefined): string | undefined {
  if (!c) return undefined;
  const parts = [
    c.motion ? "Motion to keep: " + c.motion : undefined,
    c.camera ? "Camera to keep: " + c.camera : undefined,
    c.lighting ? "Lighting: " + c.lighting : undefined,
  ];
  return joinPrompt(...parts);
}

export function motionRenderPrompt(c: Caption | undefined, notes: string | undefined, refNames: string): string {
  return joinPrompt(
    "Recreate the exact motion, timing and camera movement of video 1 with new subjects: " + refNames + ". Rebuild the scene around them; keep the framing and pacing of video 1.",
    captionLines(c),
    notes,
  );
}

export function swapRenderPrompt(c: Caption | undefined, target: string | undefined, notes: string | undefined, refNames: string, textOnly: boolean): string {
  const what = target ?? c?.subjects ?? "the main subject";
  const replacement = textOnly ? (c?.references ? "the subject described as: " + c.references : "the new subject") : refNames;
  return joinPrompt(
    "Edit the video. Replace only " + what + " with " + replacement + ". Keep everything else exactly as filmed: background, other subjects, lighting, motion, timing and camera.",
    textOnly ? undefined : "Image 1 is the first frame with the replacement already in place; match it.",
    notes,
  );
}

export function restyleRenderPrompt(c: Caption | undefined, styleText: string | undefined, notes: string | undefined, textOnly: boolean): string {
  return joinPrompt(
    "Restyle the whole video. Keep every motion, camera move, framing and timing exactly; change only the look.",
    textOnly ? (styleText ? "Look: " + styleText : undefined) : "Image 1 is the first frame redrawn in the target look; match its medium, palette and lighting in every frame.",
    captionLines(c),
    notes,
  );
}

export function subjectPrompt(mode: "motion" | "swap", target: string | undefined, refCount: number, masked: boolean): string {
  const refs = Array.from({ length: refCount }, (_, i) => "image " + (i + 2)).join(", ");
  if (mode === "motion") {
    return "Edit image 1. Replace the people or things performing in it with the subjects from " + refs + ", in that order. Keep each pose, position, scale, framing, background and lighting exactly.";
  }
  return "Edit image 1. Replace only " + (target ?? "the main subject") + (masked ? " (the masked area)" : "") + " with the one from " + refs + ". Keep everything else exactly as it is.";
}

export function restylePrompt(styleText: string | undefined, hasPlate: boolean, notes: string | undefined): string {
  return joinPrompt(
    "Redraw image 1 in a new visual style. Keep its composition, framing, poses, and every person and object in place.",
    styleText ? "Style: " + styleText : undefined,
    hasPlate ? "Match the look of image 2: medium, palette, line and texture." : undefined,
    notes,
  );
}

/** Reads a caption JSON leniently: keeps only string fields. */
export function readCaption(raw: unknown): Caption {
  const out: Caption = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of ["scene", "subjects", "motion", "camera", "lighting", "references"] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 800);
  }
  return out;
}
