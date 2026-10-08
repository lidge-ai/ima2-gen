import { api88Error } from "./errors.js";

export function api88Origin(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw api88Error("API88_BASE_URL_INVALID", "88API base URL must be an absolute URL", 400); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
    || url.username || url.password || url.search || url.hash) {
    throw api88Error("API88_BASE_URL_INVALID", "Use HTTPS (HTTP loopback is allowed for tests), without credentials, query or fragment", 400);
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function api88ModelSlug(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
