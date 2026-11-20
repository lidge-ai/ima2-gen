import { createHash } from "node:crypto";

export function resetIdentity(provider: string, accountId: string) {
  if (!accountId || !accountId.trim()) throw new Error("ACCOUNT_ID_REQUIRED");
  const ledgerKey = `${provider}:${accountId}`;
  return { ledgerKey, accountRef: createHash("sha256").update(ledgerKey).digest("hex").slice(0, 16) };
}
