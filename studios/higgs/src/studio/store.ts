import {
  createStudioClient, isTerminal,
  type Catalog, type HistoryItem, type Job, type KeySaveBody, type KeyStatus, type MediaSubmitBody,
  type StreamStatus, type StudioClient, type UploadedInput, type WorkflowDef, type WorkflowRunBody,
} from "@ima2/studio-kit";

export interface StudioState {
  catalog: Catalog | null;
  catalogError: string | null;
  keys: readonly KeyStatus[];
  workflows: readonly WorkflowDef[];
  workflowsLoaded: boolean;
  workflowsError: string | null;
  jobs: Readonly<Record<string, Job>>;
  /** Newest first. */
  jobOrder: readonly string[];
  history: readonly HistoryItem[];
  historyCursor: string | null;
  historyLoaded: boolean;
  stream: StreamStatus;
}

const initial: StudioState = {
  catalog: null, catalogError: null, keys: [], workflows: [], workflowsLoaded: false, workflowsError: null, jobs: {}, jobOrder: [],
  history: [], historyCursor: null, historyLoaded: false, stream: "connecting",
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** All server state for one studio tab. Components read it through useStudio(). */
export class Studio {
  readonly client: StudioClient;
  private state: StudioState = initial;
  private readonly listeners = new Set<() => void>();
  private readonly stop = new AbortController();

  constructor(client: StudioClient = createStudioClient()) {
    this.client = client;
  }

  getState = (): StudioState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private set(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  start(): void {
    void this.refreshCatalog();
    void this.refreshKeys();
    void this.client.workflows.list().then(
      (workflows) => this.set({ workflows, workflowsLoaded: true, workflowsError: null }),
      (error: unknown) => this.set({ workflowsLoaded: true, workflowsError: message(error) }),
    );
    void this.client.media.jobs({ status: "all", limit: 60 }).then((jobs) => { for (const job of jobs.reverse()) this.upsertJob(job); }, () => undefined);
    void this.loadHistory(true);
    void this.client.events.follow({
      signal: this.stop.signal,
      onStatus: (stream) => this.set({ stream }),
      onEvent: (event) => this.upsertJob(event.job),
      onGap: () => { void this.resyncActive(); },
    });
  }

  dispose(): void {
    this.stop.abort();
  }

  async refreshCatalog(): Promise<void> {
    try {
      this.set({ catalog: await this.client.catalog(), catalogError: null });
    } catch (error) {
      this.set({ catalogError: message(error) });
    }
  }

  async refreshKeys(): Promise<void> {
    try {
      this.set({ keys: await this.client.keys.list() });
    } catch {
      // The keys screen shows its own error state on its next load.
    }
  }

  upsertJob(job: Job): void {
    const previous = this.state.jobs[job.jobId];
    if (previous && previous.updatedAt > job.updatedAt) return;
    const jobOrder = previous ? this.state.jobOrder : [job.jobId, ...this.state.jobOrder];
    this.set({ jobs: { ...this.state.jobs, [job.jobId]: job }, jobOrder });
    if (isTerminal(job) && (!previous || !isTerminal(previous)) && job.outputs.length > 0) {
      void this.loadHistory(true);
    }
  }

  private async resyncActive(): Promise<void> {
    const active = Object.values(this.state.jobs).filter((job) => !isTerminal(job));
    await Promise.all(active.map((job) => this.client.media.job(job.jobId).then((fresh) => this.upsertJob(fresh), () => undefined)));
  }

  async loadHistory(reset = false): Promise<void> {
    const cursor = reset ? undefined : this.state.historyCursor ?? undefined;
    if (!reset && !cursor) return;
    const page = await this.client.history.list(cursor ? { cursor, limit: 40 } : { limit: 40 });
    const history = reset ? page.items : [...this.state.history, ...page.items];
    this.set({ history, historyCursor: page.nextCursor, historyLoaded: true });
  }

  async submit(body: MediaSubmitBody): Promise<string> {
    const accepted = await this.client.media.submit(body);
    const job = await this.client.media.job(accepted.jobId);
    this.upsertJob(job);
    return accepted.jobId;
  }

  async runWorkflow(id: string, body: WorkflowRunBody): Promise<string> {
    const accepted = await this.client.workflows.run(id, body);
    const job = await this.client.media.job(accepted.jobId);
    this.upsertJob(job);
    return accepted.jobId;
  }

  async cancel(jobId: string): Promise<void> {
    const { job } = await this.client.media.cancel(jobId);
    this.upsertJob(job);
  }

  upload(file: File): Promise<UploadedInput> {
    return this.client.uploads.put(file, file.type || "application/octet-stream", file.name);
  }

  async saveKey(vocab: string, body: KeySaveBody): Promise<{ ok: boolean; reason?: string } | undefined> {
    const result = await this.client.keys.save(vocab, body);
    await Promise.all([this.refreshKeys(), this.refreshCatalog()]);
    return result.validation;
  }

  async removeKey(vocab: string): Promise<void> {
    await this.client.keys.remove(vocab);
    await Promise.all([this.refreshKeys(), this.refreshCatalog()]);
  }

  async removeHistory(historyId: string): Promise<void> {
    await this.client.history.remove(historyId);
    this.set({ history: this.state.history.filter((item) => item.historyId !== historyId) });
  }

  async toggleFavorite(item: HistoryItem): Promise<void> {
    const { item: next } = await this.client.history.favorite(item.historyId, !item.favorite);
    this.set({ history: this.state.history.map((it) => (it.historyId === next.historyId ? next : it)) });
  }
}
