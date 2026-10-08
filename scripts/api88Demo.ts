import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { masker, recordFetch, saveJson } from "./api88DemoRecord.ts";
import type { RuntimeContext } from "../lib/runtimeContext.ts";
import { beginApi88VideoTask, recordApi88VideoTask } from "../lib/api88/videoLedger.ts";
import type { Api88VideoEvent } from "../lib/api88/videoTransport.ts";

export type DemoKeys = { image: string; video: string; baseUrl: string };
export type DemoFlags = { seedance: boolean; veo: boolean; omni: boolean; server: boolean };
type ImageOptions = { model: string; size: string; references?: Array<{ b64: string; declaredMime: string; detectedMime: string }>; requestId: string; signal: AbortSignal };
type VideoInput = { model: string; prompt: string; duration: number; resolution: "480p" | "720p"; aspectRatio: "16:9" };
type VideoOptions = { signal: AbortSignal;
  origin: string; onEvent: (event: Api88VideoEvent) => void | Promise<void> };
export type DemoPorts = {
  origin: (base: string) => string;
  context: (keys: DemoKeys, dir: string) => RuntimeContext;
  catalog: (ctx: RuntimeContext, kind: "image" | "video") => Promise<readonly string[]>;
  image: (prompt: string, ctx: RuntimeContext, opts: ImageOptions) => Promise<{ b64: string }>;
  video: (ctx: RuntimeContext, input: VideoInput, opts: VideoOptions) => Promise<{ videoBuffer: Buffer; providerTaskId: string }>;
};
const IMAGE_PROMPT = "A single matte ceramic mug on a plain light grey background, centered, soft even lighting";
const EDIT_PROMPT = "Change the mug color to deep navy blue, keep everything else identical";
const VIDEO_PROMPT = "A single ceramic mug on a table, camera slowly moves left, continuous calm motion, no text";
export const OPTIONAL = [
  { flag: "seedance", model: "seedance-2.0-mini-480p", duration: 4, resolution: "480p", label: "05-seedance" },
  { flag: "veo", model: "veo-3.1-fast", duration: 4, resolution: "720p", label: "06-veo" },
  { flag: "omni", model: "gemini-omni-flash", duration: 3, resolution: "720p", label: "07-omni" },
] as const;
export function parseFlags(args: string[], env: NodeJS.ProcessEnv): DemoFlags {
  if (env.CI || env.GITHUB_ACTIONS) throw new Error("DEMO_CI_FORBIDDEN");
  const allowed = new Set(["--run", "--seedance", "--veo", "--omni", "--server"]);
  if (!args.includes("--run") || args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length)
    throw new Error("Usage: node --import tsx scripts/api88-live-smoke.mjs --run [--seedance] [--veo] [--omni] [--server]");
  return { seedance: args.includes("--seedance"), veo: args.includes("--veo"),
    omni: args.includes("--omni"), server: args.includes("--server") };
}
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^(IMA2_88API_IMAGE_KEY|IMA2_88API_VIDEO_KEY|IMA2_88API_BASE_URL)=(.*)$/.exec(line);
    if (!match) throw new Error("DEMO_ENV_FILE_FORMAT");
    const name = match[1]!;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (name in values || !value || /\s|\$|`/.test(value)) throw new Error("DEMO_ENV_FILE_FORMAT");
    values[name] = value;
  }
  return values;
}
export function keysFrom(env: NodeJS.ProcessEnv, file: Record<string, string>): DemoKeys {
  const image = (env.IMA2_88API_IMAGE_KEY || file.IMA2_88API_IMAGE_KEY || "").trim();
  const video = (env.IMA2_88API_VIDEO_KEY || file.IMA2_88API_VIDEO_KEY || "").trim();
  if (!image || !video) throw new Error("DEMO_BOTH_KEYS_REQUIRED");
  const baseUrl = env.IMA2_88API_BASE_URL || file.IMA2_88API_BASE_URL || "https://api.88api.ai";
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("DEMO_HTTPS_BASE_REQUIRED");
  return { image, video, baseUrl };
}
export async function loadPorts(): Promise<DemoPorts> {
  const [{ api88Origin }, { validateApi88Key, api88Key }, { generateViaApi88Image },
    { generateApi88Video }, { requireRuntimeContext }] = await Promise.all([
    import("../lib/api88/origin.ts"), import("../lib/api88/catalog.ts"),
    import("../lib/api88/imageTransport.ts"), import("../lib/api88/videoTransport.ts"), import("../lib/runtimeContext.ts"),
  ]);
  return { origin: api88Origin, catalog: async (ctx, kind) => {
    const key = api88Key(ctx, kind);
    if (!key) throw new Error("DEMO_BOTH_KEYS_REQUIRED");
    return [...await validateApi88Key(ctx, key)];
  }, image: generateViaApi88Image, video: generateApi88Video,
    context: (keys, dir) => requireRuntimeContext({
      api88ImageKey: keys.image, api88ImageKeySource: "env", hasApi88ImageKey: true,
      api88VideoKey: keys.video, api88VideoKeySource: "env", hasApi88VideoKey: true,
      config: { api88Provider: { baseUrl: keys.baseUrl, videoTimeoutMs: 900_000 },
        storage: { configDir: resolve(dir, "home", ".ima2"),
          generatedDir: resolve(dir, "home", ".ima2", "generated"),
          configFile: resolve(dir, "home", ".ima2", "config.json"),
          dbPath: resolve(dir, "home", ".ima2", "sessions.db") } },
    }) };
}
async function preflight(ports: DemoPorts, ctx: RuntimeContext, flags: DemoFlags): Promise<void> {
  const imageIds = await ports.catalog(ctx, "image");
  const videoIds = await ports.catalog(ctx, "video");
  const images = ["gpt-image-2", "gemini-3.1-flash-lite-image"];
  const videos = ["grok-imagine-video-1.5", ...OPTIONAL.filter(item => flags[item.flag]).map(item => item.model)];
  if (!images.every(id => imageIds.includes(id)) || !videos.every(id => videoIds.includes(id)))
    throw new Error("DEMO_CATALOG_MODEL_MISSING");
}
export async function savePng(path: string, b64: string, square = false): Promise<void> {
  const { default: sharp } = await import("sharp");
  const image = sharp(Buffer.from(b64, "base64"));
  const meta = await image.metadata();
  if (square && (meta.width !== 1024 || meta.height !== 1024)) throw new Error("DEMO_GPT_SIZE_MISMATCH");
  const buffer = await image.png().toBuffer();
  writeFileSync(path, buffer, { mode: 0o600 });
}
export function once(dir: string, label: string, model: string): void {
  writeFileSync(join(dir, label + ".attempt.json"), JSON.stringify({ label, model, state: "attempted", at: new Date().toISOString() }) + "\n",
    { mode: 0o600, flag: "wx" });
}
async function imageStep(ports: DemoPorts, ctx: RuntimeContext, dir: string, label: string,
  model: string, references?: Array<{ b64: string; declaredMime: string; detectedMime: string }>): Promise<void> {
  once(dir, label, model);
  const result = await ports.image(references ? EDIT_PROMPT : IMAGE_PROMPT, ctx, {
    model, size: "1024x1024", requestId: randomUUID(), signal: AbortSignal.timeout(300_000),
    ...(references ? { references } : {}),
  });
  await savePng(join(dir, label + ".png"), result.b64, label === "01-generation");
}
export async function videoStep(ports: DemoPorts, ctx: RuntimeContext, dir: string, label: string,
  model: string, duration: number, resolution: "480p" | "720p", secrets: string[]): Promise<void> {
  once(dir, label, model);
  const entry = { requestId: randomUUID(), model, origin: ports.origin(ctx.config.api88Provider.baseUrl) };
  const taskPath = join(dir, label + "-task.json");
  let taskId: string | undefined;
  await beginApi88VideoTask(ctx, entry.requestId, model, entry.origin);
  saveJson(taskPath, { ...entry, state: "submitting" }, secrets);
  try {
    const result = await ports.video(ctx, { model, prompt: VIDEO_PROMPT, duration, resolution,
      aspectRatio: "16:9" }, { origin: entry.origin, signal: AbortSignal.timeout(960_000),
      onEvent: async event => {
        if (event.phase !== "submitted") return;
        taskId = event.providerTaskId;
        // Keep the known id even if the durable append fails; transport awaits this callback.
        saveJson(taskPath, { ...entry, providerTaskId: taskId, state: "submitted" }, secrets);
        await recordApi88VideoTask(ctx, { ...entry, taskId, phase: "submitted" });
      },
    });
    taskId = result.providerTaskId;
    if (!result.videoBuffer.length || result.videoBuffer.subarray(4, 8).toString("ascii") !== "ftyp"
        || result.videoBuffer.length > 200 * 1024 * 1024) throw new Error("DEMO_INVALID_MP4");
    writeFileSync(join(dir, label + ".mp4"), result.videoBuffer, { mode: 0o600 });
    await recordApi88VideoTask(ctx, { ...entry, taskId, phase: "completed" });
    saveJson(taskPath, { ...entry, providerTaskId: taskId, state: "completed" }, secrets);
  } catch (error) {
    const code = failureCode(error);
    const phase = code === "API88_VIDEO_SUBMIT_UNCERTAIN" ? "uncertain" : "failed";
    saveJson(taskPath, { ...entry, ...(taskId ? { providerTaskId: taskId } : {}), state: phase, error: code }, secrets);
    await recordApi88VideoTask(ctx, { ...entry, ...(taskId ? { taskId } : {}), phase,
      ...(code.startsWith("API88_") ? { error: code } : {}) });
    throw error;
  }
}
function failureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^API88_[A-Z0-9_]+$/.test(code) ? code : "DEMO_VIDEO_FAILED";
}
export async function runDemo(keys: DemoKeys, flags: DemoFlags, dir: string, supplied?: DemoPorts): Promise<void> {
  const ports = supplied ?? await loadPorts();
  const secrets = [keys.image, keys.video];
  const ctx = ports.context(keys, dir);
  if (resolve(ctx.config.storage.configDir) !== resolve(dir, "home", ".ima2"))
    throw new Error("DEMO_LEDGER_DIR_NOT_ISOLATED");
  writeFileSync(join(dir, "run.lock.json"), JSON.stringify({ startedAt: new Date().toISOString() }) + "\n",
    { flag: "wx", mode: 0o600 });
  const recorder = recordFetch(dir, ports.origin(keys.baseUrl), secrets);
  try {
    await preflight(ports, ctx, flags);
    recorder.setOperation("01-generation", "gpt-image-2");
    await imageStep(ports, ctx, dir, "01-generation", "gpt-image-2");
    const png = readFileSync(join(dir, "01-generation.png"));
    recorder.setOperation("02-edit", "gpt-image-2");
    await imageStep(ports, ctx, dir, "02-edit", "gpt-image-2", [{ b64: png.toString("base64"), declaredMime: "image/png", detectedMime: "image/png" }]);
    recorder.setOperation("03-gemini", "gemini-3.1-flash-lite-image");
    await imageStep(ports, ctx, dir, "03-gemini", "gemini-3.1-flash-lite-image");
    recorder.setOperation("04-grok", "grok-imagine-video-1.5");
    await videoStep(ports, ctx, dir, "04-grok", "grok-imagine-video-1.5", 4, "480p", secrets);
    for (const item of OPTIONAL.filter(item => flags[item.flag])) {
      recorder.setOperation(item.label, item.model);
      await videoStep(ports, ctx, dir, item.label, item.model, item.duration, item.resolution, secrets);
    }
    saveJson(join(dir, "summary.masked.json"), { proof: "direct transports only", status: "passed", mandatorySubmissions: 4,
      optional: OPTIONAL.filter(item => flags[item.flag]).map(item => item.model), serverRequested: flags.server }, secrets);
  } catch (error) {
    saveJson(join(dir, "failure.masked.json"), { status: "failed", message: error instanceof Error ? error.message : "DEMO_FAILED" }, secrets);
    throw error;
  } finally { recorder.restore(); }
}
function readKeyFile(): Record<string, string> {
  try { return parseEnvFile(readFileSync(join(homedir(), ".ima2", "88api.env"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("DEMO_ENV_FILE_UNREADABLE_OR_INVALID", { cause: error });
  }
}
export function stageMandatoryArtifacts(dir: string, gallery: string, secrets: string[]): void {
  mkdirSync(gallery, { recursive: true, mode: 0o700 });
  const task = JSON.parse(readFileSync(join(dir, "04-grok-task.json"), "utf8")) as { providerTaskId: string };
  const artifacts = [
    { name: "01-generation.png", model: "gpt-image-2", prompt: IMAGE_PROMPT, kind: "image" },
    { name: "02-edit.png", model: "gpt-image-2", prompt: EDIT_PROMPT, kind: "image" },
    { name: "03-gemini.png", model: "gemini-3.1-flash-lite-image", prompt: IMAGE_PROMPT, kind: "image" },
    { name: "04-grok.mp4", model: "grok-imagine-video-1.5", prompt: VIDEO_PROMPT, kind: "video" },
  ];
  for (const artifact of artifacts) {
    const source = join(dir, artifact.name);
    const bytes = readFileSync(source);
    const createdAt = statSync(source).mtimeMs;
    const filename = "api88-demo-" + artifact.name;
    const metadata = { provider: "88api", model: artifact.model, prompt: artifact.prompt,
      userPrompt: artifact.prompt, kind: artifact.kind, mediaType: artifact.kind,
      created: createdAt, createdAt, format: artifact.kind === "video" ? "mp4" : "png",
      proof: "direct transport; staged without generation", filename,
      ...(artifact.kind === "video" ? { providerTaskId: task.providerTaskId,
        video: { providerTaskId: task.providerTaskId, duration: 4, resolution: "480p", aspectRatio: "16:9", mode: "text-to-video" },
        parameterSource: "submitted request; encoded duration/resolution not independently measured" }
        : { size: `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` }) };
    writeFileSync(join(gallery, filename), bytes, { mode: 0o600, flag: "wx" });
    saveJson(join(gallery, filename + ".json"), metadata, secrets);
  }
  saveJson(join(dir, "gallery-staging.masked.json"), { status: "staged", paidSubmissions: 0,
    gallery, filenames: artifacts.map(item => "api88-demo-" + item.name) }, secrets);
}
export function childEnvironment(keys: DemoKeys, dir: string): NodeJS.ProcessEnv {
  const childHome = join(dir, "home");
  const configDir = join(childHome, ".ima2");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  saveJson(join(configDir, "config.json"), { mcp: { enabledProviders: [] },
    api88Provider: { baseUrl: keys.baseUrl } });
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "TMPDIR", "SystemRoot", "WINDIR"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, HOME: childHome, USERPROFILE: childHome,
    XDG_CONFIG_HOME: join(childHome, ".config"), XDG_DATA_HOME: join(childHome, ".local", "share"),
    IMA2_CONFIG_DIR: configDir, IMA2_GENERATED_DIR: join(configDir, "generated"),
    IMA2_DB_PATH: join(configDir, "sessions.db"), IMA2_ADVERTISE_FILE: join(dir, "server.json"),
    IMA2_GENERATION_REQUEST_LOG_FILE: join(dir, "generation-request-log.json"),
    IMA2_HOST: "127.0.0.1", IMA2_PORT: "0", IMA2_NO_OAUTH_PROXY: "1",
    IMA2_DISABLE_UPDATE_CHECK: "1", IMA2_88API_IMAGE_KEY: keys.image,
    IMA2_88API_VIDEO_KEY: keys.video, IMA2_88API_BASE_URL: keys.baseUrl };
}
export async function optionalServer(env: NodeJS.ProcessEnv): Promise<void> {
  parseFlags(["--run"], process.env);
  const { fork } = await import("node:child_process");
  const child = fork(new URL("./api88DemoServer.ts", import.meta.url), [], {
    env, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("DEMO_SERVER_TIMEOUT")); }, 420_000);
    child.on("message", packet => {
      if (packet && typeof packet === "object" && "url" in packet && typeof packet.url === "string"
          && /^http:\/\/127\.0\.0\.1:\d+$/.test(packet.url))
        console.log(`88API UI preview: ${packet.url} (five minutes; generation disabled)`);
    });
    child.once("error", () => { clearTimeout(timer); reject(new Error("DEMO_SERVER_START_FAILED")); });
    child.once("exit", code => { clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error("DEMO_SERVER_FAILED")); });
  });
}
export async function main(args: string[]): Promise<void> {
  let secrets: string[] = [];
  let dir: string | undefined;
  try {
    const flags = parseFlags(args, process.env);
    const keys = keysFrom(process.env, readKeyFile());
    secrets = [keys.image, keys.video];
    dir = join(homedir(), ".ima2", "88api-demo", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Prevent config.ts from reading an ambient persisted provider configuration.
    const env = childEnvironment(keys, dir);
    for (const [name, value] of Object.entries(env)) if (name.startsWith("IMA2_")) process.env[name] = value;
    await runDemo(keys, flags, dir);
    stageMandatoryArtifacts(dir, env.IMA2_GENERATED_DIR!, secrets);
    if (flags.server) await optionalServer(env);
    saveJson(join(dir, "delivery-summary.masked.json"), { status: "passed", mandatorySubmissions: 4,
      optionalSubmissions: OPTIONAL.filter(item => flags[item.flag]).length,
      uiPreview: flags.server ? "gallery/status verified" : "not run", serverSubmissions: 0 }, secrets);
    console.log(`88API demo passed; artifacts: ${dir}`);
  } catch (error) {
    const message = masker(secrets).text(error instanceof Error ? error.message : "DEMO_FAILED");
    if (dir) saveJson(join(dir, "failure.masked.json"), { status: "failed", message }, secrets);
    console.error(`88API demo failed: ${message}${dir ? `; artifacts: ${dir}` : ""}`);
    process.exitCode = 1;
  }
}
