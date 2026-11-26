/**
 * Synchronous vendors (Ideogram, Recraft, Stability) return the result in the
 * submit response. The contract still splits submit and poll, so:
 * - URL results ride in MediaJobRef.resume (JSON) and survive a restart;
 * - byte results stay in this process for a short TTL (repeat polls see the
 *   same result), and a poll after a restart or expiry fails with
 *   RESULT_EXPIRED instead of re-running a paid call.
 */
import { randomUUID } from "node:crypto";
import type { MediaJobRef, MediaJobState, MediaOutput } from "../../contract.js";
import { makeError } from "./errors.js";

const BYTE_RESULT_TTL_MS = 30 * 60 * 1000;
const byteResults = new Map<string, { outputs: MediaOutput[]; expiresAt: number }>();

export function urlResultRef(outputs: readonly MediaOutput[], extra: Record<string, string> = {}): MediaJobRef {
  const jobId = extra["providerJobId"] ?? randomUUID();
  return { providerJobId: jobId, pollAfterMs: 0, resume: { ...extra, sync: "url", outputs: JSON.stringify(outputs) } };
}

export function byteResultRef(outputs: readonly MediaOutput[], now = Date.now()): MediaJobRef {
  pruneExpired(now);
  const jobId = randomUUID();
  byteResults.set(jobId, { outputs: [...outputs], expiresAt: now + BYTE_RESULT_TTL_MS });
  return { providerJobId: jobId, pollAfterMs: 0, resume: { sync: "bytes" } };
}

export function isSyncRef(job: MediaJobRef): boolean {
  return job.resume?.["sync"] === "url" || job.resume?.["sync"] === "bytes";
}

export function readSyncResult(prefix: string, job: MediaJobRef, now = Date.now()): MediaJobState {
  if (job.resume?.["sync"] === "url") {
    const outputs = JSON.parse(job.resume["outputs"] ?? "[]") as MediaOutput[];
    return { status: "succeeded", outputs };
  }
  const entry = byteResults.get(job.providerJobId);
  if (!entry || entry.expiresAt <= now) {
    byteResults.delete(job.providerJobId);
    return {
      status: "failed",
      error: makeError(prefix, "RESULT_EXPIRED", "The finished result is no longer held in memory; submit again", {
        category: "not-found", retryable: false,
      }),
    };
  }
  return { status: "succeeded", outputs: entry.outputs };
}

function pruneExpired(now: number): void {
  for (const [id, entry] of byteResults) if (entry.expiresAt <= now) byteResults.delete(id);
}
