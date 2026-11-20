import { dispatchReset } from "./dispatch.js";
import { CODEX_CONSUME_URL, type ResetTransport } from "./transport.js";
const LIST_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export class CodexResetClient {
  constructor(private readonly transport: ResetTransport) {}
  async list() {
    const raw = object(await this.transport.send(LIST_URL, {}));
    const entries = Array.isArray(raw?.credits) ? raw.credits : [];
    const valid = entries.map(object).filter((item): item is Record<string, unknown> => {
      if (!item) return false;
      const date = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && Number.isFinite(Date.parse(v)));
      return date(item.granted_at) && date(item.expires_at)
        && [item.id, item.status, item.title].every(v => v == null || typeof v === "string");
    });
    return { availableCount: raw?.available_count ?? null, totalEarnedCount: raw?.total_earned_count ?? null,
      complete: !!raw && Array.isArray(raw.credits) && valid.length === entries.length
        && typeof raw.available_count === "number" && Number.isInteger(raw.available_count)
        && raw.available_count >= 0 && raw.available_count === valid.length,
      credits: valid.map(item => ({ id: item.id, status: item.status, title: item.title,
        grantedAt: item.granted_at, expiresAt: item.expires_at })) };
  }
  async prepare(): Promise<CodexResetClient> {
    return new CodexResetClient(this.transport.prepare ? await this.transport.prepare() : this.transport);
  }
  async consume(redeemRequestId: string): Promise<{ outcome: string; windowsReset?: unknown }> {
    try {
      const result = object(await dispatchReset(this.transport, CODEX_CONSUME_URL, { redeem_request_id: redeemRequestId }));
      const outcome = result?.code;
      if (typeof outcome !== "string" || !["reset", "nothing_to_reset", "no_credit", "already_redeemed"].includes(outcome)) return { outcome: "unknown" };
      return { outcome, ...(result?.windows_reset !== undefined ? { windowsReset: result.windows_reset } : {}) };
    } catch (error) {
      if (error instanceof Error && error.message === "CONSUME_DISABLED") throw error;
      return { outcome: "unknown" };
    }
  }
}
