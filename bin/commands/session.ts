import { readFile } from "fs/promises";
import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { out, die, color, json, exitCodeForError, table } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";

const HELP = `
  ima2 session <subcommand> [options]

  Subcommands:
    ls [--json]                            List sessions
    show <id> [--json]                     Show session details
    create <title>                         Create a new session
    rm <id> [--yes]                        Delete a session
    rename <id> <title>                    Rename a session
    graph save <id> <file>                 Save graph JSON (uses If-Match for concurrency)
    graph load <id> [-o, --out <file>]     Load graph JSON (stdout or --out)
    style-sheet get <id> [--json]
    style-sheet put <id> <file>            Replace full style sheet
    style-sheet enable <id>
    style-sheet disable <id>
    style-sheet extract <id>               LLM-extract style sheet from session content

  Common options:
        --server <url>                     Override server URL
        --json                             JSON output
        --yes                              Skip destructive confirmation
`;

const COMMON_FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  yes: { type: "boolean" },
  out: { short: "o", type: "string" },
  help: { short: "h", type: "boolean" },
};

interface SessionGraph {
  version?: unknown;
  nodes?: unknown[];
  edges?: unknown[];
}

interface SessionDetail {
  id?: string;
  title?: string;
  graph?: SessionGraph;
  graphVersion?: unknown;
  nodes?: unknown;
  edges?: unknown[];
  styleSheet?: { enabled?: boolean };
}

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
}

async function lsSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const server = await getServer(args);
  const resp = await request<{ sessions?: Record<string, unknown>[] }>(server.base, "/api/sessions").catch(handle);
  const sessions = resp.sessions || [];
  if (args.json) { json({ sessions }); return; }
  if (sessions.length === 0) { out(color.dim("(no sessions)")); return; }
  table(sessions, [
    { key: "id", label: "ID" },
    { key: "title", label: "TITLE" },
    { key: "createdAt", label: "WHEN", format: (v: unknown) => v ? new Date(v as string | number).toISOString().slice(0, 19) : "" },
  ]);
}

async function showSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "session id required");
  const server = await getServer(args);
  const resp = await request<SessionDetail & { session?: SessionDetail }>(server.base, `/api/sessions/${encodeURIComponent(id)}`).catch(handle);
  if (args.json) { json(resp); return; }
  const s = resp.session || resp;
  out(color.bold(s.id || id));
  out(color.dim("  title: ") + (s.title || ""));
  if (s.graph) out(color.dim("  graph: ") + `${s.graph.nodes?.length ?? 0} nodes, ${s.graph.edges?.length ?? 0} edges, version ${s.graph.version}`);
  if (s.styleSheet) out(color.dim("  styleSheet: ") + (s.styleSheet.enabled ? "enabled" : "disabled"));
}

async function createSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const title = args.positional.join(" ").trim();
  if (!title) die(2, "title required");
  const server = await getServer(args);
  const resp = await request<{ session?: { id?: string } }>(server.base, "/api/sessions", {
    method: "POST",
    body: { title },
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + (resp.session?.id || "(no id returned)"));
}

async function rmSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "session id required");
  if (!args.yes && !process.stdin.isTTY) die(2, "destructive: pass --yes for non-TTY");
  if (!args.yes) {
    process.stdout.write(`Delete session ${id}? [y/N] `);
    const ans = await readLine();
    if (!/^y(es)?$/i.test(ans.trim())) { out("(canceled)"); return; }
  }
  const server = await getServer(args);
  await request(server.base, `/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(handle);
  out(color.green("✓ deleted"));
}

async function renameSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const [id, ...rest] = args.positional;
  const title = rest.join(" ").trim();
  if (!id || !title) die(2, "usage: session rename <id> <title>");
  const server = await getServer(args);
  await request(server.base, `/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { title },
  }).catch(handle);
  out(color.green("✓ renamed"));
}

async function graphSub(argv: string[]) {
  const action = argv[0];
  const rest = argv.slice(1);
  if (action === "save") return graphSave(rest);
  if (action === "load") return graphLoad(rest);
  die(2, "usage: session graph <save|load> ...");
}

async function graphSave(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const [id, file] = args.positional;
  if (!id || !file) die(2, "usage: session graph save <id> <file>");
  const buf = await readFile(file, "utf-8");
  let parsed;
  try { parsed = JSON.parse(buf); } catch { die(2, "graph file is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    die(2, "graph file must contain { nodes: [], edges: [] }");
  const { nodes, edges } = parsed;
  if (!Array.isArray(nodes) || !Array.isArray(edges))
    die(2, "graph file must contain { nodes: [], edges: [] }");
  const server = await getServer(args);
  // Step 1: fetch current version
  const current = await request<{ session?: SessionDetail } | null>(server.base, `/api/sessions/${encodeURIComponent(id)}`).catch(handle);
  const session = current?.session;
  if (!session) die(1, "session not found");
  // The server returns the version flat as `graphVersion`; a brand-new session
  // has no graph yet, and its first save must go in with If-Match "0".
  // Reading only `graph.version` made seeding a first graph impossible.
  const version =
    typeof session.graph?.version === "number" ? session.graph.version
    : typeof session.graphVersion === "number" ? session.graphVersion
    : 0;
  // Step 2: PUT with If-Match
  try {
    const result = await request<{ graphVersion?: unknown }>(server.base, `/api/sessions/${encodeURIComponent(id)}/graph`, {
      method: "PUT",
      body: { nodes, edges },
      headers: { "If-Match": `"${version}"` },
    });
    if (args.json) { json(result); return; }
    out(color.green(`✓ saved (graphVersion: ${result.graphVersion})`));
  } catch (e: unknown) {
    const err = e as { status?: number; code?: unknown; message?: string };
    if (err.status === 412 || err.code === "GRAPH_VERSION_CONFLICT") die(1, "graph version conflict — fetch latest and retry");
    if (err.status === 413) die(1, err.message);
    handle(e);
  }
}

async function graphLoad(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "usage: session graph load <id>");
  const server = await getServer(args);
  const resp = await request<{ session?: SessionDetail } | null>(server.base, `/api/sessions/${encodeURIComponent(id)}`).catch(handle);
  const session = resp?.session;
  if (!session) die(1, "session not found");
  // Same shape mismatch as in graphSave: nodes/edges come back flat on the
  // session, not nested under `graph`. Looking only at `graph` made every
  // saved graph report "no graph for session".
  const graph =
    session.graph
    ?? (Array.isArray(session.nodes)
      ? { version: session.graphVersion ?? 0, nodes: session.nodes, edges: session.edges ?? [] }
      : null);
  if (!graph) die(1, "no graph for session");
  const text = JSON.stringify(graph, null, 2);
  if (args.out) {
    const { writeFile } = await import("fs/promises");
    await writeFile(String(args.out), text);
    out(color.green("✓ ") + String(args.out));
  } else {
    process.stdout.write(text + "\n");
  }
}

async function styleSheetSub(argv: string[]) {
  const action = argv[0];
  const rest = argv.slice(1);
  if (action === "get") return ssGet(rest);
  if (action === "put") return ssPut(rest);
  if (action === "enable") return ssEnable(rest, true);
  if (action === "disable") return ssEnable(rest, false);
  if (action === "extract") return ssExtract(rest);
  die(2, "usage: session style-sheet <get|put|enable|disable|extract> ...");
}

async function ssGet(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "session id required");
  const server = await getServer(args);
  const resp = await request(server.base, `/api/sessions/${encodeURIComponent(id)}/style-sheet`).catch(handle);
  json(resp);
}

async function ssPut(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const [id, file] = args.positional;
  if (!id || !file) die(2, "usage: session style-sheet put <id> <file>");
  const buf = await readFile(file, "utf-8");
  let parsed;
  try { parsed = JSON.parse(buf); } catch { die(2, "style-sheet file is not valid JSON"); }
  const server = await getServer(args);
  await request(server.base, `/api/sessions/${encodeURIComponent(id)}/style-sheet`, {
    method: "PUT",
    body: parsed,
  }).catch(handle);
  out(color.green("✓ style-sheet updated"));
}

async function ssEnable(argv: string[], enabled: boolean) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "session id required");
  const server = await getServer(args);
  await request(server.base, `/api/sessions/${encodeURIComponent(id)}/style-sheet/enabled`, {
    method: "PATCH",
    body: { enabled },
  }).catch(handle);
  out(color.green(enabled ? "✓ enabled" : "✓ disabled"));
}

async function ssExtract(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "session id required");
  const server = await getServer(args);
  const resp = await request(server.base, `/api/sessions/${encodeURIComponent(id)}/style-sheet/extract`, {
    method: "POST",
    timeoutMs: 120_000,
  }).catch(handle);
  json(resp);
}

function handle(e: unknown): never {
  const err = e as { message?: string; code?: string };
  die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf-8");
    const onData = (chunk: Buffer | string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nl));
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

const SUB: Record<string, (argv: string[]) => Promise<void>> = {
  ls: lsSub,
  show: showSub,
  create: createSub,
  rm: rmSub,
  rename: renameSub,
  graph: graphSub,
  "style-sheet": styleSheetSub,
};

export default async function sessionCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
  const handler = SUB[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
