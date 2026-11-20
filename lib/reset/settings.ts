import type Database from "better-sqlite3";

export interface ResetSettings { enabled: boolean; leadMinutes: number; ledgerKey: string | null }
export function readResetSettings(db: Database.Database): ResetSettings {
  const row = db.prepare("SELECT enabled, lead_minutes, ledger_key FROM reset_settings WHERE provider='codex'").get() as
    { enabled: number; lead_minutes: number; ledger_key: string | null } | undefined;
  return row ? { enabled: row.enabled === 1 && !!row.ledger_key, leadMinutes: row.lead_minutes, ledgerKey: row.ledger_key } : { enabled: false, leadMinutes: 10, ledgerKey: null };
}
export function writeResetSettings(db: Database.Database, value: unknown): ResetSettings {
  const settings = value as Partial<ResetSettings> | null;
  if (!settings || typeof settings.enabled !== "boolean" || !Number.isInteger(settings.leadMinutes)
    || settings.leadMinutes! < 1 || settings.leadMinutes! > 60 || typeof settings.ledgerKey !== "string" || !settings.ledgerKey) throw new Error("INVALID_SETTINGS");
  db.prepare(`INSERT INTO reset_settings (provider, enabled, lead_minutes, updated_at, ledger_key) VALUES ('codex', ?, ?, ?, ?) ON CONFLICT(provider)
    DO UPDATE SET enabled=excluded.enabled, lead_minutes=excluded.lead_minutes, updated_at=excluded.updated_at, ledger_key=excluded.ledger_key`)
    .run(settings.enabled ? 1 : 0, settings.leadMinutes, Date.now(), settings.ledgerKey);
  return { enabled: settings.enabled, leadMinutes: settings.leadMinutes!, ledgerKey: settings.ledgerKey };
}
