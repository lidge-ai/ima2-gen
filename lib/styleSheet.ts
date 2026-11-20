// Style-sheet extractor (0.10)
//
// Uses gpt-6-luna by default on the API-key client (chat completions) to derive a structured "style guide" from a
// user prompt and optional reference image. The style guide is stored per
// session and automatically prepended to subsequent image generations so
// continuations feel cohesive — closer to ChatGPT 4o's image carry-over.
//
// Shape:
//   {
//     palette: string[],         // e.g. ["deep navy", "gold leaf"]
//     composition: string,       // e.g. "centered 3/4 portrait, shallow depth"
//     mood: string,              // e.g. "melancholic, reverent"
//     medium: string,            // e.g. "oil painting, glazed layers"
//     subject_details: string,   // identity/pose/outfit cues for character continuity
//     negative: string[]         // things to avoid
//   }
//
// The module is pure JS + openai SDK. When no API key is configured it throws
// STYLE_SHEET_NO_KEY so callers can surface a friendly "connect key" UI.

import type OpenAI from "openai";
import { config } from "../config.js";
const STYLE_SHEET_MODEL = config.styleSheet.model;

const SYSTEM_PROMPT = `You extract a reusable visual style guide from a user
image prompt (and an optional reference image). Return ONLY a JSON object with
these keys: palette (array of 3-6 concrete color names), composition (one
sentence), mood (2-4 comma-separated adjectives), medium (one short phrase
naming technique/material), subject_details (one sentence capturing identity
cues: face, outfit, pose, distinctive features), negative (array of 0-4 short
phrases of things to avoid). Keep entries tight — each under 120 characters.
Do not wrap in markdown. Do not add commentary.`;

interface StyleSheet {
  palette: string[];
  composition: string;
  mood: string;
  medium: string;
  subject_details: string;
  negative: string[];
}

function coerceStyleSheet(raw: unknown): StyleSheet | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const arr = (v: unknown, max = 6) =>
    Array.isArray(v)
      ? v
          .filter((x: unknown) => typeof x === "string" && x.trim())
          .slice(0, max)
          .map((s: string) => s.trim())
      : [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 400) : "");
  const r = raw as Record<string, unknown>;
  const sheet: StyleSheet = {
    palette: arr(r.palette, 6),
    composition: str(r.composition),
    mood: str(r.mood),
    medium: str(r.medium),
    subject_details: str(r.subject_details),
    negative: arr(r.negative, 4),
  };
  const hasContent =
    sheet.palette.length > 0 ||
    sheet.negative.length > 0 ||
    sheet.composition ||
    sheet.mood ||
    sheet.medium ||
    sheet.subject_details;
  return hasContent ? sheet : null;
}

export async function extractStyleSheet(openai: OpenAI | null | undefined, { prompt, referenceDataUrl }: { prompt: string; referenceDataUrl?: string | undefined }) {
  if (!openai) {
    const err = new Error("No OpenAI client configured for style-sheet extraction") as Error & { code?: string };
    err.code = "STYLE_SHEET_NO_KEY";
    throw err;
  }
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    const err = new Error("prompt is required") as Error & { code?: string };
    err.code = "STYLE_SHEET_BAD_INPUT";
    throw err;
  }

  const userContent = referenceDataUrl
    ? [
        { type: "text" as const, text: prompt },
        { type: "image_url" as const, image_url: { url: referenceDataUrl } },
      ]
    : prompt;

  const resp = await openai.chat.completions.create({
    model: STYLE_SHEET_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content;
  if (!raw) {
    const err = new Error("Empty response from style-sheet model") as Error & { code?: string };
    err.code = "STYLE_SHEET_EMPTY";
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error("Style-sheet model returned non-JSON") as Error & { code?: string };
    err.code = "STYLE_SHEET_PARSE";
    throw err;
  }

  const sheet = coerceStyleSheet(parsed);
  if (!sheet) {
    const err = new Error("Style-sheet shape invalid") as Error & { code?: string };
    err.code = "STYLE_SHEET_SHAPE";
    throw err;
  }
  return sheet;
}

// Render a style sheet into a prompt preamble that gpt-image-1/2 can consume.
// Kept short so it doesn't blow the 4K prompt window on long user prompts.
export function renderStyleSheetPrefix(sheet: StyleSheet | null | undefined) {
  if (!sheet) return "";
  const parts: string[] = [];
  if (sheet.medium) parts.push(`Medium: ${sheet.medium}.`);
  if (sheet.palette?.length) parts.push(`Palette: ${sheet.palette.join(", ")}.`);
  if (sheet.composition) parts.push(`Composition: ${sheet.composition}.`);
  if (sheet.mood) parts.push(`Mood: ${sheet.mood}.`);
  if (sheet.subject_details) parts.push(`Subject: ${sheet.subject_details}.`);
  if (sheet.negative?.length) parts.push(`Avoid: ${sheet.negative.join(", ")}.`);
  return parts.join(" ");
}

export { STYLE_SHEET_MODEL, SYSTEM_PROMPT, coerceStyleSheet };
