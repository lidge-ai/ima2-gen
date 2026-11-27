// lib/comfy/client.ts — the HTTP calls ima2 makes to a ComfyUI server.
//
// Every request goes through comfyFetch so the allow-listed target's token is
// attached in one place and a redirect is never followed: a 3xx from a server
// holding a bearer token must not carry that token to another host.
import { redactSecrets } from "../providers/media/redact.js";
import type { ComfyTarget } from "./access.js";

/** ComfyUI accepts and issues canonical UUIDs as prompt ids (required since 0.25.0). */
export const COMFY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function localTarget(origin: string): ComfyTarget {
  return { origin, headers: {}, secrets: [] };
}

export function asTarget(target: ComfyTarget | string): ComfyTarget {
  return typeof target === "string" ? localTarget(target) : target;
}

export function comfyFetch(
  target: ComfyTarget,
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = { ...(init.headers as Record<string, string> | undefined), ...target.headers };
  return fetchImpl(target.origin + path, {
    ...init,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    redirect: "manual",
  });
}

async function post(target: ComfyTarget, fetchImpl: typeof fetch, path: string, body?: unknown): Promise<Response | null> {
  try {
    return await comfyFetch(target, fetchImpl, path, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    // A cancel that cannot reach the instance is not worth surfacing: the
    // caller is already tearing the job down.
    return null;
  }
}

/**
 * Cancels one job, wherever it is.
 *
 * POST /api/jobs/{id}/cancel (ComfyUI 0.26.0, 2026-06) handles a pending and a
 * running job atomically. Older servers answer 404/405, and then both legacy
 * calls fire: /queue delete only touches the pending heap (verified live: it
 * returns 200 for a RUNNING job and does nothing) while /interrupt with a
 * prompt_id stops only that job when it is the one running. Firing both rather
 * than reading /queue first avoids racing the job into running between a read
 * and an act. A bare /interrupt is never sent: it would stop someone else's job.
 */
export async function cancelComfyJob(
  target: ComfyTarget | string,
  promptId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const server = asTarget(target);
  if (COMFY_UUID_RE.test(promptId)) {
    const res = await post(server, fetchImpl, "/api/jobs/" + encodeURIComponent(promptId) + "/cancel");
    if (res?.ok) {
      const body = await res.json().catch(() => null) as { cancelled?: unknown } | null;
      if (body && typeof body.cancelled === "boolean") return;
    }
  }
  await post(server, fetchImpl, "/queue", { delete: [promptId] });
  await post(server, fetchImpl, "/interrupt", { prompt_id: promptId });
}

export interface ComfyQueuePosition {
  running: boolean;
  /** 0 when running or first in line; otherwise how many jobs are ahead. */
  position: number;
}

/** Locates a prompt in the queue so a caller can report real waiting. */
export async function comfyQueuePosition(
  target: ComfyTarget,
  promptId: string,
  fetchImpl: typeof fetch,
): Promise<ComfyQueuePosition | null> {
  let json: { queue_running?: unknown; queue_pending?: unknown } | null;
  try {
    const res = await comfyFetch(target, fetchImpl, "/queue");
    json = await res.json().catch(() => null) as typeof json;
  } catch {
    return null;
  }
  const idOf = (entry: unknown): string | null => Array.isArray(entry) && typeof entry[1] === "string" ? entry[1] : null;
  const running: unknown[] = Array.isArray(json?.queue_running) ? json.queue_running : [];
  if (running.some((entry) => idOf(entry) === promptId)) return { running: true, position: 0 };
  const pending: unknown[] = Array.isArray(json?.queue_pending) ? json.queue_pending : [];
  const index = pending.findIndex((entry) => idOf(entry) === promptId);
  if (index >= 0) return { running: false, position: index + 1 };
  return null;
}

/* ---------- Turning ComfyUI's validation and execution errors into sentences ---------- */

interface ComfyErrorEntry {
  type?: unknown;
  message?: unknown;
  details?: unknown;
  extra_info?: Record<string, unknown>;
}

interface ComfyNodeError {
  errors?: Array<ComfyErrorEntry | string>;
  class_type?: unknown;
}

export interface ComfyRejection {
  error?: ComfyErrorEntry | string;
  node_errors?: Record<string, ComfyNodeError>;
}

const MAX_REASONS = 5;
const MODEL_FILE_RE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i;

function text(value: unknown, max = 160): string {
  const raw = typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value);
  return raw.length > max ? raw.slice(0, max) + "…" : raw;
}

function nodeLabel(id: string, classType: unknown): string {
  return typeof classType === "string" && classType ? "node " + id + " (" + classType + ")" : "node " + id;
}

function explainNodeError(id: string, classType: unknown, entry: ComfyErrorEntry | string): string {
  const where = nodeLabel(id, classType);
  if (typeof entry === "string") return where + ": " + text(entry);
  const input = text(entry.extra_info?.input_name, 80);
  if (entry.type === "value_not_in_list" && input) {
    const received = text(entry.extra_info?.received_value, 120);
    const missing = MODEL_FILE_RE.test(received)
      ? "model file '" + received + "' is not on this ComfyUI server"
      : "'" + received + "' is not a choice this ComfyUI server offers";
    return where + " " + input + ": " + missing;
  }
  if (entry.type === "required_input_missing" && input) return where + " is missing its required input '" + input + "'";
  const detail = text(entry.details);
  return where + ": " + (text(entry.message) || "invalid") + (detail ? " (" + detail + ")" : "");
}

/**
 * Reasons a /prompt submission was refused, one per line, most useful first.
 *
 * A missing custom node and a missing model file are the two failures a person
 * can act on, so they are named outright instead of being left as node ids.
 */
export function explainComfyRejection(body: ComfyRejection | null | undefined): string[] {
  const reasons: string[] = [];
  const top = body?.error;
  if (top && typeof top === "object" && top.type === "missing_node_type") {
    const info = top.extra_info ?? {};
    const classType = text(info.class_type, 120) || "unknown";
    const at = typeof info.node_id === "string" || typeof info.node_id === "number" ? " (node " + String(info.node_id) + ")" : "";
    reasons.push("this ComfyUI server has no node type '" + classType + "'" + at + ". Install the custom node pack that provides it, then restart ComfyUI");
  }
  for (const [id, node] of Object.entries(body?.node_errors ?? {})) {
    for (const entry of Array.isArray(node?.errors) ? node.errors : []) {
      reasons.push(explainNodeError(id, node.class_type, entry));
    }
    if (!Array.isArray(node?.errors) || node.errors.length === 0) reasons.push(nodeLabel(id, node?.class_type) + " was rejected");
  }
  if (reasons.length === 0 && top) {
    reasons.push(typeof top === "string" ? text(top) : text(top.message) || text(top.type) || "invalid workflow");
  }
  if (reasons.length <= MAX_REASONS) return reasons;
  return [...reasons.slice(0, MAX_REASONS), "and " + String(reasons.length - MAX_REASONS) + " more"];
}

/** What a failed run left in history: which node raised, and what it said. Empty when it left nothing. */
export function explainComfyExecution(messages: readonly unknown[]): string {
  for (const message of [...messages].reverse()) {
    if (!Array.isArray(message)) continue;
    const [kind, data] = message as [unknown, Record<string, unknown> | undefined];
    if (kind === "execution_interrupted") return "the run was interrupted on the ComfyUI server";
    if (kind !== "execution_error" || !data) continue;
    const where = nodeLabel(String(data.node_id ?? "?"), data.node_type);
    return where + " failed: " + (text(data.exception_message, 300).trim() || text(data.exception_type) || "unknown error");
  }
  return "";
}

/** Removes a target's token from text that came back from, or describes, its server. */
export function redactForTarget(target: ComfyTarget, message: string): string {
  return target.secrets.length > 0 ? redactSecrets(message, target.secrets) : message;
}
