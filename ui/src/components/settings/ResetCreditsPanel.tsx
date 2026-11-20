import { useEffect } from "react";

export interface ResetCreditsTransport {
  getOperations(): Promise<{ operationId: string; state: string }[]>;
  redeem(): Promise<void>;
}

// Baseline deliberately discards recovered operations and sends immediately.
export function ResetCreditsPanel({ transport }: { transport: ResetCreditsTransport }) {
  useEffect(() => { void transport.getOperations(); }, [transport]);
  return <button onClick={() => { void transport.redeem(); }}>Redeem</button>;
}
