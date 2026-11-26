import { randomUUID } from "node:crypto";
import type { ParsedArgs } from "../args.js";
import { request } from "../client.js";
import { err } from "../output.js";
import { openSse, sseFields } from "../sse.js";
import { ensureRequestIdUnused } from "../mediaApi.js";
import { outputFiles, type Dict } from "./common.js";
import { createProgress } from "./progress.js";

export async function submit(base: string, path: string, body: Dict, args: ParsedArgs): Promise<unknown> {
  const requestId = typeof args["request-id"] === "string" ? args["request-id"] : `media_${randomUUID()}`;
  if (args["request-id"]) await ensureRequestIdUnused(base, requestId);
  if (args["no-wait"]) return request(base, path, { method: "POST", body: { ...body, requestId } });
  const stream = await openSse(new URL("/api/events", base).href);
  const cancel = () => { void request(base, `/api/media/${encodeURIComponent(requestId)}/cancel`, { method: "POST" }).catch((e: Error) => err(e.message)); };
  process.once("SIGINT", cancel);
  const progress = createProgress(requestId);
  try {
    await request(base, path, { method: "POST", body: { ...body, requestId } });
    for await (const event of stream.events) {
      if (event.event === "replay-gap") throw new Error("SSE replay gap; inspect media jobs");
      const data = sseFields(event.data);
      if (data.jobId !== requestId) continue;
      if (!args.quiet) progress(event.event, data);
      if (event.event === "error") throw Object.assign(new Error(String(data.error ?? "Media job failed")), { code: data.code, body: data });
      if (event.event === "done") return { ...data, paths: await outputFiles(base, data, typeof args.out === "string" ? args.out : undefined) };
    }
    throw new Error("Event stream ended before job completed; inspect media jobs");
  } finally { process.off("SIGINT", cancel); stream.close(); }
}
