export interface CodexCreditsProps {
  balance: string | null;
  resetCreditCount: number | null;
}

// Baseline projection: reset-credit count is not yet presented.
export function CodexCredits({ balance }: CodexCreditsProps) {
  return <div><span data-testid="balance">{balance ?? "—"}</span></div>;
}
