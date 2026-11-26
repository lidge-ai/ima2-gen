import type { Express, Request, Response } from "express";
import type { MediaProviderAdapter } from "../lib/providers/media/contract.js";
import { LEGACY_KEY_VOCABULARIES, mediaKeyVocabularies, readConfigFileSafe, resolveMediaCredential, storedExtras } from "../lib/providers/media/credentials.js";
import { redactSecrets } from "../lib/providers/media/redact.js";
import { loadVendorLogos, type VendorLogos } from "../lib/providers/media/vendorAssets.js";
import { getMediaRegistry, type MediaRegistry } from "../lib/providers/media/registry.js";
import { updateConfigFileAtomic } from "../lib/configFileStore.js";
import type { RuntimeContext } from "../lib/runtimeContext.js";

export interface MediaKeyRouteOptions {
  mediaRegistry?: MediaRegistry;
  /** Transport for adapter.validateKey; tests inject a fake. */
  fetch?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
}

const MAX_KEY_CHARS = 4096;

function registryOf(options: MediaKeyRouteOptions): MediaRegistry {
  return options.mediaRegistry ?? getMediaRegistry();
}

function maskKey(key: string): string {
  return key.length <= 10 ? "***" : `${key.slice(0, 4)}..${key.slice(-2)}`;
}

function isLegacy(vocabulary: string): boolean {
  return (LEGACY_KEY_VOCABULARIES as readonly string[]).includes(vocabulary);
}

/** The adapter that owns a media-only key vocabulary (legacy vocabularies stay in routes/keys.ts). */
export function mediaVocabularyAdapter(vocabulary: string, options: MediaKeyRouteOptions = {}): MediaProviderAdapter | undefined {
  if (isLegacy(vocabulary)) return undefined;
  return mediaKeyVocabularies(registryOf(options).listAdapters()).get(vocabulary);
}

function adaptersFor(vocabulary: string, options: MediaKeyRouteOptions): string[] {
  return registryOf(options).listAdapters().filter((a) => a.credential.keyVocabulary === vocabulary).map((a) => a.id);
}

/** Status entries for media vocabularies, merged into GET /api/keys/status. */
export async function mediaKeyStatuses(ctx: RuntimeContext, options: MediaKeyRouteOptions = {}): Promise<Record<string, unknown>> {
  const fileConfig = await readConfigFileSafe(ctx.config.storage.configFile);
  const env = options.env ?? process.env;
  const out: Record<string, unknown> = {};
  for (const [vocabulary, adapter] of mediaKeyVocabularies(registryOf(options).listAdapters())) {
    // The legacy six already report themselves; their extra fields are listed by /api/keys/vocabulary.
    if (isLegacy(vocabulary)) continue;
    const r = resolveMediaCredential(adapter.credential, { env, fileConfig });
    const fields = (adapter.credential.extraFields ?? []).map((f) => ({
      name: f.name, secret: f.secret, required: f.required, configured: Boolean(r.extra[f.name]), source: r.extraSources[f.name] ?? "none",
      ...(f.secret ? {} : { value: r.extra[f.name] ?? null }),
    }));
    const ready = Boolean(r.apiKey) && r.missingExtra.length === 0;
    out[vocabulary] = {
      configured: ready, source: r.source, valid: ready, maskedKey: r.apiKey ? maskKey(r.apiKey) : null,
      media: true, label: adapter.label, consoleUrl: adapter.credential.consoleUrl, extraFields: fields, adapters: adaptersFor(vocabulary, options),
    };
  }
  return out;
}

function vocabularyList(options: MediaKeyRouteOptions, logos: VendorLogos) {
  return [...mediaKeyVocabularies(registryOf(options).listAdapters())].map(([vocabulary, adapter]) => ({
    vocabulary,
    label: adapter.label,
    logo: logos.find(vocabulary) ?? logos.forAdapter(adapter),
    legacy: isLegacy(vocabulary),
    consoleUrl: adapter.credential.consoleUrl,
    keyPrefix: adapter.credential.keyPrefix ?? null,
    envVars: adapter.credential.envVars,
    extraFields: (adapter.credential.extraFields ?? []).map((f) => ({ name: f.name, envVar: f.envVar, secret: f.secret, required: f.required })),
    adapters: adaptersFor(vocabulary, options),
  }));
}

function readExtra(raw: unknown, adapter: MediaProviderAdapter): Record<string, string> | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "extra must be an object";
  const allowed = new Map((adapter.credential.extraFields ?? []).map((f) => [f.name, f]));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(name)) return `Unknown extra field: ${name}`;
    if (typeof value !== "string" || value.length > MAX_KEY_CHARS) return `${name} must be a string`;
    if (value.trim()) out[name] = value.trim();
  }
  return out;
}

async function validateWithAdapter(adapter: MediaProviderAdapter, apiKey: string, extra: Record<string, string>, options: MediaKeyRouteOptions): Promise<string | null> {
  const secrets = [apiKey, ...(adapter.credential.extraFields ?? []).filter((f) => f.secret).map((f) => extra[f.name] ?? "")];
  try {
    const verdict = await adapter.validateKey({ apiKey, extra, fetch: options.fetch ?? globalThis.fetch, signal: AbortSignal.timeout(10_000) });
    return verdict.ok ? null : redactSecrets(verdict.reason ?? "rejected", secrets);
  } catch (error) {
    return redactSecrets(error instanceof Error ? error.message : "unknown", secrets);
  }
}

function fail(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ ok: false, error, code });
}

/** PUT /api/keys/:vocabulary for a media-only vocabulary. Body: { apiKey, extra? }. */
export async function putMediaKey(ctx: RuntimeContext, adapter: MediaProviderAdapter, body: unknown, res: Response, options: MediaKeyRouteOptions = {}) {
  const cred = adapter.credential;
  const { apiKey, extra: rawExtra } = (body ?? {}) as { apiKey?: unknown; extra?: unknown };
  if (typeof apiKey !== "string" || !apiKey.trim()) return fail(res, 400, "MISSING_KEY", "Missing apiKey");
  const key = apiKey.trim();
  if (key.length > MAX_KEY_CHARS) return fail(res, 400, "KEY_TOO_LARGE", "API key too large");
  if (cred.keyPrefix && !key.startsWith(cred.keyPrefix)) return fail(res, 400, "INVALID_KEY_FORMAT", `Invalid key format for ${cred.keyVocabulary}: expected prefix ${cred.keyPrefix}`);
  const extra = readExtra(rawExtra, adapter);
  if (typeof extra === "string") return fail(res, 400, "INVALID_EXTRA", extra);
  const fileConfig = await readConfigFileSafe(ctx.config.storage.configFile);
  const merged = { ...(storedExtras(fileConfig, cred.keyVocabulary) as Record<string, string>), ...extra };
  const missing = (cred.extraFields ?? []).filter((f) => f.required && !merged[f.name] && !(options.env ?? process.env)[f.envVar]).map((f) => f.name);
  if (missing.length) return fail(res, 400, "MISSING_EXTRA", `Missing required fields: ${missing.join(", ")}`);
  const rejected = await validateWithAdapter(adapter, key, merged, options);
  if (rejected !== null) return fail(res, 400, "KEY_VALIDATION_FAILED", `API key validation failed: ${rejected}`);
  await updateConfigFileAtomic(ctx.config.storage.configFile, (existing) => {
    existing[cred.configKey] = key;
    const all = existing.mediaKeyExtras && typeof existing.mediaKeyExtras === "object" ? existing.mediaKeyExtras as Record<string, unknown> : {};
    existing.mediaKeyExtras = { ...all, [cred.keyVocabulary]: merged };
  });
  return res.json({ ok: true, provider: cred.keyVocabulary, source: "config", valid: true });
}

export async function deleteMediaKey(ctx: RuntimeContext, adapter: MediaProviderAdapter, res: Response, options: MediaKeyRouteOptions = {}) {
  const cred = adapter.credential;
  const env = options.env ?? process.env;
  if (cred.envVars.some((v) => env[v])) return fail(res, 400, "ENV_KEY_IMMUTABLE", "Cannot remove env-sourced key");
  await updateConfigFileAtomic(ctx.config.storage.configFile, (existing) => {
    delete existing[cred.configKey];
    const all = existing.mediaKeyExtras;
    if (all && typeof all === "object") delete (all as Record<string, unknown>)[cred.keyVocabulary];
  });
  return res.json({ ok: true, provider: cred.keyVocabulary, removed: true });
}

/** Routes that do not collide with routes/keys.ts's /api/keys/:provider handlers. */
export function registerMediaKeyRoutes(app: Express, ctx: RuntimeContext, options: MediaKeyRouteOptions = {}) {
  app.get("/api/keys/vocabulary", async (_req: Request, res: Response) => {
    res.json({ vocabularies: vocabularyList(options, await loadVendorLogos(ctx.rootDir)) });
  });
  // Extra fields alone (region, endpoint id), for any vocabulary including the legacy six.
  app.put("/api/keys/:vocabulary/extra", async (req: Request<{ vocabulary: string }>, res: Response) => {
    const adapter = mediaKeyVocabularies(registryOf(options).listAdapters()).get(req.params.vocabulary);
    if (!adapter) return fail(res, 400, "INVALID_PROVIDER", "Invalid provider");
    const extra = readExtra(req.body?.extra, adapter);
    if (typeof extra === "string") return fail(res, 400, "INVALID_EXTRA", extra);
    await updateConfigFileAtomic(ctx.config.storage.configFile, (existing) => {
      const all = existing.mediaKeyExtras && typeof existing.mediaKeyExtras === "object" ? existing.mediaKeyExtras as Record<string, unknown> : {};
      const mine = all[req.params.vocabulary] && typeof all[req.params.vocabulary] === "object" ? all[req.params.vocabulary] as Record<string, unknown> : {};
      existing.mediaKeyExtras = { ...all, [req.params.vocabulary]: { ...mine, ...extra } };
    });
    return res.json({ ok: true, provider: req.params.vocabulary, fields: Object.keys(extra) });
  });
}
