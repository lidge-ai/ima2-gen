import { parseArgs, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { streamSse } from "../lib/sse.js";
import { fileToDataUri, dataUriToFile, defaultOutName } from "../lib/files.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { canonicalizeImageModel } from "../lib/model-aliases.js";
import { config } from "../../config.js";
import { deriveProviderIds } from "../../lib/providers/derive.js";
import { NAI_CLI_FLAGS, NAI_CLI_HELP, parseNaiCliOptions,
  unwrapNaiCliResult } from "../lib/nai-options.js";

const MAX_GENERATION_COUNT = Math.max(1, Math.trunc(Number(config.limits.maxGeneratedImages) || 24));
const PROVIDER_VALUES = ["auto", ...deriveProviderIds()];

const HELP = `
  ima2 node <subcommand> [options]

  Subcommands:
    generate <prompt...> [--parent <nodeId>] [--ref <file>...] [--provider <${PROVIDER_VALUES.join("|")}>] [--no-stream] [...gen-style flags]
    show <nodeId> [--json]

  Generate options:
    --image-tool-model <id> API only: gpt-image-2.5-sunburst|gpt-image-2.5-flare
    --quality <low|medium|high|xhigh|max> Extended quality requires an API 2.5 model
    --provider <${PROVIDER_VALUES.join("|")}>  Provider for this request
${NAI_CLI_HELP}
`;

const GEN_FLAGS = {
  "image-tool-model": { type: "string" },
  quality: { short: "q", type: "string", default: "low" },
  size:    { short: "s", type: "string", default: "1024x1024" },
  count:   { short: "n", type: "string", default: "1" },
  ref:     { type: "string", repeatable: true },
  out:     { short: "o", type: "string" },
  json:    { type: "boolean" },
  timeout: { type: "string", default: "600" },
  server:  { type: "string" },
  model:   { type: "string" },
  provider: { type: "string" },
  parent:  { type: "string" },
  "reasoning-effort": { type: "string" },
  "web-search":    { type: "boolean" },
  "no-web-search": { type: "boolean" },
  moderation: { type: "string", default: "low" },
  session: { type: "string" },
  "no-stream": { type: "boolean" },
  help: { short: "h", type: "boolean" },
  ...NAI_CLI_FLAGS,
};

const SHOW_FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  help: { short: "h", type: "boolean" },
};

async function getServer(args: ParsedArgs) {
  try { return await resolveServer({ serverFlag: args.server }); }
  catch (e: any) { die(exitCodeForError(e), e.message); throw e; }
}

async function generateSub(argv: string[]) {
  const args = parseArgs(argv, { flags: GEN_FLAGS });
  if (args.help) { out(HELP); return; }
  const naiPreflight = unwrapNaiCliResult(parseNaiCliOptions(args, "require-explicit"), Boolean(args.json));
  const prompt = args.positional.join(" ");
  if (!prompt) die(2, "prompt required");
  const refs = (Array.isArray(args.ref) ? args.ref : []) as string[];
  const VALID_PROVIDERS = new Set(PROVIDER_VALUES);
  const VALID_REASONING = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
  if (args.provider && !VALID_PROVIDERS.has(String(args.provider))) {
    die(2, `--provider must be one of: ${PROVIDER_VALUES.join(", ")}`);
  }
  if (args["reasoning-effort"] && !VALID_REASONING.has(String(args["reasoning-effort"]))) {
    die(2, "--reasoning-effort must be one of: none, low, medium, high, xhigh, max");
  }
  if (args["web-search"] && args["no-web-search"]) {
    die(2, "--web-search and --no-web-search are mutually exclusive");
  }
  const references = await Promise.all(refs.map((p: string) => fileToDataUri(p)));
  const server = await getServer(args);
  const body: any = {
    prompt,
    quality: args.quality,
    size: args.size,
    n: Math.max(1, Math.min(MAX_GENERATION_COUNT, parseInt(String(args.count)) || 1)),
    references,
    moderation: args.moderation,
    sessionId: args.session,
    ...naiPreflight.payload,
  };
  const model = canonicalizeImageModel(args.model);
  if (model) body.model = model;
  if (args.provider) body.provider = args.provider;
  if (args.parent) body.parentNodeId = args.parent;
  if (args["image-tool-model"]) body.imageToolModel = args["image-tool-model"];
  if (args["reasoning-effort"]) body.reasoningEffort = args["reasoning-effort"];
  if (args["no-web-search"]) body.webSearchEnabled = false;
  else if (args["web-search"]) body.webSearchEnabled = true;

  if (args["no-stream"]) {
    const resp: any = await request(server.base, "/api/node/generate", {
      method: "POST",
      body,
      timeoutMs: (parseInt(String(args.timeout)) || 600) * 1000,
    }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
    if (args.json) { json(resp); return; }
    out(color.green("✓ node ") + (resp?.node?.id || "(no id)"));
    return;
  }

  const ac = new AbortController();
  const onSig = () => { ac.abort(); process.exit(130); };
  process.once("SIGINT", onSig); process.once("SIGTERM", onSig);

  const url = `${server.base}/api/node/generate`;
  const images: any[] = [];
  let doneInfo: any = null;
  try {
    for await (const ev of streamSse(url, { body, signal: ac.signal })) {
      switch (ev.event) {
        case "phase":
          if (!args.json) out(color.dim(`[phase] ${ev.data.phase || ev.data}`));
          break;
        case "partial":
          if (!args.json) out(color.dim(`[partial #${ev.data.index ?? "?"}]`));
          break;
        case "image":
          images.push(ev.data);
          if (!args.json) out(color.green(`✓ image ${images.length}`));
          break;
        case "done":
          doneInfo = ev.data;
          break;
        case "error":
          die(1, `node generate error: ${ev.data.error || ev.data}${ev.data.code ? ` (${ev.data.code})` : ""}`);
      }
    }
  } catch (e: any) {
    if (e.name === "AbortError") return;
    die(exitCodeForError(e), `${e.message}${e.code ? ` (${e.code})` : ""}`);
  }

  const savedPaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    if (!im.image) continue;
    const target: string = args.out && i === 0
      ? String(args.out)
      : `${config.storage.generatedDir}/${defaultOutName(i, images.length)}`;
    await dataUriToFile(im.image, target);
    savedPaths.push(target);
  }
  if (args.json) {
    json({ ok: true, paths: savedPaths, doneInfo });
  } else {
    for (const p of savedPaths) out(color.green("✓ ") + p);
  }
}

async function showSub(argv: string[]) {
  const args = parseArgs(argv, { flags: SHOW_FLAGS });
  const id = args.positional[0];
  if (!id) die(2, "nodeId required");
  const server = await getServer(args);
  const resp = await request(server.base, `/api/node/${encodeURIComponent(id)}`).catch((e: unknown) => { const err = e as { message?: string }; die(exitCodeForError(e), err.message); });
  json(resp);
}

const SUB: Record<string, (argv: any[]) => Promise<void>> = {
  generate: generateSub,
  show: showSub,
};

export default async function nodeCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
  const handler = SUB[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
