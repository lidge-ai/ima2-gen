type Fields = { category?: string; status?: number; retryable?: boolean; field?: string; stepId?: string };
export class MediaApiError extends Error {
  code: string;
  category?: string;
  status?: number;
  retryable?: boolean;
  field?: string;
  stepId?: string;
  constructor(code: string, message: string, fields: Fields = {}) {
    super(message); this.name = "MediaApiError"; this.code = code; Object.assign(this, fields);
  }
}
export function scrub(text: string, secrets: readonly string[] = []): string {
  const values = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  let result = text.replace(/\b(sk-[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9]{12,}|AIza[0-9A-Za-z_-]{20,}|r8_[A-Za-z0-9]{20,})\b/g, "[redacted]");
  for (const secret of values) result = result.replaceAll(secret, "[redacted]");
  for (const secret of values) result = result.replaceAll(secret, "[x]");
  return result;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
export function toMediaApiError(error: unknown, secrets: readonly string[] = []): MediaApiError {
  const source = record(error), body = source.body && typeof source.body === "object" ? record(source.body) : source;
  const fields: Fields = {};
  if (typeof body.category === "string") fields.category = body.category;
  if (typeof body.status === "number") fields.status = body.status;
  else if (typeof source.status === "number") fields.status = source.status;
  if (typeof body.retryable === "boolean") fields.retryable = body.retryable;
  if (typeof body.field === "string") fields.field = body.field;
  if (typeof body.stepId === "string") fields.stepId = body.stepId;
  const message = typeof body.error === "string" ? body.error : typeof source.message === "string" ? source.message : String(error);
  return new MediaApiError(String(body.code ?? source.code ?? "MEDIA_CLI_ERROR"), scrub(message, secrets), fields);
}
export function mediaErrorHint(code: string, category?: string): string | null {
  if (code === "MEDIA_KEY_MISSING" || /_(API_KEY|CREDENTIAL)_MISSING$/.test(code) || category === "auth") return "Save a key for this route: ima2 media keys set <vocabulary> --key-stdin (list vocabularies: ima2 media keys).";
  if (category === "quota" || /_INSUFFICIENT_CREDIT$/.test(code)) return "The provider reports insufficient balance or credit on your key. Top up in the provider console, then retry.";
  if (category === "moderation") return "The provider's safety filter refused this request. Change the prompt or inputs; ima2 does not retry blocked requests.";
  if (code === "MEDIA_ROUTE_UNKNOWN") return "This model is not offered through that route. List its routes: ima2 media models --model <id>.";
  if (code === "MEDIA_MODEL_UNKNOWN") return "Unknown model id. Search the catalog: ima2 media models --json.";
  if (code === "MEDIA_TASK_UNSUPPORTED") return "This route does not support that task. Check tasks: ima2 media models --model <id>.";
  if (category === "rate-limit" || code === "TOO_MANY_JOBS") return "Too many jobs at once. Wait a few seconds and retry.";
  if (code === "SERVER_UNREACHABLE") return "Start the server: ima2 serve.";
  return null;
}
export function formatMediaError(e: MediaApiError): string { return `${e.code}: ${e.message}${e.category ? ` (${e.category})` : ""}`; }
export function cliErrorJson(e: MediaApiError) { return { ok: false, code: e.code, error: e.message, ...(e.category ? { category: e.category } : {}) }; }
export function mcpErrorStructured(e: MediaApiError) {
  const hint = mediaErrorHint(e.code, e.category);
  return { ...cliErrorJson(e), ...(e.retryable !== undefined && { retryable: e.retryable }), ...(e.status !== undefined && { status: e.status }), ...(e.field !== undefined && { field: e.field }), ...(e.stepId !== undefined && { stepId: e.stepId }), ...(hint && { hint }) };
}
