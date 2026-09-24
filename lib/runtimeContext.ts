import type OpenAI from "openai";
import { config as runtimeConfigDefault } from "../config.js";
import type { McpConnectionManager } from "./mcp/connectionManager.js";
import type { ComfyWorkflowRecord } from "./comfyWorkflowStore.js";

export type AppConfig = typeof runtimeConfigDefault;
export type ApiKeySource = "env" | "oauth" | "config" | "none" | undefined;
export type OAuthReadyState = "starting" | "ready" | "failed" | "disabled" | undefined;

export interface RuntimeContext {
  apiKey: string | undefined;
  apiKeySource: ApiKeySource;
  /**
   * Boot-generated shared secret for the local admin surface (POST
   * /api/admin/stop). Published in the advertise file so only processes that
   * can read ~/.ima2/server.json can stop the server; generated ONCE at boot
   * (advertise() re-runs when the OAuth proxy reports readiness and must not
   * rotate it).
   */
  adminNonce: string;
  config: AppConfig;
  /**
   * Directory whose `.progrok/auth.json` holds the xAI OAuth session. Tests inject an
   * isolated HOME here; production leaves it undefined and lib/xaiAuth.ts uses os.homedir().
   */
  grokAuthHomeDir?: string | undefined;
  hasApiKey: boolean;
  oauthActualPort: number | undefined;
  oauthPort: number;
  oauthReadyPromise: Promise<void> | null;
  oauthReadyState: OAuthReadyState;
  oauthUrl: string;
  /**
   * Respawn the GPT OAuth proxy so it reads the current session file. Set by server.ts once
   * the proxy launcher exists; undefined in tests and when the proxy is not auto-started.
   */
  restartOAuthProxy?: (() => { restarted: boolean; reason?: string }) | undefined;
  /** Restart the proxy if the session file it should read differs from the one it was given. */
  syncOAuthProxySession?: (() => boolean) | undefined;
  openai: OpenAI | null;
  packageVersion: string;
  rootDir: string;
  serverActualPort: number | undefined;
  serverConfiguredPort: number;
  serverUrl: string;
  startedAt: number;
  xaiApiKey: string | undefined;
  xaiApiKeySource: ApiKeySource;
  hasXaiApiKey: boolean;
  geminiApiKey: string | undefined;
  geminiApiKeySource: ApiKeySource;
  hasGeminiApiKey: boolean;
  atlasCloudApiKey: string | undefined;
  atlasCloudApiKeySource: ApiKeySource;
  hasAtlasCloudApiKey: boolean;
  minimaxApiKey: string | undefined;
  minimaxApiKeySource: ApiKeySource;
  hasMinimaxApiKey: boolean;
  naiApiKey: string | undefined;
  naiApiKeySource: ApiKeySource;
  hasNaiApiKey: boolean;
  vertexServiceAccountJson: string | undefined;
  vertexProjectId: string | undefined;
  hasVertexKey: boolean;
  geminiAuthMode?: string | undefined;
  /** Lazily attached by routes/mcpConnections.ts (030 WP3); undefined until MCP routes register. */
  mcpConnectionManager?: McpConnectionManager | undefined;
  /**
   * Registered comfy workflows, hydrated at boot and refreshed whenever
   * routes/comfy.ts writes one.
   *
   * Lives on the context rather than behind a store read because
   * ProviderAdapterV1.validateAuth() and listModels() are both SYNCHRONOUS
   * while the store is async, and because the adapter contract suite injects
   * lane state exclusively through RuntimeContext — a module-level cache could
   * not be empty and non-empty for the two calls that suite makes.
   *
   * Generation does NOT read this: lib/comfyImageAdapter reads the store
   * directly, so a context that lags by one write can never produce a wrong
   * image. This projection exists for the adapter contract and lane display.
   */
  comfyWorkflows?: readonly ComfyWorkflowRecord[] | undefined;
}

/** A partial used during boot when only some fields are known, or by callers
 *  threading ctx through layered APIs (oauth/responses adapters). */
export type RuntimeContextOverrides = Partial<RuntimeContext>;

/** Looser ctx shape for route registration helpers and tests, where callers
 *  often pass minimal nested config fixtures. Behaviour-preserving under the
 *  current non-strict-null tsconfig. */
export type RouteRuntimeContext =
  & Omit<Partial<RuntimeContext>, "config">
  & { config?: { [K in keyof AppConfig]?: Partial<AppConfig[K]> } };

/** Normalize a possibly-Partial RouteRuntimeContext into a strict RuntimeContext.
 *
 *  IMPORTANT: This MUTATES `ctx` in place and returns the same object (object
 *  identity preserved). The runtime mutates fields on the original ctx after
 *  route registration — e.g. `markOAuthReady()` flips `oauthReadyState`,
 *  `startServer()` sets `serverActualPort` once the listener binds. Snapshotting
 *  here would break those updates because deep code (like `waitForOAuthReady`)
 *  re-reads `ctx.oauthReadyState`.
 *
 *  - Live fields (oauthReadyState, oauthReadyPromise, serverActualPort, openai,
 *    apiKey, ...) keep their original references via in-place fill.
 *  - Missing config nests are merged from `runtimeConfigDefault` per top-level
 *    key, so partial fixtures (e.g. `{ config: { storage: {...} } }`) still see
 *    real `oauth`/`ids`/`limits` defaults at deep call sites.
 *
 *  Use this at the top of any function that crosses from `RouteRuntimeContext`
 *  into deep typed code. Per GPT Pro's P05 review: RouteRuntimeContext stays
 *  boundary-only; deep lib code should operate on strict RuntimeContext. */
export function requireRuntimeContext(ctx: RouteRuntimeContext | undefined): RuntimeContext {
  const target = (ctx ?? {}) as RouteRuntimeContext & Record<string, unknown>;
  target.config = mergeRuntimeConfig(target.config);
  if (target.apiKey === undefined && Object.prototype.hasOwnProperty.call(target, "apiKey") === false) {
    target.apiKey = undefined;
  }
  if (target.hasApiKey === undefined) target.hasApiKey = false;
  if (target.oauthPort === undefined) {
    target.oauthPort = (target.config as AppConfig).oauth?.proxyPort ?? 11782;
  }
  if (target.oauthReadyPromise === undefined) target.oauthReadyPromise = null;
  if (target.oauthUrl === undefined) {
    target.oauthUrl = `http://127.0.0.1:${(target.config as AppConfig).oauth?.proxyPort ?? target.oauthPort ?? 11782}`;
  }
  if (target.openai === undefined) target.openai = null;
  if (target.packageVersion === undefined) target.packageVersion = "0.0.0";
  if (target.rootDir === undefined) target.rootDir = process.cwd();
  if (target.serverConfiguredPort === undefined) {
    target.serverConfiguredPort = (target.config as AppConfig).server?.port ?? 11783;
  }
  if (target.serverUrl === undefined) {
    const port = target.serverActualPort ?? target.serverConfiguredPort ?? 11783;
    target.serverUrl = `http://localhost:${port}`;
  }
  if (target.startedAt === undefined) target.startedAt = Date.now();
  if (target.xaiApiKey === undefined && !Object.prototype.hasOwnProperty.call(target, 'xaiApiKey')) target.xaiApiKey = undefined;
  if (target.hasXaiApiKey === undefined) target.hasXaiApiKey = false;
  if (target.xaiApiKeySource === undefined) target.xaiApiKeySource = undefined;
  if (target.geminiApiKey === undefined && !Object.prototype.hasOwnProperty.call(target, 'geminiApiKey')) target.geminiApiKey = undefined;
  if (target.hasGeminiApiKey === undefined) target.hasGeminiApiKey = false;
  if (target.geminiApiKeySource === undefined) target.geminiApiKeySource = undefined;
  if (target.atlasCloudApiKey === undefined && !Object.prototype.hasOwnProperty.call(target, 'atlasCloudApiKey')) target.atlasCloudApiKey = undefined;
  if (target.hasAtlasCloudApiKey === undefined) target.hasAtlasCloudApiKey = false;
  if (target.atlasCloudApiKeySource === undefined) target.atlasCloudApiKeySource = undefined;
  if (target.minimaxApiKey === undefined && !Object.prototype.hasOwnProperty.call(target, 'minimaxApiKey')) target.minimaxApiKey = undefined;
  if (target.hasMinimaxApiKey === undefined) target.hasMinimaxApiKey = false;
  if (target.minimaxApiKeySource === undefined) target.minimaxApiKeySource = undefined;
  if (target.naiApiKey === undefined && !Object.prototype.hasOwnProperty.call(target, 'naiApiKey')) target.naiApiKey = undefined;
  if (target.hasNaiApiKey === undefined) target.hasNaiApiKey = false;
  if (target.naiApiKeySource === undefined) target.naiApiKeySource = undefined;
  if (target.vertexServiceAccountJson === undefined && !Object.prototype.hasOwnProperty.call(target, 'vertexServiceAccountJson')) target.vertexServiceAccountJson = undefined;
  if (target.vertexProjectId === undefined) target.vertexProjectId = undefined;
  if (target.hasVertexKey === undefined) target.hasVertexKey = false;
  return target as unknown as RuntimeContext;
}

/** Per-top-level-key merge: caller's nested config keys win, missing nests
 *  fall back to `runtimeConfigDefault`. Avoids deep-clone snapshotting so
 *  callers can still observe live-mutated config values if they exist. */
function mergeRuntimeConfig(
  partial: RouteRuntimeContext["config"] | undefined,
): AppConfig {
  if (!partial) return runtimeConfigDefault;
  const merged: Record<string, unknown> = {};
  for (const k of Object.keys(runtimeConfigDefault) as Array<keyof AppConfig>) {
    const fromPartial = (partial as Record<string, unknown>)[k as string];
    if (fromPartial && typeof fromPartial === "object") {
      merged[k as string] = {
        ...(runtimeConfigDefault[k] as object),
        ...(fromPartial as object),
      };
    } else {
      merged[k as string] = runtimeConfigDefault[k];
    }
  }
  for (const k of Object.keys(partial)) {
    if (!(k in merged)) merged[k] = (partial as Record<string, unknown>)[k];
  }
  return merged as AppConfig;
}

/** Stub-friendly default for tests. Do NOT use in production boot paths. */
export function createTestRuntimeContext(over: RuntimeContextOverrides = {}): RuntimeContext {
  const now = Date.now();
  const base: RuntimeContext = {
    apiKey: undefined,
    apiKeySource: undefined,
    adminNonce: "",
    config: {} as AppConfig,
    hasApiKey: false,
    oauthActualPort: undefined,
    oauthPort: 11782,
    oauthReadyPromise: null,
    oauthReadyState: undefined,
    oauthUrl: "http://127.0.0.1:11782",
    openai: null,
    packageVersion: "0.0.0-test",
    rootDir: process.cwd(),
    serverActualPort: undefined,
    serverConfiguredPort: 11783,
    serverUrl: "http://127.0.0.1:11783",
    startedAt: now,
    xaiApiKey: undefined,
    xaiApiKeySource: undefined,
    hasXaiApiKey: false,
    geminiApiKey: undefined,
    geminiApiKeySource: undefined,
    hasGeminiApiKey: false,
    atlasCloudApiKey: undefined,
    atlasCloudApiKeySource: undefined,
    hasAtlasCloudApiKey: false,
    minimaxApiKey: undefined,
    minimaxApiKeySource: undefined,
    hasMinimaxApiKey: false,
    naiApiKey: undefined,
    naiApiKeySource: undefined,
    hasNaiApiKey: false,
    vertexServiceAccountJson: undefined,
    vertexProjectId: undefined,
    hasVertexKey: false,
  };
  return { ...base, ...over };
}
