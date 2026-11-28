import { ulid } from "ulid";
import { isAbsolute, relative, resolve, sep } from "path";
import { config } from "../config.js";
import { getDb } from "./db.js";
import { assertCharacterBindings, assertRefsPreservedForBindings } from "./characterBindings.js";

export const ASSET_KINDS = ["image", "video", "element", "preset", "template"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ELEMENT_KINDS = ["character", "product", "style", "scene"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export {
  CHARACTER_BINDING_MODES,
  CHARACTER_BINDING_PROVIDERS,
  bindingDrift,
  bindingsOf,
} from "./characterBindings.js";
export type {
  CharacterBindingMode,
  CharacterBindingProvider,
  CharacterBindingStatus,
  CharacterProviderBinding,
} from "./characterBindings.js";

export type AssetRecord = {
  id: string;
  kind: AssetKind;
  name: string;
  filePath: string | null;
  folderId: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type AssetFolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ListAssetsQuery = {
  kind?: string | undefined;
  elementKind?: unknown | undefined;
  filePath?: string | undefined;
  folderId?: string | undefined;
  tag?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type ListElementsQuery = Omit<ListAssetsQuery, "kind">;

const MAX_NAME = 200;
const MAX_NOTES = 10_000;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 64;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function storeError(status: number, code: string, message: string): Error {
  const err = new Error(message) as Error & { status: number; code: string };
  err.status = status;
  err.code = code;
  return err;
}

function now() {
  return Date.now();
}

function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === "string" && (ASSET_KINDS as readonly string[]).includes(value);
}

export function assertAssetKind(value: unknown): AssetKind {
  if (!isAssetKind(value)) {
    throw storeError(400, "INVALID_ASSET_KIND", `kind must be one of ${ASSET_KINDS.join("|")}`);
  }
  return value;
}

function normalizeName(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return (raw || fallback).slice(0, MAX_NAME);
}

function normalizeNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTES) : null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen].sort();
}

/** Canonicalize stored paths: absolute paths inside generatedDir become relative. */
export function canonicalizeStoredPath(value: unknown): string | null {
  const raw = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!raw || !isAbsolute(raw)) return raw;
  const base = resolve(config.storage.generatedDir);
  const abs = resolve(raw);
  if (abs !== base && abs.startsWith(base + sep)) return relative(base, abs);
  return raw;
}

function serializeMetadata(value: unknown): string | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function assertElementMetadata(value: unknown) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw storeError(400, "INVALID_ELEMENT_METADATA", "element metadata is required");
  }
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.elementKind !== "string" ||
    !(ELEMENT_KINDS as readonly string[]).includes(metadata.elementKind)
  ) {
    throw storeError(
      400,
      "INVALID_ELEMENT_METADATA",
      `elementKind must be one of ${ELEMENT_KINDS.join("|")}`,
    );
  }
  if (typeof metadata.name !== "string" || metadata.name.length < 1 || metadata.name.length > 80) {
    throw storeError(400, "INVALID_ELEMENT_METADATA", "element name must be 1-80 characters");
  }
  if (
    !Array.isArray(metadata.refs) ||
    metadata.refs.length < 1 ||
    metadata.refs.length > 6 ||
    metadata.refs.some((ref) => typeof ref !== "string")
  ) {
    throw storeError(400, "INVALID_ELEMENT_METADATA", "element refs must be an array of 1-6 file paths");
  }
  if (metadata.notes !== undefined && (typeof metadata.notes !== "string" || metadata.notes.length > 800)) {
    throw storeError(400, "INVALID_ELEMENT_METADATA", "element notes must be at most 800 characters");
  }
  if (
    metadata.defaultStrength !== undefined &&
    (typeof metadata.defaultStrength !== "number" ||
      !Number.isFinite(metadata.defaultStrength) ||
      metadata.defaultStrength < 0 ||
      metadata.defaultStrength > 1)
  ) {
    throw storeError(400, "INVALID_ELEMENT_METADATA", "element defaultStrength must be a number from 0 to 1");
  }
  if (metadata.characterBindings !== undefined) {
    assertCharacterBindings(metadata.characterBindings, metadata.elementKind as ElementKind);
  }
}

function assertElementKind(value: unknown): ElementKind {
  if (typeof value !== "string" || !(ELEMENT_KINDS as readonly string[]).includes(value)) {
    throw storeError(400, "INVALID_ELEMENT_KIND", `elementKind must be one of ${ELEMENT_KINDS.join("|")}`);
  }
  return value as ElementKind;
}

type AssetRow = {
  id: string;
  kind: AssetKind;
  name: string;
  filePath: string | null;
  folderId: string | null;
  notes: string | null;
  metadata: string | null;
  createdAt: number;
  updatedAt: number;
};

const ASSET_SELECT =
  "SELECT id, kind, name, file_path AS filePath, folder_id AS folderId, notes, metadata, created_at AS createdAt, updated_at AS updatedAt FROM assets";

function tagsFor(assetId: string): string[] {
  return (getDb()
    .prepare("SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag")
    .all(assetId) as Array<{ tag: string }>).map((row) => row.tag);
}

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    filePath: row.filePath ?? null,
    folderId: row.folderId ?? null,
    notes: row.notes ?? null,
    metadata: parseMetadata(row.metadata),
    tags: tagsFor(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function folderExists(id: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM asset_folders WHERE id = ?").get(id));
}

function requireFolder(folderId: unknown): string | null {
  if (folderId == null) return null;
  if (typeof folderId !== "string" || !folderId.trim()) {
    throw storeError(400, "INVALID_FOLDER", "folderId must be a folder id string");
  }
  if (!folderExists(folderId)) {
    throw storeError(400, "INVALID_FOLDER", `folder not found: ${folderId}`);
  }
  return folderId;
}

function replaceTags(assetId: string, tags: string[]) {
  const db = getDb();
  db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);
  const insert = db.prepare("INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)");
  for (const tag of tags) insert.run(assetId, tag);
}

export function createAsset(input: {
  kind: unknown;
  name?: unknown | undefined;
  filePath?: unknown | undefined;
  folderId?: unknown | undefined;
  notes?: unknown | undefined;
  metadata?: unknown | undefined;
  tags?: unknown | undefined;
}): AssetRecord {
  const kind = assertAssetKind(input.kind);
  const filePath = canonicalizeStoredPath(input.filePath);
  const folderId = requireFolder(input.folderId);
  const name = normalizeName(input.name, filePath ?? "Untitled");
  const notes = normalizeNotes(input.notes);
  const metadata = serializeMetadata(input.metadata);
  if (kind === "element") assertElementMetadata(parseMetadata(metadata));
  const tags = normalizeTags(input.tags);
  const id = "a_" + ulid();
  const t = now();
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      "INSERT INTO assets (id, kind, name, file_path, folder_id, notes, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, kind, name, filePath, folderId, notes, metadata, t, t);
    replaceTags(id, tags);
  });
  run();
  return {
    id,
    kind,
    name,
    filePath,
    folderId,
    notes,
    metadata: parseMetadata(metadata),
    tags,
    createdAt: t,
    updatedAt: t,
  };
}

export function getAsset(id: string): AssetRecord | null {
  const row = getDb().prepare(`${ASSET_SELECT} WHERE id = ?`).get(id) as AssetRow | undefined;
  return row ? toRecord(row) : null;
}

export function getElementById(id: string): AssetRecord | null {
  const row = getDb()
    .prepare(`${ASSET_SELECT} WHERE id = ? AND kind = 'element'`)
    .get(id) as AssetRow | undefined;
  return row ? toRecord(row) : null;
}

function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  let decoded = "";
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw storeError(400, "INVALID_CURSOR", "cursor is not valid");
  }
  const sep = decoded.indexOf(":");
  const createdAt = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep <= 0 || !Number.isFinite(createdAt) || !id) {
    throw storeError(400, "INVALID_CURSOR", "cursor is not valid");
  }
  return { createdAt, id };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function listAssets(query: ListAssetsQuery = {}): {
  assets: AssetRecord[];
  nextCursor: string | null;
} {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.kind != null && query.kind !== "") {
    where.push("kind = ?");
    params.push(assertAssetKind(query.kind));
  }
  if (query.elementKind !== undefined) {
    where.push("json_valid(metadata) AND json_extract(metadata, '$.elementKind') = ?");
    params.push(assertElementKind(query.elementKind));
  }
  if (query.filePath !== undefined) {
    where.push("file_path = ?");
    params.push(query.filePath);
  }
  if (query.folderId != null && query.folderId !== "") {
    where.push("folder_id = ?");
    params.push(query.folderId);
  }
  if (query.tag != null && query.tag !== "") {
    where.push("EXISTS (SELECT 1 FROM asset_tags WHERE asset_tags.asset_id = assets.id AND asset_tags.tag = ?)");
    params.push(query.tag);
  }
  if (query.q != null && query.q.trim() !== "") {
    const like = `%${escapeLike(query.q.trim())}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR IFNULL(notes, '') LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (query.cursor) {
    const { createdAt, id } = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(createdAt, createdAt, id);
  }
  const limitRaw = Number(query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const sql = `${ASSET_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const rows = getDb().prepare(sql).all(...params, limit + 1) as AssetRow[];
  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && page.length > 0
      ? encodeCursor(page[page.length - 1]?.createdAt ?? 0, page[page.length - 1]?.id ?? "")
      : null;
  return { assets: page.map(toRecord), nextCursor };
}

export function listElements(query: ListElementsQuery = {}): {
  assets: AssetRecord[];
  nextCursor: string | null;
} {
  return listAssets({ ...query, kind: "element" });
}

export function updateAsset(
  id: string,
  patch: {
    name?: unknown | undefined;
    folderId?: unknown | undefined;
    notes?: unknown | undefined;
    tags?: unknown | undefined;
    metadata?: unknown | undefined;
  },
): AssetRecord | null {
  const db = getDb();
  const existing = getAsset(id);
  if (!existing) return null;
  const name =
    patch.name === undefined ? existing.name : normalizeName(patch.name, existing.name);
  let folderId = existing.folderId;
  if (patch.folderId !== undefined) {
    folderId = patch.folderId === null ? null : requireFolder(patch.folderId);
  }
  const notes = patch.notes === undefined ? existing.notes : normalizeNotes(patch.notes);
  const metadata =
    patch.metadata === undefined
      ? serializeMetadata(existing.metadata)
      : serializeMetadata(patch.metadata);
  if (existing.kind === "element") {
    const parsed = parseMetadata(metadata);
    assertElementMetadata(parsed);
    assertRefsPreservedForBindings(existing.metadata, parsed);
  }
  const tags = patch.tags === undefined ? existing.tags : normalizeTags(patch.tags);
  const t = now();
  const run = db.transaction(() => {
    db.prepare(
      "UPDATE assets SET name = ?, folder_id = ?, notes = ?, metadata = ?, updated_at = ? WHERE id = ?",
    ).run(name, folderId, notes, metadata, t, id);
    if (patch.tags !== undefined) replaceTags(id, tags);
  });
  run();
  return getAsset(id);
}

export function deleteAsset(id: string): boolean {
  const res = getDb().prepare("DELETE FROM assets WHERE id = ?").run(id);
  return res.changes > 0;
}

/** Whether any element still lists this path among its refs (compared as stored). */
export function elementRefInUse(ref: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 AS used FROM assets WHERE kind = 'element' AND json_valid(metadata) AND json_type(metadata, '$.refs') = 'array' " +
        "AND EXISTS (SELECT 1 FROM json_each(metadata, '$.refs') WHERE value = ?) LIMIT 1",
    )
    .get(ref);
  return row !== undefined;
}

const FOLDER_SELECT =
  "SELECT id, name, parent_id AS parentId, created_at AS createdAt, updated_at AS updatedAt FROM asset_folders";

export function listFolders(): AssetFolderRecord[] {
  return getDb().prepare(`${FOLDER_SELECT} ORDER BY name COLLATE NOCASE`).all() as AssetFolderRecord[];
}

function requireParent(parentId: unknown): string | null {
  if (parentId == null) return null;
  if (typeof parentId !== "string" || !parentId.trim() || !folderExists(parentId)) {
    throw storeError(400, "INVALID_PARENT", "parent folder not found");
  }
  return parentId;
}

export function createFolder(input: { name: unknown; parentId?: unknown }): AssetFolderRecord {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, MAX_NAME) : "";
  if (!name) throw storeError(400, "INVALID_NAME", "folder name required");
  const parentId = requireParent(input.parentId);
  const id = "af_" + ulid();
  const t = now();
  getDb()
    .prepare(
      "INSERT INTO asset_folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, name, parentId, t, t);
  return { id, name, parentId, createdAt: t, updatedAt: t };
}

function getFolder(id: string): AssetFolderRecord | null {
  const row = getDb().prepare(`${FOLDER_SELECT} WHERE id = ?`).get(id) as
    | AssetFolderRecord
    | undefined;
  return row ?? null;
}

function assertNoCycle(folderId: string, newParentId: string) {
  let current: string | null = newParentId;
  let hops = 0;
  while (current) {
    if (current === folderId) {
      throw storeError(409, "FOLDER_CYCLE", "folder cannot move under itself or its descendants");
    }
    const parent = getDb()
      .prepare("SELECT parent_id AS parentId FROM asset_folders WHERE id = ?")
      .get(current) as { parentId: string | null } | undefined;
    current = parent?.parentId ?? null;
    hops += 1;
    if (hops > 100) break;
  }
}

export function updateFolder(
  id: string,
  patch: { name?: unknown; parentId?: unknown },
): AssetFolderRecord | null {
  const existing = getFolder(id);
  if (!existing) return null;
  let name = existing.name;
  if (patch.name !== undefined) {
    name = typeof patch.name === "string" ? patch.name.trim().slice(0, MAX_NAME) : "";
    if (!name) throw storeError(400, "INVALID_NAME", "folder name required");
  }
  let parentId = existing.parentId;
  if (patch.parentId !== undefined) {
    parentId = patch.parentId === null ? null : requireParent(patch.parentId);
    if (parentId) assertNoCycle(id, parentId);
  }
  getDb()
    .prepare("UPDATE asset_folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?")
    .run(name, parentId, now(), id);
  return getFolder(id);
}

export function deleteFolder(id: string): boolean {
  const db = getDb();
  const existing = getFolder(id);
  if (!existing) return false;
  const childFolders = (db
    .prepare("SELECT COUNT(*) AS c FROM asset_folders WHERE parent_id = ?")
    .get(id) as { c: number }).c;
  const childAssets = (db
    .prepare("SELECT COUNT(*) AS c FROM assets WHERE folder_id = ?")
    .get(id) as { c: number }).c;
  if (childFolders > 0 || childAssets > 0) {
    throw storeError(409, "FOLDER_NOT_EMPTY", "folder still contains assets or subfolders");
  }
  return db.prepare("DELETE FROM asset_folders WHERE id = ?").run(id).changes > 0;
}

export function listTags(): string[] {
  return (getDb()
    .prepare("SELECT DISTINCT tag FROM asset_tags ORDER BY tag")
    .all() as Array<{ tag: string }>).map((row) => row.tag);
}

export function clearAllAssets(): number {
  const db = getDb();
  db.prepare("DELETE FROM asset_tags").run();
  const res = db.prepare("DELETE FROM assets").run();
  return res.changes;
}
