import { verify as verifySignature } from "node:crypto";
import { createCertCache, decodeJwtPart, JWT_PART } from "./jwks.js";

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

function claimFailure(payload: Record<string, unknown>, aud: string, issuer: string, nowMs: number): AccessJwtFailure | null {
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return "aud";
  if (payload.iss !== issuer) return "iss";
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= nowMs) return "expired";
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf * 1000 > nowMs)) return "not-yet-valid";
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return "email";
  return null;
}

export function createAccessJwtVerifier(options: AccessJwtVerifierOptions) {
  const now = options.now ?? Date.now;
  const issuer = "https://" + options.teamDomain;
  const keyFor = createCertCache(issuer + "/cdn-cgi/access/certs", options.fetch ?? globalThis.fetch, now);
  async function verify(token: string): Promise<AccessJwtResult> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !JWT_PART.test(p))) return { ok: false, reason: "malformed" };
    const [head, body, signature] = parts as [string, string, string];
    const header = decodeJwtPart(head), payload = decodeJwtPart(body);
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
