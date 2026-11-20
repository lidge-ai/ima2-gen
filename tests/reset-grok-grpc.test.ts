import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { listRequest, redeemRequest, decodeList, decodeRedeem } from "../lib/reset/grokGrpcWeb.ts";

after(() => assert.equal(sentinelCount(), 0));
const frame = (flag: number, data: number[]) => Uint8Array.from([flag, 0, 0, 0, data.length, ...data]);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]));
const bytes = (s: string) => [...new TextEncoder().encode(s)];
const trailer = (status: number) => frame(128, bytes(`grpc-status: ${status}\r\n`));
const token = (id: string, start: number, end: number) => {
  const payload = [82, id.length, ...bytes(id), 162, 1, 2, 8, start, 242, 1, 2, 8, end];
  return [82, payload.length, ...payload];
};
describe("Grok gRPC-Web behavior", () => {
  it("decodes two tokens and validity timestamps", () => {
    const body = join(frame(0, [...token("a", 1, 2), ...token("b", 3, 4)]), trailer(0));
    assert.deepEqual(decodeList(body, 200), [
      { tokenId: "a", validityStart: 1, validityEnd: 2 },
      { tokenId: "b", validityStart: 3, validityEnd: 4 },
    ]);
  });
  for (const [name, body, http, header] of [
    ["truncated frame", Uint8Array.from([0, 0, 0, 0, 2, 1]), 200, undefined],
    ["bad varint", join(frame(0, [128]), trailer(0)), 200, undefined],
    ["missing trailer", frame(0, []), 200, undefined],
    ["conflicting status", join(frame(0, []), trailer(0), trailer(7)), 200, undefined],
    ["nonzero status", join(frame(0, []), trailer(7)), 200, undefined],
    ["HTTP 200 with grpc-status 7", join(frame(0, []), trailer(0)), 200, "7"],
  ] as const) {
    it(`rejects ${name} for list`, () => assert.throws(() => decodeList(body, http, header)));
    it(`treats ${name} as unknown for redeem`, () => assert.equal(decodeRedeem(body, http, header), "unknown"));
  }
});
describe("Grok gRPC-Web controls", () => {
  it("frames an empty list request", () => assert.deepEqual([...listRequest()], [0, 0, 0, 0, 0]));
  it("encodes redeem token in field one", () => assert.deepEqual([...redeemRequest("abc")], [0, 0, 0, 0, 5, 10, 3, 97, 98, 99]));
  it("uses protobuf varints for long token identifiers", () => {
    const encoded = redeemRequest("a".repeat(128));
    assert.deepEqual([...encoded.slice(0, 8)], [0, 0, 0, 0, 131, 10, 128, 1]);
  });
  it("accepts a complete success response", () => assert.equal(decodeRedeem(join(frame(0, []), trailer(0)), 200), "success"));
});
