import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { GROK_DIRECT_ORIGIN, type openVideoFixture } from "./_videoExecutionFixture.ts";
import { fakeMp4Bytes } from "./_videoStreamFixture.ts";

type VideoFixture = Awaited<ReturnType<typeof openVideoFixture>>;
type RouteEnv = { fixture: VideoFixture; config: VideoFixture["config"]; registerVideoRoutes: typeof import("../routes/video.ts").registerVideoRoutes };

/** Mock xAI upstream (search -> planner -> start -> poll -> download) and the video app. */
export function createVideoRouteHarness(env: () => RouteEnv) {
  const proxyOptions = new WeakMap<import("node:http").Server, ProxyOptions>();
  type ProxyOptions = {
    onPath?: (path: string) => void;
    failFirstGeneration?: boolean; captureStart?: (body: any) => void;
    downloadCase?: "invalid-mp4" | "declared-too-large";
  };
  async function listen(server: import("node:http").Server): Promise<string> {
    const origin = await env().fixture.listen(server, "proxy");
    env().fixture.bridgeProxy(server, (call) => {
      const target = new URL(call.url);
      assert.equal(target.search, "");
      assert.equal(call.headers.get("cookie"), null);
      if (target.pathname === "/dl/v.mp4") {
        assert.equal(target.origin, origin, "the artifact stays on the owned mock origin");
        assert.equal(call.method, "GET");
        assert.equal(call.body, "");
        assert.equal(call.headers.get("authorization"), null);
        return;
      }
      assert.equal(target.origin, GROK_DIRECT_ORIGIN, "authenticated video calls leave for xAI directly");
      assert.equal(call.headers.get("authorization"), env().fixture.grokBearer);
      if (target.pathname === "/v1/videos/vid-xyz") {
        assert.equal(call.method, "GET");
        assert.equal(call.body, "");
        return;
      }
      assert.ok(["/v1/responses", "/v1/chat/completions", "/v1/videos/generations"].includes(target.pathname));
      assert.equal(call.method, "POST");
      assert.equal(call.headers.get("content-type"), "application/json");
      const body = JSON.parse(call.body);
      assert.ok(body && typeof body === "object" && !Array.isArray(body));
      assert.equal(typeof body.model, "string");
      if (target.pathname === "/v1/videos/generations") {
        assert.equal(typeof body.prompt, "string");
        proxyOptions.get(server)?.captureStart?.(body);
      } else {
        assert.ok(Array.isArray(target.pathname === "/v1/responses" ? body.input : body.messages));
      }
    }, "/dl/v.mp4");
    return origin;
  }

  function artifactReply(res: import("node:http").ServerResponse, kind?: ProxyOptions["downloadCase"]): void {
    res.writeHead(200, { "Content-Type": "video/mp4",
      ...(kind === "declared-too-large" ? { "Content-Length": "104857601" } : {}) });
    if (kind === "declared-too-large") { res.flushHeaders(); return; }
    res.end(kind === "invalid-mp4" ? Buffer.from("invalid MP4 bytes") : fakeMp4Bytes());
  }
  // Mock xAI upstream: search -> planner -> start -> poll(done) -> download.
  function makeProxy(options: ProxyOptions = {}) {
    let polls = 0;
    let starts = 0;
    const server = createServer((req, res) => {
      const url = req.url || "";
      options.onPath?.(url);
      if (url === "/v1/responses") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "text", text: "brief" }] }] }));
      }
      if (url === "/v1/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt: "english clip" }) } }] } }] }));
      }
      if (url === "/v1/videos/generations") {
        req.resume();
        req.on("end", () => {
          starts += 1;
          if (options.failFirstGeneration && starts === 1) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "`reference_images` is not supported for this model." }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ request_id: "vid-xyz" }));
        });
        return;
      }
      if (url === "/v1/videos/vid-xyz") {
        polls += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        const port = (server.address() as any).port;
        if (!options.downloadCase && polls < 2) return res.end(JSON.stringify({ status: "pending", progress: 50 }));
        return res.end(JSON.stringify({ status: "done", progress: 100, video: { url: `http://127.0.0.1:${port}/dl/v.mp4`, duration: 1, respect_moderation: true }, usage: { cost_in_usd_ticks: 500000000 } }));
      }
      if (url === "/dl/v.mp4") {
        return artifactReply(res, options.downloadCase);
      }
      res.writeHead(404);
      res.end("nope");
    });
    proxyOptions.set(server, options);
    return server;
  }

  async function videoApp(generatedDir) {
    const app = express();
    env().fixture.trackApp(app);
    app.use(express.json({ limit: "8mb" }));
    env().registerVideoRoutes(app, {
      rootDir: env().fixture.root,
      packageVersion: "test",
      grokAuthHomeDir: env().fixture.grokAuthHomeDir,
      config: {
        ...env().config,
        storage: { ...env().config.storage, generatedDir },
        grokProvider: { ...env().config.grokProvider, videoPollIntervalMs: 1, videoStartTimeoutMs: 5000, videoTimeoutMs: 30000, videoDownloadTimeoutMs: 5000, plannerTimeoutMs: 5000 },
      },
    });
    const server = createServer(app);
    const url = await env().fixture.listen(server, "app");
    return { server, url };
  }

  function parseSse(text) {
    const events = [];
    for (const block of text.split("\n\n")) {
      const ev = /event: (.+)/.exec(block);
      const data = /data: (.+)/.exec(block);
      if (ev && data) events.push({ event: ev[1].trim(), data: JSON.parse(data[1]) });
    }
    return events;
  }
  return { listen, makeProxy, videoApp, parseSse };
}
