/**
 * Ghep nhieu tep media thanh mot video.
 *
 * Node "GHEP VIDEO" ben giao dien goi tuyen nay. Khac voi cac tuyen sinh anh /
 * video, o day KHONG goi mo hinh nao - chi noi cac tep da co bang ffmpeg, nen
 * chay nhanh va khong ton tien.
 */
import type { Express, Request, Response } from "express";
import { basename } from "node:path";
import { ghepMedia, type MucGhep } from "../lib/mediaMerge.js";
import { resolveInGenerated } from "../lib/assetLifecycle.js";
import { errInfo } from "../lib/errInfo.js";
import { logError, logEvent } from "../lib/logger.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { config } from "../config.js";

const DUOI_VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const DUOI_ANH = /\.(png|jpe?g|webp)$/i;

export function registerMediaMergeRoutes(app: Express, ctxRaw: RouteRuntimeContext): void {
  const ctx = requireRuntimeContext(ctxRaw);
  void ctx;
  app.post("/api/media/merge", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { items?: unknown; fps?: unknown; imageSec?: unknown };
      const tho = Array.isArray(body.items) ? body.items : [];
      if (tho.length < 2) {
        return res.status(400).json({
          error: { code: "MERGE_NEED_TWO", message: "can it nhat hai muc de ghep" },
        });
      }

      const giayAnh = typeof body.imageSec === "number" && body.imageSec > 0
        ? Math.min(body.imageSec, 30) : undefined;

      const muc: MucGhep[] = [];
      for (const raw of tho) {
        const ten = typeof raw === "string"
          ? raw
          : (raw && typeof raw === "object" && typeof (raw as { filename?: unknown }).filename === "string"
            ? (raw as { filename: string }).filename : null);
        if (!ten) {
          return res.status(400).json({
            error: { code: "MERGE_ITEM_INVALID", message: "moi muc phai co filename" },
          });
        }
        // Chi nhan ten tep trong thu muc generated: chan duong dan tuy y di ra ngoai.
        const sach = basename(ten.replace(/^\/generated\//, ""));
        const laVideo = DUOI_VIDEO.test(sach);
        if (!laVideo && !DUOI_ANH.test(sach)) {
          return res.status(400).json({
            error: { code: "MERGE_ITEM_KIND", message: `khong ho tro dinh dang: ${sach}` },
          });
        }
        muc.push({
          duongDan: resolveInGenerated(config.storage.generatedDir, sach),
          loai: laVideo ? "video" : "anh",
          ...(laVideo || giayAnh === undefined ? {} : { giay: giayAnh }),
        });
      }

      const tenRa = `${Date.now()}_ghep.mp4`;
      const duongRa = resolveInGenerated(config.storage.generatedDir, tenRa);
      const batDau = Date.now();
      await ghepMedia(muc, duongRa, {
        ...(typeof body.fps === "number" && body.fps > 0 ? { fps: Math.min(body.fps, 60) } : {}),
      });

      logEvent("media", "merge_done", {
        items: muc.length,
        videos: muc.filter((m) => m.loai === "video").length,
        elapsedMs: Date.now() - batDau,
        out: tenRa,
      });
      res.json({ ok: true, filename: tenRa, url: `/generated/${tenRa}`, items: muc.length });
    } catch (e) {
      const err = errInfo(e);
      logError("media", "merge_error", err.raw);
      res.status(err.status || 500).json({
        error: { code: err.code || "MERGE_FAILED", message: err.message },
      });
    }
  });
}
