import { parseArgs } from "../lib/args.js";
import { resolveServer, request, resolveHistoryReference } from "../lib/client.js";
import { fileToDataUri } from "../lib/files.js";
import { out, die, json, exitCodeForError } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";
import { config } from "../../config.js";
import { join } from "node:path";

const SPEC = {
  flags: {
    json: { type: "boolean" },
    server: { type: "string" },
    help: { short: "h", type: "boolean" },
  },
};

const HELP = `
  ima2 metadata <imagefile|@last> [--json] [--server <url>]

  Read embedded metadata from any local image file. @last uses the latest history image.
  POSTs { dataUrl } to /api/metadata/read.
`;

export default async function metadataCmd(argv: string[]) {
  const args = parseArgs(argv, SPEC);
  if (args.help) { out(HELP); return; }
  const file = args.positional[0];
  if (!file) die(2, "image file required");
  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
  let resolvedFile: string;
  try {
    const filename = await resolveHistoryReference(server.base, file);
    resolvedFile = file === "@last" ? join(config.storage.generatedDir, filename) : filename;
  } catch (e: unknown) {
    const err = e as { code?: unknown; message?: string } | null | undefined;
    die(err?.code === "HISTORY_EMPTY" ? 5 : exitCodeForError(e), err?.message || String(e));
  }
  const dataUrl = await fileToDataUri(resolvedFile);
  const resp = await request(server.base, "/api/metadata/read", {
    method: "POST",
    body: { dataUrl },
  }).catch((e: unknown) => {
    const err = e as { message?: string; code?: string };
    die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
  });
  if (args.json) { json(resp); }
  else out(JSON.stringify(resp, null, 2));
}
