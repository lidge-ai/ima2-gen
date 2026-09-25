import { parseArgs } from "../lib/args.js";
import { resolveServer, request, type HistoryListResponse } from "../lib/client.js";
import { out, die, color, json, table, exitCodeForError } from "../lib/output.js";

import { errInfo } from "../../lib/errInfo.js";
const SPEC = {
  flags: {
    count:  { short: "n", type: "string", default: "20" },
    json:   { type: "boolean" },
    session: { type: "string" },
    favorites: { type: "boolean" },
    server: { type: "string" },
    help:   { short: "h", type: "boolean" },
  },
};

export default async function lsCmd(argv: string[]) {
  const args = parseArgs(argv, SPEC);
  if (args.help) {
    out("ima2 ls [-n count] [--session <id>] [--favorites] [--json] [--server <url>]");
    return;
  }

  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e) {
    const err = errInfo(e); die(exitCodeForError(e), err.message); }

  const limit = parseInt(String(args.count)) || 20;
  const qs = new URLSearchParams();
  if (args.session) qs.set("sessionId", String(args.session));
  if (args.favorites) qs.set("favoritesOnly", "1");
  qs.set("limit", String(limit));
  const path = `/api/history?${qs.toString()}`;
  let resp: HistoryListResponse;
  try { resp = await request<HistoryListResponse>(server.base, path); }
  catch (e) {
    const err = errInfo(e); die(exitCodeForError(e), err.message); }

  let items: Record<string, unknown>[] = (resp.items || resp.history || []);
  if (args.favorites) items = items.filter((it: Record<string, unknown>) => it.isFavorite === true);
  items = items.slice(0, limit);

  if (args.json) { json({ items }); return; }

  if (items.length === 0) {
    out(color.dim("(no history)"));
    return;
  }
  table(items, [
    { key: "filename", label: "FILENAME" },
    { key: "quality",  label: "Q" },
    { key: "size",     label: "SIZE" },
    { key: "createdAt", label: "WHEN", format: (v: unknown) => {
      if (!v) return "";
      const d = new Date(v as string);
      return d.toISOString().replace("T", " ").slice(0, 19);
    } },
    { key: "prompt", label: "PROMPT", format: (v: unknown) => {
      const s = String(v || "").replace(/\s+/g, " ");
      return s.length > 48 ? s.slice(0, 45) + "…" : s;
    } },
  ]);
}
