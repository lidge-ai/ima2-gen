import { parseArgs } from "../lib/args.js";
import { resolveServer, request, resolveLastHistoryItem, type CliHistoryItem } from "../lib/client.js";
import { openUrl } from "../lib/platform.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { fileToDataUri } from "../lib/files.js";
import { config } from "../../config.js";

import { errInfo } from "../../lib/errInfo.js";
const SPEC = {
  flags: {
    json:   { type: "boolean" },
    reveal: { type: "boolean" },
    metadata: { type: "boolean" },
    server: { type: "string" },
    help:   { short: "h", type: "boolean" },
  },
};

export default async function showCmd(argv: string[]) {
  const args = parseArgs(argv, SPEC);
  if (args.help) { out("ima2 show <filename|@last> [--json] [--reveal] [--metadata] [--server <url>]"); return; }
  const name = args.positional[0];
  if (!name) die(2, "filename required");

  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e) {
    const err = errInfo(e); die(exitCodeForError(e), err.message); }

  let item: CliHistoryItem | undefined;
  try {
    if (name === "@last") item = await resolveLastHistoryItem(server.base);
    else {
      const resp = await request<{ items?: CliHistoryItem[] }>(server.base, "/api/history");
      const items: CliHistoryItem[] = resp.items || [];
      item = items.find((it) => it.filename === name || (it.filename && it.filename.endsWith(name)));
    }
  }
  catch (e) {
    const err = errInfo(e); die(err.code === "HISTORY_EMPTY" ? 5 : exitCodeForError(e), err.message); }
  if (!item) die(1, `not found: ${name}`);

  let metadata: unknown = null;
  if (args.metadata) {
    try {
      const dataUrl = await fileToDataUri(`${config.storage.generatedDir}/${item.filename}`);
      metadata = await request(server.base, "/api/metadata/read", {
        method: "POST",
        body: { dataUrl },
      });
    } catch (e: unknown) {
      out(color.dim(`(metadata unavailable: ${(e as { message?: string } | null)?.message || e})`));
    }
  }

  if (args.json) { json(args.metadata ? { ...item, metadata } : item); }
  else {
    out(color.bold(item.filename));
    out(color.dim(`  prompt:`)   + ` ${item.prompt || ""}`);
    out(color.dim(`  size:`)     + ` ${item.size || ""}  quality: ${item.quality || ""}`);
    if (item.createdAt) out(color.dim(`  when:`) + ` ${new Date(item.createdAt).toISOString()}`);
    if (item.url) out(color.dim(`  url:`) + ` ${server.base}${item.url}`);
    if (metadata) {
      out(color.dim(`  metadata:`));
      const dump = JSON.stringify(metadata, null, 2).split("\n").map(l => "    " + l).join("\n");
      out(dump);
    }
  }

  if (args.reveal) {
    const url = item.url ? `${server.base}${item.url}` : null;
    if (!url) { out(color.yellow("(no url)")); return; }
    const res = openUrl(url);
    if (!res.ok) out(color.yellow("(could not reveal)"));
  }
}
