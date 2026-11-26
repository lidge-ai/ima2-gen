// Fakes for lib/workflows tests: a scripted MediaProviderAdapter, a gateway and local ops. No network.
import { mkdtempSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  MediaAdapterContext, MediaInput, MediaJobRef, MediaJobState, MediaModelSpec, MediaProviderAdapter,
  MediaProviderError, MediaSubmitRequest,
} from "../lib/providers/media/contract.js";
import type { ProbeResult, WorkflowGateway, WorkflowLocalOps, TextPlanRequest } from "../lib/workflows/types.js";

export const SECRET = "sk-test-SECRET-1234567890";

export function tempDir(prefix = "ima2-wf-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFixture(dir: string, name: string, text = name): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

export interface Call { op: string; ctx?: MediaAdapterContext; request?: MediaSubmitRequest; job?: MediaJobRef; input?: MediaInput }

export interface FakeAdapterOptions {
  id?: string;
  transport?: MediaProviderAdapter["inputTransport"];
  /** States returned by successive polls; the last repeats. */
  states?: MediaJobState[];
  submitError?: unknown;
  pollErrors?: unknown[];
}

export function videoOutput(url = "https://cdn.example/out.mp4"): MediaJobState {
  return { status: "succeeded", outputs: [{ kind: "video", url, mimeType: "video/mp4", downloadHeaders: { authorization: "Bearer " + SECRET } }], billed: { usd: 0.5 } };
}

export function fakeAdapter(options: FakeAdapterOptions = {}): MediaProviderAdapter & { calls: Call[] } {
  const calls: Call[] = [];
  const states = options.states ?? [{ status: "queued" }, { status: "running", progress: 0.5 }, videoOutput()];
  const pollErrors = [...(options.pollErrors ?? [])];
  let polls = 0;
  let jobs = 0;
  return {
    calls,
    id: options.id ?? "fake", label: "Fake", route: "direct", errorPrefix: "FAKE",
    credential: { keyVocabulary: "fake", envVars: ["FAKE_API_KEY"], configKey: "fake", consoleUrl: "https://example.test" },
    inputTransport: options.transport ?? "inline",
    listModels: () => [],
    validateKey: async () => ({ ok: true }),
    async uploadInput(ctx, input) {
      calls.push({ op: "upload", ctx, input });
      return { url: "https://uploads.example/" + input.role };
    },
    async submit(ctx, request) {
      calls.push({ op: "submit", ctx, request });
      if (options.submitError) throw options.submitError;
      jobs += 1;
      return { providerJobId: "job-" + jobs, pollAfterMs: 1 };
    },
    async poll(ctx, job) {
      calls.push({ op: "poll", ctx, job });
      const error = pollErrors.shift();
      if (error) throw error;
      const state = states[Math.min(polls, states.length - 1)];
      polls += 1;
      if (!state) throw new Error("no state scripted");
      return state;
    },
    async cancel(ctx, job) {
      calls.push({ op: "cancel", ctx, job });
    },
    normalizeError(error: unknown): MediaProviderError {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /retry/.test(message);
      return { code: "FAKE_" + (retryable ? "UPSTREAM" : "BAD_REQUEST"), message, retryable, category: retryable ? "upstream" : "invalid-request" };
    },
  };
}

export function spec(id: string, extra: Partial<MediaModelSpec> = {}): MediaModelSpec {
  return {
    id, upstreamId: id, vendor: id.split("/")[0] ?? "x", label: id, kind: "video", tasks: ["video-to-video"],
    params: {}, pricing: [], docsUrl: "https://example.test/docs", ...extra,
  };
}

export interface FakeGateway extends WorkflowGateway {
  fetched: { url: string; headers: Record<string, string> }[];
  resolved: { model: string; route: string | undefined }[];
  planned: TextPlanRequest[];
}

export function fakeGateway(adapters: Record<string, MediaProviderAdapter>, specs: Record<string, MediaModelSpec> = {}, planner?: (r: TextPlanRequest) => unknown): FakeGateway {
  const fetched: FakeGateway["fetched"] = [];
  const resolved: FakeGateway["resolved"] = [];
  const planned: TextPlanRequest[] = [];
  const gateway: FakeGateway = {
    fetched, resolved, planned,
    catalog: (id) => specs[id],
    async resolve(model, route) {
      resolved.push({ model, route });
      const adapter = adapters[model];
      if (!adapter) throw Object.assign(new Error("no keyed route for " + model), { code: "MEDIA_NO_KEYED_ROUTE" });
      return { adapter, ctx: { apiKey: SECRET, fetch: globalThis.fetch } };
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      fetched.push({ url: String(url), headers: { ...(init?.headers as Record<string, string> | undefined) } });
      return new Response(new TextEncoder().encode("bytes-of " + String(url)), { status: 200 });
    }) as typeof fetch,
  };
  if (planner) {
    gateway.planText = async (request) => {
      planned.push(request);
      return planner(request);
    };
  }
  return gateway;
}

export interface FakeLocal extends WorkflowLocalOps {
  ops: { op: string; args: string[] }[];
}

/** Local ops that copy files instead of running ffmpeg; probe answers from a table keyed by path. */
export function fakeLocal(probes: Record<string, ProbeResult>): FakeLocal {
  const ops: FakeLocal["ops"] = [];
  return {
    ops,
    async probe(path) {
      ops.push({ op: "probe", args: [path] });
      const info = Object.entries(probes).find(([suffix]) => path.endsWith(suffix))?.[1];
      if (!info) throw new Error("no probe for " + path);
      return info;
    },
    async frame(video, out, position) {
      ops.push({ op: "frame", args: [video, out, position] });
      writeFileSync(out, "frame:" + position);
    },
    async muxAudio(video, audio, out) {
      ops.push({ op: "mux", args: [video, audio, out] });
      await copyFile(video, out);
    },
    async concat(paths, out) {
      ops.push({ op: "concat", args: [...paths, out] });
      writeFileSync(out, "joined:" + paths.length);
    },
  };
}

export const instantPoll = { sleep: async () => undefined, minDelayMs: 0, maxDelayMs: 0 };
