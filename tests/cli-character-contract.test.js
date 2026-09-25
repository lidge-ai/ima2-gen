// wp4 046: CLI --character contract — fail-closed envelopes + body plumbing.
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-cli-character-"));

function runCLI(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", "bin/ima2.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: FAKE_HOME, USERPROFILE: FAKE_HOME, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

const CHARACTER_NO_BINDING = {
  id: "a_char_nobind", kind: "element", name: "NoBind",
  metadata: { elementKind: "character", name: "NoBind", refs: ["r1.png"] },
};
const CHARACTER_RUNWAY = {
  id: "a_char_runway", kind: "element", name: "Hero",
  metadata: { elementKind: "character", name: "Hero", refs: ["r1.png", "r2.png"],
    characterBindings: [{ provider: "runway", mode: "stateless-refs", tag: "hero_01" }] },
};

function makeFake({ assets = [], onMcpGenerate } = {}) {
  return createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/health") { res.end('{"ok":true}'); return; }
    if (req.url?.startsWith("/api/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(": ok\n\n");
      return; // keep the stream open; the POST rejection wins the race
    }
    if (req.url === "/api/models") {
      res.end(JSON.stringify({ ok: true, lanes: {
        oauth: { status: "ready", defaults: { image: "gpt-6-luna" },
          models: { image: [{ id: "gpt-6-luna" }], video: [] } },
        grok: { status: "ready", defaults: { video: "grok-imagine-video" },
          models: { image: [], video: [{ id: "grok-imagine-video" }] } },
        runway: { status: "ready", defaults: { image: "gen-4" }, models: {
          image: [
            { id: "gen-4", capabilities: { parameters: [], inputRoles: ["text", "image_references"] } },
            { id: "text-only", capabilities: { parameters: [], inputRoles: ["text"] } },
          ],
          video: [
            { id: "gen-4-video", capabilities: { parameters: [], inputRoles: ["text", "image_references", "start_image"] } },
          ] },
        },
      } }));
      return;
    }
    if (req.url?.startsWith("/api/assets")) {
      res.end(JSON.stringify({ assets, nextCursor: null }));
      return;
    }
    if (req.url === "/api/mcp/generate" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        const outcome = onMcpGenerate?.(body) ?? { status: 400, code: "STOP_HERE", message: "stop" };
        res.writeHead(outcome.status).end(JSON.stringify({ error: { code: outcome.code, message: outcome.message } }));
      });
      return;
    }
    res.writeHead(404).end();
  });
}

async function withFake(fake, run) {
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${fake.address().port}`;
  try { await run(base); } finally { await new Promise((resolve) => fake.close(resolve)); }
}

describe("ima2 CLI --character contract (046)", () => {
  it("rejects --character on a core lane with CAPABILITY_MISMATCH (exit 2)", async () => {
    const fake = makeFake({ assets: [CHARACTER_RUNWAY] });
    await withFake(fake, async (base) => {
      const image = await runCLI(["gen", "hi", "--model", "oauth/gpt-5.6-luna", "--character", "a_char_runway", "--json", "--server", base]);
      assert.strictEqual(image.code, 2);
      assert.strictEqual(JSON.parse(image.stdout).code, "CAPABILITY_MISMATCH");
      const video = await runCLI(["video", "hi", "--model", "grok/grok-imagine-video", "--character", "a_char_runway", "--json", "--server", base]);
      assert.strictEqual(video.code, 2);
      assert.strictEqual(JSON.parse(video.stdout).code, "CAPABILITY_MISMATCH");
    });
  });

  it("rejects a character without a lane binding with CHARACTER_BINDING_MISSING", async () => {
    const fake = makeFake({ assets: [CHARACTER_NO_BINDING] });
    await withFake(fake, async (base) => {
      const result = await runCLI(["gen", "hi", "--model", "runway/gen-4", "--character", "a_char_nobind", "--json", "--server", base]);
      assert.strictEqual(result.code, 2);
      assert.strictEqual(JSON.parse(result.stdout).code, "CHARACTER_BINDING_MISSING");
    });
  });

  it("rejects a model without image_references with CAPABILITY_MISMATCH", async () => {
    const fake = makeFake({ assets: [CHARACTER_RUNWAY] });
    await withFake(fake, async (base) => {
      const result = await runCLI(["gen", "hi", "--model", "runway/text-only", "--character", "a_char_runway", "--json", "--server", base]);
      assert.strictEqual(result.code, 2);
      assert.strictEqual(JSON.parse(result.stdout).code, "CAPABILITY_MISMATCH");
    });
  });

  it("resolves names exactly and rejects ambiguous or missing names", async () => {
    const dupA = { ...CHARACTER_RUNWAY, id: "a_char_a" };
    const dupB = { ...CHARACTER_RUNWAY, id: "a_char_b" };
    const fake = makeFake({ assets: [dupA, dupB] });
    await withFake(fake, async (base) => {
      const ambiguous = await runCLI(["gen", "hi", "--model", "runway/gen-4", "--character", "Hero", "--json", "--server", base]);
      assert.strictEqual(ambiguous.code, 2);
      assert.strictEqual(JSON.parse(ambiguous.stdout).code, "CHARACTER_ELEMENT_AMBIGUOUS");
      const missing = await runCLI(["gen", "hi", "--model", "runway/gen-4", "--character", "Nobody", "--json", "--server", base]);
      assert.strictEqual(missing.code, 2);
      assert.strictEqual(JSON.parse(missing.stdout).code, "CHARACTER_ELEMENT_NOT_FOUND");
    });
  });

  it("forwards characterElementId in the MCP body and preserves server error codes", async () => {
    let seenBody = null;
    const fake = makeFake({
      assets: [CHARACTER_RUNWAY],
      onMcpGenerate: (body) => {
        seenBody = body;
        return { status: 400, code: "CHARACTER_REFS_EXCEED_PROVIDER_CAP", message: "cap" };
      },
    });
    await withFake(fake, async (base) => {
      const result = await runCLI(["gen", "hi", "--model", "runway/gen-4", "--character", "a_char_runway", "--json", "--server", base]);
      assert.strictEqual(result.code, 1);
      assert.strictEqual(JSON.parse(result.stdout).code, "CHARACTER_REFS_EXCEED_PROVIDER_CAP");
      assert.strictEqual(seenBody.characterElementId, "a_char_runway");
    });
  });
});

after(() => { rmSync(FAKE_HOME, { recursive: true, force: true }); });
