// Deliberately incomplete baseline for the failing-first contract tests.
export function listRequest(): Uint8Array { return new Uint8Array(5); }
export function redeemRequest(tokenId: string): Uint8Array {
  const token = new TextEncoder().encode(tokenId);
  return Uint8Array.from([0, 0, 0, 0, token.length + 2, 10, token.length, ...token]);
}
export function decodeList(_body: Uint8Array, _httpStatus: number, _grpcStatus?: string): unknown[] { return []; }
export function decodeRedeem(_body: Uint8Array, _httpStatus: number, _grpcStatus?: string): string { return "success"; }
