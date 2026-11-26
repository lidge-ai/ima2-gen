import type { Express, Request, Response } from "express";
import { MediaJobError } from "../lib/providers/media/errors.js";
import type { MediaRunnerDeps } from "../lib/providers/media/runner.js";
import { launchWorkflow, validateWorkflowInput } from "../lib/providers/media/workflowRunner.js";
import { BUILTIN_MEDIA_WORKFLOWS, findMediaWorkflow } from "../lib/providers/media/workflows.js";
import type { MediaWorkflow } from "../lib/providers/media/workflow.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { mediaRunnerDeps, readRequestId, sendMediaError } from "./media.js";

export interface WorkflowRouteOptions {
  deps?: Partial<MediaRunnerDeps>;
  workflows?: readonly MediaWorkflow[];
}

function totalUsd(steps: readonly { usd?: number }[]): number | null {
  if (steps.length === 0 || steps.some((s) => typeof s.usd !== "number")) return null;
  return +steps.reduce((sum, s) => sum + (s.usd ?? 0), 0).toFixed(4);
}

export function registerWorkflowRoutes(app: Express, ctxRaw: RouteRuntimeContext, options: WorkflowRouteOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const workflows = options.workflows ?? BUILTIN_MEDIA_WORKFLOWS;
  const deps = () => mediaRunnerDeps(ctx, options.deps);
  const find = (id: string) => {
    const wf = findMediaWorkflow(id, workflows);
    if (!wf) throw new MediaJobError("WORKFLOW_UNKNOWN", `Unknown workflow: ${id}`, { status: 404, category: "not-found" });
    return wf;
  };

  app.get("/api/workflows", (_req: Request, res: Response) => {
    res.json({ workflows: workflows.map((w) => ({ id: w.id, label: w.label, description: w.description, inputs: w.inputs })) });
  });

  app.post("/api/workflows/:id/estimate", (req: Request<{ id: string }>, res: Response) => {
    try {
      const wf = find(req.params.id);
      const input = req.body?.input && typeof req.body.input === "object" ? req.body.input as Record<string, unknown> : {};
      const steps = wf.estimate(input, deps().registry);
      res.json({ steps, totalUsd: totalUsd(steps) });
    } catch (error) {
      sendMediaError(res, error, "workflow");
    }
  });

  app.post("/api/workflows/:id", (req: Request<{ id: string }>, res: Response) => {
    try {
      const wf = find(req.params.id);
      const requestId = readRequestId(req.body?.requestId);
      const input = validateWorkflowInput(wf, req.body?.input);
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const { done } = launchWorkflow(deps(), wf, { requestId, input, sessionId });
      done.catch(() => { /* published as an "error" event on the job */ });
      res.status(202).json({ requestId, workflow: wf.id });
    } catch (error) {
      sendMediaError(res, error, "workflow");
    }
  });
}
