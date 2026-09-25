const FETCH_TIMEOUT_MS = 2_000;
const RECENT_LIMIT = 6;

/** @param {string} url @param {(url: string, init?: RequestInit) => Promise<{ ok: boolean, status?: number, json: () => Promise<any> }>} fetchImpl */
async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function absolute(base, path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  return `${base}${path}`;
}

/**
 * Collects what the tray popup renders: server status plus, when the server is up, the active
 * generation jobs and the most recent outputs. Fetched from the main process so the bundled
 * file:// popup never needs cross-origin access to the loopback API.
 *
 * @typedef {{ ok: boolean, status?: number, json: () => Promise<any> }} JsonResponse
 * @param {{ status: { state: string, url: string | null }, fetchImpl?: (url: string, init?: RequestInit) => Promise<JsonResponse> }} options
 */
export async function collectTraySnapshot({ status, fetchImpl = fetch }) {
  const snapshot = { status, jobs: [], recent: [], error: null };
  const base = status?.state === "running" ? status.url : null;
  if (!base) return snapshot;
  const [jobs, history] = await Promise.allSettled([
    getJson(`${base}/api/inflight`, fetchImpl),
    getJson(`${base}/api/history?limit=${RECENT_LIMIT}`, fetchImpl),
  ]);
  if (jobs.status === "fulfilled" && Array.isArray(jobs.value?.jobs)) {
    snapshot.jobs = jobs.value.jobs.map((job) => ({
      requestId: String(job.requestId ?? ""),
      kind: String(job.kind ?? ""),
      prompt: String(job.prompt ?? "").slice(0, 140),
      phase: String(job.phase ?? "queued"),
      startedAt: Number(job.startedAt) || null,
    }));
  }
  if (history.status === "fulfilled" && Array.isArray(history.value?.items)) {
    snapshot.recent = history.value.items.slice(0, RECENT_LIMIT).map((item) => ({
      filename: String(item.filename ?? ""),
      url: absolute(base, item.url),
      thumb: absolute(base, item.thumb) ?? absolute(base, item.url),
      isVideo: /\.mp4$/i.test(String(item.filename ?? "")),
      createdAt: Number(item.createdAt) || null,
    }));
  }
  const failed = [jobs, history].find((r) => r.status === "rejected");
  if (failed) snapshot.error = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
  return snapshot;
}
