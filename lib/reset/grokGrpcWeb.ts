export interface GrokCoupon { tokenId: string; validityStart: number | null; validityEnd: number | null }
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function varint(value: number): number[] {
  const result: number[] = [];
  while (value >= 128) { result.push((value % 128) | 128); value = Math.floor(value / 128); }
  result.push(value); return result;
}
function frame(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length + 5);
  new DataView(result.buffer).setUint32(1, bytes.length); result.set(bytes, 5); return result;
}
export function listRequest(): Uint8Array { return frame(new Uint8Array()); }
export function redeemRequest(tokenId: string): Uint8Array {
  const token = encoder.encode(tokenId);
  return frame(Uint8Array.from([10, ...varint(token.length), ...token]));
}
function readVarint(data: Uint8Array, position: { value: number }): number {
  let value = 0, multiplier = 1;
  for (let i = 0; i < 10; i++) {
    if (position.value >= data.length) throw new Error("TRUNCATED_VARINT");
    const byte = data[position.value++]!; value += (byte & 127) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error("INVALID_VARINT");
    if (!(byte & 128)) return value;
    multiplier *= 128;
  }
  throw new Error("INVALID_VARINT");
}
function fields(data: Uint8Array): Array<{ number: number; value: number | Uint8Array }> {
  const position = { value: 0 }, result: Array<{ number: number; value: number | Uint8Array }> = [];
  while (position.value < data.length) {
    const tag = readVarint(data, position), wire = tag % 8, number = Math.floor(tag / 8);
    if (!number) throw new Error("INVALID_FIELD");
    if (wire === 0) result.push({ number, value: readVarint(data, position) });
    else if (wire === 2) {
      const length = readVarint(data, position), end = position.value + length;
      if (end > data.length) throw new Error("TRUNCATED_FIELD");
      result.push({ number, value: data.slice(position.value, end) }); position.value = end;
    } else throw new Error("INVALID_WIRE_TYPE");
  }
  return result;
}
function messages(body: Uint8Array, httpStatus: number, grpcStatus?: string): Uint8Array[] {
  if (httpStatus !== 200 || (grpcStatus !== undefined && grpcStatus !== "0")) throw new Error("RPC_FAILED");
  let offset = 0, trailer = false; const data: Uint8Array[] = [];
  while (offset < body.length) {
    if (body.length - offset < 5) throw new Error("TRUNCATED_FRAME");
    const flag = body[offset]!, size = new DataView(body.buffer, body.byteOffset + offset + 1, 4).getUint32(0);
    offset += 5; if (size > body.length - offset || trailer) throw new Error("INVALID_FRAME");
    const payload = body.slice(offset, offset + size); offset += size;
    if (flag === 0) data.push(payload);
    else if (flag === 128) {
      trailer = true;
      const statuses = decoder.decode(payload).split(/\r?\n/).filter(line => /^grpc-status\s*:/i.test(line));
      if (statuses.length !== 1 || !/^grpc-status:\s*0\s*$/i.test(statuses[0]!)) throw new Error("RPC_FAILED");
    } else throw new Error("INVALID_FRAME");
  }
  if (!trailer || !data.length) throw new Error("MISSING_TRAILER");
  return data;
}
function timestamp(value: number | Uint8Array | undefined): number | null {
  if (!(value instanceof Uint8Array)) return null;
  const seconds = fields(value).find(field => field.number === 1)?.value;
  return typeof seconds === "number" ? seconds : null;
}
export function decodeList(body: Uint8Array, httpStatus: number, grpcStatus?: string): GrokCoupon[] {
  return messages(body, httpStatus, grpcStatus).flatMap(data => fields(data).filter(f => f.number === 10).map(field => {
    if (!(field.value instanceof Uint8Array)) throw new Error("INVALID_COUPON");
    const parts = fields(field.value), id = parts.find(f => f.number === 10)?.value;
    if (!(id instanceof Uint8Array)) throw new Error("INVALID_COUPON");
    const tokenId = decoder.decode(id); if (!tokenId) throw new Error("INVALID_COUPON");
    return { tokenId, validityStart: timestamp(parts.find(f => f.number === 20)?.value), validityEnd: timestamp(parts.find(f => f.number === 30)?.value) };
  }));
}
export function decodeRedeem(body: Uint8Array, httpStatus: number, grpcStatus?: string): string {
  try { for (const data of messages(body, httpStatus, grpcStatus)) fields(data); return "success"; } catch { return "unknown"; }
}
