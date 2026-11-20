import { jsonFetch } from "../../lib/api-core";
import type { ResetCreditsTransport, ResetOperation, ResetList } from "./ResetCreditsPanel";

const post = <T,>(url: string, body: unknown) => jsonFetch<T>(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
export const resetCreditsTransport: ResetCreditsTransport = {
  async getOperations() {
    const data = await jsonFetch<{ operations: ResetOperation[] }>("/api/quota/reset-operations?provider=codex");
    return data.operations;
  },
  list: () => jsonFetch<ResetList>("/api/quota/codex/reset-credits"),
  async redeem() {
    const operationId = crypto.randomUUID();
    const confirmation = await post<{ token: string }>("/api/quota/reset-confirmations", { provider: "codex", operationId });
    return post<{ result?: { outcome?: string }; outcome?: string }>("/api/quota/codex/reset-credits/redeem", {
      operationId, confirmationToken: confirmation.token,
    });
  },
  getSettings: () => jsonFetch("/api/quota/reset-settings"),
  saveSettings: (settings) => jsonFetch("/api/quota/reset-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) }),
  acknowledge: (id) => post(`/api/quota/reset-operations/${encodeURIComponent(id)}/acknowledge`, {}),
};
