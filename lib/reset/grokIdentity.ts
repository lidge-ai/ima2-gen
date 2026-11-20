const MAX_USERINFO_BYTES = 64 * 1024;
const TRUSTED_HOSTS = new Set(["auth.x.ai", "accounts.x.ai"]);
function trustedEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && TRUSTED_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
}
async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > MAX_USERINFO_BYTES) { await reader.cancel(); throw new Error("USERINFO_TOO_LARGE"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}
export async function grokIdentity(discovery: { userinfo_endpoint?: string }, bearer: string,
  request: typeof fetch): Promise<{ ledgerKey: string; email: string | null } | null> {
  if (!discovery.userinfo_endpoint || !trustedEndpoint(discovery.userinfo_endpoint)) return null;
  try {
    const response = await request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${bearer}` },
      redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const value: unknown = JSON.parse(await readBounded(response));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { sub, email } = value as Record<string, unknown>;
    if (typeof sub !== "string" || !sub.trim()) return null;
    return { ledgerKey: `grok:oidc:${sub}`, email: typeof email === "string" ? email : null };
  } catch { return null; }
}
