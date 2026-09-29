// wp4 043/044: /api/mcp/generate characterElementId contract — conflict guard,
// binding resolution, refs injection with shared cap, gate order, lineage.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ima2-mcp-character-"));
process.env.IMA2_CONFIG_DIR = dir;
process.env.IMA2_DB_PATH = join(dir, "db.sqlite");
process.env.IMA2_GENERATED_DIR = join(dir, "generated");
const GENERATED_DIR = join(dir, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });

const db = await import("../lib/db.ts");
const store = await import("../lib/assetsStore.ts");
const { registerMcpMediaRoutes } = await import("../routes/mcpMedia.ts");
after(() => { db.closeDb(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const fakeManager = {
  status: () => ({ provider: "runway", state: "connected" }),
  callTool: async () => ({}),
};

type UploadCall = { path: string };

function makeApp(opts: { adapters?: Record<string, unknown>; execute?: () => Promise<unknown>; uploads?: UploadCall[] }) {
  const app = express();
  app.use(express.json());
  const deps = {
    execute: opts.execute ?? (async () => ({ taskId: "task_char_1", outputUrls: ["https://cdn.example.com/out.png?sig=1"] })),
    upload: async (_manager: unknown, filePath: string) => {
      opts.uploads?.push({ path: filePath });
      return `https://uploads.example.com/${encodeURIComponent(filePath.split("/").pop() ?? "ref")}`;
    },
    download: async () => {
      const tempOut = join(GENERATED_DIR, `temp-${Date.now()}.png`);
      writeFileSync(tempOut, Buffer.from("png"));
      return { tempPath: tempOut, contentType: "image/png", bytes: 3, sanitizedUrl: "https://cdn.example.com/out.png", cleanup: async () => {} };
    },
    ...(opts.adapters ? { adapters: opts.adapters } : {}),
  };
  registerMcpMediaRoutes(app as never, {
    config: { storage: { generatedDir: GENERATED_DIR }, ids: { generatedHexBytes: 4 } },
    mcpConnectionManager: fakeManager,
  } as never, deps as never);
  return app;
}

async function withServer(app: express.Express, run: (base: string) => Promise<void>) {
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  try { await run(`http://127.0.0.1:${port}`); } finally { server.close(); }
}

function post(base: string, body: Record<string, unknown>) {
  return fetch(`${base}/api/mcp/generate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function makeRefs(names: string[]) {
  for (const name of names) writeFileSync(join(GENERATED_DIR, name), `png:${name}`);
  return names;
}

function createCharacter(refs: string[], bindings?: unknown[], elementKind = "character") {
  return store.createAsset({
    kind: "element", name: `hero-${Date.now()}-${Math.random()}`,
    metadata: { elementKind, name: "Hero", refs, ...(bindings ? { characterBindings: bindings } : {}) },
  });
}

test("409 CHARACTER_ELEMENT_CONFLICT when elementIds and characterElementId arrive together", async () => {
  const element = createCharacter(makeRefs(["c1a.png"]), [{ provider: "runway", mode: "stateless-refs" }]);
  await withServer(makeApp({}), async (base) => {
    const res = await post(base, { provider: "runway", kind: "image", prompt: "hero", characterElementId: element.id, elementIds: ["x"] });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.code, "CHARACTER_ELEMENT_CONFLICT");
  });
});

test("400 CHARACTER_ELEMENT_NOT_FOUND for missing or non-character elements", async () => {
  const product = createCharacter(makeRefs(["c2a.png"]), undefined, "product");
  await withServer(makeApp({}), async (base) => {
    const missing = await post(base, { provider: "runway", kind: "image", prompt: "hero", characterElementId: "a_nope" });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.code, "CHARACTER_ELEMENT_NOT_FOUND");
    const wrong = await post(base, { provider: "runway", kind: "image", prompt: "hero", characterElementId: product.id });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error.code, "CHARACTER_ELEMENT_NOT_FOUND");
  });
});

test("400 CHARACTER_BINDING_MISSING when the character has no binding for the provider", async () => {
  const element = createCharacter(makeRefs(["c3a.png"]));
  await withServer(makeApp({}), async (base) => {
    const res = await post(base, { provider: "runway", kind: "image", prompt: "hero", characterElementId: element.id });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "CHARACTER_BINDING_MISSING");
  });
});

test("400 CHARACTER_REFS_EXCEED_PROVIDER_CAP without trimming — upload never runs", async () => {
  const uploads: UploadCall[] = [];
  const element = createCharacter(makeRefs(["c4a.png", "c4b.png", "c4c.png", "c4d.png"]),
    [{ provider: "runway", mode: "stateless-refs" }]);
  await withServer(makeApp({ uploads }), async (base) => {
    const res = await post(base, { provider: "runway", kind: "image", prompt: "hero", characterElementId: element.id });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "CHARACTER_REFS_EXCEED_PROVIDER_CAP");
    assert.equal(uploads.length, 0);
  });
});

test("success: binding refs upload with tag, execute reached, lineage records characterElementId + recover triple", async () => {
  const uploads: UploadCall[] = [];
  let executed = false;
  const element = createCharacter(makeRefs(["c5a.png", "c5b.png"]),
    [{ provider: "runway", mode: "stateless-refs", tag: "hero_01" }]);
  const app = makeApp({ uploads, execute: async () => { executed = true; return { taskId: "task_char_5", outputUrls: ["https://cdn.example.com/out5.png?sig=1"] }; } });
  await withServer(app, async (base) => {
    const res = await post(base, { provider: "runway", kind: "image", prompt: "hero walks", characterElementId: element.id });
    assert.equal(res.status, 202);
    const deadline = Date.now() + 5_000;
    while (!executed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.equal(executed, true);
    assert.equal(uploads.length, 2);
    // lineage: sidecar records characterElementId and the recover triple (taskId+provider+kind)
    const sidecarDeadline = Date.now() + 5_000;
    let sidecar: Record<string, unknown> | null = null;
    while (Date.now() < sidecarDeadline) {
      const found = readdirSync(GENERATED_DIR).filter((name) => name.endsWith("_mcp.png.json"));
      if (found.length > 0) { sidecar = JSON.parse(readFileSync(join(GENERATED_DIR, found[0]), "utf8")); break; }
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(sidecar, "sidecar written");
    assert.equal(sidecar?.characterElementId, element.id);
    assert.equal(sidecar?.providerTaskId, "task_char_5");
    assert.equal(sidecar?.provider, "runway");
    assert.equal(sidecar?.mediaType, "image");
  });
});

test("400 INVALID_MCP_REFERENCES when request refs + binding refs exceed the shared cap", async () => {
  const uploads: UploadCall[] = [];
  const element = createCharacter(makeRefs(["c6a.png", "c6b.png"]), [{ provider: "runway", mode: "stateless-refs" }]);
  await withServer(makeApp({ uploads }), async (base) => {
    const res = await post(base, {
      provider: "runway", kind: "image", prompt: "hero", characterElementId: element.id,
      references: [{ filename: "c6a.png" }, { filename: "c6b.png" }],
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "INVALID_MCP_REFERENCES");
    assert.equal(uploads.length, 0);
  });
});

test("higgsfield is now executable: missing binding returns 400 instead of 409 lock", async () => {
  const element = createCharacter(makeRefs(["c8a.png"])); // no binding at all
  await withServer(makeApp({}), async (base) => {
    const res = await post(base, { provider: "higgsfield", kind: "image", prompt: "hero", characterElementId: element.id });
    assert.equal(res.status, 400);
  });
});

test("409 BINDING_NOT_READY for trained-id binding in training state (executable stub)", async () => {
  const element = createCharacter(makeRefs(["c9a.png"]),
    [{ provider: "higgsfield", mode: "trained-id", externalId: "soul_x", status: "training" }]);
  const adapters = {
    higgsfield: {
      provider: "higgsfield", executable: true,
      buildGenerateCall: () => ({ toolName: "generate_image", args: {} }),
    },
  };
  await withServer(makeApp({ adapters: adapters as never }), async (base) => {
    const res = await post(base, { provider: "higgsfield", kind: "image", prompt: "hero", characterElementId: element.id });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, "BINDING_NOT_READY");
  });
});
