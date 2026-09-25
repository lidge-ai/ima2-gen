import { readFile } from "fs/promises";
import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { readStdin } from "../lib/files.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";
import { getCliBrowserId } from "../lib/browser-id.js";

const HELP = `
  ima2 annotate <subcommand> <filename> [options]

  Subcommands:
    get <filename> [--json]
    set <filename> --body <json|@file|->
    rm  <filename> [--yes]
`;

const FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  yes: { type: "boolean" },
  body: { type: "string" },
  help: { short: "h", type: "boolean" },
};

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
}

async function resolveBody(value: unknown): Promise<unknown> {
  if (!value) return null;
  if (typeof value !== "string") return null;
  let text: string;
  if (value === "-") text = await readStdin();
  else if (value.startsWith("@")) text = await readFile(value.slice(1), "utf-8");
  else text = value;
  try { return JSON.parse(text); }
  catch { die(2, "--body must be valid JSON"); throw 0; }
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

async function getSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const filename = args.positional[0];
  if (!filename) die(2, "filename required");
  const server = await getServer(args);
  const browserId = getCliBrowserId();
  const resp = await request(server.base, `/api/annotations/${encodeURIComponent(filename)}`, {
    headers: { "X-Ima2-Browser-Id": browserId },
  }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
  json(resp);
}

async function setSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const filename = args.positional[0];
  if (!filename) die(2, "filename required");
  if (!args.body) die(2, "--body <json|@file|-> required");
  const body = await resolveBody(args.body);
  const server = await getServer(args);
  const browserId = getCliBrowserId();
  const resp = await request(server.base, `/api/annotations/${encodeURIComponent(filename)}`, {
    method: "PUT",
    body,
    headers: { "X-Ima2-Browser-Id": browserId },
  }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
  if (args.json) { json(resp); return; }
  out(color.green("✓ annotation saved"));
}

async function rmSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const filename = args.positional[0];
  if (!filename) die(2, "filename required");
  if (!args.yes && !process.stdin.isTTY) die(2, "destructive: pass --yes for non-TTY");
  if (!args.yes) {
    process.stdout.write(`Delete annotation for ${filename}? [y/N] `);
    const ans = await readLine();
    if (!/^y(es)?$/i.test(ans.trim())) { out("(canceled)"); return; }
  }
  const server = await getServer(args);
  const browserId = getCliBrowserId();
  await request(server.base, `/api/annotations/${encodeURIComponent(filename)}`, {
    method: "DELETE",
    headers: { "X-Ima2-Browser-Id": browserId },
  }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
  out(color.green("✓ deleted"));
}

const SUB: Record<string, (argv: string[]) => Promise<void>> = {
  get: getSub,
  set: setSub,
  rm: rmSub,
};

export default async function annotateCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
  const handler = SUB[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
