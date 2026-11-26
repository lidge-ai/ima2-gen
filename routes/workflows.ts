import type { Express, Request, Response } from "express";
import { join } from "node:path";
import { MediaJobError } from "../lib/providers/media/errors.js";
import { resolveMediaRefPath } from "../lib/providers/media/inputs.js";
import type { MediaRunnerDeps } from "../lib/providers/media/runner.js";
import { createWorkflowGateway } from "../lib/providers/media/workflowGateway.js";
import { launchWorkflowJob } from "../lib/providers/media/workflowJob.js";
import { WORKFLOWS, WorkflowError, createFfmpegLocalOps, describeWorkflow, prepareWorkflow, summarizeSteps, type WorkflowDeps } from "../lib/workflows/index.js";
import type { WorkflowDefinition, WorkflowGateway, WorkflowLocalOps } from "../lib/workflows/types.js";
import { createOAuthPlanText } from "../lib/providers/media/workflowPlanner.js";
import { createSessionRoutes, type SessionRoute } from "../lib/providers/media/sessionRoutes.js";
import { logError } from "../lib/logger.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { mediaRunnerDeps, readRequestId, sendMediaError } from "./media.js";

export interface WorkflowRouteOptions {
  deps?: Partial<MediaRunnerDeps>;
  workflows?: readonly WorkflowDefinition[];
  local?: WorkflowLocalOps;
  /** Text planner for Director shots; defaults to the GPT OAuth planner. */
  planText?: WorkflowGateway["planText"];
  /** Subscription routes (xai-oauth, openai-oauth); defaults to the signed-in sessions. */
  sessionRoutes?: Readonly<Record<string, SessionRoute>>;
}

function sendWorkflowError(res: Response, error: unknown): void {
  if (error instanceof WorkflowError) {
    res.status(error.status).json({ ok: false, code: error.code, error: error.message, status: error.status, category: error.options.category ?? "invalid-request", retryable: error.options.retryable ?? false, ...(error.options.field ? { field: error.options.field } : {}) });
    return;
  }
  if (error instanceof MediaJobError) return sendMediaError(res, error, "workflow");
  logError("workflow", "unexpected", error);
  res.status(500).json({ ok: false, code: "WORKFLOW_INTERNAL", error: "Internal error" });
}

/** Media values arrive as { ref | filename | url, mimeType? }; the engine wants { path | url, mimeType }. */
async function toEngineValues(definition: WorkflowDefinition, raw: unknown, deps: MediaRunnerDeps): Promise<Record<string, unknown>> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new WorkflowError("WORKFLOW_INPUT_INVALID", "values: must be an object", { field: "values" });
  const values: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const dirs = { generatedDir: deps.generatedDir, inputsDir: deps.inputsDir };
  for (const field of definition.fields) {
    if (field.type !== "media" || values[field.name] === undefined) continue;
    const list = values[field.name];
    if (!Array.isArray(list)) throw new WorkflowError("WORKFLOW_INPUT_INVALID", `${field.name}: must be a list of media`, { field: field.name });
    values[field.name] = list.map((item: unknown) => resolveMediaRefPath(item, dirs, field.name));
  }
  return values;
}

export function registerWorkflowRoutes(app: Express, ctxRaw: RouteRuntimeContext, options: WorkflowRouteOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const workflows = options.workflows ?? WORKFLOWS;
  const deps = () => mediaRunnerDeps(ctx, options.deps);
  const local = options.local ?? createFfmpegLocalOps();
  const planText = options.planText ?? createOAuthPlanText(ctx);
  const sessionRoutes = options.sessionRoutes ?? createSessionRoutes(ctx);
  const engineDeps = async (d: MediaRunnerDeps): Promise<WorkflowDeps> => ({ gateway: await createWorkflowGateway(d, { planText, sessionRoutes }), local, allowedRoots: [d.inputsDir, d.generatedDir] });
  const find = (id: string) => {
    const def = workflows.find((w) => w.id === id);
    if (!def) throw new WorkflowError("WORKFLOW_UNKNOWN", `Unknown workflow: ${id}`, { status: 404, category: "not-found" });
    return def;
  };
  const prepare = async (req: Request<{ id: string }>, signal: AbortSignal) => {
    const def = find(req.params.id);
    const d = deps();
    const wfDeps = await engineDeps(d);
    const values = await toEngineValues(def, req.body?.values ?? req.body?.input, d);
    const request = { values, ...(req.body?.selection !== undefined ? { selection: req.body.selection } : {}) };
    return { d, wfDeps, prepared: await prepareWorkflow(def, request, wfDeps, signal) };
  };

  app.get("/api/workflows", async (_req: Request, res: Response) => {
    const gateway = await createWorkflowGateway(deps());
    res.json({ workflows: workflows.map((w) => describeWorkflow(w, gateway)) });
  });

  app.post("/api/workflows/:id/estimate", async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { prepared } = await prepare(req, AbortSignal.timeout(60_000));
      res.json({ estimate: prepared.estimate, steps: summarizeSteps(prepared.plan), notes: prepared.notes });
    } catch (error) {
      sendWorkflowError(res, error);
    }
  });

  app.post("/api/workflows/:id", async (req: Request<{ id: string }>, res: Response) => {
    try {
      const requestId = readRequestId(req.body?.requestId);
      const { d, wfDeps, prepared } = await prepare(req, AbortSignal.timeout(60_000));
      // Web instance (lib/webAccess): a run needs a complete published-price estimate inside the caps.
      const webUser = typeof res.locals.webUser?.email === "string" ? res.locals.webUser.email as string : undefined;
      if (ctx.webAccess?.spend) {
        const usd = prepared.estimate.complete ? prepared.estimate.usd : null;
        await ctx.webAccess.spend.admit({ requestId, model: "workflow:" + prepared.definition.id, email: webUser ?? "unknown", estimate: { usd, basis: "exact" } });
      }
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const runsDir = join(ctx.config.storage.configDir, "workflow-runs");
      void launchWorkflowJob(d, wfDeps, prepared, { requestId, sessionId, runsDir, ...(webUser ? { meta: { webUser } } : {}) });
      res.status(202).json({ requestId, workflow: prepared.definition.id, estimate: prepared.estimate, steps: summarizeSteps(prepared.plan), notes: prepared.notes });
    } catch (error) {
      sendWorkflowError(res, error);
    }
  });
}
