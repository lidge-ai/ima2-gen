import { jobStatus, result, saveOutputs, waitJob } from "../mediaApi.js";
import type { ParsedArgs } from "../args.js";

export async function waitUntil(base: string, id: string, options: { deadlineMs: number; sliceMs?: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  let current: Awaited<ReturnType<typeof jobStatus>> | undefined;
  while (now() < options.deadlineMs) {
    current = await waitJob(base, id, { timeoutMs: Math.min(options.sliceMs ?? 60000, options.deadlineMs - now()) });
    if (!current.pollAfterSeconds) return current;
  }
  return { ...(current ?? await jobStatus(base, id)), timedOut: true };
}
export async function jobCommand(base: string, sub: string, id: string, args: ParsedArgs) {
  if (sub === "status") return jobStatus(base, id);
  if (sub === "wait") {
    const seconds = args.timeout === undefined ? 60 : Number(args.timeout);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) throw new Error("--timeout must be between 1 and 600 seconds");
    return waitUntil(base, id, { deadlineMs: Date.now() + seconds * 1000 });
  }
  const data = await result(base, id);
  return args.out ? { ...data, paths: await saveOutputs(base, data.outputs, String(args.out)) } : data;
}
