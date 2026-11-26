/**
 * JSON transport for aggregator adapters. Every call goes through ctx.fetch and
 * ctx.signal; failures become MediaAdapterError with the API key scrubbed from
 * any vendor text that is carried into the message.
 */
import type { MediaAdapterContext } from "../../contract.js";
import { adapterError, categoryForStatus, type ErrorCategory } from "./errors.js";

const MAX_MESSAGE = 500;

/** Removes secrets from text that may reach logs, events or the UI. */
export function redactSecret(text: string, ...secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export interface VendorErrorView {
  message?: string | undefined;
  /** Vendor's own reason, used to refine the code. */
  reason?: string | undefined;
  category?: ErrorCategory | undefined;
  retryable?: boolean | undefined;
}

export type ReadVendorError = (body: unknown, status: number) => VendorErrorView;

export interface JsonRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  prefix: string;
  /** Reads vendor error bodies; return {} to fall back to status mapping. */
  readError?: ReadVendorError | undefined;
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || body === undefined) return "";
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

export interface HttpErrorSource {
  prefix: string;
  readError?: ReadVendorError | undefined;
}

export function httpError(ctx: MediaAdapterContext, source: HttpErrorSource, status: number, body: unknown) {
  const view = source.readError?.(body, status) ?? {};
  const raw = view.message ?? (bodyText(body) || `HTTP ${status}`);
  const message = redactSecret(raw, ctx.apiKey).slice(0, MAX_MESSAGE);
  return adapterError({
    prefix: source.prefix,
    category: view.category ?? categoryForStatus(status),
    message,
    status,
    reason: view.reason,
    retryable: view.retryable,
  });
}

/** Sends one JSON request and returns the parsed body, or throws MediaAdapterError. */
export async function requestJson(ctx: MediaAdapterContext, req: JsonRequest): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json", ...req.headers };
  const init: RequestInit = { method: req.method ?? (req.body === undefined ? "GET" : "POST"), headers };
  if (req.body !== undefined) {
    init.body = JSON.stringify(req.body);
    headers["content-type"] = "application/json";
  }
  if (ctx.signal) init.signal = ctx.signal;
  const res = await ctx.fetch(req.url, init);
  const body = await readBody(res);
  if (!res.ok) throw httpError(ctx, req, res.status, body);
  return body;
}

/** Narrowing helpers for untyped vendor JSON. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
