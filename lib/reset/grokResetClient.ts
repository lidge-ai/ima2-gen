import { dispatchReset } from "./dispatch.js";
import { decodeList, decodeRedeem, listRequest, redeemRequest } from "./grokGrpcWeb.js";
import { GROK_LIST_URL, GROK_REDEEM_URL, type ResetTransport } from "./transport.js";
type RpcResponse = { body: Uint8Array; status: number; grpcStatus?: string };
function rpc(value: unknown): RpcResponse {
  const result = value as RpcResponse;
  if (!result || !(result.body instanceof Uint8Array) || typeof result.status !== "number") throw new Error("INVALID_RPC_RESPONSE");
  return result;
}
export class GrokResetClient {
  constructor(private readonly transport: ResetTransport) {}
  async list() {
    const response = rpc(await this.transport.send(GROK_LIST_URL, listRequest()));
    return decodeList(response.body, response.status, response.grpcStatus);
  }
  async redeem(tokenId: string): Promise<{ outcome: string }> {
    try {
      const response = rpc(await dispatchReset(this.transport, GROK_REDEEM_URL, redeemRequest(tokenId)));
      return { outcome: decodeRedeem(response.body, response.status, response.grpcStatus) };
    } catch (error) {
      if (error instanceof Error && error.message === "CONSUME_DISABLED") throw error;
      return { outcome: "unknown" };
    }
  }
}
