import type { Express, Request, Response } from "express";
import { exportImageToComfy, isComfyBridgeError } from "../lib/comfyBridge.js";
import { ComfyAccess, deleteComfyRemote, isComfyRemoteError, putComfyRemote } from "../lib/comfy/access.js";
import { probeComfyOrigins } from "../lib/comfyImageAdapter.js";
import { deriveParams, parseApiGraph } from "../lib/comfyGraphBind.js";
import { describeParams } from "../lib/comfy/detect.js";
import { inspectComfyWorkflow } from "../lib/comfy/inspect.js";
import { extractComfyApiGraph, isPngBuffer } from "../lib/comfyPngWorkflow.js";
import {
  deleteWorkflow,
  isComfyWorkflowError,
  listWorkflows,
  putWorkflow,
  COMFY_WORKFLOW_ERROR,
  ComfyWorkflowError,
  type ComfyGraph,
  type ComfyWorkflowBindings,
  validateComfyMediaKind,
} from "../lib/comfyWorkflowStore.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

const ALLOWED_BODY_KEYS = new Set(["filename"]);

function hasExactBodyShape(body: unknown): body is { filename: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  const onlyKey = keys[0];
  return keys.length === 1 && !!onlyKey && ALLOWED_BODY_KEYS.has(onlyKey) && typeof obj.filename === "string";
}

function errorPayload(code: string, message: string, hint?: string) {
  return {
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}) },
  };
}

export function registerComfyRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  const loadAccess = () => ComfyAccess.load(ctx.config.storage.configFile);
  /** Node schemas are a handful of small reads; the health probe's budget is too tight for a server that is busy rendering. */
  const schemaTimeoutMs = Math.max(ctx.config.comfy.healthTimeoutMs, 5_000);

  /**
   * Keeps ctx.comfyWorkflows in step with the store after a write.
   *
   * The store is the source of truth and generation reads it directly; this
   * projection exists so the synchronous adapter contract (validateAuth,
   * listModels) and the lane display have something to read.
   */
  const refreshWorkflows = async (): Promise<void> => {
    ctx.comfyWorkflows = await listWorkflows();
  };

  const failWorkflow = (res: Response, error: unknown) => {
    if (isComfyWorkflowError(error)) {
      return res.status(error.status).json(errorPayload(error.code, error.message, error.hint));
    }
    if (isComfyBridgeError(error)) {
      const bridge = error as Error & { code: string; status: number };
      return res.status(bridge.status).json(errorPayload(bridge.code, bridge.message));
    }
    if (isComfyRemoteError(error)) {
      return res.status(error.status).json(errorPayload(error.code, error.message));
    }
    return res.status(500).json(errorPayload("COMFY_WORKFLOW_FAILED", "Could not complete the workflow operation."));
  };

  /** Accepts an API-format JSON graph, or a ComfyUI PNG carrying one. */
  const graphFromBody = (body: unknown): ComfyGraph => {
    const source = (body ?? {}) as { pngBase64?: unknown; graph?: unknown };
    if (typeof source.pngBase64 === "string" && source.pngBase64) {
      const buffer = Buffer.from(source.pngBase64, "base64");
      // Judged by magic bytes, not by what the caller named the field: a user
      // who saved a PNG as .json should still get a working registration.
      if (!isPngBuffer(buffer)) return parseApiGraph(source.pngBase64);
      const graph = extractComfyApiGraph(buffer);
      if (!graph) {
        throw new ComfyWorkflowError(
          COMFY_WORKFLOW_ERROR.GRAPH_INVALID,
          "This PNG carries no ComfyUI workflow metadata.",
        );
      }
      return graph;
    }
    return parseApiGraph(source.graph);
  };

  app.get("/api/comfy/workflows", async (_req: Request, res: Response) => {
    try {
      const workflows = await listWorkflows();
      const health = await probeComfyOrigins(
        workflows.map((workflow) => workflow.origin),
        ctx.config.comfy.healthTimeoutMs,
        undefined,
        await loadAccess(),
      );
      return res.json({
        ok: true,
        workflows: workflows.map((workflow) => ({
          ...workflow,
          health: health.get(workflow.origin) ?? { ok: false, reason: "not probed" },
        })),
      });
    } catch (error) {
      return failWorkflow(res, error);
    }
  });

  /**
   * Parses without saving, so the caller can confirm ambiguous bindings first.
   *
   * The server the workflow will run on is asked what its nodes accept, so the
   * prompt a sampler's positive input leads to is found by following the graph,
   * and the answer lists the nodes and model files that server does not have.
   * When it cannot be reached, the class-name rules still propose what they can.
   */
  app.post("/api/comfy/inspect", async (req: Request, res: Response) => {
    try {
      const graph = graphFromBody(req.body);
      const requested = (req.body ?? {}) as { origin?: unknown };
      const target = (await loadAccess()).target(typeof requested.origin === "string" ? requested.origin : ctx.config.comfy.defaultUrl);
      const { candidates, mediaKind, server } = await inspectComfyWorkflow(graph, target, schemaTimeoutMs);
      return res.json({
        ok: true,
        nodes: Object.entries(graph).map(([id, node]) => ({
          id,
          classType: node.class_type,
          title: node._meta?.title ?? null,
        })),
        candidates,
        ...(mediaKind ? { mediaKind } : {}),
        needsConfirmation: candidates.some((candidate) => !candidate.unambiguous),
        server,
      });
    } catch (error) {
      return failWorkflow(res, error);
    }
  });

  /**
   * Reachability check for an origin the user typed.
   *
   * Normalizes first: the browser must never fetch an arbitrary typed URL. A
   * malformed origin is 400 while an unreachable one is 200 with ok:false,
   * because telling someone to start ComfyUI when their URL simply has no port
   * sends them looking in the wrong place.
   */
  app.post("/api/comfy/probe", async (req: Request, res: Response) => {
    const requested = (req.body ?? {}) as { origin?: unknown };
    let access: ComfyAccess;
    let origin: string;
    try {
      access = await loadAccess();
      origin = access.target(
        typeof requested.origin === "string" ? requested.origin : ctx.config.comfy.defaultUrl,
      ).origin;
    } catch (error) {
      return failWorkflow(res, error);
    }
    const health = await probeComfyOrigins([origin], ctx.config.comfy.healthTimeoutMs, undefined, access);
    return res.json({ ok: true, origin, health: health.get(origin) ?? { ok: false, reason: "not probed" } });
  });

  /**
   * ComfyUI servers beyond this computer.
   *
   * Loopback needs no entry. Any other server must be added here before a
   * workflow can name it, and may carry a bearer token for an auth proxy. The
   * token is write-only: responses say only whether one is saved.
   */
  app.get("/api/comfy/remotes", async (_req: Request, res: Response) => {
    return res.json({ ok: true, remotes: (await loadAccess()).list() });
  });

  app.put("/api/comfy/remotes", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { origin?: unknown; token?: unknown; clearToken?: unknown };
    try {
      const remote = await putComfyRemote(ctx.config.storage.configFile, {
        origin: body.origin, token: body.token, clearToken: body.clearToken === true,
      });
      return res.json({ ok: true, remote });
    } catch (error) {
      return failWorkflow(res, error);
    }
  });

  app.delete("/api/comfy/remotes", async (req: Request, res: Response) => {
    try {
      const removed = await deleteComfyRemote(ctx.config.storage.configFile, req.query.origin);
      if (!removed) {
        return res.status(404).json(errorPayload("COMFY_REMOTE_NOT_FOUND", "That ComfyUI server is not on the list."));
      }
      const origin = new URL(String(req.query.origin)).origin;
      const stranded = (await listWorkflows()).filter((workflow) => workflow.origin === origin).map((workflow) => workflow.id);
      return res.json({ ok: true, origin, strandedWorkflows: stranded });
    } catch (error) {
      return failWorkflow(res, error);
    }
  });

  app.post("/api/comfy/workflows", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      id?: unknown; label?: unknown; origin?: unknown;
      bind?: ComfyWorkflowBindings; params?: unknown; replace?: unknown; mediaKind?: unknown;
    };
    try {
      const graph = graphFromBody(req.body);
      const bind = body.bind;
      if (!bind?.prompt?.node || !bind?.output?.node) {
        return res.status(400).json(errorPayload(
          COMFY_WORKFLOW_ERROR.BIND_INVALID,
          "A prompt binding and an output node are required. Call /api/comfy/inspect first and confirm the candidates.",
        ));
      }
      const access = await loadAccess();
      const target = access.target(typeof body.origin === "string" ? body.origin : ctx.config.comfy.defaultUrl);
      const inspection = await inspectComfyWorkflow(graph, target, schemaTimeoutMs, bind.output.node);
      if (inspection.mediaKind === "audio") {
        throw new ComfyWorkflowError(
          COMFY_WORKFLOW_ERROR.MEDIA_KIND_INVALID,
          `Workflow output node '${bind.output.node}' saves audio. Only image and video workflows can be registered here.`,
        );
      }
      const inferredMediaKind = inspection.mediaKind;
      const mediaKind = body.mediaKind === undefined
        ? inferredMediaKind ?? "image"
        : validateComfyMediaKind(body.mediaKind);
      if (inferredMediaKind && mediaKind !== inferredMediaKind) {
        throw new ComfyWorkflowError(
          COMFY_WORKFLOW_ERROR.MEDIA_KIND_MISMATCH,
          `Workflow output node '${bind.output.node}' is ${inferredMediaKind}, not ${mediaKind}.`,
        );
      }
      const record = await putWorkflow({
        id: typeof body.id === "string" ? body.id : "",
        label: typeof body.label === "string" ? body.label : String(body.id ?? ""),
        origin: target.origin,
        mediaKind,
        graph,
        bind,
        params: Array.isArray(body.params) ? body.params
          : inspection.info ? describeParams(graph, bind, inspection.info) : deriveParams(graph, bind),
      }, { allowReplace: body.replace === true, access });
      await refreshWorkflows();
      // Registration does not wait for a missing node or model to be installed; it says what is missing.
      return res.json({ ok: true, workflow: record, server: inspection.server });
    } catch (error) {
      return failWorkflow(res, error);
    }
  });

  app.delete("/api/comfy/workflows/:id", async (req: Request<{ id: string }>, res: Response) => {
    try {
      const removed = await deleteWorkflow(req.params.id);
      if (!removed) {
        return res.status(404).json(errorPayload(COMFY_WORKFLOW_ERROR.NOT_FOUND, "That workflow is not registered."));
      }
      await refreshWorkflows();
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      return failWorkflow(res, error);
    }
  });

  app.post("/api/comfy/export-image", async (req: Request, res: Response) => {
    try {
      if (!hasExactBodyShape(req.body)) {
        return res.status(400).json(errorPayload(
          "COMFY_IMAGE_INVALID",
          "Request body must contain exactly one filename.",
        ));
      }
      const target = (await loadAccess()).target(ctx.config.comfy.defaultUrl);
      const result = await exportImageToComfy(ctx, { filename: req.body.filename }, { target });
      return res.json(result);
    } catch (error) {
      if (isComfyBridgeError(error)) {
        return res.status(error.status).json(errorPayload(error.code, error.message));
      }
      return res.status(502).json(errorPayload(
        "COMFY_UPLOAD_FAILED",
        "Could not upload image to ComfyUI.",
      ));
    }
  });
}
