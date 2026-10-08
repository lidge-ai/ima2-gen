# wp4 — 88API live delivery proof

Status: A1 audit fold applied; implementation and fresh execution proof remain pending. This leaf wrote
only this document. No live calls, builds, tests, Git writes, screenshots, or pushes were run.
All current-source anchors were read from the shared tree on 2026-10-08. Read 000 first, then
001–005 and the supplied upstream handoff. D1–D10 override older research proposals.

## 1. Acceptance and cost boundary

One successful default invocation makes exactly four paid submissions, sequentially:

| Operation | Transport | Model | Parameters | Artifact |
|---|---|---|---|---|
| GPT generation | `generateViaApi88Image` | `gpt-image-2` | `1024x1024`, wire `n: 1` | `01-generation.png` |
| GPT local edit | same image transport | `gpt-image-2` | local PNG produced by operation 1, multipart `image[]`, `n=1` | `02-edit.png` |
| Gemini generation | same image transport | `gemini-3.1-flash-lite-image` | string user content, `/v1/chat/completions` | `03-gemini.png`, `gemini-response.masked.json` |
| Grok video | `generateApi88Video` | `grok-imagine-video-1.5` | 480p, 4 seconds, 16:9 | `04-grok.mp4`, `04-grok-task.json` |

Do not treat a failed/interrupted run as four passes. Stop at the first failure, retain all
attempt markers and any submitted task ID, and do not automatically rerun the script. A new
run directory is a new spend decision. Recovery uses D6's resume route; never repeat submit.

Before the first paid operation, force a real `/v1/models` refresh for **both** key kinds.
Require successful, nonempty catalogs containing every requested model. The demo is stricter
than D8's normal offline fallback: catalog failure means zero paid submissions. No endpoint
switching, model fallback, `/v1/responses`, legacy video endpoint, or automatic POST retry.

Flags add exactly one submission per selected optional model: `--seedance` adds
`seedance-2.0-mini-480p`, 4s; `--veo` adds `veo-3.1-fast`, 4s, 720p; `--omni` adds
`gemini-omni-flash`, 3s. All use 16:9, no references, and the video key. `--server` opens a
five-minute isolated UI preview of the four already-generated mandatory artifacts. It adds
zero paid calls: the child makes only read requests and blocks outbound POSTs. Gallery staging
also runs without `--server`, so a later preview needs no new generation. The parent synthesis
replaces the original extra `/api/generate` + `/api/video/generate` proof with UI evidence only.

Handoff estimates, in **unconfirmed price units**: mandatory 0.80; Seedance +0.64;
Veo +0.40; Omni +0.60; UI preview +0. These are historical estimates, not a credit balance
check or a currency claim. Confirm actual charges in the console afterward. No other models.

## 2. Current anchors, ownership, and prerequisite exports

The following are current read-only anchors, not wp4 production modifications:

| Current source | Current lines and snippet | Consequence |
|---|---|---|
| `.gitignore` | 1–5: `.env`, `.ima2/`, `.codexclaw/`, `node_modules`, `generated/` | `tmp/88api-demo/` is not ignored. Use the outside-repo home directory below; no ignore edit. |
| `config.ts` | 54–64: `const env = process.env;`, `const configDir = env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");`, candidates `join(configDir, "config.json")`, `join(packageRoot, ".ima2", "config.json")` | Write the isolated config before imports. This prevents config.ts fallback, not individual credential-loader fallback. |
| `config.ts` | 86–100: `v !== undefined && v !== ""`; 327–328: `fileCfg.mcp.enabledProviders.join(",")` then `.split(",")` | Empty array becomes an ignored empty string. Write the requested array and also set the child config's in-memory `enabledProviders = []` before boot. |
| `server.ts` | 69–77, 87–95, 105–113, 123–131, 141–149, 159–167, 185–195: config credential candidates include `join(rootDir, ".ima2", "config.json")` | Temporary HOME does not remove package fallback. The demo child refuses a package config with other-provider credentials; no production loader changes. |
| `config.ts` | 335–339: `generatedDir: pickStr(env.IMA2_GENERATED_DIR, ...`, `dbPath: pickStr(env.IMA2_DB_PATH, ...` | Explicit isolated storage and DB paths. |
| `config.ts` | 350–355: `configFile: join(configDir, "config.json")`, `advertiseFile: pickStr(env.IMA2_ADVERTISE_FILE, ...`, `generationRequestLogFile: pickStr(...)` | Isolate configuration, discovery, and request logs. |
| `lib/runtimeContext.ts` | 102–104: `export type RouteRuntimeContext = ...`; 124–126: `export function requireRuntimeContext(ctx: RouteRuntimeContext | undefined): RuntimeContext { ... target.config = mergeRuntimeConfig(target.config);` | Use the actual normalization boundary for direct transport context, not the test-only factory. |
| `lib/runtimeContext.ts` | 197–198: `/** Stub-friendly default for tests. Do NOT use in production boot paths. */`, `export function createTestRuntimeContext(...)` | This demo does not use that factory. |
| `lib/atlasCloudImageAdapter.ts` | 16–25: `model?: string`, `size?: string`, `references?: AtlasReference[]`, `signal?: AbortSignal`, `requestId?: string`; 28–35: result `b64`, `mime`, `providerUrl` | Existing option/result pattern; wp2 must provide the API88 counterpart, not reuse Atlas HTTP. |
| `lib/grokVideoAdapter.ts` | 96–109: `videoBuffer: Buffer`, `url: string`, `xaiVideoRequestId: string`, `requestedModel`, `effectiveModel` | wp3 video result uses `videoBuffer` and generic `providerTaskId`, never invents an xAI ID. |
| `server.ts` | 469–470: `export async function startServer(overrides: StartServerOverrides = {})`, `const ctx = await createRuntimeContext(overrides);`; 520–532 listener updates `ctx.serverUrl`; 592: `return { app, server, oauthChild, ctx };` | Child starts the actual server on OS-selected port 0 and reports its actual URL through IPC. |
| `server.ts`, `lib/storageMigration.ts` | server 474: `await migrateGeneratedStorage(ctx);`; migration 30: `copyFile(src, dst, constants.COPYFILE_EXCL)`; 98–112 and 123–131 include home, repository and installation candidates | Migration may copy other gallery files into the temporary destination; parent accepts this read/copy behavior. It is not a claim of hermetic gallery contents. |
| `lib/xaiAuth.ts`, `server.ts` | auth 122–123: `grokAuthFilePath(homeDir: string = homedir())`, `join(homeDir, ".progrok", "auth.json")`; server 342: `loadGrokCredentials(ctx.grokAuthHomeDir)` | Child HOME and USERPROFILE point to its temporary home, isolating the current `.progrok` lookup as well as other home-based auth. |
| `lib/historyList.ts` | 55: `createdAt: meta?.createdAt || st?.mtimeMs || 0`; 56, 65, 69, 78 project prompt/model/provider/kind; 118, 127–129 read sidecars first | Stage media plus `.json` sidecars with actual creation timestamps and the direct requests' provenance before preview startup. |
| `lib/videoArtifactPersistence.ts` | 11–14: `writeFile(filePath, buffer)` and `atomicWriteJson(...)` | Ordinary server writes lack an explicit mode; child umask 077 restricts newly created files. Copied files may retain source modes and are not covered by the blanket 0600 claim. |
| `lib/runtimePorts.ts` | 68–72: `listen.call(app, port, host)`; 81–84: `const port = Number(startPort) + offset;`, `await listenOnce(app, port, host)`; 102–104 reads `server.address().port` | Port 0 reaches the native listener unchanged; use the actual bound port afterward. |
| `routes/history.ts`, `routes/keys.ts` | history 70: `app.get("/api/history", ...)`, 142: `res.json({ items: page, total: rows.length, nextCursor })`; keys 79–102 exposes flat `/api/keys/status` | UI child verifies gallery and masked key status using GET only; no new generation route calls. |
| `tests/atlascloud-provider-contract.test.ts` | 7–11: `const originalFetch = globalThis.fetch;` and `test.afterEach(() => { globalThis.fetch = originalFetch; });`; 38–53 URL-dispatching stub; 83–85 `assert.ok(init?.body instanceof FormData)` | New tests use this pattern and throw on every unmatched URL. |
| `scripts/run-tests.mjs` | 8–12 scans `tests/` for `*.test.ts`; 19 spawns `--experimental-test-module-mocks --import tsx --test` | Mock contracts enter discovery, but the live entrypoint is never executed by CI. |
| `scripts/classify-tests.mjs` | 21–23 direct `../lib/`/`../routes/`/`../bin/` runtime import regex; 47 generated total; 63–66 generator write | Inventory is generated, not a handwritten registration list. |
| `package.json` | 26: `"test:inventory": "node scripts/classify-tests.mjs --check --fail-js-runtime"`; 44–46 typechecks/build | No npm script or workflow addition for paid smoke. |

`lib/api88/` does not exist in this snapshot (`rg --files lib/api88` reported “No such file
or directory”). 010 and 020 appeared during this leaf's final check. Their proposed full
contents now establish the following exact prerequisite exports. These are verified
against the current planning documents, not implemented source or execution evidence:

```ts
// Prerequisites only; import the actual implementations, do not create this file.
import { api88Origin } from "../lib/api88/origin.ts";
import { api88Key, validateApi88Key } from "../lib/api88/catalog.ts";
import { generateViaApi88Image } from "../lib/api88/imageTransport.ts";
import { generateApi88Video } from "../lib/api88/videoTransport.ts";
// validateApi88Key(ctx, key) returns Promise<Set<string>> and propagates failures.
// generateViaApi88Image(prompt, ctx, options) returns SingleImageExecutionResult.
// generateApi88Video(ctx, input, options) returns Api88VideoResult.
// Video input: {model,prompt,duration,resolution,aspectRatio}; onEvent uses `phase`.
```

Before implementing wp4, confirm the source exports match these proposed contents. Record
any later differences here and change only demo callsites; do not add duplicate HTTP or
production wrappers. In particular, use `validateApi88Key` rather than `getApi88Catalog`
or `refreshApi88Catalogs`: 010's `refresh` catches errors and preserves fallback state,
whereas the validation primitive makes a real GET and throws. D1–D10 remain mandatory.
Current plan anchors: 010 lines 324–329 (`origin.ts` / `api88Origin`), 470–480
(`validateApi88Key`), 733–753 (`imageTransport.ts` options), 818–835 (image executor);
020 lines 351–385 (`videoTransport.ts` / event `phase` / `videoBuffer`), 521–528
(`generateApi88Video(ctx,input,options)`). Recheck these planning-document anchors if their
owners revise the shared files before implementation.

Use `node --import tsx`: transports are imported from source `.ts`, avoiding stale emitted
JS and proving actual integration code. The requested `.mjs` entrypoint is deliberately
plain JavaScript (also valid TypeScript); supporting implementation and tests are TypeScript.
No dependency addition: Node >=22, `tsx`, and `sharp` already belong to this repo.

## 3. Exact file plan

All NEW anchors below are “file absent, no current lines/snippet”; verify absence immediately
before creating them. No DELETE files. No production transport, UI, package, or workflow
MODIFY in wp4. Every new code file is below 500 lines; functions are below 50 lines.

### NEW `scripts/api88-live-smoke.mjs` — full contents

```ts
#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { main } from "./api88Demo.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
```

### NEW `scripts/api88DemoRecord.ts` — full contents

The recorder delegates to the original `fetch` exactly once; it contains no HTTP submission
implementation. It masks header values, known secrets, credential-shaped strings, sensitive
JSON properties, URL userinfo, fragments and signed queries **only in persisted copies**.
Actual transport input URLs remain byte-exact. `bytes` counts consumed response-body bytes;
`ms` covers headers through consumption/cancel/failure. A pending row survives interruption.

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type RequestRow = {
  operation: string; model: string | null; method: string; endpoint: string;
  status: number | null; ms: number; bytes: number; authorization: string;
  state: "pending" | "complete" | "failed" | "cancelled";
};
export function masker(secrets: string[]) {
  const cleanText = (text: string): string => {
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
    return text.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
      .replace(/https?:\/\/[^\s"<>)]*/g, (value) => {
        const url = new URL(value);
        url.username = ""; url.password = ""; url.hash = "";
        if (url.search) url.search = "?[REDACTED]";
        return url.href;
      });
  };
  const clean = (value: unknown, key = ""): unknown => {
    if (/authorization|cookie|api.?key|secret|token|password/i.test(key))
      return value === "absent" || value === "Bearer [REDACTED]" ? value : "[REDACTED]";
    if (typeof value === "string") return cleanText(value);
    if (Array.isArray(value)) return value.map(item => clean(item));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, clean(item, name)]),
    );
    return value;
  };
  return { clean, text: cleanText };
}
export function saveJson(path: string, value: unknown, secrets: string[] = []): void {
  writeFileSync(path, JSON.stringify(masker(secrets).clean(value), null, 2) + "\n", { mode: 0o600 });
}
function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  return { url, method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    headers: new Headers(init?.headers ?? request?.headers), body: init?.body };
}
function modelOf(body: BodyInit | null | undefined): string | null {
  if (body instanceof FormData) return String(body.get("model") ?? "") || null;
  if (typeof body !== "string") return null;
  const value: unknown = JSON.parse(body);
  return value && typeof value === "object" && "model" in value && typeof value.model === "string"
    ? value.model : null;
}
function trackBody(response: Response, row: RequestRow, started: number, flush: () => void): Response {
  if (!response.body) { row.state = "complete"; flush(); return response; }
  const reader = response.body.getReader();
  const finish = (state: RequestRow["state"]) => {
    row.state = state; row.ms = Date.now() - started; flush();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { finish("complete"); controller.close(); return; }
        row.bytes += chunk.value.byteLength; controller.enqueue(chunk.value);
      } catch (error) { finish("failed"); controller.error(error); }
    },
    async cancel(reason) { finish("cancelled"); await reader.cancel(reason); },
  });
  const wrapped = new Response(body, { status: response.status,
    statusText: response.statusText, headers: response.headers });
  Object.defineProperty(wrapped, "url", { value: response.url });
  Object.defineProperty(wrapped, "redirected", { value: response.redirected });
  return wrapped;
}
export function recordFetch(dir: string, origin: string, secrets: string[], name = "requests.masked.json", allowSubmissions = true) {
  const original = globalThis.fetch;
  const rows: RequestRow[] = [];
  const submissions = new Set<string>();
  let operation = "preflight";
  let selectedModel: string | null = null;
  const flush = () => saveJson(join(dir, name), rows, secrets);
  const wrapper: typeof fetch = async (input, init) => {
    const { url, method, headers, body } = requestParts(input, init);
    if (method === "POST" && !allowSubmissions) throw new Error("DEMO_PREVIEW_SUBMIT_FORBIDDEN");
    const isApi = url.origin === new URL(origin).origin && url.pathname.startsWith("/v1/");
    const endpoint = url.origin + url.pathname;
    if (isApi && !/^\/v1\/(models|images\/(generations|edits)|chat\/completions|videos(?:\/[^/]+)?)$/.test(url.pathname))
      throw new Error("DEMO_ENDPOINT_FORBIDDEN");
    if (!isApi && headers.has("authorization")) throw new Error("DEMO_DOWNLOAD_AUTH_FORBIDDEN");
    if (isApi && method === "POST") {
      const key = operation;
      if (submissions.has(key)) throw new Error("DEMO_SUBMIT_RETRY_FORBIDDEN");
      submissions.add(key);
    }
    const row: RequestRow = { operation, model: modelOf(body) ?? selectedModel, method,
      endpoint, status: null, ms: 0, bytes: 0,
      authorization: headers.has("authorization") ? "Bearer [REDACTED]" : "absent", state: "pending" };
    rows.push(row); flush();
    return recordedResponse(input, init, row);
  };
  async function recordedResponse(input: RequestInfo | URL, init: RequestInit | undefined, row: RequestRow) {
    const started = Date.now();
    try {
      const response = await original(input, init);
      row.status = response.status; row.ms = Date.now() - started; flush();
      const wrapped = trackBody(response, row, started, flush);
      if (row.endpoint === origin + "/v1/chat/completions") {
        const json: unknown = await wrapped.clone().json();
        saveJson(join(dir, "gemini-response.masked.json"), json, secrets);
      }
      return wrapped;
    } catch (error) { row.state = "failed"; row.ms = Date.now() - started; flush(); throw error; }
  }
  globalThis.fetch = wrapper;
  return { rows, setOperation(label: string, model: string | null = null) {
    operation = label; selectedModel = model;
  }, restore() { if (globalThis.fetch === wrapper) globalThis.fetch = original; flush(); } };
}
```

### NEW `scripts/api88Demo.ts` — full contents

Only `main` reads credentials, and only from its supplied environment or the fixed
`~/.ima2/88api.env`. The latter is parsed as data; shell expansion, `source`, `eval`, exports,
and arbitrary configuration lookup are not used. Environment values take precedence.
`runDemo` is import-safe and testable without reading any home credential file.

```ts
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { masker, recordFetch, saveJson } from "./api88DemoRecord.ts";
import type { RuntimeContext } from "../lib/runtimeContext.ts";

export type DemoKeys = { image: string; video: string; baseUrl: string };
export type DemoFlags = { seedance: boolean; veo: boolean; omni: boolean; server: boolean };
type ImageOptions = { model: string; size: string; references?: Array<{ b64: string; declaredMime: string; detectedMime: string }>; requestId: string; signal: AbortSignal };
type VideoInput = { model: string; prompt: string; duration: number; resolution: "480p" | "720p"; aspectRatio: "16:9" };
type VideoOptions = { signal: AbortSignal;
  onEvent: (event: { phase: string; providerTaskId: string }) => void };
export type DemoPorts = {
  origin: (base: string) => string;
  context: (keys: DemoKeys) => RuntimeContext;
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
    context: keys => requireRuntimeContext({
      api88ImageKey: keys.image, api88ImageKeySource: "env", hasApi88ImageKey: true,
      api88VideoKey: keys.video, api88VideoKeySource: "env", hasApi88VideoKey: true,
      config: { api88Provider: { baseUrl: keys.baseUrl, videoTimeoutMs: 900_000 } },
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
  const result = await ports.video(ctx, { model, prompt: VIDEO_PROMPT, duration, resolution,
    aspectRatio: "16:9" }, { signal: AbortSignal.timeout(960_000),
    onEvent: event => {
      if (event.phase === "submitted" && event.providerTaskId)
        saveJson(join(dir, label + "-task.json"), { providerTaskId: event.providerTaskId, model }, secrets);
    },
  });
  if (!result.videoBuffer.length || result.videoBuffer.subarray(4, 8).toString("ascii") !== "ftyp"
      || result.videoBuffer.length > 200 * 1024 * 1024) throw new Error("DEMO_INVALID_MP4");
  writeFileSync(join(dir, label + ".mp4"), result.videoBuffer, { mode: 0o600 });
  saveJson(join(dir, label + "-task.json"), { providerTaskId: result.providerTaskId, model, state: "completed" }, secrets);
}
export async function runDemo(keys: DemoKeys, flags: DemoFlags, dir: string, supplied?: DemoPorts): Promise<void> {
  const ports = supplied ?? await loadPorts();
  const secrets = [keys.image, keys.video];
  const ctx = ports.context(keys);
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
    throw new Error("DEMO_ENV_FILE_UNREADABLE_OR_INVALID");
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
```

### NEW `scripts/api88DemoServer.ts` — full contents

This manually invoked child is a UI-evidence preview, never a CI entrypoint or paid route
proof. Before runtime imports it sets umask 077, rejects package fallback credentials,
and installs a recorder that forbids outbound POSTs. It clears MCP's live enable list to
counter the current empty-array parsing fallback, then uses ordinary `startServer()` without
modifying server boot code. Startup can copy repository/install galleries into its temporary
destination; that accepted behavior must not be described as a hermetic gallery. Only the
four staged filenames are included in its report. No credentials in argv/IPC or stdout.

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keysFrom, parseFlags, loadPorts } from "./api88Demo.ts";
import { recordFetch, saveJson } from "./api88DemoRecord.ts";

type HistoryRow = { filename: string; provider: string; model: string; kind: string;
  prompt: string; createdAt: number };
function assertPackageConfigSafe(): void {
  const path = new URL("../.ima2/config.json", import.meta.url);
  if (!existsSync(path)) return;
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("DEMO_PACKAGE_CONFIG_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DEMO_PACKAGE_CONFIG_INVALID");
  const config = value as Record<string, unknown>;
  const forbidden = ["apiKey", "xaiApiKey", "geminiApiKey", "atlasCloudApiKey",
    "minimaxApiKey", "naiApiKey", "vertexServiceAccountJson"];
  if (forbidden.some(name => Boolean(config[name]))) throw new Error("DEMO_PACKAGE_CREDENTIALS_PRESENT");
}
async function readJson(base: string, path: string): Promise<unknown> {
  const response = await fetch(base + path, { method: "GET", headers: { origin: base },
    signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("DEMO_PREVIEW_READ_FAILED");
  return response.json();
}
async function verifyGallery(base: string, dir: string, secrets: string[]): Promise<void> {
  const names = ["01-generation.png", "02-edit.png", "03-gemini.png", "04-grok.mp4"]
    .map(name => "api88-demo-" + name);
  const found = new Map<string, HistoryRow>();
  let cursor = "";
  for (let pageNumber = 0; pageNumber < 1000 && found.size < names.length; pageNumber++) {
    const page = await readJson(base, "/api/history?limit=100" + cursor) as {
      items: HistoryRow[]; nextCursor: { before: number; beforeFilename: string } | null };
    for (const row of page.items) if (names.includes(row.filename)) found.set(row.filename, row);
    if (!page.nextCursor) break;
    cursor = `&before=${page.nextCursor.before}&beforeFilename=${encodeURIComponent(page.nextCursor.beforeFilename)}`;
  }
  if (found.size !== names.length) throw new Error("DEMO_PREVIEW_GALLERY_MISSING");
  for (const name of names) {
    const sidecar = JSON.parse(readFileSync(join(process.env.IMA2_GENERATED_DIR!, name + ".json"), "utf8")) as HistoryRow;
    const row = found.get(name)!;
    if (row.provider !== "88api" || row.model !== sidecar.model || row.kind !== sidecar.kind
        || row.prompt !== sidecar.prompt || row.createdAt !== sidecar.createdAt)
      throw new Error("DEMO_PREVIEW_GALLERY_PROVENANCE");
  }
  saveJson(join(dir, "server-gallery.masked.json"), [...found.values()], secrets);
}
async function main(): Promise<void> {
  process.umask(0o077);
  parseFlags(["--run"], process.env);
  if (!process.send || !process.env.IMA2_CONFIG_DIR || !process.env.HOME) throw new Error("DEMO_SERVER_CHILD_ONLY");
  const keys = keysFrom(process.env, {});
  const secrets = [keys.image, keys.video];
  const dir = dirname(process.env.HOME);
  const { api88Origin } = await import("../lib/api88/origin.ts");
  const recorder = recordFetch(dir, api88Origin(keys.baseUrl), secrets, "server-requests.masked.json", false);
  try {
    assertPackageConfigSafe();
    const { config } = await import("../config.ts");
    config.mcp.enabledProviders = [];
    const { startServer } = await import("../server.ts");
    const { ctx } = await startServer();
    const ports = await loadPorts();
    const imageIds = await ports.catalog(ctx, "image");
    const videoIds = await ports.catalog(ctx, "video");
    if (!imageIds.includes("gpt-image-2") || !videoIds.includes("grok-imagine-video-1.5")
        || recorder.rows.some(row => row.endpoint.endsWith("/v1/models") &&
          (row.status === null || row.status >= 400 || row.state === "failed")))
      throw new Error("DEMO_SERVER_CATALOG_FAILED");
    await verifyGallery(ctx.serverUrl, dir, secrets);
    const status = await readJson(ctx.serverUrl, "/api/keys/status") as Record<string, unknown>;
    saveJson(join(dir, "server-key-status.masked.json"), {
      "api88-image": status["api88-image"], "api88-video": status["api88-video"] }, secrets);
    saveJson(join(dir, "server-summary.masked.json"), { status: "gallery/status verified", paidSubmissions: 0 }, secrets);
    process.send({ state: "ready", url: ctx.serverUrl, bootId: ctx.bootId });
    await new Promise<void>(resolve => setTimeout(resolve, 300_000));
  } catch (error) {
    saveJson(join(dir, "server-failure.masked.json"), { status: "failed", message: error instanceof Error ? error.message : "DEMO_SERVER_FAILED" }, secrets);
    throw error;
  } finally { recorder.restore(); }
}
main().then(() => process.exit(0), () => process.exit(1));
```

### NEW `tests/api88-live-smoke-contract.test.ts` — full contents

Use synthetic credentials, real API88 transports, and global fetch stubs. Never call `main`,
read `88api.env`, or spawn the server here. The baseline integration test pays nothing and
expects the real D6 first poll wait (4 seconds); do not shorten production polling to make
the fixture fast. More exhaustive serialization/poll/retry/redirect/MP4 contracts belong
to 010/020, not duplicated here.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as sourceText } from "node:fs";
import { requireRuntimeContext } from "../lib/runtimeContext.ts";
import { grokAuthFilePath } from "../lib/xaiAuth.ts";
import { childEnvironment, keysFrom, loadPorts, once, parseEnvFile, parseFlags,
  runDemo, stageMandatoryArtifacts, type DemoPorts } from "../scripts/api88Demo.ts";
import { masker, recordFetch } from "../scripts/api88DemoRecord.ts";

const originalFetch = globalThis.fetch;
const imageKey = "fixture-image-credential";
const videoKey = "fixture-video-credential";
const keys = { image: imageKey, video: videoKey, baseUrl: "https://api.88api.ai/v1/" };
const flags = { seedance: false, veo: false, omni: false, server: false };
const dirs: string[] = [];
function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), "api88-demo-test-")); dirs.push(dir); return dir;
}
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("manual entry refuses CI, missing --run, unknown and duplicate flags", () => {
  assert.throws(() => parseFlags(["--run"], { CI: "true" }), /CI_FORBIDDEN/);
  assert.throws(() => parseFlags([], {}), /Usage/);
  assert.throws(() => parseFlags(["--run", "--all"], {}), /Usage/);
  assert.throws(() => parseFlags(["--run", "--veo", "--veo"], {}), /Usage/);
  assert.deepEqual(parseFlags(["--run", "--veo"], {}), { ...flags, veo: true });
});
test("env parsing never evaluates shell syntax, keys are separate, env wins", () => {
  const file = parseEnvFile("IMA2_88API_IMAGE_KEY='fixture-file-image'\nIMA2_88API_VIDEO_KEY=fixture-file-video\n");
  assert.equal(keysFrom({ IMA2_88API_IMAGE_KEY: imageKey }, file).image, imageKey);
  assert.equal(keysFrom({}, file).video, "fixture-file-video");
  assert.throws(() => keysFrom({ IMA2_88API_IMAGE_KEY: imageKey }, {}), /BOTH_KEYS_REQUIRED/);
  assert.throws(() => parseEnvFile("IMA2_88API_IMAGE_KEY=$(command)"), /FORMAT/);
  assert.throws(() => parseEnvFile("export IMA2_88API_IMAGE_KEY=fixture"), /FORMAT/);
  assert.throws(() => keysFrom({ IMA2_88API_BASE_URL: "http://api.88api.ai" }, {
    IMA2_88API_IMAGE_KEY: imageKey, IMA2_88API_VIDEO_KEY: videoKey }), /HTTPS_BASE_REQUIRED/);
});
test("masked copies retain Gemini response topology and hide auth/signed queries", () => {
  const raw = { choices: [{ message: { images: [{ image_url: { url: "https://cdn.example/a.png?signature=private" } }], content: "data:image/png;base64,YQ==" } }],
    authorization: "Bearer " + imageKey, api88VideoKey: videoKey, text: imageKey };
  const text = JSON.stringify(masker([imageKey, videoKey]).clean(raw));
  for (const secret of [imageKey, videoKey, "signature=private"]) assert.ok(!text.includes(secret));
  assert.match(text, /choices/); assert.match(text, /image_url/); assert.match(text, /data:image/);
});
test("server environment isolates all storage, excludes ambient provider keys", () => {
  const dir = directory();
  const env = childEnvironment(keys, dir);
  const childHome = join(dir, "home");
  const configDir = join(childHome, ".ima2");
  assert.equal(env.IMA2_PORT, "0"); assert.equal(env.IMA2_HOST, "127.0.0.1");
  assert.equal(env.HOME, childHome); assert.notEqual(env.HOME, process.env.HOME);
  assert.equal(env.USERPROFILE, childHome); assert.equal(env.IMA2_CONFIG_DIR, configDir);
  assert.deepEqual(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")), {
    mcp: { enabledProviders: [] }, api88Provider: { baseUrl: keys.baseUrl } });
  assert.equal(grokAuthFilePath(env.HOME), join(childHome, ".progrok", "auth.json"));
  assert.equal(env.IMA2_DB_PATH, join(configDir, "sessions.db"));
  assert.equal(env.IMA2_GENERATED_DIR, join(configDir, "generated"));
  assert.equal(env.IMA2_MCP_PROVIDERS, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.XAI_API_KEY, undefined);
  assert.equal(env.IMA2_88API_IMAGE_KEY, imageKey); assert.equal(env.IMA2_88API_VIDEO_KEY, videoKey);
});
test("mandatory artifacts enter the preview gallery with accurate sidecars and no fetch", () => {
  const dir = directory(); const gallery = join(dir, "gallery");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=", "base64");
  for (const name of ["01-generation.png", "02-edit.png", "03-gemini.png"]) writeFileSync(join(dir, name), png);
  writeFileSync(join(dir, "04-grok.mp4"), Buffer.from("000000186674797069736f6d", "hex"));
  writeFileSync(join(dir, "04-grok-task.json"), JSON.stringify({ providerTaskId: "fixture-task" }));
  globalThis.fetch = (async () => { throw new Error("staging must never fetch"); }) as typeof fetch;
  stageMandatoryArtifacts(dir, gallery, [imageKey, videoKey]);
  const expected = { "01-generation.png": "gpt-image-2", "02-edit.png": "gpt-image-2",
    "03-gemini.png": "gemini-3.1-flash-lite-image", "04-grok.mp4": "grok-imagine-video-1.5" };
  for (const [name, model] of Object.entries(expected)) {
    const filename = "api88-demo-" + name;
    assert.deepEqual(readFileSync(join(gallery, filename)), readFileSync(join(dir, name)));
    const metadata = JSON.parse(readFileSync(join(gallery, filename + ".json"), "utf8"));
    assert.equal(metadata.provider, "88api"); assert.equal(metadata.model, model);
    assert.equal(metadata.kind, name.endsWith("mp4") ? "video" : "image");
    assert.equal(metadata.createdAt, statSync(join(dir, name)).mtimeMs);
    assert.equal(typeof metadata.prompt, "string"); assert.ok(metadata.prompt.length > 0);
  }
  assert.equal(JSON.parse(readFileSync(join(gallery, "api88-demo-02-edit.png.json"), "utf8")).prompt,
    "Change the mug color to deep navy blue, keep everything else identical");
  const video = JSON.parse(readFileSync(join(gallery, "api88-demo-04-grok.mp4.json"), "utf8"));
  assert.equal(video.video.providerTaskId, "fixture-task");
  assert.equal(JSON.parse(readFileSync(join(dir, "gallery-staging.masked.json"), "utf8")).paidSubmissions, 0);
});
test("UI preview blocks outbound submit and sets child umask before server import", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("preview reached network"); }) as typeof fetch;
  const recorder = recordFetch(directory(), "https://api.88api.ai", [imageKey, videoKey], "preview.json", false);
  try {
    await assert.rejects(() => fetch("https://api.88api.ai/v1/videos", { method: "POST" }), /PREVIEW_SUBMIT_FORBIDDEN/);
    assert.equal(calls, 0);
  } finally { recorder.restore(); }
  const source = sourceText(new URL("../scripts/api88DemoServer.ts", import.meta.url), "utf8");
  const maskIndex = source.indexOf("process.umask(0o077)");
  const bootIndex = source.indexOf('import("../server.ts")');
  assert.ok(maskIndex >= 0 && bootIndex >= 0 && maskIndex < bootIndex);
  assert.match(source, /config\.mcp\.enabledProviders = \[\]/);
  assert.doesNotMatch(source, /\/api\/(?:video\/)?generate/);
});
test("attempt marker prevents the same operation being repeated in a run directory", () => {
  const dir = directory(); once(dir, "01-generation", "gpt-image-2");
  assert.throws(() => once(dir, "01-generation", "gpt-image-2"), /EEXIST/);
});
test("a failed real catalog probe aborts before any paid submission", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    assert.ok(url.endsWith("/v1/models")); assert.equal(init?.method ?? "GET", "GET");
    return Response.json({ error: { message: "fixture denied" } }, { status: 401 });
  }) as typeof fetch;
  await assert.rejects(() => runDemo(keys, flags, directory()));
  assert.ok(calls.length > 0); assert.ok(calls.every(url => url.endsWith("/v1/models")));
});
test("mandatory four use actual transports once each, edit generated PNG, capture masked Gemini JSON", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "white" } }).png().toBuffer();
  const mp4 = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");
  const paid: string[] = []; const probes: string[] = [];
  const dir = directory();
  const stub = await wireStub(png, mp4, paid, probes, dir);
  globalThis.fetch = stub;
  await runDemo(keys, flags, dir);
  assert.deepEqual(paid, ["/v1/images/generations", "/v1/images/edits", "/v1/chat/completions", "/v1/videos"]);
  assert.deepEqual(probes, ["Bearer " + imageKey, "Bearer " + videoKey]);
  for (const name of ["01-generation.png", "02-edit.png", "03-gemini.png", "04-grok.mp4", "04-grok-task.json"]) assert.ok(readdirSync(dir).includes(name));
  const raw = readFileSync(join(dir, "gemini-response.masked.json"), "utf8");
  assert.match(raw, /choices/); assert.match(raw, /images/); assert.ok(!raw.includes(imageKey));
  const rows = JSON.parse(readFileSync(join(dir, "requests.masked.json"), "utf8")) as Array<{ status: number; bytes: number; authorization: string }>;
  assert.ok(rows.every(row => row.status === 200 && row.bytes > 0));
  assert.equal(rows.at(-1)?.authorization, "absent");
  const task = JSON.parse(readFileSync(join(dir, "04-grok-task.json"), "utf8"));
  assert.equal(task.providerTaskId, "task/fixture");
  const savedLog = readFileSync(join(dir, "requests.masked.json"), "utf8");
  await assert.rejects(() => runDemo(keys, flags, dir), /EEXIST/);
  assert.equal(readFileSync(join(dir, "requests.masked.json"), "utf8"), savedLog);
});
async function wireStub(png: Buffer, mp4: Buffer, paid: string[], probes: string[], dir: string): Promise<typeof fetch> {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers);
    const image = headers.get("authorization") === "Bearer " + imageKey;
    const video = headers.get("authorization") === "Bearer " + videoKey;
    if (url.pathname === "/v1/models") {
      probes.push(headers.get("authorization")!); assert.ok(image || video);
      return Response.json({ data: (image ? ["gpt-image-2", "gemini-3.1-flash-lite-image"] : ["grok-imagine-video-1.5"]).map(id => ({ id })) });
    }
    if (init?.method === "POST") {
      paid.push(url.pathname); assert.equal(probes.length, 2);
      if (url.pathname === "/v1/images/edits") {
        assert.ok(image && !video); assert.ok(init.body instanceof FormData);
        assert.equal(init.body.get("model"), "gpt-image-2"); assert.equal(init.body.get("n"), "1");
        const files = init.body.getAll("image[]"); assert.equal(files.length, 1);
        assert.ok(files[0] instanceof Blob); assert.equal(files[0].type, "image/png");
        assert.deepEqual(Buffer.from(await files[0].arrayBuffer()), readFileSync(join(dir, "01-generation.png")));
        return Response.json({ data: [{ b64_json: png.toString("base64") }] });
      }
      const body = JSON.parse(String(init.body));
      if (url.pathname === "/v1/images/generations") {
        assert.ok(image && !video); assert.equal(body.n, 1); assert.equal(body.size, "1024x1024");
        assert.equal(body.model, "gpt-image-2"); assert.equal(body.quality, undefined); assert.equal(body.response_format, undefined);
        return Response.json({ data: [{ b64_json: png.toString("base64") }] });
      }
      if (url.pathname === "/v1/chat/completions") {
        assert.ok(image && !video); assert.equal(body.model, "gemini-3.1-flash-lite-image");
        assert.equal(typeof body.messages[0].content, "string");
        return Response.json({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64," + png.toString("base64") } }] } }], authorization: "Bearer " + imageKey });
      }
      if (url.pathname === "/v1/videos") {
        assert.ok(video && !image);
        assert.deepEqual(body, { model: "grok-imagine-video-1.5", prompt: body.prompt, duration: 4, size: "16:9", metadata: { resolution: "480p" } });
        return Response.json({ id: "task/fixture", status: "queued" });
      }
    }
    if (url.pathname === "/v1/videos/task%2Ffixture") {
      const task = JSON.parse(readFileSync(join(dir, "04-grok-task.json"), "utf8"));
      assert.equal(task.providerTaskId, "task/fixture", "id must be persisted before the first poll");
      assert.ok(video && !image); return Response.json({ status: "completed", url: "https://cdn.example/video.mp4?signature=unchanged" });
    }
    if (url.href === "https://cdn.example/video.mp4?signature=unchanged") {
      assert.equal(headers.has("authorization"), false); return new Response(new Uint8Array(mp4), { headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`unexpected fetch ${url.origin}${url.pathname}`);
  }) as typeof fetch;
}
test("recorder blocks a second submit even if a transport incorrectly retries", async () => {
  let count = 0;
  globalThis.fetch = (async () => { count++; throw new TypeError("fixture network loss"); }) as typeof fetch;
  const recorder = recordFetch(directory(), "https://api.88api.ai", [imageKey, videoKey]);
  recorder.setOperation("04-grok", "grok-imagine-video-1.5");
  const submit = () => fetch("https://api.88api.ai/v1/videos", { method: "POST", body: JSON.stringify({ model: "grok-imagine-video-1.5" }) });
  try {
    await assert.rejects(submit, /network loss/); await assert.rejects(submit, /SUBMIT_RETRY_FORBIDDEN/);
    assert.equal(count, 1);
  } finally { recorder.restore(); }
});
test("optional flags schedule only selected cheap video models", async () => {
  const dir = directory(); const models: string[] = [];
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "white" } }).png().toBuffer();
  const actual = await loadPorts();
  const ports: DemoPorts = { ...actual, context: () => requireRuntimeContext({}),
    catalog: async (_ctx, kind) => kind === "image" ? ["gpt-image-2", "gemini-3.1-flash-lite-image"]
      : ["grok-imagine-video-1.5", "seedance-2.0-mini-480p", "veo-3.1-fast", "gemini-omni-flash"],
    image: async () => ({ b64: png.toString("base64") }),
    video: async (_ctx, input) => { models.push(input.model);
      if (input.model === "veo-3.1-fast") { assert.equal(input.duration, 4); assert.equal(input.resolution, "720p"); }
      if (input.model === "seedance-2.0-mini-480p") { assert.equal(input.duration, 4); assert.equal(input.resolution, "480p"); }
      if (input.model === "gemini-omni-flash") { assert.equal(input.duration, 3); assert.equal(input.resolution, "720p"); }
      return { videoBuffer: Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex"), providerTaskId: "fixture" }; },
  };
  await runDemo(keys, { ...flags, seedance: true, veo: true, omni: true }, dir, ports);
  assert.deepEqual(models, ["grok-imagine-video-1.5", "seedance-2.0-mini-480p", "veo-3.1-fast", "gemini-omni-flash"]);
});
test("live entrypoint and helper are never referenced by workflow or npm scripts", () => {
  const { scripts } = JSON.parse(sourceText(new URL("../package.json", import.meta.url), "utf8"));
  for (const command of Object.values(scripts)) assert.doesNotMatch(String(command), /api88-live-smoke|api88DemoServer/);
  const workflowDir = new URL("../.github/workflows/", import.meta.url);
  for (const file of readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name))) {
    assert.doesNotMatch(sourceText(new URL(file, workflowDir), "utf8"), /api88-live-smoke|api88DemoServer/);
  }
});
```

The optional scheduling test is synthetic scheduler evidence, not native transport or live
proof. The baseline test uses real imports and HTTP stubs. Add a separate failed-video-submit
fixture in 020 to prove `API88_VIDEO_SUBMIT_UNCERTAIN`; the recorder regression here ensures
even a broken retry cannot duplicate the demo's paid POST.

### MODIFY `docs/migration/runtime-test-inventory.md` — generated inventory only

Current anchors: line 7 `Total: 552 (runtime: 251, contract: 301)`; lines 28–31:

```text
- `tests/api-cache-policy.test.ts`
- `tests/api-image-tool-model.test.ts`
- `tests/api-provider-parity.test.ts`
- `tests/api-request-budget.test.ts`
```

Current next line 32 lists `tests/asset-character-bindings.test.ts`. Replace the
31–32 adjacency with exactly this after-text:

```text
- `tests/api-request-budget.test.ts`
- `tests/api88-live-smoke-contract.test.ts`
- `tests/asset-character-bindings.test.ts`
```

For the original 552-test tree plus this file only, the generated after-summary is
`Total: 553 (runtime: 252, contract: 301)` because the direct `../lib/runtimeContext.ts`
import classifies it as runtime. In the integrated branch, 010/020 also add tests, so run
`node scripts/classify-tests.mjs` after all files exist; never overwrite their entries or
hardcode 553. The generator sorts the complete current filename set and is the source of truth.
No change to the generator's TypeScript/JavaScript code or its regex.

### Existing tests whose expected lists change in wp4: none

This phase introduces no lane, model, surface, key vocabulary, CLI help, or canary registry
entry. `tests/atlascloud-provider-contract.test.ts`, `tests/provider-canary-parity.test.ts`,
and `tests/provider-canary-live-contract.test.ts` remain byte-for-byte unchanged. The
generated inventory above is the only wp4 existing-file change.

Predecessor owners must already have updated their enumeration contracts. Verified current
anchors for coordination (not extra wp4 edits): registry test 17–19 and capabilities test
41–43 share the ten-lane list; parity test 14 has `CORE_IDS`; models endpoint 178–180
adds Runway/Higgsfield after that list; doctor test 43 pins `10`; CLI video test 118 pins
`/--provider <grok\|grok-api\|comfy\|runway\|higgsfield>/`. 010/020 own their exact diffs,
including D4 derivation corrections, image-model unions, execution-owner maps, and video
controls. Do not mechanically add API88 to native Responses/Grok-only expectations.

## 4. Artifact handling and secret scans

Default directory: `~/.ima2/88api-demo/<UTC timestamp>-<UUID>/`, directory mode 0700.
The direct/staged artifacts and explicit JSON writers use mode 0600. The server child sets
umask 077 before startup, restricting newly created SQLite files, sidecars, media and cache
files to owner access. Migration copies may retain their source file modes; they remain
inside the private temporary-home tree and are excluded from the shared evidence selection.
Do not claim every copied file is mode 0600. No evidence goes on this branch. Keep signed
URL query strings in actual download requests; masked logs remove them.
The Gemini response file preserves `choices/message/content/images/image_url` topology and
image data while masking secrets and signed URLs. Download `Authorization` is logged as
`absent`; authenticated rows log only `Bearer [REDACTED]`. Never log request bodies, keys,
unmasked headers, full exceptions/stacks, or environment dumps.

Before recording UI evidence or pushing, run both pattern scans and an exact-known-key scan.
`rg` exit 1 is the expected “no matches”; exit 2 is a scan failure, not clean evidence.
Avoid printing matches: `--quiet` below detects without disclosing secrets. The explicitly
requested history command is preserved as a pipeline but matches go to the scanner's exit
status, not the terminal:

```sh
# Parent only, after implementation. Run from the repository root using bash.
set -o pipefail
git log -p origin/dev..HEAD | rg --quiet 'sk-[A-Za-z0-9]{20,}'
# Expected exit 1; no stdout. Any 0 hit or any other failure blocks push.
rg --hidden --no-ignore --quiet -a 'sk-[A-Za-z0-9]{20,}' \
  --glob '!.git/**' --glob '!node_modules/**' --glob '!ui/node_modules/**' .
# Expected exit 1. Includes ignored worktree config/output; scans no dependency files.
rg --hidden --no-ignore --quiet -a 'sk-[A-Za-z0-9]{20,}' "$API88_DEMO_DIR"
# Expected exit 1. Logs, JSON, generated metadata, child DB, and artifacts included.
```

The exact literal check required by the handoff is
`git log -p origin/dev..HEAD | rg 'sk-[A-Za-z0-9]{20,}'`; its stdout must be empty.
Use the quiet equivalent above while handling real keys. Scan every current known key
even if it has a non-`sk-` prefix. Use this exact script, without printing matches or keys:

```sh
API88_DEMO_DIR="$API88_DEMO_DIR" node --import tsx --input-type=module <<'NODE'
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnvFile } from './scripts/api88Demo.ts';
let file = {};
try { file = parseEnvFile(readFileSync(join(homedir(), '.ima2', '88api.env'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('secret source unreadable'); }
const secrets = [...new Set([process.env.IMA2_88API_IMAGE_KEY, process.env.IMA2_88API_VIDEO_KEY,
  file.IMA2_88API_IMAGE_KEY, file.IMA2_88API_VIDEO_KEY].filter(Boolean))];
if (!secrets.length || !process.env.API88_DEMO_DIR) throw new Error('scan inputs missing');
const history = spawnSync('git', ['log', '-p', 'origin/dev..HEAD'], { maxBuffer: 128 * 1024 * 1024 });
if (history.status !== 0 || history.error) throw new Error('history scan failed');
let hits = secrets.some(secret => history.stdout.includes(Buffer.from(secret))) ? 1 : 0;
function scan(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('scan symlink requires explicit review');
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (['.git', 'node_modules'].includes(name)) continue;
      scan(join(path, name));
    }
  } else if (stat.isFile()) {
    const bytes = readFileSync(path);
    if (secrets.some(secret => bytes.includes(Buffer.from(secret)))) hits++;
  }
}
scan(process.cwd()); scan(process.env.API88_DEMO_DIR);
console.log(`exact-key scan hits=${hits}`);
process.exitCode = hits ? 1 : 0;
NODE
```

If any secret is found, stop and report the affected evidence class privately; do not print
the key. Never rely on a follow-up deletion commit to erase secrets in `origin/dev..HEAD`.
Parent owns any required history repair; this leaf and the smoke do not mutate Git.

## 5. UI screenshot / short screen recording

After 010/020's UI build, use the browser to inspect the isolated UI during the optional
`--server` preview. Before any server boot, `main` stages the mandatory results into
`<run>/home/.ima2/generated` as `api88-demo-01-generation.png`, `api88-demo-02-edit.png`,
`api88-demo-03-gemini.png`, and `api88-demo-04-grok.mp4`, each with a `.json` sidecar.
Sidecars preserve provider `88api`, exact model, exact submitted prompt, media kind and
local result-file creation time (`created` and `createdAt` use the source file's mtime).
Image size is read from the converted PNG's IHDR; video axes are explicitly labeled as
submitted parameters, not independently measured encoded properties. Bytes are copied
unchanged, the original direct request log is untouched, and staging submits nothing.
Capture Settings showing 88API's image key and video key in their **masked status** state,
base URL and its source; never show an input with the raw value, devtools requests, terminal
environment, or `88api.env`. Show the lane with `gpt-image-2` selected, an existing generated
image/result metadata, then an existing Grok 480p/4s result with exact provider/model metadata.
Do not click Generate just to improve a screenshot: the four required submissions already
spent their budget. Screen recording should be 15–30 seconds: Settings → result → video.

The child verifies `/api/history` against the four staged sidecars and reads masked
`/api/keys/status`, then sends `{state:"ready",url,bootId}` over IPC. The parent prints the
temporary URL and leaves the child alive for five minutes for capture; `<run>/server.json`
also records the address. Generation is disabled at the child's outbound fetch boundary.
The window is not evidence that `/api/generate` or `/api/video/generate` executed. Ordinary
startup migration may add unrelated existing gallery rows; select only the four
`api88-demo-*` rows and never include copied personal material in screenshots or the report.

To open a later five-minute preview of an existing successful run, use this exact command
with `API88_DEMO_DIR` set to that run. It calls no generation transport, does not invoke
`runDemo`, and does not restage or overwrite media:

```sh
node --import tsx --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { childEnvironment, keysFrom, parseEnvFile, optionalServer } from './scripts/api88Demo.ts';
const dir = process.env.API88_DEMO_DIR;
if (!dir) throw new Error('API88_DEMO_DIR is required');
let file = {};
try { file = parseEnvFile(readFileSync(join(homedir(), '.ima2', '88api.env'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('credential source unavailable'); }
const keys = keysFrom(process.env, file);
await optionalServer(childEnvironment(keys, dir));
NODE
```

Use the installed browser skill/tool when performing capture; this planning leaf did not
invoke it. Store `settings-masked.png`, `generation-result.png`, and `demo.mp4` in the demo
directory, inspect them visually for keys before sharing. UI-changing PR screenshot rules
still apply: upload via the description editor, or let the parent use the orphan `pr-assets`
branch and SHA-pinned raw links. Never commit screenshots to `feat/88api-provider`.

## 6. Push and 88API report

Only the parent executes this step. Require focused/static checks, the four live passes,
all pattern scans clean (zero matches, not a scanner failure), exact-key scan exit 0,
and reviewed masked evidence. Optional failures remain failures in the report; do not call
the entire demo passed while the server child failed. Then:

```sh
git push -u origin feat/88api-provider
git rev-parse HEAD
git remote get-url origin
```

No merge, release, publish, sponsor-row edit, automatic email, or payment claim. Derive
the branch URL from the actual origin; `package.json:70` currently says
`https://github.com/lidge-ai/ima2-gen`, while the older handoff named `lidge-jun`. Verify
origin before reporting. Expected URL if origin matches package metadata:
`https://github.com/lidge-ai/ima2-gen/tree/feat/88api-provider`.

Copy this report, fill only observed facts, and attach reviewed artifacts through the
authorized sharing channel. Writing this template does not authorize sending a message.

```text
88API × ima2-gen integration demo — <date UTC/KST>
Branch: <actual branch URL>
Head SHA: <exact pushed HEAD>
Image/video credential separation: <mock contract result and live probes; no key values>
Mandatory calls (each submitted once):
1. gpt-image-2 /v1/images/generations, 1024x1024, n=1: <PASS/FAIL + artifact>
2. gpt-image-2 /v1/images/edits, local PNG multipart: <PASS/FAIL + artifact>
3. gemini-3.1-flash-lite-image /v1/chat/completions: <PASS/FAIL + artifact>
   Observed image field: <message.images / content array / content string>
4. grok-imagine-video-1.5 /v1/videos → poll → MP4, 480p/4s/16:9: <PASS/FAIL + artifact>
Optional smokes: <not run, or exact model/params/result; additional submissions counted>
UI preview: <not run, or GET gallery/masked-key status verified; staged mandatory artifacts>
UI preview generation submissions: 0 (no paid route proof claimed)
Request-log summary: <operation/model/endpoint/status/ms/bytes; polls separate from submits>
Checks: <commands + actual exit status; synthetic vs live evidence distinguished>
Secret scans: <history/worktree/demo zero matches; exact-known-key hits=0>
Evidence: <reviewed masked screenshots/recording; no local secret paths or signed URLs>
Console usage: <observed charges and unit, or not confirmed>
Open questions (handoff §8):
1. What endpoints serve grok-imagine-image, grok-imagine-image-quality, grok-imagine-edit?
2. What chat/completions fields control Gemini image aspect ratio and 1K/2K/4K resolution?
3. Does grok-imagine-video-1.5 accept metadata.resolution=1080p, or require the separate -1.5-1080p model?
4. Which size and quality values do gpt-image-2.5-flare and gpt-image-2.5-sunburst support?
5. Are pricing values yuan, USD credits, or another credit unit?
```

## 7. Plan deviations and implementation caveats

No D1–D10 deviation is required by current-source evidence. This plan follows the locked
choices rather than 004's older `88api-image` key proposal or 003's earlier root-level
adapter filename proposals. `api88-image`/`api88-video` and `lib/api88/` remain authoritative.

Coordination assumptions: §2 matches the full code now proposed in 010/020; implementation
must still confirm those exports exist. 000 did not fix catalog/video function signatures,
so this leaf reconciled them when the parent plans appeared rather than inventing a
production interface. No production-file expansion is silently made.

Requested `.mjs` versus TypeScript: the small entry uses TypeScript-compatible JavaScript,
with complete TypeScript implementations in neighboring scripts; no extension lie or
unparseable type annotations in `.mjs`. `tsx` is an explicit launch requirement.

Outside-repo artifacts avoid expanding `.gitignore`. The child receives a temporary HOME
(plus USERPROFILE/XDG paths), isolated config/storage paths, only the two 88API environment
credentials, the configured base URL, and umask 077. Its JSON config contains
`mcp.enabledProviders: []` and `api88Provider.baseUrl`. Because `config.ts:327–328` converts
an empty array to a string ignored by `pickStr`, the demo child explicitly clears the
in-memory MCP enable list before calling the unmodified server. The individual credential
loaders still permit package config fallback (`server.ts:69–195`); the preview refuses a
package config with other-provider credentials instead of reading them into runtime auth.
No production server-boot expansion is required or proposed under the parent's synthesis.

Storage migration remains enabled (`server.ts:474`); it may read repository/global-install
galleries and copy missing files into the temporary destination (`storageMigration.ts:30,
98–144`). The parent accepts those copies. This isolates home auth and write destinations;
it does not promise that the gallery contains only newly created material. Staging runs
before boot, so migration's `COPYFILE_EXCL` preserves the four mandatory media/sidecars.
The preview makes zero generation submissions and is never the default. The original extra
paid server route proof has been removed by the accepted A1 scope correction.

Resume/probe calls must not repeat paid submission; preserved task IDs are evidence, not
automatic refund/cancellation. The recorder logs top-level fetches, not individual network
redirect hops. 020's current tests assert `redirect: "follow"`: this is transport-option
evidence, not demonstration of an actual redirect chain. No live redirect-chain pass is claimed.

## Verification

These are **future parent commands**, not commands executed by this leaf. Run from the
repository root after prerequisite implementations and export reconciliation. Do not run
`npm test` or release helpers. No paid script in npm scripts/workflows or scheduled CI.

```sh
node --check scripts/api88-live-smoke.mjs
node --experimental-test-module-mocks --import tsx --test tests/api88-live-smoke-contract.test.ts
npm run typecheck
npm run typecheck:tests
npm run lint
node scripts/generate-provider-types.mjs --check
node scripts/classify-tests.mjs
npm run test:inventory
cd ui
npm run build
cd ..
```

Run wp2/wp3's exact focused file lists from 010/020 as prerequisites; never claim broad
transport coverage from this scheduler test alone. Inspect new code-file/function lengths
against the <500/<50 convention and recheck anchors with `rg -n`/`nl -ba` after shared-tree
changes. Mock tests must finish with zero failures, no real network calls, and no ambient
key lookup. The CLI live guard refuses any environment with `CI` or `GITHUB_ACTIONS` set.

Create `~/.ima2/88api.env` outside Git with mode 0600 using a trusted local editor, or supply
the two keys through the environment without typing them into committed scripts or recorded
terminal sessions. Optional `IMA2_88API_BASE_URL` is supported. Do not `cat` the credential
file, put keys into command arguments, or include it in the report.

```sh
# Mandatory four only. No automatic rerun on nonzero exit.
node --import tsx scripts/api88-live-smoke.mjs --run
# Alternative initial run, only when these additional spends are intended:
# node --import tsx scripts/api88-live-smoke.mjs --run --seedance --veo --omni --server
# Do not execute both lines as a verification checklist.
```

Set `API88_DEMO_DIR` to the artifact path printed by the one invocation. Review
`delivery-summary.masked.json`, the direct-only `summary.masked.json`, `failure.masked.json`
if present, `gallery-staging.masked.json`, the staged gallery sidecars, task IDs, the three PNGs, MP4,
Gemini response topology, and request logs. Run §4's three pattern scans and exact-key scan;
the literal history scan stdout must be empty. Review UI evidence. Only then run §6's
`git push -u origin feat/88api-provider` and complete the report with the pushed SHA.

## Audit fold (A1)

- B3, parent synthesis: §2 anchors and §3 `childEnvironment` / `api88DemoServer.main` now use a temporary HOME, explicit MCP-empty config, in-memory MCP disable, package-credential guard and ordinary server boot; §7 documents accepted migration copies. No server boot modification is proposed.
- B4: §3 `stageMandatoryArtifacts`, `main`, preview GET verification and new contract tests stage the four existing results plus accurate sidecars; §§1/5/6 count preview submissions as zero and remove the extra paid server proof.
- N1: §2's 020 anchors refreshed to transport 351, event/result 364/378 and generation export 521 in the current planning tree.
- N2: §3 child umask 077 is set before runtime imports; §4 narrows mode claims for migration copies; the preview guard/permissions contract was added to the proposed tests.
- N3: §7 now labels `redirect: "follow"` assertions as transport-option evidence, with no actual redirect-chain claim.

Audit blockers 1–2 belong to 020's owner and were not edited by this 030 leaf. All A1 changes
here are document-only; no build, test, network call or Git write was performed.
