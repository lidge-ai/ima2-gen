import { authHeaders, codexSessionStore } from "../codexBackend/client.js";
export const CODEX_CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";
export interface ResetTransport { send(url: string, body: unknown): Promise<unknown> }
export function codexResetTransport(expectedAccount: () => string): ResetTransport {
  return { async send(url, body) {
    const consuming = url === CODEX_CONSUME_URL;
    if (consuming && process.env.IMA2_RESET_DISPATCH_DISABLED === "1") throw new Error("CONSUME_DISABLED");
    const session = await codexSessionStore().get();
    if (!session.accountId || session.accountId !== expectedAccount()) throw new Error("IDENTITY_CHANGED");
    const response = await fetch(url, { method: consuming ? "POST" : "GET",
      headers: authHeaders(session, consuming ? { "content-type": "application/json" } : undefined),
      ...(consuming ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(consuming ? 10_000 : 8_000) });
    if (!response.ok) throw new Error(`RESET_HTTP_${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 262144) throw new Error("RESET_BODY_TOO_LARGE");
    return JSON.parse(text) as unknown;
  } };
}

export const realResetTransport = codexResetTransport(() => "");
