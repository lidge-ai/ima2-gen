import { recordTerminalMediaFailure } from "./storeMediaImpl";
import type { GenerateItem } from "../types";
import { getHistory } from "../lib/api";
import { handleError } from "../lib/errorHandler";
import { getLanAuthEpoch, isLanSessionLocked, LAN_AUTH_REQUIRED_EVENT } from "../lib/lanSession";
import { INFLIGHT_TTL_MS, fetchInflightScopes, saveInFlight, HISTORY_LIMIT,
  mapHistoryItem, historyKey, retainHistoryItems } from "./storeHelpers";
import { captureInflightSnapshot, eligibleInflightIds, isInflightSnapshotCurrent,
  mergeInflightSnapshot, type InflightSnapshot, type InflightMerge } from "./inflightReconciliation";
import { saveSelectedFilename } from "./storePersistence";
import type { AppState, StoreSet, StoreGet } from "./storeTypes";

type PollWindow = { __ima2InflightTimer?: number; __ima2StopTicks?: number };
type HistoryEligibility = { snapshot: InflightSnapshot; eligibleIds: Set<string>; serverActiveIds: Set<string> };
let pollingRevision = 0;

/** Pause observations only; accepted jobs and persisted drafts retain their owners. */
export function stopInFlightPollingImpl(): void {
  pollingRevision += 1;
  if (typeof window === "undefined") return;
  const w = window as unknown as PollWindow;
  if (w.__ima2InflightTimer !== undefined) clearInterval(w.__ima2InflightTimer);
  w.__ima2InflightTimer = undefined;
  w.__ima2StopTicks = 0;
  window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, stopInFlightPollingImpl);
}

function commitMerge(merge: InflightMerge, set: StoreSet, get: StoreGet): void {
  const current = get();
  saveInFlight(merge.inFlight);
  if (merge.inFlight.length !== current.inFlight.length || current.activeGenerations !== merge.inFlight.length
    || merge.inFlight.some((job, index) => job !== current.inFlight[index])) {
    set({ inFlight: merge.inFlight, activeGenerations: merge.inFlight.length });
  }
  for (const error of merge.terminalErrors) { handleError(error, get()); recordTerminalMediaFailure(error, get); }
}

function updateHistory(arr: GenerateItem[], set: StoreSet): void {
  if (!arr.length) return;
  set((state) => {
    const seen = new Set(state.history.map(historyKey));
    const fresh = arr.filter((item) => {
      const key = historyKey(item);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!fresh.length) return {};
    if (!state.currentImage && fresh[0]?.filename) saveSelectedFilename(fresh[0].filename);
    return {
      history: retainHistoryItems([...fresh, ...state.history], Math.max(HISTORY_LIMIT, state.history.length + fresh.length)),
      currentImage: state.currentImage ?? fresh[0],
      loadedHistoryRetainLimit: Math.max(state.loadedHistoryRetainLimit, state.history.length + fresh.length),
    };
  });
}

function pruneAfterHistory(eligibility: HistoryEligibility, set: StoreSet, get: StoreGet): void {
  const fresh = captureInflightSnapshot(get());
  const unchanged = eligibleInflightIds(eligibility.snapshot, fresh);
  const now = Date.now();
  const remaining = [...fresh.local.values()].filter((job) => !eligibility.eligibleIds.has(job.id)
    || !unchanged.has(job.id) || eligibility.serverActiveIds.has(job.id) || now - job.startedAt < INFLIGHT_TTL_MS);
  if (remaining.length === fresh.local.size) return;
  saveInFlight(remaining);
  set({ inFlight: remaining, activeGenerations: remaining.length });
}

async function pollHistory(initial: InflightSnapshot, eligibility: HistoryEligibility | null,
  set: StoreSet, get: StoreGet, isCurrent: () => boolean): Promise<void> {
  try {
    const lastKnown = get().history.reduce((max, item) => Math.max(max, item.createdAt ?? 0), 0);
    const { items } = await getHistory({ limit: HISTORY_LIMIT, since: lastKnown });
    if (!isCurrent() || !isInflightSnapshotCurrent(initial, get())) return;
    updateHistory(items.map(mapHistoryItem), set);
    if (eligibility) pruneAfterHistory(eligibility, set, get);
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[inflight] polling failed (getHistory)", error);
  }
}

function idleTick(state: AppState, w: PollWindow): boolean {
  const idle = state.inFlight.length === 0 && state.activeGenerations === 0;
  w.__ima2StopTicks = idle ? (w.__ima2StopTicks ?? 0) + 1 : 0;
  return idle;
}

async function pollTick(set: StoreSet, get: StoreGet, w: PollWindow): Promise<void> {
  if (isLanSessionLocked()) { stopInFlightPollingImpl(); return; }
  const epoch = getLanAuthEpoch(), revision = pollingRevision;
  const isCurrent = () => !isLanSessionLocked() && epoch === getLanAuthEpoch() && revision === pollingRevision;
  const initial = captureInflightSnapshot(get());
  let eligibility: HistoryEligibility | null = null;
  if (!idleTick(get(), w)) {
    try {
      const response = await fetchInflightScopes(initial.scopes);
      if (!isCurrent()) return;
      const merge = mergeInflightSnapshot(initial, get(), response, { mode: "poll", now: Date.now() });
      if (!merge) return;
      commitMerge(merge, set, get);
      eligibility = { snapshot: captureInflightSnapshot(get()), eligibleIds: merge.eligibleIds,
        serverActiveIds: merge.serverActiveIds };
    } catch (error) {
      if (import.meta.env.DEV) console.warn("[inflight] polling failed (fetchInflightScopes)", error);
    }
  }
  if (isCurrent() && isInflightSnapshotCurrent(initial, get())) await pollHistory(initial, eligibility, set, get, isCurrent);
  // Complete the second idle history observation before invalidating its epoch.
  // Auth loss/unmount still invalidates held reads immediately via stopPolling.
  if (isCurrent() && (w.__ima2StopTicks ?? 0) >= 2
    && get().inFlight.length === 0 && get().activeGenerations === 0) stopInFlightPollingImpl();
}

export function startInFlightPollingImpl(set: StoreSet, get: StoreGet): void {
  if (typeof window === "undefined" || isLanSessionLocked()) return;
  const w = window as unknown as PollWindow;
  if (w.__ima2InflightTimer) return;
  window.addEventListener(LAN_AUTH_REQUIRED_EVENT, stopInFlightPollingImpl);
  w.__ima2InflightTimer = window.setInterval(() => pollTick(set, get, w), 1500);
}

export async function reconcileInflightImpl(set: StoreSet, get: StoreGet): Promise<void> {
  if (isLanSessionLocked()) return;
  const epoch = getLanAuthEpoch(), revision = pollingRevision;
  try {
    const snapshot = captureInflightSnapshot(get());
    const response = await fetchInflightScopes(snapshot.scopes);
    if (isLanSessionLocked() || epoch !== getLanAuthEpoch() || revision !== pollingRevision) return;
    const merge = mergeInflightSnapshot(snapshot, get(), response, { mode: "reconcile", now: Date.now() });
    if (!merge) return;
    saveInFlight(merge.inFlight);
    set({ inFlight: merge.inFlight, activeGenerations: merge.inFlight.length });
    for (const error of merge.terminalErrors) { handleError(error, get()); recordTerminalMediaFailure(error, get); }
    if (merge.inFlight.length) get().startInFlightPolling();
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[inflight] reconcile failed", error);
  }
}
