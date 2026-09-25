import { parseArgs } from "../lib/args.js";
import { resolveServer, fetchServer } from "../lib/client.js";
import { streamSse, sseFields } from "../lib/sse.js";
import { out, die, color, exitCodeForError, fail } from "../lib/output.js";
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { runVideoGenerate } from "../lib/videoMcp.js";
import {
  GROK_VIDEO_MODEL_15,
  GROK_VIDEO_MODEL_15_PREVIEW_ALIAS,
  GROK_VIDEO_MODEL_BASE,
  MAX_VIDEO_DURATION,
  MIN_VIDEO_DURATION,
  validateVideoResolutionForRequest,
  type VideoMode,
  type VideoResolution,
} from "../../lib/imageModels.js";
import { VIDEO_CLIENT_TIMEOUT_SEC } from "../../lib/videoClientTimeouts.js";
import { deriveVideoProviderIds } from "../../lib/providers/derive.js";
import { listProviders } from "../../lib/mcp/providerRegistry.js";

/**
 * Video-capable lanes, derived rather than typed out.
 *
 * Core lanes qualify by declaring a video model or by holding their catalog at
 * runtime; MCP lanes come from the discovery layer. Hand-maintaining this was
 * how comfy went missing from the skill docs after it gained video support.
 */
const VIDEO_PROVIDER_VALUES = [
  ...deriveVideoProviderIds(),
  ...listProviders([]).map((provider) => provider.id),
];

const VALID_RESOLUTIONS = new Set(["480p", "720p", "1080p"]);
const VALID_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "auto"]);
const VALID_MODELS = new Set([GROK_VIDEO_MODEL_BASE, GROK_VIDEO_MODEL_15, GROK_VIDEO_MODEL_15_PREVIEW_ALIAS]);
const ACTIVE_VIDEO_PROMPT_GUIDANCE = "Active video prompt required: describe visual flow, motion flow, sound/no-music intent, dialogue/no-dialogue intent, and the desired ending frame. Pace the scene to naturally fill the selected duration with an opening composition, connected motion/emotion change, and stable ending frame.";

function canonicalVideoModel(model: string): string {
  return model === GROK_VIDEO_MODEL_15_PREVIEW_ALIAS ? GROK_VIDEO_MODEL_15 : model;
}

function validateCliVideoResolution(model: string, resolution: string, mode: VideoMode): void {
  const check = validateVideoResolutionForRequest(canonicalVideoModel(model), resolution as VideoResolution, mode, {
    allowTextCanvasShim: true,
  });
  if (!("ok" in check)) die(2, check.error);
}

function parseIntegerFlag(value: unknown, fallback: number, label: string): number {
  const raw = value === undefined ? String(fallback) : String(value);
  if (!/^\d+$/.test(raw)) die(2, `${label} must be an integer`);
  return Number(raw);
}

function rejectUnknownFlags(args: { _unknown?: string[] }): void {
  if (args._unknown?.length) die(2, `unknown option: ${args._unknown[0]}`);
}

async function readJsonResponse(res: Response, label: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    die(1, `${label} failed: expected JSON response, got ${text.slice(0, 120) || `HTTP ${res.status}`}`);
  }
}

function parseTimeoutSeconds(seconds: unknown): number {
  const sec = parseIntegerFlag(seconds, VIDEO_CLIENT_TIMEOUT_SEC, "--timeout");
  if (sec < 1) die(2, "--timeout must be at least 1");
  return sec;
}

function timeoutSignal(seconds: unknown): AbortSignal {
  const sec = parseTimeoutSeconds(seconds);
  return AbortSignal.timeout(sec * 1000);
}

async function writeBuffer(path: string, buf: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  await writeFile(path, buf);
}

async function downloadReturnedVideo(serverBase: string, data: Record<string, unknown>, outPath: string, signal: AbortSignal): Promise<void> {
  const rawUrl = typeof data.url === "string" ? data.url : "";
  if (!rawUrl) die(1, "server did not return a video url");
  let url: URL;
  try {
    url = new URL(rawUrl, `${serverBase}/`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { die(1, "server returned an invalid video url"); }
  // External signed media retains its query, but never inherits server credentials.
  const res = url.origin === new URL(serverBase).origin
    ? await fetchServer(serverBase, url.href, { signal })
    : await fetch(url.href, { signal, credentials: "omit", redirect: "error" });
  if (!res.ok) die(1, `failed to download video: HTTP ${res.status}`);
  await writeBuffer(outPath, Buffer.from(await res.arrayBuffer()));
}

const SPEC = {
  flags: {
    duration:      { type: "string" },
    resolution:    { type: "string" },
    "aspect-ratio": { type: "string" },
    model:         { type: "string" },
    provider:      { type: "string" },
    "planner-model": { type: "string" },
    bg:            { type: "string" },
    storyboard:    { type: "boolean" },
    topic:         { type: "string" },
    start:         { type: "string" },
    end:           { type: "string" },
    ref:           { type: "string", repeatable: true },
    voice:         { type: "string", repeatable: true },
    "as-reference": { type: "boolean" },
    "video-ref":   { type: "string" },
    character:     { type: "string" },
    out:           { short: "o", type: "string" },
    "out-dir":     { short: "d", type: "string" },
    json:          { type: "boolean" },
    timeout:       { type: "string", default: String(VIDEO_CLIENT_TIMEOUT_SEC) },
    server:        { type: "string" },
    session:       { type: "string" },
    help:          { short: "h", type: "boolean" },
  },
};

const HELP = `
  ima2 video <prompt...> [options]
  ima2 video edit <prompt> --video <url|file_id|generated-file>
  ima2 video extend <prompt> --video <url|file_id|generated-file> [--duration 6]
  ima2 video continue <prompt> --video <generated-file>
  ima2 video frame <file> [--last] [-o output.png]
  ima2 video analyze <generated-file>

  Generate video through a configured Grok or MCP lane; edit/extend/analyze remain Grok-only.
  Set a default with 'ima2 defaults set video <lane>/<model>' or inspect lanes with 'ima2 models'.

  Subcommands:
    (default)   Generate video (T2V / I2V / Ref2V)
    edit        Edit existing video with text prompt (V2V)
    extend      Continue video from last frame
    continue    Generate a new I2V clip from a generated video's last frame with lineage
    frame       Extract a frame from video (requires ffmpeg on server)
    analyze     Analyze video with Grok 4.3 vision

  Options (generate mode):
        --duration <1..15>              Duration in seconds. Default: 5. Prompt motion should naturally fill this length
        --resolution <480p|720p|1080p>  Default: 480p. Default model: grok-imagine-video-1.5; prompt-only 1080p uses a white-canvas I2V shim
        --aspect-ratio <ratio|auto>     1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto. Default: auto
        --model <model|lane/model>      Bare IDs must be unique across lanes; Grok preview alias accepted
        --provider <${VIDEO_PROVIDER_VALUES.join("|")}>
                                        'auto' was removed; choose a lane explicitly
        --planner-model <name>          Planner model override (e.g. grok-4.5, gpt-5.6-luna)
        --storyboard                    Enable storyboard mode (maintains character/scene continuity)
        --topic <text>                  Series topic for prompt chain continuity
        --start <generated-filename>    MCP start frame
        --end <generated-filename>      MCP end frame; requires --start
        --ref <file|@last|file:tag>     Grok image input or MCP tagged image reference
        --voice <voice-id>              Preset voice for the subject (grok-imagine-video-1.5,
                                        repeatable, max 3). e.g. eve, leo, rex, luna, atlas.
                                        An unknown id returns the full list of valid voices
        --as-reference                  With exactly one --ref, guide a new scene instead of
                                        animating that image. Ignored for 0 or 2+ refs
                                        Repeatable: Grok max 7, MCP max 3
        --video-ref <generated-filename> MCP V2V/restyle reference video
        --character <element-id|name>      MCP lanes only: character binding element
    -o, --out <file>                    Output file path
    -d, --out-dir <dir>                 Output directory
        --json                          Print JSON result to stdout
        --timeout <sec>                 Default: 5400
        --server <url>                  Override server URL
        --session <id>                  Session ID

  Edit/extend subcommands:
        --video <value>                 HTTPS URL, xAI file_id, data URL, or generated filename
        --duration <2..10>              Extension duration only. Default: 6

  Grok modes (from --ref count, and --as-reference when there is exactly one):
    0 refs                    → text-to-video
    1 ref                     → image-to-video (that image is the opening frame)
    1 ref + --as-reference    → reference-to-video (guides a new scene instead)
    2-7 refs                  → reference-to-video (max 720p)

  Examples:
    ima2 video "a cat playing piano"
    ima2 video "animate this" --ref photo.png --duration 10
    ima2 video edit "make it sunset" --video https://vidgen.x.ai/.../clip.mp4
    ima2 video extend "camera pulls back" --video https://vidgen.x.ai/.../clip.mp4 --duration 5
    ima2 video continue "she turns back as the music cuts to room tone" --video 1780226256355_50252101.mp4
    ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png
    ima2 video analyze 1780226256355_50252101.mp4
`;

export default async function videoCmd(argv: string[]) {
  try { await dispatchVideo(argv); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    fail({ json: argv.includes("--json"), code: (error as { code?: string }).code ?? "VIDEO_FAILED",
      message: error.message, exitCode: exitCodeForError(error) });
  }
}

async function dispatchVideo(argv: string[]) {
  const sub = argv[0];
  if (sub === "edit") return videoEditCmd(argv.slice(1));
  if (sub === "extend") return videoExtendCmd(argv.slice(1));
  if (sub === "continue") return videoContinueCmd(argv.slice(1));
  if (sub === "frame") return videoFrameCmd(argv.slice(1));
  if (sub === "analyze") return videoAnalyzeCmd(argv.slice(1));

  const args = parseArgs(argv, SPEC);
  rejectUnknownFlags(args);
  if (args.help) { out(HELP); return; }

  const prompt = args.positional.join(" ");
  if (!prompt.trim()) die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
  if (args.duration !== undefined) parseIntegerFlag(args.duration, 5, "--duration");
  return runVideoGenerate(argv, args, prompt);
}

function renderBar(pct: number): string {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  return color.green("█".repeat(filled)) + color.dim("░".repeat(width - filled));
}

async function runVideoGenerateRequest(serverBase: string, body: Record<string, unknown>, timeout: unknown, silent: boolean): Promise<Record<string, unknown>> {
  let doneData: Record<string, unknown> | null = null;
  let lastProgress = -1;
  for await (const ev of streamSse(`${serverBase}/api/video/generate`, {
    body: { provider: "grok", ...body },
    signal: timeoutSignal(timeout),
    headers: typeof body.requestId === "string" ? { "X-Request-Id": body.requestId } : undefined,
  })) {
    const data = sseFields(ev.data);
    if (ev.event === "progress") {
      const pct = typeof data.progress === "number" ? Math.round(data.progress * 100) : null;
      if (pct !== null && pct !== lastProgress && !silent) {
        process.stdout.write(`\r  ${renderBar(pct)} ${pct}%`);
        lastProgress = pct;
      }
    } else if (ev.event === "done") {
      if (!silent && lastProgress >= 0) process.stdout.write("\n");
      doneData = data;
    } else if (ev.event === "error") {
      if (!silent && lastProgress >= 0) process.stdout.write("\n");
      die(1, `video error: ${data.error || ev.data}${data.guidance ? `\n${data.guidance}` : ""}${data.code ? ` (${data.code})` : ""}`);
    }
  }
  if (!doneData) die(1, "server did not return a video result");
  return doneData;
}

// --- Subcommands ---

async function videoEditCmd(argv: string[]) {
  const spec = { flags: { video: { type: "string" }, out: { short: "o", type: "string" }, output: { type: "string" }, json: { type: "boolean" }, timeout: { type: "string", default: String(VIDEO_CLIENT_TIMEOUT_SEC) }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  rejectUnknownFlags(args);
  // Limits: 8.7s input is the owner's own measurement (docs/grok-video-i2v-research.md,
  // 2026-05-30) and appears in no xAI doc — keep it. The 1.5 rejection and the
  // ignored duration/resolution were live-probed against api.x.ai on 2026-08-20.
  // Details + full probe table: skills/ima2/SKILL.md "Provenance of the limits above".
  if (args.help) { out(`  ima2 video edit <prompt> --video <url|file_id|generated-file>\n\n  Edit existing video with text prompt (real V2V).\n  Model: grok-imagine-video only (1.5 rejects edits). Input: mp4, max 8.7s.\n  Output inherits the source video's duration and resolution (max 720p).\n\n  Options:\n        --video <value>   Source video HTTPS URL, xAI file_id, data URL, or generated filename (required)\n    -o, --out <file>      Download edited video to file\n        --output <file>   Alias for --out\n        --json            Print JSON result\n        --timeout <sec>   Default: 5400\n        --server <url>    Override server URL`); return; }
  const prompt = args.positional.join(" ");
  if (!prompt.trim()) die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
  if (!args.video) die(2, "--video <url> is required");
  parseTimeoutSeconds(args.timeout);
  const server = await resolveServer({ serverFlag: args.server });
  const res = await fetchServer(server.base, "/api/video/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, videoUrl: args.video }), signal: timeoutSignal(args.timeout) });
  const data = await readJsonResponse(res, "edit");
  if (!res.ok) die(1, `edit failed: ${data.error ?? res.status}`);
  const outPath = (args.out || args.output) as string | undefined;
  if (outPath) await downloadReturnedVideo(server.base, data, outPath, timeoutSignal(args.timeout));
  if (args.json) { out(JSON.stringify(data, null, 2)); } else { out(color.green("✓ ") + `Edited video: ${data.url}`); }
}

async function videoExtendCmd(argv: string[]) {
  const spec = { flags: { video: { type: "string" }, duration: { type: "string", default: "6" }, out: { short: "o", type: "string" }, output: { type: "string" }, json: { type: "boolean" }, timeout: { type: "string", default: String(VIDEO_CLIENT_TIMEOUT_SEC) }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  rejectUnknownFlags(args);
  if (args.help) { out(`  ima2 video extend <prompt> --video <url|file_id|generated-file> [--duration 6]\n\n  Extend video from its last frame.\n  Model: grok-imagine-video only (1.5 rejects extensions). Extension: 1-15s.\n  duration is the length of the ADDED segment, not the total output.\n\n  Options:\n        --video <value>   Source video HTTPS URL, xAI file_id, data URL, or generated filename (required)\n        --duration <1-15> Added-segment duration (default: 6)\n    -o, --out <file>      Download extended video to file\n        --output <file>   Alias for --out\n        --json            Print JSON result\n        --timeout <sec>   Default: 5400\n        --server <url>    Override server URL`); return; }
  const prompt = args.positional.join(" ");
  if (!prompt.trim()) die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
  if (!args.video) die(2, "--video <url> is required");
  const duration = parseIntegerFlag(args.duration, 6, "--duration");
  // Measured 1-15, not the documented 2-10: the endpoint accepts 1 and 11 and refuses
  // only 0 and 16. devlog/_plan/260908_xai_imagine_spec_resync/000_research.md (D11)
  if (duration < MIN_VIDEO_DURATION || duration > MAX_VIDEO_DURATION) die(2, `--duration must be between ${MIN_VIDEO_DURATION} and ${MAX_VIDEO_DURATION}`);
  parseTimeoutSeconds(args.timeout);
  const server = await resolveServer({ serverFlag: args.server });
  const res = await fetchServer(server.base, "/api/video/extend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, videoUrl: args.video, duration }), signal: timeoutSignal(args.timeout) });
  const data = await readJsonResponse(res, "extend");
  if (!res.ok) die(1, `extend failed: ${data.error ?? res.status}`);
  const outPath = (args.out || args.output) as string | undefined;
  if (outPath) await downloadReturnedVideo(server.base, data, outPath, timeoutSignal(args.timeout));
  if (args.json) { out(JSON.stringify(data, null, 2)); } else { out(color.green("✓ ") + `Extended video (${data.duration}s): ${data.url}`); }
}

async function videoContinueCmd(argv: string[]) {
  const spec = {
    flags: {
      video: { type: "string" },
      duration: { type: "string", default: "5" },
      resolution: { type: "string", default: "720p" },
      "aspect-ratio": { type: "string", default: "auto" },
      model: { type: "string" },
      "planner-model": { type: "string" },
      storyboard: { type: "boolean" },
      out: { short: "o", type: "string" },
      output: { type: "string" },
      json: { type: "boolean" },
      timeout: { type: "string", default: String(VIDEO_CLIENT_TIMEOUT_SEC) },
      server: { type: "string" },
      help: { short: "h", type: "boolean" },
    },
  };
  const args = parseArgs(argv, spec);
  rejectUnknownFlags(args);
  if (args.help) {
    out(`  ima2 video continue <prompt> --video <generated-file>\n\n  Generate a new clip from a generated video's last frame and carry branch-local revisedPrompt lineage.\n\n  Prompt must describe visual flow, motion, sound/music/no-music, dialogue/no-dialogue, ending frame, and how the selected duration should feel naturally filled.\n\n  Options:\n        --video <file>                 Generated .mp4 filename (required)\n        --duration <1..15>             Default: 5. Prompt motion should naturally fill this length\n        --resolution <480p|720p|1080p> Default: 720p. 1080p requires --model grok-imagine-video-1.5\n        --aspect-ratio <ratio|auto>    Default: auto\n        --model <name>                 grok-imagine-video, grok-imagine-video-1.5 (preview alias accepted)\n    -o, --out <file>                   Download continued video to file\n        --output <file>                Alias for --out\n        --json                         Print JSON result\n        --timeout <sec>                Default: 5400\n        --server <url>                 Override server URL`);
    return;
  }
  const prompt = args.positional.join(" ");
  if (!prompt.trim()) die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
  if (!args.video) die(2, "--video <generated-file> is required");
  const duration = parseIntegerFlag(args.duration, 5, "--duration");
  if (duration < 1 || duration > 15) die(2, "--duration must be between 1 and 15");
  const resolution = String(args.resolution);
  if (!VALID_RESOLUTIONS.has(resolution)) die(2, "--resolution must be one of: 480p, 720p, 1080p");
  const aspectRatio = String(args["aspect-ratio"]);
  if (!VALID_ASPECT_RATIOS.has(aspectRatio)) die(2, "--aspect-ratio must be one of: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto");
  if (args.model && !VALID_MODELS.has(String(args.model))) {
    die(2, "--model must be one of: grok-imagine-video, grok-imagine-video-1.5");
  }
  const model = args.model ? canonicalVideoModel(String(args.model)) : GROK_VIDEO_MODEL_BASE;
  validateCliVideoResolution(model, resolution, "image-to-video");
  parseTimeoutSeconds(args.timeout);
  const server = await resolveServer({ serverFlag: args.server });
  const requestId = `req_cli_video_continue_${Date.now().toString(36)}`;
  const body: Record<string, unknown> = {
    prompt,
    requestId,
    duration,
    resolution,
    aspectRatio,
    continueFromVideo: args.video,
  };
  if (args.model) body.model = model;
  if (args["planner-model"]) body.plannerModel = args["planner-model"];
  if (args.storyboard) body.storyboard = true;
  const data = await runVideoGenerateRequest(server.base, body, args.timeout, Boolean(args.json));
  const outPath = (args.out || args.output) as string | undefined;
  if (outPath) await downloadReturnedVideo(server.base, data, outPath, timeoutSignal(args.timeout));
  if (args.json) out(JSON.stringify(data, null, 2));
  else out(color.green("✓ ") + `Continued video: ${data.url}`);
}

async function videoFrameCmd(argv: string[]) {
  const hasOut = argv.some((value) => value === "-o" || value === "--out" || value.startsWith("--out="));
  const hasOutput = argv.some((value) => value === "--output" || value.startsWith("--output="));
  if (hasOut && hasOutput) die(2, "--out and --output are mutually exclusive");
  const spec = { flags: { last: { type: "boolean" }, position: { type: "string" }, out: { short: "o", type: "string" }, output: { type: "string" }, timeout: { type: "string", default: "60" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  rejectUnknownFlags(args);
  if (args.help) { out(`  ima2 video frame <local-file|generated-file> [--last] [--position <sec>] [-o, --out <path>]\n\n  Extract a frame from a video. Accepts a path to a local .mp4 (uploaded to the\n  server for extraction) or a generated filename from 'ima2 ls'.\n\n  Options:\n        --last            Extract last frame (default)\n        --position <sec>  Extract frame at specific second\n    -o, --out <path>      Output file path\n        --output <path>   Alias for --out\n        --timeout <sec>   Default: 60\n        --server <url>    Override server URL`); return; }
  const file = args.positional[0];
  if (!file) die(2, "file argument required");
  if (args.last && args.position) die(2, "use either --last or --position, not both");
  const position = args.last ? "last" : (String(args.position || "last"));
  if (position !== "last" && !/^\d+(\.\d+)?$/.test(position)) die(2, "--position must be a non-negative number");
  parseTimeoutSeconds(args.timeout);
  const server = await resolveServer({ serverFlag: args.server });
  // A path that exists on disk is uploaded; anything else is treated as a
  // generated filename the server can resolve itself. Before this, a clip saved
  // with -o was rejected as "not found" while sitting in the current directory,
  // and the only way through was parsing `ima2 ls --json` for the internal name.
  let localBytes: Buffer | null = null;
  try {
    const info = await stat(file);
    if (info.isFile()) localBytes = await readFile(file);
  } catch { /* not a local path; fall through to the generated-file lookup */ }
  const res = localBytes
    ? await fetchServer(server.base, "/api/video/frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: localBytes.toString("base64"), position }),
      signal: timeoutSignal(args.timeout),
    })
    : await fetchServer(server.base, `/api/video/frame?file=${encodeURIComponent(file)}&position=${encodeURIComponent(position)}`, { signal: timeoutSignal(args.timeout) });
  if (!res.ok) {
    const payload = await readJsonResponse(res, "frame extraction") as { error?: string };
    const detail = payload.error ?? String(res.status);
    const hint = localBytes
      ? ""
      : `\n  '${file}' is neither a file on disk nor a generated filename. Pass a local path, or run 'ima2 ls --json' for generated names.`;
    die(1, `frame extraction failed: ${detail}${hint}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = (args.out ?? args.output) as string || `frame-${basename(file).replace(/\.[^.]+$/, "")}.png`;
  await writeBuffer(outPath, buf);
  out(color.green("✓ ") + `Frame saved: ${outPath} (${buf.length} bytes)`);
}

async function videoAnalyzeCmd(argv: string[]) {
  const spec = { flags: { json: { type: "boolean" }, timeout: { type: "string", default: "180" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  rejectUnknownFlags(args);
  if (args.help) { out(`  ima2 video analyze <generated-file>\n\n  Analyze first/last frames from a generated .mp4 with Grok 4.3 image understanding. Outputs structured recreation prompt.\n\n  Options:\n        --json            Print JSON result\n        --timeout <sec>   Default: 180\n        --server <url>    Override server URL`); return; }
  const videoUrl = args.positional[0];
  if (!videoUrl) die(2, "generated video filename required");
  parseTimeoutSeconds(args.timeout);
  const server = await resolveServer({ serverFlag: args.server });
  const res = await fetchServer(server.base, "/api/video/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoUrl }), signal: timeoutSignal(args.timeout) });
  const data = await readJsonResponse(res, "analyze");
  if (!res.ok) die(1, `analyze failed: ${data.error || res.status}`);
  if (args.json) { out(JSON.stringify(data, null, 2)); } else { out(data.analysis as string); }
}
