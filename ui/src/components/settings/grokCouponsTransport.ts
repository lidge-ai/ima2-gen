import { jsonFetch } from "../../lib/api-core";
import type { GrokCouponsTransport } from "./GrokCouponsPanel";
import type { ResetOperation } from "./ResetCreditsPanel";

const post = <T,>(url: string, body: unknown) => jsonFetch<T>(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
export const grokCouponsTransport: GrokCouponsTransport = {
  list: () => jsonFetch("/api/quota/grok/reset-coupons"),
  async getOperations() {
    const data = await jsonFetch<{ operations: ResetOperation[] }>("/api/quota/reset-operations?provider=grok");
    return data.operations;
  },
  async redeem(target) {
    const operationId = crypto.randomUUID();
    const confirmation = await post<{ token: string }>("/api/quota/reset-confirmations", { provider: "grok", operationId, target });
    return post("/api/quota/grok/reset-coupons/redeem", { operationId, target, confirmationToken: confirmation.token });
  },
  acknowledge: (id) => post(`/api/quota/reset-operations/${encodeURIComponent(id)}/acknowledge`, {}),
};
