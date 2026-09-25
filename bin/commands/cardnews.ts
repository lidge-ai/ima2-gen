import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request, type JsonRecord } from "../lib/client.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";
import { config as runtimeConfig } from "../../config.js";

const HELP = `
  ima2 cardnews <subcommand> [options]

  Subcommands:
    templates                              List image-templates + role-templates
    template preview <templateId>          Preview an image template
    sets                                   List card news sets
    set show <setId>                       Show a set
    set manifest <setId>                   Show a set manifest
    draft [--data <json>]                  Create a draft
    generate [--data <json>]               Run generation
    job create [--data <json>]             Create and start a job
    job show <jobId>                       Show a job
    job retry <jobId> [--cards <id,...>]   Retry a job (optionally specific cards)
    card regenerate <cardId> [--data <json>]  Regenerate a single card
    export [--data <json>]                 Export a bundle

  Note: Card News must be enabled (IMA2_CARD_NEWS=1 or features.cardNews: true in config.json).

  Options:
    --data <json>   JSON body to send (for draft/generate/job create/card regenerate/export)
    --cards <ids>   Comma-separated card IDs for job retry
    --json          Output raw JSON
    --server <url>  Override server URL
`;

const FLAGS = {
  json:   { type: "boolean" },
  server: { type: "string" },
  data:   { type: "string" },
  cards:  { type: "string" },
  help:   { short: "h", type: "boolean" },
};

function ensureCardNewsEnabled() {
  if (!runtimeConfig.features?.cardNews) {
    die(2, "Card News feature is disabled. Set IMA2_CARD_NEWS=1 (or features.cardNews: true in config.json) and restart the server.");
  }
}

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
}

function parseData(raw: unknown): unknown {
  if (!raw) return {};
  if (typeof raw !== "string") return {};
  try { return JSON.parse(raw); }
  catch { die(2, `--data must be valid JSON`); }
}

async function templatesSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  if (args.help) { out(HELP); return; }
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const [imgTemplates, roleTemplates] = await Promise.all([
    request(server.base, "/api/cardnews/image-templates")
      .catch((e) => die(exitCodeForError(e), e.message)),
    request(server.base, "/api/cardnews/role-templates")
      .catch((e) => die(exitCodeForError(e), e.message)),
  ]);
  if (args.json) { json({ imageTemplates: imgTemplates, roleTemplates }); return; }
  out(color.bold("Image templates:"));
  out(JSON.stringify(imgTemplates, null, 2));
  out(color.bold("Role templates:"));
  out(JSON.stringify(roleTemplates, null, 2));
}

async function templatePreviewSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const templateId = args.positional[0];
  if (!templateId) die(2, "templateId required");
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const resp = await request(server.base, `/api/cardnews/image-templates/${encodeURIComponent(templateId)}/preview`)
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function setsSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const resp = await request(server.base, "/api/cardnews/sets")
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function setShowSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const setId = args.positional[0];
  if (!setId) die(2, "setId required");
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const resp = await request(server.base, `/api/cardnews/sets/${encodeURIComponent(setId)}`)
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function setManifestSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const setId = args.positional[0];
  if (!setId) die(2, "setId required");
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const resp = await request(server.base, `/api/cardnews/sets/${encodeURIComponent(setId)}/manifest`)
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function draftSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const body = parseData(args.data);
  const resp = await request(server.base, "/api/cardnews/draft", { method: "POST", body })
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function generateSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const body = parseData(args.data);
  const resp = await request(server.base, "/api/cardnews/generate", { method: "POST", body })
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function jobCreateSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const body = parseData(args.data);
  const resp = await request(server.base, "/api/cardnews/jobs", { method: "POST", body })
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function jobShowSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const jobId = args.positional[0];
  if (!jobId) die(2, "jobId required");
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const resp = await request(server.base, `/api/cardnews/jobs/${encodeURIComponent(jobId)}`)
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(JSON.stringify(resp, null, 2));
}

async function jobRetrySub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const jobId = args.positional[0];
  if (!jobId) die(2, "jobId required");
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const body: JsonRecord = {};
  if (args.cards) body.cardIds = String(args.cards).split(",").map((s: string) => s.trim()).filter(Boolean);
  const resp = await request(server.base, `/api/cardnews/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST", body })
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + "retry requested");
  if (resp && typeof resp === "object" && Object.keys(resp).length > 0) out(JSON.stringify(resp, null, 2));
}

async function cardRegenerateSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const cardId = args.positional[0];
  if (!cardId) die(2, "cardId required");
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const body = parseData(args.data);
  const resp = await request(server.base, `/api/cardnews/cards/${encodeURIComponent(cardId)}/regenerate`, { method: "POST", body })
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + "regeneration started");
  if (resp && typeof resp === "object" && Object.keys(resp).length > 0) out(JSON.stringify(resp, null, 2));
}

async function exportSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  ensureCardNewsEnabled();
  const server = await getServer(args);
  const body = parseData(args.data);
  const resp = await request(server.base, "/api/cardnews/export", { method: "POST", body })
    .catch((e) => die(exitCodeForError(e), e.message));
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + "export requested");
  if (resp && typeof resp === "object" && Object.keys(resp).length > 0) out(JSON.stringify(resp, null, 2));
}

type Sub = (argv: string[]) => Promise<void>;

export default async function cardnewsCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }

  if (sub === "template") {
    const s2 = argv[1];
    if (s2 === "preview") return templatePreviewSub(argv.slice(2));
    die(2, `unknown subcommand: template ${s2 || ""}\n${HELP}`);
  }
  if (sub === "set") {
    const s2 = argv[1];
    const SET_SUB: Record<string, Sub> = { show: setShowSub, manifest: setManifestSub };
    const handler = s2 ? SET_SUB[s2] : undefined;
    if (!handler) die(2, `unknown subcommand: set ${s2 || ""}\n${HELP}`);
    return handler(argv.slice(2));
  }
  if (sub === "job") {
    const s2 = argv[1];
    const JOB_SUB: Record<string, Sub> = { create: jobCreateSub, show: jobShowSub, retry: jobRetrySub };
    const handler = s2 ? JOB_SUB[s2] : undefined;
    if (!handler) die(2, `unknown subcommand: job ${s2 || ""}\n${HELP}`);
    return handler(argv.slice(2));
  }
  if (sub === "card") {
    const s2 = argv[1];
    if (s2 === "regenerate") return cardRegenerateSub(argv.slice(2));
    die(2, `unknown subcommand: card ${s2 || ""}\n${HELP}`);
  }

  const FLAT: Record<string, Sub> = {
    templates: templatesSub,
    sets: setsSub,
    draft: draftSub,
    generate: generateSub,
    export: exportSub,
  };
  const handler = FLAT[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
