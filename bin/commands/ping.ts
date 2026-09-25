import { parseArgs } from "../lib/args.js";
import { resolveServer } from "../lib/client.js";
import { out, die, color, json, exitCodeForError, exitFlushed } from "../lib/output.js";

import { errInfo } from "../../lib/errInfo.js";
const SPEC = {
  flags: {
    json:   { type: "boolean" },
    server: { type: "string" },
    help:   { short: "h", type: "boolean" },
  },
};

export default async function pingCmd(argv: string[]) {
  const args = parseArgs(argv, SPEC);
  if (args.help) { out("ima2 ping [--json] [--server <url>]"); return; }

  try {
    const { base, health } = await resolveServer({ serverFlag: args.server });
    const h = health;
    if (args.json) {
      json({ ok: true, base, ...h });
    } else {
      out(color.green("✓ ") + `${base}  v${h.version}  uptime ${h.uptimeSec}s  activeJobs ${h.activeJobs}`);
    }
  } catch (e) {
    const err = errInfo(e);
    if (args.json) { json({ ok: false, error: err.message, code: err.code }); exitFlushed(exitCodeForError(e)); }
    die(exitCodeForError(e), err.message);
  }
}
