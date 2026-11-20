import { Router } from "express";
import type Database from "better-sqlite3";
import { readResetSettings, writeResetSettings } from "../lib/reset/settings.js";
import type { CodexAutoRedeem } from "../lib/reset/codexAutoRedeem.js";

export function quotaResetSettingsRouter(db: Database.Database, watcher: CodexAutoRedeem): Router {
  const router = Router();
  router.get("/api/quota/reset-settings", (_req, res) => res.json(readResetSettings(db)));
  router.put("/api/quota/reset-settings", (req, res) => {
    try {
      const settings = writeResetSettings(db, req.body);
      watcher.reconfigure();
      return res.json(settings);
    } catch { return res.status(400).json({ error: { code: "INVALID_SETTINGS" } }); }
  });
  return router;
}
