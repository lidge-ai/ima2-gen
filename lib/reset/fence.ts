// A consume request does not name a credit, so a post-consume fence may clear only when the
// credit attributed to that consume leaves a complete list before it expires.
export function pairExpiry(pair: string): number {
  const expiry = pair.slice(pair.lastIndexOf("|") + 1);
  if (!/^\d+(?:\.\d+)?$/.test(expiry)) return Date.parse(expiry);
  const value = Number(expiry);
  return value < 1e12 ? value * 1000 : value;
}

/** Nearest-expiring live pair in a validated snapshot; mirrors auto-redeem target selection. */
export function attributedTarget(snapshot: string[], now: number): string | null {
  const live = snapshot.filter(pair => Number.isFinite(pairExpiry(pair)) && pairExpiry(pair) > now);
  return live.sort((a, b) => pairExpiry(a) - pairExpiry(b))[0] ?? null;
}

export function attributedConsumeObserved(target: unknown, snapshot: unknown, present: Set<string>, now: number): boolean {
  if (typeof target !== "string" || !target) return false;
  if (!Array.isArray(snapshot) || !snapshot.includes(target)) return false;
  const expiry = pairExpiry(target);
  return !present.has(target) && Number.isFinite(expiry) && expiry > now;
}
