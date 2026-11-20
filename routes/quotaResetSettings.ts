import { Router } from "express";
import type Database from "better-sqlite3";
import { readResetSettings, writeResetSettings } from "../lib/reset/settings.js";
import type { CodexAutoRedeem } from "../lib/reset/codexAutoRedeem.js";
import { accountRefForLedgerKey, resetIdentity } from "../lib/reset/identity.js";

export function quotaResetSettingsRouter(db: Database.Database, watcher: CodexAutoRedeem, accountId: () => Promise<string>): Router {
  const router = Router();
  const publicSettings = () => { const settings = readResetSettings(db); return { enabled: settings.enabled, leadMinutes: settings.leadMinutes,
    accountRef: settings.ledgerKey ? accountRefForLedgerKey(settings.ledgerKey) : null }; };
  router.get("/api/quota/reset-settings", (_req, res) => res.json(publicSettings()));
  router.put("/api/quota/reset-settings", async (req, res) => {
    if (typeof req.body?.accountRef !== "string" || !req.body.accountRef) return res.status(400).json({ error: { code: "INVALID_SETTINGS" } });
    let identity: ReturnType<typeof resetIdentity>;
    try { identity = resetIdentity("codex", await accountId()); }
    catch { return res.status(401).json({ error: { code: "ACCOUNT_ID_REQUIRED" } }); }
    if (identity.accountRef !== req.body.accountRef) return res.status(409).json({ error: { code: "IDENTITY_CHANGED" } });
    try {
      writeResetSettings(db, { ...req.body, ledgerKey: identity.ledgerKey });
      watcher.reconfigure();
      return res.json(publicSettings());
    } catch { return res.status(400).json({ error: { code: "INVALID_SETTINGS" } }); }
  });
  return router;
}
