import { authHeaders, codexSessionStore } from "../codexBackend/client.js";
export const CODEX_CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";
export const GROK_LIST_URL = "https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets";
export const GROK_REDEEM_URL = "https://grok.com/prod_mc_billing.ConsumerUiSvc/RedeemReset";
export interface ResetTransport { send(url: string, body: unknown): Promise<unknown> }
export function codexResetTransport(expectedAccount: () => string): ResetTransport {
  return { async send(url, body) {
    const consuming = url === CODEX_CONSUME_URL;
    if (consuming && process.env.IMA2_RESET_DISPATCH_DISABLED === "1") throw new Error("CONSUME_DISABLED");
    const session = await codexSessionStore().get();
    if (!session.accountId || session.accountId !== expectedAccount()) throw new Error("IDENTITY_CHANGED");
    const response = await fetch(url, { method: consuming ? "POST" : "GET",
      headers: authHeaders(session, consuming ? { "content-type": "application/json" } : undefined),
      ...(consuming ? { body: JSON.stringify(body), redirect: "manual" as const } : {}), signal: AbortSignal.timeout(consuming ? 10_000 : 8_000) });
    if (!response.ok) throw new Error(`RESET_HTTP_${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 262144) throw new Error("RESET_BODY_TOO_LARGE");
    return JSON.parse(text) as unknown;
  } };
}

export const realResetTransport = codexResetTransport(() => "");
export function grokResetTransport(bearer: string): ResetTransport {
  return { async send(url, body) {
    if (url !== GROK_LIST_URL && url !== GROK_REDEEM_URL) throw new Error("INVALID_GROK_URL");
    if (url === GROK_REDEEM_URL && process.env.IMA2_RESET_DISPATCH_DISABLED === "1") throw new Error("CONSUME_DISABLED");
    if (!(body instanceof Uint8Array)) throw new Error("INVALID_GROK_BODY");
    const response = await fetch(url, { method: "POST", redirect: "manual", headers: {
      "content-type": "application/grpc-web+proto", accept: "application/grpc-web+proto",
      "x-grpc-web": "1", "x-xai-token-auth": "xai-grok-cli", authorization: `Bearer ${bearer}`,
    }, body: Buffer.from(body), signal: AbortSignal.timeout(10_000) });
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) try { while (true) { const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length; if (size > 262144) { await reader.cancel(); throw new Error("RESET_BODY_TOO_LARGE"); }
      chunks.push(chunk.value); } } finally { reader.releaseLock(); }
    return { body: Buffer.concat(chunks), status: response.status, grpcStatus: response.headers.get("grpc-status") ?? undefined };
  } };
}
