/**
 * Anh tham chieu dinh len tung node, luu o may chu.
 *
 * Giao dien doc va ghi qua day thay vi giu trong localStorage: mot khuon chay o
 * may chu phai thay duoc dung nhung anh nguoi dung da dinh, va anh do phai song
 * qua viec doi may hay xoa du lieu trang.
 */
import type { Express, Request, Response } from "express";
import { getSession } from "../lib/sessionStore.js";
import {
  chuanHoaRef,
  datRefCuaNode,
  donRefMoCoi,
  refCuaNode,
  refCuaPhien,
} from "../lib/nodeRefStore.js";
import { errInfo } from "../lib/errInfo.js";
import { logError } from "../lib/logger.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

type PhienParams = { id: string };
type NodeParams = { id: string; nodeId: string };

function batLoi(res: Response, e: unknown): void {
  const err = errInfo(e);
  const status = err.status === 400 || err.status === 404 ? err.status : 500;
  if (status === 500) logError("node-refs", "route_error", err.raw);
  res.status(status).json({
    error: { code: err.code || "NODE_REFS_FAILED", message: err.message },
  });
}

function phaiCoPhien(sessionId: string): void {
  if (getSession(sessionId)) return;
  const e = new Error(`khong co phien ${sessionId}`) as Error & { code: string; status: number };
  e.code = "SESSION_NOT_FOUND";
  e.status = 404;
  throw e;
}

export function registerNodeRefRoutes(app: Express, ctxRaw: RouteRuntimeContext): void {
  const ctx = requireRuntimeContext(ctxRaw);

  app.get("/api/sessions/:id/node-refs", (req: Request<PhienParams>, res: Response) => {
    try {
      phaiCoPhien(req.params.id);
      res.json({ refs: refCuaPhien(req.params.id) });
    } catch (e) { batLoi(res, e); }
  });

  app.put("/api/sessions/:id/node-refs/:nodeId", async (req: Request<NodeParams>, res: Response) => {
    try {
      phaiCoPhien(req.params.id);
      const body = (req.body ?? {}) as { refs?: unknown };
      const tho = Array.isArray(body.refs) ? body.refs : [];
      const urls = await chuanHoaRef(ctx.config.storage.generatedDir, tho);
      datRefCuaNode(req.params.id, req.params.nodeId, urls);
      res.json({ ok: true, refs: urls });
    } catch (e) { batLoi(res, e); }
  });

  app.delete("/api/sessions/:id/node-refs/:nodeId", (req: Request<NodeParams>, res: Response) => {
    try {
      phaiCoPhien(req.params.id);
      datRefCuaNode(req.params.id, req.params.nodeId, []);
      res.json({ ok: true });
    } catch (e) { batLoi(res, e); }
  });

  /** Don anh cua nhung node da bi xoa khoi graph. */
  app.post("/api/sessions/:id/node-refs/prune", (req: Request<PhienParams>, res: Response) => {
    try {
      phaiCoPhien(req.params.id);
      const body = (req.body ?? {}) as { nodeIds?: unknown };
      const conLai = Array.isArray(body.nodeIds)
        ? body.nodeIds.filter((x): x is string => typeof x === "string")
        : [];
      res.json({ ok: true, removed: donRefMoCoi(req.params.id, conLai) });
    } catch (e) { batLoi(res, e); }
  });

  /** Doc anh cua MOT node - giao dien dung khi chi can mot node. */
  app.get("/api/sessions/:id/node-refs/:nodeId", (req: Request<NodeParams>, res: Response) => {
    try {
      phaiCoPhien(req.params.id);
      res.json({ refs: refCuaNode(req.params.id, req.params.nodeId) });
    } catch (e) { batLoi(res, e); }
  });
}
