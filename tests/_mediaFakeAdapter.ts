// Fake media adapters for the L0 runner, route and contract tests. Every network
// call goes through ctx.fetch, like a real adapter, so tests observe the wire.
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter,
  MediaProviderError, MediaSubmitRequest,
} from "../lib/providers/media/contract.ts";
import { redactSecrets } from "../lib/providers/media/redact.ts";

export const FAKE_KEY = "fake-secret-key-1234567890";

export interface FakeScript {
  /** States returned by successive poll() calls; the last one repeats. */
  states: MediaJobState[];
  submitError?: unknown;
  pollErrors?: unknown[];
  canceled?: MediaJobRef[];
  submitted?: MediaSubmitRequest[];
  uploaded?: MediaInput[];
}

export function fakeSpec(id: string, overrides: Partial<MediaModelSpec> = {}): MediaModelSpec {
  return {
    id,
    upstreamId: id.replace("/", ":"),
    vendor: id.split("/")[0]!,
    label: `Fake ${id}`,
    kind: "video",
    tasks: ["text-to-video", "image-to-video"],
    params: { durationsSec: [5, 10], resolutions: ["720p"], aspectRatios: ["16:9"], maxReferenceImages: 2, seed: true },
    pricing: [{ unit: "second", usd: 0.05, variant: "720p", source: "https://example.com/pricing", checkedAt: "2026-11-26" }],
    docsUrl: "https://example.com/docs",
    ...overrides,
  };
}

export class FakeHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function normalize(prefix: string) {
  return (error: unknown): MediaProviderError => {
    const status = error instanceof FakeHttpError ? error.status : undefined;
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    if (status === 401 || status === 403) return { code: `${prefix}_AUTH`, message, status, retryable: false, category: "auth" };
    if (status === 429) return { code: `${prefix}_RATE_LIMIT`, message, status, retryable: true, category: "rate-limit" };
    if (status && status >= 500) return { code: `${prefix}_UPSTREAM`, message, status, retryable: true, category: "upstream" };
    if (status === 400) return { code: `${prefix}_INVALID`, message, status, retryable: false, category: "invalid-request" };
    return { code: `${prefix}_UNKNOWN`, message, retryable: false, category: "unknown" };
  };
}

async function call(ctx: MediaAdapterContext, url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await ctx.fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: ctx.signal,
  });
  // Upstream bodies can echo the key; adapters strip it before it reaches an Error.
  if (!res.ok) throw new FakeHttpError(res.status, redactSecrets(`HTTP ${res.status}: ${await res.text()}`, [ctx.apiKey]));
  return await res.json() as Record<string, unknown>;
}

export function makeFakeAdapter(options: {
  id?: string;
  route?: "direct" | "aggregator";
  vocabulary?: string;
  models?: MediaModelSpec[];
  script?: FakeScript;
  inputTransport?: "url" | "inline" | "upload";
  extraFields?: MediaProviderAdapter["credential"]["extraFields"];
} = {}): MediaProviderAdapter & { script: FakeScript } {
  const id = options.id ?? "fake";
  const prefix = id.toUpperCase().replace(/-/g, "_");
  const script: FakeScript = options.script ?? { states: [{ status: "succeeded", outputs: [] }] };
  let polls = 0;
  const adapter: MediaProviderAdapter & { script: FakeScript } = {
    id,
    label: `Fake ${id}`,
    route: options.route ?? "direct",
    errorPrefix: prefix,
    credential: {
      keyVocabulary: options.vocabulary ?? id,
      envVars: [`${prefix}_API_KEY`],
      configKey: `${id.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}ApiKey`,
      consoleUrl: "https://example.com/keys",
      ...(options.extraFields ? { extraFields: options.extraFields } : {}),
    },
    inputTransport: options.inputTransport ?? "inline",
    script,
    listModels: () => options.models ?? [fakeSpec("acme/clip-1")],
    async validateKey(ctx) {
      try {
        await call(ctx, "https://fake.example/v1/me");
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "rejected" };
      }
    },
    async uploadInput(ctx, input) {
      script.uploaded?.push(input);
      const r = await call(ctx, "https://fake.example/v1/uploads", { mimeType: input.mimeType, size: input.bytes?.length ?? 0 });
      return { url: String(r.url) };
    },
    async submit(ctx, request) {
      script.submitted?.push(request);
      if (script.submitError) throw script.submitError;
      const r = await call(ctx, "https://fake.example/v1/jobs", { model: request.model, prompt: request.prompt });
      return { providerJobId: String(r.id), pollAfterMs: 1 };
    },
    async poll(ctx, job) {
      const err = script.pollErrors?.shift();
      if (err) throw err;
      await call(ctx, `https://fake.example/v1/jobs/${job.providerJobId}`);
      const state = script.states[Math.min(polls, script.states.length - 1)]!;
      polls += 1;
      return state;
    },
    async cancel(_ctx, job) {
      script.canceled?.push(job);
    },
    normalizeError: normalize(prefix),
  };
  return adapter;
}

export interface FetchCall { url: string; method: string; headers: Record<string, string>; body?: string }

/** A transport that answers the fake adapter's endpoints and serves download URLs. */
export function fakeTransport(options: { downloads?: Record<string, { body: Uint8Array | string; type: string; status?: number }>; status?: (url: string) => number } = {}) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    calls.push({ url, method: init?.method ?? "GET", headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (init?.signal?.aborted) throw init.signal.reason ?? new Error("aborted");
    const forced = options.status?.(url);
    if (forced && forced >= 400) return new Response(JSON.stringify({ error: `denied for ${headers.authorization ?? "anon"}` }), { status: forced });
    const dl = options.downloads?.[url];
    if (dl) return new Response(typeof dl.body === "string" ? dl.body : new Blob([dl.body as BlobPart]), { status: dl.status ?? 200, headers: { "content-type": dl.type } });
    if (url.endsWith("/v1/jobs")) return Response.json({ id: "job-1" });
    if (url.endsWith("/v1/uploads")) return Response.json({ url: "https://fake.example/uploaded/1.png" });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
