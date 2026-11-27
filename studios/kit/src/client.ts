import { fromWireJob, toCatalog, toKeyStatuses, toQuote, toWireSubmit } from "./adapt.ts";
import { historyParams, toHistoryPage } from "./adaptHistory.ts";
import { toEstimate, toWireRun, toWorkflowDef } from "./adaptWorkflow.ts";
import { followEvents, type StreamStatus, type SubscribeOptions } from "./events.ts";
import { Http, StudioApiError, type HttpOptions } from "./http.ts";
import type {
  Accepted, Catalog, ComfyResultGraph, HistoryPage, HistoryQuery, Job, JobEvent, JobOutput, KeySaveBody, KeyStatus, MediaEstimateResult, MediaSubmitBody, ShowcaseItem, UploadedInput, VoiceList,
  WebSpend, WorkflowDef, WorkflowEstimate, WorkflowRunBody,
} from "./types.ts";
import type { WireAccepted, WireCatalog, WireEstimateResponse, WireHistoryPage, WireInput, WireJob, WireMediaEstimate, WireWorkflow } from "./wire.ts";

export type { StreamStatus };

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

export function isTerminal(job: Pick<Job, "status">): boolean {
  return TERMINAL.has(job.status);
}

export interface WatchOptions {
  onUpdate?: (job: Job) => void;
  signal?: AbortSignal;
}

export interface StudioClientOptions extends HttpOptions {
  /** Groups this tab's jobs on the server (sessionId on /api/media). */
  sessionId?: string;
  /** Favorites are stored per browser (X-Ima2-Browser-Id). */
  browserId?: string;
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

/** Job snapshots built from events, merged with what the job endpoints report. */
export class JobCache {
  readonly jobs = new Map<string, Job>();

  remember(job: Job): Job {
    this.jobs.set(job.jobId, job);
    return job;
  }

  /** Server records carry no outputs or steps; keep what events already told us. */
  merge(wire: WireJob): Job {
    const fresh = fromWireJob(wire);
    const known = this.jobs.get(fresh.jobId);
    if (!known) return this.remember(fresh);
    if (isTerminal(known) || !isTerminal(fresh)) return known;
    // The record says it finished: take its status, error and final progress over what events showed.
    return this.remember({
      ...known,
      status: fresh.status,
      updatedAt: fresh.updatedAt,
      ...(fresh.error ? { error: fresh.error } : {}),
      ...(fresh.progress !== undefined ? { progress: fresh.progress } : {}),
    });
  }
}

function previewUrl(data: Blob | Uint8Array, mimeType: string): string {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType });
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : "";
}

function keysApi(http: Http) {
  const list = async () => toKeyStatuses(await http.request<WireCatalog>("GET", "/api/media/catalog"));
  return {
    list,
    /** The server validates the key with the provider before saving; a rejected key throws KEY_VALIDATION_FAILED. */
    save: async (vocab: string, body: KeySaveBody): Promise<{ key: KeyStatus | undefined }> => {
      await http.request<unknown>("PUT", "/api/keys/" + enc(vocab), { body });
      return { key: (await list()).find((k) => k.keyVocabulary === vocab) };
    },
    remove: (vocab: string) => http.request<unknown>("DELETE", "/api/keys/" + enc(vocab)).then(() => undefined),
  };
}

function uploadsApi(http: Http) {
  return {
    put: async (data: Blob | Uint8Array, mimeType: string, filename?: string): Promise<UploadedInput> => {
      const wire = await http.request<WireInput>("POST", "/api/media/inputs", {
        raw: data as BodyInit,
        contentType: mimeType,
        headers: filename ? { "X-Ima2-Filename": enc(filename) } : {},
      });
      return { inputId: wire.ref, mimeType: wire.mimeType, bytes: wire.bytes, url: previewUrl(data, mimeType) };
    },
  };
}

function mediaApi(http: Http, cache: JobCache, sessionId: string | undefined) {
  const job = async (jobId: string) => cache.merge((await http.request<{ job: WireJob }>("GET", "/api/media/jobs/" + enc(jobId))).job);
  return {
    submit: async (body: MediaSubmitBody): Promise<Accepted> => {
      const wire = await http.request<WireAccepted>("POST", "/api/media", { body: toWireSubmit(body, sessionId) });
      const now = new Date().toISOString();
      cache.remember({
        jobId: wire.requestId, kind: "media", target: wire.model ?? body.model, status: "queued", createdAt: now, updatedAt: now,
        request: body, outputs: [], ...(wire.adapter ? { provider: wire.adapter } : {}),
      });
      return { jobId: wire.requestId, provider: wire.adapter ?? body.provider ?? "" };
    },
    job,
    /**
     * The server's own estimate; for a local route this is the run time instead of a price. The text is not
     * sent, only its length, which is what a per-character price counts.
     */
    estimate: async (body: MediaSubmitBody): Promise<MediaEstimateResult> => {
      const request: Record<string, unknown> = toWireSubmit(body);
      delete request.requestId;
      delete request.prompt;
      if (body.prompt) request.characters = body.prompt.length;
      const wire = await http.request<WireMediaEstimate>("POST", "/api/media/estimate", { body: request });
      return {
        route: wire.route, usd: wire.usd, quote: toQuote(wire.quote),
        ...(wire.note ? { note: wire.note } : {}), ...(wire.local ? { local: wire.local } : {}),
      };
    },
    cancel: async (jobId: string) => {
      await http.request<unknown>("POST", "/api/media/" + enc(jobId) + "/cancel");
      return { job: await job(jobId) };
    },
    jobs: async (query: { status?: "active" | "all" } = {}) => {
      const params = { status: query.status, sessionId };
      const wire = await http.request<{ jobs: WireJob[]; terminalJobs: WireJob[] }>("GET", "/api/media/jobs", { query: params });
      return [...wire.jobs, ...wire.terminalJobs].map((j) => cache.merge(j));
    },
  };
}

function historyApi(http: Http, browserId: string | undefined) {
  const favHeaders: Record<string, string> = browserId ? { "X-Ima2-Browser-Id": browserId } : {};
  const toggle = (filename: string) =>
    http.request<{ isFavorite: boolean }>("POST", "/api/history/favorite", { body: { filename }, headers: favHeaders });
  return {
    list: async (query: HistoryQuery = {}): Promise<HistoryPage> =>
      toHistoryPage(await http.request<WireHistoryPage>("GET", "/api/history", { query: historyParams(query), headers: favHeaders }), query),
    remove: (historyId: string) => http.request<unknown>("DELETE", "/api/history/" + enc(historyId)).then(() => undefined),
    /** The server toggles; toggle again if the first answer is not the wanted state. */
    favorite: async (historyId: string, favorite: boolean) => {
      let state = (await toggle(historyId)).isFavorite;
      if (state !== favorite) state = (await toggle(historyId)).isFavorite;
      return { historyId, favorite: state };
    },
  };
}

function workflowsApi(http: Http, cache: JobCache, sessionId: string | undefined) {
  const defs = new Map<string, WorkflowDef>();
  return {
    list: async () => {
      const wire = await http.request<{ workflows: WireWorkflow[] }>("GET", "/api/workflows");
      const list = wire.workflows.map(toWorkflowDef);
      for (const def of list) defs.set(def.id, def);
      return list;
    },
    estimate: async (id: string, body: WorkflowRunBody): Promise<WorkflowEstimate> =>
      toEstimate(await http.request<WireEstimateResponse>("POST", "/api/workflows/" + enc(id) + "/estimate", { body: toWireRun(body, defs.get(id)) })),
    run: async (id: string, body: WorkflowRunBody): Promise<Accepted> => {
      const wire = await http.request<WireAccepted & WireEstimateResponse>("POST", "/api/workflows/" + enc(id), {
        body: { ...toWireRun(body, defs.get(id)), ...(sessionId ? { sessionId } : {}) },
      });
      const estimate = toEstimate(wire);
      const now = new Date().toISOString();
      cache.remember({
        jobId: wire.requestId, kind: "workflow", target: id, status: "queued", createdAt: now, updatedAt: now, request: body, outputs: [],
        steps: wire.steps.map((s) => ({ id: s.id, label: s.label, status: "queued" as const, ...(s.model ? { model: s.model } : {}),
          ...(s.route ? { provider: s.route } : {}), ...(estimate.steps.find((e) => e.id === s.id) ? { estimate: estimate.steps.find((e) => e.id === s.id)!.estimate } : {}) })),
      });
      return { jobId: wire.requestId, provider: "workflow", estimate: estimate.total };
    },
  };
}

export function createStudioClient(options: StudioClientOptions = {}) {
  const http = new Http(options);
  const cache = new JobCache();
  const client = {
    http,
    catalog: async (signal?: AbortSignal): Promise<Catalog> =>
      toCatalog(await http.request<WireCatalog>("GET", "/api/media/catalog", signal ? { signal } : {})),
    keys: keysApi(http),
    uploads: uploadsApi(http),
    media: mediaApi(http, cache, options.sessionId),
    history: historyApi(http, options.browserId),
    workflows: workflowsApi(http, cache, options.sessionId),
    comfy: {
      /** The ComfyUI graph of a saved result. Throws COMFY_GRAPH_UNAVAILABLE with the reason when there is none; a shared web instance has no such route. */
      resultGraph: async (historyId: string): Promise<ComfyResultGraph> => {
        const body = await http.request<ComfyResultGraph>("GET", "/api/comfy/result-graph", { query: { filename: historyId } });
        return { source: body.source, graph: body.graph, notes: body.notes ?? [] };
      },
    },
    /** Voices for a text-to-speech route. The server asks the provider only when its key is saved, and caches the list. */
    voices: {
      list: (providerId: string, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<VoiceList> =>
        http.request<VoiceList>("GET", "/api/media/voices", {
          query: { provider: providerId, ...(options.refresh ? { refresh: "1" } : {}) },
          ...(options.signal ? { signal: options.signal } : {}),
        }),
    },
    /** Example clips from the server's showcase folder; empty when the operator added none. */
    showcase: {
      list: async (): Promise<ShowcaseItem[]> =>
        (await http.request<{ items: ShowcaseItem[] }>("GET", "/api/showcase")).items ?? [],
    },
    /** Spend limits when this is a shared web instance; null on a local server (no such route). */
    web: {
      spend: async (): Promise<WebSpend | null> => {
        try {
          const body = await http.request<{ spend?: Partial<WebSpend> }>("GET", "/api/web/session");
          const s = body.spend;
          return s && typeof s.dailyCapUsd === "number" && typeof s.requestCapUsd === "number"
            ? { spentUsd: typeof s.spentUsd === "number" ? s.spentUsd : 0, dailyCapUsd: s.dailyCapUsd, requestCapUsd: s.requestCapUsd }
            : null;
        } catch (error) {
          if (error instanceof StudioApiError && error.status === 404) return null;
          throw error;
        }
      },
    },
    events: {
      follow: (subscribe: SubscribeOptions) => followEvents(http, subscribe, cache.jobs),
    },
    /** Resolves with the terminal job. Combines the live stream with snapshots so a job that ends before the stream opens is not missed. */
    watchJob: (jobId: string, watch: WatchOptions = {}) => watchJob(client, jobId, watch),
  };
  return client;
}

export type StudioClient = ReturnType<typeof createStudioClient>;

/**
 * Outputs of a finished media job from history (rows carry the job's request id). The server
 * saves files before it marks the job finished; a short retry covers a slow index.
 */
async function withSavedOutputs(client: StudioClient, job: Job): Promise<Job> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const page = await client.history.list({ limit: 40 });
      const outputs: JobOutput[] = page.items
        .filter((item) => item.jobId === job.jobId)
        .map((item) => ({
          kind: item.kind, mimeType: item.mimeType, url: item.url, historyId: item.historyId,
          ...(item.width !== undefined ? { width: item.width } : {}),
          ...(item.height !== undefined ? { height: item.height } : {}),
          ...(item.durationSec !== undefined ? { durationSec: item.durationSec } : {}),
        }));
      if (outputs.length) return { ...job, outputs };
    } catch {
      // History is a best effort here; the job itself already finished.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return job;
}

async function watchJob(client: StudioClient, jobId: string, watch: WatchOptions): Promise<Job> {
  const stop = new AbortController();
  const outer = watch.signal;
  outer?.addEventListener("abort", () => stop.abort(), { once: true });
  return new Promise<Job>((resolve, reject) => {
    let settled = false;
    const accept = (job: Job) => {
      if (settled) return;
      watch.onUpdate?.(job);
      if (isTerminal(job)) {
        settled = true;
        stop.abort();
        // A job that finished before the stream opened resolves from its record, which has no outputs.
        if (job.status === "succeeded" && job.outputs.length === 0 && job.kind === "media") {
          void withSavedOutputs(client, job).then((full) => {
            if (full !== job) watch.onUpdate?.(full);
            resolve(full);
          });
        } else resolve(job);
      }
    };
    const refresh = () =>
      client.media.job(jobId).then(accept, (error: unknown) => {
        if (!settled) {
          settled = true;
          stop.abort();
          reject(error);
        }
      });
    void client.events.follow({
      signal: stop.signal,
      onEvent: (event: JobEvent) => {
        if (event.jobId === jobId) accept(event.job);
      },
      onGap: () => {
        void refresh();
      },
      onStatus: (status) => {
        if (status === "open") void refresh();
      },
    });
    stop.signal.addEventListener(
      "abort",
      () => {
        if (!settled) {
          settled = true;
          reject(new DOMException("watch aborted", "AbortError"));
        }
      },
      { once: true },
    );
  });
}
