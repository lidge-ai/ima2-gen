import { isImageToolModel, normalizeImageQuality } from "../lib/imageModels";
import type { CanvasExportBackground, HexColor } from "../types/canvas";
import { isCoreProviderId } from "../generated/providers";
import type {
  Count,
  ComposerInsertedPromptSnapshot,
  Format,
  HistoryStripLayout,
  ImageModel,
  Moderation,
  Provider,
  Quality,
  SizePreset,
  UIMode,
} from "../types";
import {
  DEFAULT_IMAGE_MODEL,
  isImageModel,
  normalizeVideoModelValue,
} from "../lib/imageModels";
import {
  DEFAULT_REASONING_EFFORT,
  isReasoningEffort,
  type ReasoningEffort,
} from "../lib/reasoning";
import { DEFAULT_WEB_SEARCH_ENABLED } from "../lib/webSearch";
import { ENABLE_AGENT_MODE, ENABLE_CARD_NEWS_MODE, ENABLE_NODE_MODE } from "../lib/devMode";
import { normalizeGenerationCount } from "../lib/generationLimits";
import { parseRequestedCustomSide } from "../lib/size";
import { coerceNaiOverrides, type NaiOptionOverrides } from "../lib/naiOptions";
import {
  ACTIVE_SESSION_ID_STORAGE_KEY,
  CANVAS_EXPORT_BG_KEY,
  GENERATION_DEFAULTS_STORAGE_KEY,
  HISTORY_STRIP_LAYOUT_STORAGE_KEY,
  IMAGE_MODEL_STORAGE_KEY,
  REASONING_EFFORT_STORAGE_KEY,
  NAI_OPTIONS_STORAGE_KEY,
  RIGHT_PANEL_OPEN_STORAGE_KEY,
  SELECTED_FILENAME_STORAGE_KEY,
  UI_MODE_STORAGE_KEY,
  VIDEO_DEFAULTS_STORAGE_KEY,
  WEB_SEARCH_STORAGE_KEY,
} from "./persistenceRegistry";
import type { GalleryScope, InsertedPrompt } from "./storeTypes";

export type { InsertedPrompt } from "./storeTypes";

export function composePrompt(mainPrompt: string, insertedPrompts: InsertedPrompt[]): string {
  const before = insertedPrompts.filter((prompt) => prompt.placement !== "after");
  const after = insertedPrompts.filter((prompt) => prompt.placement === "after");
  return [
    ...before.map((prompt) => prompt.text.trim()).filter(Boolean),
    mainPrompt.trim(),
    ...after.map((prompt) => prompt.text.trim()).filter(Boolean),
  ].filter(Boolean).join("\n\n");
}

export function normalizeInsertedPrompt(value: unknown): InsertedPrompt | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.text !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    name: item.name,
    text: item.text,
    placement: item.placement === "after" ? "after" : "before",
  };
}

export function normalizeInsertedPromptArray(value: unknown): InsertedPrompt[] | null {
  if (!Array.isArray(value)) return null;
  const prompts = value.map(normalizeInsertedPrompt);
  return prompts.every((item): item is InsertedPrompt => item !== null) ? prompts : null;
}

export function cloneInsertedPrompts(
  prompts: InsertedPrompt[],
): ComposerInsertedPromptSnapshot[] {
  return prompts.map((prompt) => ({
    id: prompt.id,
    name: prompt.name,
    text: prompt.text,
    placement: prompt.placement === "after" ? "after" : "before",
  }));
}

export function getHistoryComposerPatch(
  item: { composerPrompt?: string | null; composerInsertedPrompts?: unknown },
): { prompt?: string; insertedPrompts?: InsertedPrompt[] } {
  const restoredInsertedPrompts = normalizeInsertedPromptArray(item.composerInsertedPrompts);
  if (typeof item.composerPrompt === "string") {
    return {
      prompt: item.composerPrompt,
      insertedPrompts: restoredInsertedPrompts ?? [],
    };
  }
  if (restoredInsertedPrompts) return { insertedPrompts: restoredInsertedPrompts };
  return {};
}

export function loadRightPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem(RIGHT_PANEL_OPEN_STORAGE_KEY);
    if (raw === null) return true;
    return JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

export function loadUIMode(): UIMode {
  try {
    const raw = localStorage.getItem(UI_MODE_STORAGE_KEY);
    if (raw === "agent") return ENABLE_AGENT_MODE ? raw : "classic";
    if (raw === "card-news") return ENABLE_CARD_NEWS_MODE ? raw : "classic";
    if (raw === "node") return ENABLE_NODE_MODE ? raw : "classic";
    if (raw === "assets") return raw;
    if (raw === "asset-gen") return raw;
    if (raw === "home") return raw;
    if (raw === "classic") return raw;
  } catch {}
  return "classic";
}

export function loadHistoryStripLayout(): HistoryStripLayout {
  try {
    const raw = localStorage.getItem(HISTORY_STRIP_LAYOUT_STORAGE_KEY);
    if (raw === "rail" || raw === "horizontal" || raw === "sidebar") return raw;
  } catch {}
  return "rail";
}

export function loadGalleryScope(key: string): GalleryScope {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "current-session" || raw === "all") return raw;
  } catch {}
  return "current-session";
}

export function loadCanvasExportBackground(): { mode: CanvasExportBackground; matteColor: HexColor } {
  if (typeof window === "undefined") return { mode: "alpha", matteColor: "#ffffff" };
  try {
    const raw = window.localStorage.getItem(CANVAS_EXPORT_BG_KEY);
    if (!raw) return { mode: "alpha", matteColor: "#ffffff" };
    const parsed = JSON.parse(raw) as Partial<{ mode: CanvasExportBackground; matteColor: string }>;
    const mode: CanvasExportBackground = parsed.mode === "matte" ? "matte" : "alpha";
    const matteColor: HexColor =
      typeof parsed.matteColor === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.matteColor)
        ? (parsed.matteColor as HexColor)
        : "#ffffff";
    return { mode, matteColor };
  } catch {
    return { mode: "alpha", matteColor: "#ffffff" };
  }
}

export function persistCanvasExportBackground(mode: CanvasExportBackground, matteColor: HexColor): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CANVAS_EXPORT_BG_KEY, JSON.stringify({ mode, matteColor }));
  } catch {
    /* ignore quota / unavailable */
  }
}

export function loadImageModel(): ImageModel {
  try {
    const raw = localStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
    if (isImageModel(raw)) return raw;
  } catch {}
  return DEFAULT_IMAGE_MODEL;
}

export function saveImageModel(model: ImageModel): void {
  try {
    localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, model);
  } catch {}
}

export function loadReasoningEffort(): ReasoningEffort {
  try {
    const raw = localStorage.getItem(REASONING_EFFORT_STORAGE_KEY);
    if (isReasoningEffort(raw)) return raw;
  } catch {}
  return DEFAULT_REASONING_EFFORT;
}

export function saveReasoningEffort(effort: ReasoningEffort): void {
  try {
    localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, effort);
  } catch {}
}

/**
 * Sparse by design: an absent key means the user never touched that field, so
 * it keeps following the operator's configured default rather than a compiled
 * constant. See devlog 260825_novelai_negative_prompt_settings/020.
 */
export function loadNaiOverrides(): NaiOptionOverrides {
  try {
    const raw = localStorage.getItem(NAI_OPTIONS_STORAGE_KEY);
    return raw ? coerceNaiOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Best-effort, like every other writer here: a quota failure is swallowed and
 *  the caller still updates in-memory state. */
export function saveNaiOverrides(overrides: NaiOptionOverrides): void {
  try {
    localStorage.setItem(NAI_OPTIONS_STORAGE_KEY, JSON.stringify(overrides));
  } catch {}
}

export function loadWebSearchEnabled(): boolean {
  try {
    const raw = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {}
  return DEFAULT_WEB_SEARCH_ENABLED;
}

export function saveWebSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(enabled));
  } catch {}
}

export type { VideoDefaults } from "./storeTypes";
import type { VideoDefaults } from "./storeTypes";

export const VIDEO_DEFAULTS_FALLBACK: VideoDefaults = { model: false, duration: 5, resolution: "480p", aspectRatio: "auto", singleRefMode: "image-to-video" };

export function loadVideoDefaults(): VideoDefaults {
  try {
    const raw = localStorage.getItem(VIDEO_DEFAULTS_STORAGE_KEY);
    if (!raw) return VIDEO_DEFAULTS_FALLBACK;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      model: normalizeVideoModelValue(p.model),
      duration: typeof p.duration === "number" ? p.duration : 5,
      resolution: p.resolution === "480p" || p.resolution === "720p" || p.resolution === "1080p" ? p.resolution : "480p",
      aspectRatio: typeof p.aspectRatio === "string" ? p.aspectRatio : "auto",
      singleRefMode: p.singleRefMode === "reference-to-video" ? "reference-to-video" : "image-to-video",
    };
  } catch {
    return VIDEO_DEFAULTS_FALLBACK;
  }
}

export function saveVideoDefaults(patch: Partial<VideoDefaults>): void {
  try {
    const current = loadVideoDefaults();
    localStorage.setItem(VIDEO_DEFAULTS_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

export function loadSelectedFilename(): string | null {
  try {
    const raw = localStorage.getItem(SELECTED_FILENAME_STORAGE_KEY);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveSelectedFilename(filename: string | null): void {
  try {
    if (filename) localStorage.setItem(SELECTED_FILENAME_STORAGE_KEY, filename);
    else localStorage.removeItem(SELECTED_FILENAME_STORAGE_KEY);
  } catch {}
}

export function loadActiveSessionId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_ID_STORAGE_KEY);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveActiveSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_ID_STORAGE_KEY, id);
    else localStorage.removeItem(ACTIVE_SESSION_ID_STORAGE_KEY);
  } catch {}
}

export function formatSize(w: number, h: number): string {
  return `${w}x${h}`;
}

export function normalizeCount(value: number): Count {
  return normalizeGenerationCount(value);
}

export const SIZE_PRESET_VALUES = new Set<SizePreset>([
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1360x1024",
  "1024x1360",
  "1824x1024",
  "1024x1824",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "3840x2160",
  "2160x3840",
  "auto",
  "custom",
]);

export function parseMetadataSize(size?: string | null): { preset?: SizePreset; w?: number; h?: number } {
  if (typeof size !== "string") return {};
  if (SIZE_PRESET_VALUES.has(size as SizePreset)) return { preset: size as SizePreset };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return {};
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return {};
  return { preset: "custom", w, h };
}

export function isQuality(value: unknown): value is Quality {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

export function isFormat(value: unknown): value is Format {
  return value === "png" || value === "jpeg" || value === "webp";
}

export function isModeration(value: unknown): value is Moderation {
  return value === "low" || value === "auto";
}

export function isProvider(value: unknown): value is Provider {
  return isCoreProviderId(value);
}

export function isPromptMode(value: unknown): value is "auto" | "direct" {
  return value === "auto" || value === "direct";
}

export function isSizePreset(value: unknown): value is SizePreset {
  return typeof value === "string" && SIZE_PRESET_VALUES.has(value as SizePreset);
}

export type { GenerationDefaults } from "./storeTypes";
import type { GenerationDefaults } from "./storeTypes";
import { normalizeMcpParameters, normalizeMcpRatio, normalizeMcpSelection, type McpSelection } from "../lib/mcpSelection";

export function loadGenerationDefaults(): GenerationDefaults {
  try {
    const raw = localStorage.getItem(GENERATION_DEFAULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: GenerationDefaults = {};
    if (isProvider(parsed.provider)) out.provider = parsed.provider;
    const mcpProvider = parsed.mcpProvider;
    const mcpModel = parsed.mcpModel;
    if (typeof mcpProvider === "string" || mcpProvider === null) {
      out.mcpProvider = mcpProvider as string | null;
    }
    if (typeof mcpModel === "string" || mcpModel === null) {
      out.mcpModel = mcpModel as string | null;
    }
    if (parsed.mcpMediaKind === "image" || parsed.mcpMediaKind === "video") {
      out.mcpMediaKind = parsed.mcpMediaKind;
    }
    // Comfy selections are runtime workflow ids, so they cannot live in the
    // generated ImageModel union and were the only lane whose choice did not
    // survive a reload — the provider came back and the workflow did not.
    if (typeof parsed.comfyWorkflow === "string" || parsed.comfyWorkflow === null) {
      out.comfyWorkflow = parsed.comfyWorkflow as string | null;
    }
    if (typeof parsed.comfyVideoWorkflow === "string" || parsed.comfyVideoWorkflow === null) {
      out.comfyVideoWorkflow = parsed.comfyVideoWorkflow as string | null;
    }
    if ("mcpRatio" in parsed) {
      out.mcpRatio = normalizeMcpRatio(parsed.mcpRatio);
    }
    if ("mcpParameters" in parsed) {
      out.mcpParameters = normalizeMcpParameters(parsed.mcpParameters);
    }
    if ("imageToolModel" in parsed) {
      out.imageToolModel = parsed.provider === "api" && isImageToolModel(parsed.imageToolModel) ? parsed.imageToolModel : null;
    }
    if (isQuality(parsed.quality)) out.quality = normalizeImageQuality(parsed.provider, out.imageToolModel, parsed.quality);
    if (isSizePreset(parsed.sizePreset)) out.sizePreset = parsed.sizePreset;
    if (typeof parsed.customW === "number" && Number.isFinite(parsed.customW)) {
      out.customW = parseRequestedCustomSide(parsed.customW, 1920);
    }
    if (typeof parsed.customH === "number" && Number.isFinite(parsed.customH)) {
      out.customH = parseRequestedCustomSide(parsed.customH, 1088);
    }
    if (isFormat(parsed.format)) out.format = parsed.format;
    if (isModeration(parsed.moderation)) out.moderation = parsed.moderation;
    if (typeof parsed.count === "number") out.count = normalizeCount(parsed.count);
    if (typeof parsed.multimode === "boolean") out.multimode = parsed.multimode;
    if (typeof parsed.multimodeMaxImages === "number") {
      out.multimodeMaxImages = normalizeCount(parsed.multimodeMaxImages);
    }
    if (isPromptMode(parsed.promptMode)) out.promptMode = parsed.promptMode;
    if (typeof parsed.prompt === "string") out.prompt = parsed.prompt;
    if (typeof parsed.negativePrompt === "string") out.negativePrompt = parsed.negativePrompt;
    const insertedPrompts = normalizeInsertedPromptArray(parsed.insertedPrompts);
    if (insertedPrompts) out.insertedPrompts = insertedPrompts;
    // presetIds is deliberately dropped on load. The preset grid was removed
    // from Home, so nothing can add or clear a selection anymore — a stored id
    // would keep prepending its fragment to every prompt with no UI to reveal
    // or remove it. Reading it back is the bug, so the read is what we delete.
    // Historical presetIds in generated-image XMP stay readable; that parser is
    // server-side and untouched.
    return out;
  } catch {
    return {};
  }
}

export function loadMcpSelection(): McpSelection {
  return normalizeMcpSelection(loadGenerationDefaults());
}

export function saveMcpSelection(
  provider: string | null,
  model: string | null,
  kind: "image" | "video" = "image",
): void {
  saveGenerationDefaultsPatch({ mcpProvider: provider, mcpModel: model, mcpMediaKind: kind });
}

export function saveGenerationDefaultsPatch(patch: GenerationDefaults): void {
  try {
    const current = loadGenerationDefaults();
    localStorage.setItem(
      GENERATION_DEFAULTS_STORAGE_KEY,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {}
}
