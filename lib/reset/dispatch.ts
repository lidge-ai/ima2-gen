import type { ResetTransport } from "./transport.js";
import { FAKE_TRANSPORT } from "./fakeTransportBrand.js";
export async function dispatchReset(transport: ResetTransport, url: string, body: unknown): Promise<unknown> {
  if (process.env.IMA2_RESET_DISPATCH_DISABLED === "1"
    && !(transport as ResetTransport & { [FAKE_TRANSPORT]?: boolean })[FAKE_TRANSPORT]) {
    throw new Error("CONSUME_DISABLED");
  }
  return transport.send(url, body);
}
