/**
 * Response reading and HTTP error mapping for the L4 adapters. Vendor error
 * bodies are summarized (detail / message / error fields), trimmed and redacted.
 */
import { MediaAdapterError, makeError, reasonForStatus, type MakeErrorOptions } from "./errors.js";
import { redactSecrets } from "./redact.js";

const MAX_VENDOR_MESSAGE = 300;

export interface ResponseBody {
  text: string;
  json: unknown;
}

export async function readBody(res: Response): Promise<ResponseBody> {
  const text = await res.text();
  if (!text) return { text, json: undefined };
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: undefined };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Pull a human message out of the common vendor error shapes. */
export function vendorMessage(body: ResponseBody): string {
  const record = asRecord(body.json);
  const candidates: unknown[] = [record?.["detail"], record?.["message"], record?.["error"], record?.["errors"], record?.["name"]];
  for (const candidate of candidates) {
    const text = flattenMessage(candidate);
    if (text) return text.slice(0, MAX_VENDOR_MESSAGE);
  }
  return body.text.trim().slice(0, MAX_VENDOR_MESSAGE);
}

function flattenMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenMessage).filter(Boolean).join("; ");
  const record = asRecord(value);
  if (!record) return "";
  const parts = [record["msg"], record["message"], record["detail"]].map(flattenMessage).filter(Boolean);
  const loc = Array.isArray(record["loc"]) ? `${record["loc"].join(".")}: ` : "";
  return parts.length ? loc + parts.join("; ") : "";
}

export interface HttpErrorInput {
  prefix: string;
  label: string;
  status: number;
  body: ResponseBody;
  secrets: readonly (string | undefined)[];
  /** Vendor-specific reason/category override, e.g. a 400 that means moderation. */
  override?: { reason: string } & MakeErrorOptions;
}

export function httpError(input: HttpErrorInput): MediaAdapterError {
  const vendor = vendorMessage(input.body);
  const message = redactSecrets(`${input.label} HTTP ${input.status}${vendor ? `: ${vendor}` : ""}`, input.secrets);
  const reason = input.override?.reason ?? reasonForStatus(input.status);
  const { reason: _reason, ...options } = input.override ?? { reason };
  return new MediaAdapterError(makeError(input.prefix, reason, message, { status: input.status, ...options }));
}
