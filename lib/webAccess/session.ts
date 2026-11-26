import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Server-signed session cookie for Google sign-in: base64url({e: email, s: id,
 * x: expiry}) + "." + HMAC-SHA256. Logout writes the id to a small revocation
 * file (pruned at expiry) so a copied cookie stops working and the fact
 * survives a restart. Nothing else is stored server-side.
 */
export const SESSION_COOKIE = "__Host-ima2_session";
export const SESSION_TTL_MS = 86_400_000;
const VALUE = /^([A-Za-z0-9_-]{10,600})\.([A-Za-z0-9_-]{43})$/;

export function subKey(secret: string, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("ima2-web"), Buffer.from(label), 32));
}

export interface WebSession { email: string; sid: string; expiresAt: number }

function loadRevoked(file: string): Map<string, number> {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch { return new Map(); }
}

export function createSessionSigner(options: { secret: string; revokedFile: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const key = subKey(options.secret, "session");
  const revoked = loadRevoked(options.revokedFile);
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  function issue(email: string): string {
    const payload = Buffer.from(JSON.stringify({ e: email, s: randomBytes(18).toString("base64url"), x: now() + SESSION_TTL_MS })).toString("base64url");
    return payload + "." + mac(payload);
  }
  function read(value: string | undefined): WebSession | null {
    const match = value ? VALUE.exec(value) : null;
    if (!match) return null;
    const given = Buffer.from(match[2]!), expected = Buffer.from(mac(match[1]!));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let data: { e?: unknown; s?: unknown; x?: unknown };
    try { data = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")); } catch { return null; }
    if (typeof data.e !== "string" || typeof data.s !== "string" || typeof data.x !== "number") return null;
    if (data.x <= now() || revoked.has(data.s)) return null;
    return { email: data.e, sid: data.s, expiresAt: data.x };
  }
  function revoke(session: WebSession): void {
    revoked.set(session.sid, session.expiresAt);
    for (const [sid, expiresAt] of revoked) if (expiresAt <= now()) revoked.delete(sid);
    mkdirSync(dirname(options.revokedFile), { recursive: true });
    const tmp = options.revokedFile + "." + process.pid + ".tmp";
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(revoked)), { mode: 0o600 });
    renameSync(tmp, options.revokedFile);
  }
  return { issue, read, revoke };
}

export type SessionSigner = ReturnType<typeof createSessionSigner>;
