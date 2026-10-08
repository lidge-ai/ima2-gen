# wp2 — 88API registry, independent credentials, catalog and image execution

Status: implementation-ready PRD; no implementation or execution has occurred in this planning leaf.
Source tree: `/Users/jun/.codex/worktrees/8112/ima2-gen`, inspected 2026-10-08. Apply replacements by
the quoted current text, using line numbers as navigation; earlier replacements shift later lines.
This document is the only file written by this leaf. D1–D10 in `000_plan.md` govern over older
proposals in 001–005 and the upstream handoff. No DELETE operations are needed.

## Acceptance contract and phase boundary

Register 10 image and 25 video IDs byte-exactly. Seven image models execute. The three Grok
image rows have `status: "unverified"`, all support flags false, no picker rows, no public
executable catalog rows, and a local `API88_MODEL_UNVERIFIED` rejection. Image requests use
only the image credential. Catalog readiness uses either credential; each model uses its own
kind's credential. All 25 video rows remain `executable: false` in wp2, with
`API88_VIDEO_KEY_MISSING` when their key is absent and `API88_VIDEO_NOT_READY` otherwise.
Do not add `"video"` to lane surfaces, static video pickers, video selection restoration or
video dispatch yet. wp3 owns those changes and removes the temporary generation-route guard.

No image POST retries or endpoint fallback. GPT uses Images JSON/multipart; Gemini uses chat
completions. References include a source first, then explicit references. Node parent-only
mode drops user references, matching its existing active-reference accounting. Multimode
uses the effective prompt and preserves MIME/provider URL. Transparent background and masks
are not advertised. CLI has no new implicit global default.

All NEW files below are under 500 lines; every newly introduced function body is under 50
lines. Large existing files are not replaced wholesale. New numeric transport budgets belong
in config. Reference caps are app policy: no upstream image cap is asserted without evidence.

## Plan deviations

No locked D1–D10 decision is changed. Two research corrections affect exact tests:

* `lib/providers/registry.ts:72–77,100–105` registers `grok-imagine-image` and
  `grok-imagine-image-quality`, but not `grok-imagine-edit`. Applying D4 yields
  `UNSUPPORTED_IMAGE_MODEL_IDS = ["grok-imagine-edit"]`, not `[]` or all three Grok IDs.
* The handoff image sections specify no verified image reference count. The new manifest
  uses `referenceLimits: {}`; `config.limits.maxRefCount` still governs image input, and
  transport/node accounting includes the source. This is not AtlasCloud's inferred limit 10.

Required adjacent implementation paths are included explicitly: `routes/index.ts` (mount
the new config route), `ui/src/components/Api88Settings.tsx` (avoid inflating AccountSettings),
generated test inventory, and small exhaustive fixtures. The parent explicitly included Doctor's
dynamic validation resolver and its fixture/test in wp2 (A1); their exact edits are below.
CLI defaults lock enforcement remains a separately identified follow-up. This leaf still
writes only this PRD.

Parent-approved size exception (A1): `config.ts` (556 lines), `routes/models.ts` (545 lines)
and `GenProviderModelSelect.tsx` (505 lines) already exceed 500 lines. They receive minimal
imports/wiring only. Their new config, lane and picker logic lives in the NEW modules
`lib/api88/config.ts`, `routes/modelsApi88.ts` and `ui/src/lib/api88Picker.ts`, respectively.
Every new implementation file remains under 500 lines and new functions under 50 lines.

## 1. Registry and shared types

### MODIFY `lib/providers/types.ts`

Anchor lines 1–3:

```ts
export type KeyProviderId = "openai" | "xai" | "gemini" | "atlascloud" | "minimax" | "nai";

export type ProviderVendor = "openai" | "xai" | "google" | "atlascloud" | "minimax" | "novelai" | "comfy";
```

After:

```ts
export type KeyProviderId = "openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai";

export type ProviderVendor = "openai" | "xai" | "google" | "atlascloud" | "88api" | "minimax" | "novelai" | "comfy";
```

Anchor lines 54–57:

```ts
export interface CoreProviderModel {
  id: string;
  aliases?: readonly string[];
  kind: ProviderModelKind;
```

After:

```ts
export interface CoreProviderModel {
  id: string;
  aliases?: readonly string[];
  kind: ProviderModelKind;
  status?: "unverified";
```

### MODIFY `lib/providers/registry.ts`

Insert before lines 174–176 (after AtlasCloud, before MiniMax):

```ts
  {
    id: "minimax",
    surfaces: ["generate", "edit", "multimode", "node"],
```

Exact inserted object:

```ts
  {
    id: "88api",
    surfaces: ["generate", "edit", "multimode", "node"],
    vendor: "88api",
    credentials: [
      { kind: "api-key", keyVocabulary: "api88-image", envVars: ["IMA2_88API_IMAGE_KEY"],
        configKey: "api88ImageKey", validateUrl: "https://api.88api.ai/v1/models", validateUrlIsFallback: true },
      { kind: "api-key", keyVocabulary: "api88-video", envVars: ["IMA2_88API_VIDEO_KEY"],
        configKey: "api88VideoKey", validateUrl: "https://api.88api.ai/v1/models", validateUrlIsFallback: true },
    ],
    models: [
      { id: "gemini-3-pro-image", kind: "image", supports: EDIT },
      { id: "gemini-3.1-flash-image", kind: "image", supports: EDIT },
      { id: "gemini-3.1-flash-lite-image", kind: "image", supports: EDIT },
      { id: "gemini-nano-banana-2.1", kind: "image", supports: EDIT },
      { id: "gpt-image-2", kind: "image", supports: EDIT },
      { id: "gpt-image-2.5-flare", kind: "image", supports: EDIT },
      { id: "gpt-image-2.5-sunburst", kind: "image", supports: EDIT },
      { id: "grok-imagine-edit", kind: "image", status: "unverified",
        supports: { generate: false, edit: false, mask: false, streaming: false } },
      { id: "grok-imagine-image", kind: "image", status: "unverified",
        supports: { generate: false, edit: false, mask: false, streaming: false } },
      { id: "grok-imagine-image-quality", kind: "image", status: "unverified",
        supports: { generate: false, edit: false, mask: false, streaming: false } },
      { id: "gemini-omni-flash", kind: "video", supports: GENERATE_ONLY },
      { id: "grok-imagine-video", kind: "video", supports: GENERATE_ONLY },
      { id: "grok-imagine-video-1.5", kind: "video", supports: GENERATE_ONLY },
      { id: "kling-3.0-turbo-720p", kind: "video", supports: GENERATE_ONLY },
      { id: "kling-3.0-turbo-1080p", kind: "video", supports: GENERATE_ONLY },
      { id: "kling-3.0-turbo-2k", kind: "video", supports: GENERATE_ONLY },
      { id: "kling-3.0-turbo-4k", kind: "video", supports: GENERATE_ONLY },
      { id: "minimax-h3-768p", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.0 480P", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.0 720P", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.0 1080P", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.0 4k", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.5 480P", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.5 720P", kind: "video", supports: GENERATE_ONLY },
      { id: "SD2.5 1080P", kind: "video", supports: GENERATE_ONLY },
      { id: "Seedance-2.0-720p官方版", kind: "video", supports: GENERATE_ONLY },
      { id: "Seedance-2.0-fast-720p官方版", kind: "video", supports: GENERATE_ONLY },
      { id: "Seedance-2.5-720p官方版", kind: "video", supports: GENERATE_ONLY },
      { id: "seedance-2.0-mini-480p", kind: "video", supports: GENERATE_ONLY },
      { id: "seedance-2.0-mini-720p", kind: "video", supports: GENERATE_ONLY },
      { id: "veo-3.1", kind: "video", supports: GENERATE_ONLY },
      { id: "veo-3.1-fast", kind: "video", supports: GENERATE_ONLY },
      { id: "wan3.0-video-480p", kind: "video", supports: GENERATE_ONLY },
      { id: "wan3.0-video-720p", kind: "video", supports: GENERATE_ONLY },
      { id: "wan3.0-video-1080p", kind: "video", supports: GENERATE_ONLY },
    ],
    referenceLimits: {},
    elementTaxonomy: "gpt",
    limits: { timeoutMs: 180_000 },
    errorPrefix: "API88_",
  },
```

Registration of video `supports.generate` records the target transport capability; executable
state is withheld by the absent video surface and the DTO lock until wp3. Do not call these
video support flags proof that a wp2 route executes videos.

### MODIFY `lib/providers/deriveCore.ts`

Replace lines 28–32:

```ts
export function deriveUnsupportedImageModelsFrom(registry: RegistryInput): Set<string> {
  return new Set(registry.flatMap((provider) => provider.models.filter(
    (model) => model.kind === "image" && !model.supports.generate,
  ).map((model) => model.id)));
}
```

After (same semantics as generator lines 42–43):

```ts
export function deriveUnsupportedImageModelsFrom(registry: RegistryInput): Set<string> {
  const supported = new Set(registry.flatMap((provider) => provider.models.filter(
    (model) => model.kind === "image" && model.supports.generate,
  ).map((model) => model.id)));
  return new Set(registry.flatMap((provider) => provider.models.filter(
    (model) => model.kind === "image" && !model.supports.generate && !supported.has(model.id),
  ).map((model) => model.id)));
}
```

## 2. Config, loading and base-URL endpoint

### MODIFY `config.ts`

After line 17 `import { parsePublicOrigins } from "./lib/localAccessPolicy.js";`, insert:

```ts
import { buildApi88ProviderConfig } from "./lib/api88/config.js";
```

Insert before line 438, current anchor `// Direct MiniMax image-generation provider (text-to-image / image-to-image).`:

```ts
  api88Provider: buildApi88ProviderConfig(env, fileCfg.api88Provider, { pickStr, pickPositiveInt }),
```

Existing `pickStr` (lines 99–101) and `pickPositiveInt` (95–98) retain config's precedence
and numeric validation. The new module is pure and does not import runtime config.

### NEW `lib/api88/config.ts` — full contents

```ts
type Pickable = string | number | boolean | undefined;
type Pickers = {
  pickStr: (env: Pickable, file: Pickable, fallback: string) => string;
  pickPositiveInt: (env: Pickable, file: Pickable, fallback: number) => number;
};

export function buildApi88ProviderConfig(
  env: NodeJS.ProcessEnv, file: Record<string, Pickable> | undefined, { pickStr, pickPositiveInt }: Pickers,
) {
  const saved = file ?? {};
  return {
    baseUrl: pickStr(env.IMA2_88API_BASE_URL, saved.baseUrl, "https://api.88api.ai"),
    baseUrlSource: (env.IMA2_88API_BASE_URL ? "env" : saved.baseUrl ? "config" : "default") as "env" | "config" | "default",
    defaultImageModel: "gpt-image-2",
    defaultVideoModel: "grok-imagine-video-1.5",
    imageTimeoutMs: pickPositiveInt(env.IMA2_88API_IMAGE_TIMEOUT_MS, saved.imageTimeoutMs, 180_000),
    catalogTimeoutMs: pickPositiveInt(env.IMA2_88API_CATALOG_TIMEOUT_MS, saved.catalogTimeoutMs, 10_000),
    catalogTtlMs: 600_000,
    imageDownloadTimeoutMs: pickPositiveInt(env.IMA2_88API_IMAGE_DOWNLOAD_TIMEOUT_MS, saved.imageDownloadTimeoutMs, 60_000),
    maxImageBytes: pickPositiveInt(env.IMA2_88API_MAX_IMAGE_BYTES, saved.maxImageBytes, 52_428_800),
    videoSubmitTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_SUBMIT_TIMEOUT_MS, saved.videoSubmitTimeoutMs, 60_000),
    videoFirstPollMs: 4_000,
    videoPollIntervalMs: 12_000,
    videoPollTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_POLL_TIMEOUT_MS, saved.videoPollTimeoutMs, 30_000),
    videoTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_TIMEOUT_MS, saved.videoTimeoutMs, 900_000),
    videoDownloadTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_DOWNLOAD_TIMEOUT_MS, saved.videoDownloadTimeoutMs, 300_000),
    maxVideoBytes: 209_715_200,
    videoUnknownStatusLimit: 3,
  };
}
```

Keep D6 timing constants fixed; wp3 reads this block. No global provider/default change.

### MODIFY `lib/runtimeContext.ts`

Insert after line 65 `hasAtlasCloudApiKey: boolean;`:

```ts
  api88ImageKey: string | undefined;
  api88ImageKeySource: ApiKeySource;
  hasApi88ImageKey: boolean;
  api88VideoKey: string | undefined;
  api88VideoKeySource: ApiKeySource;
  hasApi88VideoKey: boolean;
```

Insert after line 159 `if (target.atlasCloudApiKeySource === undefined) target.atlasCloudApiKeySource = undefined;`:

```ts
  if (!Object.hasOwn(target, "api88ImageKey")) target.api88ImageKey = undefined;
  if (target.hasApi88ImageKey === undefined) target.hasApi88ImageKey = Boolean(target.api88ImageKey?.trim());
  if (target.api88ImageKeySource === undefined) target.api88ImageKeySource = undefined;
  if (!Object.hasOwn(target, "api88VideoKey")) target.api88VideoKey = undefined;
  if (target.hasApi88VideoKey === undefined) target.hasApi88VideoKey = Boolean(target.api88VideoKey?.trim());
  if (target.api88VideoKeySource === undefined) target.api88VideoKeySource = undefined;
```

Insert after line 228 `hasAtlasCloudApiKey: false,` in `createTestRuntimeContext`:

```ts
    api88ImageKey: undefined,
    api88ImageKeySource: undefined,
    hasApi88ImageKey: false,
    api88VideoKey: undefined,
    api88VideoKeySource: undefined,
    hasApi88VideoKey: false,
```

### MODIFY `server.ts`

Insert at imports (line 28 anchor `import { getServerPort, listenWithPortFallback } from "./lib/runtimePorts.js";`):

```ts
import { refreshApi88Catalogs } from "./lib/api88/catalog.js";
```

Insert before line 137 `async function loadMinimaxApiKey(): Promise<ApiKeyLoadResult> {`:

```ts
async function loadApi88Key(kind: "image" | "video"): Promise<ApiKeyLoadResult> {
  const envKey = kind === "image" ? process.env.IMA2_88API_IMAGE_KEY : process.env.IMA2_88API_VIDEO_KEY;
  if (envKey?.trim()) return { apiKey: envKey.trim(), apiKeySource: "env" };
  const field = kind === "image" ? "api88ImageKey" : "api88VideoKey";
  for (const path of [config.storage.configFile, join(rootDir, ".ima2", "config.json")]) {
    if (!existsSync(path)) continue;
    try {
      const saved = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const value = saved[field];
      if (typeof value === "string" && value.trim()) return { apiKey: value.trim(), apiKeySource: "config" };
    } catch (error) { warnConfigReadFailed(path, error); }
  }
  return { apiKey: null, apiKeySource: "none" };
}
```

Insert after line 386 `const loadedAtlasCloudKey = await loadAtlasCloudApiKey();`:

```ts
  const [loadedApi88ImageKey, loadedApi88VideoKey] = await Promise.all([
    loadApi88Key("image"), loadApi88Key("video"),
  ]);
```

Insert after line 431 `hasAtlasCloudApiKey: !!loadedAtlasCloudKey.apiKey,`:

```ts
    api88ImageKey: loadedApi88ImageKey.apiKey ?? undefined,
    api88ImageKeySource: loadedApi88ImageKey.apiKeySource as ApiKeySource,
    hasApi88ImageKey: Boolean(loadedApi88ImageKey.apiKey),
    api88VideoKey: loadedApi88VideoKey.apiKey ?? undefined,
    api88VideoKeySource: loadedApi88VideoKey.apiKeySource as ApiKeySource,
    hasApi88VideoKey: Boolean(loadedApi88VideoKey.apiKey),
```

Insert immediately before line 466 `return ctx;`:

```ts
  await refreshApi88Catalogs(ctx);
```

Boot refresh is free, bounded, both kinds independently, and failure leaves an unknown catalog.

### MODIFY `lib/configKeys.ts`

Replace line 76:

```ts
const ALWAYS_REDACT = new Set(["provider", "apiKey", "oauth.token", "oauth.refreshToken", "vertexServiceAccountJson"]);
```

After:

```ts
const ALWAYS_REDACT = new Set([
  "provider", "apiKey", "oauth.token", "oauth.refreshToken", "vertexServiceAccountJson",
  "api88ImageKey", "api88VideoKey",
]);
```

Keep credentials out of `WRITABLE_CONFIG_KEYS`. Keep base URL out too for wp2: the validated
GET/PATCH route is the write owner; generic `config set` would bypass env lock/URL validation.

### NEW `lib/api88/origin.ts` — full contents

```ts
import { api88Error } from "./errors.js";

export function api88Origin(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw api88Error("API88_BASE_URL_INVALID", "88API base URL must be an absolute URL", 400); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
    || url.username || url.password || url.search || url.hash) {
    throw api88Error("API88_BASE_URL_INVALID", "Use HTTPS (HTTP loopback is allowed for tests), without credentials, query or fragment", 400);
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function api88ModelSlug(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
```

### NEW `routes/api88Config.ts` — full contents

```ts
import type { Express, Request, Response } from "express";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { updateConfigFileAtomic } from "../lib/configFileStore.js";
import { api88Origin } from "../lib/api88/origin.js";
import { invalidateApi88Catalogs, refreshApi88Catalogs } from "../lib/api88/catalog.js";

function dto(ctx: RuntimeContext) {
  return { baseUrl: api88Origin(ctx.config.api88Provider.baseUrl), source: ctx.config.api88Provider.baseUrlSource };
}

async function patch(ctx: RuntimeContext, req: Request, res: Response) {
  if (ctx.config.api88Provider.baseUrlSource === "env") {
    return res.status(409).json({ ok: false, code: "API88_BASE_URL_ENV_LOCKED", error: "IMA2_88API_BASE_URL controls this URL" });
  }
  try {
    if (typeof req.body?.baseUrl !== "string" || !req.body.baseUrl) {
      return res.status(400).json({ ok: false, code: "API88_BASE_URL_INVALID", error: "baseUrl is required" });
    }
    const baseUrl = api88Origin(req.body.baseUrl);
    await updateConfigFileAtomic(ctx.config.storage.configFile, (saved) => {
      const previous = saved.api88Provider;
      saved.api88Provider = {
        ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}), baseUrl,
      };
    });
    ctx.config.api88Provider.baseUrl = baseUrl;
    ctx.config.api88Provider.baseUrlSource = "config";
    invalidateApi88Catalogs(ctx);
    await refreshApi88Catalogs(ctx);
    return res.json(dto(ctx));
  } catch (error) {
    const failure = error as { code?: string; status?: number; message?: string };
    return res.status(failure.status ?? 500).json({ ok: false, code: failure.code ?? "CONFIG_WRITE_FAILED", error: failure.message ?? "Could not save URL" });
  }
}

export function mountApi88ConfigRoutes(app: Express, ctx: RuntimeContext): void {
  app.get("/api/config/88api", (_req, res) => {
    try { res.json(dto(ctx)); }
    catch { res.status(400).json({ ok: false, code: "API88_BASE_URL_INVALID", error: "Invalid configured URL" }); }
  });
  app.patch("/api/config/88api", (req, res) => patch(ctx, req, res));
}
```

### MODIFY `routes/index.ts`

At line 45 anchor `import { mountKeyRoutes } from "./keys.js";`, append:

```ts
import { mountApi88ConfigRoutes } from "./api88Config.js";
```

After line 94 `mountKeyRoutes(app, ctx);`, insert:

```ts
  mountApi88ConfigRoutes(app, ctx);
```

## 3. Independent catalogs and key routes

### NEW `lib/api88/errors.ts` — full contents

```ts
export function api88Error(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}

export function api88HttpError(status: number) {
  if (status === 401 || status === 403) return api88Error("API88_AUTH_FAILED", `88API rejected credentials (HTTP ${status})`, status);
  if (status === 429) return api88Error("API88_RATE_LIMITED", "88API rate limit reached", 429);
  return api88Error("API88_REQUEST_FAILED", `88API request failed (HTTP ${status})`, status);
}

export async function api88Json(url: string, key: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init, redirect: "error", headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${key}` },
    });
  } catch {
    if (init.signal?.aborted) throw init.signal.reason;
    throw api88Error("API88_NETWORK_FAILED", "88API request could not reach the server", 502);
  }
  if (!response.ok) throw api88HttpError(response.status);
  try { return await response.json(); }
  catch {
    if (init.signal?.aborted) throw init.signal.reason;
    throw api88Error("API88_RESPONSE_INVALID", "88API returned invalid JSON", 502);
  }
}

export function api88Record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
```

### NEW `lib/api88/catalog.ts` — full contents

```ts
import type { RuntimeContext } from "../runtimeContext.js";
import { api88Origin } from "./origin.js";
import { api88Error, api88Json, api88Record } from "./errors.js";

export type Api88KeyKind = "image" | "video";
type Snapshot = { key: string; origin: string; checkedAt: number; ids: Set<string> | null };
type KindCache = { key?: string; origin?: string; snapshot?: Snapshot; pending?: Promise<Set<string> | null> };
const caches = new WeakMap<RuntimeContext, Partial<Record<Api88KeyKind, KindCache>>>();

export function api88Key(ctx: RuntimeContext, kind: Api88KeyKind): string | undefined {
  const key = kind === "image" ? ctx.api88ImageKey : ctx.api88VideoKey;
  return key?.trim() || undefined;
}

function cacheFor(ctx: RuntimeContext, kind: Api88KeyKind): KindCache {
  let state = caches.get(ctx);
  if (!state) { state = {}; caches.set(ctx, state); }
  return state[kind] ??= {};
}

export async function validateApi88Key(ctx: RuntimeContext, key: string, requestedOrigin?: string): Promise<Set<string>> {
  const origin = api88Origin(requestedOrigin ?? ctx.config.api88Provider.baseUrl);
  const value = await api88Json(`${origin}/v1/models`, key, {
    method: "GET", signal: AbortSignal.timeout(ctx.config.api88Provider.catalogTimeoutMs),
  });
  const body = api88Record(value);
  if (!Array.isArray(body.data) || body.data.some((row: unknown) => typeof api88Record(row).id !== "string")) {
    throw api88Error("API88_CATALOG_INVALID", "88API models response must contain data[].id", 502);
  }
  return new Set(body.data.map((row: unknown) => api88Record(row).id as string));
}

export function seedApi88Catalog(ctx: RuntimeContext, kind: Api88KeyKind, key: string, ids: Set<string>, requestedOrigin?: string): void {
  const origin = api88Origin(requestedOrigin ?? ctx.config.api88Provider.baseUrl);
  invalidateApi88Catalogs(ctx, kind);
  if (api88Key(ctx, kind) !== key || api88Origin(ctx.config.api88Provider.baseUrl) !== origin) return;
  const cache = cacheFor(ctx, kind);
  cache.key = key; cache.origin = origin;
  cache.snapshot = { key, origin, checkedAt: Date.now(), ids };
}

export function invalidateApi88Catalogs(ctx: RuntimeContext, kind?: Api88KeyKind): void {
  if (kind) { const state = caches.get(ctx); if (state) delete state[kind]; }
  else caches.delete(ctx);
}

async function refresh(ctx: RuntimeContext, kind: Api88KeyKind, key: string, origin: string, cache: KindCache) {
  let ids: Set<string> | null;
  try { ids = await validateApi88Key(ctx, key, origin); }
  catch { ids = cache.snapshot?.key === key && cache.snapshot.origin === origin ? cache.snapshot.ids : null; }
  if (api88Key(ctx, kind) === key && api88Origin(ctx.config.api88Provider.baseUrl) === origin) {
    cache.snapshot = { key, origin, checkedAt: Date.now(), ids };
  }
  return ids;
}

export async function getApi88Catalog(ctx: RuntimeContext, kind: Api88KeyKind): Promise<Set<string> | null> {
  const key = api88Key(ctx, kind);
  if (!key) { invalidateApi88Catalogs(ctx, kind); return null; }
  const origin = api88Origin(ctx.config.api88Provider.baseUrl);
  const cache = cacheFor(ctx, kind);
  if (cache.key !== key || cache.origin !== origin) {
    delete cache.snapshot; delete cache.pending;
    cache.key = key; cache.origin = origin;
  }
  if (cache.snapshot && Date.now() - cache.snapshot.checkedAt < ctx.config.api88Provider.catalogTtlMs) return cache.snapshot.ids;
  const pending = cache.pending ??= refresh(ctx, kind, key, origin, cache);
  try {
    const ids = await pending;
    if (cacheFor(ctx, kind) !== cache || cache.key !== key || cache.origin !== origin
      || api88Key(ctx, kind) !== key || api88Origin(ctx.config.api88Provider.baseUrl) !== origin) return getApi88Catalog(ctx, kind);
    return ids;
  } finally { if (cache.pending === pending) delete cache.pending; }
}

export async function refreshApi88Catalogs(ctx: RuntimeContext): Promise<void> {
  await Promise.allSettled([getApi88Catalog(ctx, "image"), getApi88Catalog(ctx, "video")]);
}
```

Unknown list means `null`; known empty list means an empty Set, never a falsy fallback. Failed
refresh retains the previous known list only for the same key and origin. WeakMap binds state
to context, kinds never share lists, simultaneous requests coalesce. Old requests cannot
overwrite current key/origin state. Changing a URL or deleting a key invalidates its entries.
`KindCache.key/origin` are set before starting a pending request, even with no snapshot:
concurrent initial requests therefore share the same GET. Validation's optional third origin
argument preserves 030's existing `validateApi88Key(ctx, key)` call contract. Refresh passes
its captured origin; seed never attaches an old host's response to a new host.

### MODIFY `routes/keys.ts`

At imports lines 1–4 append:

```ts
import { invalidateApi88Catalogs, seedApi88Catalog, validateApi88Key } from "../lib/api88/catalog.js";
import { api88Origin } from "../lib/api88/origin.js";
```

Line 6 current:

```ts
type KeyProvider = "openai" | "xai" | "gemini" | "atlascloud" | "minimax" | "nai";
```

After:

```ts
type KeyProvider = "openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai";
```

Insert after `atlascloud` in each map: line 12 `atlascloud: ["apikey-"],`, line 23
`atlascloud: "https://api.atlascloud.ai/api/v1/models",`, line 54 `atlascloud: "atlasCloudApiKey",`:

```ts
  // KEY_PREFIX_MAP
  "api88-image": [],
  "api88-video": [],
```

```ts
  // VALIDATE_URL_MAP: metadata fallback; actual validation uses validateApi88Key.
  "api88-image": "https://api.88api.ai/v1/models",
  "api88-video": "https://api.88api.ai/v1/models",
```

```ts
  // CONFIG_KEY_MAP
  "api88-image": "api88ImageKey",
  "api88-video": "api88VideoKey",
```

Replace line 60 current guard return with:

```ts
  return v === "openai" || v === "xai" || v === "gemini" || v === "atlascloud"
    || v === "api88-image" || v === "api88-video" || v === "minimax" || v === "nai";
```

Insert after line 72, current `if (provider === "atlascloud") return { key: ctx.atlasCloudApiKey, source: ctx.atlasCloudApiKeySource || "none" };`:

```ts
  if (provider === "api88-image") return { key: ctx.api88ImageKey, source: ctx.api88ImageKeySource || "none" };
  if (provider === "api88-video") return { key: ctx.api88VideoKey, source: ctx.api88VideoKeySource || "none" };
```

Replace line 81 roster with:

```ts
    for (const provider of ["openai", "xai", "gemini", "atlascloud", "api88-image", "api88-video", "minimax", "nai"] as const) {
```

Before line 210 `// Validate against provider API`, insert:

```ts
    let api88Ids: Set<string> | undefined;
    let api88ValidationOrigin: string | undefined;
```

Replace line 214 `if (provider === "gemini") {` (validation occurrence only) with:

```ts
      if (provider === "api88-image" || provider === "api88-video") {
        api88ValidationOrigin = api88Origin(ctx.config.api88Provider.baseUrl);
        api88Ids = await validateApi88Key(ctx, trimmed, api88ValidationOrigin);
      } else if (provider === "gemini") {
```

This consumes the candidate key's one free `/v1/models` response and seeds it after persistence;
do not repeat a GET after PUT. Before line 292 `return res.json({ ok: true, provider, source: "config", valid: true });`, insert:

```ts
    if (provider === "api88-image") {
      ctx.api88ImageKey = trimmed; ctx.api88ImageKeySource = "config"; ctx.hasApi88ImageKey = true;
      invalidateApi88Catalogs(ctx, "image");
      seedApi88Catalog(ctx, "image", trimmed, api88Ids!, api88ValidationOrigin!);
    } else if (provider === "api88-video") {
      ctx.api88VideoKey = trimmed; ctx.api88VideoKeySource = "config"; ctx.hasApi88VideoKey = true;
      invalidateApi88Catalogs(ctx, "video");
      seedApi88Catalog(ctx, "video", trimmed, api88Ids!, api88ValidationOrigin!);
    }
```

Before line 337 `return res.json({ ok: true, provider, removed: true });`, insert:

```ts
    if (provider === "api88-image") {
      ctx.api88ImageKey = undefined; ctx.api88ImageKeySource = "none"; ctx.hasApi88ImageKey = false;
      invalidateApi88Catalogs(ctx, "image");
    } else if (provider === "api88-video") {
      ctx.api88VideoKey = undefined; ctx.api88VideoKeySource = "none"; ctx.hasApi88VideoKey = false;
      invalidateApi88Catalogs(ctx, "video");
    }
```

Existing PUT allows overriding an env-loaded key in the current process; DELETE's existing env
immutability is retained. D3's env lock applies to base URL, not a new key-policy change.
The seed helper invalidates and declines the seed if origin changed while validation or
atomic persistence was pending. The next lazy lookup uses the new host; no second validation
GET is added to a stable-origin PUT.

### MODIFY `bin/lib/doctor-providers.ts` — required wp2 scope (A1)

The parent explicitly authorized this implementation-scope expansion. This leaf still edits
only 010. After current line 9 `import { normalizeComfyOrigin } from "../../lib/comfyBridge.js";`, insert:

```ts
import { api88Origin } from "../../lib/api88/origin.js";
```

Before current line 139 `if (credential.keyVocabulary === "minimax") {`, inside
`resolveValidateUrl` (signature at line 138), insert:

```ts
  if (credential.keyVocabulary === "api88-image" || credential.keyVocabulary === "api88-video") {
    return `${api88Origin(runtimeConfig.api88Provider.baseUrl)}/v1/models`;
  }
```

Both 88API vocabularies use the configured host; neither falls back to manifest.validateUrl.
Keep MiniMax and other credential paths unchanged. This is the same pure origin normalizer
used by runtime key validation, so a saved trailing `/v1/` never creates `/v1/v1/models`.

At current line 171, replace:

```ts
      lines.push({ lane: provider.id, code, kind: code === "AUTH_VERIFIED" ? "pass" : "fail", evidence: "remote-auth", text: `${provider.id}: ${code}` });
```

After:

```ts
      const label = credential.keyVocabulary === "api88-image" || credential.keyVocabulary === "api88-video"
        ? `${provider.id} (${credential.keyVocabulary})` : provider.id;
      lines.push({ lane: provider.id, code, kind: code === "AUTH_VERIFIED" ? "pass" : "fail", evidence: "remote-auth", text: `${label}: ${code}` });
```

The two observations retain lane `88api` and label the key kind without exposing its value.
The existing Doctor fixture/test changes are mandatory and specified in §11.

## 4. Image protocol modules

### NEW `lib/api88/download.ts` — full contents

```ts
import { api88Error } from "./errors.js";
import { detectImageMimeFromB64 } from "../refs.js";

export async function downloadApi88Bytes(url: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  if (!/^https:\/\//.test(url)) throw api88Error("API88_DOWNLOAD_FAILED", "88API result URL must use HTTPS", 502);
  try {
    const response = await fetch(url, { signal, redirect: "follow", credentials: "omit" });
    if (!response.ok || !response.body) throw api88Error("API88_DOWNLOAD_FAILED", `88API result download failed (HTTP ${response.status})`, 502);
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body.cancel();
      throw api88Error("API88_DOWNLOAD_TOO_LARGE", "88API result exceeds the download limit", 502);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw api88Error("API88_DOWNLOAD_TOO_LARGE", "88API result exceeds the download limit", 502);
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (typeof (error as { code?: unknown }).code === "string") throw error;
    throw api88Error("API88_DOWNLOAD_FAILED", "88API result download failed", 502);
  }
}

export function parseApi88ImageBytes(bytes: Buffer, maxBytes: number) {
  if (bytes.length === 0 || bytes.length > maxBytes) throw api88Error("API88_IMAGE_INVALID", "88API returned empty or oversized image bytes", 502);
  const b64 = bytes.toString("base64");
  const mime = detectImageMimeFromB64(b64);
  if (!mime) throw api88Error("API88_IMAGE_INVALID", "88API returned non-image bytes", 502);
  return { b64, mime };
}

export async function readApi88Image(value: string, signal: AbortSignal, maxBytes: number) {
  const data = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/);
  if (data) return parseApi88ImageBytes(Buffer.from(data[1]!, "base64"), maxBytes);
  return { ...parseApi88ImageBytes(await downloadApi88Bytes(value, signal, maxBytes), maxBytes), providerUrl: value };
}
```

The input URL string is passed unchanged to fetch, including its query. No Authorization or
provider bearer is attached to download or redirects. wp3 reuses `downloadApi88Bytes` with
the video cap and adds MP4 `ftyp` validation at its result boundary.

### NEW `lib/api88/geminiParse.ts` — full contents

```ts
import { api88Error, api88Record } from "./errors.js";

function candidate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^(?:data:image\/[a-zA-Z0-9.+-]+;base64,|https:\/\/)/.test(value) ? value : undefined;
}

function imagePart(value: unknown): string | undefined {
  const record = api88Record(value);
  return candidate(api88Record(record.image_url).url) ?? candidate(record.url);
}

export function parseApi88GeminiImage(value: unknown): string {
  const body = api88Record(value);
  const first = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const message = api88Record(api88Record(first).message);
  if (Array.isArray(message.images)) {
    for (const image of message.images) { const found = imagePart(image); if (found) return found; }
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (api88Record(part).type !== "image_url") continue;
      const found = imagePart(part); if (found) return found;
    }
  }
  const text = typeof message.content === "string" ? message.content : "";
  for (const match of text.matchAll(/!\[[^\]]*\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|https:\/\/[^\s)]+)\)/g)) {
    const found = candidate(match[1]); if (found) return found;
  }
  const data = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
  if (data) return data[0];
  const url = text.match(/https:\/\/[^\s<>"')]+/);
  if (url) return url[0];
  throw api88Error("API88_EMPTY_RESULT", `88API Gemini response contained no image: ${text.slice(0, 200)}`, 502);
}
```

### NEW `lib/api88/imageTransport.ts` — full contents

```ts
import type { RuntimeContext } from "../runtimeContext.js";
import type { ExecutionReference, SingleImageExecutionResult } from "../providers/execution/types.js";
import { getProvider } from "../providers/registry.js";
import { detectImageMimeFromB64 } from "../refs.js";
import { api88Origin } from "./origin.js";
import { api88Key } from "./catalog.js";
import { api88Error, api88Json, api88Record } from "./errors.js";
import { downloadApi88Bytes, parseApi88ImageBytes, readApi88Image } from "./download.js";
import { parseApi88GeminiImage } from "./geminiParse.js";

export interface Api88ImageOptions {
  model?: string | undefined;
  size?: string | undefined;
  requestId?: string | undefined;
  signal?: AbortSignal | undefined;
  references?: ExecutionReference[] | undefined;
  sourceImage?: string | null | undefined;
  providerUrl?: string | null | undefined;
  mask?: string | null | undefined;
}

export function assertApi88ImageModel(model: string): void {
  const row = getProvider("88api").models.find((entry) => entry.kind === "image" && entry.id === model);
  if (!row) throw api88Error("API88_MODEL_UNSUPPORTED", `Unknown 88API image model: ${model}`, 400);
  if ("status" in row && row.status === "unverified") throw api88Error("API88_MODEL_UNVERIFIED", `88API image endpoint is unverified for ${model}`, 400);
}

function normalizedReference(value: string): ExecutionReference {
  const b64 = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  const detectedMime = detectImageMimeFromB64(b64);
  if (!detectedMime) throw api88Error("API88_REFERENCE_INVALID", "88API reference is not a supported image", 400);
  return { b64, declaredMime: detectedMime, detectedMime };
}

async function references(ctx: RuntimeContext, options: Api88ImageOptions, signal: AbortSignal) {
  const refs = (options.references ?? []).map((ref) => normalizedReference(ref.b64));
  if (options.sourceImage) refs.unshift(normalizedReference(options.sourceImage));
  else if (options.providerUrl) {
    const image = parseApi88ImageBytes(await downloadApi88Bytes(options.providerUrl, signal, ctx.config.api88Provider.maxImageBytes), ctx.config.api88Provider.maxImageBytes);
    refs.unshift(normalizedReference(image.b64));
  }
  if (refs.length > ctx.config.limits.maxRefCount) throw api88Error("API88_REF_TOO_MANY", `88API input exceeds the application reference limit ${ctx.config.limits.maxRefCount}`, 400);
  return refs;
}

function gptBody(model: string, prompt: string, size: string, refs: ExecutionReference[]): RequestInit {
  const supportedSize = ["1024x1024", "1536x1024", "1024x1536"].includes(size) ? size : "1024x1024";
  if (refs.length === 0) return {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size: supportedSize, n: 1 }),
  };
  const form = new FormData();
  form.set("model", model); form.set("prompt", prompt); form.set("n", "1"); form.set("size", supportedSize);
  for (const [index, ref] of refs.entries()) {
    const bytes = new Uint8Array(Buffer.from(ref.b64, "base64"));
    form.append("image[]", new Blob([bytes], { type: ref.detectedMime ?? "image/png" }), `reference-${index}`);
  }
  return { method: "POST", body: form };
}

function geminiBody(model: string, prompt: string, refs: ExecutionReference[]): RequestInit {
  const content = refs.length ? [
    { type: "text", text: prompt },
    ...refs.map((ref) => ({ type: "image_url", image_url: { url: `data:${ref.detectedMime};base64,${ref.b64}` } })),
  ] : prompt;
  return { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }] }) };
}

function imageValue(body: unknown): { value: string; revisedPrompt?: string } {
  const data = api88Record(body).data;
  const first = api88Record(Array.isArray(data) ? data[0] : undefined);
  const value = typeof first.b64_json === "string" && first.b64_json
    ? `data:image/png;base64,${first.b64_json}` : typeof first.url === "string" ? first.url : "";
  if (!value) throw api88Error("API88_EMPTY_RESULT", "88API image response contained no data[0] image", 502);
  return { value, ...(typeof first.revised_prompt === "string" ? { revisedPrompt: first.revised_prompt } : {}) };
}

function deadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

export async function generateViaApi88Image(prompt: string, ctx: RuntimeContext, options: Api88ImageOptions = {}): Promise<SingleImageExecutionResult> {
  const model = options.model ?? ctx.config.api88Provider.defaultImageModel;
  assertApi88ImageModel(model);
  if (options.mask) throw api88Error("API88_MASK_UNSUPPORTED", "88API image masks are unsupported", 400);
  const key = api88Key(ctx, "image");
  if (!key) throw api88Error("API88_IMAGE_KEY_MISSING", "88API image key missing", 401);
  const cfg = ctx.config.api88Provider;
  const signal = deadline(options.signal, cfg.imageTimeoutMs);
  try {
    signal.throwIfAborted();
    const refs = await references(ctx, options, signal);
    const gpt = model.startsWith("gpt-image-");
    const path = gpt ? refs.length ? "/v1/images/edits" : "/v1/images/generations" : "/v1/chat/completions";
    const init = gpt ? gptBody(model, prompt, options.size ?? "1024x1024", refs) : geminiBody(model, prompt, refs);
    const body = await api88Json(`${api88Origin(cfg.baseUrl)}${path}`, key, { ...init, signal });
    const result = gpt ? imageValue(body) : { value: parseApi88GeminiImage(body) };
    const image = await readApi88Image(result.value, deadline(signal, cfg.imageDownloadTimeoutMs), cfg.maxImageBytes);
    return { ...image, ...("revisedPrompt" in result ? { revisedPrompt: result.revisedPrompt } : {}), usage: null, webSearchCalls: 0 };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) throw api88Error("API88_IMAGE_TIMEOUT", "88API image request timed out", 504);
    throw error;
  }
}
```

## 5. Adapter, admission, normalization and image surfaces

### NEW `lib/providers/adapters/88api.ts` — full contents

```ts
import type { RuntimeContext } from "../../runtimeContext.js";
import { generateViaApi88Image } from "../../api88/imageTransport.js";
import { api88Key } from "../../api88/catalog.js";
import { getProvider } from "../registry.js";
import type { CoreProviderModel } from "../types.js";
import type { ProviderAdapterV1, ProviderError } from "./types.js";
import type { ExecutionSurface, ImageExecutionRequest, PreparedImageExecution, ExecutionProgress } from "../execution/types.js";

function normalizeError(error: unknown): ProviderError {
  const record = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const status = typeof record.status === "number" ? record.status : typeof record.statusCode === "number" ? record.statusCode : undefined;
  const raw = typeof record.code === "string" ? record.code : undefined;
  return {
    code: raw?.startsWith("API88_") ? raw : raw ? `API88_${raw}` : "API88_UNKNOWN",
    message: error instanceof Error ? error.message : typeof error === "string" ? error : "88API request failed",
    ...(status !== undefined ? { status } : {}),
    retryable: status !== undefined && [408, 425, 429, 500, 502, 503, 504].includes(status),
  };
}

export function createApi88Adapter(ctx: RuntimeContext): ProviderAdapterV1 {
  return {
    laneId: "88api",
    validateAuth: () => api88Key(ctx, "image") ? { ok: true } : { ok: false, reason: "88API image key missing" },
    listModels: (): readonly CoreProviderModel[] => getProvider("88api").models,
    normalizeError,
    prepareImageExecution: prepareLaneImageExecution,
  };
}

function prepareSingle(ctx: RuntimeContext, request: Exclude<ImageExecutionRequest, { surface: "multimode" }>): PreparedImageExecution<"classic" | "node" | "edit"> {
  return { execute: async () => {
    const sourceImage = request.surface === "classic" ? undefined : request.sourceImage;
    const refs = request.surface === "node" && request.contextMode === "parent-only" ? [] : request.references;
    const value = await generateViaApi88Image(request.prompt, ctx, {
      model: request.options.model, size: request.options.size, references: refs, sourceImage,
      requestId: request.requestId, signal: request.signal,
      providerUrl: request.surface === "classic" ? request.providerUrl : undefined,
      mask: request.surface === "edit" ? request.mask : undefined,
    });
    return { kind: "single", value };
  } };
}

function prepareMultimode(ctx: RuntimeContext, request: Extract<ImageExecutionRequest, { surface: "multimode" }>): PreparedImageExecution<"multimode"> {
  return { execute: async () => {
    const result = await generateViaApi88Image(request.prompt, ctx, {
      model: request.options.model, size: request.options.size, references: request.references,
      requestId: request.requestId, signal: request.signal, providerUrl: request.providerUrl,
    });
    return { kind: "sequence", value: {
      images: [{ b64: result.b64, mime: result.mime,
        ...(result.revisedPrompt !== undefined ? { revisedPrompt: result.revisedPrompt } : {}),
        ...(result.providerUrl ? { providerUrl: result.providerUrl } : {}) }],
      usage: result.usage, webSearchCalls: result.webSearchCalls,
    } };
  } };
}

function prepareLaneImageExecution<R extends ImageExecutionRequest>(ctx: RuntimeContext, request: R, progress?: ExecutionProgress): Promise<PreparedImageExecution<R["surface"]>>;
async function prepareLaneImageExecution(ctx: RuntimeContext, request: ImageExecutionRequest, _progress?: ExecutionProgress): Promise<PreparedImageExecution<ExecutionSurface>> {
  return request.surface === "multimode" ? prepareMultimode(ctx, request) : prepareSingle(ctx, request);
}
```

Descriptor lists all 35 registered models (adapter contract); DTO owns visibility, kind split,
live intersection and execution locks. Adapter `validateAuth` reports image execution auth,
not whole-lane readiness. No model literals appear in the descriptor.

### MODIFY `lib/providers/adapters/index.ts`

After line 11 `import { createAtlasCloudAdapter } from "./atlascloud.js";`, insert:

```ts
import { createApi88Adapter } from "./88api.js";
```

After line 24 `atlascloud: createAtlasCloudAdapter,`, insert:

```ts
  "88api": createApi88Adapter,
```

### MODIFY `lib/imageModels.ts`

At line 54 anchor `const VALID_ATLASCLOUD_IMAGE_MODELS = deriveModels("atlascloud", "image");`, insert after:

```ts
const validApi88ImageModels = deriveSupportedImageModels("88api");
const registeredApi88ImageModels = deriveModels("88api", "image");

export function normalizeApi88ImageModel(rawModel: unknown) {
  if (typeof rawModel === "string" && validApi88ImageModels.has(rawModel)) return { model: rawModel };
  const unverified = typeof rawModel === "string" && registeredApi88ImageModels.has(rawModel);
  return { error: unverified ? `88API model is unverified: ${rawModel}` : `Unknown 88API image model: ${String(rawModel)}`,
    code: unverified ? "API88_MODEL_UNVERIFIED" : "API88_MODEL_UNSUPPORTED", status: 400 };
}
```

### MODIFY `lib/providerOptions.ts`

Append import at line 4's import block:

```ts
import { normalizeApi88ImageModel } from "./imageModels.js";
```

Insert before line 47 `if (provider === "atlascloud") {`:

```ts
  if (provider === "88api") {
    const checked = normalizeApi88ImageModel(rawModel ?? ctx?.config.api88Provider.defaultImageModel ?? "gpt-image-2");
    if (checked.error !== undefined) return { error: checked.error, code: checked.code, status: checked.status };
    return { provider: "88api" as const, model: checked.model, reasoningEffort: "none",
      size: rawSize || "1024x1024", webSearchEnabled: false };
  }
```

### MODIFY `lib/providers/execution/admission.ts`

Line 10 current `code: "GROK_API_KEY_MISSING" | "GROK_AUTH_REQUIRED" | "NAI_REF_UNSUPPORTED";` becomes:

```ts
  code: "GROK_API_KEY_MISSING" | "GROK_AUTH_REQUIRED" | "NAI_REF_UNSUPPORTED" | "API88_IMAGE_KEY_MISSING";
```

Insert before line 21 `if (provider === "grok-api") {`:

```ts
  if (provider === "88api") {
    if (ctx.api88ImageKey?.trim()) return null;
    return { status: 401, code: "API88_IMAGE_KEY_MISSING", message: "88API image key missing" };
  }
```

Transport rechecks live context at execute, so deleting a key after preparation fails closed.

### MODIFY `lib/capabilities.ts`

At line 17 import anchor `import { deriveProviderIds, getProviderSurfaceSupport } from "./providers/derive.js";`, replace:

```ts
import { deriveProviderIds, deriveSupportedImageModels, getProviderSurfaceSupport } from "./providers/derive.js";
```

After line 124 `atlasCloudSupported: ["openai/gpt-image-2/text-to-image", "openai/gpt-image-2/edit"],`, insert:

```ts
        api88Supported: [...deriveSupportedImageModels("88api")],
```

### MODIFY `lib/errors/providerMap.ts`

At line 20 anchor `export const PROVIDER_ERROR_MAP = {`, insert these entries immediately inside:

```ts
  API88_IMAGE_KEY_MISSING: "AUTH_INVALID",
  API88_VIDEO_KEY_MISSING: "AUTH_INVALID",
  API88_AUTH_FAILED: "AUTH_INVALID",
  API88_RATE_LIMITED: "RATE_LIMITED",
  API88_REQUEST_FAILED: "NETWORK_FAILURE",
  API88_NETWORK_FAILED: "NETWORK_FAILURE",
  API88_RESPONSE_INVALID: "INTERNAL_STATE_ERROR",
  API88_CATALOG_INVALID: "INTERNAL_STATE_ERROR",
  API88_BASE_URL_INVALID: "CAPABILITY_UNSUPPORTED",
  API88_BASE_URL_ENV_LOCKED: "CAPABILITY_UNSUPPORTED",
  API88_MODEL_UNVERIFIED: "MODEL_UNAVAILABLE",
  API88_MODEL_UNSUPPORTED: "MODEL_UNAVAILABLE",
  API88_VIDEO_NOT_READY: "CAPABILITY_UNSUPPORTED",
  API88_MASK_UNSUPPORTED: "CAPABILITY_UNSUPPORTED",
  API88_REFERENCE_INVALID: "CAPABILITY_UNSUPPORTED",
  API88_REF_TOO_MANY: "CAPABILITY_UNSUPPORTED",
  API88_EMPTY_RESULT: "INTERNAL_STATE_ERROR",
  API88_IMAGE_INVALID: "INTERNAL_STATE_ERROR",
  API88_IMAGE_TIMEOUT: "PROVIDER_TIMEOUT",
  API88_DOWNLOAD_FAILED: "NETWORK_FAILURE",
  API88_DOWNLOAD_TOO_LARGE: "CAPABILITY_UNSUPPORTED",
  API88_UNKNOWN: "INTERNAL_STATE_ERROR",
```

Insert inside `STATUS_DEPENDENT_CODES` at line 163 before `GROK_VIDEO_REQUEST_FAILED`:

```ts
  API88_REQUEST_FAILED: { clientError: "CAPABILITY_UNSUPPORTED", serverError: "NETWORK_FAILURE" },
```

At `statusForErrorCode` line 5 before the first Grok condition, insert:

```ts
  if (code === "API88_IMAGE_KEY_MISSING" || code === "API88_VIDEO_KEY_MISSING" || code === "API88_AUTH_FAILED") return 401;
  if (code === "API88_IMAGE_TIMEOUT") return 504;
```

The video-key-missing literal is emitted by the kind-scoped model DTO below; no wp3 polling
codes are pre-mapped here. Request status mapping distinguishes 429 and 4xx/5xx.

### MODIFY image callers: precise MIME and dispatch edits

Each following row supplies the verified current anchor and exact after-code. Do not add
88API to any forced-JPEG initializer or alpha-capable-provider list.

| MODIFY path and anchor | Current snippet | Exact after-code |
|---|---|---|
| `lib/generatePipeline.ts:483` | `const providerReportsMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai" || activeProvider === "comfy";` | `const providerReportsMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai" || activeProvider === "comfy";` |
| `lib/multimodePipeline.ts:309` | `const resultMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai"` | `const resultMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai"` |
| `lib/multimodePipeline.ts:312` | `const resultFormat = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai" ? imageFormatFromMime(resultMime) : mmFormat;` | `const resultFormat = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai" ? imageFormatFromMime(resultMime) : mmFormat;` |
| `lib/nodeGeneration.ts:312` | `if (activeProvider === "grok" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai") {` | `if (activeProvider === "grok" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai") {` |
| `routes/edit.ts:280` | `const editMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai"` | `const editMime = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai"` |
| `routes/edit.ts:283` | `const editExt = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "minimax" || activeProvider === "nai" ? imageFormatFromMime(editMime) : "png";` | `const editExt = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "grok-api" || activeProvider === "gemini-api" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai" ? imageFormatFromMime(editMime) : "png";` |

### MODIFY `lib/nodeReferences.ts`

At line 27 `function providerLimitFailure(provider: CoreProviderId, limit: number): ReferenceFailure {`, insert inside:

```ts
  if (provider === "88api") return { status: 400, code: "API88_REF_TOO_MANY",
    message: `88API input exceeds the application reference limit ${limit}.` };
```

Replace lines 84–85 current:

```ts
  const providerLimit = deriveReferenceLimit(provider, "edit");
  if (cappedProvider(provider) && providerLimit !== undefined && inputImageCount > providerLimit) {
```

After:

```ts
  const providerLimit = provider === "88api" ? ctx.config.limits.maxRefCount : deriveReferenceLimit(provider, "edit");
  if ((provider === "88api" || cappedProvider(provider)) && providerLimit !== undefined && inputImageCount > providerLimit) {
```

Do not add 88API to `usesParentOnlyUserReferences`: the adapter explicitly drops those refs.

In `lib/nodeGeneration.ts:280`, current `const maxAttempts = inputImageCount > 0 ? 1 : 2;`
must also become exactly:

```ts
      const maxAttempts = activeProvider === "88api" || inputImageCount > 0 ? 1 : 2;
```

Otherwise a root node retries 5xx/empty-image transport failures through the existing generic
loop (`lib/generationErrors.ts:133–138`), despite this transport itself making one POST.

### MODIFY `routes/edit.ts`: mask identity

Replace the full current ternaries at lines 211–212:

```ts
        const code = activeProvider === "agy" ? "AGY_MASK_UNSUPPORTED" : activeProvider === "gemini-api" ? "GEMINI_API_MASK_UNSUPPORTED" : activeProvider === "atlascloud" ? "ATLASCLOUD_MASK_UNSUPPORTED" : activeProvider === "minimax" ? "MINIMAX_MASK_UNSUPPORTED" : activeProvider === "nai" ? "NAI_MASK_UNSUPPORTED" : activeProvider === "comfy" ? "COMFY_MASK_UNSUPPORTED" : "GROK_MASK_UNSUPPORTED";
        const label = activeProvider === "agy" ? "Agy" : activeProvider === "gemini-api" ? "Gemini API" : activeProvider === "atlascloud" ? "Atlas Cloud" : activeProvider === "minimax" ? "MiniMax" : activeProvider === "nai" ? "NovelAI" : activeProvider === "comfy" ? "ComfyUI" : "Grok";
```

After:

```ts
        const code = activeProvider === "88api" ? "API88_MASK_UNSUPPORTED" : activeProvider === "agy" ? "AGY_MASK_UNSUPPORTED" : activeProvider === "gemini-api" ? "GEMINI_API_MASK_UNSUPPORTED" : activeProvider === "atlascloud" ? "ATLASCLOUD_MASK_UNSUPPORTED" : activeProvider === "minimax" ? "MINIMAX_MASK_UNSUPPORTED" : activeProvider === "nai" ? "NAI_MASK_UNSUPPORTED" : activeProvider === "comfy" ? "COMFY_MASK_UNSUPPORTED" : "GROK_MASK_UNSUPPORTED";
        const label = activeProvider === "88api" ? "88API" : activeProvider === "agy" ? "Agy" : activeProvider === "gemini-api" ? "Gemini API" : activeProvider === "atlascloud" ? "Atlas Cloud" : activeProvider === "minimax" ? "MiniMax" : activeProvider === "nai" ? "NovelAI" : activeProvider === "comfy" ? "ComfyUI" : "Grok";
```

### MODIFY `lib/agentImageVideoGen.ts`

After line 15 import of `generateViaAtlasCloud`, insert:

```ts
import { generateViaApi88Image } from "./api88/imageTransport.js";
import { api88Error } from "./api88/errors.js";
```

Before line 122 `: activeProvider === "minimax"`, insert this ternary arm:

```ts
    : activeProvider === "88api"
    ? await generateViaApi88Image(`${manifest}\n\nUser request:\n${prompt}`, ctx, {
        model: effectiveModel, size: providerOptions.size, requestId, signal: options.signal ?? undefined,
        references: (await loadAgentCurrentImageReferences(ctx, sessionId, options.sourceImagePolicy ?? "none"))
          .map((ref) => ({ b64: ref.b64, declaredMime: ref.declaredMime ?? null, detectedMime: ref.detectedMime ?? null })),
      })
```

Replace line 170 with:

```ts
  const format = activeProvider === "grok" || activeProvider === "agy" || activeProvider === "atlascloud" || activeProvider === "88api" || activeProvider === "minimax" || activeProvider === "nai"
```

Current line 170 is the identical expression without `|| activeProvider === "88api"`.
`AgentRunOptions.signal` is nullable (`lib/agentRuntime.ts:37`); its image-reference MIME
fields are optional (`lib/grokImageCore.ts:58–62`). The arm above explicitly normalizes both.

Inside `generateAgentImageWithRetry`, before line 57 `lastError = error;` (catch at line 56), insert:

```ts
      if (options.provider === "88api") throw error;
```

This must precede `isTextOnlyResult(error)` at line 58: the Gemini raw-text excerpt may contain
`"No image data"`, which `lib/agentRuntime.ts:385–387` otherwise treats as permission to
submit again. 88API always rethrows the original error and never enters the generic Agent
resubmission path. The concrete one-POST regression in §10 exercises that exact excerpt.

Agent video execution remains excluded. Inside `runAgentVideoGeneration` (current signature
at lines 274–279), insert before line 280 `const session = getAgentSession(sessionId);`:

```ts
  if (options.provider === "88api") throw api88Error("API88_VIDEO_NOT_READY", "88API Agent video execution is unsupported", 400);
```

This is a refusal boundary, not an Agent video implementation. It prevents the existing
Grok-only Agent video dispatch from silently using a different lane when 88API is selected.

## 6. Public model DTO and temporary video refusal

### MODIFY `routes/models.ts`

At line 7 import anchor `import { getProviderAdapter } from "../lib/providers/adapters/index.js";`, append:

```ts
import { api88Lane } from "./modelsApi88.js";
```

After line 316 `atlascloud: atlasCloudLane(ctx),`, insert:

```ts
    "88api": await api88Lane(ctx),
```

No new helper body is inserted into the already oversized `routes/models.ts`.

### NEW `routes/modelsApi88.ts` — full contents

```ts
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { getProvider } from "../lib/providers/registry.js";
import { api88Key, getApi88Catalog } from "../lib/api88/catalog.js";
import type { ProviderModelKind } from "../lib/providers/types.js";
import type { McpModelEntry } from "../lib/mcp/modelCapabilities.js";
import type { ModelLaneDto } from "./models.js";

async function api88Models(ctx: RuntimeContext, kind: ProviderModelKind): Promise<McpModelEntry[]> {
  const live = await getApi88Catalog(ctx, kind);
  const key = api88Key(ctx, kind);
  const rows = getProvider("88api").models.filter((model) => model.kind === kind
    && !("status" in model && model.status === "unverified") && model.supports.generate
    && (live === null || live.has(model.id)));
  return rows.map((model): McpModelEntry => {
    const lockReason = !key ? kind === "image" ? "API88_IMAGE_KEY_MISSING" : "API88_VIDEO_KEY_MISSING"
      : kind === "video" ? "API88_VIDEO_NOT_READY" : undefined;
    return {
      id: model.id, label: model.id,
      capabilities: { source: "verified-contract", aspectRatios: [], parameters: [],
        inputRoles: kind === "image" ? ["text", "image_references"] : ["text"] },
      executable: lockReason === undefined,
      ...(lockReason ? { lockReason } : {}),
    };
  });
}

export async function api88Lane(ctx: RuntimeContext): Promise<ModelLaneDto> {
  const [image, video] = await Promise.all([api88Models(ctx, "image"), api88Models(ctx, "video")]);
  const configured = Boolean(api88Key(ctx, "image") || api88Key(ctx, "video"));
  return {
    status: configured ? "ready" : "key-missing",
    ...(!configured ? { reason: "88API image or video key missing" } : {}),
    defaults: { image: ctx.config.api88Provider.defaultImageModel, video: ctx.config.api88Provider.defaultVideoModel },
    models: { image, video },
  };
}
```

The existing surface decoration (lines 321–326) produces `video.supported: false`. Do not
mark catalogAccess runtime: this curated registry is nonempty; live intersection is an
availability projection, not the Comfy user-authored runtime-catalog schema.
`ModelLaneDto` is imported as a type only; the new module does not call the private `lane`
or `capabilities` functions and creates no runtime import cycle with `routes/models.ts`.

### MODIFY `routes/video.ts`

Immediately after line 174:

```ts
      const { prompt, provider = "grok", model: rawModel } = req.body || {};
```

Insert:

```ts
      if (provider === "88api") return fail(400, "API88_VIDEO_NOT_READY", "88API video execution is available after wp3");
```

Must precede provider validation, Grok parameter normalization, admission and credential
resolution. Both async and legacy error envelopes use existing `fail`.

## 7. Generated UI types and image selection

### MODIFY `ui/src/generated/providers.ts` (generated, not hand edited)

Anchor line 1 `// Generated by scripts/generate-provider-types.mjs. Do not edit.` and
line 6 `export const CORE_PROVIDER_IDS = [`. Apply through the existing generator only:

```sh
node scripts/generate-provider-types.mjs
```

`scripts/generate-provider-types.mjs:34–69` needs no source change. It loads the registry
and pure surface module and already uses D4's global supported/unsupported calculation.
The exact added per-lane after-code is:

```ts
  "88api": {
    "image": [
      "gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image",
      "gemini-nano-banana-2.1", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
      "grok-imagine-edit", "grok-imagine-image", "grok-imagine-image-quality"
    ],
    "video": [
      "gemini-omni-flash", "grok-imagine-video", "grok-imagine-video-1.5",
      "kling-3.0-turbo-720p", "kling-3.0-turbo-1080p", "kling-3.0-turbo-2k", "kling-3.0-turbo-4k",
      "minimax-h3-768p", "SD2.0 480P", "SD2.0 720P", "SD2.0 1080P", "SD2.0 4k",
      "SD2.5 480P", "SD2.5 720P", "SD2.5 1080P", "Seedance-2.0-720p官方版",
      "Seedance-2.0-fast-720p官方版", "Seedance-2.5-720p官方版", "seedance-2.0-mini-480p",
      "seedance-2.0-mini-720p", "veo-3.1", "veo-3.1-fast", "wan3.0-video-480p",
      "wan3.0-video-720p", "wan3.0-video-1080p"
    ]
  },
```

The generator prints each literal on its own line. Exact additional surface row:

```ts
  "88api": {
    "generate": {"supported":true,"references":true,"mask":false,"streaming":false,"catalogAccess":"static"},
    "edit": {"supported":true,"references":true,"mask":false,"streaming":false,"catalogAccess":"static"},
    "multimode": {"supported":true,"references":true,"mask":false,"streaming":false,"catalogAccess":"static"},
    "node": {"supported":true,"references":true,"mask":false,"streaming":false,"catalogAccess":"static"},
    "video": {"supported":false,"references":false,"mask":false,"streaming":false,"catalogAccess":"static"}
  },
```

`CORE_PROVIDER_IDS` inserts `"88api"` after `"atlascloud"`; `PROVIDER_REFERENCE_LIMITS`
adds `"88api": {}`. `IMAGE_MODEL_IDS` adds the seven supported IDs, not the hidden three;
`UNSUPPORTED_IMAGE_MODEL_IDS` becomes `["grok-imagine-edit"]`. `VIDEO_MODEL_IDS` adds the
23 video IDs not already in Grok; its Grok IDs stay deduplicated, with native aliases intact.

### MODIFY `ui/src/lib/imageModels.ts`

Insert after line 47, current Atlas edit row:

```ts
  { value: "openai/gpt-image-2/edit", shortLabel: "atlas edit", fullLabelKey: "settings.imageModel.atlasCloudGptImage2Edit", providerHint: "atlascloud" },
```

Exact new rows:

```ts
  { value: "gpt-image-2", shortLabel: "GPT Image 2", fullLabelKey: "settings.imageModel.api88Gpt2", providerHint: "88api" },
  { value: "gpt-image-2.5-flare", shortLabel: "GPT Image 2.5 Flare", fullLabelKey: "settings.imageModel.api88GptFlare", providerHint: "88api" },
  { value: "gpt-image-2.5-sunburst", shortLabel: "GPT Image 2.5 Sunburst", fullLabelKey: "settings.imageModel.api88GptSunburst", providerHint: "88api" },
  { value: "gemini-3-pro-image", shortLabel: "Gemini 3 Pro", fullLabelKey: "settings.imageModel.api88GeminiPro", providerHint: "88api" },
  { value: "gemini-3.1-flash-image", shortLabel: "Gemini 3.1 Flash", fullLabelKey: "settings.imageModel.api88GeminiFlash", providerHint: "88api" },
  { value: "gemini-3.1-flash-lite-image", shortLabel: "Gemini 3.1 Flash Lite", fullLabelKey: "settings.imageModel.api88GeminiLite", providerHint: "88api" },
  { value: "gemini-nano-banana-2.1", shortLabel: "Nano Banana 2.1", fullLabelKey: "settings.imageModel.api88Banana21", providerHint: "88api" },
```

Insert after line 57 `const ATLASCLOUD_MODEL_VALUES = new Set<string>(PROVIDER_MODELS.atlascloud.image);`:

```ts
export const API88_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter((option) => option.providerHint === "88api");
export function isApi88ImageModel(value: unknown): value is ImageModel {
  return API88_IMAGE_MODEL_OPTIONS.some((option) => option.value === value);
}
```

Replace line 81 current `option.value.startsWith("grok-"),` with:

```ts
  option.value.startsWith("grok-") && option.providerHint !== "88api",
```

Replace line 86 current `GEMINI_MODEL_VALUES.has(option.value),` with:

```ts
    GEMINI_MODEL_VALUES.has(option.value) && option.providerHint !== "88api",
```

Before line 145 `if (provider === "atlascloud") return ATLASCLOUD_IMAGE_MODEL_OPTIONS;`, insert:

```ts
  if (provider === "88api") return API88_IMAGE_MODEL_OPTIONS;
```

After line 158 `if (!value) return null;`, insert:

```ts
  if (provider === "88api") return API88_IMAGE_MODEL_OPTIONS.find((option) => option.value === value)?.shortLabel ?? value;
```

No wp2 changes to `VIDEO_MODEL_OPTIONS`, `normalizeVideoModelValue`, `resolveCoreModelValue`
or xAI aliases/duration rules. These remain native-Grok scoped until wp3.

### MODIFY `ui/src/lib/coreSelection.ts`

After line 34 `atlascloud: "openai/gpt-image-2/text-to-image", minimax: "image-01",`, insert:

```ts
  "88api": "gpt-image-2",
```

At line 3's imageModels import append a separate import:

```ts
import { isApi88ImageModel } from "./imageModels";
```

Replace lines 48–51:

```ts
function staticImage(provider: Provider, value: unknown): value is ImageModel {
  return typeof value === "string" && staticIds.has(value)
    && (PROVIDER_MODELS[provider].image as readonly string[]).includes(value);
}
```

After:

```ts
function staticImage(provider: Provider, value: unknown): value is ImageModel {
  return typeof value === "string" && staticIds.has(value)
    && (PROVIDER_MODELS[provider].image as readonly string[]).includes(value)
    && (provider !== "88api" || isApi88ImageModel(value));
}
```

Replace line 59 provider inference roster with:

```ts
  for (const provider of ["grok", "agy", "atlascloud", "88api", "minimax", "nai"] as const) {
```

Explicit provider precedence is retained, shared Grok IDs still infer native Grok, and
hidden 88API persisted picks reconcile to `gpt-image-2`. Video restoration remains false
for 88API throughout wp2; wp3 changes memory, selection and generation together.

### MODIFY `ui/src/store/storeHelpers.ts`

Line 375 current hosted-provider exclusion (shown in §5's analogous MIME expressions)
becomes exactly:

```ts
  if (state.provider === "grok" || state.provider === "grok-api" || state.provider === "agy" || state.provider === "gemini-api" || state.provider === "atlascloud" || state.provider === "88api" || state.provider === "minimax" || state.provider === "nai") return null;
```

Current snippet is this line with `|| state.provider === "88api"` absent. No custom-pixel
normalization is forwarded to this hosted transport.

## 8. Settings, availability and picker projections

### MODIFY `ui/src/hooks/useKeyStatus.ts`

Line 12 current `export type KeyStatus = Record<"openai" | "xai" | "gemini" | "atlascloud" | "minimax" | "nai" | "vertex", KeyStatusEntry> & {` becomes:

```ts
export type KeyStatus = Record<"openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai" | "vertex", KeyStatusEntry> & {
```

### MODIFY `ui/src/components/ApiKeyInput.tsx`

Line 6 current `provider: "openai" | "xai" | "gemini" | "atlascloud" | "minimax" | "nai";` becomes:

```ts
  provider: "openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai";
```

PUT/DELETE construction at lines 32 and 57 stays unchanged; no prefix-based provider inference.

### NEW `ui/src/components/Api88Settings.tsx` — full contents

```tsx
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { KeyStatus } from "../hooks/useKeyStatus";
import { fetchApi } from "../lib/api-core";
import { ApiKeyInput } from "./ApiKeyInput";

type Config = { baseUrl: string; source: "env" | "config" | "default" };
type Props = { keyStatus: KeyStatus; onSaved: () => void };

function Api88Keys({ keyStatus, onSaved }: Props) {
  const { t } = useI18n();
  return <>
    <ApiKeyInput provider="api88-image" label={t("settings.api88.imageKey")}
      placeholder={t("settings.api88.keyPlaceholder")}
      maskedKey={keyStatus["api88-image"]?.maskedKey ?? null}
      source={keyStatus["api88-image"]?.source ?? "none"}
      configured={keyStatus["api88-image"]?.configured ?? false} onSaved={onSaved} />
    <ApiKeyInput provider="api88-video" label={t("settings.api88.videoKey")}
      placeholder={t("settings.api88.keyPlaceholder")}
      maskedKey={keyStatus["api88-video"]?.maskedKey ?? null}
      source={keyStatus["api88-video"]?.source ?? "none"}
      configured={keyStatus["api88-video"]?.configured ?? false} onSaved={onSaved} />
  </>;
}

function UrlField({ config, value, setValue, save, busy, error }: {
  config: Config | null; value: string; setValue: (value: string) => void;
  save: () => Promise<void>; busy: boolean; error: string | null;
}) {
  const { t } = useI18n();
  return <div className="settings-row">
    <div className="settings-row__copy"><h4>{t("settings.api88.baseUrl")}</h4>
      <p>{t("settings.api88.baseUrlHelp")}</p>
      <p>{config?.source === "env" ? t("settings.api88.sourceEnv") : config?.source === "config"
        ? t("settings.api88.sourceConfig") : t("settings.api88.sourceDefault")}</p>
    </div>
    <div className="settings-row__control">
      <label htmlFor="api88-base-url">{t("settings.api88.baseUrl")}</label>
      <input id="api88-base-url" type="url" value={value} disabled={!config || config.source === "env" || busy}
        onChange={(event) => setValue(event.target.value)} />
      <button type="button" className="settings-action-btn" disabled={!config || config.source === "env" || busy || value === config.baseUrl}
        onClick={() => void save()}>{t("settings.apiKeys.save")}</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </div>;
}

export function Api88Settings(props: Props) {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchApi("/api/config/88api").then(async (response) => {
      if (!response.ok) throw new Error("config unavailable");
      const dto = await response.json() as Config;
      if (active) { setConfig(dto); setValue(dto.baseUrl); }
    }).catch(() => { if (active) setError(t("settings.api88.loadFailed")); });
    return () => { active = false; };
  }, [t]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetchApi("/api/config/88api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: value }) });
      const dto = await response.json() as Config & { code?: string };
      if (!response.ok) { setError(dto.code === "API88_BASE_URL_ENV_LOCKED" ? t("settings.api88.sourceEnv") : t("settings.api88.saveFailed")); return; }
      setConfig(dto); setValue(dto.baseUrl); props.onSaved();
    } catch { setError(t("settings.apiKeys.networkError")); }
    finally { setBusy(false); }
  };
  return <section aria-label="88API">
    <Api88Keys {...props} />
    <UrlField config={config} value={value} setValue={setValue} save={save} busy={busy} error={error} />
  </section>;
}
```

No production endpoint text is leaked into generation controls. `settings.apiKeys.save` exists; use
the existing settings classes. This component displays independent key inputs and an ordinary
URL field; env source disables edits and server 409 remains authoritative.

### MODIFY `ui/src/components/AccountSettings.tsx`

After line 10 import of QuotaCard, append:

```ts
import { Api88Settings } from "./Api88Settings";
import { refreshLaneCatalog } from "../lib/laneCatalog";
```

After line 58 `const { data: keyStatus, mutate: mutateKeys } = useKeyStatus();`, insert:

```ts
  const refreshApi88 = () => { void mutateKeys(); void refreshLaneCatalog(); };
```

Immediately after lines 207–215's AtlasCloud `<ApiKeyInput ... />`, insert:

```tsx
              <Api88Settings keyStatus={keyStatus} onSaved={refreshApi88} />
```

### MODIFY `ui/src/hooks/useProviderAvailability.ts`

After line 11 import of comfyDisplay, append:

```ts
import { useAppStore } from "../store/useAppStore";
```

After line 16 `hint?: string;`, insert:

```ts
  selectable?: boolean;
```

After line 53 `const atlasCloudKeyOk = keyStatus?.atlascloud?.valid === true;`, insert:

```ts
  const api88ImageOk = keyStatus?.["api88-image"]?.valid === true;
  const api88VideoOk = keyStatus?.["api88-video"]?.valid === true;
  const selectedVideo = useAppStore((state) => state.videoModelSelected);
  const selectedProvider = useAppStore((state) => state.provider);
  const api88VideoSelected = selectedProvider === "88api" && Boolean(selectedVideo);
  const api88Ok = api88VideoSelected ? api88VideoOk : api88ImageOk;
```

Insert before line 86 `minimax: {`:

```ts
    "88api": {
      ok: api88Ok,
      selectable: api88ImageOk || api88VideoOk,
      reason: api88Ok ? "" : api88VideoSelected ? t("provider.api88VideoKeyRequired") : t("provider.api88ImageKeyRequired"),
    },
```

`ok` is operation-kind auth; `selectable` is lane auth. A video-only key can select the lane
but leaves image generation blocked. The selected-video branch is forward compatible; wp2
selection reconciliation never restores video for 88API.

### MODIFY `ui/src/components/GenProviderModelSelect.tsx`

After line 9 `} from "../lib/imageModels";`, insert:

```ts
import { api88PickerModels, api88PickerItem } from "../lib/api88Picker";
```

After line 46 `{ value: "atlascloud", label: "Atlas" },`, insert:

```ts
  { value: "88api", label: "88API" },
```

Replace lines 180–181 current static model projection:

```ts
  const coreModels = getImageModelOptionsForProvider(provider)
    .filter((option) => option.providerHint === undefined || option.providerHint === provider);
```

After:

```ts
  const coreModels = api88PickerModels(provider, getImageModelOptionsForProvider(provider), laneSnapshot.phase, laneCatalog[provider]?.models.image);
```

Replace lines 387–390 current `coreModels.map` projection:

```ts
        : coreModels.map((option) => ({
          value: option.value,
          label: option.shortLabel,
        })),
```

After:

```ts
        : coreModels.map((option) => api88PickerItem(provider, option, laneCatalog[provider]?.models.image)),
```

Replace line 407 current `if (providerSupportsVideo || videoModel) {` with:

```ts
    if (providerSupportsVideo || (videoModel && (provider === "grok" || provider === "grok-api"))) {
```

Replace line 433 current `...(provider === "comfy" ? { disabled: true } : {}),` with:

```ts
          ...(provider === "comfy" || provider === "88api" ? { disabled: true } : {}),
```

A hidden/stale 88API value may be rendered as a disabled selected-value fallback, never an
enabled option. Surface video false prevents execution despite 25 registered rows.

### NEW `ui/src/lib/api88Picker.ts` — full contents

```ts
import type { Provider } from "../types";
import type { ComfyLaneModel } from "./api-comfy";
import type { getImageModelOptionsForProvider } from "./imageModels";

type ImageOption = ReturnType<typeof getImageModelOptionsForProvider>[number];

export function api88PickerModels(
  provider: Provider, options: readonly ImageOption[], phase: string, rows?: readonly ComfyLaneModel[],
): ImageOption[] {
  return options.filter((option) => option.providerHint === undefined || option.providerHint === provider)
    .filter((option) => provider !== "88api" || phase !== "ready"
      || Boolean(rows?.some((entry) => entry.id === option.value)));
}

export function api88PickerItem(provider: Provider, option: ImageOption, rows?: readonly ComfyLaneModel[]) {
  const entry = rows?.find((model) => model.id === option.value);
  return { value: option.value, label: option.shortLabel,
    ...(provider === "88api" && entry?.executable === false
      ? { disabled: true, ...(entry.lockReason ? { title: entry.lockReason } : {}) } : {}) };
}
```

Filtering and row-lock projection live here; GenProviderModelSelect receives only import,
label and call-site wiring under the parent's explicit existing-file size exception.

### MODIFY `ui/src/components/ImageModelSelect.tsx`

Replace current lines 45–47:

```ts
  const getMenuItems = () => menuItemRefs.current.filter(
    (item): item is HTMLButtonElement => item !== null,
  );
```

After:

```ts
  const getMenuItems = () => menuItemRefs.current.filter(
    (item): item is HTMLButtonElement => item !== null && !item.disabled,
  );
```

Replace current lines 167–169:

```ts
    const triggerEffort = isGeminiImageModel(imageModel)
      ? current.shortLabel.split(" ")[1] || ""
      : currentReasoning.shortLabel;
```

After:

```ts
    const triggerEffort = provider === "88api" ? "" : isGeminiImageModel(imageModel)
      ? current.shortLabel.split(" ")[1] || ""
      : currentReasoning.shortLabel;
```

This removes the inherited reasoning badge for 88API; arrow-key and initial-focus navigation
both use the filtered enabled-button list.

At line 5 imports append a separate import:

```ts
import { API88_IMAGE_MODEL_OPTIONS } from "../lib/imageModels";
import { useLaneCatalog } from "../hooks/useLaneCatalog";
```

After line 35 `const setReasoningEffort = useAppStore((s) => s.setReasoningEffort);`, insert:

```ts
  const laneSnapshot = useLaneCatalog();
  const api88Rows = laneSnapshot.catalog?.["88api"]?.models.image;
  const modelAvailable = (option: (typeof IMAGE_MODEL_OPTIONS)[number]) => option.providerHint !== "88api"
    || laneSnapshot.phase !== "ready" || Boolean(api88Rows?.some((entry) => entry.id === option.value && entry.executable !== false));
```

Replace line 155 `const activeIndex = modelOptions.findIndex((option) => option.value === imageModel);` with:

```ts
    const activeIndex = getMenuItems().findIndex((item) => item.getAttribute("aria-checked") === "true");
```

Insert before line 279's `</div>` closing the image group (after Gemini `.map` at 278):

```tsx
              <div className="image-model-select__subsection-title">88API</div>
              {API88_IMAGE_MODEL_OPTIONS.map((option, index) => (
                <button key={`88api:${option.value}`} ref={(node) => {
                  menuItemRefs.current[OPENAI_IMAGE_MODEL_OPTIONS.length + GROK_IMAGE_MODEL_OPTIONS.length + GEMINI_IMAGE_MODEL_OPTIONS.length + index] = node;
                }} type="button" className={`image-model-select__item${provider === "88api" && option.value === imageModel ? " is-active" : ""}`}
                  role="menuitemradio" aria-checked={provider === "88api" && option.value === imageModel}
                  disabled={!modelAvailable(option)} tabIndex={-1} onClick={() => {
                    setProvider("88api"); setImageModel(option.value); setOpen(false);
                  }}><span>{option.shortLabel}</span><small>{t(option.fullLabelKey)}</small></button>
              ))}
```

Replace line 303 `{!isGeminiImageModel(imageModel) && (` with:

```tsx
            {(provider === "oauth" || provider === "api") && (
```

After line 351 `atlascloud: "settings.apiKeys.atlascloud.label",`, insert:

```ts
    "88api": "settings.api88.title",
```

After line 363 `if (!option) return;`, insert:

```ts
          if (!modelAvailable(option)) return;
```

At lines 370–374's return object, after line 372 `label: t(option.fullLabelKey),`, insert:

```ts
              disabled: !modelAvailable(option),
```

Settings retains seven static rows, disabled on missing-kind auth or live exclusion; sidebar
also shows only those seven. Model trigger's existing hint-aware lookup at lines 38–40
already prefers the right row. Existing Grok video group is a native-lane switch, not 88API video.

### MODIFY labels and readiness consumers

| MODIFY path:line | Current anchor | Insert exact after-code after the anchor |
|---|---|---|
| `ui/src/components/settings/ProviderStatusSelect.tsx:30` | `atlascloud: { value: "atlascloud", provider: "Atlas Cloud", method: "API" },` | `"88api": { value: "88api", provider: "88API", method: "API" },` |
| `ui/src/components/ProviderReadinessPopup.tsx:21` | `atlascloud: "Atlas Cloud",` | `"88api": "88API",` |
| `ui/src/components/ResultMetadataModal.tsx:27` | `atlascloud: "Atlas Cloud API",` | `"88api": "88API",` |
| `ui/src/components/home/HomePromptComposer.tsx:19` | `atlascloud: "Atlas Cloud",` | `"88api": "88API",` |

In ProviderStatusSelect replace line 163 current `if (!state.ok) {` with:

```ts
      if (!(next === "88api" ? state.selectable : state.ok)) {
```

In HomePromptComposer replace line 68 current `disabled: !availability.ok && providerValue !== "comfy",` with:

```ts
      disabled: !(availability.selectable ?? availability.ok) && providerValue !== "comfy",
```

In ProviderReadinessPopup replace line 2 current `import { IMAGE_MODEL_OPTIONS } from "../lib/imageModels";` with:

```ts
import { getImageModelOptionsForProvider } from "../lib/imageModels";
```

Replace line 42 current `const imageModelOption = IMAGE_MODEL_OPTIONS.find((option) => option.value === imageModel);` with:

```ts
  const imageModelOption = getImageModelOptionsForProvider(provider).find((option) => option.value === imageModel);
```

Replace lines 103–105 opening the reasoning branch, current:

```tsx
            ) : (
              <>
```

After (in the `isGrok` facts conditional only):

```tsx
            ) : provider === "88api" ? (
              <div><dt>{t("settings.api88.title")}</dt><dd>{t("settings.api88.compatibility")}</dd></div>
            ) : (
              <>
```

### MODIFY `ui/src/components/SettingsWorkspace.tsx`

Replace line 212 current `{t("settings.imageModel.unsupportedHelp")}` with:

```tsx
                    {provider === "88api" ? t("settings.api88.compatibility") : t("settings.imageModel.unsupportedHelp")}
```

Before line 220 `{provider === "grok" ? (`, replace that opener with:

```tsx
              {provider === "88api" ? (
                <article className="settings-row"><div className="settings-row__copy">
                  <h4>{t("settings.api88.title")}</h4><p>{t("settings.api88.compatibility")}</p>
                </div></article>
              ) : provider === "grok" ? (
```

88API never falls into reasoning/search Settings. Transport-specific copy remains in Settings.

## 9. Four dictionaries

### MODIFY `ui/src/i18n/en.json`, `ko.json`, `zh-Hans.json`, `zh-Hant.json`

All four current anchors are `provider.atlasCloudApiKeyRequired` at line 811,
`settings.imageModel.atlasCloudGptImage2Edit` at 1456, and `settings.apiKeys` at 1467.
These are JSON sources; the following are exact JSON members to insert into their named
existing objects (do not create dotted root keys). Add `settings.api88` next to `settings.apiKeys`.
The model members below are identical in all four languages, since they are product names.
The compatibility text below describes wp2. A1 nit 2 is assigned to 020: wp3's owner updates
the video-execution clause in all four locales when enabling video. Do not apply that change
in wp2; this leaf does not edit 020.

```json
"api88Gpt2": "88API GPT Image 2",
"api88GptFlare": "88API GPT Image 2.5 Flare",
"api88GptSunburst": "88API GPT Image 2.5 Sunburst",
"api88GeminiPro": "88API Gemini 3 Pro Image",
"api88GeminiFlash": "88API Gemini 3.1 Flash Image",
"api88GeminiLite": "88API Gemini 3.1 Flash Lite Image",
"api88Banana21": "88API Nano Banana 2.1"
```

`en.json` provider members and settings member:

```json
"api88ImageKeyRequired": "88API image key required",
"api88VideoKeyRequired": "88API video key required"
```

```json
"api88": {
  "title": "88API",
  "imageKey": "88API image key",
  "videoKey": "88API video key",
  "keyPlaceholder": "Enter the key for this media kind",
  "baseUrl": "88API base URL",
  "baseUrlHelp": "Use an HTTPS base URL. Image and video keys are separate.",
  "sourceEnv": "Controlled by IMA2_88API_BASE_URL",
  "sourceConfig": "Saved in server configuration",
  "sourceDefault": "Using the default URL",
  "loadFailed": "Could not load the 88API URL",
  "saveFailed": "Could not save the URL. Enter a valid HTTPS URL.",
  "compatibility": "GPT images use the Images API; Gemini images use chat completions. Masks, transparent backgrounds and video execution are unavailable in this phase."
}
```

`ko.json`:

```json
"api88ImageKeyRequired": "88API 이미지 키 필요",
"api88VideoKeyRequired": "88API 영상 키 필요"
```

```json
"api88": {
  "title": "88API",
  "imageKey": "88API 이미지 키",
  "videoKey": "88API 영상 키",
  "keyPlaceholder": "해당 미디어용 키 입력",
  "baseUrl": "88API 기본 URL",
  "baseUrlHelp": "HTTPS 기본 URL을 입력하세요. 이미지 키와 영상 키는 별도입니다.",
  "sourceEnv": "IMA2_88API_BASE_URL 환경변수에서 설정됨",
  "sourceConfig": "서버 설정에 저장됨",
  "sourceDefault": "기본 URL 사용 중",
  "loadFailed": "88API URL을 불러오지 못했습니다",
  "saveFailed": "URL을 저장하지 못했습니다. 올바른 HTTPS URL을 입력하세요.",
  "compatibility": "GPT 이미지는 Images API, Gemini 이미지는 chat completions를 사용합니다. 이 단계에서는 마스크, 투명 배경, 영상 실행을 지원하지 않습니다."
}
```

`zh-Hans.json`:

```json
"api88ImageKeyRequired": "需要 88API 图像密钥",
"api88VideoKeyRequired": "需要 88API 视频密钥"
```

```json
"api88": {
  "title": "88API",
  "imageKey": "88API 图像密钥",
  "videoKey": "88API 视频密钥",
  "keyPlaceholder": "输入此媒体类型的密钥",
  "baseUrl": "88API 基础 URL",
  "baseUrlHelp": "使用 HTTPS 基础 URL。图像和视频使用独立密钥。",
  "sourceEnv": "由 IMA2_88API_BASE_URL 控制",
  "sourceConfig": "已保存到服务器配置",
  "sourceDefault": "使用默认 URL",
  "loadFailed": "无法加载 88API URL",
  "saveFailed": "无法保存 URL。请输入有效的 HTTPS URL。",
  "compatibility": "GPT 图像使用 Images API，Gemini 图像使用 chat completions。本阶段不支持蒙版、透明背景和视频执行。"
}
```

`zh-Hant.json`:

```json
"api88ImageKeyRequired": "需要 88API 圖像金鑰",
"api88VideoKeyRequired": "需要 88API 影片金鑰"
```

```json
"api88": {
  "title": "88API",
  "imageKey": "88API 圖像金鑰",
  "videoKey": "88API 影片金鑰",
  "keyPlaceholder": "輸入此媒體類型的金鑰",
  "baseUrl": "88API 基礎 URL",
  "baseUrlHelp": "使用 HTTPS 基礎 URL。圖像和影片使用獨立金鑰。",
  "sourceEnv": "由 IMA2_88API_BASE_URL 控制",
  "sourceConfig": "已儲存到伺服器設定",
  "sourceDefault": "使用預設 URL",
  "loadFailed": "無法載入 88API URL",
  "saveFailed": "無法儲存 URL。請輸入有效的 HTTPS URL。",
"compatibility": "GPT 圖像使用 Images API，Gemini 圖像使用 chat completions。本階段不支援遮罩、透明背景和影片執行。"
}
```

## 10. Concrete test files

All stubs replace `globalThis.fetch`, capture `originalFetch`, restore after each test and
throw on unexpected URLs, exactly as `tests/atlascloud-provider-contract.test.ts:7–11,38–58`.
No injected transport fetch. These are implementation-phase files; they were not created or run
by this leaf. Use synthetic credentials only; suite execution must isolate ambient config.

### NEW `tests/api88-provider-contract.test.ts` — full contents

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateViaApi88Image } from "../lib/api88/imageTransport.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { resolveProviderOptions } from "../lib/providerOptions.ts";
import { api88Origin } from "../lib/api88/origin.ts";
import { parseApi88GeminiImage } from "../lib/api88/geminiParse.ts";
import { getProvider } from "../lib/providers/registry.ts";
import { config } from "../config.ts";

const originalFetch = globalThis.fetch;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const b64 = png.toString("base64");
const uri = `data:image/png;base64,${b64}`;
const reference = { b64, declaredMime: "image/png", detectedMime: "image/png" };
function context() {
  return createTestRuntimeContext({ api88ImageKey: "synthetic-image", api88VideoKey: "synthetic-video",
    config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://gateway.example/v1/" } } });
}
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("origin strips one trailing v1 and rejects unsafe configuration shapes", () => {
  assert.equal(api88Origin("https://gateway.example/v1///"), "https://gateway.example");
  assert.equal(api88Origin("http://127.0.0.1:8111/v1"), "http://127.0.0.1:8111");
  for (const value of ["http://public.example", "https://user:pass@gateway.example", "https://gateway.example?q=1", "ftp://gateway.example"]) {
    assert.throws(() => api88Origin(value), { code: "API88_BASE_URL_INVALID" });
  }
});

test("image option normalization preserves IDs and never accepts a video or unverified model", () => {
  const ctx = context();
  const options = resolveProviderOptions(ctx, { provider: "88api", rawModel: "gpt-image-2.5-flare", rawWebSearchEnabled: true, rawReasoningEffort: "high" });
  assert.equal(options.provider, "88api"); assert.equal(options.model, "gpt-image-2.5-flare");
  assert.equal(options.reasoningEffort, "none"); assert.equal(options.webSearchEnabled, false);
  assert.equal(resolveProviderOptions(ctx, { provider: "88api", rawModel: "grok-imagine-image" }).code, "API88_MODEL_UNVERIFIED");
  assert.equal(resolveProviderOptions(ctx, { provider: "88api", rawModel: " gpt-image-2" }).code, "API88_MODEL_UNSUPPORTED");
  assert.equal(resolveProviderOptions(ctx, { provider: "88api", rawModel: "SD2.5 720P" }).code, "API88_MODEL_UNSUPPORTED");
});

test("GPT generation fixes endpoint, image bearer, n and size without quality or response_format", async () => {
  let calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls++;
    assert.equal(String(input), "https://gateway.example/v1/images/generations");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
    assert.deepEqual(JSON.parse(String(init?.body)), { model: "gpt-image-2.5-flare", prompt: "city", size: "1024x1024", n: 1 });
    return Response.json({ data: [{ b64_json: b64 }] });
  }) as typeof fetch;
  const result = await generateViaApi88Image("city", context(), { model: "gpt-image-2.5-flare", size: "1792x1024" });
  assert.equal(calls, 1); assert.equal(result.b64, b64); assert.equal(result.mime, "image/png");
});

test("GPT edit multipart includes source first and retains the requested model", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://gateway.example/v1/images/edits");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
    assert.equal(new Headers(init?.headers).has("Content-Type"), false);
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model"), "gpt-image-2.5-sunburst");
    assert.equal(init.body.get("size"), "1536x1024"); assert.equal(init.body.get("n"), "1");
    assert.equal(init.body.has("quality"), false); assert.equal(init.body.has("response_format"), false);
    const files = init.body.getAll("image[]") as File[];
    assert.equal(files.length, 2);
    assert.deepEqual(Buffer.from(await files[0]!.arrayBuffer()), png);
    assert.deepEqual(Buffer.from(await files[1]!.arrayBuffer()), jpeg);
    return Response.json({ data: [{ b64_json: b64 }] });
  }) as typeof fetch;
  await generateViaApi88Image("edit", context(), { model: "gpt-image-2.5-sunburst", sourceImage: uri,
    references: [{ b64: jpeg.toString("base64"), declaredMime: "image/jpeg", detectedMime: "image/jpeg" }], size: "1536x1024" });
});

for (const model of ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"]) {
  test(`${model} uses chat completions for text and reference requests`, async () => {
    for (const references of [[], [reference]]) {
      globalThis.fetch = (async (input, init) => {
        assert.equal(String(input), "https://gateway.example/v1/chat/completions");
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, model);
        assert.deepEqual(body.messages, [{ role: "user", content: references.length
          ? [{ type: "text", text: "bird" }, { type: "image_url", image_url: { url: uri } }] : "bird" }]);
        return Response.json({ choices: [{ message: { images: [{ image_url: { url: uri } }] } }] });
      }) as typeof fetch;
      assert.equal((await generateViaApi88Image("bird", context(), { model, references })).mime, "image/png");
    }
  });
}

test("Gemini parser handles image fields in required order and rejects text-only answers", () => {
  for (const message of [
    { images: [{ url: uri }], content: "no image" },
    { content: [{ type: "image_url", image_url: { url: uri } }] },
    { content: `![image](${uri})` }, { content: uri },
    { content: "https://cdn.example/out.png?signature=a%2Fb&expires=3" },
  ]) assert.ok(parseApi88GeminiImage({ choices: [{ message }] }).startsWith("data:") || String(message.content).startsWith("https:"));
  assert.equal(parseApi88GeminiImage({ choices: [{ message: { images: [{ url: uri }], content: [{ type: "image_url", image_url: { url: "https://other.example/out.png" } }] } }] }), uri);
  assert.throws(() => parseApi88GeminiImage({ choices: [{ message: { content: "x".repeat(500) } }] }),
    (error: unknown) => error instanceof Error && error.message.length <= 260 && (error as { code?: string }).code === "API88_EMPTY_RESULT");
});

test("result download preserves signed query and sends no Authorization", async () => {
  const signed = "https://cdn.example/out.png?sig=a%2Fb&n=1";
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push(String(input));
    if (String(input) === "https://gateway.example/v1/images/generations") return Response.json({ data: [{ url: signed }] });
    assert.equal(String(input), signed); assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(init?.redirect, "follow");
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  const result = await generateViaApi88Image("city", context());
  assert.deepEqual(calls, ["https://gateway.example/v1/images/generations", signed]);
  assert.equal(result.providerUrl, signed);
});

test("missing image key, hidden models and masks fail before HTTP, regardless of video key", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected HTTP"); }) as typeof fetch;
  for (const key of [undefined, "", "   "]) {
    const ctx = context(); ctx.api88ImageKey = key;
    await assert.rejects(() => generateViaApi88Image("city", ctx), { code: "API88_IMAGE_KEY_MISSING", status: 401 });
  }
  for (const model of getProvider("88api").models.filter((row) => "status" in row).map((row) => row.id)) {
    await assert.rejects(() => generateViaApi88Image("city", context(), { model }), { code: "API88_MODEL_UNVERIFIED" });
  }
  await assert.rejects(() => generateViaApi88Image("city", context(), { mask: b64 }), { code: "API88_MASK_UNSUPPORTED" });
  assert.equal(calls, 0);
});

for (const status of [400, 401, 403, 429, 502]) {
  test(`HTTP ${status} never retries or changes endpoint`, async () => {
    let calls = 0;
    globalThis.fetch = (async (input) => {
      calls++; assert.equal(String(input), "https://gateway.example/v1/images/generations");
      return new Response("failure", { status });
    }) as typeof fetch;
    await assert.rejects(() => generateViaApi88Image("city", context()), { status });
    assert.equal(calls, 1);
  });
}

test("download bounds and byte detection reject HTML and oversized bodies", async () => {
  for (const response of [new Response("<html>error</html>"), new Response(png, { headers: { "Content-Length": "999999999" } })]) {
    globalThis.fetch = (async (input) => String(input).endsWith("/images/generations")
      ? Response.json({ data: [{ url: "https://cdn.example/out.png" }] }) : response) as typeof fetch;
    await assert.rejects(() => generateViaApi88Image("city", context()),
      (error: unknown) => ["API88_IMAGE_INVALID", "API88_DOWNLOAD_TOO_LARGE"].includes(String((error as { code?: string }).code)));
  }
});

test("pre-aborted image work makes no HTTP call", async () => {
  globalThis.fetch = (async () => { throw new Error("unexpected HTTP"); }) as typeof fetch;
  const controller = new AbortController(); const reason = new Error("cancelled"); controller.abort(reason);
  await assert.rejects(() => generateViaApi88Image("city", context(), { signal: controller.signal }), (error) => error === reason);
});
```

### NEW `tests/api88-catalog-contract.test.ts` — full contents

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { getApi88Catalog, invalidateApi88Catalogs, seedApi88Catalog, validateApi88Key } from "../lib/api88/catalog.ts";
import { buildLaneMap } from "../routes/models.ts";
import { getProvider } from "../lib/providers/registry.ts";
import { deriveUnsupportedImageModelsFrom } from "../lib/providers/deriveCore.ts";
import { REGISTRY } from "../lib/providers/registry.ts";
import { isSensitiveConfigKey } from "../lib/configKeys.ts";

const originalFetch = globalThis.fetch;
function context() {
  return createTestRuntimeContext({ grokAuthHomeDir: "/synthetic/api88-contract-no-grok-auth", config: { ...config,
    mcp: { ...config.mcp, enabledProviders: [] },
    api88Provider: { ...config.api88Provider, baseUrl: "https://catalog.example/v1" } } });
}
const deps = { detectAgyInstalled: async () => false, listComfyWorkflows: async () => [], probeComfyOrigins: async () => new Map() };
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("registry has 10 image and 25 exact video IDs and image-only surfaces", () => {
  const manifest = getProvider("88api");
  assert.equal(manifest.vendor, "88api"); assert.equal(manifest.errorPrefix, "API88_");
  assert.deepEqual([...manifest.surfaces], ["generate", "edit", "multimode", "node"]);
  assert.equal(manifest.models.filter((row) => row.kind === "image").length, 10);
  assert.deepEqual(manifest.models.filter((row) => row.kind === "video").map((row) => row.id), [
    "gemini-omni-flash", "grok-imagine-video", "grok-imagine-video-1.5",
    "kling-3.0-turbo-720p", "kling-3.0-turbo-1080p", "kling-3.0-turbo-2k", "kling-3.0-turbo-4k",
    "minimax-h3-768p", "SD2.0 480P", "SD2.0 720P", "SD2.0 1080P", "SD2.0 4k",
    "SD2.5 480P", "SD2.5 720P", "SD2.5 1080P", "Seedance-2.0-720p官方版",
    "Seedance-2.0-fast-720p官方版", "Seedance-2.5-720p官方版", "seedance-2.0-mini-480p",
    "seedance-2.0-mini-720p", "veo-3.1", "veo-3.1-fast", "wan3.0-video-480p", "wan3.0-video-720p", "wan3.0-video-1080p",
  ]);
  assert.deepEqual(manifest.credentials, [
    { kind: "api-key", keyVocabulary: "api88-image", envVars: ["IMA2_88API_IMAGE_KEY"], configKey: "api88ImageKey", validateUrl: "https://api.88api.ai/v1/models", validateUrlIsFallback: true },
    { kind: "api-key", keyVocabulary: "api88-video", envVars: ["IMA2_88API_VIDEO_KEY"], configKey: "api88VideoKey", validateUrl: "https://api.88api.ai/v1/models", validateUrlIsFallback: true },
  ]);
  for (const credential of manifest.credentials) {
    assert.equal(credential.kind, "api-key");
    if (credential.kind === "api-key") assert.equal("keyPrefix" in credential, false);
  }
  assert.deepEqual([...deriveUnsupportedImageModelsFrom(REGISTRY)], ["grok-imagine-edit"]);
  assert.equal(isSensitiveConfigKey("api88ImageKey"), true); assert.equal(isSensitiveConfigKey("api88VideoKey"), true);
});

test("catalog kinds cache independently, coalesce and retain exact IDs", async () => {
  const ctx = context(); ctx.api88ImageKey = "image-only"; ctx.api88VideoKey = "video-only";
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://catalog.example/v1/models");
    const bearer = new Headers(init?.headers).get("Authorization")!; calls.push(bearer);
    return Response.json({ data: [{ id: bearer === "Bearer image-only" ? "gpt-image-2" : "SD2.5 720P" }] });
  }) as typeof fetch;
  const [image1, image2, video] = await Promise.all([getApi88Catalog(ctx, "image"), getApi88Catalog(ctx, "image"), getApi88Catalog(ctx, "video")]);
  assert.deepEqual([...image1!], ["gpt-image-2"]); assert.equal(image1, image2);
  assert.deepEqual([...video!], ["SD2.5 720P"]); assert.equal(calls.length, 2);
  await getApi88Catalog(ctx, "image"); assert.equal(calls.length, 2);
  invalidateApi88Catalogs(ctx, "image"); await getApi88Catalog(ctx, "image"); assert.equal(calls.length, 3);
});

test("known empty catalog differs from unknown and rejects malformed validation", async () => {
  const ctx = context(); ctx.api88ImageKey = "image-only";
  globalThis.fetch = (async () => Response.json({ data: [] })) as typeof fetch;
  assert.equal((await getApi88Catalog(ctx, "image"))?.size, 0);
  ctx.api88ImageKey = "new-key";
  globalThis.fetch = (async () => Response.json({ error: "invalid" })) as typeof fetch;
  await assert.rejects(() => validateApi88Key(ctx, "candidate"), { code: "API88_CATALOG_INVALID" });
  assert.equal(await getApi88Catalog(ctx, "image"), null);
});

test("same-kind initial requests share a pending GET before any snapshot exists", async () => {
  const ctx = context(); ctx.api88ImageKey = "image-only";
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://catalog.example/v1/models"); calls++;
    await gate; return Response.json({ data: [{ id: "gpt-image-2" }] });
  }) as typeof fetch;
  const first = getApi88Catalog(ctx, "image");
  const second = getApi88Catalog(ctx, "image");
  try { assert.equal(calls, 1, "pending identity must exist before the first snapshot"); }
  finally { release(); await Promise.allSettled([first, second]); }
  assert.equal(await first, await second);
});

for (const credentials of [{}, { api88ImageKey: "image" }, { api88VideoKey: "video" }, { api88ImageKey: "image", api88VideoKey: "video" }]) {
  test(`DTO kind locks and readiness ${JSON.stringify(Object.keys(credentials))}`, async () => {
    const ctx = Object.assign(context(), credentials);
    globalThis.fetch = (async () => { throw new Error("catalog unavailable"); }) as typeof fetch;
    const lane = (await buildLaneMap(ctx, deps))["88api"]!;
    assert.equal(lane.status, Object.keys(credentials).length ? "ready" : "key-missing");
    assert.equal(lane.models.image.length, 7); assert.equal(lane.models.video.length, 25);
    assert.deepEqual(lane.defaults, { image: "gpt-image-2", video: "grok-imagine-video-1.5" });
    for (const row of lane.models.image) assert.equal(row.executable, Boolean(ctx.api88ImageKey));
    for (const row of lane.models.video) {
      assert.equal(row.executable, false);
      assert.equal(row.lockReason, ctx.api88VideoKey ? "API88_VIDEO_NOT_READY" : "API88_VIDEO_KEY_MISSING");
    }
    assert.equal(lane.surfaces?.video.supported, false);
  });
}

test("live intersection is per kind and unverified image IDs remain hidden", async () => {
  const ctx = context(); ctx.api88ImageKey = "image"; ctx.api88VideoKey = "video";
  seedApi88Catalog(ctx, "image", "image", new Set(["gpt-image-2", "grok-imagine-image", "remote-unknown"]));
  seedApi88Catalog(ctx, "video", "video", new Set(["SD2.5 720P", "Seedance-2.0-720p官方版"]));
  globalThis.fetch = (async () => { throw new Error("unexpected catalog refresh"); }) as typeof fetch;
  const lane = (await buildLaneMap(ctx, deps))["88api"]!;
  assert.deepEqual(lane.models.image.map((row) => row.id), ["gpt-image-2"]);
  assert.deepEqual(lane.models.video.map((row) => row.id), ["SD2.5 720P", "Seedance-2.0-720p官方版"]);
});

test("key and origin replacement cannot reuse the old catalog", async () => {
  const ctx = context(); ctx.api88ImageKey = "old";
  seedApi88Catalog(ctx, "image", "old", new Set(["old-model"]));
  ctx.api88ImageKey = "new"; ctx.config.api88Provider.baseUrl = "https://replacement.example";
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://replacement.example/v1/models");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new");
    return Response.json({ data: [{ id: "gpt-image-2" }] });
  }) as typeof fetch;
  assert.deepEqual([...(await getApi88Catalog(ctx, "image"))!], ["gpt-image-2"]);
});
```

### NEW `tests/_api88RouteFixture.ts` — full contents

```ts
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { mountKeyRoutes } from "../routes/keys.ts";
import { mountApi88ConfigRoutes } from "../routes/api88Config.ts";

export async function withApi88Routes(run: (fixture: {
  ctx: ReturnType<typeof createTestRuntimeContext>; base: string; configFile: string;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ima2-api88-contract-"));
  const configFile = join(root, "config.json");
  const ctx = createTestRuntimeContext({ config: { ...config,
    storage: { ...config.storage, configFile },
    api88Provider: { ...config.api88Provider, baseUrl: "https://route-gateway.example/v1/", baseUrlSource: "config" } } });
  const app = express(); app.use(express.json());
  mountKeyRoutes(app, ctx); mountApi88ConfigRoutes(app, ctx);
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run({ ctx, base, configFile }); }
  finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
```

### NEW `tests/api88-keys-config-contract.test.ts` — full contents

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withApi88Routes } from "./_api88RouteFixture.ts";
import { getApi88Catalog } from "../lib/api88/catalog.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("both key IDs validate once, persist independently, hot-update and delete only the selected key", async () => {
  await withApi88Routes(async ({ ctx, base, configFile }) => {
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input); if (url.startsWith(`${base}/`)) return originalFetch(input, init);
      assert.equal(url, "https://route-gateway.example/v1/models");
      const bearer = new Headers(init?.headers).get("Authorization")!; calls.push(bearer);
      return Response.json({ data: [{ id: bearer === "Bearer image-key" ? "gpt-image-2" : "SD2.5 720P" }] });
    }) as typeof fetch;
    for (const [id, key] of [["api88-image", "image-key"], ["api88-video", "video-key"]]) {
      const response = await fetch(`${base}/api/keys/${id}`, { ...json({ apiKey: key }), method: "PUT" });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(calls, ["Bearer image-key", "Bearer video-key"]);
    assert.equal(ctx.api88ImageKey, "image-key"); assert.equal(ctx.api88VideoKey, "video-key");
    assert.equal((await getApi88Catalog(ctx, "image"))?.has("gpt-image-2"), true); assert.equal(calls.length, 2);
    const status = await (await fetch(`${base}/api/keys/status`)).json();
    assert.equal(status["api88-image"].valid, true); assert.equal(status["api88-video"].valid, true);
    await fetch(`${base}/api/keys/api88-image`, { method: "DELETE" });
    const stored = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(stored.api88ImageKey, undefined); assert.equal(stored.api88VideoKey, "video-key");
    assert.equal(ctx.api88ImageKey, undefined); assert.equal(ctx.api88VideoKey, "video-key");
  });
});

for (const response of [Response.json({ error: "wrong shape" }), new Response("denied", { status: 401 })]) {
  test(`failed validation does not save or hot-update (${response.status})`, async () => {
    await withApi88Routes(async ({ ctx, base, configFile }) => {
      globalThis.fetch = (async (input, init) => String(input).startsWith(`${base}/`) ? originalFetch(input, init) : response) as typeof fetch;
      const result = await fetch(`${base}/api/keys/api88-image`, { ...json({ apiKey: "candidate" }), method: "PUT" });
      assert.equal(result.status, 400); assert.equal(ctx.api88ImageKey, undefined);
      await assert.rejects(() => readFile(configFile), { code: "ENOENT" });
    });
  });
}

test("base URL PATCH persists provider settings, keeps keys and hot-updates subsequent validation", async () => {
  await withApi88Routes(async ({ ctx, base, configFile }) => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input); if (url.startsWith(`${base}/`)) return originalFetch(input, init);
      assert.ok(["https://route-gateway.example/v1/models", "https://changed.example/v1/models"].includes(url));
      return Response.json({ data: [{ id: "gpt-image-2" }] });
    }) as typeof fetch;
    await fetch(`${base}/api/keys/api88-image`, { ...json({ apiKey: "image-key" }), method: "PUT" });
    const result = await fetch(`${base}/api/config/88api`, { ...json({ baseUrl: "https://changed.example/v1/" }), method: "PATCH" });
    assert.deepEqual(await result.json(), { baseUrl: "https://changed.example", source: "config" });
    assert.equal(ctx.config.api88Provider.baseUrl, "https://changed.example");
    const stored = JSON.parse(await readFile(configFile, "utf8"));
    assert.equal(stored.api88Provider.baseUrl, "https://changed.example"); assert.equal(stored.api88ImageKey, "image-key");
  });
});

test("env URL is immutable; invalid URL never writes", async () => {
  await withApi88Routes(async ({ ctx, base, configFile }) => {
    ctx.config.api88Provider.baseUrlSource = "env";
    const locked = await originalFetch(`${base}/api/config/88api`, { ...json({ baseUrl: "https://new.example" }), method: "PATCH" });
    assert.equal(locked.status, 409); assert.equal((await locked.json()).code, "API88_BASE_URL_ENV_LOCKED");
    ctx.config.api88Provider.baseUrlSource = "default";
    const invalid = await originalFetch(`${base}/api/config/88api`, { ...json({ baseUrl: "http://public.example" }), method: "PATCH" });
    assert.equal(invalid.status, 400); await assert.rejects(() => readFile(configFile), { code: "ENOENT" });
  });
});

test("key PUT completing after an origin PATCH never seeds host A's IDs under host B", async () => {
  await withApi88Routes(async ({ ctx, base }) => {
    let enter = () => {}, release = () => {};
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input); if (url.startsWith(`${base}/`)) return originalFetch(input, init);
      calls.push(url);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer image-key");
      if (url === "https://route-gateway.example/v1/models") {
        enter(); await gate; return Response.json({ data: [{ id: "host-A-only" }] });
      }
      assert.equal(url, "https://changed.example/v1/models");
      return Response.json({ data: [{ id: "host-B-only" }] });
    }) as typeof fetch;
    const put = fetch(`${base}/api/keys/api88-image`, { ...json({ apiKey: "image-key" }), method: "PUT" });
    try {
      await entered;
      const patch = await fetch(`${base}/api/config/88api`, { ...json({ baseUrl: "https://changed.example" }), method: "PATCH" });
      assert.equal(patch.status, 200);
    } finally { release(); }
    assert.equal((await put).status, 200);
    assert.deepEqual([...(await getApi88Catalog(ctx, "image"))!], ["host-B-only"]);
    assert.deepEqual(calls, ["https://route-gateway.example/v1/models", "https://changed.example/v1/models"]);
  });
});
```

### NEW `tests/api88-agent-retry-contract.test.ts` — full contents

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { isolateExecution } from "./_executionRouteIsolation.ts";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("Agent preserves API88_EMPTY_RESULT and sends only one POST for a No image data excerpt", async () => {
  const isolation = await isolateExecution();
  let db: typeof import("../lib/db.ts") | undefined;
  try {
    const { config } = await import("../config.ts");
    const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
    const { generateAgentImageWithRetry } = await import("../lib/agentImageVideoGen.ts");
    db = await import("../lib/db.ts");
    const ctx = createTestRuntimeContext({ rootDir: isolation.rootDir, api88ImageKey: "synthetic-image",
      config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://agent88.example" } } });
    let posts = 0;
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "https://agent88.example/v1/chat/completions");
      assert.equal(init?.method, "POST"); posts++;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-image");
      assert.equal(JSON.parse(String(init?.body)).model, "gemini-3.1-flash-image");
      return Response.json({ choices: [{ message: { content: "No image data" } }] });
    }) as typeof fetch;
    await assert.rejects(() => generateAgentImageWithRetry(ctx, "synthetic-session", "bird", "context", false, {
      provider: "88api", model: "gemini-3.1-flash-image", signal: null, sourceImagePolicy: "none",
    }), (error: unknown) => error instanceof Error && error.message.includes("No image data")
      && (error as { code?: string }).code === "API88_EMPTY_RESULT");
    assert.equal(posts, 1, "the generic Agent text-only retry must never resubmit 88API");
  } finally { db?.closeDb(); await isolation.close(); }
});
```

This dynamically imports runtime modules after the existing owned config/DB/network isolation
is installed; it cannot open the operator's session DB. The failure precedes image persistence
and retry-turn insertion. A null Agent signal also exercises the normalized transport arm.

### NEW `tests/api88-image-surfaces-contract.test.ts` — full contents

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { prepareImageExecution } from "../lib/providers/execution/index.ts";
import type { ImageExecutionRequest } from "../lib/providers/execution/types.ts";
import { reconcileCoreSelection } from "../ui/src/lib/coreSelection.ts";
import { getImageModelOptionsForProvider } from "../ui/src/lib/imageModels.ts";
import { readFileSync } from "node:fs";

const originalFetch = globalThis.fetch;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const b64 = png.toString("base64");
test.afterEach(() => { globalThis.fetch = originalFetch; });
function request(surface: ImageExecutionRequest["surface"]): ImageExecutionRequest {
  const base = { provider: "88api" as const, requestId: "synthetic-job", signal: new AbortController().signal,
    prompt: "effective with context", rawPrompt: "raw", references: [],
    options: { model: "gpt-image-2", quality: "high", size: "1024x1024", moderation: "low", mode: "auto" as const,
      reasoningEffort: "none", webSearchEnabled: false } };
  switch (surface) {
    case "classic": return { ...base, surface, providerUrl: null, background: null, backgroundConstraint: undefined, nai: {}, comfy: {} };
    case "node": return { ...base, surface, sourceImage: b64, contextMode: "parent-only", searchMode: "off", partialImages: 0, nai: {} };
    case "edit": return { ...base, surface, sourceImage: `data:image/png;base64,${b64}`, mask: null };
    case "multimode": return { ...base, surface, providerUrl: null, maxImages: 3, nai: {} };
  }
}

for (const surface of ["classic", "node", "edit", "multimode"] as const) {
  test(`${surface} dispatches one Images request through the public seam`, async () => {
    let calls = 0;
    globalThis.fetch = (async (input, init) => {
      calls++;
      if (String(input) === "https://cdn.example/multimode.png?sig=a%2Fb") {
        assert.equal(new Headers(init?.headers).has("Authorization"), false); return new Response(png);
      }
      assert.equal(String(input), `https://surface.example/v1/images/${surface === "node" || surface === "edit" ? "edits" : "generations"}`);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer image-key");
      if (init?.body instanceof FormData) assert.equal(init.body.get("prompt"), "effective with context");
      else assert.equal(JSON.parse(String(init?.body)).prompt, "effective with context");
      return Response.json({ data: [surface === "multimode" ? { url: "https://cdn.example/multimode.png?sig=a%2Fb" } : { b64_json: b64 }] });
    }) as typeof fetch;
    const ctx = createTestRuntimeContext({ api88ImageKey: "image-key", api88VideoKey: "video-key",
      config: { ...config, api88Provider: { ...config.api88Provider, baseUrl: "https://surface.example" } } });
    const prepared = await prepareImageExecution(ctx, request(surface));
    const result = await prepared.execute(); const expectedCalls = surface === "multimode" ? 2 : 1;
    assert.equal(calls, expectedCalls);
    if (result.kind === "sequence") {
      assert.equal(result.value.images[0]?.mime, "image/png");
      assert.equal(result.value.images[0]?.providerUrl, "https://cdn.example/multimode.png?sig=a%2Fb");
    }
    else assert.equal(result.value.mime, "image/png");
    ctx.api88ImageKey = undefined;
    await assert.rejects(() => prepared.execute(), { code: "API88_IMAGE_KEY_MISSING" });
    assert.equal(calls, expectedCalls);
  });
}

test("seven visible rows, lane hints, hidden-model restoration and wp2 video lock", () => {
  const rows = getImageModelOptionsForProvider("88api"); assert.equal(rows.length, 7);
  for (const row of rows) { assert.equal(row.providerHint, "88api"); assert.equal(row.value.startsWith("grok-"), false); }
  assert.equal(reconcileCoreSelection({ provider: "88api", imageModel: "grok-imagine-image" }).imageModel, "gpt-image-2");
  assert.equal(reconcileCoreSelection({ provider: "88api", imageModel: "gemini-nano-banana-2.1" }).provider, "88api");
  assert.equal(reconcileCoreSelection({ provider: "88api", videoModelSelected: "grok-imagine-video-1.5" }).videoModelSelected, false);
});

test("video route refuses 88api before Grok model and credential resolution", () => {
  const source = readFileSync(new URL("../routes/video.ts", import.meta.url), "utf8");
  const guard = source.indexOf('if (provider === "88api") return fail(400, "API88_VIDEO_NOT_READY"');
  assert.ok(guard >= 0); assert.ok(guard < source.indexOf("const isComfy = provider"));
});
```

## 11. Existing-test replacements and generated inventory

Every path below is MODIFY unless explicitly marked unchanged. Existing native OpenAI/Grok
execution or alias suites keep their family-specific oracles. Only full-lane lists expand.

### Registry, DTO and exhaustive fixture expectations

| MODIFY path:current line | Current snippet | Exact replacement / insertion |
|---|---|---|
| `tests/provider-registry-contract.test.ts:18` | `"oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy",` | `"oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy",` |
| `tests/provider-registry-parity.test.ts:14` | `const CORE_IDS = ["oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy"];` | `const CORE_IDS = ["oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy"];` |
| `tests/provider-registry-parity.test.ts:22` | `"nano-banana-2", "nano-banana-pro", "image-01", "image-01-live",` | Code block A below |
| `tests/provider-registry-parity.test.ts:104` | `["agy", "atlascloud", "comfy", "gemini-api", "grok", "grok-api", "minimax", "nai"],` | `["88api", "agy", "atlascloud", "comfy", "gemini-api", "grok", "grok-api", "minimax", "nai"],` |
| `tests/provider-surface-support.test.ts:27` | `agy: standard, "gemini-api": standard, atlascloud: standard, minimax: standard,` | `agy: standard, "gemini-api": standard, atlascloud: standard, "88api": standard, minimax: standard,` |
| `tests/provider-surface-support.test.ts:77` | `assert.deepEqual([...deriveUnsupportedImageModelsFrom(REGISTRY)], []);` | `assert.deepEqual([...deriveUnsupportedImageModelsFrom(REGISTRY)], ["grok-imagine-edit"]);` |
| `tests/config.test.ts:92` | `assert.deepEqual(c.imageModels.unsupported, []);` | `assert.deepEqual(c.imageModels.unsupported, ["grok-imagine-edit"]);` |
| `tests/capabilities-lane-contract.test.ts:42` | `"oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy",` | `"oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy",` |
| `tests/models-endpoint-contract.test.ts:179` | `"oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy", "runway", "higgsfield",` | `"oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy", "runway", "higgsfield",` |
| `tests/models-endpoint-contract.test.ts:147` | `apiProvider: { defaultImageModel: "gpt-5.6-sol", validImageModels: new Set(["gpt-5.6-luna", "gpt-5.6-sol"]) },` | Keep this anchor; insert code block B after it |
| `tests/core-selection-reconcile.test.ts:41` | `atlascloud: "openai/gpt-image-2/text-to-image", minimax: "image-01", nai: "nai-diffusion-5-full" };` | `atlascloud: "openai/gpt-image-2/text-to-image", "88api": "gpt-image-2", minimax: "image-01", nai: "nai-diffusion-5-full" };` |
| `tests/core-selection-actions.test.ts:467` | `for (const provider of ["agy", "gemini-api", "atlascloud", "minimax", "nai", "api", "oauth"] as const) {` | `for (const provider of ["agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "api", "oauth"] as const) {` |
| `tests/doctor-provider-contract.test.ts:43` | `assert.equal(lanes.length, 10);` | `assert.equal(lanes.length, 11);` |
| `tests/cli-video-command-contract.test.ts:118` | `assert.match(stdout, /--provider <grok\|grok-api\|comfy\|runway\|higgsfield>/);` | `assert.match(stdout, /--provider <grok\|grok-api\|88api\|comfy\|runway\|higgsfield>/);` |
| `tests/api-image-tool-model.test.ts:149` | `for (const provider of ["oauth", "grok", "grok-api", "agy", "gemini-api", "minimax", "nai", "atlascloud"]) {` | `for (const provider of ["oauth", "grok", "grok-api", "agy", "gemini-api", "minimax", "nai", "atlascloud", "88api"]) {` |
| `tests/nai-client-options-contract.test.ts:146` | `for (const provider of ["oauth", "api", "grok", "gemini-api", "minimax", "comfy"]) {` | `for (const provider of ["oauth", "api", "grok", "gemini-api", "88api", "minimax", "comfy"]) {` |
| `ui/e2e/fixtures/composerComponent.tsx:66` | `"gemini-api": ready, atlascloud: ready, minimax: ready, nai: ready, comfy: ready };` | `"gemini-api": ready, atlascloud: ready, "88api": ready, minimax: ready, nai: ready, comfy: ready };` |

Code block A (CLI image set insertion order, including the unique unsupported registration):

```ts
  "nano-banana-2", "nano-banana-pro",
  "gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image",
  "gemini-nano-banana-2.1", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "grok-imagine-edit",
  "image-01", "image-01-live",
```

Code block B (the old models endpoint fixture uses a hand-written partial config; omitting
this would crash `api88Lane` even without keys):

```ts
      api88Provider: { baseUrl: "https://api.88api.ai", baseUrlSource: "default",
        defaultImageModel: "gpt-image-2", defaultVideoModel: "grok-imagine-video-1.5",
        catalogTimeoutMs: 10_000, catalogTtlMs: 600_000 },
```

No reference-map expected value changes: the new manifest declares no lane cap. Extend the
surface test's reference table at line 92 (after `["oauth", 12]`) with `["88api", 12]`;
this pins the fallback application cap without advertising a provider limit. The new DTO
tests cover partial keys; the existing `withApp` does not need API88 keys or upstream stubs.

### MODIFY `tests/provider-adapter-v1-contract.test.ts`

After line 47 `atlasCloudApiKey: key,`, insert:

```ts
    api88ImageKey: key,
    api88VideoKey: key,
```

After line 66 `atlascloud: /Atlas Cloud API key missing/,`, insert:

```ts
  "88api": /88API image key missing/,
```

At line 214 replace `for (const lane of ["nai", "minimax", "atlascloud", "comfy"] as const) {` with:

```ts
  for (const lane of ["nai", "minimax", "atlascloud", "88api", "comfy"] as const) {
```

Append the following full test:

```ts
test("88API descriptor image auth never substitutes the video key", () => {
  for (const [image, video, expected] of [[undefined, undefined, false], [undefined, "video", false],
    ["image", undefined, true], ["image", "video", true], ["   ", "video", false]] as const) {
    const ctx = { ...withoutKey, api88ImageKey: image, api88VideoKey: video } as RuntimeContext;
    assert.equal(getProviderAdapter(ctx, "88api")?.validateAuth().ok, expected);
  }
});
```

The existing model-list equality and filename/model-literal scans stay unchanged and cover
35 registrations automatically.

### MODIFY `tests/doctor-provider-contract.test.ts` — required custom-origin fixture (A1)

Replace current line 21 (the config fixture branch, after the authStatus.js fixture at line 20):

```ts
      : 'export const config={comfy:{defaultUrl:"http://127.0.0.1:8188"},minimaxProvider:{region:"global_en",globalBaseUrl:"https://api.minimax.io/v1",cnBaseUrl:"https://api.minimax.chat/v1"},diagnostics:{keyTimeoutMs:5000}};' }));
```

After:

```ts
      : 'export const config={comfy:{defaultUrl:"http://127.0.0.1:8188"},minimaxProvider:{region:"global_en",globalBaseUrl:"https://api.minimax.io/v1",cnBaseUrl:"https://api.minimax.chat/v1"},api88Provider:{baseUrl:"https://doctor88.example/v1/"},diagnostics:{keyTimeoutMs:5000}};' }));
```

Keep the existing count change at line 43 (`10` → `11`) from the enumeration table above.
Append the following full test to the existing file; it runs the actual bundled Doctor inside
its existing synthetic VM and exercises both independently stored credentials:

```ts
it("88API Doctor resolves both key kinds against the custom origin exactly once", async () => {
  const provider = listProviders().find((entry) => entry.id === "88api")!;
  assert.equal(provider.credentials.length, 2);
  for (const credential of provider.credentials) {
    assert.equal(credential.kind, "api-key");
    if (credential.kind === "api-key") {
      assert.equal(resolveValidateUrl(credential), "https://doctor88.example/v1/models");
    }
  }
  const seen: Array<{ url: string; bearer: string }> = [];
  const result = await verifyConfiguredKeys({ api88ImageKey: "synthetic-image", api88VideoKey: "synthetic-video" },
    (async (input, init) => {
      seen.push({ url: String(input), bearer: new Headers(init?.headers).get("Authorization")! });
      assert.equal(init?.redirect, "error");
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
  assert.deepEqual(seen, [
    { url: "https://doctor88.example/v1/models", bearer: "Bearer synthetic-image" },
    { url: "https://doctor88.example/v1/models", bearer: "Bearer synthetic-video" },
  ]);
  assert.deepEqual(result.map((line) => ({ lane: line.lane, code: line.code, text: line.text })), [
    { lane: "88api", code: "AUTH_VERIFIED", text: "88api (api88-image): AUTH_VERIFIED" },
    { lane: "88api", code: "AUTH_VERIFIED", text: "88api (api88-video): AUTH_VERIFIED" },
  ]);
});
```

No operator environment or real network is involved: the VM's process.env is `{}`, the
fixture's base URL is synthetic, and this keeps the existing Doctor fetchImpl test seam.

### MODIFY `tests/provider-execution-boundary.test.ts`

Replace lines 8–17 in full:

```ts
const lanes: Record<ExecutionSurface, readonly CoreProviderId[]> = {
  classic: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai", "comfy"],
  node: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai"],
  edit: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "comfy"],
  multimode: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "minimax", "nai"],
};
const concrete: Partial<Record<CoreProviderId, string>> = {
  agy: "generateViaAgy", "gemini-api": "generateViaGeminiApi", atlascloud: "generateViaAtlasCloud",
  minimax: "generateViaMinimax", nai: "generateViaNai", comfy: "generateViaComfy",
};
```

After:

```ts
const lanes: Record<ExecutionSurface, readonly CoreProviderId[]> = {
  classic: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy"],
  node: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai"],
  edit: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "comfy"],
  multimode: ["api", "oauth", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai"],
};
const concrete: Partial<Record<CoreProviderId, string>> = {
  agy: "generateViaAgy", "gemini-api": "generateViaGeminiApi", atlascloud: "generateViaAtlasCloud",
  "88api": "generateViaApi88Image", minimax: "generateViaMinimax", nai: "generateViaNai", comfy: "generateViaComfy",
};
```

Replace lines 46–48 current generic legacy sequence assertion:

```ts
          else assert.deepEqual(result.value, {
            images: [{ b64: "native-image", revisedPrompt: "native-revised" }], usage: { total_tokens: 17 }, webSearchCalls: 3,
          });
```

After:

```ts
          else assert.deepEqual(result.value, {
            images: [{ b64: "native-image", revisedPrompt: "native-revised", ...(provider === "88api" ? { mime: "image/webp" } : {}) }],
            usage: { total_tokens: 17 }, webSearchCalls: 3,
          });
```

### MODIFY `tests/_executionBoundaryProbe.ts`

After line 18 `atlasCloudImageAdapter: ["generateViaAtlasCloud"], minimaxImageAdapter: ["generateViaMinimax"],`, insert:

```ts
  "api88/imageTransport": ["generateViaApi88Image"],
```

At lines 77–78, replace current context construction with:

```ts
    const ctx = createTestRuntimeContext({ rootDir: isolation.rootDir, config, xaiApiKey: "initial-invented-key",
      api88ImageKey: "synthetic-image-key", api88VideoKey: "synthetic-video-key", grokAuthHomeDir: grokAuth.homeDir });
```

At line 108 current `options: { model: "grok-imagine-image-quality", quality: "high", size: "1536x1024", moderation: "low",`, change
only the `model` expression, preserving the rest of the line:

```ts
    options: { model: provider === "88api" ? "gpt-image-2" : "grok-imagine-image-quality", quality: "high", size: "1536x1024", moderation: "low",
```

Inside `assertCall`, before line 123 `const rawLane = (surface === "node" || surface === "multimode") && ["atlascloud", "minimax", "nai"].includes(provider);`, insert:

```ts
  if (provider === "88api") {
    assert.equal(call.args[0], request.prompt); assert.equal(call.args[1], ctx);
    assert.equal(options.model, "gpt-image-2"); assert.equal(options.size, request.options.size);
    assert.equal(options.signal, request.signal); assert.equal(options.requestId, request.requestId);
    assert.equal(options.sourceImage, surface === "node" || surface === "edit" ? request.sourceImage : undefined);
    assert.equal(options.providerUrl, surface === "classic" || surface === "multimode" ? request.providerUrl : undefined);
    assert.equal(options.mask, surface === "edit" ? request.mask : undefined);
    assert.equal("background" in options, false); assert.equal("quality" in options, false);
    return;
  }
```

Inside `assertReferenceOrder` before line 175 `const responses = provider === "api" || provider === "oauth";`, insert:

```ts
  if (provider === "88api") {
    const references = options.references as Array<{ b64: string }>;
    assert.deepEqual(references.map((ref) => ref.b64), surface === "node" && request.contextMode === "parent-only"
      ? [] : ["first-reference", "second-reference"]);
    if (surface === "node") assert.equal(options.sourceImage, source);
    return;
  }
```

The existing edit early return remains; source/mask forwarding is checked in `assertCall`.
Source first on the wire is checked in the new multipart transport test.

### MODIFY execution owner inventories

* `tests/_executionImportEdges.mjs:11–12`: current `"minimaxImageAdapter", "naiImageAdapter", "comfyImageAdapter",`
  becomes `"minimaxImageAdapter", "naiImageAdapter", "comfyImageAdapter", "api88/imageTransport",`.
  Current line 41 `"lib/providers/adapters/atlascloud", "lib/providers/adapters/comfy",` becomes
  `"lib/providers/adapters/atlascloud", "lib/providers/adapters/88api", "lib/providers/adapters/comfy",`.
* `tests/provider-execution-imports.test.ts:48–49`: the same concrete-name row gains
  `"api88/imageTransport"` with the identical replacement above. Its line 56 row
  `"providers/adapters/nai", "providers/adapters/minimax", "providers/adapters/atlascloud", "providers/adapters/comfy",`
  becomes `"providers/adapters/nai", "providers/adapters/minimax", "providers/adapters/atlascloud", "providers/adapters/88api", "providers/adapters/comfy",`.
  Its line 100 row `"lib/providers/adapters/atlascloud.ts", "lib/providers/adapters/comfy.ts",`
  becomes `"lib/providers/adapters/atlascloud.ts", "lib/providers/adapters/88api.ts", "lib/providers/adapters/comfy.ts",`.
* `tests/node-studio-ui-contract.test.ts:290`: after
  `generateViaAtlasCloud: "lib/providers/adapters/atlascloud.ts",`, insert
  `generateViaApi88Image: "lib/providers/adapters/88api.ts",`.
  At line 300 after the Atlas call tuple insert `["generateViaApi88Image", 0, "request.prompt"],`.
  At line 310 current
  `: collectCallArguments(read(adapterOwners[name]), adapterOwners[name], name, "prepareNode");`
  becomes `: collectCallArguments(read(adapterOwners[name]), adapterOwners[name], name, name === "generateViaApi88Image" ? "prepareSingle" : "prepareNode");`.
* `tests/provider-execution-harness.test.ts:284`: current ambient list
  `["HOME", "IMA2_CONFIG_DIR", "OPENAI_API_KEY", "XAI_API_KEY", "NODE_OPTIONS", "EXECUTION_TEST_FILE"]`
  becomes `["HOME", "IMA2_CONFIG_DIR", "OPENAI_API_KEY", "XAI_API_KEY", "IMA2_88API_IMAGE_KEY", "IMA2_88API_VIDEO_KEY", "IMA2_88API_BASE_URL", "NODE_OPTIONS", "EXECUTION_TEST_FILE"]`.

### MODIFY `tests/provider-surface-boundary.test.ts`

After line 161 `["atlascloud", "ATLASCLOUD_MASK_UNSUPPORTED", "Atlas Cloud"],`, insert:

```ts
    ["88api", "API88_MASK_UNSUPPORTED", "88API"],
```

After line 112 `rootDir, apiKey: "sk-fixture-only", oauthReadyState: "ready", xaiApiKey,`, insert:

```ts
    api88ImageKey: "synthetic-image-only",
```

This existing real HTTP test now proves the 88API mask rejection happens before mask parsing
and provider HTTP. `routes/edit.ts:208–213` is its production boundary. The test context uses
the real config spread, so the new provider config is present automatically.

### MODIFY `tests/error-class-coverage.test.ts`

Replace line 34 current:

```ts
const PROVIDER_CODE_PATTERN = /\b(?:MINIMAX|GEMINI_API|GROK|AGY|ATLASCLOUD|NAI)_[A-Z0-9_]+\b/g;
```

After:

```ts
const PROVIDER_CODE_PATTERN = /\b(?:MINIMAX|GEMINI_API|GROK|AGY|ATLASCLOUD|API88|NAI)_[A-Z0-9_]+\b/g;
```

No API88 server constants share uppercase error names; no new lexical exceptions or dynamic
code-site entries are needed. `API88_UNKNOWN` is a literal emitted by the adapter.

### MODIFY `tests/i18n-dictionary-contract.test.ts`

At lines 91–105 and 113–125, the finite resolvers for
`ui/src/components/ImageModelSelect.tsx :: option.fullLabelKey` and
`ui/src/components/ProviderReadinessPopup.tsx :: imageModelOption.fullLabelKey` each gain these
exact literals immediately after their existing `settings.imageModel.nanoBananaPro` member:

```ts
    "settings.imageModel.api88Gpt2", "settings.imageModel.api88GptFlare", "settings.imageModel.api88GptSunburst",
    "settings.imageModel.api88GeminiPro", "settings.imageModel.api88GeminiFlash", "settings.imageModel.api88GeminiLite",
    "settings.imageModel.api88Banana21",
```

At lines 107–110 resolver `ui/src/components/ImageModelSelect.tsx :: laneKey`, after
`"settings.apiKeys.atlascloud.label"`, insert `"settings.api88.title"`.
No new dynamic `t(expression)` call signature is introduced: Api88Settings uses literal calls
and conditional literal calls, and the existing picker/resolver signatures stay unchanged.

### MODIFY `docs/migration/runtime-test-inventory.md` (generated)

Anchor line 7 current `Total: 552 (runtime: 251, contract: 301)`. Regenerate through:

```sh
node scripts/classify-tests.mjs
```

New direct-runtime import entries, sorted by filename, are:

```text
tests/api88-agent-retry-contract.test.ts
tests/api88-catalog-contract.test.ts
tests/api88-image-surfaces-contract.test.ts
tests/api88-keys-config-contract.test.ts
tests/api88-provider-contract.test.ts
```

The keys/config test must directly import `../lib/api88/catalog.ts` as provided; classifier
does not inspect imports through the helper. With this tree unchanged except these five tests,
the total is 557, runtime 256, contract 301. `_api88RouteFixture.ts` is not a discovered test.
The Agent file's direct dynamic imports of config/lib classify it as runtime too.
Do not hand-edit totals if concurrent parent edits add tests; the script owns the exact result.

## 12. Follow-up boundaries for parent coordination

These are evidence-backed adjacent issues, not infeasibility of D1–D10. Do not claim wp2 is
video-ready because registration makes CLI help include the lane. CLI's resolver already
honors `entry.executable === false` (`bin/lib/modelResolver.ts:54–95`). However,
`bin/commands/defaults.ts:218–220` checks membership without checking that flag, so it can
persist a locked video target; execution still rejects it. The parent should explicitly assign
the small defaults-write lock fix if preventing that persistence is required in wp2.

Doctor origin resolution and its fixture/tests are required wp2 edits in §3 and §11, under
the parent's A1 scope decision; they are not deferred. Paid/free canary registration and
user-facing CLI/API docs are not changed here. In particular, the old
`tests/provider-canary-parity.test.ts:21` ASCII-only parser ignores hyphenated key IDs; the
new catalog tests pin both manifest validation URLs directly instead of quietly claiming
new canary coverage. The existing canary suite can remain unchanged until its owner expands it.

`routes/videoExtended.ts:74–76` currently folds unsupported video providers into Grok. Extended
operations are excluded by the locked plan. The parent must guard any UI/API entry that can
actually submit 88API there; wp3 must explicitly reject them if it makes the provider reachable
on those surfaces. Ordinary generation and Agent video are guarded in this wp2 PRD before
any Grok dispatch; wp3 keeps the Agent refusal because Agent video is still out of scope.

UI screenshot evidence is required when implementing these UI changes. Use the orphan
`pr-assets` evidence branch or the PR editor per AGENTS; do not commit screenshots in the
implementation branch. No screenshot, push or PR publication is part of this planning leaf.

## Verification

Run only during implementation, from the repo root, with the parent's authorization. No
command in this section was executed by this leaf. No full suite, network canary or paid call.

```sh
node scripts/generate-provider-types.mjs
node scripts/generate-provider-types.mjs --check
node scripts/classify-tests.mjs
npm run test:inventory
npm run typecheck
npm run typecheck:tests
npm run lint

node --experimental-test-module-mocks --import tsx --test \
  tests/api88-provider-contract.test.ts \
  tests/api88-agent-retry-contract.test.ts \
  tests/api88-catalog-contract.test.ts \
  tests/api88-keys-config-contract.test.ts \
  tests/api88-image-surfaces-contract.test.ts \
  tests/atlascloud-provider-contract.test.ts \
  tests/config.test.ts \
  tests/provider-registry-contract.test.ts \
  tests/provider-registry-parity.test.ts \
  tests/provider-surface-support.test.ts \
  tests/provider-adapter-v1-contract.test.ts \
  tests/capabilities-lane-contract.test.ts \
  tests/models-endpoint-contract.test.ts \
  tests/provider-execution-boundary.test.ts \
  tests/provider-execution-imports.test.ts \
  tests/provider-execution-harness.test.ts \
  tests/provider-surface-boundary.test.ts \
  tests/core-selection-reconcile.test.ts \
  tests/core-selection-actions.test.ts \
  tests/doctor-provider-contract.test.ts \
  tests/cli-video-command-contract.test.ts \
  tests/api-image-tool-model.test.ts \
  tests/nai-client-options-contract.test.ts \
  tests/node-studio-ui-contract.test.ts \
  tests/error-class-coverage.test.ts \
  tests/i18n-dictionary-contract.test.ts

npm --prefix ui run build
```

Then inspect Settings with neither/image-only/video-only/both credentials: two independent
inputs, env URL disabled, URL save/error state, correct refresh, seven hinted image rows,
no hidden Grok entries, no 88API video group, image generation blocked with video-only auth,
no reasoning badge/search copy for the lane, and arrow-key focus skipping disabled model rows.
Exercise classic, edit, node parent-only/parent-plus,
multimode and Agent image dispatch against the owned mock server; retain MIME and signed
provider URL evidence. Live image/video delivery calls belong exclusively to wp4.

## Audit fold (A1)

* B1: nullable Agent signal and optional reference MIME fields normalized in §5's
  `lib/agentImageVideoGen.ts` arm.
* B2: original 88API Agent errors immediately rethrown before text-only retry in §5;
  §10's `tests/api88-agent-retry-contract.test.ts` asserts one POST for `"No image data"`.
* B3: independent key/origin identity set before pending creation in §3's `KindCache`;
  §10's catalog test adds a deferred initial-GET coalescing case.
* B4: captured origin passed to validation and seed; changed-origin seed invalidated in §3;
  §10's keys/config test covers concurrent origin A validation and origin B PATCH.
* B5: both unused catch bindings removed from §3's `lib/api88/errors.ts`.
* B6: Doctor custom-origin resolution is required wp2 scope in §3, with both credentials
  and the exact custom-origin fixture/test edits in §11; removed the deferral in §12.
* N1: 88API reasoning badge cleared and disabled buttons excluded from keyboard focus in
  §8's `ImageModelSelect.tsx` edits.
* N2: phase-aware compatibility translations remain wp2 text in §9; the parent assigned
  wp3's four-locale video wording update to 020. This leaf did not edit 020.
* N3: parent's explicit existing-file size exception recorded under Plan deviations;
  config/lane/picker logic extracted to NEW modules in §2/§6/§8 with minimal existing wiring.

Affected anchors were re-read against the current tree. This fold changed only this PRD;
no implementation files, builds, tests, network calls or Git writes were performed.
