import { access, writeFile } from "fs/promises";
import { parseArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";

const HELP = `
  ima2 comfy graph <filename> [-o <out>] [--force] [--json]

  Writes a saved result as a ComfyUI graph (API format) that ComfyUI opens:
  drop the file on ComfyUI's canvas, or use Workflow > Open.

  A result ComfyUI made gives the graph ComfyUI ran, with the values it used:
  from inside the image, or from that server's job history for video and audio
  (the history is cleared when ComfyUI restarts). Any other result gives a
  two-node graph for the ima2 node pack that makes the same request again. Its
  max_usd is 0, so nothing is billed until you raise it on the node.
`;

const FLAGS = {
  json: { type: "boolean" }, server: { type: "string" }, out: { short: "o", type: "string" },
  force: { type: "boolean" }, help: { short: "h", type: "boolean" },
} as const;

interface GraphResponse { source?: string; graph?: Record<string, unknown>; notes?: string[] }

export async function graphSub(argv: string[]): Promise<void> {
  const args = parseArgs(argv, { flags: FLAGS });
  const filename = args.positional[0];
  if (args.help || !filename) { out(HELP); if (!args.help) die(2, "filename required"); return; }
  let base: string;
  try { base = (await resolveServer({ serverFlag: args.server })).base; }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); throw e; }
  const resp = await request<GraphResponse>(base, "/api/comfy/result-graph?filename=" + encodeURIComponent(filename), { method: "GET" })
    .catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); throw e; });
  const target = String(args.out || `${filename}.comfy.json`);
  if (!args.force) {
    const exists = await access(target).then(() => true, () => false);
    if (exists) die(2, `${target} already exists. Pass --force to overwrite.`);
  }
  // The file holds the graph alone: that is the shape ComfyUI opens.
  await writeFile(target, JSON.stringify(resp.graph ?? {}, null, 2));
  if (args.json) { json({ path: target, source: resp.source, notes: resp.notes ?? [] }); return; }
  out(color.green("✓ ") + target + "  (" + String(resp.source) + ")");
  for (const note of resp.notes ?? []) out("  " + note);
}

