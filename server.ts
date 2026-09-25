import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { readFile } from "fs/promises";
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  mkdirSync,
  readFileSync as fsReadFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { onShutdown } from "./bin/lib/platform.js";
import { ensureDefaultSession } from "./lib/sessionStore.js";
import { resetCodexCaches } from "./lib/codexBackend/index.js";
import { migrateGeneratedStorage } from "./lib/storageMigration.js";
import { purgeStaleJobs } from "./lib/inflight.js";
import { configureLogger, logError, logWarn } from "./lib/logger.js";
import { createRequestLogger } from "./lib/requestLogger.js";
import { configureApiCachePolicy } from "./lib/apiCachePolicy.js";
import { configureRoutes } from "./routes/index.js";
import { API_REQUEST_POLICY, config } from "./config.js";
import { createApiRequestBudget } from "./lib/apiRequestBudget.js";
import { createLocalLanAccess, createLanApiGuard as tokenOnlyLanApiGuard } from "./lib/localLanAccess.js";
import { createGeneratedMediaAccess } from "./lib/generatedMediaAccess.js";
import { getServerPort, listenWithPortFallback } from "./lib/runtimePorts.js";
import { shutdownServerAndMcp, startMcpRestoreAfterListen } from "./lib/mcp/shutdown.js";
import type { RuntimeContext, RuntimeContextOverrides, ApiKeySource } from "./lib/runtimeContext.js";

import { closeDb } from "./lib/db.js";
import { stopAgentQueueWorker } from "./lib/agentQueueWorker.js";
import { reapCardNewsJobs } from "./lib/cardNewsJobStore.js";
import { reapTerminalJobs } from "./lib/inflight.js";
import { errInfo, thrownFields } from "./lib/errInfo.js";
import { TEMPLATE_FILE_MAX_BYTES } from "./lib/nodeTemplateFile.js";
import { templateImportBodyErrors } from "./routes/nodeTemplates.js";
import { loadGrokCredentials } from "./lib/xaiAuth.js";
import {
  cleanupExpiredMcpTempReferences,
  MCP_TEMP_REFERENCE_JSON_BODY_LIMIT_BYTES,
  MCP_TEMP_REFERENCE_SWEEP_INTERVAL_MS,
} from "./lib/mcpTempReferenceStore.js";

type BootRuntimeContext = RuntimeContext & {
  markOAuthReady: (info?: { url?: string; port?: number }) => void;
  markOAuthFailed: () => void;
  /** Arm a fresh readiness promise before a proxy respawn. */
  markOAuthStarting: () => void;
};

type ApiKeyLoadResult = { apiKey: string | null; apiKeySource: ApiKeySource };

const rootDir = dirname(fileURLToPath(import.meta.url));
const warnedConfigPaths = new Set<string>();

function warnConfigReadFailed(cfgPath: string, err: unknown) {
  if (warnedConfigPaths.has(cfgPath)) return;
  warnedConfigPaths.add(cfgPath);
  logWarn("config", "config_read_failed", { path: cfgPath, errorName: err instanceof Error ? err.name : typeof err });
}

async function loadApiKey(): Promise<ApiKeyLoadResult> {
  if (process.env.OPENAI_API_KEY) {
    return { apiKey: process.env.OPENAI_API_KEY, apiKeySource: "env" };
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { apiKey?: string };
      if (cfg.apiKey) return { apiKey: cfg.apiKey, apiKeySource: "config" };
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { apiKey: null, apiKeySource: "none" };
}

async function loadXaiApiKey(): Promise<ApiKeyLoadResult> {
  if (process.env.XAI_API_KEY) {
    return { apiKey: process.env.XAI_API_KEY, apiKeySource: "env" };
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { xaiApiKey?: string };
      if (cfg.xaiApiKey) return { apiKey: cfg.xaiApiKey, apiKeySource: "config" };
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { apiKey: null, apiKeySource: "none" };
}

async function loadGeminiApiKey(): Promise<ApiKeyLoadResult> {
  if (process.env.GEMINI_API_KEY) {
    return { apiKey: process.env.GEMINI_API_KEY, apiKeySource: "env" };
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { geminiApiKey?: string };
      if (cfg.geminiApiKey) return { apiKey: cfg.geminiApiKey, apiKeySource: "config" };
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { apiKey: null, apiKeySource: "none" };
}

async function loadAtlasCloudApiKey(): Promise<ApiKeyLoadResult> {
  if (process.env.ATLASCLOUD_API_KEY) {
    return { apiKey: process.env.ATLASCLOUD_API_KEY, apiKeySource: "env" };
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { atlasCloudApiKey?: string };
      if (cfg.atlasCloudApiKey) return { apiKey: cfg.atlasCloudApiKey, apiKeySource: "config" };
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { apiKey: null, apiKeySource: "none" };
}

async function loadMinimaxApiKey(): Promise<ApiKeyLoadResult> {
  if (process.env.MINIMAX_API_KEY) {
    return { apiKey: process.env.MINIMAX_API_KEY, apiKeySource: "env" };
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { minimaxApiKey?: string };
      if (cfg.minimaxApiKey) return { apiKey: cfg.minimaxApiKey, apiKeySource: "config" };
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { apiKey: null, apiKeySource: "none" };
}

async function loadNaiApiKey(): Promise<ApiKeyLoadResult> {
  if (process.env.NOVELAI_API_KEY) {
    return { apiKey: process.env.NOVELAI_API_KEY, apiKeySource: "env" };
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { naiApiKey?: string };
      if (cfg.naiApiKey) return { apiKey: cfg.naiApiKey, apiKeySource: "config" };
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { apiKey: null, apiKeySource: "none" };
}

type VertexKeyLoadResult = { json: string | null; projectId: string | null; source: ApiKeySource };

async function loadVertexKey(): Promise<VertexKeyLoadResult> {
  const envJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      return { json: envJson, projectId: parsed.project_id || null, source: "env" };
    } catch {
      return { json: null, projectId: null, source: "none" };
    }
  }
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { vertexServiceAccountJson?: string };
      if (cfg.vertexServiceAccountJson) {
        const parsed = JSON.parse(cfg.vertexServiceAccountJson);
        return { json: cfg.vertexServiceAccountJson, projectId: parsed.project_id || null, source: "config" };
      }
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return { json: null, projectId: null, source: "none" };
}

async function loadGeminiAuthMode(): Promise<string | undefined> {
  const candidates = [
    config.storage.configFile,
    join(rootDir, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8")) as { geminiAuthMode?: string };
      if (cfg.geminiAuthMode === "vertex" || cfg.geminiAuthMode === "apikey") return cfg.geminiAuthMode;
    } catch (err) { warnConfigReadFailed(cfgPath, err); }
  }
  return undefined;
}

async function createOpenAI(apiKey: string | null | undefined) {
  if (!apiKey) return null;
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey });
}

function readPackageVersion(): string {
  try {
    return (JSON.parse(fsReadFileSync(join(rootDir, "package.json"), "utf-8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function setUiStaticHeaders(res: Response, filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("/index.html")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    return;
  }
  if (normalized.includes("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

export function isLoopbackHost(host: string | undefined): boolean {
  const normalized = String(host || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function assertLanAccessConfiguration(host: string | undefined, token: string | undefined): void {
  if (isLoopbackHost(host)) return;
  if (token && Buffer.byteLength(token) <= config.security.lanTokenMaxBytes) return;
  const message = "[server.security] Set a nonempty IMA2_LAN_TOKEN of at most 4096 UTF-8 bytes to enable LAN access.";
  console.error(message);
  throw new Error(message);
}

export function createLanApiGuard(host: string | undefined, token: string | undefined) {
  return tokenOnlyLanApiGuard(host, token);
}

export function buildApp(ctx: RuntimeContext) {
  const app = express();
  const access = createLocalLanAccess(ctx);
  const budget = createApiRequestBudget(API_REQUEST_POLICY);
  const locals = Object.assign(app.locals, { disposeLocalLanAccess: access.dispose });
  configureApiCachePolicy(app);
  configureLogger({ level: ctx.config.log.level });
  app.use(createRequestLogger());
  app.use(access.mediaHeaders);
  access.registerSessionRoutes(app, budget);
  app.use(access.guard);
  app.use(budget);
  app.use("/api/mcp/temp-references", express.json({ limit: MCP_TEMP_REFERENCE_JSON_BODY_LIMIT_BYTES }));
  // Template files are untrusted input with their own 2MB byte limit; the global
  // parser skips bodies this one already read.
  app.use("/api/node-templates/import", express.json({ limit: TEMPLATE_FILE_MAX_BYTES }), templateImportBodyErrors);
  app.use(express.json({ limit: ctx.config.server.bodyLimit }));
  app.use(express.static(join(ctx.rootDir, "ui", "dist"), {
    setHeaders: setUiStaticHeaders,
  }));
  app.use("/assets", (_req, res) => {
    res.status(404).type("text/plain").send("Asset not found");
  });
  app.use("/generated", ...createGeneratedMediaAccess(ctx, access));
  configureRoutes(app, ctx);
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const info = errInfo(error);
    const candidateStatus = Number(info.status);
    const operational = Boolean(thrownFields(error).isOperational)
      || (Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 500);
    const status = operational ? candidateStatus : 500;
    if (!operational) logError("server", "unhandled:error", error);
    res.status(status).json({
      error: {
        code: operational && info.code ? info.code : "INTERNAL_ERROR",
        message: operational ? info.message : "Internal server error",
      },
    });
  });
  return Object.assign(app, { locals });
}

function runtimeHostUrl(host: string | undefined): string {
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  return host;
}

/**
 * Pure payload builder, exported so the liveness contract is testable without
 * booting a server.
 *
 * The grok section carries an auth fact rather than an endpoint: requests go
 * straight to https://api.x.ai, so the only thing a consumer can act on is
 * whether this machine holds an xAI OAuth session.
 */
export function buildAdvertisePayload(ctx: RuntimeContext) {
  return {
    port: Number(ctx.serverActualPort || ctx.config.server.port),
    url: ctx.serverUrl,
    pid: process.pid,
    startedAt: ctx.startedAt,
    version: ctx.packageVersion,
    adminNonce: ctx.adminNonce,
    backend: {
      configuredPort: Number(ctx.serverConfiguredPort || ctx.config.server.port),
      actualPort: Number(ctx.serverActualPort || ctx.config.server.port),
      url: ctx.serverUrl,
    },
    oauth: {
      mode: ctx.oauthTransport === "native" ? "native" : "proxy",
      configuredPort: Number(ctx.oauthPort),
      actualPort: Number(ctx.oauthActualPort || ctx.oauthPort),
      url: ctx.oauthTransport === "native" ? ctx.config.oauth.codexBaseUrl : ctx.oauthUrl,
      status: ctx.oauthReadyState,
    },
    grok: { auth: loadGrokCredentials(ctx.grokAuthHomeDir) ? "oauth" : "none" },
  };
}

function advertise(ctx: RuntimeContext) {
  // Proxy readiness can arrive before the backend has bound. Publishing that
  // intermediate state makes consumers treat the configured port as live.
  if (!ctx.serverActualPort) return;
  try {
    // The payload carries the admin nonce (a kill-switch credential): the file
    // must be owner-only, or any local user on a shared host can stop the
    // server (adversarial review 260821c, blocker 3).
    mkdirSync(dirname(ctx.config.storage.advertiseFile), { recursive: true, mode: 0o700 });
    writeFileSync(
      ctx.config.storage.advertiseFile,
      JSON.stringify(buildAdvertisePayload(ctx)),
      { mode: 0o600 },
    );
    // mode applies only at creation: a crash-survivor file from an older build
    // keeps its old permissions, so re-assert them on every publish.
    chmodSync(ctx.config.storage.advertiseFile, 0o600);
  } catch (e) {
    const err = errInfo(e);
    console.warn("[advertise] skipped:", err.message);
  }
}

function unadvertise(ctx: RuntimeContext) {
  try {
    if (!existsSync(ctx.config.storage.advertiseFile)) return;
    const cur = JSON.parse(fsReadFileSync(ctx.config.storage.advertiseFile, "utf-8")) as { pid?: number };
    if (cur.pid === process.pid) unlinkSync(ctx.config.storage.advertiseFile);
  } catch { /* best-effort: advertise file cleanup during shutdown */ }
}

type StartServerOverrides = RuntimeContextOverrides & {
  startedAt?: number;
  packageVersion?: string;
  oauthChild?: { stop?: () => void; kill?: () => void; stopAndWait?: (timeoutMs?: number) => Promise<void>; readonly authFile?: string | null } | null;
};

export async function createRuntimeContext(overrides: StartServerOverrides = {}): Promise<BootRuntimeContext> {
  const loadedKey =
    overrides.apiKey !== undefined
      ? {
          apiKey: overrides.apiKey,
          apiKeySource: overrides.apiKeySource ?? (overrides.apiKey ? "env" : "none"),
        }
      : await loadApiKey();
  const loadedXaiKey = await loadXaiApiKey();
  const loadedGeminiKey = await loadGeminiApiKey();
  const loadedAtlasCloudKey = await loadAtlasCloudApiKey();
  const loadedMinimaxKey = await loadMinimaxApiKey();
  const loadedNaiKey = await loadNaiApiKey();
  const loadedVertexKey = await loadVertexKey();
  const geminiAuthMode = await loadGeminiAuthMode();
  const apiKey = loadedKey.apiKey;
  const openai = overrides.openai ?? await createOpenAI(apiKey);
  const oauthPort = config.oauth.proxyPort;
  let resolveOAuthReady: (value: string | null) => void = () => {};
  const newOAuthReadyPromise = () => new Promise<string | null>((resolve) => {
    resolveOAuthReady = resolve;
  });
  const oauthReadyPromise = newOAuthReadyPromise();
  // GPT OAuth calls the Codex backend in process (lib/codexBackend). A stubbed proxy child
  // (tests) or IMA2_NO_OAUTH_PROXY (an external proxy at oauthUrl) keeps the HTTP transport.
  const oauthTransport: "native" | "proxy" =
    overrides.oauthChild !== undefined || !config.oauth.autoStart ? "proxy" : "native";
  const ctx: BootRuntimeContext = {
    rootDir,
    config,
    serverConfiguredPort: config.server.port,
    serverActualPort: undefined,
    serverUrl: `http://${runtimeHostUrl(config.server.host)}:${config.server.port}`,
    oauthPort,
    oauthActualPort: oauthPort,
    oauthUrl: `http://127.0.0.1:${oauthPort}`,
    oauthTransport,
    oauthReadyState: oauthTransport === "native" ? "ready" : config.oauth.autoStart ? "starting" : "disabled",
    hasApiKey: !!apiKey,
    apiKey: apiKey ?? undefined,
    apiKeySource: loadedKey.apiKeySource as ApiKeySource,
    openai,
    startedAt: overrides.startedAt ?? Date.now(),
    packageVersion: overrides.packageVersion ?? readPackageVersion(),
    adminNonce: randomUUID(),
    xaiApiKey: loadedXaiKey.apiKey ?? undefined,
    xaiApiKeySource: loadedXaiKey.apiKeySource as ApiKeySource,
    hasXaiApiKey: !!loadedXaiKey.apiKey,
    geminiApiKey: loadedGeminiKey.apiKey ?? undefined,
    geminiApiKeySource: loadedGeminiKey.apiKeySource as ApiKeySource,
    hasGeminiApiKey: !!loadedGeminiKey.apiKey,
    atlasCloudApiKey: loadedAtlasCloudKey.apiKey ?? undefined,
    atlasCloudApiKeySource: loadedAtlasCloudKey.apiKeySource as ApiKeySource,
    hasAtlasCloudApiKey: !!loadedAtlasCloudKey.apiKey,
    minimaxApiKey: loadedMinimaxKey.apiKey ?? undefined,
    minimaxApiKeySource: loadedMinimaxKey.apiKeySource as ApiKeySource,
    hasMinimaxApiKey: !!loadedMinimaxKey.apiKey,
    naiApiKey: loadedNaiKey.apiKey ?? undefined,
    naiApiKeySource: loadedNaiKey.apiKeySource as ApiKeySource,
    hasNaiApiKey: !!loadedNaiKey.apiKey,
    vertexServiceAccountJson: loadedVertexKey.json ?? undefined,
    vertexProjectId: loadedVertexKey.projectId ?? undefined,
    hasVertexKey: !!loadedVertexKey.json,
    geminiAuthMode,
    oauthReadyPromise: oauthReadyPromise as unknown as Promise<void>,
    markOAuthReady: ({ url, port }: { url?: string; port?: number } = {}) => {
      if (url) ctx.oauthUrl = url;
      if (port) ctx.oauthActualPort = port;
      ctx.oauthReadyState = "ready";
      resolveOAuthReady(ctx.oauthUrl);
    },
    markOAuthFailed: () => {
      ctx.oauthReadyState = "failed";
      resolveOAuthReady(null);
    },
    markOAuthStarting: () => {
      resolveOAuthReady(null);
      ctx.oauthReadyPromise = newOAuthReadyPromise() as unknown as Promise<void>;
      ctx.oauthReadyState = "starting";
    },
  };
  if (!config.oauth.autoStart || oauthTransport === "native") ctx.markOAuthReady({ url: ctx.oauthUrl, port: ctx.oauthPort });
  if (loadedVertexKey.json) {
    try {
      const { initVertexAuth } = await import("./lib/vertexAuth.js");
      initVertexAuth(loadedVertexKey.json);
    } catch { /* vertex init failure is non-fatal */ }
  }
  return ctx;
}

export async function startServer(overrides: StartServerOverrides = {}) {
  const ctx = await createRuntimeContext(overrides);
  assertLanAccessConfiguration(ctx.config.server.host, ctx.config.server.lanToken);
  // Validate the lazy origin configuration before any storage migration.
  void ctx.config.server.publicOrigins;
  await migrateGeneratedStorage(ctx);
  try {
    await cleanupExpiredMcpTempReferences(ctx.config.storage.generatedDir);
  } catch (error) {
    console.warn("[mcp.temp-references] startup cleanup failed:", errInfo(error).message);
  }
  purgeStaleJobs();
  const app = buildApp(ctx);
  // GPT OAuth calls the Codex backend in process and re-reads the session file on every
  // request, so a login needs no restart: forgetting the cached model roster is enough for a
  // different account to show up at once. An injected child (tests) or an external endpoint
  // (IMA2_NO_OAUTH_PROXY) owns its own lifecycle.
  const oauthChild: StartServerOverrides["oauthChild"] = overrides.oauthChild ?? null;
  if (ctx.oauthTransport === "native") {
    ctx.restartOAuthProxy = () => {
      resetCodexCaches();
      return { restarted: true };
    };
    ctx.syncOAuthProxySession = () => false;
  }
  ctx.markOAuthReady({ url: ctx.oauthUrl, port: ctx.oauthPort });

  let server: import("node:net").Server;
  let reapTimer: NodeJS.Timeout;
  let tempReferenceReapTimer: NodeJS.Timeout | undefined;

  onShutdown(async () => {
    unadvertise(ctx);
    try { oauthChild?.stop?.(); } catch { /* best-effort: OAuth child may already be stopped */ }
    try { oauthChild?.kill?.(); } catch { /* best-effort: OAuth child may already be stopped */ }
    stopAgentQueueWorker();
    clearInterval(reapTimer);
    if (tempReferenceReapTimer) clearInterval(tempReferenceReapTimer);
    app.locals.disposeLocalLanAccess();
    await shutdownServerAndMcp({
      closeServer: () => new Promise<void>((resolve) => {
        if (server) server.close(() => resolve()); else resolve();
      }),
      shutdownMcp: () => ctx.mcpConnectionManager?.shutdown() ?? Promise.resolve(),
    });
    closeDb();
  });
  process.on("exit", () => unadvertise(ctx));

  server = await listenWithPortFallback(app, ctx.config.server.port, {
    host: ctx.config.server.host,
    label: "server",
    onFallback: ({ requestedPort, actualPort }: { requestedPort: number; actualPort: number }) => {
      console.log(`[server.port] requested=${requestedPort} actual=${actualPort} reason=EADDRINUSE`);
    },
  });
  ctx.serverActualPort = getServerPort(server) || ctx.config.server.port;
  server.once("close", app.locals.disposeLocalLanAccess);
  ctx.serverUrl = `http://${runtimeHostUrl(ctx.config.server.host)}:${ctx.serverActualPort}`;
  void startMcpRestoreAfterListen(ctx).catch((error) => {
    console.warn(`[mcp.restore] code=${String((error as Error)?.message ?? error).split(":")[0]}`);
  });
  console.log(`Image Gen running at ${ctx.serverUrl}`);
  console.log(`Provider policy: GPT OAuth, API-key Responses, and Grok (xAI OAuth or API key) providers. GPT OAuth ${ctx.oauthTransport === "native" ? "calls ChatGPT directly" : `uses ${ctx.oauthUrl}`}.`);
  advertise(ctx);
  try {
    const s = ensureDefaultSession();
    if (s) console.log(`[db] default session: ${s.id} (${s.title})`);
  } catch (e) {
    const err = errInfo(e);
    console.error("[db] bootstrap failed:", err.message);
  }

  // Background thumbnail backfill for updated users (recursive — covers video
  // series subdirectories like continuous_*/clip_NN.mp4, not just top level).
  (async () => {
    try {
      const { backfillThumbnails } = await import("./lib/thumbBackfill.js");
      const r = await backfillThumbnails(ctx.config.storage.generatedDir);
      if (r.created > 0) {
        console.log(`[thumbs] backfill: ${r.created} created, ${r.skipped} skipped, ${r.failed} failed (${r.total} media files)`);
        const { invalidateHistoryIndex } = await import("./lib/historyIndex.js");
        invalidateHistoryIndex();
      }
    } catch (e) {
      console.warn("[thumbs] backfill failed:", e instanceof Error ? e.message : e);
    }
  })();

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[server] Failed to start:", err?.message || err);
    process.exit(1);
  });

  reapTimer = setInterval(() => {
    reapTerminalJobs();
    reapCardNewsJobs();
  }, 60_000);
  reapTimer.unref?.();

  tempReferenceReapTimer = setInterval(() => {
    cleanupExpiredMcpTempReferences(ctx.config.storage.generatedDir).catch((error) => {
      console.warn("[mcp.temp-references] hourly cleanup failed:", errInfo(error).message);
    });
  }, MCP_TEMP_REFERENCE_SWEEP_INTERVAL_MS);
  tempReferenceReapTimer.unref?.();

  process.on("uncaughtException", (err) => {
    console.error("[fatal] uncaughtException:", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandledRejection:", reason);
  });

  return { app, server, oauthChild, ctx };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
