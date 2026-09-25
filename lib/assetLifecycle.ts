import { thrownFields, type CodedError } from "./errInfo.js";
import { getDb } from "./db.js";
import { mkdir, rename, unlink, lstat, realpath } from "fs/promises";
import { basename, dirname, join, resolve, sep } from "path";
import { moveToSystemTrash } from "./systemTrash.js";
import { config } from "../config.js";

export function resolveInGenerated(rootDir: string, relPath: string): string {
  void rootDir;
  if (typeof relPath !== "string" || relPath.length === 0) {
    const err: CodedError = new Error("filename required");
    err.status = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  if (relPath.includes("\0")) {
    const err: CodedError = new Error("invalid filename");
    err.status = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  const baseDir = resolve(config.storage.generatedDir);
  const target = resolve(baseDir, relPath);
  const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
  if (target === baseDir || !target.startsWith(prefix)) {
    const err: CodedError = new Error("filename escapes generated/");
    err.status = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  return target;
}

export async function assertRegularGeneratedPath(path: string): Promise<void> {
  await regularFileWithin(path, config.storage.generatedDir);
}

/** Existing assets only; output filenames use the separate lexical resolver. */
async function regularFileWithin(path: string, root: string): Promise<string> {
  const baseDir = await realpath(resolve(root));
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    const err: CodedError = new Error("symbolic links are not valid assets");
    err.status = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  if (!stat.isFile()) {
    throw Object.assign(new Error("only regular files are valid assets"), { status: 400, code: "INVALID_FILENAME" });
  }
  const canonical = await realpath(path);
  const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
  if (canonical === baseDir || !canonical.startsWith(prefix)) {
    const err: CodedError = new Error("filename escapes generated/");
    err.status = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  return canonical;
}

function nodesReferencingFilename(filename: string): Array<{ sessionId: string; id: string; data: string }> {
  // The client stores imageUrl as `/generated/<encoded filename>` in node data JSON.
  // We scan all sessions' nodes for substring match on the decoded and encoded forms.
  const db = getDb();
  const encoded = encodeURIComponent(filename);
  const rows = db
    .prepare("SELECT session_id AS sessionId, id, data FROM nodes WHERE data LIKE ? OR data LIKE ?")
    .all(`%${filename}%`, `%${encoded}%`) as Array<{ sessionId: string; id: string; data: string }>;
  return rows;
}

function markNodesAssetMissing(filename: string) {
  const db = getDb();
  const rows = nodesReferencingFilename(filename);
  if (rows.length === 0) return { sessionsTouched: 0, nodesTouched: 0 };
  const touchedSessions = new Set<string>();
  const update = db.prepare("UPDATE nodes SET data = ? WHERE session_id = ? AND id = ?");
  const bumpSession = db.prepare("UPDATE sessions SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const r of rows) {
      let data;
      try { data = JSON.parse(r.data); } catch { data = {}; }
      const imgRef = data?.imageUrl || "";
      if (imgRef.includes(filename) || imgRef.includes(encodeURIComponent(filename))) {
        data.imageUrl = null;
        data.status = "asset-missing";
        update.run(JSON.stringify(data), r.sessionId, r.id);
        touchedSessions.add(r.sessionId);
      }
    }
    const t = Date.now();
    for (const sid of touchedSessions) bumpSession.run(t, sid);
  });
  tx();
  return { sessionsTouched: touchedSessions.size, nodesTouched: rows.length };
}

export async function trashAsset(rootDir: string, filename: string) {
  const src = resolveInGenerated(rootDir, filename);
  try {
    await assertRegularGeneratedPath(src);
  } catch (cause: unknown) {
    const causeFields = thrownFields(cause);
    if (causeFields.code !== "ENOENT") throw cause;
    const err: CodedError = new Error("Asset not found");
    err.status = 404;
    err.code = "ASSET_NOT_FOUND";
    throw err;
  }

  const sidecar = `${src}.json`;
  const paths = [src];
  try {
    await assertRegularGeneratedPath(sidecar);
    paths.push(sidecar);
  } catch (err: unknown) {
    const errFields = thrownFields(err);
    if (errFields.code !== "ENOENT") throw err;
  }

  let trashMethod: "system" | "internal" = "system";
  try {
    await moveToSystemTrash(paths);
  } catch {
    trashMethod = "internal";
    const trashDir = resolve(config.storage.trashDir);
    await mkdir(trashDir, { recursive: true });
    const trashId = `${Date.now()}_${basename(src)}`;
    for (const p of paths) {
      const dest = resolve(trashDir, p.endsWith(".json") ? `${trashId}.json` : trashId);
      await rename(p, dest);
    }
  }

  const summary = markNodesAssetMissing(filename);
  return {
    ok: true,
    filename,
    trash: trashMethod,
    undoableInApp: false,
    sessionsTouched: summary.sessionsTouched,
    nodesTouched: summary.nodesTouched,
  };
}

export async function deleteAssetPermanent(rootDir: string, filename: string) {
  const src = resolveInGenerated(rootDir, filename);
  try {
    await assertRegularGeneratedPath(src);
  } catch (cause: unknown) {
    const causeFields = thrownFields(cause);
    if (causeFields.code !== "ENOENT") throw cause;
    const err: CodedError = new Error("Asset not found");
    err.status = 404;
    err.code = "ASSET_NOT_FOUND";
    throw err;
  }
  await unlink(src);
  const sidecar = src + ".json";
  try {
    await assertRegularGeneratedPath(sidecar);
    await unlink(sidecar);
  } catch (err: unknown) {
    const errFields = thrownFields(err);
    if (errFields.code !== "ENOENT") throw err;
  }
  const summary = markNodesAssetMissing(filename);
  return {
    ok: true,
    filename,
    sessionsTouched: summary.sessionsTouched,
    nodesTouched: summary.nodesTouched,
  };
}

export async function restoreAsset(rootDir: string, trashId: string, originalFilename: string) {
  const trashDir = resolve(config.storage.trashDir);
  const src = resolve(trashDir, trashId);
  const prefix = trashDir.endsWith(sep) ? trashDir : trashDir + sep;
  if (src === trashDir || !src.startsWith(prefix)) {
    const err: CodedError = new Error("invalid trashId");
    err.status = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  const canonicalSrc = await regularFileWithin(src, trashDir);
  let canonicalSidecar: string | undefined;
  try { canonicalSidecar = await regularFileWithin(`${src}.json`, trashDir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const dst = resolveInGenerated(rootDir, originalFilename);
  const generatedRoot = await realpath(config.storage.generatedDir);
  const parent = await realpath(dirname(dst));
  const generatedPrefix = generatedRoot.endsWith(sep) ? generatedRoot : generatedRoot + sep;
  if (parent !== generatedRoot && !parent.startsWith(generatedPrefix)) {
    throw Object.assign(new Error("restore destination escapes generated/"), { status: 400, code: "INVALID_FILENAME" });
  }
  const canonicalDst = join(parent, basename(dst));
  await rename(canonicalSrc, canonicalDst);
  if (canonicalSidecar) await rename(canonicalSidecar, `${canonicalDst}.json`);
  return { ok: true };
}
