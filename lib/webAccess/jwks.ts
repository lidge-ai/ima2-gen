import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Cached RSA signing keys from a JWKS endpoint (Cloudflare Access certs, Google
 * certs). Refreshes hourly and on an unknown key id (at most once a minute),
 * keeps serving the last good list while refreshes fail, and stops trusting it
 * after 12 hours so a withdrawn key is not believed forever.
 */
const REFRESH_MS = 3600_000;
const COOLDOWN_MS = 60_000;
const STALE_LIMIT_MS = 12 * 3600_000;
export const JWT_PART = /^[A-Za-z0-9_-]+$/;

type Jwk = JsonWebKey & { kid?: string };

export function decodeJwtPart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function createCertCache(url: string, get: typeof globalThis.fetch, now: () => number) {
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
