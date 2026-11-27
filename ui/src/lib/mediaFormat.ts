/** Dollar amounts as the catalog publishes them: enough digits to tell $0.004 from $0.04, no trailing zeros, rounded up. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "$" + usd.toFixed(4).replace(/0+$/, "");
  // Rounded up, never down: an estimate that reads lower than the charge is the wrong way to be off.
  const places = usd < 1 ? 3 : 2;
  const scale = 10 ** places;
  return "$" + (Math.ceil(usd * scale - 1e-6) / scale).toFixed(places).replace(/(\.\d\d)0$/, "$1");
}
