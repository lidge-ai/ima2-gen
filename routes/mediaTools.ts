import type { Express, Request, Response } from "express";
import { MediaKeySnapshot } from "../lib/providers/media/credentials.js";
import { MediaJobError } from "../lib/providers/media/errors.js";
import { estimateMediaJob } from "../lib/providers/media/estimate.js";
import type { MediaRunnerDeps } from "../lib/providers/media/runner.js";
import { buildMediaToolDescriptors, MEDIA_TOOL_SCHEMA_VERSION, workflowValuesSchema, type WorkflowSchemaSource } from "../lib/providers/media/toolSchema.js";
import { parseMediaJobBody } from "../lib/providers/media/validate.js";
import { WORKFLOWS } from "../lib/workflows/index.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { mediaRunnerDeps, sendMediaError } from "./media.js";

function parseEstimateBody(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return parseMediaJobBody(raw);
  const { priceVariant, ...rest } = raw as Record<string, unknown>;
  if (priceVariant !== undefined && priceVariant !== null && priceVariant !== "" && (typeof priceVariant !== "string" || priceVariant.length > 200)) {
    throw new MediaJobError("MEDIA_INVALID_REQUEST", "priceVariant must be a string up to 200 characters");
  }
  const body = parseMediaJobBody(rest);
  return typeof priceVariant === "string" && priceVariant !== "" ? { ...body, priceVariant } : body;
}

export function registerMediaToolRoutes(app: Express, ctxRaw: RouteRuntimeContext, options: { workflows?: readonly WorkflowSchemaSource[]; deps?: Partial<MediaRunnerDeps> } = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const workflows = options.workflows ?? WORKFLOWS;
  app.get("/api/media/tools", (_req: Request, res: Response) => {
    res.json({ version: MEDIA_TOOL_SCHEMA_VERSION, tools: buildMediaToolDescriptors(workflows) });
  });
  app.get("/api/workflows/:id/schema", (req: Request<{ id: string }>, res: Response) => {
    const def = workflows.find((workflow) => workflow.id === req.params.id);
    if (!def) {
      res.status(404).json({ ok: false, code: "WORKFLOW_UNKNOWN", error: `Unknown workflow: ${req.params.id}`, status: 404, category: "not-found", retryable: false });
      return;
    }
    res.json({ id: def.id, label: def.label, schema: workflowValuesSchema(def.fields) });
  });
  app.post("/api/media/estimate", async (req: Request, res: Response) => {
    try {
      const body = parseEstimateBody(req.body);
      const deps = mediaRunnerDeps(ctx, options.deps);
      const keys = await MediaKeySnapshot.load(deps.configFile, deps.env ?? process.env);
      res.json(estimateMediaJob(deps.registry, keys, body));
    } catch (error) {
      sendMediaError(res, error, "media-estimate");
    }
  });
}
