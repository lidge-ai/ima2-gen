/**
 * Upstream diagnostic label filter, kept free of runtime dependencies so envelope and
 * log helpers can use it without loading the Responses stream parser.
 */
const MAX_DIAGNOSTIC_LABEL_CHARS = 120;
// Providers are untrusted: a "code" field can carry anything. These shapes cover the
// credential formats this app handles (OpenAI, xAI, Google, AWS, GitHub, JWTs, Stripe-like
// sk_live_) plus key=value secrets and long unbroken runs. Legitimate provider codes,
// params and event types use short snake_case words, so matching is case-insensitive on
// purpose; this only widens redaction. A bare word such as "token" stays allowed because
// codes and params like token_expired or max_output_tokens use it.
const UNSAFE_DIAGNOSTIC_LABEL = new RegExp([
  "bearer\\s+",
  "sk-[a-z0-9_-]{4,}",
  "sk_(?:live|test)_[a-z0-9]{8,}",
  "xai[-_][a-z0-9]{8,}",
  "AIza[0-9a-z_-]{10,}",
  "AKIA[0-9a-z]{16}",
  "eyJ[a-z0-9_-]+\\.",
  "gh[pousr]_[a-z0-9]{10,}",
  "(?:password|passwd|secret|token|api[_-]?key)\\s*[:=]",
  "[a-z0-9]{32,}",
  "data:image\\/",
  "https?:\\/\\/",
  "[a-z][a-z0-9+.-]*:\\/\\/",
  "@",
  "[\\r\\n]",
].join("|"), "i");
const SAFE_DIAGNOSTIC_LABEL = /^[A-Za-z0-9_.:[\]-]+$/;

/**
 * Accept only short machine labels from upstream (codes, types, params, event types).
 * The whole value is checked before any length decision: a secret cut at the length
 * limit would otherwise leave a prefix too short for the shape rules. Anything longer
 * than the limit is redacted rather than truncated.
 */
export function safeDiagnosticLabel(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (value.length > MAX_DIAGNOSTIC_LABEL_CHARS) return "_redacted";
  if (UNSAFE_DIAGNOSTIC_LABEL.test(value)) return "_redacted";
  if (!SAFE_DIAGNOSTIC_LABEL.test(value)) return "_redacted";
  return value;
}

/** The three provider label fields every error envelope may expose, each filtered. */
export function upstreamLabelFields(src: { upstreamCode?: unknown; upstreamType?: unknown; upstreamParam?: unknown } | null | undefined) {
  return {
    upstreamCode: safeDiagnosticLabel(src?.upstreamCode),
    upstreamType: safeDiagnosticLabel(src?.upstreamType),
    upstreamParam: safeDiagnosticLabel(src?.upstreamParam),
  };
}
