/**
 * WaveSpeed error shapes (https://wavespeed.ai/docs/error-codes, 2026-11-26):
 * - API envelope: { "code": 4005, "message": "..." } (HTTP 4xx; 4005-4007 are pricing/submission refusals)
 * - failed task: data { status: "failed", code: 1xxx (client/model) | 5xxx (server), error: "..." }
 */
import type { VendorErrorView } from "../shared/http.js";
import { asNumber, asRecord, asString } from "../shared/http.js";

/** INFERRED: WaveSpeed documents no dedicated moderation code, so refusals are recognized by their text. */
const MODERATION_PATTERN = /nsfw|content (?:policy|moderation)|sensitive|safety|flagged/i;

export function readWaveSpeedError(body: unknown, _status: number): VendorErrorView {
  const record = asRecord(body);
  const message = asString(record.message) ?? asString(asRecord(record.data).error);
  const code = asNumber(record.code);
  if (message && MODERATION_PATTERN.test(message)) return { message, category: "moderation", reason: "CONTENT_POLICY", retryable: false };
  return { message, ...(code !== undefined && code >= 1000 ? { reason: `APP_${code}` } : {}) };
}

export function readTaskFailure(data: Record<string, unknown>): VendorErrorView {
  const message = asString(data.error) ?? asString(data.message) ?? "WaveSpeed prediction failed";
  const code = asNumber(data.code);
  if (MODERATION_PATTERN.test(message)) return { message, category: "moderation", reason: "CONTENT_POLICY", retryable: false };
  if (code !== undefined && code >= 5000) return { message, category: "upstream", reason: `TASK_${code}`, retryable: true };
  if (code !== undefined && code >= 1000) return { message, category: "invalid-request", reason: `TASK_${code}`, retryable: false };
  return { message };
}
