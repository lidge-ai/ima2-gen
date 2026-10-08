import type { Express, Request, Response } from "express";
import {
  appendAgentTurn,
  compactAgentSession,
  createAgentSession,
  deleteAgentSession,
  getAgentGenerationSettings,
  getAgentSession,
  getAgentWorkspacePayload,
  importAgentImage,
  renameAgentSession,
  setAgentCurrentImage,
  setAgentGenerationSettings,
  setAgentLocks,
  setAgentWebSearch,
} from "../lib/agentStore.js";
import {
  createAgentQueueItem,
  getAgentGenerationErrors,
  getAgentQueueItem,
  listAgentQueueItems,
  retryAgentQueueItem,
} from "../lib/agentQueueStore.js";
import { cancelRunningAgentQueueItem, ensureAgentQueueWorker, tickAgentQueueWorker } from "../lib/agentQueueWorker.js";
import { parseAgentSlashCommand, formatAgentQuestionReply, formatAgentSlashHelp } from "../lib/agentCommandParser.js";
import { requestAgentQuestionAnswer } from "../lib/agentQuestionResponder.js";
import { agentAllowedToolPayload, runAgentTurn } from "../lib/agentRuntime.js";
import { errInfo } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

type AgentSessionBody = {
  title?: unknown | undefined;
  currentImage?: unknown | undefined;
  webSearchEnabled?: unknown | undefined;
  currentImageId?: unknown | undefined;
  styleLocks?: unknown | undefined;
  subjectLocks?: unknown | undefined;
  generationSettings?: unknown | undefined;
};

type AgentTurnBody = {
  prompt?: unknown | undefined;
  provider?: unknown | undefined;
  quality?: unknown | undefined;
  size?: unknown | undefined;
  format?: unknown | undefined;
  moderation?: unknown | undefined;
  model?: unknown | undefined;
  reasoningEffort?: unknown | undefined;
  requestId?: unknown | undefined;
};

type AgentQueueBody = AgentTurnBody & {
  options?: unknown | undefined;
};

export function registerAgentRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  ensureAgentQueueWorker(ctx);

  app.get("/api/agent/tools", (_req: Request, res: Response) => {
    res.json(agentAllowedToolPayload());
  });

  app.get("/api/agent/sessions", (req: Request, res: Response) => {
    const selectedId = typeof req.query.selectedSessionId === "string" ? req.query.selectedSessionId : null;
    res.json(getAgentWorkspacePayload(selectedId));
  });

  app.post("/api/agent/sessions", (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as AgentSessionBody;
      const session = createAgentSession({
        title: body.title,
        currentImage: normalizeCurrentImage(body.currentImage),
        webSearchEnabled: body.webSearchEnabled !== false,
      });
      res.status(201).json(getAgentWorkspacePayload(session.id));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/agent/sessions/:sessionId", (req: Request<{ sessionId: string }>, res: Response) => {
    const session = getAgentSession(req.params.sessionId);
    if (!session) return sendError(res, notFound(req.params.sessionId));
    res.json(getAgentWorkspacePayload(req.params.sessionId));
  });

  app.patch("/api/agent/sessions/:sessionId", (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      const body = (req.body ?? {}) as AgentSessionBody;
      if (Object.prototype.hasOwnProperty.call(body, "title")) renameAgentSession(req.params.sessionId, body.title);
      if (typeof body.webSearchEnabled === "boolean") setAgentWebSearch(req.params.sessionId, body.webSearchEnabled);
      if (Object.prototype.hasOwnProperty.call(body, "generationSettings")) {
        setAgentGenerationSettings(req.params.sessionId, body.generationSettings);
      }
      if (Object.prototype.hasOwnProperty.call(body, "currentImage")) {
        const image = normalizeCurrentImage(body.currentImage);
        if (image) importAgentImage(req.params.sessionId, image);
      }
      if (Object.prototype.hasOwnProperty.call(body, "currentImageId")) {
        const ok = setAgentCurrentImage(req.params.sessionId, body.currentImageId);
        if (!ok) throw imageNotFound(req.params.sessionId);
      }
      if (Array.isArray(body.styleLocks) || Array.isArray(body.subjectLocks)) setAgentLocks(req.params.sessionId, body);
      res.json(getAgentWorkspacePayload(req.params.sessionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/agent/sessions/:sessionId", (req: Request<{ sessionId: string }>, res: Response) => {
    const ok = deleteAgentSession(req.params.sessionId);
    if (!ok) return sendError(res, notFound(req.params.sessionId));
    res.json(getAgentWorkspacePayload(null));
  });

  app.post("/api/agent/sessions/:sessionId/compact", (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      if (!getAgentSession(req.params.sessionId)) throw notFound(req.params.sessionId);
      compactAgentSession(req.params.sessionId);
      res.json(getAgentWorkspacePayload(req.params.sessionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/agent/sessions/:sessionId/manifest", (req: Request<{ sessionId: string }>, res: Response) => {
    const payload = getAgentWorkspacePayload(req.params.sessionId);
    if (!payload.selectedSessionId) return sendError(res, notFound(req.params.sessionId));
    res.type("application/xml").send(payload.manifest ?? "");
  });

  app.post("/api/agent/sessions/:sessionId/turns", async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      const body = (req.body ?? {}) as AgentTurnBody;
      const prompt = cleanPrompt(body.prompt);
      await runAgentTurn(ctx, req.params.sessionId, prompt, {
        provider: cleanOption(body.provider),
        quality: cleanOption(body.quality),
        size: cleanOption(body.size),
        format: cleanOption(body.format),
        moderation: cleanOption(body.moderation),
        model: cleanModelOption(body.provider, body.model),
        reasoningEffort: cleanOption(body.reasoningEffort),
        requestId: cleanOption(body.requestId),
      });
      res.json(getAgentWorkspacePayload(req.params.sessionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/agent/queue", (_req: Request, res: Response) => {
    res.json({ queue: listAgentQueueItems() });
  });

  app.get("/api/agent/sessions/:sessionId/errors", (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      if (!getAgentSession(req.params.sessionId)) throw notFound(req.params.sessionId);
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
      res.json({ errors: getAgentGenerationErrors(req.params.sessionId, limit) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/agent/sessions/:sessionId/queue", (req: Request<{ sessionId: string }>, res: Response) => {
    if (!getAgentSession(req.params.sessionId)) return sendError(res, notFound(req.params.sessionId));
    res.json({ queue: listAgentQueueItems(req.params.sessionId) });
  });

  app.post("/api/agent/sessions/:sessionId/queue", async (req: Request<{ sessionId: string }>, res: Response) => {
    try {
      if (!getAgentSession(req.params.sessionId)) throw notFound(req.params.sessionId);
      const body = (req.body ?? {}) as AgentQueueBody;
      const rawPrompt = cleanPrompt(body.prompt);
      const command = parseAgentSlashCommand(rawPrompt);
      appendAgentTurn({ sessionId: req.params.sessionId, role: "user", text: rawPrompt, status: "complete" });
      if (command?.name === "help") {
        appendAgentTurn({
          sessionId: req.params.sessionId,
          role: "assistant",
          text: formatAgentSlashHelp(),
          status: "complete",
        });
        return res.status(200).json({ queueItem: null, workspace: getAgentWorkspacePayload(req.params.sessionId) });
      }
      if (command?.name === "question") {
        const options = normalizeQueueOptions(req.params.sessionId, body);
        const question = command.prompt.trim();
        const answer = question
          ? (await requestAgentQuestionAnswer(ctx, question, {
              provider: cleanOption(options.provider),
              model: cleanOption(options.model),
              reasoningEffort: cleanOption(options.reasoningEffort),
              requestId: cleanOption(body.requestId),
            })).text
          : formatAgentQuestionReply(command.prompt);
        appendAgentTurn({
          sessionId: req.params.sessionId,
          role: "assistant",
          text: answer,
          status: "complete",
        });
        return res.status(200).json({ queueItem: null, workspace: getAgentWorkspacePayload(req.params.sessionId) });
      }
      const prompt = command ? cleanPrompt(command.prompt) : rawPrompt;
      const queueItem = createAgentQueueItem({
        sessionId: req.params.sessionId,
        prompt,
        options: normalizeQueueOptions(req.params.sessionId, body),
        command,
      });
      void tickAgentQueueWorker(ctx);
      res.status(202).json({ queueItem, workspace: getAgentWorkspacePayload(req.params.sessionId) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/agent/queue/:itemId/cancel", (req: Request<{ itemId: string }>, res: Response) => {
    const item = getAgentQueueItem(req.params.itemId);
    if (!item) return sendError(res, queueItemNotFound(req.params.itemId));
    const ok = cancelRunningAgentQueueItem(item.id);
    if (!ok) return sendError(res, queueActionError("AGENT_QUEUE_CANCEL_FAILED", "Only queued or running Agent work can be canceled."));
    res.json(getAgentWorkspacePayload(item.sessionId));
  });

  app.post("/api/agent/queue/:itemId/retry", (req: Request<{ itemId: string }>, res: Response) => {
    const item = getAgentQueueItem(req.params.itemId);
    if (!item) return sendError(res, queueItemNotFound(req.params.itemId));
    const ok = retryAgentQueueItem(item.id);
    if (!ok) return sendError(res, queueActionError("AGENT_QUEUE_RETRY_FAILED", "Only failed or canceled Agent work can be retried."));
    void tickAgentQueueWorker(ctx);
    res.json(getAgentWorkspacePayload(item.sessionId));
  });
}

function normalizeCurrentImage(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    id: cleanOption(item.id),
    filename: cleanOption(item.filename),
    url: cleanOption(item.url) ?? cleanOption(item.image),
    thumbUrl: cleanOption(item.thumbUrl) ?? cleanOption(item.thumb),
    prompt: cleanOption(item.prompt) ?? cleanOption(item.userPrompt),
    revisedPrompt: cleanOption(item.revisedPrompt),
    createdAt: typeof item.createdAt === "number" ? item.createdAt : null,
  };
}

function cleanOption(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// 88API model ids are opaque and byte-exact (spaces, case, CJK); trimming one
// could turn an invalid id into a billable request for a different model.
function cleanModelOption(provider: unknown, value: unknown) {
  if (cleanOption(provider) !== "88api") return cleanOption(value);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cleanPrompt(value: unknown) {
  const prompt = cleanOption(value);
  if (prompt) return prompt;
  const err = new Error("Prompt is required") as Error & { code?: string | undefined; status?: number | undefined };
  err.code = "AGENT_PROMPT_REQUIRED";
  err.status = 400;
  throw err;
}

function normalizeQueueOptions(sessionId: string, body: AgentQueueBody) {
  const current = getAgentGenerationSettings(sessionId);
  const input = body.options && typeof body.options === "object" ? body.options as Record<string, unknown> : {};
  return {
    ...current,
    ...input,
    provider: cleanOption(body.provider) ?? input.provider ?? current.provider,
    quality: cleanOption(body.quality) ?? input.quality ?? current.quality,
    size: cleanOption(body.size) ?? input.size ?? current.size,
    format: cleanOption(body.format) ?? input.format ?? current.format,
    moderation: cleanOption(body.moderation) ?? input.moderation ?? current.moderation,
    model: cleanModelOption(cleanOption(body.provider) ?? input.provider ?? current.provider, body.model)
      ?? input.model ?? current.model,
    reasoningEffort: cleanOption(body.reasoningEffort) ?? input.reasoningEffort ?? current.reasoningEffort,
    webSearchEnabled: typeof input.webSearchEnabled === "boolean" ? input.webSearchEnabled : current.webSearchEnabled,
    generationStrategy: input.generationStrategy ?? current.generationStrategy,
    variants: input.variants ?? current.variants,
    maxAutoVariants: input.maxAutoVariants ?? current.maxAutoVariants,
    parallelism: input.parallelism ?? current.parallelism,
  };
}

function queueActionError(code: string, message: string) {
  const err = new Error(message) as Error & { code?: string | undefined; status?: number | undefined };
  err.code = code;
  err.status = 409;
  return err;
}

function queueItemNotFound(itemId: string) {
  const err = new Error(`Agent queue item not found: ${itemId}`) as Error & { code?: string | undefined; status?: number | undefined };
  err.code = "AGENT_QUEUE_ITEM_NOT_FOUND";
  err.status = 404;
  return err;
}

function sendError(res: Response, error: unknown) {
  const err = errInfo(error);
  // A wrapper code such as AGENT_TEXT_ONLY_RESULT carries the real cause in rawCode.
  // Forward it so the UI can render the specific error card instead of a generic one.
  const rawCode = (error && typeof error === "object")
    ? (error as { rawCode?: unknown }).rawCode
    : undefined;
  res.status(err.status || 500).json({
    error: { code: err.code || "AGENT_ERROR", message: err.message },
    code: err.code || "AGENT_ERROR",
    ...(typeof rawCode === "string" && rawCode ? { rawCode } : {}),
  });
}

function notFound(sessionId: string) {
  const err = new Error(`Agent session not found: ${sessionId}`) as Error & { code?: string | undefined; status?: number | undefined };
  err.code = "AGENT_SESSION_NOT_FOUND";
  err.status = 404;
  return err;
}

function imageNotFound(sessionId: string) {
  const err = new Error(`Agent image not found in session: ${sessionId}`) as Error & { code?: string | undefined; status?: number | undefined };
  err.code = "AGENT_IMAGE_NOT_FOUND";
  err.status = 404;
  return err;
}
