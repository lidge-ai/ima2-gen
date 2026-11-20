export const CODEX_CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";
export interface ResetTransport { send(url: string, body: unknown): Promise<unknown> }
export const realResetTransport: ResetTransport = {
  async send(url, body) {
    if (process.env.IMA2_RESET_DISPATCH_DISABLED === "1") throw new Error("CONSUME_DISABLED");
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return response.json() as Promise<unknown>;
  },
};
