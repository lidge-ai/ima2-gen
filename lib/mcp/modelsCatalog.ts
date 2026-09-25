// Provider model catalog resolver (040, devlog/_fin/260716_mcp-model-surface-ui).
// Runway models come from the verified contract enums (static adapter data);
// Higgsfield models come from the read-only `models_explore` tool — the ONLY
// upstream tool this module may ever call (READONLY_CATALOG_TOOL). Nothing in
// a request can influence the tool name (audit R1-3). Billing tools stay
// denied at the adapter layer; this module never touches them.
import { RUNWAY_MODEL_CATALOG } from "./adapters/runway.js";
import {
  isMcpPresetValue,
  type McpModelCapabilities,
  type McpModelEntry,
  type McpModelParameter,
  type McpParameterType,
  type McpPresetValue,
} from "./modelCapabilities.js";

export type { McpModelEntry, McpModelCapabilities, McpModelParameter, McpPresetValue } from "./modelCapabilities.js";
export type McpProviderModels = { image: McpModelEntry[]; video: McpModelEntry[] };

/** Sole upstream tool this resolver is allowed to call. Read-only, no credits. */
export const READONLY_CATALOG_TOOL = "models_explore";

/** Pagination bounds per kind (audit R1-5). */
const MAX_PAGES_PER_KIND = 3;
const MAX_ITEMS_PER_KIND = 300;
const PAGE_LIMIT = 100;
/** Catalog calls are interactive; do not inherit the 120s callTool default (R1-4). */
const CATALOG_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type CatalogToolCaller = (
  provider: string,
  name: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
) => Promise<Record<string, unknown>>;

function boundedText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .slice(0, maxItems)
    .filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= maxLength))];
}

function parameterType(value: unknown): McpParameterType | null {
  if (value === "bool" || value === "boolean") return "boolean";
  if (value === "string" || value === "number" || value === "string_array") return value;
  return null;
}

function presetOptions(value: unknown): McpPresetValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.slice(0, 50).filter(isMcpPresetValue);
  return options.length > 0 ? [...new Set(options)] : undefined;
}

function parseParameter(value: unknown): McpModelParameter | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = boundedText(record.name, 64);
  const type = parameterType(record.type);
  if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || !type) return null;
  const min = typeof record.min === "number" && Number.isFinite(record.min) ? record.min : undefined;
  const max = typeof record.max === "number" && Number.isFinite(record.max) ? record.max : undefined;
  const defaultValue = isMcpPresetValue(record.default) ? record.default : undefined;
  return {
    name, type,
    ...(record.required === true || record.required === "required" ? { required: true } : {}),
    ...(boundedText(record.description, 500) ? { description: boundedText(record.description, 500) } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(presetOptions(record.options) ? { options: presetOptions(record.options) } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function syntheticDuration(record: Record<string, unknown>): McpModelParameter | null {
  const durations = Array.isArray(record.durations)
    ? record.durations.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(0, 50)
    : [];
  if (durations.length > 0) return { name: "duration", type: "number", options: durations };
  const range = record.duration_range;
  if (!range || typeof range !== "object") return null;
  const min = (range as Record<string, unknown>).min;
  const max = (range as Record<string, unknown>).max;
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { name: "duration", type: "number", min, max };
}

// Provider media-role names project to ima2's canonical input-role vocabulary —
// the same shape the runway static catalog emits. Higgsfield's generic media
// roles are *_references; `text` is implied for every model since medias are
// optional inputs and a prompt always applies (optional only for
// marketing_studio_*), never a declared requirement.
const INPUT_ROLE_CANONICAL: Record<string, string> = {
  image: "image_references",
  video: "video_references",
  audio: "audio_references",
};

function parseCapabilities(record: Record<string, unknown>): McpModelCapabilities {
  const parameters = Array.isArray(record.parameters)
    ? record.parameters.slice(0, 100).map(parseParameter).filter((item): item is McpModelParameter => Boolean(item))
    : [];
  const duration = syntheticDuration(record);
  if (duration && !parameters.some((parameter) => parameter.name === "duration")) parameters.push(duration);
  const mediaItems = Array.isArray(record.medias) ? record.medias.slice(0, 50) : [];
  const declared = boundedStrings(mediaItems.flatMap((item) => (
    item && typeof item === "object" ? (item as { roles?: unknown | undefined }).roles ?? [] : []
  )), 100, 64);
  const inputRoles = [...new Set(["text", ...declared.map((role) => INPUT_ROLE_CANONICAL[role] ?? role)])];
  return {
    source: "provider-declared",
    aspectRatios: boundedStrings(record.aspect_ratios, 50, 24),
    parameters,
    inputRoles,
  };
}

/** Projects bounded models_explore facts without dropping provider presets. */
export function parseModelsExploreItems(result: Record<string, unknown>): McpModelEntry[] {
  const structured = (result as { structuredContent?: { items?: unknown | undefined } }).structuredContent;
  const items = Array.isArray(structured?.items) ? structured.items : [];
  const entries: McpModelEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = boundedText(record.id, 128);
    if (!id) continue;
    entries.push({
      id,
      label: boundedText(record.name, 160) ?? id,
      ...(boundedText(record.description, 500)
        ? { description: boundedText(record.description, 500) }
        : {}),
      capabilities: parseCapabilities(record),
    });
  }
  return entries;
}

function nextCursor(result: Record<string, unknown>): string | null {
  const structured = (result as {
    structuredContent?: { has_more?: unknown | undefined; next_page_token?: unknown | undefined };
  }).structuredContent;
  if (!structured || structured.has_more !== true) return null;
  return typeof structured.next_page_token === "string" && structured.next_page_token
    ? structured.next_page_token
    : null;
}

async function listHiggsfieldKind(
  callTool: CatalogToolCaller,
  kind: "image" | "video",
  options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
): Promise<McpModelEntry[]> {
  const seen = new Set<string>();
  const entries: McpModelEntry[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_KIND; page += 1) {
    const result = await callTool(
      "higgsfield",
      READONLY_CATALOG_TOOL,
      { action: "list", type: kind, limit: PAGE_LIMIT, ...(after ? { after } : {}) },
      { signal: options.signal, timeoutMs: options.timeoutMs ?? CATALOG_TIMEOUT_MS },
    );
    for (const entry of parseModelsExploreItems(result)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
      if (entries.length >= MAX_ITEMS_PER_KIND) return entries;
    }
    const cursor = nextCursor(result);
    if (!cursor || cursor === after) break; // repeated/absent cursor guard (R1-5)
    after = cursor;
  }
  return entries;
}

const cache = new Map<string, { at: number; models: McpProviderModels }>();

/** Test-only: clears the module cache. */
export function clearModelsCatalogCache(): void {
  cache.clear();
}

function cloneEntries(entries: readonly McpModelEntry[]): McpModelEntry[] {
  return entries.map((entry) => ({
    ...entry,
    capabilities: {
      ...entry.capabilities,
      aspectRatios: [...entry.capabilities.aspectRatios],
      parameters: entry.capabilities.parameters.map((parameter) => ({
        ...parameter,
        ...(parameter.options ? { options: [...parameter.options] } : {}),
      })),
      inputRoles: [...entry.capabilities.inputRoles],
    },
  }));
}

export async function getProviderModels(
  provider: string,
  callTool: CatalogToolCaller,
  options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {},
): Promise<McpProviderModels> {
  if (provider === "runway") {
    return {
      image: cloneEntries(RUNWAY_MODEL_CATALOG.image),
      video: cloneEntries(RUNWAY_MODEL_CATALOG.video),
    };
  }
  if (provider !== "higgsfield") throw new Error("MCP_PROVIDER_UNKNOWN");
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.models;
  const [image, video] = await Promise.all([
    listHiggsfieldKind(callTool, "image", options),
    listHiggsfieldKind(callTool, "video", options),
  ]);
  const models: McpProviderModels = { image, video };
  cache.set(provider, { at: Date.now(), models }); // successes only; errors threw above
  return models;
}
