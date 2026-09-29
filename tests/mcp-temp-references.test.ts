import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// realpathSync: Windows tmpdir() can return 8.3 short names (RUNNER~1) while
// the route resolves long ones — normalize the base before comparing (260719).
const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "ima2-mcp-temp-references-")));
const generatedDir = join(rootDir, "generated");
process.env.IMA2_CONFIG_DIR = rootDir;
process.env.IMA2_GENERATED_DIR = generatedDir;
mkdirSync(generatedDir, { recursive: true });

const {
  MCP_TEMP_REFERENCE_JSON_BODY_LIMIT_BYTES,
  MCP_TEMP_REFERENCE_MAX_BYTES,
  cleanupExpiredMcpTempReferences,
} = await import("../lib/mcpTempReferenceStore.ts");
const { registerMcpTempReferenceRoutes } = await import("../routes/mcpTempReferences.ts");
const { safeGeneratedFilePath } = await import("../lib/videoFrameExtract.ts");

after(() => rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const PNG_FIXTURE = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63600000000200015c2d05cf0000000049454e44ae426082",
  "hex",
);
const JPEG_FIXTURE = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

function dataUrl(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function tempFiles(): string[] {
  return readdirSync(generatedDir).filter((name) => name.startsWith("tmpref_"));
}

async function withApp(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json({ limit: MCP_TEMP_REFERENCE_JSON_BODY_LIMIT_BYTES }));
  registerMcpTempReferenceRoutes(app, { config: { storage: { generatedDir } } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as import("node:net").AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function requestJson(baseUrl: string, path: string, init: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

test("POST /api/mcp/temp-references writes two contained generated files", async () => {
  await withApp(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/mcp/temp-references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        images: [
          { dataUrl: dataUrl("image/png", PNG_FIXTURE), tag: "Image_1" },
          { dataUrl: dataUrl("image/jpeg", JPEG_FIXTURE) },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.match(response.body.batchId, /^[0-9a-f]{16}$/);
    assert.deepEqual(response.body.files.map((file: { tag?: string }) => file.tag), ["Image_1", undefined]);
    assert.equal(response.body.files.length, 2);
    for (const file of response.body.files as Array<{ filename: string }>) {
      assert.match(file.filename, new RegExp(`^tmpref_${response.body.batchId}_[12]\\.(png|jpeg)$`));
      assert.ok(existsSync(join(generatedDir, file.filename)));
      // Same async realpath on both sides — Windows realpathSync preserves
      // 8.3 short-name input while fs.promises.realpath normalizes (260719).
      const { realpath } = await import("node:fs/promises");
      assert.equal(
        await safeGeneratedFilePath(generatedDir, file.filename),
        await realpath(join(generatedDir, file.filename)),
      );
    }
  });
});

test("oversize and invalid MIME uploads return 400 without temp files", async () => {
  for (const filename of tempFiles()) rmSync(join(generatedDir, filename), { force: true });
  await withApp(async (baseUrl) => {
    const oversize = Buffer.alloc(MCP_TEMP_REFERENCE_MAX_BYTES + 1);
    PNG_FIXTURE.subarray(0, 12).copy(oversize);
    const tooLarge = await requestJson(baseUrl, "/api/mcp/temp-references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [{ dataUrl: dataUrl("image/png", oversize) }] }),
    });
    assert.equal(tooLarge.status, 400);
    assert.deepEqual(tempFiles(), []);

    const invalidMime = await requestJson(baseUrl, "/api/mcp/temp-references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [{ dataUrl: dataUrl("image/gif", PNG_FIXTURE) }] }),
    });
    assert.equal(invalidMime.status, 400);
    assert.deepEqual(tempFiles(), []);

    const tooMany = await requestJson(baseUrl, "/api/mcp/temp-references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: Array.from({ length: 4 }, () => ({ dataUrl: dataUrl("image/png", PNG_FIXTURE) })) }),
    });
    assert.equal(tooMany.status, 400);
    assert.deepEqual(tempFiles(), []);
  });
});

test("partial batch failure rolls back files written earlier in the batch", async () => {
  await withApp(async (baseUrl) => {
    const response = await requestJson(baseUrl, "/api/mcp/temp-references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        images: [
          { dataUrl: dataUrl("image/png", PNG_FIXTURE), tag: "first" },
          { dataUrl: dataUrl("image/jpeg", PNG_FIXTURE), tag: "mismatch" },
        ],
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(tempFiles(), []);
  });
});

test("DELETE removes a temp-reference batch and remains idempotent", async () => {
  await withApp(async (baseUrl) => {
    const uploaded = await requestJson(baseUrl, "/api/mcp/temp-references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [{ dataUrl: dataUrl("image/png", PNG_FIXTURE) }] }),
    });
    const batchId = uploaded.body.batchId as string;
    assert.equal(tempFiles().length, 1);

    const removed = await requestJson(baseUrl, `/api/mcp/temp-references/${batchId}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.ok, true);
    assert.equal(removed.body.deleted, 1);
    assert.deepEqual(tempFiles(), []);

    const repeated = await requestJson(baseUrl, `/api/mcp/temp-references/${batchId}`, { method: "DELETE" });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.deleted, 0);
  });
});

test("TTL cleanup deletes only expired tmpref files", async () => {
  const oldTemp = "tmpref_expired-orphan.png";
  const freshTemp = "tmpref_bbbbbbbbbbbbbbbb_1.webp";
  const normalGenerated = "normal-generated.png";
  for (const name of [oldTemp, freshTemp, normalGenerated]) {
    writeFileSync(join(generatedDir, name), PNG_FIXTURE);
  }
  const now = Date.now();
  const old = new Date(now - 61 * 60 * 1000);
  utimesSync(join(generatedDir, oldTemp), old, old);

  const deleted = await cleanupExpiredMcpTempReferences(generatedDir, now);

  assert.equal(deleted, 1);
  assert.equal(existsSync(join(generatedDir, oldTemp)), false);
  assert.equal(existsSync(join(generatedDir, freshTemp)), true);
  assert.equal(existsSync(join(generatedDir, normalGenerated)), true);
});
