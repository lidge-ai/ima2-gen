import { quoteFor, quoteUnit } from "../../../lib/providers/media/priceQuote";
import { resolutionOptions } from "../../../lib/providers/media/resolutionLabel";
import type { BrowserContext, Page, Route } from "@playwright/test";

// Synthetic media catalog for the classic model window. Shapes mirror GET /api/media/catalog;
// names are real model families so screenshots read like the product, prices are made up.

type Price = { unit: string; usd: number; variant?: string; source: string; checkedAt: string };
type RouteSpec = { adapter: string; tasks: string[]; params?: Record<string, unknown>; pricing?: Price[] };
type ModelSpec = { id: string; label: string; vendor: string; kind: "image" | "video"; routes: RouteSpec[] };

const price = (usd: number, unit = "second", variant?: string): Price =>
  ({ unit, usd, source: "https://example.com/pricing", checkedAt: "2026-11-27", ...(variant ? { variant } : {}) });
const seconds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const ADAPTERS: Record<string, { label: string; route: "direct" | "aggregator"; vocabulary: string; logo?: string | null; extra?: { name: string; secret: boolean; required: boolean }[] }> = {
  byteplus: { label: "BytePlus ModelArk", route: "direct", vocabulary: "byteplus", logo: null, extra: [{ name: "region", secret: false, required: false }] },
  google: { label: "Google Gemini API", route: "direct", vocabulary: "gemini", logo: "google-mark.png" },
  kling: { label: "Kling", route: "direct", vocabulary: "kling", logo: "kling-mark.png" },
  minimax: { label: "MiniMax", route: "direct", vocabulary: "minimax", logo: "minimax-mark.png" },
  pixverse: { label: "PixVerse", route: "direct", vocabulary: "pixverse", logo: "pixverse-mark.svg" },
  bfl: { label: "Black Forest Labs", route: "direct", vocabulary: "bfl", logo: "black-forest-labs-mark.svg" },
  openai: { label: "OpenAI", route: "direct", vocabulary: "openai", logo: "openai-mark.svg" },
  recraft: { label: "Recraft", route: "direct", vocabulary: "recraft", logo: null },
  "kling-legacy": { label: "Kling (access key)", route: "direct", vocabulary: "kling-legacy", logo: "kling-mark.png", extra: [{ name: "secretKey", secret: true, required: true }] },
  fal: { label: "fal", route: "aggregator", vocabulary: "fal", logo: "fal-mark.png" },
  replicate: { label: "Replicate", route: "aggregator", vocabulary: "replicate", logo: "replicate-mark.svg" },
  sume: { label: "Sume", route: "aggregator", vocabulary: "sume", logo: "sume-mark.svg" },
};
const VENDOR_LOGO: Record<string, [string, string | null]> = {
  bytedance: ["ByteDance", "bytedance-mark.png"], google: ["Google", "google-mark.png"], kling: ["Kling", "kling-mark.png"],
  minimax: ["MiniMax", "minimax-mark.png"], pixverse: ["PixVerse", "pixverse-mark.svg"], "black-forest-labs": ["Black Forest Labs", "black-forest-labs-mark.svg"],
  openai: ["OpenAI", "openai-mark.svg"], recraft: ["Recraft", null], sync: ["Sync", null], heygen: ["HeyGen", "heygen-mark.svg"],
};

const VIDEO = ["text-to-video", "image-to-video"];
const MODELS: ModelSpec[] = [
  { id: "bytedance/seedance-2.5", label: "Seedance 2.5", vendor: "bytedance", kind: "video", routes: [
    { adapter: "byteplus", tasks: [...VIDEO, "reference-to-video", "video-to-video"], params: { durationsSec: seconds(4, 15), resolutions: ["480p", "720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1", "adaptive"], maxReferenceImages: 4, nativeAudio: true },
      pricing: [price(0.103, "second", "480p 16:9, no video input"), price(0.231, "second", "720p 16:9, no video input"), price(0.569, "second", "1080p 16:9, no video input")] },
    { adapter: "fal", tasks: [...VIDEO, "reference-to-video"], params: { durationsSec: seconds(4, 12), resolutions: ["480p", "720p"], aspectRatios: ["auto", "16:9", "9:16"], nativeAudio: true, seed: true },
      pricing: [price(0.2205, "second", "text-to-video:480p"), price(0.473, "second", "text-to-video:720p"), price(0.2205, "second", "image-to-video:480p"), price(0.473, "second", "image-to-video:720p")] },
    { adapter: "sume", tasks: VIDEO, params: { durationsSec: seconds(4, 12), resolutions: ["480p", "720p", "1080p"], aspectRatios: ["16:9", "9:16"], nativeAudio: true },
      pricing: [price(0.0977, "second", "480p"), price(0.2197, "second", "720p"), price(0.5402, "second", "1080p")] },
  ] },
  { id: "google/veo-4", label: "Veo 4", vendor: "google", kind: "video", routes: [
    { adapter: "google", tasks: VIDEO, params: { durationsSec: [4, 6, 8], resolutions: ["720p", "1080p", "4k"], aspectRatios: ["16:9", "9:16"], nativeAudio: true, negativePrompt: true }, pricing: [price(0.4)] },
    { adapter: "fal", tasks: VIDEO, params: { durationsSec: [4, 6, 8], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16"], nativeAudio: true }, pricing: [price(0.5)] },
  ] },
  { id: "minimax/hailuo-3", label: "Hailuo 3", vendor: "minimax", kind: "video", routes: [
    { adapter: "minimax", tasks: VIDEO, params: { durationsSec: [6, 10], resolutions: ["768P", "1080P"] }, pricing: [price(0.045)] },
    { adapter: "fal", tasks: VIDEO, params: { durationsSec: [6, 10], resolutions: ["768p"], seed: true }, pricing: [price(0.06)] },
    { adapter: "replicate", tasks: VIDEO, params: { durationsSec: [6, 10], resolutions: ["768p"], seed: true }, pricing: [price(0.065)] },
  ] },
  { id: "kling/kling-4.0", label: "Kling 4.0", vendor: "kling", kind: "video", routes: [
    { adapter: "kling", tasks: VIDEO, params: { durationsSec: [5, 10], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16", "1:1"], negativePrompt: true }, pricing: [price(0.07, "second", "720p"), price(0.112, "second", "1080p")] },
    { adapter: "kling-legacy", tasks: VIDEO, params: { durationsSec: [5, 10], resolutions: ["720p"] }, pricing: [] },
  ] },
  { id: "kling/kling-4.0-turbo", label: "Kling 4.0 Turbo", vendor: "kling", kind: "video", routes: [
    { adapter: "fal", tasks: VIDEO, params: { durationsSec: [5, 10, 20], resolutions: ["720p"], aspectRatios: ["16:9", "9:16"] }, pricing: [price(0.035)] },
  ] },
  { id: "pixverse/v6", label: "PixVerse V6", vendor: "pixverse", kind: "video", routes: [
    { adapter: "pixverse", tasks: VIDEO, params: { durationsSec: [5, 8], resolutions: ["540p", "720p", "1080p"] }, pricing: [] },
  ] },
  { id: "sync/lipsync-3", label: "Lipsync 3", vendor: "sync", kind: "video", routes: [{ adapter: "fal", tasks: ["lipsync"], pricing: [price(0.08)] }] },
  { id: "heygen/avatar-5", label: "Avatar 5", vendor: "heygen", kind: "video", routes: [{ adapter: "fal", tasks: ["avatar"], pricing: [] }] },
  { id: "black-forest-labs/flux-2-pro", label: "FLUX.2 Pro", vendor: "black-forest-labs", kind: "image", routes: [
    { adapter: "bfl", tasks: ["text-to-image", "image-to-image"], params: { aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"], maxReferenceImages: 4, seed: true }, pricing: [price(0.03, "megapixel")] },
    { adapter: "fal", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "2K"], aspectRatios: ["1:1", "16:9", "9:16"], maxReferenceImages: 4, seed: true }, pricing: [price(0.035, "image", "1K"), price(0.07, "image", "2K")] },
    { adapter: "replicate", tasks: ["text-to-image"], params: { aspectRatios: ["1:1", "16:9"], seed: true }, pricing: [price(0.04, "image")] },
  ] },
  { id: "google/nano-banana-pro", label: "Nano Banana Pro", vendor: "google", kind: "image", routes: [
    { adapter: "google", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], maxReferenceImages: 8 }, pricing: [price(0.134, "image", "1K"), price(0.134, "image", "2K"), price(0.24, "image", "4K")] },
    { adapter: "fal", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "16:9", "9:16"], maxReferenceImages: 8 }, pricing: [price(0.15, "image", "1K"), price(0.15, "image", "2K"), price(0.3, "image", "4K")] },
  ] },
  { id: "bytedance/seedream-5.5", label: "Seedream 5.5", vendor: "bytedance", kind: "image", routes: [
    { adapter: "byteplus", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "1.5K", "2K"], aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"], maxReferenceImages: 10 }, pricing: [price(0.02, "image", "up to 1.5K"), price(0.035, "image", "2K")] },
    { adapter: "fal", tasks: ["text-to-image", "image-to-image"], params: {}, pricing: [price(0.0405, "image", "text-to-image:2k"), price(0.0405, "image", "image-to-image:2k")] },
    { adapter: "sume", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "1.5K", "2K"], aspectRatios: ["1:1", "16:9", "9:16"] }, pricing: [price(0.02, "image", "1K"), price(0.02, "image", "1.5K"), price(0.035, "image", "2K")] },
  ] },
  { id: "bytedance/seedream-5.5-lite", label: "Seedream 5.5 Lite", vendor: "bytedance", kind: "image", routes: [
    { adapter: "fal", tasks: ["text-to-image"], params: { resolutions: ["1K"], aspectRatios: ["1:1", "16:9"] }, pricing: [price(0.012, "image")] },
  ] },
  { id: "openai/gpt-image-2.5", label: "GPT Image 2.5", vendor: "openai", kind: "image", routes: [
    { adapter: "openai", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1024x1024", "1536x1024", "1024x1536"], maxReferenceImages: 16 }, pricing: [price(0.011, "image", "low"), price(0.042, "image", "medium"), price(0.167, "image", "high")] },
  ] },
  { id: "openai/gpt-image-2", label: "GPT Image 2 (deprecated)", vendor: "openai", kind: "image", routes: [
    { adapter: "fal", tasks: ["text-to-image", "image-to-image"], params: { resolutions: ["1K", "2K"], qualities: ["low", "medium", "high"], maxReferenceImages: 4 },
      pricing: [price(0.006, "image", "1K · low"), price(0.0528, "image", "1K · medium"), price(0.2108, "image", "1K · high"), price(0.012, "image", "2K · low"), price(0.1, "image", "2K · medium"), price(0.4, "image", "2K · high")] },
  ] },
  { id: "ideogram/ideogram-v3", label: "Ideogram 3", vendor: "ideogram", kind: "image", routes: [
    { adapter: "fal", tasks: ["text-to-image", "image-to-image"], params: { qualities: ["TURBO", "BALANCED", "QUALITY"], maxReferenceImages: 1 }, pricing: [price(0.03, "image", "TURBO"), price(0.06, "image", "BALANCED"), price(0.09, "image", "QUALITY")] },
  ] },
  { id: "alibaba/z-image", label: "Z-Image", vendor: "alibaba", kind: "image", routes: [
    { adapter: "fal", tasks: ["text-to-image"], params: { aspectRatios: ["1:1", "16:9"] }, pricing: [price(0.005, "megapixel")] },
  ] },
  { id: "recraft/v4", label: "Recraft V4", vendor: "recraft", kind: "image", routes: [
    { adapter: "recraft", tasks: ["text-to-image"], params: { aspectRatios: ["1:1", "16:9", "9:16"] }, pricing: [price(0.04, "image")] },
  ] },
];

// The catalog offers a square symbol as urls.mark when the kit manifest has one; makers without one get a monogram in the UI.
const logo = (name: string, mark: string | null) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name,
  urls: mark ? { mark: "/media-assets/vendors/" + mark } : {}, source: null });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export interface MediaFixture {
  /** Key vocabularies that currently hold a key. */
  keys: Set<string>;
  /** "loading" holds the catalog answer until the mode changes. */
  catalogMode: "ready" | "error" | "loading";
  /** What the provider says when a key is validated. */
  keyVerdict: "ok" | "reject";
  /** Every request this fixture answered, in order. */
  calls: { method: string; path: string; body: Record<string, unknown> | null }[];
  submissions: Record<string, unknown>[];
  /** Rows GET /api/history returns; empty leaves the base fixture's empty history. */
  history: Record<string, unknown>[];
  terminalJobs: Record<string, unknown>[];
  mediaReads(): number;
  /** Delivers a job event on the page's event channel, as /api/events would. */
  emit(page: Page, event: string, requestId: string, data: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

function catalog(fixture: MediaFixture, kind: string | null) {
  const hasKey = (adapter: string) => fixture.keys.has(ADAPTERS[adapter]!.vocabulary);
  const models = MODELS.filter((model) => !kind || model.kind === kind).map((model) => {
    const routes = model.routes.map((route) => ({ adapter: route.adapter, route: ADAPTERS[route.adapter]!.route, label: ADAPTERS[route.adapter]!.label,
      logo: logo(ADAPTERS[route.adapter]!.label, ADAPTERS[route.adapter]!.logo ?? null), upstreamId: model.id,
      tasks: route.tasks, params: route.params ?? {}, resolutionOptions: resolutionOptions((route.params?.resolutions as string[] | undefined) ?? []), pricing: route.pricing ?? [], docsUrl: "https://example.com/docs/" + route.adapter, hasKey: hasKey(route.adapter) }));
    const vendor = VENDOR_LOGO[model.vendor];
    return { id: model.id, label: model.label, vendor: model.vendor, logo: vendor ? logo(vendor[0], vendor[1]) : null, kind: model.kind,
      tasks: [...new Set(routes.flatMap((route) => route.tasks))], routes,
      defaultRoute: (routes.find((r) => r.hasKey && r.route === "direct") ?? routes.find((r) => r.hasKey))?.adapter ?? null };
  });
  const adapters = Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label, route: a.route, logo: logo(a.label, a.logo ?? null),
    keyVocabulary: a.vocabulary, consoleUrl: "https://example.com/keys/" + id, keyPrefix: null, hasKey: fixture.keys.has(a.vocabulary),
    keySource: fixture.keys.has(a.vocabulary) ? "config" : "none", maskedKey: fixture.keys.has(a.vocabulary) ? "fixt..ey" : null,
    extraFields: (a.extra ?? []).map((field) => ({ ...field, configured: false, source: "none" })), modelCount: 1 }));
  return { models, adapters };
}

/** Answers like lib/providers/media/estimate.ts, with the server's own price rule. */
function estimate(fixture: MediaFixture, body: Record<string, unknown>) {
  const model = MODELS.find((entry) => entry.id === body.model);
  const route = model?.routes.find((entry) => entry.adapter === body.adapter) ?? model?.routes[0];
  if (!model || !route) return { status: 404, json: { ok: false, code: "MEDIA_MODEL_UNKNOWN", error: "Unknown media model", category: "not-found", retryable: false } };
  const pricing = route.pricing ?? [];
  const text = (key: string) => (typeof body[key] === "string" ? { [key]: body[key] as string } : {});
  const number = (key: string) => (typeof body[key] === "number" ? { [key]: body[key] as number } : {});
  const quote = quoteFor({ pricing, params: route.params ?? {} }, { kind: model.kind, task: String(body.task), ...text("resolution"), ...text("quality"),
    ...(typeof body.audio === "boolean" ? { audio: body.audio } : {}), ...number("durationSec"), ...number("count") });
  const unit = quoteUnit(model.kind, pricing);
  return { status: 200, json: { model: model.id, adapter: route.adapter, route: ADAPTERS[route.adapter]!.route, hasKey: fixture.keys.has(ADAPTERS[route.adapter]!.vocabulary),
    unit, quantity: "quantity" in quote ? quote.quantity : null, usd: quote.state === "exact" || quote.state === "from" ? quote.usd : null, prices: pricing, quote } };
}

async function answer(route: Route, fixture: MediaFixture): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const path = url.pathname;
  const media = path.startsWith("/api/media");
  const keyWrite = /^\/api\/keys\/[^/]+(\/validate)?$/.test(path) && method !== "GET";
  if (method === "GET" && path.startsWith("/generated/l11-")) return route.fulfill({ contentType: "image/png", body: PNG });
  if (method === "GET" && path === "/api/history" && fixture.history.length && !url.searchParams.has("groupBy")) {
    return route.fulfill({ json: { items: fixture.history, total: fixture.history.length, nextCursor: null } });
  }
  if (method === "GET" && path === "/api/inflight" && fixture.terminalJobs.length) {
    return route.fulfill({ json: { jobs: [], terminalJobs: fixture.terminalJobs } });
  }
  if (!media && !keyWrite) return route.fallback();
  let body: Record<string, unknown> | null = null;
  try { body = method === "GET" ? null : request.postDataJSON() as Record<string, unknown>; } catch { body = null; }
  fixture.calls.push({ method, path, body });
  if (method === "GET" && path === "/api/media/catalog") {
    for (let waited = 0; fixture.catalogMode === "loading" && waited < 30_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    if (fixture.catalogMode === "error") return route.fulfill({ status: 503, json: { error: "Fixture catalog unavailable" } });
    return route.fulfill({ json: catalog(fixture, url.searchParams.get("kind")) });
  }
  if (method === "POST" && path === "/api/media/estimate") { const result = estimate(fixture, body ?? {}); return route.fulfill(result); }
  if (method === "POST" && path === "/api/media/inputs") return route.fulfill({ status: 201, json: { ref: "input-" + fixture.calls.length } });
  if (method === "POST" && path === "/api/media") {
    fixture.submissions.push(body ?? {});
    return route.fulfill({ status: 202, json: { requestId: body?.requestId, model: body?.model, adapter: body?.adapter } });
  }
  if (method === "POST" && /^\/api\/media\/[^/]+\/cancel$/.test(path)) return route.fulfill({ json: { ok: true } });
  const vocabulary = decodeURIComponent(path.split("/")[3] ?? "");
  if (keyWrite && method === "DELETE") { fixture.keys.delete(vocabulary); return route.fulfill({ json: { ok: true, provider: vocabulary, removed: true } }); }
  if (keyWrite) {
    if (fixture.keyVerdict === "reject") {
      return route.fulfill({ status: 400, json: { ok: false, code: "KEY_VALIDATION_FAILED", error: "API key validation failed: HTTP 401: invalid api key", category: "auth" } });
    }
    if (method === "PUT") fixture.keys.add(vocabulary);
    return route.fulfill({ json: path.endsWith("/validate") ? { ok: true, vocabulary, valid: true, source: "request" } : { ok: true, provider: vocabulary, source: "config", valid: true } });
  }
  return route.fulfill({ status: 404, json: { ok: false, code: "FIXTURE_UNKNOWN", error: "Unknown fixture path" } });
}

/**
 * The page's EventSource is replaced by one the test drives. A synthetic origin cannot hold a real
 * stream open (a fulfilled route is one finished body), and the job events are what the tests assert on.
 */
function installEventChannel(): void {
  const live = new Set<EventTarget>();
  class FixtureEventSource extends EventTarget {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
    readyState = 0; withCredentials = false;
    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly url: string) {
      super();
      live.add(this);
      setTimeout(() => { if (this.readyState === 2) return; this.readyState = 1; const open = new Event("open"); this.onopen?.(open); this.dispatchEvent(open); }, 0);
    }
    close(): void { this.readyState = 2; live.delete(this); }
  }
  let frame = 0;
  Object.assign(window, { EventSource: FixtureEventSource,
    l11Emit: (event: string, data: Record<string, unknown>) => {
      frame += 1;
      for (const source of live) source.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data), lastEventId: String(frame) }));
      return live.size;
    } });
}

/**
 * Layered over a base route handler: this one answers the media and key-write routes and passes
 * everything else down, so the base fixture still refuses any API read it does not know.
 */
export async function installMediaFixture(context: BrowserContext, options: { keys?: string[] } = {}): Promise<MediaFixture> {
  const fixture: MediaFixture = {
    keys: new Set(options.keys ?? ["fal"]), catalogMode: "ready", keyVerdict: "ok", calls: [], submissions: [], history: [], terminalJobs: [],
    mediaReads: () => fixture.calls.filter((call) => call.path.startsWith("/api/media")).length,
    emit: async (page, event, requestId, data) => {
      const delivered = await page.evaluate(([name, payload]) => (window as unknown as { l11Emit(event: string, data: unknown): number }).l11Emit(name, payload),
        [event, { jobId: requestId, requestId, jobKind: "media", ...data }] as const);
      if (delivered < 1) throw new Error("No open event channel to deliver " + event);
    },
    close: async () => { await context.unroute("**/*", handler); },
  };
  const handler = (route: Route) => answer(route, fixture);
  await context.addInitScript(installEventChannel);
  await context.route("**/*", handler);
  return fixture;
}

/** A history row as GET /api/history lists a media result, with the provenance fields the server adds. */
export function mediaHistoryRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { filename: "l11-flux.png", url: "/generated/l11-flux.png", thumb: null, mediaType: "image", createdAt: 1_795_700_000_000,
    prompt: "a lighthouse at dusk, film grain", userPrompt: "a lighthouse at dusk, film grain", revisedPrompt: null, quality: null, size: null, format: "png",
    provider: "media:fal", adapter: "fal", route: "aggregator", model: "black-forest-labs/flux-2-pro", elapsed: 12.4, usage: null, webSearchCalls: 0,
    sessionId: "wp02-session", requestId: "media_fixture_1", kind: "image",
    media: { task: "text-to-image", durationSec: null, resolution: "2K", aspectRatio: "16:9", seed: 7, audio: null, inputRoles: [] },
    billed: { usd: 0.07 }, estimate: { usd: 0.07, basis: "exact" }, ...over };
}
