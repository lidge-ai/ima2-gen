import type Database from "better-sqlite3";

// Deliberately incomplete baseline: the enabled flag is cached at construction.
export class CodexAutoRedeem {
  private readonly enabled: boolean;
  constructor(db: Database.Database, private readonly inspect: () => Promise<void>,
    private readonly schedule: (callback: () => void) => void) {
    this.enabled = (db.prepare("SELECT enabled FROM reset_settings WHERE provider='codex'").get() as { enabled: number } | undefined)?.enabled === 1;
  }
  start(): void { this.schedule(() => { void this.tick(); }); }
  async tick(): Promise<void> { if (this.enabled) await this.inspect(); }
}
