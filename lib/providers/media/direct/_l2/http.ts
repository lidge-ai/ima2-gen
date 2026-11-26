// JSON transport for the L2 direct adapters. Every call goes through ctx.fetch.
import type { MediaAdapterContext } from "../../contract.js";
import { fail, redactSecrets } from "./errors.js";

export interface JsonRequest {
  method?: "GET" | "POST" | "DELETE";
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
}

export interface JsonResponse {
  status: number;
  ok: boolean;
  body: unknown;
  headers: Headers;
}

/** Sends a JSON request. HTTP error statuses are returned, not thrown; the adapter reads its own envelope. */
export async function sendJson(ctx: MediaAdapterContext, prefix: string, req: JsonRequest): Promise<JsonResponse> {
  const headers: Record<string, string> = { accept: "application/json", ...req.headers };
  const init: RequestInit = { method: req.method ?? (req.body === undefined ? "GET" : "POST"), headers };
  if (req.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body);
  }
  if (ctx.signal) init.signal = ctx.signal;
  const res = await ctx.fetch(req.url, init);
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      if (res.ok)
        fail(prefix, "BAD_RESPONSE", "upstream", `Provider returned non-JSON (HTTP ${res.status})`, {
          status: res.status,
        });
      body = { message: redactSecrets(text.slice(0, 300), [ctx.apiKey]) };
    }
  }
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
