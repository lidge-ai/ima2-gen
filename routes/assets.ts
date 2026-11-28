import type { Express, Request, Response } from "express";
import { randomBytes } from "crypto";
import { existsSync, lstatSync } from "fs";
import { copyFile, mkdir, unlink } from "fs/promises";
import { extname, join } from "path";
import { config } from "../config.js";
import { errInfo } from "../lib/errInfo.js";
import { logEvent } from "../lib/logger.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";
import { assertRegularGeneratedPath, resolveInGenerated } from "../lib/assetLifecycle.js";
import {
  assertAssetKind,
  canonicalizeStoredPath,
  createAsset,
  deleteAsset,
  deleteFolder,
  elementRefInUse,
  createFolder,
  getAsset,
  listAssets,
  listFolders,
  listTags,
  updateAsset,
  updateFolder,
  clearAllAssets,
} from "../lib/assetsStore.js";

import { resolveMediaRefPath } from "../lib/providers/media/inputs.js";

type IdParams = { id: string };

function httpError(status: number, code: string, message: string): Error {
  const err = new Error(message) as Error & { status: number; code: string };
  err.status = status;
  err.code = code;
 return err;
}

function sendError(res: Response, e: unknown) {
  const status =
    typeof (e as { status?: unknown })?.status === "number"
      ? (e as { status: number }).status
      : 500;
  const code =
    status !== 500 && typeof (e as { code?: unknown })?.code === "string"
      ? (e as { code: string }).code
      : "DB_ERROR";
 res.status(status).json({ error: { code, message: errInfo(e).message } });
}

function queryStr(value: unknown): string | undefined {
 return typeof value === "string" && value !== "" ? value : undefined;
}

function validateElementMetadata(metadata: unknown, notes: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw httpError(400, "INVALID_ELEMENT_METADATA", "element metadata required");
  }
  const element = metadata as { elementKind?: unknown; refs?: unknown; notes?: unknown };
  if (typeof element.elementKind !== "string" || !element.elementKind.trim()) {
    throw httpError(400, "INVALID_ELEMENT_KIND", "elementKind required for element assets");
  }
  if (!Array.isArray(element.refs) || element.refs.length < 1 || element.refs.length > 6 ||
    element.refs.some((ref) => typeof ref !== "string" || !ref.trim())) {
    throw httpError(400, "INVALID_ELEMENT_REFS", "element refs must contain 1-6 paths");
  }
  const elementNotes = notes ?? element.notes;
  if (typeof elementNotes === "string" && elementNotes.length > 800) {
    throw httpError(400, "INVALID_ELEMENT_NOTES", "element notes must be at most 800 characters");
  }
}

async function resolveValidatedFilePath(kind: string, raw: unknown): Promise<string | null> {
  const rel = typeof raw === "string" ? raw.trim() : "";
  if (!rel) {
    if (kind === "image" || kind === "video") {
      throw httpError(400, "INVALID_FILENAME", "filePath required for image/video assets");
    }
    return null;
  }
  const abs = resolveInGenerated(config.storage.generatedDir, rel);
  if (!existsSync(abs) || !lstatSync(abs).isFile()) {
    throw httpError(400, "INVALID_FILENAME", "file does not exist in generated storage");
  }
  await assertRegularGeneratedPath(abs);
 return rel;
}

/** Checks the refs an element is about to be given. Refs it already holds are left alone: their files may be gone by now. */
async function validateElementRefs(metadata: unknown, stored: readonly unknown[] = []): Promise<void> {
  const refs = (metadata as { refs?: unknown } | null)?.refs;
  if (!Array.isArray(refs)) return;
  for (const ref of refs) if (!stored.includes(ref)) await resolveValidatedFilePath("element", ref);
}

/**
 * Copies an uploaded image (the "input:<id>" ref from POST /api/media/inputs) into the generated files, so an
 * element can point at it like at any result. Returns the path relative to the generated directory.
 */
async function importElementInput(inputRef: unknown): Promise<string> {
  const refused = (message: string) => httpError(400, "INVALID_ELEMENT_REFS", message);
  if (typeof inputRef !== "string" || !inputRef.trim()) throw refused("inputRef must be an upload ref");
  let source: { path?: string; mimeType: string };
  try {
    source = resolveMediaRefPath({ ref: inputRef.trim() }, { generatedDir: config.storage.generatedDir, inputsDir: join(config.storage.configDir, "media-inputs") }, "inputRef");
  } catch {
    throw refused("inputRef is not an upload this server holds");
  }
  if (!source.path || !existsSync(source.path)) throw refused("inputRef is not an upload this server holds");
  if (!source.mimeType.startsWith("image/")) throw refused("an element is made from an image");
  const dir = resolveInGenerated(config.storage.generatedDir, config.storage.elementsDirName);
  await mkdir(dir, { recursive: true });
  const rel = config.storage.elementsDirName + "/" + randomBytes(12).toString("hex") + extname(source.path).toLowerCase();
  await copyFile(source.path, resolveInGenerated(config.storage.generatedDir, rel));
  return rel;
}

/**
 * After an element is deleted: removes the upload copies it pointed at that no other element uses. Only a file
 * directly inside the elements folder qualifies, so a result an element pointed at is never touched.
 */
async function removeUnusedElementFiles(refs: unknown): Promise<void> {
  if (!Array.isArray(refs)) return;
  const dir = config.storage.elementsDirName;
  for (const ref of new Set(refs)) {
    if (typeof ref !== "string" || !ref.startsWith(dir + "/")) continue;
    const name = ref.slice(dir.length + 1);
    if (!name || name === "." || name === ".." || /[\\/]/.test(name)) continue;
    if (elementRefInUse(ref)) continue;
    const abs = resolveInGenerated(config.storage.generatedDir, ref);
    try {
      if (!lstatSync(abs).isFile()) continue;
      await unlink(abs);
      logEvent("assets", "element-file-remove", { file: ref });
    } catch (e) {
      if ((e as { code?: unknown })?.code !== "ENOENT") logEvent("assets", "element-file-remove-failed", { file: ref, message: errInfo(e).message });
    }
  }
}

export function registerAssetsRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  requireRuntimeContext(ctxRaw);

  app.get("/api/assets/folders", (_req: Request, res: Response) => {
    try {
      res.json({ folders: listFolders() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/assets/folders", (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { name?: unknown; parentId?: unknown };
      const folder = createFolder({ name: body.name, parentId: body.parentId });
      logEvent("assets", "folder-create", { folderId: folder.id });
      res.status(201).json({ folder });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.patch("/api/assets/folders/:id", (req: Request<IdParams>, res: Response) => {
    try {
      const body = (req.body ?? {}) as { name?: unknown; parentId?: unknown };
      const folder = updateFolder(req.params.id, body);
      if (!folder) {
        return res
          .status(404)
          .json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } });
      }
      res.json({ folder });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete("/api/assets/folders/:id", (req: Request<IdParams>, res: Response) => {
    try {
      const ok = deleteFolder(req.params.id);
      if (!ok) {
        return res
          .status(404)
          .json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } });
      }
      logEvent("assets", "folder-delete", { folderId: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/assets/tags", (_req: Request, res: Response) => {
    try {
      res.json({ tags: listTags() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/assets", (req: Request, res: Response) => {
    try {
      const limitRaw = queryStr(req.query.limit);
      const filePath = queryStr(req.query.filePath);
      const result = listAssets({
        kind: queryStr(req.query.kind),
        elementKind: queryStr(req.query.elementKind),
        filePath: filePath === undefined ? undefined : canonicalizeStoredPath(filePath) ?? "",
        folderId: queryStr(req.query.folderId),
        tag: queryStr(req.query.tag),
        q: queryStr(req.query.q),
        cursor: queryStr(req.query.cursor),
        limit: limitRaw ? Number(limitRaw) : undefined,
      });
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/assets/:id", (req: Request<IdParams>, res: Response) => {
    try {
      const asset = getAsset(req.params.id);
      if (!asset) {
        return res
          .status(404)
          .json({ error: { code: "ASSET_NOT_FOUND", message: "Asset not found" } });
      }
      res.json({ asset });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/assets/promote-element", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        result?: { path?: unknown; filePath?: unknown };
        path?: unknown;
        filePath?: unknown;
        elementKind?: unknown;
        name?: unknown;
        notes?: unknown;
        folderId?: unknown;
        tags?: unknown;
        sourceAssetId?: unknown;
        /** An uploaded image instead of a result: "input:<id>" from POST /api/media/inputs. */
        inputRef?: unknown;
      };
      const resultPath = body.result?.path ?? body.result?.filePath ?? body.path ?? body.filePath;
      if (body.inputRef !== undefined && (resultPath !== undefined || body.sourceAssetId !== undefined)) {
        throw httpError(400, "INVALID_ELEMENT_REFS", "give an uploaded image or a result, not both");
      }
      const ref = body.inputRef !== undefined ? await importElementInput(body.inputRef) : await resolveValidatedFilePath("element", resultPath);
      if (!ref) throw httpError(400, "INVALID_ELEMENT_REFS", "gallery result path required");
      const sourceAssetId = typeof body.sourceAssetId === "string" && body.sourceAssetId.trim()
        ? body.sourceAssetId.trim()
        : null;
      const source = sourceAssetId ? getAsset(sourceAssetId) : null;
      if (sourceAssetId && !source) {
        throw httpError(404, "SOURCE_ASSET_NOT_FOUND", "source asset not found");
      }
      const canonicalRef = canonicalizeStoredPath(ref);
      if (source && ((source.kind !== "image" && source.kind !== "video") || source.filePath !== canonicalRef)) {
        throw httpError(400, "INVALID_ELEMENT_SOURCE", "source asset does not own the promoted file");
      }
      const sourceTag = source ? `element-source:${source.id}` : null;
      const existing = sourceTag
        ? listAssets({ kind: "element", tag: sourceTag, limit: 1 }).assets[0]
        : null;
      if (existing) return res.status(200).json({ asset: existing });
      const elementKind = typeof body.elementKind === "string" && body.elementKind.trim()
        ? body.elementKind.trim()
        : "character";
      const fallbackName = source?.name || ref.split("/").at(-1) || "Element";
      const name = (typeof body.name === "string" && body.name.trim() ? body.name.trim() : fallbackName).slice(0, 80);
      const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined;
      const metadata = {
        elementKind,
        name,
        refs: [ref],
        ...(source ? { sourceAssetId: source.id } : {}),
        ...(notes ? { notes } : {}),
      };
      validateElementMetadata(metadata, body.notes);
      const tags = [
        ...(Array.isArray(body.tags) ? body.tags : []),
        ...(sourceTag ? [sourceTag] : []),
      ];
      const asset = createAsset({
        kind: "element",
        name,
        folderId: body.folderId,
        notes: body.notes,
        metadata,
        tags,
      });
      logEvent("assets", "promote-element", { assetId: asset.id });
      res.status(201).json({ asset });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/assets", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        kind?: unknown;
        name?: unknown;
        filePath?: unknown;
        folderId?: unknown;
        notes?: unknown;
        metadata?: unknown;
        tags?: unknown;
      };
      const kind = assertAssetKind(body.kind);
      if (kind === "element") {
        validateElementMetadata(body.metadata, body.notes);
        await validateElementRefs(body.metadata);
      }
      const filePath = await resolveValidatedFilePath(kind, body.filePath);
      const asset = createAsset({
        kind,
        name: body.name,
        filePath,
        folderId: body.folderId,
        notes: body.notes,
        metadata: body.metadata,
        tags: body.tags,
      });
      logEvent("assets", "create", { assetId: asset.id, kind: asset.kind });
      res.status(201).json({ asset });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.patch("/api/assets/:id", async (req: Request<IdParams>, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        name?: unknown;
        folderId?: unknown;
        notes?: unknown;
        tags?: unknown;
        metadata?: unknown;
      };
      const existing = getAsset(req.params.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: { code: "ASSET_NOT_FOUND", message: "Asset not found" } });
      }
      if (existing.kind === "element") {
        validateElementMetadata(body.metadata ?? existing.metadata, body.notes ?? existing.notes);
        const stored = (existing.metadata as { refs?: unknown } | null)?.refs;
        if (body.metadata !== undefined) await validateElementRefs(body.metadata, Array.isArray(stored) ? stored : []);
      }
      const asset = updateAsset(req.params.id, body);
      res.json({ asset });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/assets/:id/test-sheet", (req: Request<IdParams>, res: Response) => {
    try {
      const asset = getAsset(req.params.id);
      if (!asset) {
        return res
          .status(404)
          .json({ error: { code: "ASSET_NOT_FOUND", message: "Asset not found" } });
      }
      if (asset.kind !== "element") {
        return res
          .status(400)
          .json({ error: { code: "INVALID_ASSET_KIND", message: "Test sheets require an element asset" } });
      }
      res.status(501).json({
        error: {
          code: "TEST_SHEET_NOT_IMPLEMENTED",
          message: "Element test-sheet generation requires multimode service extraction",
        },
      });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete("/api/assets/:id", async (req: Request<IdParams>, res: Response) => {
    try {
      const existing = getAsset(req.params.id);
      const ok = deleteAsset(req.params.id);
      if (!ok) {
        return res
          .status(404)
          .json({ error: { code: "ASSET_NOT_FOUND", message: "Asset not found" } });
      }
      if (existing?.kind === "element") await removeUnusedElementFiles((existing.metadata as { refs?: unknown } | null)?.refs);
      logEvent("assets", "delete", { assetId: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
 });

  app.delete("/api/assets/all", (_req: Request, res: Response) => {
    try {
      const count = clearAllAssets();
      logEvent("assets", "clear_all", { deletedCount: count });
      res.json({ ok: true, deletedCount: count });
    } catch (e) {
      sendError(res, e);
    }
  });
}
