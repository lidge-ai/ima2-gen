import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_ARGS = ["--import", "tsx", join(REPO_ROOT, "bin", "ima2.ts")];
const tempDirs = [];
const servers = [];
// Isolated ima2 home for every spawned CLI. Without this, CLI runs that omit
// --out/--out-dir fall back to config.storage.generatedDir and write mock
// downloads (e.g. a 3-byte out.mp4) into the REAL ~/.ima2/generated, which
// then surfaces in the user's history as a data-less ghost video on startup.
// IMA2_GENERATED_DIR must be pinned too: it outranks IMA2_CONFIG_DIR in
// config.ts, so an inherited value would leak past the config-dir override.
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "ima2-video-cli-home-"));
const ISOLATED_GENERATED = join(ISOLATED_HOME, "generated");
tempDirs.push(ISOLATED_HOME);

const MODEL_CATALOG = {
  ok: true,
  lanes: {
    grok: { status: "ready", defaults: { video: "grok-imagine-video" }, models: { image: [], video: [
      { id: "grok-imagine-video", capabilities: { parameters: [], inputRoles: ["text", "start_image", "image_references"] } },
      { id: "grok-imagine-video-1.5", capabilities: { parameters: [], inputRoles: ["text", "start_image", "image_references"] } },
    ] } },
    runway: { status: "ready", defaults: { video: "veo-3.1" }, models: { image: [], video: [
      { id: "seedance-2", capabilities: { parameters: [], aspectRatios: ["16:9", "9:16"],
        inputRoles: ["text", "start_image", "end_image", "image_references", "video_references"] } },
      { id: "veo-3.1", capabilities: { parameters: [
        { name: "duration", type: "number", options: [4, 6, 8] },
        { name: "resolution", type: "string", options: ["720p", "1080p"] },
      ], aspectRatios: ["16:9", "9:16"], inputRoles: ["text", "start_image", "end_image"] } },
      { id: "gen-4.5", capabilities: { parameters: [{ name: "duration", type: "number", min: 2, max: 10 }],
        aspectRatios: ["16:9"], inputRoles: ["text", "start_image"] } },
    ] } },
  },
};

function runCLI(args, opts: any = {}) {
  return new Promise<any>((resolve) => {
    const child = spawn(process.execPath, [...CLI_ARGS, ...args], {
      env: {
        ...process.env,
        NO_COLOR: "1",
        IMA2_SERVER: "",
        IMA2_CONFIG_DIR: ISOLATED_HOME,
        IMA2_GENERATED_DIR: ISOLATED_GENERATED,
        ...(opts.env || {}),
      },
      cwd: opts.cwd || process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function listen(server) {
  servers.push(server);
  return new Promise<any>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function tmpDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeServer(handler) {
  return createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, provider: "oauth" }));
      return;
    }
    if (req.url === "/api/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MODEL_CATALOG));
      return;
    }
    handler(req, res);
  });
}

after(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

describe("ima2 video CLI contracts", () => {
  it("documents video subcommands in help", async () => {
    const { code, stdout } = await runCLI(["video", "--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /ima2 video <prompt/);
    assert.match(stdout, /ima2 video edit/);
    assert.match(stdout, /ima2 video edit <prompt> --video <url\|file_id\|generated-file>/);
    assert.match(stdout, /ima2 video extend <prompt> --video <url\|file_id\|generated-file> \[--duration 6\]/);
    assert.match(stdout, /ima2 video continue <prompt> --video <generated-file>/);
    assert.match(stdout, /ima2 video frame/);
    assert.match(stdout, /ima2 video analyze <generated-file>/);
    assert.match(stdout, /--duration <1\.\.15>[\s\S]*Duration in seconds\. Default: 5\. Prompt motion should naturally fill this length/);
    assert.match(stdout, /--duration <2\.\.10>[\s\S]*Extension duration only\. Default: 6/);
    assert.match(stdout, /--topic <text>/);
    assert.match(stdout, /--resolution <480p\|720p\|1080p>/);
    assert.match(stdout, /grok-imagine-video-1\.5/);
    assert.match(stdout, /preview alias accepted/);
    assert.match(stdout, /--provider <grok\|grok-api\|comfy\|runway\|higgsfield>/);
    assert.match(stdout, /--start <generated-filename>/);
    assert.match(stdout, /--end <generated-filename>/);
    assert.match(stdout, /--video-ref <generated-filename>/);
    assert.match(stdout, /file:tag/);
    assert.match(stdout, /ima2 models/);
  });

  it("fails closed without defaults.video and rejects provider auto", async () => {
    const server = makeServer((_req, res) => res.writeHead(404).end());
    const base = await listen(server);
    const bare = await runCLI(["video", "clip", "--json", "--server", base]);
    assert.equal(bare.code, 2, String(bare.stderr).slice(0, 800));
    assert.equal(JSON.parse(bare.stdout).code, "NO_DEFAULT_MODEL");
    assert.equal(bare.stdout.trim().split("\n").length, 1);
    const auto = await runCLI(["video", "clip", "--provider", "auto", "--json", "--server", base]);
    assert.equal(auto.code, 2, String(auto.stderr).slice(0, 800));
    assert.equal(JSON.parse(auto.stdout).code, "PROVIDER_AUTO_REMOVED");
  });

  it("rejects Grok-only flags, unsupported parameters, and local refs on MCP lanes", async () => {
    const server = makeServer((_req, res) => res.writeHead(404).end());
    const base = await listen(server);
    const grokFlag = await runCLI(["video", "clip", "--model", "runway/veo-3.1", "--planner-model", "x", "--json", "--server", base]);
    assert.equal(grokFlag.code, 2, String(grokFlag.stderr).slice(0, 800)); assert.equal(JSON.parse(grokFlag.stdout).code, "FLAG_NOT_SUPPORTED");
    const unsupported = await runCLI(["video", "clip", "--model", "runway/gen-4.5", "--resolution", "1080p", "--json", "--server", base]);
    assert.equal(unsupported.code, 2, String(unsupported.stderr).slice(0, 800)); assert.equal(JSON.parse(unsupported.stdout).code, "MCP_PARAMETER_UNSUPPORTED");
    const localRef = await runCLI(["video", "clip", "--model", "runway/veo-3.1", "--ref", "./local.png", "--json", "--server", base]);
    assert.equal(localRef.code, 2, String(localRef.stderr).slice(0, 800)); assert.equal(JSON.parse(localRef.stdout).code, "MCP_REF_MUST_BE_GENERATED");
  });

  it("passes explicit MCP parameters and generated start frames through the async job bridge", async () => {
    let eventResponse;
    let submitted;
    const server = makeServer((req, res) => {
      if (req.url === "/api/events") {
        eventResponse = res;
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        res.flushHeaders();
        return;
      }
      if (req.url === "/api/mcp/generate" && req.method === "POST") {
        let raw = ""; req.on("data", (chunk) => { raw += chunk; }); req.on("end", () => {
          submitted = JSON.parse(raw);
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, requestId: submitted.requestId }));
          eventResponse.end(`id: 1\nevent: done\ndata: ${JSON.stringify({ jobId: submitted.requestId, filename: "out.mp4", url: "/generated/out.mp4" })}\n\n`);
        });
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI(["video", "clip", "--model", "runway/veo-3.1", "--duration", "8",
      "--aspect-ratio", "16:9", "--start", "1780000000000_abcd.png", "--json", "--server", base]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.equal(JSON.parse(result.stdout).url, "/generated/out.mp4");
    assert.equal(submitted.provider, "runway");
    assert.equal(submitted.model, "veo-3.1");
    assert.deepEqual(submitted.parameters, { duration: 8 });
    assert.equal(submitted.ratio, "16:9");
    assert.equal(submitted.startFrameFilename, "1780000000000_abcd.png");
    assert.equal(submitted.references, undefined);
  });

  it("promotes the first untagged --ref to the MCP start frame when --start is absent", async () => {
    let eventResponse;
    let submitted;
    const server = makeServer((req, res) => {
      if (req.url === "/api/events") {
        eventResponse = res;
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        res.flushHeaders();
        return;
      }
      if (req.url === "/api/mcp/generate" && req.method === "POST") {
        let raw = ""; req.on("data", (chunk) => { raw += chunk; }); req.on("end", () => {
          submitted = JSON.parse(raw);
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, requestId: submitted.requestId }));
          eventResponse.end(`event: done\ndata: ${JSON.stringify({ jobId: submitted.requestId, filename: "out.mp4", url: "/generated/out.mp4" })}\n\n`);
        });
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI([
      "video", "clip", "--model", "runway/veo-3.1",
      "--ref", "1780000000000_abcd.png", "--json", "--server", base,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(submitted.startFrameFilename, "1780000000000_abcd.png");
    assert.equal(submitted.references, undefined);

    const tagged = await runCLI([
      "video", "clip", "--model", "runway/veo-3.1",
      "--ref", "1780000000001_hero.png:hero", "--json", "--server", base,
    ]);
    assert.equal(tagged.code, 2, String(tagged.stderr).slice(0, 800));
    const taggedPayload = JSON.parse(tagged.stdout);
    assert.equal(taggedPayload.code, "INPUT_ROLE_UNSUPPORTED");
    assert.equal(taggedPayload.role, "image_references");
  });

  it("maps MCP start/end/tagged-image/video reference flags to role fields", async () => {
    let eventResponse;
    let submitted;
    const server = makeServer((req, res) => {
      if (req.url === "/api/events") {
        eventResponse = res; res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); return;
      }
      if (req.url === "/api/mcp/generate" && req.method === "POST") {
        let raw = ""; req.on("data", (chunk) => { raw += chunk; }); req.on("end", () => {
          submitted = JSON.parse(raw); res.writeHead(202, { "Content-Type": "application/json" }); res.end('{"ok":true}');
          eventResponse.end(`event: done\ndata: ${JSON.stringify({ jobId: submitted.requestId, filename: "out.mp4", url: "/generated/out.mp4" })}\n\n`);
        }); return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI([
      "video", "restyle", "--model", "runway/seedance-2",
      "--start", "1780000000000_start.png", "--end", "1780000000001_end.webp",
      "--ref", "1780000000002_hero.jpg:hero", "--ref", "1780000000003_scene.png:scene",
      "--video-ref", "1780000000004_source.mov", "--json", "--server", base,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(submitted.startFrameFilename, "1780000000000_start.png");
    assert.equal(submitted.endFrameFilename, "1780000000001_end.webp");
    assert.deepEqual(submitted.references, [
      { filename: "1780000000002_hero.jpg", tag: "hero" },
      { filename: "1780000000003_scene.png", tag: "scene" },
    ]);
    assert.equal(submitted.referenceVideoFilename, "1780000000004_source.mov");
  });

  it("returns INPUT_ROLE_UNSUPPORTED with supporting catalog models and requires start before end", async () => {
    const server = makeServer((_req, res) => res.writeHead(404).end());
    const base = await listen(server);
    const unsupported = await runCLI([
      "video", "clip", "--model", "runway/gen-4.5", "--video-ref", "1780000000000_source.mp4",
      "--json", "--server", base,
    ]);
    assert.equal(unsupported.code, 2, String(unsupported.stderr).slice(0, 800));
    const payload = JSON.parse(unsupported.stdout);
    assert.equal(payload.code, "INPUT_ROLE_UNSUPPORTED");
    assert.deepEqual(payload.supportedModels, ["runway/seedance-2"]);
    assert.match(payload.message, /runway\/seedance-2/);

    const missingStart = await runCLI([
      "video", "clip", "--model", "runway/seedance-2", "--end", "1780000000001_end.png",
      "--json", "--server", base,
    ]);
    assert.equal(missingStart.code, 2, String(missingStart.stderr).slice(0, 800));
    assert.equal(JSON.parse(missingStart.stdout).code, "END_FRAME_REQUIRES_START");
  });

  it("rejects MCP-only reference-role flags on Grok lanes", async () => {
    const server = makeServer((_req, res) => res.writeHead(404).end());
    const base = await listen(server);
    for (const [flag, value] of [
      ["--start", "1780000000000_start.png"],
      ["--end", "1780000000001_end.png"],
      ["--video-ref", "1780000000002_source.mp4"],
    ]) {
      const result = await runCLI(["video", "clip", "--model", "grok/grok-imagine-video", flag, value, "--json", "--server", base]);
      assert.equal(result.code, 2, flag);
      assert.equal(JSON.parse(result.stdout).code, "FLAG_NOT_SUPPORTED", flag);
    }
  });

  it("rejects invalid generate and extend durations before network calls", async () => {
    const noPrompt = await runCLI(["video"]);
    assert.equal(noPrompt.code, 2, String(noPrompt.stderr).slice(0, 800));
    assert.match(noPrompt.stderr, /Active video prompt required/);
    assert.match(noPrompt.stderr, /naturally fill the selected duration/);

    const badGenerate = await runCLI(["video", "clip", "--duration", "6abc"]);
    assert.equal(badGenerate.code, 2, String(badGenerate.stderr).slice(0, 800));
    assert.match(badGenerate.stderr, /--duration must be an integer/);

    const badExtend = await runCLI(["video", "extend", "continue", "--video", "https://example.com/a.mp4", "--duration", "999"]);
    assert.equal(badExtend.code, 2, String(badExtend.stderr).slice(0, 800));
    // 1-15, measured, not the 2-10 xAI documents: the endpoint accepts 1 and 11.
    assert.match(badExtend.stderr, /--duration must be between 1 and 15/);

    const badExtendBeforeServer = await runCLI(["video", "extend", "continue", "--video", "https://example.com/a.mp4", "--duration", "abc", "--server", "http://127.0.0.1:9"]);
    assert.equal(badExtendBeforeServer.code, 2, String(badExtendBeforeServer.stderr).slice(0, 800));
    assert.match(badExtendBeforeServer.stderr, /--duration must be an integer/);
    assert.doesNotMatch(badExtendBeforeServer.stderr, /server unreachable/);

    const badTimeout = await runCLI(["video", "clip", "--timeout", "1abc"]);
    assert.equal(badTimeout.code, 2, String(badTimeout.stderr).slice(0, 800));
    assert.match(badTimeout.stderr, /--timeout must be an integer/);

    const zeroTimeout = await runCLI(["video", "edit", "p", "--video", "https://example.com/v.mp4", "--timeout", "0"]);
    assert.equal(zeroTimeout.code, 2, String(zeroTimeout.stderr).slice(0, 800));
    assert.match(zeroTimeout.stderr, /--timeout must be at least 1/);

    const unknown = await runCLI(["video", "clip", "--duraton", "5"]);
    assert.equal(unknown.code, 2, String(unknown.stderr).slice(0, 800));
    assert.match(unknown.stderr, /unknown option: --duraton/);

    const noContinuePrompt = await runCLI(["video", "continue", "--video", "sample.mp4"]);
    assert.equal(noContinuePrompt.code, 2, String(noContinuePrompt.stderr).slice(0, 800));
    assert.match(noContinuePrompt.stderr, /Active video prompt required/);
    assert.match(noContinuePrompt.stderr, /stable ending frame/);
  });

  it("allows prompt-only Grok Video 1.5 1080p so the server can apply the canvas shim", async () => {
    let body = "";
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/generate")) {
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end('event: done\ndata: {"requestId":"r","filename":"out.mp4","url":"/generated/out.mp4","mediaType":"video"}\n\n');
        });
        return;
      }
      if (req.url?.startsWith("/generated/out.mp4")) {
        res.writeHead(200, { "Content-Type": "video/mp4" });
        res.end("mp4");
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI(["video", "clip", "--resolution", "1080p", "--model", "grok/grok-imagine-video-1.5", "--server", base, "--json"]);
    assert.equal(result.code, 0);
    assert.ok(
      existsSync(join(ISOLATED_GENERATED, "out.mp4")),
      "default download must land in the isolated generated dir, never the real ~/.ima2/generated",
    );
    const parsed = JSON.parse(body);
    assert.equal(parsed.model, "grok-imagine-video-1.5");
    assert.equal(parsed.provider, "grok");
    assert.equal(parsed.duration, 5);
    assert.equal(parsed.aspectRatio, "auto");
    assert.equal(parsed.resolution, "1080p");
    assert.equal(parsed.sourceImage, undefined);
    assert.equal(parsed.referenceImages, undefined);
  });

  it("sends continueFromVideo for video continue", async () => {
    let body = "";
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/generate")) {
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end('event: done\ndata: {"requestId":"r","filename":"out.mp4","url":"/generated/out.mp4","mediaType":"video"}\n\n');
        });
        return;
      }
      if (req.url?.startsWith("/generated/out.mp4")) {
        res.writeHead(200, { "Content-Type": "video/mp4" });
        res.end("mp4");
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI(["video", "continue", "camera pans left, rain sound fades, no dialogue, end on a close-up", "--video", "parent.mp4", "--server", base, "--json"]);
    assert.equal(result.code, 0);
    assert.ok(
      existsSync(join(ISOLATED_GENERATED, "out.mp4")),
      "default download must land in the isolated generated dir, never the real ~/.ima2/generated",
    );
    const parsed = JSON.parse(body);
    assert.equal(parsed.continueFromVideo, "parent.mp4");
    assert.equal(parsed.resolution, "720p");
    assert.match(parsed.prompt, /camera pans left/);
  });

  it("passes edit/extend timeout to fetch", async () => {
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/edit")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const started = Date.now();
    const result = await runCLI(["video", "edit", "p", "--video", "https://example.com/v.mp4", "--timeout", "1", "--server", base]);
    assert.ok(Date.now() - started < 4000, "timeout should end quickly");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /abort|timeout|terminated/i);
  });

  it("keeps frame output deterministic for nested input and --out alias", async () => {
    const cwd = await tmpDir("ima2-video-cli-frame-");
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/frame")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from("PNGDATA"));
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const output = join(cwd, "nested", "wanted.png");
    const result = await runCLI(["video", "frame", "clips/sample.mp4", "--out", output, "--server", base]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Frame saved:/);
    assert.equal((await readFile(output)).toString(), "PNGDATA");
    assert.equal(existsSync(join(cwd, "frame-clips", "sample.png")), false);
  });

  it("reports non-JSON subcommand responses without raw stack traces", async () => {
    const server = makeServer((req, res) => {
      if (req.url?.startsWith("/api/video/analyze")) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("bad gateway");
        return;
      }
      res.writeHead(404).end();
    });
    const base = await listen(server);
    const result = await runCLI(["video", "analyze", "sample.mp4", "--server", base]);
    assert.match(result.stderr, /expected JSON response/);
    assert.doesNotMatch(result.stderr, /SyntaxError|node:internal/);
    if (process.platform === "win32" && Number.parseInt(process.versions.node, 10) >= 24) {
      assert.ok(
        result.code === 1 || result.code === 3221226505,
        `expected exit 1 or Windows Node 24 fatal exit 3221226505, got ${result.code}`,
      );
    } else {
      assert.equal(result.code, 1);
    }
  });
});
