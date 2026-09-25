import { readFile, writeFile } from "fs/promises";
import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request, type JsonRecord } from "../lib/client.js";
import { readStdin } from "../lib/files.js";
import { out, die, color, json, exitCodeForError, table } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";

const HELP = `
  ima2 prompt <subcommand> [options]

  Core:
    ls [--folder <id>] [--search <q>] [--favorites] [--json]
    show <id> [--json]
    create --text <t|@file|->  [--name <n>] [--folder <id>] [--tag <t>...] [--mode <m>]
    edit <id> [--name] [--text <t|@file|->] [--folder] [--tag <t>...] [--mode]
    rm <id> [--yes]
    favorite <id>
    export [-o <file>]                       Dump all non-trash prompts + folders

  Builder:
    build --message "<text>" [--ref <image>] [--model <m>] [--json]
    build --messages <file|@file|-> [--json]

  Folders:
    folder ls
    folder create <name>
    folder rename <id> <name>
    folder rm <id> [--strategy move|delete] [--yes]

  Import:
    import sources                           List curated + discovery sources
    import refresh --source <id>             Refresh curated cache
    import curated --source <id> [-q <q>] [--limit <n>] [--folder <id>] [--dry-run]
    import discovery -q <q> --seed <repo>... [--limit <n>] [--folder <id>] [--dry-run]
    import folder <path> [--folder <id>] [--dry-run]
    import json <file|@file|-> [--folder <id>] [--dry-run]
    import preview <file|@file|-> [--filename <name>] [--json]

  Common options:
        --server <url>                       Override server URL
        --json                               JSON output
        --yes                                Skip destructive confirmation
`;

const COMMON_FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  yes: { type: "boolean" },
  out: { short: "o", type: "string" },
  text: { type: "string" },
  name: { type: "string" },
  folder: { type: "string" },
  filename: { type: "string" },
  tag: { type: "string", repeatable: true },
  mode: { type: "string" },
  search: { type: "string" },
  favorites: { type: "boolean" },
  source: { type: "string" },
  q: { short: "q", type: "string" },
  query: { type: "string" },
  seed: { type: "string", repeatable: true },
  limit: { type: "string" },
  strategy: { type: "string" },
  "dry-run": { type: "boolean" },
  help: { short: "h", type: "boolean" },
};

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
}

interface ImportCandidatesResponse { candidates?: unknown[] }

interface ImportCommitResponse { imported?: number }

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

async function resolveText(value: unknown): Promise<string | null> {
  if (!value) return null;
  if (typeof value !== "string") return null;
  if (value === "-") return await readStdin();
  if (value.startsWith("@")) return await readFile(value.slice(1), "utf-8");
  return value;
}

async function readSourceArg(value: unknown, fallbackFilename: string) {
  if (!value || typeof value !== "string") die(2, "source file required");
  if (value === "-") return { text: await readStdin(), filename: fallbackFilename };
  const path = value.startsWith("@") ? value.slice(1) : value;
  return { text: await readFile(path, "utf-8"), filename: path.split(/[\\/]/).pop() || fallbackFilename };
}

// ---------- core ----------

async function lsSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const server = await getServer(args);
  const qs = new URLSearchParams();
  if (args.folder) qs.set("folderId", String(args.folder));
  if (args.search) qs.set("search", String(args.search));
  if (args.favorites) qs.set("favoritesOnly", "1");
  const path = qs.toString() ? `/api/prompts?${qs.toString()}` : "/api/prompts";
  const resp = await request<{ prompts?: JsonRecord[]; items?: JsonRecord[] }>(server.base, path).catch(handle);
  const prompts = resp.prompts || resp.items || [];
  if (args.json) { json({ prompts }); return; }
  if (prompts.length === 0) { out(color.dim("(no prompts)")); return; }
  table(prompts, [
    { key: "id", label: "ID" },
    { key: "name", label: "NAME" },
    { key: "folder_id", label: "FOLDER" },
    { key: "is_favorite", label: "★", format: (v: unknown) => v ? "★" : "" },
    { key: "text", label: "TEXT", format: (v: unknown) => {
      const s = String(v || "").replace(/\s+/g, " ");
      return s.length > 48 ? s.slice(0, 45) + "…" : s;
    } },
  ]);
}

async function showSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "prompt id required");
  const server = await getServer(args);
  const resp = await request(server.base, `/api/prompts/${encodeURIComponent(id)}`).catch(handle);
  json(resp);
}

async function createSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const text = await resolveText(args.text);
  if (!text) die(2, "--text <value|@file|-> required");
  const body: JsonRecord = { text };
  if (args.name) body.name = args.name;
  if (args.folder) body.folderId = args.folder;
  if (args.tag && Array.isArray(args.tag) && args.tag.length) body.tags = args.tag;
  if (args.mode) body.mode = args.mode;
  const server = await getServer(args);
  const resp = await request<{ id?: string; prompt?: { id?: string } }>(server.base, "/api/prompts", { method: "POST", body }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + (resp.id || resp.prompt?.id || "(no id)"));
}

async function editSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "prompt id required");
  const body: JsonRecord = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.text !== undefined) body.text = await resolveText(args.text);
  if (args.folder !== undefined) body.folderId = args.folder;
  if (args.tag && Array.isArray(args.tag) && args.tag.length) body.tags = args.tag;
  if (args.mode !== undefined) body.mode = args.mode;
  if (Object.keys(body).length === 0) die(2, "no fields to update");
  const server = await getServer(args);
  const resp = await request(server.base, `/api/prompts/${encodeURIComponent(id)}`, {
    method: "PATCH", body,
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green("✓ updated"));
}

async function rmSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "prompt id required");
  if (!args.yes && !process.stdin.isTTY) die(2, "destructive: pass --yes for non-TTY");
  if (!args.yes) {
    process.stdout.write(`Delete prompt ${id}? [y/N] `);
    const ans = await readLine();
    if (!/^y(es)?$/i.test(ans.trim())) { out("(canceled)"); return; }
  }
  const server = await getServer(args);
  await request(server.base, `/api/prompts/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(handle);
  out(color.green("✓ deleted"));
}

async function favoriteSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "prompt id required");
  const server = await getServer(args);
  const resp = await request<{ isFavorite?: boolean } | null>(server.base, `/api/prompts/${encodeURIComponent(id)}/favorite`, {
    method: "POST",
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green(resp?.isFavorite ? "✓ favorited" : "✓ unfavorited"));
}

async function exportSub(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const server = await getServer(args);
  const resp = await request(server.base, "/api/prompts/export").catch(handle);
  const text = JSON.stringify(resp, null, 2);
  if (args.out) {
    await writeFile(String(args.out), text);
    out(color.green("✓ ") + String(args.out));
  } else {
    process.stdout.write(text + "\n");
  }
}

// ---------- folders ----------

async function folderSub(argv: string[]) {
  const action = argv[0];
  const rest = argv.slice(1);
  if (action === "ls") return folderLs(rest);
  if (action === "create") return folderCreate(rest);
  if (action === "rename") return folderRename(rest);
  if (action === "rm") return folderRm(rest);
  die(2, "usage: prompt folder <ls|create|rename|rm> ...");
}

async function folderLs(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const server = await getServer(args);
  const resp = await request<{ folders?: JsonRecord[]; items?: JsonRecord[] }>(server.base, "/api/prompts/folders").catch(handle);
  const folders = resp.folders || resp.items || [];
  if (args.json) { json({ folders }); return; }
  if (folders.length === 0) { out(color.dim("(no folders)")); return; }
  table(folders, [
    { key: "id", label: "ID" },
    { key: "name", label: "NAME" },
  ]);
}

async function folderCreate(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const name = args.positional.join(" ").trim();
  if (!name) die(2, "folder name required");
  const server = await getServer(args);
  const resp = await request<{ id?: string; folder?: { id?: string } }>(server.base, "/api/prompts/folders", {
    method: "POST", body: { name },
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + (resp.id || resp.folder?.id || "(no id)"));
}

async function folderRename(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const [id, ...rest] = args.positional;
  const name = rest.join(" ").trim();
  if (!id || !name) die(2, "usage: prompt folder rename <id> <name>");
  const server = await getServer(args);
  await request(server.base, `/api/prompts/folders/${encodeURIComponent(id)}`, {
    method: "PATCH", body: { name },
  }).catch(handle);
  out(color.green("✓ renamed"));
}

async function folderRm(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "folder id required");
  if (!args.yes && !process.stdin.isTTY) die(2, "destructive: pass --yes for non-TTY");
  if (!args.yes) {
    process.stdout.write(`Delete folder ${id}? [y/N] `);
    const ans = await readLine();
    if (!/^y(es)?$/i.test(ans.trim())) { out("(canceled)"); return; }
  }
  // CLI alias: --strategy delete → server's deleteItems; default → moveToRoot
  const cliStrategy = String(args.strategy || "").toLowerCase();
  const serverStrategy = cliStrategy === "delete" || cliStrategy === "deleteitems"
    ? "deleteItems"
    : "moveToRoot";
  const server = await getServer(args);
  await request(server.base,
    `/api/prompts/folders/${encodeURIComponent(id)}?strategy=${serverStrategy}`,
    { method: "DELETE" },
  ).catch(handle);
  out(color.green(`✓ deleted (strategy: ${serverStrategy})`));
}

// ---------- import ----------

async function importSub(argv: string[]) {
  const action = argv[0];
  const rest = argv.slice(1);
  if (action === "sources") return importSources(rest);
  if (action === "refresh") return importRefresh(rest);
  if (action === "curated") return importCurated(rest);
  if (action === "discovery") return importDiscovery(rest);
  if (action === "folder") return importFolder(rest);
  if (action === "json") return importJson(rest);
  if (action === "preview") return importPreview(rest);
  die(2, "usage: prompt import <sources|refresh|curated|discovery|folder|json|preview> ...");
}

async function importSources(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const server = await getServer(args);
  const [curated, discovery] = await Promise.all([
    request(server.base, "/api/prompts/import/curated-sources").catch((error) => { if (exitCodeForError(error) === 4) throw error; return {}; }),
    request(server.base, "/api/prompts/import/discovery").catch((error) => { if (exitCodeForError(error) === 4) throw error; return {}; }),
  ]).catch(handle);
  if (args.json) { json({ curated, discovery }); return; }
  out(color.bold("Curated sources:"));
  out(JSON.stringify(curated, null, 2));
  out("");
  out(color.bold("Discovery candidates:"));
  out(JSON.stringify(discovery, null, 2));
}

async function importRefresh(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  if (!args.source) die(2, "--source <id> required");
  const server = await getServer(args);
  const resp = await request(server.base, "/api/prompts/import/curated-refresh", {
    method: "POST", body: { sourceId: args.source },
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green("✓ refreshed"));
}

async function importCurated(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  if (!args.source) die(2, "--source <id> required (run `prompt import sources`)");
  const server = await getServer(args);
  const limit = args.limit ? parseInt(String(args.limit)) : undefined;
  const search = await request<ImportCandidatesResponse>(server.base, "/api/prompts/import/curated-search", {
    method: "POST",
    body: {
      q: args.q || args.query || "",
      sourceIds: [args.source],
      ...(limit ? { limit } : {}),
    },
  }, ).catch(handle);
  const candidates = search.candidates || [];
  if (candidates.length === 0) { out(color.dim("(no candidates)")); return; }
  out(`${candidates.length} candidates`);
  if (args["dry-run"]) { json({ candidates }); return; }
  const commit = await request<ImportCommitResponse>(server.base, "/api/prompts/import/commit", {
    method: "POST",
    body: { candidates, ...(args.folder ? { folderId: args.folder } : {}) },
  }).catch(handle);
  if (args.json) { json(commit); return; }
  out(color.green(`✓ imported ${commit.imported || candidates.length}`));
}

async function importDiscovery(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const q = args.q || args.query;
  if (!q) die(2, "-q <query> required for discovery import");
  const seeds = (Array.isArray(args.seed) ? args.seed : []) as string[];
  if (!seeds.length) die(2, "--seed <repo>... required (at least 1)");
  const server = await getServer(args);
  const limit = args.limit ? parseInt(String(args.limit)) : undefined;
  const search = await request<ImportCandidatesResponse>(server.base, "/api/prompts/import/discovery-search", {
    method: "POST",
    body: { q, seeds, ...(limit ? { limit } : {}) },
    timeoutMs: 120_000,
  }).catch(handle);
  const candidates = search.candidates || [];
  if (candidates.length === 0) { out(color.dim("(no candidates)")); return; }
  out(`${candidates.length} candidates`);
  if (args["dry-run"]) { json({ candidates }); return; }
  const commit = await request<ImportCommitResponse>(server.base, "/api/prompts/import/commit", {
    method: "POST",
    body: { candidates, ...(args.folder ? { folderId: args.folder } : {}) },
  }).catch(handle);
  if (args.json) { json(commit); return; }
  out(color.green(`✓ imported ${commit.imported || candidates.length}`));
}

async function importFolder(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const path = args.positional[0];
  if (!path) die(2, "usage: prompt import folder <path>");
  const server = await getServer(args);
  // Folder import body shapes are opaque (handled by buildFolderFiles/buildFolderPreview helpers).
  // Conservative attempt: send { source: { input: <path> } } and { paths } chains; surface server errors verbatim.
  const filesResp = await request<{ files?: { path?: string }[] }>(server.base, "/api/prompts/import/folder-files", {
    method: "POST",
    body: { source: { input: path }, input: path },
  }).catch(handle);
  const previewResp = await request<ImportCandidatesResponse>(server.base, "/api/prompts/import/folder-preview", {
    method: "POST",
    body: {
      source: { input: path }, input: path,
      files: filesResp.files,
      paths: (filesResp.files || []).map((f: { path?: string }) => f.path).filter(Boolean),
    },
  }).catch(handle);
  const candidates = previewResp.candidates || [];
  if (candidates.length === 0) { out(color.dim("(no candidates)")); return; }
  if (candidates.length > 100 && !args["dry-run"]) {
    if (!process.stdin.isTTY && !args.yes) die(2, `${candidates.length} candidates: pass --yes for non-TTY`);
    if (process.stdin.isTTY && !args.yes) {
      process.stdout.write(`Import ${candidates.length} prompts? [y/N] `);
      const ans = await readLine();
      if (!/^y(es)?$/i.test(ans.trim())) { out("(canceled)"); return; }
    }
  }
  out(`${candidates.length} candidates`);
  if (args["dry-run"]) { json({ candidates }); return; }
  const commit = await request<ImportCommitResponse>(server.base, "/api/prompts/import/commit", {
    method: "POST",
    body: { candidates, ...(args.folder ? { folderId: args.folder } : {}) },
  }).catch(handle);
  if (args.json) { json(commit); return; }
  out(color.green(`✓ imported ${commit.imported || candidates.length}`));
}

async function importJson(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const { text } = await readSourceArg(args.positional[0], "prompts.json");
  const parsed = JSON.parse(text) as { folders?: unknown; prompts?: unknown } | unknown[];
  const body = Array.isArray(parsed) ? { prompts: parsed } : { ...parsed };
  if (args.folder && Array.isArray(body.prompts)) {
    body.prompts = body.prompts.map((prompt) => (
      prompt && typeof prompt === "object"
        ? { ...(prompt as Record<string, unknown>), folderId: args.folder }
        : prompt
    ));
  }
  if (args["dry-run"]) {
    json({
      folders: Array.isArray(body.folders) ? body.folders.length : 0,
      prompts: Array.isArray(body.prompts) ? body.prompts.length : 0,
    });
    return;
  }
  const server = await getServer(args);
  const resp = await request(server.base, "/api/prompts/import", {
    method: "POST",
    body,
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(color.green("✓ imported prompt JSON"));
  out(JSON.stringify(resp, null, 2));
}

async function importPreview(argv: string[]) {
  const args = parseArgs(argv, { flags: COMMON_FLAGS });
  const { text, filename } = await readSourceArg(args.positional[0], "prompt-source.md");
  const server = await getServer(args);
  const resp = await request(server.base, "/api/prompts/import/preview", {
    method: "POST",
    body: {
      source: {
        kind: "local",
        filename: args.filename || filename,
        text,
      },
    },
  }).catch(handle);
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function buildSub(argv: string[]) {
  const mod = await import("./prompt-sub/build.js");
  return mod.default(argv);
}

const SUB: Record<string, (argv: string[]) => Promise<void>> = {
  ls: lsSub,
  show: showSub,
  create: createSub,
  edit: editSub,
  rm: rmSub,
  favorite: favoriteSub,
  export: exportSub,
  folder: folderSub,
  import: importSub,
  build: buildSub,
};

export default async function promptCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
  const handler = SUB[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
