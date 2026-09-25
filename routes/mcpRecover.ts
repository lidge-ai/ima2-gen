// Recover a remote-succeeded MCP task into the local gallery (260718): when a
// generation's download/commit failed transiently, the provider asset still
// lives for 24-48h. This route re-polls get_task and re-runs the SAME
// download -> commit path as a normal generation.
import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { atomicWriteJson } from "../lib/atomicWrite.js";
import { finishJob, isStartJobFailure, registerJobAbortController, setJobPhase, startJob } from "../lib/inflight.js";
import { publishJobEvent } from "../lib/ssePublish.js";
import { downloadMediaResult } from "../lib/mcp/downloadMediaResult.js";
import { commitMediaResult } from "../lib/mcp/commitMediaResult.js";
import { appendMcpJobLog, logMcpJobError } from "../lib/mcp/jobLog.js";
import { runwayAdapter } from "../lib/mcp/adapters/runway.js";
import { higgsfieldAdapter } from "../lib/mcp/adapters/higgsfield.js";
import type { MediaProviderAdapter } from "../lib/mcp/providerAdapter.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";
import { extensionFor } from "./mcpMedia.js";

const ADAPTERS: Record<string, MediaProviderAdapter> = {
  runway: runwayAdapter,
  higgsfield: higgsfieldAdapter,
};

export interface McpRecoverDeps {
  download: typeof downloadMediaResult;
  writeSidecar: typeof atomicWriteJson;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return (typeof code === "string" && code) || String((error as Error)?.message ?? error).split(":")[0] || "MCP_RECOVER_FAILED";
}

async function runRecoverJob(input: {
  ctx: ReturnType<typeof requireRuntimeContext>;
  deps: McpRecoverDeps;
  adapter: MediaProviderAdapter;
  requestId: string;
  taskId: string;
  kind: "image" | "video";
  signal: AbortSignal;
}): Promise<void> {
  const { ctx, deps, adapter, requestId, taskId, kind } = input;
  const manager = ctx.mcpConnectionManager!;
  try {
    setJobPhase(requestId, "provider-poll");
    publishJobEvent(requestId, "progress", { phase: "provider-poll" });
    const pollPlan = adapter.buildPollCall(taskId);
    const result = await manager.callTool(adapter.provider, pollPlan.toolName, pollPlan.args, { signal: input.signal });
    const poll = adapter.parsePoll(result);
    if (poll.status !== "succeeded" || poll.outputUrls.length === 0) {
      throw new Error(`MCP_TASK_NOT_SUCCEEDED:${poll.status}`);
    }
    setJobPhase(requestId, "downloading");
    publishJobEvent(requestId, "progress", { phase: "downloading" });
    const outputUrl = poll.outputUrls[0];
    if (!outputUrl) throw new Error("MCP_OUTPUT_URL_MISSING");
    const download = await deps.download(outputUrl, { kind, attempts: 5, baseDelayMs: 4_000 });
    await commitMediaResult({
      ctx, deps, requestId, kind,
      tempPath: download.tempPath, cleanup: download.cleanup,
      ext: extensionFor(kind, download.contentType, outputUrl),
      meta: {
        requestId, mediaType: kind, provider: adapter.provider,
        providerTransport: "mcp-streamable-http",
        providerTaskId: taskId, providerUrl: download.sanitizedUrl,
        workflow: "recover", kind: `mcp-${kind}`,
      },
      doneExtra: { provider: adapter.provider, workflow: "recover", recovered: true },
    });
    void appendMcpJobLog(ctx.config.storage.generatedDir, {
      event: "recovered", requestId, provider: adapter.provider, taskId,
      sanitizedUrl: download.sanitizedUrl,
    });
  } catch (error) {
    const code = errorCode(error);
    void logMcpJobError(ctx.config.storage.generatedDir, { requestId, provider: adapter.provider, taskId }, error);
    finishJob(requestId, { status: "error", errorCode: code });
    publishJobEvent(requestId, "error", { code, message: "MCP task recovery failed", ...errorEnvelopeFields(error) });
  }
}

export function registerMcpRecoverRoutes(app: Express, ctxRaw: RouteRuntimeContext, depsPartial: Partial<McpRecoverDeps> = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const deps: McpRecoverDeps = {
    download: depsPartial.download ?? downloadMediaResult,
    writeSidecar: depsPartial.writeSidecar ?? atomicWriteJson,
  };

  app.post("/api/mcp/tasks/:taskId/recover", (req: Request, res: Response) => {
    const taskId = String(req.params.taskId ?? "");
    if (!/^[\w-]{8,80}$/.test(taskId)) {
      return res.status(400).json({ error: { code: "INVALID_TASK_ID", message: "task id required" } });
    }
    const provider = typeof req.body?.provider === "string" ? req.body.provider : "runway";
    const adapter = ADAPTERS[provider];
    if (!adapter) return res.status(400).json({ error: { code: "MCP_PROVIDER_UNKNOWN", message: String(provider) } });
    // Same contract as /api/mcp/generate: catalog-only providers reject
    // synchronously instead of dying inside the async job.
    if (!adapter.executable) return res.status(409).json({ error: { code: "MCP_EXECUTION_LOCKED", message: `${adapter.provider} is catalog-only` } });
    const kind = req.body?.kind === "image" ? "image" : "video";
    const manager = ctx.mcpConnectionManager;
    if (!manager || manager.status(adapter.provider).state !== "connected") {
      return res.status(409).json({ error: { code: "MCP_NOT_CONNECTED", message: `connect ${adapter.provider} first` } });
    }

    // Same caller-requestId contract as /api/mcp/generate: a retried recover with
    // the same requestId dedupes via startJob instead of committing the asset twice.
    const requestId = typeof req.body?.requestId === "string" && req.body.requestId
      ? req.body.requestId : `mcpr_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const started = startJob({ requestId, kind: "mcp-recover", prompt: `recover ${provider} task ${taskId}`, meta: { provider, taskId } });
    if (started && isStartJobFailure(started)) {
      return res.status(started.code === "TOO_MANY_JOBS" ? 429 : 409).json({ error: { code: started.code, message: "cannot start job" } });
    }
    const abort = new AbortController();
    registerJobAbortController(requestId, abort);
    res.status(202).json({ ok: true, requestId, provider, taskId, kind });

    void runRecoverJob({ ctx, deps, adapter, requestId, taskId, kind, signal: abort.signal });
  });
}
