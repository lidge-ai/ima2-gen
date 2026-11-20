import type Database from "better-sqlite3";

export interface ResetSettings { enabled: boolean; leadMinutes: number }
export function readResetSettings(db: Database.Database): ResetSettings {
  const row = db.prepare("SELECT enabled, lead_minutes FROM reset_settings WHERE provider='codex'").get() as
    { enabled: number; lead_minutes: number } | undefined;
  return row ? { enabled: row.enabled === 1, leadMinutes: row.lead_minutes } : { enabled: false, leadMinutes: 10 };
}
export function writeResetSettings(db: Database.Database, value: unknown): ResetSettings {
  const settings = value as Partial<ResetSettings> | null;
  if (!settings || typeof settings.enabled !== "boolean" || !Number.isInteger(settings.leadMinutes)
    || settings.leadMinutes! < 1 || settings.leadMinutes! > 60) throw new Error("INVALID_SETTINGS");
  db.prepare(`INSERT INTO reset_settings VALUES ('codex', ?, ?, ?) ON CONFLICT(provider)
    DO UPDATE SET enabled=excluded.enabled, lead_minutes=excluded.lead_minutes, updated_at=excluded.updated_at`)
    .run(settings.enabled ? 1 : 0, settings.leadMinutes, Date.now());
  return { enabled: settings.enabled, leadMinutes: settings.leadMinutes! };
}
