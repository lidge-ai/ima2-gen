import { dispatchReset } from "./dispatch.js";
import { CODEX_CONSUME_URL, type ResetTransport } from "./transport.js";
const LIST_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
export class CodexResetClient {
  constructor(private readonly transport: ResetTransport) {}
  list(): Promise<unknown> { return this.transport.send(LIST_URL, {}); }
  consume(redeemRequestId: string): Promise<unknown> {
    return dispatchReset(this.transport, CODEX_CONSUME_URL, { redeem_request_id: redeemRequestId });
  }
}
