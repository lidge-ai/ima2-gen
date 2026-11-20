import { randomUUID } from "node:crypto";
export interface Confirmation { provider: string; ledgerKey: string; operationId: string; principalId: string; target?: string | null; expiresAt: number }
export class Confirmations {
  private readonly tokens = new Map<string, Confirmation>();
  issue(value: Omit<Confirmation, "expiresAt">): string {
    const token = randomUUID();
    this.tokens.set(token, { ...value, expiresAt: Date.now() + 120_000 });
    return token;
  }
  take(token: string): Confirmation | undefined {
    const value = this.tokens.get(token);
    this.tokens.delete(token);
    return value && value.expiresAt > Date.now() ? value : undefined;
  }
}
