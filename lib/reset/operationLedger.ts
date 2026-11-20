import type Database from "better-sqlite3";
export interface Claim { operationId: string; provider: string; ledgerKey: string; ownerId: string; target?: string; expectedRevision?: number; auto?: boolean; creditSnapshot?: string[] }
export class OperationLedger {
  constructor(private readonly db: Database.Database) {}
  claim(input: Claim): void {
    this.db.transaction(() => {
      const now = Date.now();
      this.db.prepare("INSERT OR IGNORE INTO reset_accounts VALUES (?, ?, 0)").run(input.provider, input.ledgerKey);
      const changed = this.db.prepare(`UPDATE reset_accounts SET revision=revision+1 WHERE provider=? AND ledger_key=?
        AND (? IS NULL OR revision=?)`).run(input.provider, input.ledgerKey, input.expectedRevision ?? null, input.expectedRevision ?? null);
      if (!changed.changes) throw new Error("STALE_REVISION");
      if (input.auto && !this.enabled(input.provider)) throw new Error("AUTO_DISABLED");
      this.db.prepare(`INSERT INTO reset_operations
        (operation_id, provider, ledger_key, target, state, owner_id, created_at, updated_at, credit_snapshot)
        VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?)`).run(input.operationId, input.provider, input.ledgerKey,
        input.target ?? null, input.ownerId, now, now, input.creditSnapshot ? JSON.stringify(input.creditSnapshot) : null);
      if (input.target) this.db.prepare("INSERT INTO reset_targets VALUES (?, ?, ?, ?, ?)")
        .run(input.provider, input.ledgerKey, input.target, input.operationId, now);
    }).immediate();
  }
  private enabled(provider: string): boolean {
    return (this.db.prepare("SELECT enabled FROM reset_settings WHERE provider=?").get(provider) as { enabled: number } | undefined)?.enabled === 1;
  }
  sending(id: string, owner: string, auto = false): boolean {
    return this.db.transaction(() => {
      const row = this.get(id) as { provider: string; state: string; owner_id: string } | undefined;
      if (!row || row.state !== "claimed" || row.owner_id !== owner) return false;
      if (auto && !this.enabled(row.provider)) { this.abandon(id, owner); return false; }
      return this.db.prepare("UPDATE reset_operations SET state='sending', updated_at=? WHERE operation_id=? AND owner_id=? AND state='claimed'")
        .run(Date.now(), id, owner).changes === 1;
    }).immediate();
  }
  abandon(id: string, owner: string): void {
    this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE reset_operations SET state='abandoned', updated_at=? WHERE operation_id=? AND owner_id=? AND state='claimed'")
        .run(Date.now(), id, owner).changes;
      if (changed) this.db.prepare("DELETE FROM reset_targets WHERE operation_id=?").run(id);
    })();
  }
  recover(now: number): void {
    this.db.transaction(() => {
      const stale = "owner_id IN (SELECT owner_id FROM reset_owners WHERE heartbeat_at < ?)";
      this.db.prepare(`DELETE FROM reset_targets WHERE operation_id IN (SELECT operation_id FROM reset_operations WHERE state='claimed' AND ${stale})`).run(now - 60_000);
      this.db.prepare(`UPDATE reset_operations SET state='abandoned', updated_at=? WHERE state='claimed' AND ${stale}`).run(now, now - 60_000);
      this.db.prepare(`UPDATE reset_operations SET state='unknown', unknown_origin='recovered', updated_at=? WHERE state='sending' AND ${stale}`).run(now, now - 60_000);
    }).immediate();
  }
  unknown(id: string): void {
    this.db.prepare("UPDATE reset_operations SET state='unknown', unknown_origin='owner', updated_at=? WHERE operation_id=? AND state='sending'").run(Date.now(), id);
  }
  settle(id: string, outcome: string, releaseTarget = false): void {
    this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE reset_operations SET state='settled', outcome=?, updated_at=? WHERE operation_id=? AND state='sending'").run(outcome, Date.now(), id).changes;
      if (changed && releaseTarget) this.db.prepare("DELETE FROM reset_targets WHERE operation_id=?").run(id);
    })();
  }
  get(id: string): unknown { return this.db.prepare("SELECT * FROM reset_operations WHERE operation_id=?").get(id); }
}
export function migrateResetTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reset_operations (
      operation_id TEXT PRIMARY KEY, provider TEXT NOT NULL, ledger_key TEXT NOT NULL, target TEXT,
      state TEXT NOT NULL CHECK(state IN ('claimed','sending','settled','unknown','abandoned','acknowledged')),
      unknown_origin TEXT CHECK(unknown_origin IN ('owner','recovered')), outcome TEXT, owner_id TEXT NOT NULL,
      acknowledged_at INTEGER, acknowledged_by TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reset_unresolved_account ON reset_operations(provider, ledger_key)
      WHERE state IN ('claimed','sending','unknown');
    CREATE TABLE IF NOT EXISTS reset_owners (owner_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reset_targets (provider TEXT NOT NULL, ledger_key TEXT NOT NULL, target_key TEXT NOT NULL,
      operation_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(provider, ledger_key, target_key));
    CREATE TABLE IF NOT EXISTS reset_accounts (provider TEXT NOT NULL, ledger_key TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY(provider, ledger_key));
    CREATE TABLE IF NOT EXISTS reset_settings (provider TEXT PRIMARY KEY, enabled INTEGER NOT NULL,
      lead_minutes INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  `);
  const columns = db.prepare("PRAGMA table_info(reset_operations)").all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === "credit_snapshot")) db.exec("ALTER TABLE reset_operations ADD COLUMN credit_snapshot TEXT");
}
