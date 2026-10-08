import type { Express, Request, Response } from "express";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { updateConfigFileAtomic } from "../lib/configFileStore.js";
import { api88Origin } from "../lib/api88/origin.js";
import { invalidateApi88Catalogs, refreshApi88Catalogs } from "../lib/api88/catalog.js";

function dto(ctx: RuntimeContext) {
  return { baseUrl: api88Origin(ctx.config.api88Provider.baseUrl), source: ctx.config.api88Provider.baseUrlSource };
}

async function patch(ctx: RuntimeContext, req: Request, res: Response) {
  if (ctx.config.api88Provider.baseUrlSource === "env") {
    return res.status(409).json({ ok: false, code: "API88_BASE_URL_ENV_LOCKED", error: "IMA2_88API_BASE_URL controls this URL" });
  }
  try {
    if (typeof req.body?.baseUrl !== "string" || !req.body.baseUrl) {
      return res.status(400).json({ ok: false, code: "API88_BASE_URL_INVALID", error: "baseUrl is required" });
    }
    const baseUrl = api88Origin(req.body.baseUrl);
    await updateConfigFileAtomic(ctx.config.storage.configFile, (saved) => {
      const previous = saved.api88Provider;
      saved.api88Provider = {
        ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}), baseUrl,
      };
    });
    ctx.config.api88Provider.baseUrl = baseUrl;
    ctx.config.api88Provider.baseUrlSource = "config";
    invalidateApi88Catalogs(ctx);
    await refreshApi88Catalogs(ctx);
    return res.json(dto(ctx));
  } catch (error) {
    const failure = error as { code?: string; status?: number; message?: string };
    return res.status(failure.status ?? 500).json({ ok: false, code: failure.code ?? "CONFIG_WRITE_FAILED", error: failure.message ?? "Could not save URL" });
  }
}

export function mountApi88ConfigRoutes(app: Express, ctx: RuntimeContext): void {
  app.get("/api/config/88api", (_req, res) => {
    try { res.json(dto(ctx)); }
    catch { res.status(400).json({ ok: false, code: "API88_BASE_URL_INVALID", error: "Invalid configured URL" }); }
  });
  app.patch("/api/config/88api", (req, res) => patch(ctx, req, res));
}
