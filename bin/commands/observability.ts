import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { out, die, color, json, table, exitCodeForError } from "../lib/output.js";

const HELP = `
  ima2 <domain> <subcommand> [options]

  Storage:
    storage status [--json]                  Storage inspection
    storage open                             Open generated-dir in OS file manager

  Billing / Providers / GPT OAuth:
    billing [--json]                         API usage / quota
    providers [--json]                       Configured providers
    oauth status [--json]                    GPT OAuth state

  Inflight jobs:
    inflight ls [--kind classic|node|multimode] [--session <id>] [--terminal] [--json]
    inflight rm <requestId> [--json]         Force-remove a stuck job

  Options:
    --json          Output raw JSON
    --server <url>  Override server URL
`;

const FLAGS = {
  json:     { type: "boolean" },
  server:   { type: "string" },
  kind:     { type: "string" },
  session:  { type: "string" },
  terminal: { type: "boolean" },
  help:     { short: "h", type: "boolean" },
};

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e: any) { die(exitCodeForError(e), e.message); throw e; }
}

async function storageStatusSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const server = await getServer(args);
  const resp = await request(server.base, "/api/storage/status")
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function storageOpenSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const server = await getServer(args);
  await request(server.base, "/api/storage/open-generated-dir", { method: "POST" })
    .catch((e) => die(exitCodeForError(e), e.message));
  out(color.green("✓ ") + "opened generated directory");
}

async function billingSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const server = await getServer(args);
  const resp = await request(server.base, "/api/billing")
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function providersSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const server = await getServer(args);
  const resp = await request(server.base, "/api/providers")
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function oauthStatusSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const server = await getServer(args);
  const resp = await request(server.base, "/api/oauth/status")
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function inflightLsSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const server = await getServer(args);
  const qs = new URLSearchParams();
  if (args.kind) qs.set("kind", String(args.kind));
  if (args.session) qs.set("sessionId", String(args.session));
  if (args.terminal) qs.set("includeTerminal", "1");
  const path = `/api/inflight${qs.toString() ? `?${qs}` : ""}`;
  const resp = await request(server.base, path)
    .catch((e: unknown) => { const err = e as { message?: string }; die(exitCodeForError(e), err.message); });
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
      { key: "kind",      label: "KIND" },
      { key: "phase",     label: "PHASE" },
      { key: "startedAt", label: "AGE", format: (v: unknown) => v ? `${Math.round((now - Number(v)) / 1000)}s` : "" },
      { key: "prompt",    label: "PROMPT", format: (v: unknown) => {
        const s = String(v || "").replace(/\s+/g, " ");
        return s.length > 40 ? s.slice(0, 37) + "…" : s;
      } },
    ]);
  }
  if (terminalJobs.length > 0) {
    if (jobs.length > 0) out("");
    out(color.bold("Terminal jobs"));
    table(terminalJobs, [
      { key: "requestId",  label: "ID",     format: (v: unknown) => String(v || "").slice(0, 10) },
      { key: "kind",       label: "KIND" },
      { key: "status",     label: "STATUS" },
      { key: "finishedAt", label: "AGE", format: (v: unknown) => v ? `${Math.round((now - Number(v)) / 1000)}s` : "" },
      { key: "prompt",     label: "PROMPT", format: (v: unknown) => {
        const s = String(v || "").replace(/\s+/g, " ");
        return s.length > 40 ? s.slice(0, 37) + "…" : s;
      } },
    ]);
  }
}

async function inflightRmSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const requestId = args.positional[0];
  if (!requestId) die(2, "requestId required");
  const server = await getServer(args);
  await request(server.base, `/api/inflight/${encodeURIComponent(requestId)}`, { method: "DELETE" })
    .catch((e: unknown) => { const err = e as { message?: string }; die(exitCodeForError(e), err.message); });
  if (args.json) { json({ ok: true, requestId }); return; }
  out(color.green("✓ ") + `removed ${requestId}`);
}

export default async function observabilityCmd(argv: string[]) {
  const domain = argv[0];
  const rest = argv.slice(1);
  if (!domain || domain === "--help" || domain === "-h") { out(HELP); return; }
  if (rest[0] === "--help" || rest[0] === "-h") { out(HELP); return; }

  if (domain === "storage") {
    const sub = rest[0];
    if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
    if (sub === "status") return storageStatusSub(rest.slice(1));
    if (sub === "open")   return storageOpenSub(rest.slice(1));
    die(2, `unknown subcommand: storage ${sub}\n${HELP}`);
  }

  if (domain === "billing")   return billingSub(rest);
  if (domain === "providers") return providersSub(rest);

  if (domain === "oauth") {
    const sub = rest[0];
    if (!sub || sub === "status") return oauthStatusSub(rest.slice(sub === "status" ? 1 : 0));
    die(2, `unknown subcommand: oauth ${sub}\n${HELP}`);
  }

  if (domain === "inflight") {
    const sub = rest[0];
    if (!sub || sub === "ls") return inflightLsSub(sub === "ls" ? rest.slice(1) : rest);
    if (sub === "rm")          return inflightRmSub(rest.slice(1));
    die(2, `unknown subcommand: inflight ${sub}\n${HELP}`);
  }

  die(2, `unknown domain: ${domain}\n${HELP}`);
}
