import type { Express, Request, Response } from "express";
import type { MediaAdapterContext } from "../lib/providers/media/contract.js";
import { credentialReady, MediaKeySnapshot } from "../lib/providers/media/credentials.js";
import { MediaJobError, mediaJobErrorFromProvider } from "../lib/providers/media/errors.js";
import type { MediaRunnerDeps } from "../lib/providers/media/runner.js";
import { voiceCache, type VoiceCache } from "../lib/providers/media/voices.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { mediaRunnerDeps, sendMediaError } from "./media.js";

const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * GET /api/media/voices?provider=<adapter id>[&refresh=1]: the voices a text-to-speech route can use.
 * The provider is asked only when its key is saved, the answer is cached per key, and neither the
 * response nor an error carries the key.
 */
export function registerMediaVoiceRoutes(app: Express, ctxRaw: RouteRuntimeContext, options: { deps?: Partial<MediaRunnerDeps>; cache?: VoiceCache } = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const cache = options.cache ?? voiceCache;
  app.get("/api/media/voices", async (req: Request, res: Response) => {
    try {
      const provider = req.query.provider;
      if (typeof provider !== "string" || !PROVIDER_ID.test(provider)) throw new MediaJobError("MEDIA_INVALID_REQUEST", "provider is required");
      const deps = mediaRunnerDeps(ctx, options.deps);
      const adapter = deps.registry.listAdapters().find((candidate) => candidate.id === provider);
      const list = adapter?.listVoices?.bind(adapter);
      if (!adapter || !list) throw new MediaJobError("MEDIA_VOICES_UNSUPPORTED", provider + " has no voice list", { status: 404, category: "not-found" });
      const credential = (await MediaKeySnapshot.load(deps.configFile, deps.env ?? process.env)).resolve(adapter);
      if (!credentialReady(credential) || !credential.apiKey) throw new MediaJobError("MEDIA_KEY_MISSING", "Save a key for " + adapter.label + " to list its voices", { category: "auth" });
      const actx: MediaAdapterContext = { apiKey: credential.apiKey, extra: credential.extra, fetch: deps.fetch ?? globalThis.fetch };
      const result = await cache.get(adapter.id, credential.apiKey, () => list(actx), req.query.refresh === "1" || req.query.refresh === "true")
        .catch((error: unknown) => { throw mediaJobErrorFromProvider(adapter.normalizeError(error)); });
      res.json({ provider: adapter.id, voices: result.voices, fetchedAt: new Date(result.fetchedAt).toISOString(), cached: result.cached });
    } catch (error) {
      sendMediaError(res, error, "media-voices");
    }
  });
}
