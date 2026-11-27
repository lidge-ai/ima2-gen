import express from "express";
import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MediaKind } from "../lib/providers/media/contract.js";
import { buildMediaCatalog } from "../lib/providers/media/catalog.js";
import { MediaKeySnapshot } from "../lib/providers/media/credentials.js";
import { MediaJobError, mediaErrorBody } from "../lib/providers/media/errors.js";
import { storeMediaInput } from "../lib/providers/media/inputs.js";
import { billedInputSeconds, withBilledLength } from "../lib/providers/media/inputLength.js";
import { getMediaRegistry } from "../lib/providers/media/registry.js";
import { VENDOR_ASSET_DIR, VENDOR_ASSET_PREFIX, loadVendorLogos } from "../lib/providers/media/vendorAssets.js";
import { launchMediaJob, prepareMediaJob, type MediaRunnerDeps } from "../lib/providers/media/runner.js";
import { parseMediaJobBody } from "../lib/providers/media/validate.js";
import { estimateMediaUsd } from "../lib/webAccess/spendGuard.js";
import { abortJob, listJobs, listTerminalJobs } from "../lib/inflight.js";
import { logError } from "../lib/logger.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";

const KINDS: readonly MediaKind[] = ["image", "video", "audio"];
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function isMediaJob(job: { kind: string; meta?: Record<string, unknown> }): boolean {
  return job.kind === "workflow" || typeof job.meta?.adapter === "string";
}

export function mediaRunnerDeps(ctx: RuntimeContext, overrides: Partial<MediaRunnerDeps> = {}): MediaRunnerDeps {
  const deps: MediaRunnerDeps = {
    registry: getMediaRegistry(),
    generatedDir: ctx.config.storage.generatedDir,
    configFile: ctx.config.storage.configFile,
    inputsDir: join(ctx.config.storage.configDir, "media-inputs"),
    ...overrides,
  };
  // The web instance (lib/webAccess) serves remote people: routes that run on this machine are not theirs to use.
  return ctx.webAccess ? { ...deps, registry: deps.registry.withoutLocal() } : deps;
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

/** Signed-in email on the web instance (lib/webAccess); undefined on a local install. */
function webUserEmail(res: Response): string | undefined {
  const email = (res.locals.webUser as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email : undefined;
}

export function registerMediaRoutes(app: Express, ctxRaw: RouteRuntimeContext, overrides: Partial<MediaRunnerDeps> = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const deps = () => mediaRunnerDeps(ctx, overrides);

  app.get("/api/media/catalog", async (req: Request, res: Response) => {
    const d = deps();
    const kind = KINDS.find((k) => k === req.query.kind);
    const keys = await MediaKeySnapshot.load(d.configFile, d.env ?? process.env);
    res.json(buildMediaCatalog(d.registry, keys, kind, await loadVendorLogos(ctx.rootDir)));
  });

  // Logos for every UI, served from the one folder the studio kit owns. SVGs are
  // locked down so a logo file can never run script on this origin.
  app.use(VENDOR_ASSET_PREFIX, (_req: Request, res: Response, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  }, express.static(join(ctx.rootDir, VENDOR_ASSET_DIR), { fallthrough: false, index: false, dotfiles: "deny", maxAge: "1d" }));

  app.get("/api/media/vendors", async (_req: Request, res: Response) => {
    res.json({ vendors: (await loadVendorLogos(ctx.rootDir)).all() });
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
      const email = webUserEmail(res);
      const spend = ctx.webAccess?.spend;
      // Lip-sync, avatar and dubbing are billed by the length of an input, which the request does not state.
      const billedSeconds = await billedInputSeconds(prepared.spec, prepared.request, d.probeInputLength);
      // A local route has no price list to estimate from: it costs nothing, unless the workflow itself may be charged elsewhere.
      const local = prepared.adapter.route === "local" ? prepared.adapter.estimateLocal?.(prepared.spec) ?? { mayBill: false } : null;
      const estimate = local
        ? { usd: local.mayBill ? null : 0, basis: "exact" as const }
        : estimateMediaUsd(prepared.spec, withBilledLength(prepared.request, billedSeconds));
      if (spend) {
        await spend.admit({ requestId, model: prepared.spec.id, email: email ?? "unknown", estimate });
      }
      const { done } = launchMediaJob(d, prepared, {
        requestId, sessionId: optionalId(req.body?.sessionId), clientNodeId: optionalId(req.body?.clientNodeId),
        estimate, ...(email ? { meta: { webUser: email } } : {}),
      });
      done.catch(() => { /* published as an "error" event on the job */ });
      res.status(202).json({ requestId, model: prepared.spec.id, adapter: prepared.adapter.id });
    } catch (error) {
      sendMediaError(res, error, "media");
    }
  });

  // Active and recent media/workflow jobs, so a reloaded UI can reattach to /api/events.
  app.get("/api/media/jobs", (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === "string" && req.query.sessionId ? req.query.sessionId : undefined;
    const active = listJobs({ sessionId }).filter(isMediaJob);
    const recent = req.query.status === "all" ? listTerminalJobs({ sessionId }).filter(isMediaJob).slice(0, 100) : [];
    res.json({ jobs: active, terminalJobs: recent });
  });

  app.get("/api/media/jobs/:requestId", (req: Request<{ requestId: string }>, res: Response) => {
    const id = req.params.requestId;
    const job = listJobs().find((j) => j.requestId === id && isMediaJob(j)) ?? listTerminalJobs().find((j) => j.requestId === id && isMediaJob(j));
    if (!job) return res.status(404).json({ ok: false, code: "MEDIA_JOB_UNKNOWN", error: "Unknown job" });
    return res.json({ job });
  });

  app.post("/api/media/:requestId/cancel", (req: Request<{ requestId: string }>, res: Response) => {
    res.json({ ok: true, ...abortJob(req.params.requestId) });
  });
}
