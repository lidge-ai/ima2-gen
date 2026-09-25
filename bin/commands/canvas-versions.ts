import { readFile } from "fs/promises";
import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";

const HELP = `
  ima2 canvas-versions <subcommand> [options]

  Subcommands:
    save <imagefile> [--source <filename>] [--prompt <text>]
    update <filename> <imagefile> [--source <filename>] [--prompt <text>]

  Notes: server only exposes POST /api/canvas-versions (collection) and
  PUT /api/canvas-versions/:filename. No GET, no DELETE.
`;

const FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  source: { type: "string" },
  prompt: { type: "string" },
  help: { short: "h", type: "boolean" },
};

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
}

function buildHeaders(args: ParsedArgs) {
  const h: Record<string, string> = { "Content-Type": "image/png" };
  if (args.source) h["X-Ima2-Canvas-Source-Filename"] = String(args.source);
  if (args.prompt) h["X-Ima2-Canvas-Prompt"] = String(args.prompt);
  return h;
}

async function saveSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const file = args.positional[0];
  if (!file) die(2, "image file required");
  const buf = await readFile(file);
  const server = await getServer(args);
  const resp = await request(server.base, "/api/canvas-versions", {
    method: "POST",
    body: buf,
    raw: true,
    headers: buildHeaders(args),
  }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
  if (args.json) { json(resp); return; }
  out(color.green("✓ saved canvas version"));
}

async function updateSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const [filename, file] = args.positional;
  if (!filename || !file) die(2, "usage: canvas-versions update <filename> <imagefile>");
  const buf = await readFile(file);
  const server = await getServer(args);
  const resp = await request(server.base, `/api/canvas-versions/${encodeURIComponent(filename)}`, {
    method: "PUT",
    body: buf,
    raw: true,
    headers: buildHeaders(args),
  }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
  if (args.json) { json(resp); return; }
  out(color.green("✓ updated"));
}

const SUB: Record<string, (argv: string[]) => Promise<void>> = {
  save: saveSub,
  update: updateSub,
};

export default async function canvasVersionsCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
  const handler = SUB[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
