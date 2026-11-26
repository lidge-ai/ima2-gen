import { followEvents, type StreamStatus, type SubscribeOptions } from "./events.ts";
import { Http, type HttpOptions } from "./http.ts";
import type {
  Accepted, Catalog, HistoryItem, HistoryPage, HistoryQuery, Job, JobEvent, KeySaveBody, KeyStatus,
  MediaSubmitBody, UploadedInput, WorkflowDef, WorkflowEstimate, WorkflowRunBody,
} from "./types.ts";

export type { StreamStatus };

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

export function isTerminal(job: Pick<Job, "status">): boolean {
  return TERMINAL.has(job.status);
}

export interface WatchOptions {
  onUpdate?: (job: Job) => void;
  signal?: AbortSignal;
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

export function createStudioClient(options: HttpOptions = {}) {
  const http = new Http(options);
  const client = {
    http,
    catalog: (signal?: AbortSignal) => http.request<Catalog>("GET", "/api/media/catalog", signal ? { signal } : {}),
    keys: {
      list: () => http.request<{ keys: KeyStatus[] }>("GET", "/api/media/keys").then((r) => r.keys),
      save: (vocab: string, body: KeySaveBody) => http.request<{ key: KeyStatus; validation?: { ok: boolean; reason?: string } }>("PUT", "/api/media/keys/" + enc(vocab), { body }),
      remove: (vocab: string) => http.request<void>("DELETE", "/api/media/keys/" + enc(vocab)),
      validate: (vocab: string) => http.request<{ ok: boolean; reason?: string }>("POST", "/api/media/keys/" + enc(vocab) + "/validate"),
    },
    uploads: {
      put: (data: Blob | Uint8Array, mimeType: string, filename?: string) =>
        http.request<UploadedInput>("POST", "/api/media/uploads", {
          raw: data as BodyInit,
          contentType: mimeType,
          headers: filename ? { "X-Ima2-Filename": enc(filename) } : {},
        }),
    },
    media: {
      submit: (body: MediaSubmitBody) => http.request<Accepted>("POST", "/api/media", { body }),
      job: (jobId: string) => http.request<Job>("GET", "/api/media/jobs/" + enc(jobId)),
      cancel: (jobId: string) => http.request<{ job: Job }>("POST", "/api/media/jobs/" + enc(jobId) + "/cancel"),
      jobs: (query: { status?: "active" | "all"; limit?: number } = {}) =>
        http.request<{ jobs: Job[] }>("GET", "/api/media/jobs", { query }).then((r) => r.jobs),
    },
    history: {
      list: (query: HistoryQuery = {}) => http.request<HistoryPage>("GET", "/api/media/history", { query: { ...query } }),
      remove: (historyId: string) => http.request<void>("DELETE", "/api/media/history/" + enc(historyId)),
      favorite: (historyId: string, favorite: boolean) =>
        http.request<{ item: HistoryItem }>("POST", "/api/media/history/" + enc(historyId) + "/favorite", { body: { favorite } }),
    },
    workflows: {
      list: () => http.request<{ workflows: WorkflowDef[] }>("GET", "/api/workflows").then((r) => r.workflows),
      estimate: (id: string, body: WorkflowRunBody) => http.request<WorkflowEstimate>("POST", "/api/workflows/" + enc(id) + "/estimate", { body }),
      run: (id: string, body: WorkflowRunBody) => http.request<Accepted>("POST", "/api/workflows/" + enc(id), { body }),
    },
    events: {
      follow: (subscribe: SubscribeOptions) => followEvents(http, subscribe),
    },
    /** Resolves with the terminal job. Combines the live stream with snapshots so a job that ends before the stream opens is not missed. */
    watchJob: (jobId: string, watch: WatchOptions = {}) => watchJob(client, jobId, watch),
  };
  return client;
}

export type StudioClient = ReturnType<typeof createStudioClient>;

async function watchJob(client: StudioClient, jobId: string, watch: WatchOptions): Promise<Job> {
  const stop = new AbortController();
  const outer = watch.signal;
  outer?.addEventListener("abort", () => stop.abort(), { once: true });
  return new Promise<Job>((resolve, reject) => {
    let settled = false;
    const accept = (job: Job) => {
      if (settled) return;
      watch.onUpdate?.(job);
      if (isTerminal(job)) { settled = true; stop.abort(); resolve(job); }
    };
    const refresh = () => client.media.job(jobId).then(accept, (error: unknown) => {
      if (!settled) { settled = true; stop.abort(); reject(error); }
    });
    void client.events.follow({
      signal: stop.signal,
      onEvent: (event: JobEvent) => { if (event.jobId === jobId) accept(event.job); },
      onGap: () => { void refresh(); },
      onStatus: (status) => { if (status === "open") void refresh(); },
    });
    stop.signal.addEventListener("abort", () => {
      if (!settled) { settled = true; reject(new DOMException("watch aborted", "AbortError")); }
    }, { once: true });
  });
}
