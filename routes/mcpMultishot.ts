// wp5 053: POST /api/mcp/multishot — generate_multishot_video via Runway MCP.
// Independent route (not media-action) because multishot has no source file input.
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import type { Express, Request, Response } from "express";
import { finishJob, isStartJobFailure, registerJobAbortController, setJobPhase, startJob } from "../lib/inflight.js";
import { publishJobEvent } from "../lib/ssePublish.js";
import { executeMediaPlan } from "../lib/mcp/executeMediaJob.js";
import { downloadMediaResult } from "../lib/mcp/downloadMediaResult.js";
import { commitMediaResult } from "../lib/mcp/commitMediaResult.js";
import { appendMcpJobLog, logMcpJobError } from "../lib/mcp/jobLog.js";
import { scrubValue } from "../lib/mcp/sanitizer.js";
import { buildMultishotCall, runwayAdapter } from "../lib/mcp/adapters/runway.js";
import { uploadLocalMediaToRunway } from "../lib/mcp/adapters/runwayUpload.js";
import { atomicWriteJson } from "../lib/atomicWrite.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { localMediaPath, imageMime, IMAGE_INPUT_MAX_BYTES } from "./mcpMedia.js";
import { errorEnvelopeFields } from "../lib/errors/envelope.js";

export function registerMcpMultishotRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);

  app.post("/api/mcp/multishot", async (req: Request, res: Response) => {
    const provider = "runway";
    const adapter = runwayAdapter;
    if (!adapter.executable) return res.status(409).json({ error: { code: "MCP_EXECUTION_LOCKED", message: `${provider} is catalog-only` } });
    const manager = ctx.mcpConnectionManager;
    if (!manager || manager.status(provider).state !== "connected") {
      return res.status(409).json({ error: { code: "MCP_NOT_CONNECTED", message: `connect ${provider} first` } });
    }

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : null;
    const shots: string[] | null = Array.isArray(req.body?.shots)
      ? req.body.shots.filter((s: unknown): s is string => typeof s === "string" && Boolean(s))
      : null;
    if (!prompt && (!shots || shots.length === 0)) {
      return res.status(400).json({ error: { code: "INVALID_MULTISHOT", message: "prompt (storyPrompt) or shots[] is required" } });
    }
    if (shots && (shots.length < 3 || shots.length > 5)) {
      return res.status(400).json({ error: { code: "INVALID_MULTISHOT", message: "shots must be 3-5 entries" } });
    }

    const duration = [5, 10, 15].includes(Number(req.body?.duration)) ? Number(req.body.duration) as 5 | 10 | 15 : undefined;
    const resolution = req.body?.resolution === "1080p" ? "1080p" as const : "720p" as const;
    const aspectRatio = typeof req.body?.aspectRatio === "string" ? req.body.aspectRatio : undefined;
    const sound = typeof req.body?.sound === "boolean" ? req.body.sound : undefined;
    const firstSceneFilename = typeof req.body?.firstSceneFilename === "string" && req.body.firstSceneFilename
      ? req.body.firstSceneFilename : null;

    let firstScenePath: string | null = null;
    if (firstSceneFilename) {
      try {
        firstScenePath = await localMediaPath(ctx.config.storage.generatedDir, firstSceneFilename, {
          label: "first scene image", maxBytes: IMAGE_INPUT_MAX_BYTES, extensions: /\.(png|jpe?g|webp)$/i,
        });
      } catch (error) {
        return res.status(400).json({ error: { code: "INVALID_FIRST_SCENE", message: String((error as Error)?.message ?? error).slice(0, 120) } });
      }
    }

    const requestId = typeof req.body?.requestId === "string" && req.body.requestId
      ? req.body.requestId : `mcp_multishot_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const started = startJob({ requestId, kind: "mcp-multishot", prompt: prompt ?? shots?.join(" / ") ?? "", meta: { provider } });
    if (started && isStartJobFailure(started)) {
      return res.status(started.code === "TOO_MANY_JOBS" ? 429 : 409).json({ error: { code: started.code, message: "cannot start job" } });
    }
    res.status(202).json({ ok: true, requestId, provider });

    const abort = new AbortController();
    registerJobAbortController(requestId, abort);
    try {
      let firstSceneImageUrl: string | undefined;
      if (firstScenePath) {
        setJobPhase(requestId, "uploading");
        publishJobEvent(requestId, "progress", { phase: "uploading" });
        firstSceneImageUrl = await uploadLocalMediaToRunway(manager, firstScenePath, {
          fileName: basename(firstScenePath), mimeType: imageMime(firstScenePath),
        });
      }
      const plan = buildMultishotCall({
        storyPrompt: prompt ?? undefined, shots: shots ?? undefined,
        duration, resolution, aspectRatio, sound, firstSceneImageUrl,
      });
      publishJobEvent(requestId, "submitted", { provider, workflow: "video.multishot" });
      const result = await executeMediaPlan(manager, adapter, plan, {
        signal: abort.signal,
        onPhase: (phase) => { setJobPhase(requestId, phase); publishJobEvent(requestId, "progress", { phase }); },
      });
      void appendMcpJobLog(ctx.config.storage.generatedDir, {
        event: "taskId", requestId, provider, taskId: result.taskId,
      });
      setJobPhase(requestId, "downloading");
      publishJobEvent(requestId, "progress", { phase: "downloading" });
      const outputUrl = result.outputUrls[0];
      if (!outputUrl) throw new Error("MCP_OUTPUT_URL_MISSING");
      const download = await downloadMediaResult(outputUrl, { kind: "video", attempts: 5, baseDelayMs: 4_000 });
      await commitMediaResult({
        ctx, deps: { writeSidecar: atomicWriteJson }, requestId, kind: "video",
        tempPath: download.tempPath, cleanup: download.cleanup,
        ext: "mp4",
        meta: {
          requestId, mediaType: "video", provider, providerTransport: "mcp-streamable-http",
          providerTaskId: result.taskId, providerUrl: download.sanitizedUrl,
          workflow: "video.multishot", kind: "mcp-multishot",
          mcpParameters: { mode: shots ? "custom" : "auto", duration, resolution, ...(shots ? { shotCount: shots.length } : {}) },
        },
        doneExtra: { provider, workflow: "video.multishot" },
      });
    } catch (error) {
      const structuredCode = (error as { code?: unknown })?.code;
      const code = ((typeof structuredCode === "string" && structuredCode) || (String((error as Error)?.message ?? error).split(":")[0] ?? "")).slice(0, 80);
      // Secret-scrub (030): tool-error text can embed signed URLs/emails from the provider.
      console.error(`[mcp-multishot ERROR] requestId=${requestId} code=${code} message=${scrubValue(String((error as Error)?.message ?? "").slice(0, 300))}`);
      void logMcpJobError(ctx.config.storage.generatedDir, { requestId, provider }, error);
      finishJob(requestId, { status: "error", errorCode: code });
      publishJobEvent(requestId, "error", { code, message: "multishot generation failed", ...errorEnvelopeFields(error) });
    }
  });
}
