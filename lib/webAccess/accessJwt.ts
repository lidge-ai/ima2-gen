import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Verifies the Cf-Access-Jwt-Assertion header Cloudflare Access adds to every
 * request it lets through (https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/).
 * Checks RS256 signature against the team's published certs, aud, iss, exp, nbf
 * and the email claim. Fails closed when the certs cannot be read.
 */
export type AccessJwtFailure = "malformed" | "alg" | "aud" | "iss" | "expired" | "not-yet-valid" | "email" | "key" | "signature";
export type AccessJwtResult = { ok: true; email: string } | { ok: false; reason: AccessJwtFailure };

export interface AccessJwtVerifierOptions {
  /** e.g. "lidgeai.cloudflareaccess.com" */
  teamDomain: string;
  aud: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

const REFRESH_MS = 3600_000;
const COOLDOWN_MS = 60_000;
const STALE_LIMIT_MS = 12 * 3600_000;
const PART = /^[A-Za-z0-9_-]+$/;

type Jwk = JsonWebKey & { kid?: string };

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function claimFailure(payload: Record<string, unknown>, aud: string, issuer: string, nowMs: number): AccessJwtFailure | null {
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return "aud";
  if (payload.iss !== issuer) return "iss";
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= nowMs) return "expired";
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf * 1000 > nowMs)) return "not-yet-valid";
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return "email";
  return null;
}

function createCertCache(url: string, get: typeof globalThis.fetch, now: () => number) {
  let keys: Jwk[] | null = null;
  let fetchedAt = 0;
  let lastAttempt: number | null = null;
  let inflight: Promise<boolean> | null = null;
  const imported = new Map<string, KeyObject>();
  const refresh = (): Promise<boolean> => {
    if (inflight) return inflight;
    lastAttempt = now();
    inflight = (async () => {
      const response = await get(url);
      if (!response.ok) return false;
      const body = await response.json() as { keys?: unknown };
      if (!Array.isArray(body.keys)) return false;
      keys = body.keys as Jwk[]; fetchedAt = now(); imported.clear();
      return true;
    })().catch(() => false).finally(() => { inflight = null; });
    return inflight;
  };
  const coolingDown = () => lastAttempt !== null && now() - lastAttempt < COOLDOWN_MS;
  return async function keyFor(kid: string): Promise<KeyObject | null> {
    if (!keys || now() - fetchedAt >= REFRESH_MS) {
      if (!coolingDown()) await refresh();
      if (!keys || now() - fetchedAt >= STALE_LIMIT_MS) return null;
    } else if (!keys.some((k) => k.kid === kid) && !coolingDown()) {
      await refresh();
    }
    const cached = imported.get(kid);
    if (cached) return cached;
    const jwk = keys?.find((k) => k.kid === kid);
    if (!jwk || jwk.kty !== "RSA") return null;
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      imported.set(kid, key);
      return key;
    } catch { return null; }
  };
}

export function createAccessJwtVerifier(options: AccessJwtVerifierOptions) {
  const now = options.now ?? Date.now;
  const issuer = "https://" + options.teamDomain;
  const keyFor = createCertCache(issuer + "/cdn-cgi/access/certs", options.fetch ?? globalThis.fetch, now);
  async function verify(token: string): Promise<AccessJwtResult> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !PART.test(p))) return { ok: false, reason: "malformed" };
    const [head, body, signature] = parts as [string, string, string];
    const header = decodePart(head), payload = decodePart(body);
    if (!header || !payload) return { ok: false, reason: "malformed" };
    if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "alg" };
    const failure = claimFailure(payload, options.aud, issuer, now());
    if (failure) return { ok: false, reason: failure };
    const key = await keyFor(header.kid);
    if (!key) return { ok: false, reason: "key" };
    const valid = verifySignature("RSA-SHA256", Buffer.from(head + "." + body), key, Buffer.from(signature, "base64url"));
    if (!valid) return { ok: false, reason: "signature" };
    return { ok: true, email: String(payload.email).toLowerCase() };
  }
  return { verify };
}
