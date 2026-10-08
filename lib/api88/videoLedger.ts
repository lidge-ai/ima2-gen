import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RuntimeContext } from "../runtimeContext.js";
import { api88Error } from "./errors.js";
import { api88Origin } from "./origin.js";

export type Api88VideoTaskPhase = "submitting" | "submitted" | "completed" | "failed" | "uncertain";
export interface Api88VideoTaskEntry {
  requestId: string; phase: Api88VideoTaskPhase; taskId?: string;
  model: string; origin: string; createdAt: number; updatedAt: number; error?: string;
}
type Context = Pick<RuntimeContext, "config">;
interface Index {
  requests: Map<string, Api88VideoTaskEntry>;
  tasks: Map<string, Api88VideoTaskEntry>;
}
const RECENT_LINES = 2000;
const CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 16 * 1024;
const indexes = new Map<string, Index>();
const locks = new Map<string, Promise<unknown>>();
const reservations = new Set<string>();

export function api88VideoLedgerPath(ctx: Context): string {
  return resolve(join(ctx.config.storage.configDir, "88api-video-tasks.jsonl"));
}
function remember(index: Index, row: Api88VideoTaskEntry): void {
  index.requests.set(row.requestId, row);
  if (row.taskId) index.tasks.set(row.taskId, row);
}
function parse(line: string): Api88VideoTaskEntry {
  const row = JSON.parse(line) as Api88VideoTaskEntry;
  if (!row || typeof row.requestId !== "string" || typeof row.model !== "string"
    || typeof row.origin !== "string" || !Number.isFinite(row.createdAt) || !Number.isFinite(row.updatedAt)
    || !["submitting", "submitted", "completed", "failed", "uncertain"].includes(row.phase)
    || (row.taskId !== undefined && typeof row.taskId !== "string")) throw new Error("Invalid task ledger row");
  // Whitelist fields even when loading an existing file.
  return { requestId: row.requestId, phase: row.phase, model: row.model, origin: row.origin,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    ...(typeof row.error === "string" && /^(API88_|GENERATION_CANCELED$|JOB_TRACKING_TIMEOUT$)[A-Z0-9_]*$/.test(row.error)
      ? { error: row.error } : {}) };
}
async function ledgerFile(path: string) {
  try { return await open(path, "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function recent(path: string): Promise<Api88VideoTaskEntry[]> {
  const file = await ledgerFile(path);
  if (!file) return [];
  try {
    let position = (await file.stat()).size;
    const chunks: Buffer[] = [];
    let newlines = 0;
    while (position > 0 && newlines <= RECENT_LINES) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const bytes = Buffer.alloc(length);
      await file.read(bytes, 0, length, position);
      newlines += bytes.reduce((count, byte) => count + Number(byte === 10), 0);
      chunks.unshift(bytes);
      if (chunks.length * CHUNK_BYTES > MAX_LINE_BYTES * (RECENT_LINES + 1)) throw new Error("Oversized ledger rows");
    }
    const lines = Buffer.concat(chunks).toString("utf8").split("\n");
    if (position > 0) lines.shift();
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(-RECENT_LINES).map((line) => {
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("Oversized ledger row");
      return parse(line);
    });
  } finally { await file.close(); }
}
async function historical(path: string, matches: (row: Api88VideoTaskEntry) => boolean) {
  const file = await ledgerFile(path);
  if (!file) return undefined;
  try {
    const bytes = Buffer.alloc(CHUNK_BYTES);
    let remainder = Buffer.alloc(0);
    let latest: Api88VideoTaskEntry | undefined;
    while (true) {
      const { bytesRead } = await file.read(bytes, 0, bytes.length, null);
      if (!bytesRead) break;
      const lines = Buffer.concat([remainder, bytes.subarray(0, bytesRead)]);
      let start = 0;
      for (let end = lines.indexOf(10); end !== -1; end = lines.indexOf(10, start)) {
        if (end - start > MAX_LINE_BYTES) throw new Error("Oversized ledger row");
        const row = parse(lines.subarray(start, end).toString("utf8"));
        if (matches(row)) latest = row;
        start = end + 1;
      }
      remainder = lines.subarray(start);
      if (remainder.length > MAX_LINE_BYTES) throw new Error("Oversized ledger row");
    }
    if (remainder.length) throw new Error("Incomplete task ledger write");
    return latest;
  } finally { await file.close(); }
}
async function serial<T>(path: string, operation: (index: Index) => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    try {
      let index = indexes.get(path);
      if (!index) {
        index = { requests: new Map(), tasks: new Map() };
        for (const row of await recent(path)) remember(index, row);
        indexes.set(path, index);
      }
      return await operation(index);
    } catch (error) {
      if ((error as { code?: string }).code?.startsWith("API88_")) throw error;
      throw api88Error("API88_VIDEO_LEDGER_FAILED", "Could not access the 88API task ledger", 500);
    }
  });
  locks.set(path, next);
  try { return await next; }
  finally { if (locks.get(path) === next) locks.delete(path); }
}
async function lookup(path: string, index: Index, id: string, byTask: boolean) {
  const known = (byTask ? index.tasks : index.requests).get(id);
  if (known) return known;
  const row = await historical(path, (entry) => (byTask ? entry.taskId : entry.requestId) === id);
  if (row) remember(index, row);
  return row;
}
async function append(path: string, index: Index, row: Api88VideoTaskEntry): Promise<void> {
  const line = `${JSON.stringify(row)}\n`;
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("Oversized ledger row");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line, { flag: "a", mode: 0o600 });
  remember(index, row);
}
export function api88VideoAlreadySubmitted(row?: Api88VideoTaskEntry): Error {
  return Object.assign(api88Error("API88_VIDEO_ALREADY_SUBMITTED", "This request was already attempted; resume its existing task", 409),
    row?.taskId ? { providerTaskId: row.taskId } : {});
}
export async function findApi88VideoTask(ctx: Context, id: string, byTask = false) {
  const path = api88VideoLedgerPath(ctx);
  return serial(path, (index) => lookup(path, index, id, byTask));
}
export async function beginApi88VideoTask(ctx: Context, requestId: string, model: string, origin: string) {
  const path = api88VideoLedgerPath(ctx);
  const reservation = JSON.stringify([path, requestId]);
  if (reservations.has(reservation)) throw api88VideoAlreadySubmitted();
  reservations.add(reservation); // Synchronous reservation precedes every await.
  try {
    return await serial(path, async (index) => {
      const existing = await lookup(path, index, requestId, false);
      if (existing) throw api88VideoAlreadySubmitted(existing);
      const now = Date.now();
      const row: Api88VideoTaskEntry = { requestId, phase: "submitting", model,
        origin: api88Origin(origin), createdAt: now, updatedAt: now };
      await append(path, index, row);
      return row;
    });
  } finally { reservations.delete(reservation); }
}
export async function recordApi88VideoTask(ctx: Context, entry: Omit<Api88VideoTaskEntry, "createdAt" | "updatedAt">) {
  const path = api88VideoLedgerPath(ctx);
  return serial(path, async (index) => {
    const previous = await lookup(path, index, entry.requestId, false);
    const now = Date.now();
    const row = parse(JSON.stringify({ ...entry, taskId: entry.taskId ?? previous?.taskId,
      createdAt: previous?.createdAt ?? now, updatedAt: now }));
    await append(path, index, row);
    return row;
  });
}
export async function listApi88VideoTasks(ctx: Context): Promise<Api88VideoTaskEntry[]> {
  const path = api88VideoLedgerPath(ctx);
  return serial(path, async () => {
    const rows = new Map<string, Api88VideoTaskEntry>();
    for (const row of await recent(path)) { rows.delete(row.requestId); rows.set(row.requestId, row); }
    return Array.from(rows.values()).reverse().slice(0, 50);
  });
}
