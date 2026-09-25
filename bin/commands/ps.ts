import { parseArgs } from "../lib/args.js";
import { resolveServer, request, type InflightListResponse } from "../lib/client.js";
import { out, dieWithError, color, json, table } from "../lib/output.js";

import { errInfo } from "../../lib/errInfo.js";
const SPEC = {
  flags: {
    kind:    { type: "string" },
    session: { type: "string" },
    terminal: { type: "boolean" },
    json:    { type: "boolean" },
    server:  { type: "string" },
    help:    { short: "h", type: "boolean" },
  },
};

export default async function psCmd(argv: string[]) {
  const args = parseArgs(argv, SPEC);
  if (args.help) { out("ima2 ps [--kind classic|node|multimode] [--session id] [--terminal] [--json] [--server <url>]"); return; }

  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e) {
    const err = errInfo(e);
    if (args.json) json({ ok: false, error: err.message, code: err.code, status: err.status });
    dieWithError(e);
  }

  const qs = new URLSearchParams();
  if (args.kind) qs.set("kind", String(args.kind));
  if (args.session) qs.set("sessionId", String(args.session));
  if (args.terminal) qs.set("includeTerminal", "1");
  const path = `/api/inflight${qs.toString() ? `?${qs}` : ""}`;
  let resp: InflightListResponse;
  try { resp = await request<InflightListResponse>(server.base, path); }
  catch (e) {
    const err = errInfo(e);
    if (args.json) json({ ok: false, error: err.message, code: err.code, status: err.status });
    dieWithError(e);
  }

  const jobs = resp.jobs || resp.items || [];
  const terminalJobs = resp.terminalJobs || [];
  if (args.json) {
    json(args.terminal ? { jobs, terminalJobs } : { jobs });
    return;
  }
  if (jobs.length === 0 && terminalJobs.length === 0) {
    out(color.dim(args.terminal ? "(no active or terminal jobs)" : "(no active jobs)"));
    return;
  }

  const now = Date.now();
  if (jobs.length > 0) {
    out(color.bold("Active jobs"));
    table(jobs, [
      { key: "requestId", label: "ID", format: (v: unknown) => String(v || "").slice(0, 10) },
      { key: "kind", label: "KIND" },
      { key: "phase", label: "PHASE" },
      { key: "startedAt", label: "AGE", format: (v: unknown) => v ? `${Math.round((now - Number(v)) / 1000)}s` : "" },
      { key: "prompt", label: "PROMPT", format: (v: unknown) => {
        const s = String(v || "").replace(/\s+/g, " ");
        return s.length > 40 ? s.slice(0, 37) + "…" : s;
      } },
    ]);
  }
  if (terminalJobs.length > 0) {
    if (jobs.length > 0) out("");
    out(color.bold("Terminal jobs"));
    table(terminalJobs, [
      { key: "requestId", label: "ID", format: (v: unknown) => String(v || "").slice(0, 10) },
      { key: "kind", label: "KIND" },
      { key: "status", label: "STATUS" },
      { key: "finishedAt", label: "AGE", format: (v: unknown) => v ? `${Math.round((now - Number(v)) / 1000)}s` : "" },
      { key: "prompt", label: "PROMPT", format: (v: unknown) => {
        const s = String(v || "").replace(/\s+/g, " ");
        return s.length > 40 ? s.slice(0, 37) + "…" : s;
      } },
    ]);
  }
}
