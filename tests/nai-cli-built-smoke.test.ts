import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const PNG_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const MODEL = "nai-diffusion-5-full";

function runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/ima2.js", ...argv], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function catalog() {
  return {
    lanes: {
      nai: {
        status: "ready",
        defaults: { image: MODEL },
        models: { image: [{ id: MODEL, capabilities: { inputRoles: ["text"] } }], video: [] },
      },
    },
  };
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no test port");
      resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function naiFlags(): string[] {
  return [
    "--nai-negative-prompt", "lowres",
    "--nai-sampler", "k_dpmpp_2m",
    "--nai-noise-schedule", "native",
    "--nai-steps", "28",
    "--nai-scale", "5.5",
    "--nai-cfg-rescale", "0.25",
    "--nai-seed", "0",
    "--nai-uc-preset", "light",
    "--nai-quality-preset", "none",
    "--nai-auto-smea", "--no-nai-decrisper", "--nai-variety-plus", "--nai-straight-alpha",
  ];
}

const explicitTarget = ["--provider", "nai", "--model", MODEL];

function assertPayload(body: Record<string, unknown>): void {
  assert.equal(body.provider, "nai");
  assert.equal(body.model, MODEL);
  assert.equal(body.negativePrompt, "lowres");
  assert.equal(body.sampler, "k_dpmpp_2m");
  assert.equal(body.noiseSchedule, "native");
  assert.equal(body.steps, 28);
  assert.equal(body.scale, 5.5);
  assert.equal(body.cfgRescale, 0.25);
  assert.equal(body.seed, 0);
  assert.equal(body.ucPresetId, "light");
  assert.equal(body.qualityPresetId, "none");
  assert.equal(body.autoSmea, true);
  assert.equal(body.decrisper, false);
  assert.equal(body.varietyPlus, true);
  assert.equal(body.straightAlpha, true);
}

function recorderServer(bodies: Map<string, Record<string, unknown>>) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/api/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, version: "test" }));
      return;
    }
    if (req.url === "/api/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(catalog()));
      return;
    }
    const body = await readJson(req);
    bodies.set(req.url ?? "", body);
    if (req.url === "/api/generate") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ requestId: "gen-ok", images: [{ image: PNG_DATA, filename: "gen.png" }] }));
      return;
    }
    if (req.url === "/api/generate/multimode") {
      res.setHeader("content-type", "text/event-stream");
      res.end(`event: image\ndata: ${JSON.stringify({ image: PNG_DATA, filename: "multi.png" })}\n\nevent: done\ndata: ${JSON.stringify({ requestId: "multi-ok" })}\n\n`);
      return;
    }
    if (req.url === "/api/node/generate") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ node: { id: "node-ok" } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}

async function runGenerationSmoke(
  root: string,
  base: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const genOut = join(root, "gen.png");
  const gen = await runCli(["gen", "cat", ...naiFlags(), "--server", base, "--out", genOut, "--json"], env);
  assert.equal(gen.code, 0, gen.stderr);
  assert.equal((await readFile(genOut)).length > 0, true);
  const multiOut = join(root, "multi.png");
  const multi = await runCli(["multimode", "cat", ...explicitTarget, ...naiFlags(), "--server", base, "--out", multiOut, "--json"], env);
  assert.equal(multi.code, 0, multi.stderr);
  assert.equal((await readFile(multiOut)).length > 0, true);
  const node = await runCli(["node", "generate", "cat", ...explicitTarget, ...naiFlags(), "--server", base, "--no-stream", "--json"], env);
  assert.equal(node.code, 0, node.stderr);
}

test("built gen, multimode, and node CLIs send the same NovelAI payload", async (t) => {
  const bodies = new Map<string, Record<string, unknown>>();
  const server = recorderServer(bodies);
  const port = await listen(server);
  t.after(() => close(server));
  const root = await mkdtemp(join(tmpdir(), "ima2-nai-cli-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const env = { IMA2_CONFIG_DIR: join(root, "config"), IMA2_GENERATED_DIR: join(root, "generated") };
  await mkdir(env.IMA2_CONFIG_DIR, { recursive: true });
  await writeFile(join(env.IMA2_CONFIG_DIR, "config.json"), JSON.stringify({ defaults: { image: `nai/${MODEL}` } }));
  const base = `http://127.0.0.1:${port}`;
  await runGenerationSmoke(root, base, env);
  assertPayload(bodies.get("/api/generate")!);
  assertPayload(bodies.get("/api/generate/multimode")!);
  assertPayload(bodies.get("/api/node/generate")!);
});

test("built help exposes the same NovelAI vocabulary on all three commands", async () => {
  const commands = [["gen", "--help"], ["multimode", "--help"], ["node", "generate", "--help"]];
  for (const command of commands) {
    const result = await runCli(command, {});
    assert.equal(result.code, 0, result.stderr);
    for (const flag of ["--nai-negative-prompt", "--nai-auto-smea", "--nai-decrisper", "--nai-straight-alpha"]) {
      assert.match(result.stdout, new RegExp(flag));
    }
  }
});

test("built CLI preflight failures are exit 2 before an unreachable server", async () => {
  const unreachable = "http://127.0.0.1:1";
  const env = { IMA2_CONFIG_DIR: join(tmpdir(), "ima2-nai-cli-no-network") };
  const text = await runCli(["gen", "cat", "--provider", "oauth", "--nai-steps", "20", "--server", unreachable], env);
  assert.equal(text.code, 2);
  assert.match(text.stderr, /NovelAI flags require/);

  const json = await runCli(["multimode", "cat", "--nai-steps", "20", "--server", unreachable, "--json"], env);
  assert.equal(json.code, 2);
  assert.deepEqual(JSON.parse(json.stdout), {
    ok: false,
    code: "NAI_EXPLICIT_TARGET_REQUIRED",
    message: "NovelAI flags require --provider nai or --model nai-diffusion-*",
  });
});

test("built CLIs reject missing NovelAI flag values before server discovery", async () => {
  const unreachable = "http://127.0.0.1:1";
  const commands = [
    ["gen", "cat", "--provider", "nai", "--server", unreachable, "--nai-steps"],
    ["multimode", "cat", "--provider", "nai", "--server", unreachable, "--nai-steps"],
    ["node", "generate", "cat", "--provider", "nai", "--server", unreachable, "--nai-steps"],
  ];
  for (const command of commands) {
    const text = await runCli(command, {});
    assert.equal(text.code, 2, `${command[0]}: ${text.stderr}`);
    assert.match(text.stderr, /--nai-steps requires a value/);
    const json = await runCli([...command.slice(0, -1), "--json", command.at(-1)!], {});
    assert.equal(json.code, 2, `${command[0]} json: ${json.stderr}`);
    assert.equal(JSON.parse(json.stdout).code, "NAI_FLAG_INVALID");
  }
});
