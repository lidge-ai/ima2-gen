import { createHash } from "node:crypto";
export const accountRefForLedgerKey = (ledgerKey: string) => createHash("sha256").update(ledgerKey).digest("hex").slice(0, 16);

export function resetIdentity(provider: string, accountId: string) {
  if (!accountId || !accountId.trim()) throw new Error("ACCOUNT_ID_REQUIRED");
  const ledgerKey = `${provider}:${accountId}`;
  return { ledgerKey, accountRef: accountRefForLedgerKey(ledgerKey) };
}
