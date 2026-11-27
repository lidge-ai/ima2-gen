/** Dollar amounts as the catalog publishes them: enough digits to tell $0.004 from $0.04, no trailing zeros. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4).replace(/0+$/, "")}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2).replace(/(\.\d\d)0$/, "$1")}`;
}
