import { config } from "../config.js";
import { getDb } from "./db.js";
import { publish } from "./eventBus.js";
import { buildEnvelope } from "./jobs/envelope.js";
import { deleteExpiredTerminalJobs, deleteTerminalJob, readTerminalJob, readTerminalJobs,
  writeTerminalJob, type TerminalJob } from "./jobs/terminalStore.js";
import { logError, logEvent } from "./logger.js";

// SQLite-backed inflight job registry.
// Tracks generation requests that are currently running on the server so clients
// can reconcile optimistic UI state after a reload or across tabs.
//
// A restarted process cannot continue the original upstream fetch, but keeping
// metadata durable lets the UI reconcile requestIds and eventually prune stale
// work without losing the recovery breadcrumb.

interface InflightRow {
  request_id: string;
  kind: string;
  prompt?: string | null;
  meta?: string | null;
  session_id?: string | null;
  parent_node_id?: string | null;
  client_node_id?: string | null;
  started_at: number;
  phase?: string | null;
  phase_at?: number | null;
}

interface InflightJob {
  requestId: string;
  kind: string;
  prompt: string;
  meta: Record<string, unknown>;
  startedAt: number;
  phase: string;
  phaseAt: number;
}

const terminalJobs = new Map<string, TerminalJob>(); // requestId -> terminal snapshot, active-only API stays default
/**
 * The map above is the source of truth; SQLite is its backup (#151).
 *
 * Restoration is lazy rather than at module load: routes/events.ts and other
 * modules import this file transitively, and opening the user's database during
 * import would make a route-import contract test touch real user state.
 */
let terminalJobsRestored = false;

function ensureTerminalJobsRestored(): void {
  if (terminalJobsRestored) return;
  terminalJobsRestored = true;
  try {
    const cutoff = Date.now() - config.inflight.terminalTtlMs;
    for (const job of readTerminalJobs(cutoff)) {
      if (!terminalJobs.has(job.requestId)) terminalJobs.set(job.requestId, job);
    }
  } catch (err: unknown) {
    // A restore failure must not take down job tracking; the process simply
    // starts with whatever it learns from here on.
    logError("inflight", "terminal_restore:error", err);
  }
}

function persistTerminalJob(job: TerminalJob): void {
  try {
    writeTerminalJob(job);
  } catch (err: unknown) {
    logError("inflight", "terminal_persist:error", err);
  }
}
const abortControllers = new Map<string, AbortController>();
const controllerRegisteredAt = new Map<string, number>();
const ORPHAN_CONTROLLER_TTL_MS = Math.max(config.inflight.ttlMs * 6, 60 * 60 * 1000);

export const MAX_CONCURRENT_JOBS = Math.max(1, Math.trunc(Number(config.limits.maxParallel) || 24));
export const INFLIGHT_RETRY_AFTER_SECONDS = 5;

export type StartJobFailureCode = "REQUEST_ID_IN_USE" | "TOO_MANY_JOBS" | "GENERATION_CANCELED";
export type StartJobResult = { ok: true } | { ok: false; code: StartJobFailureCode };

export function isStartJobFailure(r: StartJobResult): r is { ok: false; code: StartJobFailureCode } {
  return !r.ok;
}

// Phases: "queued" → "streaming" (upstream connection open, waiting for image)
//                 → "decoding" (b64 received, writing to disk)
export function startJob({ requestId, kind, prompt, meta = {}, respectCanceledTombstone = false }: {
  requestId: string;
  kind: string;
  prompt?: string | null | undefined;
  meta?: Record<string, unknown> | undefined;
  /** Opt-in: deny admission when a fresh canceled tombstone exists (extend route only — queue retry reuses requestIds legitimately). */
  respectCanceledTombstone?: boolean;
}): StartJobResult | undefined {
  if (!requestId) return;
  purgeStaleJobs();
  ensureTerminalJobsRestored();
  if (getJob(requestId)) {
    return { ok: false, code: "REQUEST_ID_IN_USE" };
  }
  // Extend respects a cancel that preceded admission; queue retry may reuse IDs.
  if (respectCanceledTombstone && terminalJobs.get(requestId)?.status === "canceled") {
    return { ok: false, code: "GENERATION_CANCELED" };
  }
  if (countActiveJobs() >= MAX_CONCURRENT_JOBS) {
    return { ok: false, code: "TOO_MANY_JOBS" };
  }
  const startedAt = Date.now();
  const normalizedPrompt = typeof prompt === "string" ? prompt.slice(0, 500) : "";
  const normalizedMeta = normalizeMeta(meta);
  try {
    insertJob({ requestId, kind, prompt: normalizedPrompt, meta: normalizedMeta,
      startedAt, phase: "queued", phaseAt: startedAt });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT") {
      return { ok: false, code: "REQUEST_ID_IN_USE" };
    }
    throw err;
  }
  terminalJobs.delete(requestId);
  abortControllers.delete(requestId);
  controllerRegisteredAt.delete(requestId);
  logEvent("inflight", "start", {
    requestId,
    kind,
    sessionId: normalizedMeta.sessionId || null,
    parentNodeId: normalizedMeta.parentNodeId || null,
    clientNodeId: normalizedMeta.clientNodeId || null,
    promptChars: typeof prompt === "string" ? prompt.length : 0,
  });
  return { ok: true };
}

export function registerJobAbortController(
  requestId: string | null | undefined,
  controller: AbortController,
) {
  if (!requestId) return;
  if (isJobCanceled(requestId) || isJobTrackingExpired(requestId)) {
    controller.abort();
    return;
  }
  abortControllers.set(requestId, controller);
  controllerRegisteredAt.set(requestId, Date.now());
}

export function abortJob(requestId: string | null | undefined) {
  if (!requestId) return { requestId: "", active: false, aborted: false };
  const alreadyTerminal = isJobCanceled(requestId) || isJobTrackingExpired(requestId);
  const controller = abortControllers.get(requestId);
  const active = Boolean(getJob(requestId));
  const aborted = Boolean(controller && !controller.signal.aborted);
  const inflightPhase = getJobPhase(requestId);
  let failed: { error: unknown } | undefined;
  try {
    finishJob(requestId, { canceled: true, httpStatus: 499, errorCode: "GENERATION_CANCELED" });
  } catch (error) { failed = { error }; }
  // Establish terminal dominance before synchronous AbortSignal listeners run.
  if (aborted) controller!.abort();
  if (!alreadyTerminal && (active || aborted)) {
    publishTerminalError(requestId, inflightPhase, "GENERATION_CANCELED", 499, "Generation canceled");
  }
  if (failed) throw failed.error;
  return { requestId, active, aborted };
}

function publishTerminalError(requestId: string, inflightPhase: string | null,
  code: string, status: number, error: string): void {
  const data = { requestId, code, status, error };
  // The registry cannot use ssePublish, which imports it. Keep this cycle-free.
  publish(requestId, "error", data, {
    buildEnvelope: (sequence) => buildEnvelope({ jobId: requestId, requestId,
      sequence, event: "error", data, inflightPhase }),
  });
}

export function isJobCanceled(requestId: string | null | undefined): boolean {
  if (!requestId) return false;
  ensureTerminalJobsRestored();
  return terminalJobs.get(requestId)?.status === "canceled";
}

export function isJobTrackingExpired(requestId: string | null | undefined): boolean {
  if (!requestId) return false;
  ensureTerminalJobsRestored();
  return terminalJobs.get(requestId)?.errorCode === "JOB_TRACKING_TIMEOUT";
}

/**
 * Current raw phase for a job, or null when it is not active.
 *
 * Used by the envelope snapshot (#151) as its last-resort phase source; the
 * event name and the event's own reported phase both outrank it.
 */
export function getJobPhase(requestId: string | null | undefined): string | null {
  if (!requestId) return null;
  try {
    return getJob(requestId)?.phase ?? null;
  } catch {
    // Envelope metadata must never break publishing.
    return null;
  }
}

export function setJobPhase(requestId: string | null | undefined, phase: string) {
  if (!requestId) return;
  const j = getJob(requestId);
  if (!j) return;
  getDb()
    .prepare("UPDATE inflight SET phase = ?, phase_at = ? WHERE request_id = ?")
    .run(phase, Date.now(), requestId);
  logEvent("inflight", "phase", { requestId, kind: j.kind, phase });
}

/**
 * Replace a job's prompt/meta after admission when the authoritative values
 * are only known post-preflight (e.g. extend admission is provisional until
 * parent inheritance resolves). No-op for unknown or terminal jobs.
 */
export function updateJobAdmission(requestId: string | null | undefined, { prompt, meta }: { prompt?: string | null; meta?: Record<string, unknown> }): void {
  if (!requestId || !getJob(requestId)) return;
  const normalizedPrompt = typeof prompt === "string" ? prompt.slice(0, 500) : "";
  const normalizedMeta = normalizeMeta(meta ?? {});
  try {
    getDb()
      .prepare(`UPDATE inflight SET prompt = ?, meta = ? WHERE request_id = ?`)
      .run(normalizedPrompt, JSON.stringify(normalizedMeta), requestId);
  } catch (err: unknown) {
    logError("inflight", "update_admission:error", err);
  }
}

interface FinishJobOptions {
  canceled?: boolean | undefined;
  status?: string | undefined;
  httpStatus?: number | undefined;
  errorCode?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}

function recordFinishedJob(job: InflightJob, options: FinishJobOptions, finishedAt: number): void {
  const status = options.canceled ? "canceled" : options.status || "completed";
  const snapshot: TerminalJob = {
    requestId: job.requestId, kind: job.kind, status, startedAt: job.startedAt,
    finishedAt, durationMs: finishedAt - job.startedAt, phase: job.phase, phaseAt: job.phaseAt,
    httpStatus: options.httpStatus, errorCode: options.errorCode,
    meta: { ...job.meta, ...(options.meta || {}) },
  };
  terminalJobs.set(job.requestId, snapshot);
  persistTerminalJob(snapshot);
  logEvent("inflight", "finish", { requestId: job.requestId, kind: job.kind, status,
    durationMs: snapshot.durationMs, httpStatus: options.httpStatus, errorCode: options.errorCode });
}

export function finishJob(requestId: string | null | undefined, options: FinishJobOptions = {}) {
  if (!requestId) return;
  ensureTerminalJobsRestored();
  const j = getJob(requestId);
  const finishedAt = Date.now();
  const forcedTerminal = isJobCanceled(requestId) || isJobTrackingExpired(requestId);
  if (j && !forcedTerminal) {
    recordFinishedJob(j, options, finishedAt);
  } else if (options.canceled && !terminalJobs.has(requestId)) {
    const tombstone: TerminalJob = {
      requestId,
      kind: "unknown",
      status: "canceled",
      startedAt: finishedAt,
      finishedAt,
      durationMs: 0,
      phase: "unknown",
      phaseAt: finishedAt,
      httpStatus: options.httpStatus,
      errorCode: options.errorCode,
      meta: {},
    };
    terminalJobs.set(requestId, tombstone);
    persistTerminalJob(tombstone);
  }
  getDb().prepare("DELETE FROM inflight WHERE request_id = ?").run(requestId);
  abortControllers.delete(requestId);
  controllerRegisteredAt.delete(requestId);
  reapTerminalJobs();
}

export function reapTerminalJobs(now = Date.now()) {
  for (const [id, j] of terminalJobs) {
    if (now - j.finishedAt > config.inflight.terminalTtlMs) terminalJobs.delete(id);
  }
  try {
    deleteExpiredTerminalJobs(now - config.inflight.terminalTtlMs);
  } catch (err: unknown) {
    logError("inflight", "terminal_reap:error", err);
  }
  for (const [id, registeredAt] of controllerRegisteredAt) {
    if (now - registeredAt <= ORPHAN_CONTROLLER_TTL_MS || getJob(id)) continue;
    abortControllers.get(id)?.abort();
    abortControllers.delete(id);
    controllerRegisteredAt.delete(id);
  }
}

export interface JobFilters {
  kind?: string | undefined;
  sessionId?: string | undefined;
}

export function listJobs(filters: JobFilters = {}) {
  purgeStaleJobs();
  const { kind, sessionId } = filters;
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (kind) {
    clauses.push("kind = ?");
    params.push(kind);
  }
  if (sessionId) {
    clauses.push("session_id = ?");
    params.push(sessionId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM inflight${where} ORDER BY started_at ASC`)
    .all(...params)
    .map((row) => rowToJob(row as InflightRow));
}

export function listTerminalJobs(filters: JobFilters = {}) {
  ensureTerminalJobsRestored();
  reapTerminalJobs();
  const { kind, sessionId } = filters;
  return Array.from(terminalJobs.values())
    .filter((j) => {
      if (kind && j.kind !== kind) return false;
      if (sessionId && j.meta?.sessionId !== sessionId) return false;
      return true;
    })
    .sort((a, b) => b.finishedAt - a.finishedAt);
}

export function _resetForTests() {
  getDb().prepare("DELETE FROM inflight").run();
  getDb().prepare("DELETE FROM terminal_jobs").run();
  terminalJobs.clear();
  terminalJobsRestored = true;
  abortControllers.clear();
  controllerRegisteredAt.clear();
}

export function purgeStaleJobs(now = Date.now()) {
  ensureTerminalJobsRestored();
  let outcomes: Array<{ terminal: TerminalJob; expired: boolean }>;
  try {
    outcomes = getDb().transaction(() => expireStaleRows(now))();
  } catch (error) {
    logError("inflight", "expire:error", error);
    return;
  }
  // Commit every memory outcome before any reentrant abort listener can publish.
  for (const { terminal } of outcomes) terminalJobs.set(terminal.requestId, terminal);
  for (const { terminal, expired } of outcomes) {
    const controller = abortControllers.get(terminal.requestId);
    abortControllers.delete(terminal.requestId);
    controllerRegisteredAt.delete(terminal.requestId);
    if (terminal.status === "canceled" || terminal.errorCode === "JOB_TRACKING_TIMEOUT") controller?.abort();
    if (expired) publishTerminalError(terminal.requestId, terminal.phase, "JOB_TRACKING_TIMEOUT", 504,
      "Job tracking expired; upstream completion is unknown. Inspect history before retrying.");
  }
}

function expireStaleRows(now: number): Array<{ terminal: TerminalJob; expired: boolean }> {
  const rows = getDb().prepare(`SELECT request_id, kind, prompt, meta, session_id,
    parent_node_id, client_node_id, started_at, phase, phase_at FROM inflight WHERE started_at < ?`)
    .all(now - config.inflight.ttlMs) as InflightRow[];
  const cutoff = now - config.inflight.terminalTtlMs;
  return rows.map(row => {
    const memory = terminalJobs.get(row.request_id);
    const disk = readTerminalJob(row.request_id, cutoff);
    const retained = memory && memory.finishedAt > cutoff ? memory : disk;
    const terminal = retained ?? expiredSnapshot(rowToJob(row), now);
    // Also repairs a prior best-effort persistence failure without changing time/status.
    if (!retained || JSON.stringify(terminal) !== JSON.stringify(disk)) writeTerminalJob(terminal);
    getDb().prepare("DELETE FROM inflight WHERE request_id = ?").run(row.request_id);
    return { terminal, expired: !retained };
  });
}

function expiredSnapshot(job: InflightJob, now: number): TerminalJob {
  return { requestId: job.requestId, kind: job.kind, status: "error", startedAt: job.startedAt,
    finishedAt: now, durationMs: now - job.startedAt, phase: job.phase, phaseAt: job.phaseAt,
    httpStatus: 504, errorCode: "JOB_TRACKING_TIMEOUT", meta: job.meta };
}

function insertJob(job: InflightJob): void {
  getDb().transaction(() => {
    getDb().prepare(`INSERT INTO inflight (request_id, kind, prompt, meta, session_id,
      parent_node_id, client_node_id, started_at, phase, phase_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(job.requestId, job.kind, job.prompt, JSON.stringify(job.meta), stringOrNull(job.meta.sessionId),
        stringOrNull(job.meta.parentNodeId), stringOrNull(job.meta.clientNodeId), job.startedAt, job.phase, job.phaseAt);
    deleteTerminalJob(job.requestId);
  })();
}

function countActiveJobs(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM inflight")
    .get() as { count: number };
  return Number(row.count);
}

function getJob(requestId: string): InflightJob | null {
  const row = getDb()
    .prepare("SELECT * FROM inflight WHERE request_id = ?")
    .get(requestId) as InflightRow | undefined;
  return row ? rowToJob(row) : null;
}

function rowToJob(row: InflightRow): InflightJob {
  const meta = normalizeMeta(parseMeta(row.meta));
  const sessionId = stringOrNull(row.session_id) ?? stringOrNull(meta.sessionId);
  const parentNodeId =
    stringOrNull(row.parent_node_id) ?? stringOrNull(meta.parentNodeId);
  const clientNodeId =
    stringOrNull(row.client_node_id) ?? stringOrNull(meta.clientNodeId);
  return {
    requestId: row.request_id,
    kind: row.kind,
    prompt: row.prompt || "",
    meta: {
      ...meta,
      ...(sessionId ? { sessionId } : {}),
      ...(parentNodeId ? { parentNodeId } : {}),
      ...(clientNodeId ? { clientNodeId } : {}),
    },
    startedAt: Number(row.started_at),
    phase: row.phase || "queued",
    phaseAt: Number(row.phase_at || row.started_at),
  };
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
