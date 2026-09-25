// config.js — centralized runtime configuration (0.09.12).
//
// Single source of truth for ports, limits, paths, and tunables. All server,
// lib, and script code should import `config` (or named legacy constants) from
// here rather than reading `process.env` directly.
//
// Priority: env var > ${IMA2_CONFIG_DIR}/config.json > built-in default.
// `config.json` is loaded once at module import. Mutating the file at runtime
// requires a server restart (same as env vars).
//
// Import only pure policy helpers from lib/*; never runtime owners that import config.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { parsePublicOrigins } from "./lib/localAccessPolicy.js";
export { SSE_STREAM_POLICY } from "./lib/eventsPolicy.js";
import { deriveSupportedImageModels, deriveUnsupportedImageModels } from "./lib/providers/derive.js";
import {
  DEFAULT_PROMPT_BUILDER_MODELS,
  PROMPT_BUILDER_BACKENDS,
  PROMPT_BUILDER_MODELS,
  type PromptBuilderBackend,
} from "./lib/promptBuilder/constants.js";

// 4.6 rewrites prompts in ways that read worse than 4.3 for this planner's job, which
// is judged by the result rather than a benchmark. 4.6 stays selectable below.
export const DEFAULT_GROK_PLANNER_MODEL = "grok-4.3";
export const AGY_PROCESS_POLICY = Object.freeze({ timeoutMs: 360_000, terminateGraceMs: 1000, maxOutputBytes: 1_048_576 });
export const AGY_ARTIFACT_POLICY = Object.freeze({ maxBytes: 52_428_800, chunkBytes: 65_536 });
/** Per-process API admission; streaming frames do not consume request slots. */
export const API_REQUEST_POLICY = Object.freeze({
  windowMs: 60_000, requests: 600, mutations: 120, maxPeers: 4096,
});
export const LAN_SECURITY_POLICY = Object.freeze({
  lanSessionTtlMs: 28_800_000, lanMaxSessions: 256,
  lanAuthWindowMs: 60_000, lanAuthMaxFailures: 10,
  lanAuthMaxBuckets: 4096, lanTokenMaxBytes: 4096,
});
export const GROK_PLANNER_MODELS = [
  DEFAULT_GROK_PLANNER_MODEL,
  "grok-4.6",
  "grok-4.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
] as const;

const env = process.env;
const packageRoot = dirname(fileURLToPath(import.meta.url));
const configDir = env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");

// ── Optional config.json layer ─────────────────────────────────────────
// Users can drop `${configDir}/config.json` to override defaults without
// setting env vars. Shape: same as the `config` object below (partial).
function loadConfigJson() {
  const candidates = [
    join(configDir, "config.json"),
    join(packageRoot, ".ima2", "config.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { values: parsed, source: p };
    } catch {
      // ignore malformed config.json; env+defaults still apply
    }
  }
  return { values: {}, source: null };
}
const loadedFileConfig = loadConfigJson();
const fileCfg = loadedFileConfig.values;
export const CONFIG_SOURCE_FILE = loadedFileConfig.source;
const publicOriginsEnv = env.IMA2_PUBLIC_ORIGINS;
const publicOriginsFile = fileCfg.server?.publicOrigins;

type Pickable = string | number | boolean | undefined;

function firstDefined(...vals: Pickable[]): Pickable {
  return vals.find((v) => v !== undefined && v !== "");
}
function pickInt(envVal: Pickable, fileVal: Pickable, fallback: number): number {
  const candidate = firstDefined(envVal, fileVal);
  if (candidate === undefined) return fallback;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : fallback;
}
function pickPositiveInt(envVal: Pickable, fileVal: Pickable, fallback: number): number {
  const n = pickInt(envVal, fileVal, fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function pickStr(envVal: Pickable, fileVal: Pickable, fallback: string): string {
  return (firstDefined(envVal, fileVal) ?? fallback) as string;
}
function pickBool(envVal: Pickable, fileVal: Pickable, fallback: boolean): boolean {
  const v = firstDefined(envVal, fileVal);
  if (v === undefined) return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function promptBuilderBackend(raw: string): PromptBuilderBackend {
  return PROMPT_BUILDER_BACKENDS.includes(raw as PromptBuilderBackend)
    ? raw as PromptBuilderBackend
    : "auto";
}

const selectedPromptBuilderBackend = promptBuilderBackend(
  pickStr(env.IMA2_PROMPT_BUILDER_BACKEND, fileCfg.promptBuilder?.backend, "auto"),
);
const selectedPromptBuilderModel = pickStr(
  env.IMA2_PROMPT_BUILDER_MODEL,
  fileCfg.promptBuilder?.model,
  DEFAULT_PROMPT_BUILDER_MODELS[selectedPromptBuilderBackend],
);

export function defaultLogLevelForEnv(runtimeEnv = env) {
  return runtimeEnv.IMA2_DEV === "1" ? "debug" : "info";
}

export const config = {
  security: LAN_SECURITY_POLICY,
  diagnostics: {
    keyTimeoutMs: Math.min(30000, pickPositiveInt(env.IMA2_DIAGNOSTIC_KEY_TIMEOUT_MS, fileCfg.diagnostics?.keyTimeoutMs, 5000)),
    runtimeTimeoutMs: Math.min(30000, pickPositiveInt(env.IMA2_DIAGNOSTIC_RUNTIME_TIMEOUT_MS, fileCfg.diagnostics?.runtimeTimeoutMs, 1500)),
  },
  server: {
    // Accept both IMA2_PORT and legacy PORT.
    port: pickInt(firstDefined(env.IMA2_PORT, env.PORT), fileCfg.server?.port, 3333),
    host: pickStr(env.IMA2_HOST, fileCfg.server?.host, "127.0.0.1"),
    lanToken: env.IMA2_LAN_TOKEN || "",
    // Lazy validation permits config rm to repair a bad file-layer value.
    // Access policy snapshots this before listening; inputs stay import-time fixed.
    get publicOrigins(): readonly string[] {
      try {
        return parsePublicOrigins(publicOriginsEnv === undefined
          ? (publicOriginsFile === undefined ? [] : publicOriginsFile) : JSON.parse(publicOriginsEnv));
      } catch {
        throw Object.assign(new Error("IMA2_PUBLIC_ORIGINS must be an array of exact HTTP(S) origins."), {
          code: "INVALID_PUBLIC_ORIGINS", status: 400,
        });
      }
    },
    bodyLimit: pickStr(env.IMA2_BODY_LIMIT, fileCfg.server?.bodyLimit, "50mb"),
  },
  limits: {
    maxRefB64Bytes: pickInt(env.IMA2_MAX_REF_B64_BYTES, fileCfg.limits?.maxRefB64Bytes, 7 * 1024 * 1024),
    maxMetadataReadB64Bytes: pickInt(
      env.IMA2_MAX_METADATA_READ_B64_BYTES,
      fileCfg.limits?.maxMetadataReadB64Bytes,
      12 * 1024 * 1024,
    ),
    maxRefCount: pickInt(env.IMA2_MAX_REF_COUNT, fileCfg.limits?.maxRefCount, 5),
    maxGeneratedImages: pickInt(env.IMA2_MAX_GENERATED_IMAGES, fileCfg.limits?.maxGeneratedImages, 24),
    maxParallel: pickInt(env.IMA2_MAX_PARALLEL, fileCfg.limits?.maxParallel, 24),
    graphMaxNodes: pickInt(env.IMA2_GRAPH_MAX_NODES, fileCfg.limits?.graphMaxNodes, 500),
    graphMaxEdges: pickInt(env.IMA2_GRAPH_MAX_EDGES, fileCfg.limits?.graphMaxEdges, 1000),
    promptImportMaxFileBytes: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_FILE_BYTES,
      fileCfg.limits?.promptImportMaxFileBytes,
      512 * 1024,
    ),
    promptImportMaxCandidatesPerFile: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_CANDIDATES_PER_FILE,
      fileCfg.limits?.promptImportMaxCandidatesPerFile,
      100,
    ),
    promptImportMaxCandidatesPerImport: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_CANDIDATES_PER_IMPORT,
      fileCfg.limits?.promptImportMaxCandidatesPerImport,
      100,
    ),
    promptImportFetchTimeoutMs: pickInt(
      env.IMA2_PROMPT_IMPORT_FETCH_TIMEOUT_MS,
      fileCfg.limits?.promptImportFetchTimeoutMs,
      8000,
    ),
    promptImportMaxCandidateChars: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_CANDIDATE_CHARS,
      fileCfg.limits?.promptImportMaxCandidateChars,
      12000,
    ),
    promptImportMinCandidateChars: pickInt(
      env.IMA2_PROMPT_IMPORT_MIN_CANDIDATE_CHARS,
      fileCfg.limits?.promptImportMinCandidateChars,
      40,
    ),
    promptImportMaxSourceCharsScanned: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_SOURCE_CHARS_SCANNED,
      fileCfg.limits?.promptImportMaxSourceCharsScanned,
      512 * 1024,
    ),
    promptImportMaxRepoIndexFiles: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_REPO_INDEX_FILES,
      fileCfg.limits?.promptImportMaxRepoIndexFiles,
      500,
    ),
    promptImportCuratedSearchLimit: pickInt(
      env.IMA2_PROMPT_IMPORT_CURATED_SEARCH_LIMIT,
      fileCfg.limits?.promptImportCuratedSearchLimit,
      50,
    ),
    promptImportIndexCacheTtlMs: pickInt(
      env.IMA2_PROMPT_IMPORT_INDEX_CACHE_TTL_MS,
      fileCfg.limits?.promptImportIndexCacheTtlMs,
      24 * 60 * 60 * 1000,
    ),
    promptImportMaxFolderFiles: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_FOLDER_FILES,
      fileCfg.limits?.promptImportMaxFolderFiles,
      100,
    ),
    promptImportMaxFolderPreviewFiles: pickInt(
      env.IMA2_PROMPT_IMPORT_MAX_FOLDER_PREVIEW_FILES,
      fileCfg.limits?.promptImportMaxFolderPreviewFiles,
      20,
    ),
    promptImportDiscoverySearchLimit: pickInt(
      env.IMA2_PROMPT_IMPORT_DISCOVERY_SEARCH_LIMIT,
      fileCfg.limits?.promptImportDiscoverySearchLimit,
      20,
    ),
    promptImportDiscoveryCacheTtlMs: pickInt(
      env.IMA2_PROMPT_IMPORT_DISCOVERY_CACHE_TTL_MS,
      fileCfg.limits?.promptImportDiscoveryCacheTtlMs,
      60 * 60 * 1000,
    ),
    promptImportDiscoveryMaxQueries: pickInt(
      env.IMA2_PROMPT_IMPORT_DISCOVERY_MAX_QUERIES,
      fileCfg.limits?.promptImportDiscoveryMaxQueries,
      5,
    ),
  },
  history: {
    defaultPageSize: pickInt(
      env.IMA2_HISTORY_PAGE_SIZE,
      fileCfg.history?.defaultPageSize ?? fileCfg.limits?.historyDefaultPageSize,
      50,
    ),
    maxPageCap: pickInt(
      env.IMA2_HISTORY_MAX_PAGE,
      fileCfg.history?.maxPageCap ?? fileCfg.limits?.historyMaxPageCap,
      500,
    ),
  },
  oauth: {
    // Accept both IMA2_OAUTH_PROXY_PORT and legacy OAUTH_PORT.
    proxyPort: pickInt(firstDefined(env.IMA2_OAUTH_PROXY_PORT, env.OAUTH_PORT), fileCfg.oauth?.proxyPort, 10531),
    // IMA2_NO_OAUTH_PROXY=1 disables auto-start; default is auto-start enabled.
    autoStart: !pickBool(env.IMA2_NO_OAUTH_PROXY, fileCfg.oauth?.disableAutoStart, false),
    // GPT OAuth calls the Codex backend directly (lib/codexBackend). The base URL and client
    // version are overridable for tests and for pinning a Codex build; the version otherwise
    // follows the latest published @openai/codex, which gates the model roster.
    codexBaseUrl: pickStr(env.IMA2_CODEX_BASE_URL, fileCfg.oauth?.codexBaseUrl, "https://chatgpt.com/backend-api/codex"),
    codexClientVersion: pickStr(env.IMA2_CODEX_CLIENT_VERSION, fileCfg.oauth?.codexClientVersion, ""),
    statusTimeoutMs: pickInt(env.IMA2_OAUTH_STATUS_TIMEOUT_MS, fileCfg.oauth?.statusTimeoutMs, 3000),
    generationTimeoutMs: pickInt(
      env.IMA2_OAUTH_GENERATION_TIMEOUT_MS,
      fileCfg.oauth?.generationTimeoutMs,
      400 * 1000,
    ),
    restartDelayMs: pickInt(env.IMA2_OAUTH_RESTART_DELAY_MS, fileCfg.oauth?.restartDelayMs, 5000),
    // Provider-backed masked edit is off until upstream STEP-0 verification is recorded.
    maskedEditEnabled: pickBool(
      env.IMA2_OAUTH_MASKED_EDIT_ENABLED,
      fileCfg.oauth?.maskedEditEnabled,
      false,
    ),
    forceImageToolChoice: pickBool(
      env.IMA2_OAUTH_FORCE_IMAGE_TOOL_CHOICE,
      fileCfg.oauth?.forceImageToolChoice,
      true,
    ),
    researchSuffix: pickStr(
      env.IMA2_RESEARCH_SUFFIX,
      fileCfg.oauth?.researchSuffix,
      "\n\nIf factual visual accuracy is required and the user's prompt or attached visual context is not already sufficient, use at least one concise web_search call for references before generating. If the user's prompt is already visually sufficient, do not search, rewrite, translate, summarize, or add clarifiers; pass the user's prompt through as the image_generation prompt argument.",
    ),
    validModeration: new Set(
      Array.isArray(fileCfg.oauth?.validModeration) && fileCfg.oauth.validModeration.length
        ? fileCfg.oauth.validModeration
        : ["auto", "low"],
    ),
  },
  promptBuilder: {
    backend: selectedPromptBuilderBackend,
    model: PROMPT_BUILDER_MODELS[selectedPromptBuilderBackend].includes(selectedPromptBuilderModel)
      ? selectedPromptBuilderModel
      : DEFAULT_PROMPT_BUILDER_MODELS[selectedPromptBuilderBackend],
  },
  github: {
    token: pickStr(env.IMA2_GITHUB_TOKEN, fileCfg.github?.token, ""),
  },
  mcp: {
    // Remote MCP provider connections (030 WP3). Ids must exist in the compiled
    // provider registry (lib/mcp/providerRegistry.ts); this is an enable list,
    // not an arbitrary endpoint connector.
    enabledProviders: (pickStr(env.IMA2_MCP_PROVIDERS, Array.isArray(fileCfg.mcp?.enabledProviders) ? fileCfg.mcp.enabledProviders.join(",") : undefined, "runway,higgsfield"))
      .split(",").map((s: string) => s.trim()).filter(Boolean),
    tokenDir: pickStr(env.IMA2_MCP_TOKEN_DIR, fileCfg.mcp?.tokenDir, join(configDir, "mcp")),
    snapshotDir: pickStr(env.IMA2_MCP_SNAPSHOT_DIR, fileCfg.mcp?.snapshotDir, join(configDir, "mcp", "snapshots")),
  },
  storage: {
    configDir,
    packageRoot,
    generatedDir: pickStr(env.IMA2_GENERATED_DIR, fileCfg.storage?.generatedDir, join(configDir, "generated")),
    trashDir: pickStr(env.IMA2_TRASH_DIR, fileCfg.storage?.trashDir, join(configDir, "generated", ".trash")),
    generatedDirName: pickStr(env.IMA2_GENERATED_DIRNAME, fileCfg.storage?.generatedDirName, "generated"),
    trashDirName: pickStr(env.IMA2_TRASH_DIRNAME, fileCfg.storage?.trashDirName, ".trash"),
    dbPath: pickStr(env.IMA2_DB_PATH, fileCfg.storage?.dbPath, join(configDir, "sessions.db")),
    promptImportIndexCacheFile: pickStr(
      env.IMA2_PROMPT_IMPORT_INDEX_CACHE_FILE,
      fileCfg.storage?.promptImportIndexCacheFile,
      join(configDir, "prompt-import-index.json"),
    ),
    promptImportDiscoveryRegistryFile: pickStr(
      env.IMA2_PROMPT_IMPORT_DISCOVERY_REGISTRY_FILE,
      fileCfg.storage?.promptImportDiscoveryRegistryFile,
      join(configDir, "prompt-import-discovery.json"),
    ),
    configFile: join(configDir, "config.json"),
    advertiseFile: pickStr(env.IMA2_ADVERTISE_FILE, fileCfg.storage?.advertiseFile, join(configDir, "server.json")),
    generationRequestLogFile: pickStr(
      env.IMA2_GENERATION_REQUEST_LOG_FILE,
      fileCfg.storage?.generationRequestLogFile,
      join(configDir, "generation-request-log.json"),
    ),
    staticMaxAge: pickStr(env.IMA2_STATIC_MAX_AGE, fileCfg.storage?.staticMaxAge, "1y"),
  },
  ids: {
    generatedHexBytes: pickInt(env.IMA2_GENERATED_HEX_BYTES, fileCfg.ids?.generatedHexBytes, 4),
    nodeHexBytes: pickInt(env.IMA2_NODE_HEX_BYTES, fileCfg.ids?.nodeHexBytes, 5),
  },
  inflight: {
    // Must exceed the longest legal request. Grok video can legitimately run ~70 min
    // (planning + start + poll + poll overshoot + download), and purgeStaleJobs() drops the
    // job row without aborting its worker, so a 10-minute TTL used to erase live jobs
    // mid-flight.
    // devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
    ttlMs: pickInt(env.IMA2_INFLIGHT_TTL_MS, fileCfg.inflight?.ttlMs, 90 * 60 * 1000),
    reapMs: pickInt(env.IMA2_INFLIGHT_REAP_MS, fileCfg.inflight?.reapMs, 60 * 1000),
    terminalTtlMs: pickInt(env.IMA2_INFLIGHT_TERMINAL_TTL_MS, fileCfg.inflight?.terminalTtlMs, 5 * 60 * 1000),
  },
  trash: {
    ttlMs: pickInt(env.IMA2_TRASH_TTL_MS, fileCfg.trash?.ttlMs, 10_000),
  },
  styleSheet: {
    maxPrefix: pickInt(env.IMA2_STYLE_SHEET_MAX_PREFIX, fileCfg.styleSheet?.maxPrefix, 4000),
    model: pickStr(env.IMA2_STYLE_MODEL, fileCfg.styleSheet?.model, "gpt-5.6-luna"),
  },
  imageModels: {
    default: pickStr(env.IMA2_IMAGE_MODEL_DEFAULT, fileCfg.imageModels?.default, "gpt-5.6-luna"),
    valid: deriveSupportedImageModels("oauth"),
    unsupported: deriveUnsupportedImageModels(),
    reasoningEffort: pickStr(
      env.IMA2_REASONING_EFFORT,
      fileCfg.imageModels?.reasoningEffort,
      "medium",
    ),
    validReasoningEfforts: new Set(["none", "low", "medium", "high", "xhigh", "max"]),
  },
  apiProvider: {
    defaultImageModel: pickStr(
      env.IMA2_API_IMAGE_MODEL_DEFAULT,
      fileCfg.apiProvider?.defaultImageModel,
      "gpt-5.6-luna",
    ),
    defaultReasoningEffort: pickStr(
      env.IMA2_API_REASONING_EFFORT,
      fileCfg.apiProvider?.defaultReasoningEffort,
      "low",
    ),
    defaultSize: pickStr(env.IMA2_API_IMAGE_SIZE, fileCfg.apiProvider?.defaultSize, "1024x1024"),
    allowWebSearch: pickBool(env.IMA2_API_ALLOW_WEB_SEARCH, fileCfg.apiProvider?.allowWebSearch, true),
  },
  grokProvider: {
    plannerModel: pickStr(env.IMA2_GROK_PLANNER_MODEL, fileCfg.grokProvider?.plannerModel, DEFAULT_GROK_PLANNER_MODEL),
    // Measured 260817: the forced web_search brief takes 70-73 s idle / 44-79 s concurrent,
    // and the planner tool call 9-32 s idle / 28-41 s concurrent. But the reported failure
    // was a planner call that STALLED for its entire 300 s budget while an isolated probe
    // of the same payload answered in 32 s. Budgets are therefore calibrated against the
    // stall, not the probe: 900 s is 3x the observed stall.
    // devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
    plannerTimeoutMs: pickInt(env.IMA2_GROK_PLANNER_TIMEOUT_MS, fileCfg.grokProvider?.plannerTimeoutMs, 900_000),
    // The web-search brief gets its own bound: it is an enhancement, not a requirement, so
    // it degrades instead of failing the request (lib/grokVideoAdapter.ts).
    searchTimeoutMs: pickInt(env.IMA2_GROK_SEARCH_TIMEOUT_MS, fileCfg.grokProvider?.searchTimeoutMs, 300_000),
    // Wired ceiling on search + planner combined, so the two stages cannot sum unbounded.
    // It must be STRICTLY greater than searchTimeoutMs + plannerTimeoutMs (invariant enforced
    // by tests): if it equals the sum, a slow search followed by a stalled planner lands both
    // timers together, the phase ceiling wins the race, and the local planner fallback never
    // runs. The margin exists so the planner's own timeout always fires first.
    videoPlanTotalTimeoutMs: pickInt(env.IMA2_GROK_VIDEO_PLAN_TOTAL_TIMEOUT_MS, fileCfg.grokProvider?.videoPlanTotalTimeoutMs, 1_500_000),
    defaultImageModel: pickStr(env.IMA2_GROK_IMAGE_MODEL_DEFAULT, fileCfg.grokProvider?.defaultImageModel, "grok-imagine-image-2.0"),
    // grok-imagine-image-2.0 measured 43-97 s per image; 2k/batch requests run longer,
    // so the image call gets the same generous 300 s ceiling as the planner.
    generationTimeoutMs: pickInt(env.IMA2_GROK_GENERATION_TIMEOUT_MS, fileCfg.grokProvider?.generationTimeoutMs, 300_000),
    statusTimeoutMs: pickInt(env.IMA2_GROK_STATUS_TIMEOUT_MS, fileCfg.grokProvider?.statusTimeoutMs, 3000),
    defaultVideoModel: pickStr(env.IMA2_GROK_VIDEO_MODEL_DEFAULT, fileCfg.grokProvider?.defaultVideoModel, "grok-imagine-video-1.5"),
    videoStartTimeoutMs: pickInt(env.IMA2_GROK_VIDEO_START_TIMEOUT_MS, fileCfg.grokProvider?.videoStartTimeoutMs, 300_000),
    videoPollIntervalMs: pickInt(env.IMA2_GROK_VIDEO_POLL_INTERVAL_MS, fileCfg.grokProvider?.videoPollIntervalMs, 5_000),
    videoPollMaxConsecutiveErrors: pickInt(env.IMA2_GROK_VIDEO_POLL_MAX_ERRORS, fileCfg.grokProvider?.videoPollMaxConsecutiveErrors, 5),
    videoTimeoutMs: pickInt(env.IMA2_GROK_VIDEO_TIMEOUT_MS, fileCfg.grokProvider?.videoTimeoutMs, 1_800_000),
    videoDownloadTimeoutMs: pickInt(env.IMA2_GROK_VIDEO_DOWNLOAD_TIMEOUT_MS, fileCfg.grokProvider?.videoDownloadTimeoutMs, 300_000),
  },
  // Direct MiniMax image-generation provider (text-to-image / image-to-image).
  // Region selects the global (.io) or China (.minimaxi.com) OpenAI-compatible
  // base URL; the regional fields are shared with the MiniMax text endpoints.
  minimaxProvider: {
    defaultImageModel: pickStr(env.IMA2_MINIMAX_IMAGE_MODEL_DEFAULT, fileCfg.minimaxProvider?.defaultImageModel, "image-01"),
    region: pickStr(env.IMA2_MINIMAX_REGION, fileCfg.minimaxProvider?.region, "global_en"),
    globalBaseUrl: pickStr(env.IMA2_MINIMAX_GLOBAL_BASE_URL, fileCfg.minimaxProvider?.globalBaseUrl, "https://api.minimax.io/v1"),
    cnBaseUrl: pickStr(env.IMA2_MINIMAX_CN_BASE_URL, fileCfg.minimaxProvider?.cnBaseUrl, "https://api.minimaxi.com/v1"),
    generationTimeoutMs: pickInt(env.IMA2_MINIMAX_GENERATION_TIMEOUT_MS, fileCfg.minimaxProvider?.generationTimeoutMs, 120_000),
  },
  // Direct NovelAI image-generation provider. Generation lives on the image
  // host; account/subscription and key validation live on the api host, so a
  // key check never spends Anlas.
  naiProvider: {
    defaultImageModel: pickStr(env.IMA2_NAI_IMAGE_MODEL_DEFAULT, fileCfg.naiProvider?.defaultImageModel, "nai-diffusion-5-full"),
    baseUrl: pickStr(env.IMA2_NAI_BASE_URL, fileCfg.naiProvider?.baseUrl, "https://image.novelai.net"),
    // Same host as generation: NovelAI migrated /user/* onto the image host.
    accountBaseUrl: pickStr(env.IMA2_NAI_ACCOUNT_BASE_URL, fileCfg.naiProvider?.accountBaseUrl, "https://image.novelai.net"),
    generationTimeoutMs: pickInt(env.IMA2_NAI_GENERATION_TIMEOUT_MS, fileCfg.naiProvider?.generationTimeoutMs, 180_000),
    // 23 matches the reference client's V4.5/V5 preset and stays under the
    // Opus free-tier ceiling of 28 steps.
    defaultSteps: pickInt(env.IMA2_NAI_DEFAULT_STEPS, fileCfg.naiProvider?.defaultSteps, 23),
    defaultScale: pickInt(env.IMA2_NAI_DEFAULT_SCALE, fileCfg.naiProvider?.defaultScale, 5),
    defaultSampler: pickStr(env.IMA2_NAI_DEFAULT_SAMPLER, fileCfg.naiProvider?.defaultSampler, "k_euler_ancestral"),
    defaultNoiseSchedule: pickStr(env.IMA2_NAI_DEFAULT_NOISE_SCHEDULE, fileCfg.naiProvider?.defaultNoiseSchedule, "karras"),
    defaultAutoSmea: pickBool(env.IMA2_NAI_DEFAULT_AUTO_SMEA, fileCfg.naiProvider?.defaultAutoSmea, false),
    defaultDecrisper: pickBool(env.IMA2_NAI_DEFAULT_DECRISPER, fileCfg.naiProvider?.defaultDecrisper, false),
  },
  log: {
    level: pickStr(env.IMA2_LOG_LEVEL, fileCfg.log?.level, defaultLogLevelForEnv(env)),
    pretty: env.NODE_ENV !== "production",
  },
  features: {
    cardNews: pickBool(env.IMA2_CARD_NEWS, fileCfg.features?.cardNews, env.IMA2_DEV === "1"),
  },
  cardNewsPlanner: {
    enabled: pickBool(env.IMA2_CARD_NEWS_PLANNER, fileCfg.cardNewsPlanner?.enabled, true),
    model: pickStr(env.IMA2_CARD_NEWS_PLANNER_MODEL, fileCfg.cardNewsPlanner?.model, "gpt-5.6-luna"),
    timeoutMs: pickInt(env.IMA2_CARD_NEWS_PLANNER_TIMEOUT_MS, fileCfg.cardNewsPlanner?.timeoutMs, 60_000),
    deterministicFallback: pickBool(
      env.IMA2_CARD_NEWS_PLANNER_FALLBACK,
      fileCfg.cardNewsPlanner?.deterministicFallback,
      false,
    ),
  },
  agentPlanner: {
    enabled: pickBool(env.IMA2_AGENT_PLANNER_ENABLED, fileCfg.agentPlanner?.enabled, true),
    timeoutMs: pickInt(env.IMA2_AGENT_PLANNER_TIMEOUT_MS, fileCfg.agentPlanner?.timeoutMs, 30_000),
  },
  comfy: {
    defaultUrl: pickStr(env.IMA2_COMFY_URL, fileCfg.comfy?.defaultUrl, "http://127.0.0.1:8188"),
    uploadTimeoutMs: pickPositiveInt(
      env.IMA2_COMFY_UPLOAD_TIMEOUT_MS,
      fileCfg.comfy?.uploadTimeoutMs,
      30_000,
    ),
    maxUploadBytes: pickPositiveInt(
      env.IMA2_COMFY_MAX_UPLOAD_BYTES,
      fileCfg.comfy?.maxUploadBytes,
      50 * 1024 * 1024,
    ),
    // Health probe. Short by design: a settings surface listing workflows
    // across two instances must not stall on the dead one.
    healthTimeoutMs: pickPositiveInt(
      env.IMA2_COMFY_HEALTH_TIMEOUT_MS,
      fileCfg.comfy?.healthTimeoutMs,
      2_000,
    ),
    pollIntervalMs: pickPositiveInt(
      env.IMA2_COMFY_POLL_INTERVAL_MS,
      fileCfg.comfy?.pollIntervalMs,
      1_000,
    ),
    // Whole-job ceiling including queue wait. Local GPU queues run long.
    generationTimeoutMs: pickPositiveInt(
      env.IMA2_COMFY_GENERATION_TIMEOUT_MS,
      fileCfg.comfy?.generationTimeoutMs,
      1_800_000,
    ),
    maxDownloadBytes: pickPositiveInt(
      env.IMA2_COMFY_MAX_DOWNLOAD_BYTES,
      fileCfg.comfy?.maxDownloadBytes,
      100 * 1024 * 1024,
    ),
  },
  dev: {
    viteDevMode: pickBool(env.VITE_IMA2_DEV, fileCfg.dev?.viteDevMode, false),
  },
};

export default config;

// ── Backward-compatible flat re-exports (used by lib/inflight.js & earlier
//    call sites). Prefer `import { config } from "./config.js"` going forward.
export const PORT = config.server.port;
export const OAUTH_PORT = config.oauth.proxyPort;
export const OAUTH_URL = `http://127.0.0.1:${config.oauth.proxyPort}`;
export const CONFIG_DIR = config.storage.configDir;
export const CONFIG_FILE = config.storage.configFile;
export const ADVERTISE_FILE = config.storage.advertiseFile;
export const DB_FILE = config.storage.dbPath;
export const GENERATED_DIR = config.storage.generatedDir;
export const BODY_LIMIT = config.server.bodyLimit;
export const MAX_REF_B64_BYTES = config.limits.maxRefB64Bytes;
export const MAX_REFS = config.limits.maxRefCount;
export const MAX_GENERATED_IMAGES = config.limits.maxGeneratedImages;
export const MAX_N = config.limits.maxParallel;
export const INFLIGHT_TTL_MS = config.inflight.ttlMs;
export const INFLIGHT_REAP_MS = config.inflight.reapMs;
export const INFLIGHT_TERMINAL_TTL_MS = config.inflight.terminalTtlMs;
export const STYLE_SHEET_MAX_PREFIX = config.styleSheet.maxPrefix;
export const LOG_LEVEL = config.log.level;
export const NO_OAUTH_PROXY = !config.oauth.autoStart;
export const DEV_MODE = config.dev.viteDevMode;
export const CARD_NEWS_ENABLED = config.features.cardNews;
