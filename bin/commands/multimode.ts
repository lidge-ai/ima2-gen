import { parseArgs } from "../lib/args.js";
import { resolveServer } from "../lib/client.js";
import { streamSse } from "../lib/sse.js";
import { dataUriToFile, defaultOutName, fileToDataUri } from "../lib/files.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { config } from "../../config.js";
import { createCliRequestId, recoverGeneratedOutputs, formatRecoveryHint } from "../lib/recover-output.js";
import { canonicalizeImageModel } from "../lib/model-aliases.js";
import { deriveCliImageModelSet, deriveProviderIds } from "../../lib/providers/derive.js";
import { NAI_CLI_FLAGS, NAI_CLI_HELP, parseNaiCliOptions,
  unwrapNaiCliResult } from "../lib/nai-options.js";

const MAX_GENERATION_COUNT = Math.max(1, Math.trunc(Number(config.limits.maxGeneratedImages) || 24));
const MAX_REFERENCE_COUNT = Math.max(1, Math.trunc(Number(config.limits.maxRefCount) || 5));
const PROVIDER_VALUES = ["auto", ...deriveProviderIds()];
// Same derivation edit.ts already uses; this list was hand-maintained until now.
const KNOWN_IMAGE_MODELS = deriveCliImageModelSet();

const SPEC = {
  flags: {
    "image-tool-model": { type: "string" },
    quality: { short: "q", type: "string", default: "low" },
    size:    { short: "s", type: "string", default: "1024x1024" },
    "max-images": { type: "string" },
    count: { short: "n", type: "string" },
    out:     { short: "o", type: "string" },
    "out-dir": { short: "d", type: "string" },
    json:    { type: "boolean" },
    timeout: { type: "string", default: "600" },
    server:  { type: "string" },
    model:   { type: "string" },
    provider: { type: "string" },
    mode: { type: "string", default: "auto" },
    ref: { type: "string", repeatable: true },
    "reasoning-effort": { type: "string" },
    "web-search":    { type: "boolean" },
    "no-web-search": { type: "boolean" },
    moderation: { type: "string", default: "low" },
    session: { type: "string" },
    "show-partial": { type: "boolean" },
    help: { short: "h", type: "boolean" },
    ...NAI_CLI_FLAGS,
  },
};

const HELP = `
  ima2 multimode <prompt...> [options]

  Stream multi-image generation via SSE (phase / partial / image / done / error).

  Options:
    -q, --quality <low|medium|high|xhigh|max>     Default: low
    -s, --size <WxH>                    Default: 1024x1024
    -n, --count <1..${MAX_GENERATION_COUNT}>                 Default: 4
        --max-images <1..${MAX_GENERATION_COUNT}>            Alias for --count
    -o, --out <file>                    First image (implies --max-images 1)
    -d, --out-dir <dir>                 Output dir for multiple images
        --json
        --model <${[...KNOWN_IMAGE_MODELS].join("|")}>  Default: gpt-6-luna
                                      Aliases: luna, astra, sol, terra, spark
        --image-tool-model <id>       API only: gpt-image-2.5-sunburst|gpt-image-2.5-flare
        --provider <${PROVIDER_VALUES.join("|")}>
                                      Provider (oauth = GPT OAuth; grok = xAI Grok; agy/gemini-api = Gemini)
        --mode <auto|direct>            Prompt handling mode. Default: auto
        --ref <file>                    Attach reference image (repeatable, max ${MAX_REFERENCE_COUNT})
        --reasoning-effort <none|low|medium|high|xhigh|max>
        --web-search / --no-web-search
        --moderation <auto|low>
        --session <id>
        --show-partial                  Print [partial #N received] notices
        --timeout <sec>                 Default: 600
        --server <url>                  Override server URL
${NAI_CLI_HELP}
`;

export default async function multimodeCmd(argv: string[]) {
  const hasCount = argv.some((value) => value === "-n" || value === "--count" || value.startsWith("--count="));
  const hasMaxImages = argv.some((value) => value === "--max-images" || value.startsWith("--max-images="));
  if (hasCount && hasMaxImages) die(2, "--count and --max-images are mutually exclusive");
  const args = parseArgs(argv, SPEC);
  if (args.help) { out(HELP); return; }
  const naiPreflight = unwrapNaiCliResult(parseNaiCliOptions(args, "require-explicit"), Boolean(args.json));
  const prompt = args.positional.join(" ");
  if (!prompt) die(2, "prompt required");

  const VALID_PROVIDERS = new Set(PROVIDER_VALUES);
  const VALID_MODES = new Set(["auto", "direct"]);
  const VALID_REASONING = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
  if (args.provider && !VALID_PROVIDERS.has(String(args.provider))) {
    die(2, `--provider must be one of: ${PROVIDER_VALUES.join(", ")}`);
  }
  if (!VALID_MODES.has(String(args.mode))) die(2, "--mode must be one of: auto, direct");
  if (args["reasoning-effort"] && !VALID_REASONING.has(String(args["reasoning-effort"]))) {
    die(2, "--reasoning-effort must be one of: none, low, medium, high, xhigh, max");
  }
  if (args["web-search"] && args["no-web-search"]) {
    die(2, "--web-search and --no-web-search are mutually exclusive");
  }

  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e: any) { die(exitCodeForError(e), e.message); throw e; }

  const maxImages = Math.max(1, Math.min(MAX_GENERATION_COUNT, parseInt(String(args.count ?? args["max-images"])) || 4));
  const refs = (Array.isArray(args.ref) ? args.ref : []) as string[];
  if (refs.length > MAX_REFERENCE_COUNT) die(2, `max ${MAX_REFERENCE_COUNT} --ref attachments`);
  const references = await Promise.all(refs.map((p: string) => fileToDataUri(p)));
  const outDir = args["out-dir"] ? String(args["out-dir"]) : null;
  const explicitOut = args.out ? String(args.out) : null;
  const requestId = createCliRequestId("req_cli_multimode");
  const timeoutMs = (parseInt(String(args.timeout)) || 600) * 1000;

  const body: any = {
    prompt,
    quality: args.quality,
    size: args.size,
    maxImages,
    mode: args.mode,
    references,
    moderation: args.moderation,
    sessionId: args.session,
    requestId,
    ...naiPreflight.payload,
  };
  const model = canonicalizeImageModel(args.model);
  if (model) body.model = model;
  if (args.provider) body.provider = args.provider;
  if (args["image-tool-model"]) body.imageToolModel = args["image-tool-model"];
  if (args["reasoning-effort"]) body.reasoningEffort = args["reasoning-effort"];
  if (args["no-web-search"]) body.webSearchEnabled = false;
  else if (args["web-search"]) body.webSearchEnabled = true;

  const ac = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  const onSig = () => { ac.abort(); process.exit(130); };
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);

  const url = `${server.base}/api/generate/multimode`;
  const images: any[] = [];
  let doneInfo: any = null;
  try {
    for await (const ev of streamSse(url, { body, signal: ac.signal, headers: { "X-Request-Id": requestId } })) {
      switch (ev.event) {
        case "phase":
          if (!args.json) out(color.dim(`[phase] ${ev.data.phase} (max ${ev.data.maxImages ?? maxImages})`));
          break;
        case "partial":
          if (args["show-partial"] && !args.json) {
            const len = (ev.data.image || "").length;
            out(color.dim(`[partial #${ev.data.index}] (${len}B preview)`));
          }
          break;
        case "image":
          images.push(ev.data);
          if (!args.json) out(color.green(`✓ image ${images.length}`));
          break;
        case "done":
          doneInfo = ev.data;
          break;
        case "error":
          die(1, `multimode error: ${ev.data.error || ev.data}${ev.data.code ? ` (${ev.data.code})` : ""}`);
      }
    }
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || (e.name === "AbortError" && timedOut);
    if (e.name === "AbortError" && !timedOut) return;
    if (isTimeout && (explicitOut || outDir)) {
      const result = await recoverGeneratedOutputs(server.base, requestId, {
        explicitOut,
        outDir,
        expectedCount: maxImages,
        json: Boolean(args.json),
      });
      if (result.recovered) {
        if (args.json) {
          json({ ok: true, requestId, recovered: true, paths: result.paths });
        } else {
          out(formatRecoveryHint(result));
          for (const p of result.paths) out(color.green("✓ ") + p + color.dim(" (recovered)"));
        }
        return;
      }
      if (!args.json) out(formatRecoveryHint(result));
    }
    die(exitCodeForError(e), `${e.message}${e.code ? ` (${e.code})` : ""}`);
  } finally {
    clearTimeout(timeoutTimer);
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }

  // Save images
  if (explicitOut && images.length > 1) {
    if (!args.json) out(color.yellow(`(received ${images.length} images, --out only saves first)`));
  }

  const savedPaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    if (!im.image) continue;
    let target;
    if (explicitOut && i === 0) target = explicitOut;
    else if (outDir) target = `${outDir}/${defaultOutName(i, images.length)}`;
    else target = `${config.storage.generatedDir}/${defaultOutName(i, images.length)}`;
    if (target) {
      await dataUriToFile(im.image, target);
      savedPaths.push(target);
    }
  }

  if (args.json) {
    json({ ok: true, requestId: doneInfo?.requestId, returned: doneInfo?.returned, paths: savedPaths });
  } else {
    for (const p of savedPaths) out(color.green("✓ ") + p);
    if (doneInfo) out(color.dim(`done: ${doneInfo.returned}/${doneInfo.requested ?? maxImages}`));
  }
}
