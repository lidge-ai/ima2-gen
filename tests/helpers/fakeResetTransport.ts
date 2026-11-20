import { FAKE_TRANSPORT } from "../../lib/reset/fakeTransportBrand.ts";
export { FAKE_TRANSPORT };
export function fakeResetTransport(response: unknown = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  return {
    [FAKE_TRANSPORT]: true,
    calls,
    async send(url: string, body: unknown) { calls.push({ url, body }); return response; },
  };
}
