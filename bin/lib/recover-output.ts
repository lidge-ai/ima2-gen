import { copyFile, mkdir } from "node:fs/promises";
import { join, dirname, basename, isAbsolute } from "node:path";
import { config } from "../../config.js";
import { request, type HistoryListResponse, type InflightListResponse } from "./client.js";
import { exitCodeForError } from "./output.js";

export type RecoverOutputTarget = {
  explicitOut?: string | null;
  outDir?: string | null;
  expectedCount?: number;
  json?: boolean;
};

export type RecoverOutputResult = {
  recovered: boolean;
  paths: string[];
  requestId: string;
  source: "terminal" | "history" | "active" | "none";
  message?: string;
};

export function createCliRequestId(prefix = "req_cli"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function expectedRecoveryCount(target: RecoverOutputTarget): number {
  const count = Number.isFinite(target.expectedCount) ? Number(target.expectedCount) : 1;
  return Math.max(1, Math.min(500, count));
}

function filenamesFromMeta(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const record = meta as Record<string, unknown>;
  if (Array.isArray(record.filenames)) {
    return record.filenames.filter((name): name is string => typeof name === "string" && name.length > 0);
  }
  if (typeof record.filename === "string" && record.filename.length > 0) return [record.filename];
  return [];
}

async function copyFilesToTarget(
  filenames: string[],
  target: RecoverOutputTarget,
  generatedDir: string,
): Promise<string[]> {
  const saved: string[] = [];
  for (let i = 0; i < filenames.length; i++) {
    const current = filenames[i];
    if (!current) continue;
    const name = basename(current);
    const src = join(generatedDir, name);
    let dest: string;
    if (target.explicitOut && i === 0) {
      // Same resolution rule as the normal save path (#170): a relative --out
      // belongs under --out-dir when the caller named one.
      dest = target.outDir && !isAbsolute(target.explicitOut)
        ? join(target.outDir, target.explicitOut)
        : target.explicitOut;
    } else if (target.outDir) {
      dest = join(target.outDir, name);
    } else {
      saved.push(src);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    saved.push(dest);
  }
  return saved;
}

async function tryTerminalRecovery(
  base: string,
  requestId: string,
  target: RecoverOutputTarget,
): Promise<RecoverOutputResult | null> {
  const inflight = await request<InflightListResponse>(base, "/api/inflight?includeTerminal=1");
  const jobs = Array.isArray(inflight.jobs) ? inflight.jobs : [];
  const terminalJobs = Array.isArray(inflight.terminalJobs) ? inflight.terminalJobs : [];

  const activeMatch = jobs.find((j) => j.requestId === requestId);
  if (activeMatch) {
    return {
      recovered: false,
      paths: [],
      requestId,
      source: "active",
      message: `Generation in progress (requestId: ${requestId}). Check: ima2 ps --json`,
    };
  }

  const termMatch = terminalJobs.find((j) => j.requestId === requestId);
  if (!termMatch) return null;

  const filenames = filenamesFromMeta(termMatch.meta);
  if (filenames.length === 0) return null;

  const paths = await copyFilesToTarget(filenames, target, config.storage.generatedDir);
  return { recovered: paths.length > 0, paths, requestId, source: "terminal" };
}

async function tryHistoryRecovery(
  base: string,
  requestId: string,
  target: RecoverOutputTarget,
): Promise<RecoverOutputResult | null> {
  const limit = expectedRecoveryCount(target);
  const hist = await request<HistoryListResponse>(base, `/api/history?limit=${limit}&requestId=${encodeURIComponent(requestId)}`);
  const items = Array.isArray(hist.items) ? hist.items : [];
  const filenames = items
    .filter((it) => it.requestId === requestId && typeof it.filename === "string")
    .map((it) => String(it.filename))
    .slice(0, limit);
  if (filenames.length === 0) return null;

  const paths = await copyFilesToTarget(filenames, target, config.storage.generatedDir);
  return { recovered: paths.length > 0, paths, requestId, source: "history" };
}

export async function recoverGeneratedOutputs(
  base: string,
  requestId: string,
  target: RecoverOutputTarget,
): Promise<RecoverOutputResult> {
  try {
    const result = await tryTerminalRecovery(base, requestId, target);
    if (result) return result;
  } catch (error) { if (exitCodeForError(error) === 4) throw error; }

  try {
    const result = await tryHistoryRecovery(base, requestId, target);
    if (result) return result;
  } catch (error) { if (exitCodeForError(error) === 4) throw error; }

  return { recovered: false, paths: [], requestId, source: "none" };
}

export function formatRecoveryHint(result: RecoverOutputResult): string {
  if (result.source === "active") {
    return result.message ?? `Generation in progress (requestId: ${result.requestId})`;
  }
  if (result.recovered) {
    return `Recovered ${result.paths.length} file(s) via ${result.source} (requestId: ${result.requestId})`;
  }
  return `Could not recover output (requestId: ${result.requestId}). Check ${config.storage.generatedDir}/`;
}
