import type Database from "better-sqlite3";
export interface Claim { operationId: string; provider: string; ledgerKey: string; ownerId: string; target?: string }
export class OperationLedger {
  constructor(private readonly db: Database.Database) {}
  claim(input: Claim): void {
    const now = Date.now();
    this.db.prepare(`INSERT INTO reset_operations
      (operation_id, provider, ledger_key, target, state, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?)`).run(input.operationId, input.provider, input.ledgerKey,
      input.target ?? null, input.ownerId, now, now);
  }
  sending(id: string, _owner: string): boolean {
    return this.db.prepare("UPDATE reset_operations SET state='sending' WHERE operation_id=?").run(id).changes > 0;
  }
  settle(id: string, outcome: string): void {
    this.db.prepare("UPDATE reset_operations SET state='settled', outcome=? WHERE operation_id=?").run(outcome, id);
  }
  get(id: string): unknown { return this.db.prepare("SELECT * FROM reset_operations WHERE operation_id=?").get(id); }
}
export function migrateResetTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reset_operations (
      operation_id TEXT PRIMARY KEY, provider TEXT NOT NULL, ledger_key TEXT NOT NULL, target TEXT,
      state TEXT NOT NULL, unknown_origin TEXT, outcome TEXT, owner_id TEXT NOT NULL,
      acknowledged_at INTEGER, acknowledged_by TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reset_owners (owner_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reset_targets (provider TEXT NOT NULL, ledger_key TEXT NOT NULL, target_key TEXT NOT NULL,
      operation_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(provider, ledger_key, target_key));
    CREATE TABLE IF NOT EXISTS reset_accounts (provider TEXT NOT NULL, ledger_key TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY(provider, ledger_key));
    CREATE TABLE IF NOT EXISTS reset_settings (provider TEXT PRIMARY KEY, enabled INTEGER NOT NULL,
      lead_minutes INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  `);
}
