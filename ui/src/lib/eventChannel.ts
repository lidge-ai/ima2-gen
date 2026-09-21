import { createLanAuthError, getLanAuthEpoch, getLanSessionState,
  isLanSessionLocked, LAN_AUTH_REQUIRED_EVENT, refreshLanSession } from "./lanSession";
import { WF_SU_KIEN } from "../../../lib/wfEvents.js";

type EventHandler = (event: string, data: Record<string, unknown>) => void;

interface Subscription {
  jobId: string;
  event: string | null;
  handler: EventHandler;
}

/**
 * Max wait for done/error after async POST accepts the job (90 min).
 *
 * Must stay ABOVE the server's worst case for one request — Grok video is
 * 1500 s planning + 300 s start + 1800 s poll + 300 s poll overshoot + 300 s download
 * = 4200 s — or the UI cancels generations the server would have finished and reports
 * them as stream timeouts.
 * devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
 */
export const JOB_STREAM_TIMEOUT_MS = 90 * 60 * 1000;

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

let source: EventSource | null = null;
let lastEventId = "";
const subs: Set<Subscription> = new Set();
let resyncCallback: (() => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wasEverConnected = false;
let reconnectAttempt = 0;
let connectionRevision = 0;
let authListenerAttached = false;

export type ConnectionState = "connected" | "reconnecting" | "failed";
const FAILED_THRESHOLD = 3;
let connectionStateCallback: ((state: ConnectionState) => void) | null = null;

// EventSource chi nhan nhung ten su kien duoc dang ky truoc, nen mot ten thieu
// o day la mat tin trong im lang - khong loi, khong canh bao, chi la khong bao
// gio toi noi. Ten su kien khuon lay thang tu module hop dong dung chung voi may
// chu, de them mot su kien moi khong the quen cho nay.
const EVENT_TYPES = [
  "phase", "partial", "image", "done", "error", "submitted", "progress", "planning",
  "keying-start", "keying-progress", "keying-done", "keying-error",
  ...Object.values(WF_SU_KIEN),
];

function buildEventsUrl(): string {
  if (!lastEventId) return "/api/events";
  return `/api/events?lastEventId=${encodeURIComponent(lastEventId)}`;
}

function pauseForAuthentication() {
  connectionRevision += 1;
  const ownedSource = source;
  source = null;
  ownedSource?.close();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  // Accepted jobs keep their subscriptions, cursor and original deadlines.
}

function attachAuthListener() {
  if (authListenerAttached || typeof window === "undefined") return;
  window.addEventListener(LAN_AUTH_REQUIRED_EVENT, pauseForAuthentication);
  authListenerAttached = true;
}

function scheduleReconnect(revision: number, epoch: number) {
  if (revision !== connectionRevision || epoch !== getLanAuthEpoch() || isLanSessionLocked() || source) return;
  const baseDelay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempt), RECONNECT_MAX_MS);
  const delay = Math.min(baseDelay * (0.8 + Math.random() * 0.4), RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(connect, delay);
  connectionStateCallback?.(reconnectAttempt >= FAILED_THRESHOLD ? "failed" : "reconnecting");
}

function connect() {
  attachAuthListener();
  if (isLanSessionLocked()) return;
  if (source && source.readyState !== EventSource.CLOSED) return;
  connectionRevision += 1;
  const ownedSource = new EventSource(buildEventsUrl());
  source = ownedSource;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  ownedSource.onopen = () => {
    if (source !== ownedSource) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempt = 0;
    const reconnecting = wasEverConnected;
    wasEverConnected = true;
    if (reconnecting) resyncCallback?.();
    if (source === ownedSource) connectionStateCallback?.("connected");
  };

  for (const type of EVENT_TYPES) {
    ownedSource.addEventListener(type, (ev: Event) => {
      if (source !== ownedSource || typeof (ev as MessageEvent).data !== "string") return;
      dispatch(type, ev as MessageEvent);
    });
  }

  ownedSource.addEventListener("replay-gap", () => {
    if (source !== ownedSource) return;
    lastEventId = "";
    resyncCallback?.();
  });

  ownedSource.onerror = (ev: Event) => {
    if (source !== ownedSource || typeof (ev as MessageEvent).data === "string") return;
    source = null;
    ownedSource.close();
    const revision = ++connectionRevision;
    const epoch = getLanAuthEpoch();
    if (getLanSessionState()?.mode === "lan") {
      // EventSource hides HTTP status. A failed observation is connectivity loss,
      // not proof of expired auth; keep the existing bounded backoff in that case.
      const resume = () => scheduleReconnect(revision, epoch);
      void refreshLanSession().then(resume, resume);
    } else scheduleReconnect(revision, epoch);
  };
}

function dispatch(eventType: string, ev: MessageEvent) {
  if (ev.lastEventId) lastEventId = ev.lastEventId;
  let parsed: unknown;
  try {
    parsed = JSON.parse(ev.data);
  } catch {
    if (import.meta.env.DEV) {
      console.warn(`[eventChannel] invalid JSON for "${eventType}"`, ev.data);
    }
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const data = parsed as Record<string, unknown>;
  const jobId = data.jobId ?? data.requestId;
  if (typeof jobId !== "string" || !jobId) {
    if (import.meta.env.DEV) {
      console.warn(`[eventChannel] missing jobId on "${eventType}"`, data);
    }
    return;
  }
  for (const sub of subs) {
    if (sub.jobId !== jobId) continue;
    if (sub.event !== null && sub.event !== eventType) continue;
    sub.handler(eventType, data);
  }
}

export function subscribe(
  jobId: string,
  event: string | null,
  handler: EventHandler,
): () => void {
  const sub: Subscription = { jobId, event, handler };
  subs.add(sub);
  if (!source || source.readyState === EventSource.CLOSED) connect();
  return () => { subs.delete(sub); };
}

export function armStreamTimeout(onTimeout: () => void, ms = JOB_STREAM_TIMEOUT_MS): () => void {
  const timer = setTimeout(onTimeout, ms);
  return () => clearTimeout(timer);
}

export function onResync(cb: () => void) {
  resyncCallback = cb;
}

export function onConnectionStateChange(cb: (state: ConnectionState) => void) {
  connectionStateCallback = cb;
}

export function disconnect() {
  connectionRevision += 1;
  const ownedSource = source;
  source = null;
  ownedSource?.close();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  subs.clear();
  lastEventId = "";
  wasEverConnected = false;
  reconnectAttempt = 0;
  resyncCallback = null;
  connectionStateCallback = null;
  if (authListenerAttached && typeof window !== "undefined") {
    window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, pauseForAuthentication);
    authListenerAttached = false;
  }
}

export function ensureConnected() {
  if (!source || source.readyState === EventSource.CLOSED) connect();
}

/**
 * Resolve once the SSE transport is OPEN (immediately if already open).
 * Subscribers that submit a job right after subscribing must await this —
 * otherwise a terminal event emitted before the server-side subscription is
 * installed is lost on a fresh connection (no Last-Event-ID replay exists).
 */
export function whenConnected(timeoutMs = 10_000): Promise<void> {
  const epoch = getLanAuthEpoch();
  if (isLanSessionLocked()) return Promise.reject(createLanAuthError(epoch - 1));
  ensureConnected();
  if (source && source.readyState === EventSource.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    // Poll readyState instead of onConnectionStateChange — that callback is a
    // singleton owned by the store and must not be clobbered.
    const tick = () => {
      if (epoch !== getLanAuthEpoch() || isLanSessionLocked()) {
        reject(createLanAuthError(epoch));
        return;
      }
      if (source && source.readyState === EventSource.OPEN) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("SSE channel open timed out"));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
