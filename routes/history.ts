import type { Express, Request, Response } from "express";
import { trashAsset, restoreAsset, deleteAssetPermanent } from "../lib/assetLifecycle.js";
import {
  getHistoryIndex,
  invalidateFavoriteOverlay,
  invalidateHistoryIndex,
} from "../lib/historyIndex.js";
import { getSessionTitleMap } from "../lib/sessionStore.js";
import { logError, logEvent } from "../lib/logger.js";
import { getDb } from "../lib/db.js";
import { folderByFilePath, HistoryQueryError, parseHistoryQuery, selectHistoryPage, type HistoryQuery } from "../lib/historyQuery.js";

import { errInfo } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { backfillThumbnails } from "../lib/thumbBackfill.js";

export function registerHistoryRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.get("/api/history", async (req: Request, res: Response) => {
    try {
      let query: HistoryQuery;
      try {
        query = parseHistoryQuery(req.query as Record<string, unknown>, ctx.config.history);
      } catch (e) {
        if (e instanceof HistoryQueryError) return res.status(400).json({ error: e.message });
        throw e;
      }
      const groupBy = req.query.groupBy === "session" ? "session" : null;
      const browserId = typeof req.headers["x-ima2-browser-id"] === "string"
        ? req.headers["x-ima2-browser-id"]
        : null;

      const { rows } = await getHistoryIndex(ctx.config.storage.generatedDir);

      // Enrich with favorite status
      let favoriteSet = new Set<string>();
      if (browserId) {
        const db = getDb();
        const favRows = db.prepare("SELECT filename FROM gallery_favorites WHERE browser_id = ?").all(browserId) as Array<{ filename: string }>;
        favoriteSet = new Set(favRows.map((r) => r.filename));
      }

      const { page, nextCursor, matched, facets } = selectHistoryPage(rows, query, { favoriteSet, folders: folderByFilePath() });

      if (groupBy === "session") {
        type HistoryRow = (typeof page)[number];
        const groups = new Map<string, { sessionId: string; items: HistoryRow[]; lastUsedAt: HistoryRow["createdAt"] }>();
        const loose: HistoryRow[] = [];
        for (const row of page) {
          if (row.sessionId) {
            let group = groups.get(row.sessionId);
            if (!group) {
              group = { sessionId: row.sessionId, items: [], lastUsedAt: row.createdAt };
              groups.set(row.sessionId, group);
            }
            group.items.push(row);
            if (row.createdAt > group.lastUsedAt) group.lastUsedAt = row.createdAt;
          } else {
            loose.push(row);
          }
        }
        const titleMap = getSessionTitleMap(Array.from(groups.keys()));
        const sessions = Array.from(groups.values())
          .map((group) => ({
            ...group,
            title: titleMap.get(group.sessionId) || null,
            label: titleMap.get(group.sessionId) || group.sessionId.slice(0, 8),
          }))
          .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        logEvent("history", "grouped", {
          sessions: sessions.length,
          loose: loose.length,
          total: rows.length,
        });
        return res.json({ sessions, loose, total: rows.length, matched, nextCursor, ...(facets ? { facets } : {}) });
      }

      res.json({ items: page, total: rows.length, matched, nextCursor, ...(facets ? { facets } : {}) });
    } catch (e) {
      const err = errInfo(e);
      logError("history", "error", err.raw);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/history/:filename/permanent", async (req: Request<{ filename: string }>, res: Response) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      const result = await deleteAssetPermanent(ctx.rootDir, filename);
      invalidateHistoryIndex();
      res.json(result);
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  app.delete("/api/history/:filename", async (req: Request<{ filename: string }>, res: Response) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      const result = await trashAsset(ctx.rootDir, filename);
      invalidateHistoryIndex();
      res.json(result);
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  app.post("/api/history/:filename/restore", async (req: Request<{ filename: string }>, res: Response) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      const body = (req.body ?? {}) as { trashId?: unknown };
      const trashId = typeof body.trashId === "string" ? body.trashId : null;
      if (!trashId) return res.status(400).json({ error: "trashId required" });
      const result = await restoreAsset(ctx.rootDir, trashId, filename);
      invalidateHistoryIndex();
      res.json(result);
    } catch (e) {
      const err = errInfo(e);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/history/backfill-thumbnails", async (_req: Request, res: Response) => {
    try {
      const r = await backfillThumbnails(ctx.config.storage.generatedDir);
      if (r.created > 0) invalidateHistoryIndex();
      res.json({ ok: true, ...r });
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/history/favorite", async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const body = (req.body ?? {}) as { filename?: unknown };
      const { filename } = body;
      const browserId = req.headers["x-ima2-browser-id"];

      if (!filename || typeof filename !== "string") {
        return res.status(400).json({ error: "filename is required" });
      }
      if (!browserId || typeof browserId !== "string") {
        return res.status(400).json({ error: "X-Ima2-Browser-Id header is required" });
      }

      const existing = db.prepare("SELECT id FROM gallery_favorites WHERE browser_id = ? AND filename = ?").get(browserId, filename);

      if (existing) {
        db.prepare("DELETE FROM gallery_favorites WHERE browser_id = ? AND filename = ?").run(browserId, filename);
        invalidateFavoriteOverlay();
        res.json({ isFavorite: false });
      } else {
        const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        db.prepare(
          "INSERT INTO gallery_favorites (id, browser_id, filename, favorited_at) VALUES (?, ?, ?, ?)"
        ).run(id, browserId, filename, Math.floor(Date.now() / 1000));
        invalidateFavoriteOverlay();
        res.json({ isFavorite: true });
      }
    } catch (e) {
      const err = errInfo(e);
      logError("history", "favorite_error", err.raw);
      res.status(500).json({ error: err.message });
    }
  });
}
