import express from "express";
import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MediaKind } from "../lib/providers/media/contract.js";
import { buildMediaCatalog } from "../lib/providers/media/catalog.js";
import { MediaKeySnapshot } from "../lib/providers/media/credentials.js";
import { MediaJobError, mediaErrorBody } from "../lib/providers/media/errors.js";
import { storeMediaInput } from "../lib/providers/media/inputs.js";
import { getMediaRegistry } from "../lib/providers/media/registry.js";
import { launchMediaJob, prepareMediaJob, type MediaRunnerDeps } from "../lib/providers/media/runner.js";
import { parseMediaJobBody } from "../lib/providers/media/validate.js";
import { abortJob } from "../lib/inflight.js";
import { logError } from "../lib/logger.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";

const KINDS: readonly MediaKind[] = ["image", "video", "audio"];
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function mediaRunnerDeps(ctx: RuntimeContext, overrides: Partial<MediaRunnerDeps> = {}): MediaRunnerDeps {
  return {
    registry: getMediaRegistry(),
    generatedDir: ctx.config.storage.generatedDir,
    configFile: ctx.config.storage.configFile,
    inputsDir: join(ctx.config.storage.configDir, "media-inputs"),
    ...overrides,
  };
}

export function sendMediaError(res: Response, error: unknown, scope: string): void {
  if (error instanceof MediaJobError) {
    if (error.code === "TOO_MANY_JOBS") res.setHeader("Retry-After", "5");
    res.status(error.status).json(mediaErrorBody(error));
    return;
  }
  logError(scope, "unexpected", error);
  res.status(500).json({ ok: false, code: "MEDIA_INTERNAL", error: "Internal error" });
}

export function readRequestId(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return `media_${randomUUID()}`;
  if (typeof raw !== "string" || !REQUEST_ID.test(raw)) throw new MediaJobError("MEDIA_INVALID_REQUEST", "requestId must be 1-128 of [A-Za-z0-9_.:-]");
  return raw;
}

function optionalId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 && raw.length <= 200 ? raw : null;
}

export function registerMediaRoutes(app: Express, ctxRaw: RouteRuntimeContext, overrides: Partial<MediaRunnerDeps> = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const deps = () => mediaRunnerDeps(ctx, overrides);

  app.get("/api/media/catalog", async (req: Request, res: Response) => {
    const d = deps();
    const kind = KINDS.find((k) => k === req.query.kind);
    const keys = await MediaKeySnapshot.load(d.configFile, d.env ?? process.env);
    res.json(buildMediaCatalog(d.registry, keys, kind));
  });

  app.post("/api/media/inputs", express.raw({ type: () => true, limit: "512mb" }), async (req: Request, res: Response) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.status(201).json(await storeMediaInput(deps().inputsDir, body, String(req.headers["content-type"] ?? "")));
    } catch (error) {
      sendMediaError(res, error, "media");
    }
  });

  app.post("/api/media", async (req: Request, res: Response) => {
    try {
      const requestId = readRequestId(req.body?.requestId);
      const body = parseMediaJobBody(req.body);
      const d = deps();
      const prepared = await prepareMediaJob(d, body);
      const { done } = launchMediaJob(d, prepared, { requestId, sessionId: optionalId(req.body?.sessionId), clientNodeId: optionalId(req.body?.clientNodeId) });
      done.catch(() => { /* published as an "error" event on the job */ });
      res.status(202).json({ requestId, model: prepared.spec.id, adapter: prepared.adapter.id });
    } catch (error) {
      sendMediaError(res, error, "media");
    }
  });

  app.post("/api/media/:requestId/cancel", (req: Request<{ requestId: string }>, res: Response) => {
    res.json({ ok: true, ...abortJob(req.params.requestId) });
  });
}
