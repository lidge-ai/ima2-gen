import { dispatchReset } from "./dispatch.js";
import { CODEX_CONSUME_URL, type ResetTransport } from "./transport.js";
const LIST_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export class CodexResetClient {
  constructor(private readonly transport: ResetTransport) {}
  async list(): Promise<unknown> {
    const raw = object(await this.transport.send(LIST_URL, {}));
    if (!raw || !Array.isArray(raw.credits)) throw new Error("INVALID_RESET_LIST");
    return { availableCount: raw.available_count ?? null, totalEarnedCount: raw.total_earned_count ?? null,
      credits: raw.credits.map(object).filter(Boolean).map(item => ({ id: item?.id, status: item?.status, title: item?.title })) };
  }
  async consume(redeemRequestId: string): Promise<{ outcome: string; windowsReset?: unknown }> {
    try {
      const result = object(await dispatchReset(this.transport, CODEX_CONSUME_URL, { redeem_request_id: redeemRequestId }));
      const outcome = result?.outcome;
      if (typeof outcome !== "string" || !["reset", "nothing_to_reset", "no_credit", "already_redeemed"].includes(outcome)) return { outcome: "unknown" };
      return { outcome, ...(result?.windows_reset !== undefined ? { windowsReset: result.windows_reset } : {}) };
    } catch (error) {
      if (error instanceof Error && error.message === "CONSUME_DISABLED") throw error;
      return { outcome: "unknown" };
    }
  }
}
