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
