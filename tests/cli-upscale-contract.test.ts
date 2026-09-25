// wp5 054: ima2 upscale CLI contract — flag validation + body plumbing.
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-cli-upscale-"));

function runCLI(args, extraEnv = {}) {
  return new Promise<any>((resolve) => {
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

function makeFake({ onMediaAction }: any = {}) {
  return createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/health") { res.end('{"ok":true}'); return; }
    if (req.url?.startsWith("/api/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(": ok\n\n");
      return;
    }
    if (req.url === "/api/mcp/media-action" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        const outcome = onMediaAction?.(body) ?? { status: 400, code: "STOP_HERE", message: "stop" };
        res.writeHead(outcome.status).end(JSON.stringify({ error: { code: outcome.code, message: outcome.message } }));
      });
      return;
    }
    res.writeHead(404).end();
  });
}

async function withFake(fake, run) {
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${fake.address().port}`;
  try { await run(base); } finally { await new Promise<any>((resolve) => fake.close(resolve)); }
}

describe("ima2 upscale CLI contract (054)", () => {
  it("rejects parameters on video files with exit 2", async () => {
    const fake = makeFake();
    await withFake(fake, async (base) => {
      const result = await runCLI(["upscale", "1780000000000_abcd.mp4", "--scale-factor", "2", "--json", "--server", base]);
      assert.strictEqual(result.code, 2);
      assert.strictEqual(JSON.parse(result.stdout).code, "INVALID_MEDIA_PARAMETERS");
    });
  });

  it("rejects scale-factor above 2 with a non-sublime flavor", async () => {
    const fake = makeFake();
    await withFake(fake, async (base) => {
      const result = await runCLI(["upscale", "1780000000000_abcd.png", "--scale-factor", "4", "--flavor", "photo", "--json", "--server", base]);
      assert.strictEqual(result.code, 2);
      assert.strictEqual(JSON.parse(result.stdout).code, "INVALID_MEDIA_PARAMETERS");
    });
  });

  it("rejects a bad scale-factor value", async () => {
    const fake = makeFake();
    await withFake(fake, async (base) => {
      const result = await runCLI(["upscale", "1780000000000_abcd.png", "--scale-factor", "3", "--json", "--server", base]);
      assert.strictEqual(result.code, 2);
    });
  });

  it("forwards action+files+parameters and preserves server error codes", async () => {
    let seenBody = null;
    const fake = makeFake({
      onMediaAction: (body) => {
        seenBody = body;
        return { status: 409, code: "MCP_NOT_CONNECTED", message: "connect runway first" };
      },
    });
    await withFake(fake, async (base) => {
      const result = await runCLI(["upscale", "1780000000000_abcd.png", "--scale-factor", "2", "--sharpen", "25", "--json", "--server", base]);
      assert.strictEqual(result.code, 1);
      assert.strictEqual(JSON.parse(result.stdout).code, "MCP_NOT_CONNECTED");
      assert.strictEqual(seenBody.action, "upscale-image");
      assert.deepStrictEqual(seenBody.files, ["1780000000000_abcd.png"]);
      assert.deepStrictEqual(seenBody.parameters, { scaleFactor: 2, sharpen: 25 });
    });
  });

  it("sends no parameters key when only defaults apply", async () => {
    let seenBody = null;
    const fake = makeFake({
      onMediaAction: (body) => {
        seenBody = body;
        return { status: 409, code: "MCP_NOT_CONNECTED", message: "x" };
      },
    });
    await withFake(fake, async (base) => {
      const result = await runCLI(["upscale", "1780000000000_abcd.png", "--json", "--server", base]);
      assert.strictEqual(result.code, 1);
      assert.strictEqual("parameters" in seenBody, false);
    });
  });
});

after(() => { rmSync(FAKE_HOME, { recursive: true, force: true }); });
