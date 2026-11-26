const REDACTED = "[redacted]";
/** Shorter values would redact ordinary words; real keys are far longer. */
const MIN_SECRET_LENGTH = 6;

function usableSecrets(secrets: readonly (string | undefined)[]): string[] {
  return [...new Set(secrets.filter((s): s is string => typeof s === "string" && s.length >= MIN_SECRET_LENGTH))]
    .sort((a, b) => b.length - a.length);
}

/** Replace every occurrence of a secret value, plus any bearer token, with [redacted]. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of usableSecrets(secrets)) out = out.split(secret).join(REDACTED);
  return out.replace(/(Bearer|Key|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g, `$1 ${REDACTED}`);
}

/** Deep copy of a JSON-like value with secrets removed from every string. */
export function redactDeep<T>(value: T, secrets: readonly (string | undefined)[]): T {
  if (typeof value === "string") return redactSecrets(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as T;
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, secrets);
    return out as T;
  }
  return value;
}
