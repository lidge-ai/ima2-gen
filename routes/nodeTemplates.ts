import type { Express, NextFunction, Request, Response } from "express";
import { errInfo } from "../lib/errInfo.js";
import {
  nodeTemplateStore,
  type NodeTemplateGraph,
  type NodeTemplateRecord,
} from "../lib/nodeTemplateStore.js";
import {
  TemplateFileError,
  buildTemplateFile,
  parseTemplateFile,
  templateFileLimits,
  templateFileName,
  uniqueTemplateName,
  type TemplateFileLimits,
} from "../lib/nodeTemplateFile.js";
import type { RuntimeContext } from "../lib/runtimeContext.js";

type IdParams = { id: string };

function terminalCount(template: NodeTemplateRecord): number {
  const manifestCount = template.graph.manifest?.expectedTerminalResults;
  if (typeof manifestCount === "number") return manifestCount;
  const sources = new Set(template.graph.edges.map((edge) => edge.source));
  return template.graph.nodes.filter((node) => !sources.has(node.id)).length;
}

function previewGraph(graph: NodeTemplateGraph) {
  if (graph.nodes.length === 0) return [];
  const points = graph.nodes.map((node) => node.position ?? { x: 0, y: 0 });
  const minX = Math.min(...points.map((point) => point.x ?? 0));
  const maxX = Math.max(...points.map((point) => point.x ?? 0));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const normalize = (value: number, min: number, max: number) =>
    max === min ? 50 : 10 + ((value - min) / (max - min)) * 80;
  return graph.nodes.slice(0, 16).map((node) => ({
    id: node.id,
    x: normalize(node.position?.x ?? 0, minX, maxX),
    y: normalize(node.position?.y ?? 0, minY, maxY),
    label: typeof node.data?.kind === "string" ? node.data.kind : undefined,
  }));
}

function toSummary(template: NodeTemplateRecord) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    source: template.source,
    tags: template.tags,
    nodeCount: template.graph.nodes.length,
    terminalCount: terminalCount(template),
    preview: previewGraph(template.graph),
  };
}

function sendError(res: Response, error: unknown): void {
  const info = errInfo(error);
  const status = info.status || 500;
  const code = status === 500 ? "NODE_TEMPLATE_FAILED" : info.code || "NODE_TEMPLATE_FAILED";
  res.status(status).json({ error: { code, message: info.message } });
}

/** Import errors carry fixed text only: the request body is untrusted file content. */
function sendImportError(res: Response, error: unknown): void {
  if (error instanceof TemplateFileError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const info = errInfo(error);
  const status = Number(info.status);
  if (status >= 400 && status < 500) {
    res.status(400).json({ error: { code: "INVALID_TEMPLATE_GRAPH", message: "template graph is not valid" } });
    return;
  }
  res.status(500).json({ error: { code: "NODE_TEMPLATE_FAILED", message: "template import failed" } });
}

/**
 * Error handler for the import route's own 2MB JSON parser (mounted in server.ts
 * before the global one). body-parser messages can quote the payload or headers,
 * so every parser failure becomes a fixed code.
 */
export function templateImportBodyErrors(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const info = error as { status?: number; type?: string };
  const tooLarge = info?.status === 413 || info?.type === "entity.too.large";
  res.status(tooLarge ? 413 : 400).json({ error: tooLarge
    ? { code: "TEMPLATE_FILE_TOO_LARGE", message: "template file is too large" }
    : { code: "TEMPLATE_FILE_INVALID", message: "template file is not a valid template document" } });
}

export function registerNodeTemplateRoutes(app: Express, ctx?: Pick<RuntimeContext, "config">): void {
  const limits: TemplateFileLimits = templateFileLimits(ctx?.config.limits ?? {});

  app.post("/api/node-templates/import", async (req: Request, res: Response) => {
    try {
      const file = parseTemplateFile(req.body, limits);
      const existing = (await nodeTemplateStore.list()).map((template) => template.name);
      // Only the parsed fields: a file can never pass stripOptions or a thumbnail.
      const template = await nodeTemplateStore.create({
        name: uniqueTemplateName(file.name, existing),
        description: file.description,
        tags: file.tags,
        graph: file.graph,
      });
      res.status(201).json({ template: toSummary(template) });
    } catch (error) {
      sendImportError(res, error);
    }
  });

  app.get("/api/node-templates/:id/export", async (req: Request<IdParams>, res: Response) => {
    try {
      const template = await nodeTemplateStore.get(req.params.id);
      if (!template) {
        res.status(404).json({ error: { code: "TEMPLATE_NOT_FOUND", message: "template not found" } });
        return;
      }
      res.attachment(templateFileName(template.name));
      res.json(buildTemplateFile(template));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/node-templates", async (_req: Request, res: Response) => {
    try {
      const templates = await nodeTemplateStore.list();
      res.json({ templates: templates.map(toSummary) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/node-templates", async (req: Request, res: Response) => {
    try {
      const template = await nodeTemplateStore.create(req.body ?? {});
      res.status(201).json({ template: toSummary(template) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/node-templates/:id/instantiate", async (req: Request<IdParams>, res: Response) => {
    try {
      const graph = await nodeTemplateStore.instantiate(req.params.id);
      res.json({ graph });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/node-templates/:id", async (req: Request<IdParams>, res: Response) => {
    try {
      const template = await nodeTemplateStore.update(req.params.id, req.body ?? {});
      res.json({ template: toSummary(template) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/node-templates/:id", async (req: Request<IdParams>, res: Response) => {
    try {
      await nodeTemplateStore.remove(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });
}
