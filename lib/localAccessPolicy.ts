import { isIP } from "node:net";
import { posix } from "node:path";
import type { Request } from "express";
import type { AppConfig } from "./runtimeContext.js";

const MAX_PUBLIC_ORIGINS = 16;
const MESSAGES = {
  INVALID_PUBLIC_ORIGINS: "Invalid public origins configuration",
  LOCAL_HOST_REJECTED: "Request host is not allowed",
  LOCAL_ORIGIN_REJECTED: "Request origin is not allowed",
  LOCAL_PATH_REJECTED: "Request path is not allowed",
  LAN_TOKEN_REQUIRED: "A valid IMA2 LAN token is required",
  INVALID_LAN_TOKEN: "Invalid LAN token configuration",
  LAN_SESSION_CAPACITY: "LAN session capacity reached",
  LAN_SESSION_UNAVAILABLE: "LAN sessions are unavailable",
  LAN_AUTH_RATE_LIMITED: "Too many LAN authentication attempts",
  LAN_SESSION_BODY_INVALID: "Expected an empty JSON object",
  LAN_SESSION_CONTENT_TYPE: "Content type must be application/json",
} as const;

export function localAccessError(code: keyof typeof MESSAGES, status = 403) {
  return Object.assign(new Error(MESSAGES[code]), { code, status });
}

function parseOrigin(value: unknown): string {
  if (typeof value !== "string" || /[\s\\*@?#]/u.test(value) || !/^https?:\/\/[^/]+\/?$/i.test(value)) throw new Error();
  const url = new URL(value);
  if (!/^https?:\/\//i.test(value) || !["http:", "https:"].includes(url.protocol)
    || url.username || url.password || !url.hostname || url.pathname !== "/") throw new Error();
  return url.origin;
}

export function parsePublicOrigins(value: unknown): readonly string[] {
  try {
    if (!Array.isArray(value) || value.length > MAX_PUBLIC_ORIGINS) throw new Error();
    const origins = [...new Set(value.map(parseOrigin))];
    if (origins.some((origin, index) => origins.slice(index + 1).some(other =>
      hostMatches(new URL(origin).host, other) || hostMatches(new URL(other).host, origin)))) throw new Error();
    return Object.freeze(origins);
  } catch {
    throw localAccessError("INVALID_PUBLIC_ORIGINS", 500);
  }
}

export function isLocalBind(host: string | undefined): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(String(host || "").trim().toLowerCase());
}

/** rawHeaders is authoritative for duplicates Node may otherwise discard/join. */
export function singleHeader(req: Request, name: string, code: keyof typeof MESSAGES): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  }
  const value = req.headers[name];
  if (values.length > 1 || Array.isArray(value)) throw localAccessError(code, code === "LAN_TOKEN_REQUIRED" ? 401 : 403);
  return values[0] ?? value;
}

function literalHost(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1]!;
  const hex = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(address);
  if (hex) {
    const high = parseInt(hex[1]!, 16), low = parseInt(hex[2]!, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return isIP(address) === 6 ? `[${address}]` : address;
}

/**
 * Ket noi den tu chinh may nay.
 *
 * Dia chi nguon cua mot ket noi TCP da bat tay xong thi khong the gia mao tu
 * mang ngoai, nen loopback la bang chung du manh de mien token: may khac trong
 * tailnet den qua giao dien Tailscale voi dia chi 100.x, khong bao gio 127.x.
 *
 * Phan chong CSRF tu mot trang web khac van do `checkBrowserRequest` lo
 * (sec-fetch-site phai la same-origin, va Origin phai khop) - mien token o day
 * chi tra lai dung trang thai truoc khi bind ra 0.0.0.0, khong noi long them.
 *
 * Doc thang tu socket, khong qua `X-Forwarded-For`: mot proxy dat truoc server
 * se lam moi ket noi trong nhu loopback, va header thi ai cung dat duoc.
 */
export function laKetNoiLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress;
  if (!address) return false;
  const literal = literalHost(address.trim().toLowerCase());
  return literal === "[::1]" || /^127\./.test(literal);
}

function servingOrigins(req: Request, host: string, publicOrigins: readonly string[]): string[] {
  const origins = new Map<string, string>();
  const port = req.socket.localPort;
  const scheme = (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted ? "https" : "http";
  const add = (hostname: string) => {
    if (!port || !hostname) return;
    const url = new URL(`${scheme}://${hostname}:${port}`);
    origins.set(url.host, url.origin);
  };
  const address = req.socket.localAddress;
  if (address && isIP(address)) add(literalHost(address));
  if (isLocalBind(host) || ["0.0.0.0", "::"].includes(host)) {
    for (const alias of ["localhost", "127.0.0.1", "[::1]"]) add(alias);
  }
  if (host && !["0.0.0.0", "::"].includes(host)) add(literalHost(host));
  for (const origin of publicOrigins) {
    for (const [authority, inferred] of origins) {
      if (hostMatches(authority, origin) || hostMatches(new URL(origin).host, inferred)) origins.delete(authority);
    }
    origins.set(new URL(origin).host, origin);
  }
  return [...origins.values()];
}

function hostMatches(host: string, origin: string): boolean {
  const url = new URL(origin);
  return new URL(`${url.protocol}//${host}`).host === url.host;
}

export function createLocalAccessPolicy(config: AppConfig) {
  const publicOrigins = parsePublicOrigins(config.server.publicOrigins);
  const host = config.server.host.trim().toLowerCase();
  return {
    resolveHost(req: Request): string {
      const hostOnly = Object.create(req) as Request;
      hostOnly.headers = { ...req.headers };
      delete hostOnly.headers.origin;
      hostOnly.rawHeaders = req.rawHeaders.flatMap((value, i, all) =>
        i % 2 === 0 && value.toLowerCase() !== "origin" ? [value, all[i + 1]!] : []);
      return this.resolveOrigin(hostOnly);
    },
    resolveOrigin(req: Request): string {
      const authority = singleHeader(req, "host", "LOCAL_HOST_REJECTED");
      if (!authority || !/^(?:\[[\da-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::\d+)?$/.test(authority)) {
        throw localAccessError("LOCAL_HOST_REJECTED");
      }
      let candidates: string[];
      try { candidates = servingOrigins(req, host, publicOrigins).filter(origin => hostMatches(authority, origin)); }
      catch { throw localAccessError("LOCAL_HOST_REJECTED"); }
      if (!candidates.length) throw localAccessError("LOCAL_HOST_REJECTED");
      const supplied = singleHeader(req, "origin", "LOCAL_ORIGIN_REJECTED");
      if (supplied === undefined) return candidates[0]!;
      let origin: string;
      try { origin = parseOrigin(supplied); } catch { throw localAccessError("LOCAL_ORIGIN_REJECTED"); }
      if (!candidates.includes(origin)) throw localAccessError("LOCAL_ORIGIN_REJECTED");
      return origin;
    },
    checkBrowserRequest(req: Request, origin: string, viaCookie: boolean): void {
      const site = singleHeader(req, "sec-fetch-site", "LOCAL_ORIGIN_REJECTED");
      if (site && site !== "same-origin" && site !== "none") throw localAccessError("LOCAL_ORIGIN_REJECTED");
      const supplied = singleHeader(req, "origin", "LOCAL_ORIGIN_REJECTED");
      if (supplied !== undefined) {
        try { if (parseOrigin(supplied) !== origin) throw new Error(); }
        catch { throw localAccessError("LOCAL_ORIGIN_REJECTED"); }
      } else if (viaCookie && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        throw localAccessError("LOCAL_ORIGIN_REJECTED");
      }
    },
  };
}

/** Inspect the original full path even when called under an Express mount. */
export function protectedRequestPath(req: Request): { api: boolean; media: boolean; alias: boolean; path: string } {
  const raw = (req.originalUrl || req.url).split("?")[0] || "/";
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { throw localAccessError("LOCAL_PATH_REJECTED", 400); }
  const path = posix.normalize(decoded.replace(/\\/g, "/")).toLowerCase();
  // Keep every protected interpretation, including a raw protected path whose
  // dot segments escape the mount after normalization.
  const candidates = [raw, decoded, path];
  const api = candidates.some(candidate => /^\/api(?:\/|$)/i.test(candidate));
  const media = candidates.some(candidate => /^\/generated(?:\/|$)/i.test(candidate));
  const canonical = /^\/(api|generated)(?:\/|$)/i.exec(raw);
  const prefix = canonical?.[0];
  const alias = (api || media) && (!prefix || path !== decoded.toLowerCase()
    || /[%\\\0]/.test(raw.slice(0, prefix.length)));
  return { api, media, alias, path };
}
