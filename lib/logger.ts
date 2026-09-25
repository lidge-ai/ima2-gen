const REDACTED = "[redacted]";
const MAX_VALUE_LEN = 240;
const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "headers",
  "apiKey",
  "token",
  "password",
  "secret",
  "body",
  "prompt",
  "effectivePrompt",
  "userPrompt",
  "revisedPrompt",
  "textPrompt",
  "styleSheet",
  "style_sheet",
  "image",
  "imageB64",
  "image_url",
  "references",
  "rawResponse",
]);

const ALLOWED_PROMPT_METRICS = new Set(["promptChars", "promptMode"]);

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
type LogSink = {
  log?: (line: string) => void;
  debug?: (line: string) => void;
  info?: (line: string) => void;
  warn?: (line: string) => void;
  error?: (line: string) => void;
};

let activeLevel: LogLevel = "info";
let activeSink: LogSink = console;

function shouldRedactKey(key: string) {
  if (ALLOWED_PROMPT_METRICS.has(key)) return false;
  if (SECRET_KEYS.has(key)) return true;
  const lower = key.toLowerCase();
  return (
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("cookie") ||
    lower.includes("apikey") ||
    lower.includes("api_key") ||
    lower.includes("secret") ||
    lower.includes("b64") ||
    lower.includes("base64") ||
    lower.includes("dataurl")
  );
}

function sanitizeLogString(value: string): string {
  const oneLine = value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "data:image/[redacted]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/(^|[\s("'<>=,[{])\/\/[^\s"'<>]+/g, "$1[redacted-url]")
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/([?&][^=\s?&#"'<>]+)=([^&\s"'<>]*)/g, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > MAX_VALUE_LEN ? `${oneLine.slice(0, MAX_VALUE_LEN)}...` : oneLine;
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Error) return sanitizeError(value);
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
  if (typeof value === "object") return "[object]";
  if (typeof value === "string") return sanitizeLogString(value);
  return value;
}

export function sanitizeError(err: unknown) {
  if (!err) return { message: "Unknown error" };
  const e = typeof err === "object"
    ? err as { name?: unknown; code?: unknown; status?: unknown; message?: unknown }
    : {};
  const message = typeof err === "string" ? err
    : typeof e.message === "string" ? e.message : "Unknown error";
  return {
    name: typeof e.name === "string" && e.name ? sanitizeLogString(e.name) : "Error",
    code: typeof e.code === "string" ? sanitizeLogString(e.code) : undefined,
    status: typeof e.status === "number" && Number.isFinite(e.status) ? e.status : undefined,
    message: sanitizeLogString(message),
  };
}

export function sanitizeFields(fields: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = shouldRedactKey(key) ? REDACTED : sanitizeValue(value);
  }
  return out;
}

function formatValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

export function formatLog(scope: string, event: string, fields: Record<string, unknown> = {}) {
  const safeFields = sanitizeFields(fields);
  const parts = Object.entries(safeFields)
    .map(([key, value]) => {
      const formatted = formatValue(value);
      return formatted === undefined ? null : `${key}=${formatted}`;
    })
    .filter(Boolean);
  return `[${scope}.${event}]${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

export function normalizeLogLevel(level: unknown): LogLevel {
  return typeof level === "string" && Object.hasOwn(LOG_LEVELS, level) ? (level as LogLevel) : "info";
}

export function configureLogger(options: { level?: unknown; sink?: LogSink } = {}) {
  activeLevel = normalizeLogLevel(options.level);
  activeSink = options.sink || console;
}

export function shouldLog(level: unknown) {
  const normalized = normalizeLogLevel(level);
  return LOG_LEVELS[normalized] >= LOG_LEVELS[activeLevel] && activeLevel !== "silent";
}

function writeLog(level: LogLevel, line: string) {
  if (!shouldLog(level)) return;
  const sink = activeSink as Record<string, ((line: string) => void) | undefined>;
  const writer = sink[level] || sink.log || console.log;
  writer.call(activeSink, line);
}

export function logDebug(scope: string, event: string, fields: Record<string, unknown> = {}) {
  writeLog("debug", formatLog(scope, event, fields));
}

export function logEvent(scope: string, event: string, fields: Record<string, unknown> = {}) {
  writeLog("info", formatLog(scope, event, fields));
}

export function logWarn(scope: string, event: string, fields: Record<string, unknown> = {}) {
  writeLog("warn", formatLog(scope, event, fields));
}

export function logError(scope: string, event: string, err: unknown, fields: Record<string, unknown> = {}) {
  const safe = sanitizeError(err);
  writeLog("error", formatLog(scope, event, {
    ...fields,
    errorName: safe.name,
    errorCode: safe.code,
    errorStatus: safe.status,
    errorMessage: safe.message,
  }));
}
