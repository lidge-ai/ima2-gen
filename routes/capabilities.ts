import type { Express, Request, Response } from "express";
import { buildIma2Capabilities } from "../lib/capabilities.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { GROK_PLANNER_MODELS } from "../config.js";
import { buildLaneSummary } from "./models.js";

export function registerCapabilitiesRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);

  app.get("/api/capabilities", async (_req: Request, res: Response) => {
    // Lane state is read from the same builder /api/models uses, behind a short
    // TTL. A second implementation of "is this lane usable" is precisely the
    // drift this field exists to remove.
    let lanes;
    try {
      lanes = await buildLaneSummary(ctx);
    } catch {
      // A lane probe that fails should not take the whole payload with it. The
      // rest of the capability document is still true.
      lanes = undefined;
    }
    res.json(
      buildIma2Capabilities({
        appConfig: ctx.config,
        packageVersion: ctx.packageVersion,
        source: "server",
        server: ctx.serverUrl || `http://localhost:${ctx.serverActualPort || ctx.config.server.port}`,
        lanes,
      }),
    );
  });

  app.get("/api/config/grok-planner", (_req: Request, res: Response) => {
    res.json({ model: ctx.config.grokProvider.plannerModel, options: GROK_PLANNER_MODELS });
  });

  app.patch("/api/config/grok-planner", (req: Request, res: Response) => {
    const model = req.body?.model;
    if (typeof model !== "string" || !GROK_PLANNER_MODELS.some((option) => option === model)) {
      res.status(400).json({ error: `Invalid model. Options: ${GROK_PLANNER_MODELS.join(", ")}` });
      return;
    }
    ctx.config.grokProvider.plannerModel = model;
    res.json({ model });
  });
}
