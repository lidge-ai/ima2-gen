// Showcase routes (L7): GET /api/showcase lists clips from an operator folder and
// /api/showcase/media/<file> serves them. Unsafe names, missing files and broken JSON are dropped.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configDir = await mkdtemp(join(tmpdir(), "ima2-showcase-"));
process.env.IMA2_CONFIG_DIR = configDir;
const { createTestRuntimeContext } = await import("../lib/runtimeContext.ts");
const { registerShowcaseRoutes, readShowcase } = await import("../routes/showcase.ts");

test.after(async () => {
  await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function serve(dir: string) {
  const app = express();
  registerShowcaseRoutes(app, createTestRuntimeContext() as never, { dir, env: {} });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as import("node:net").AddressInfo;
  return { base: "http://127.0.0.1:" + port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("lists valid items with media URLs and drops unsafe or incomplete ones", async () => {
  const dir = await mkdtemp(join(configDir, "show-"));
  await writeFile(join(dir, "swap-result.mp4"), Buffer.alloc(64, 1));
  await writeFile(join(dir, "swap-source.mp4"), Buffer.alloc(32, 2));
  await writeFile(join(dir, "swap-poster.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(
    join(dir, "showcase.json"),
    JSON.stringify({
      items: [
        {
          id: "dance-swap",
          title: { en: "Dance swap", ko: "춤 바꾸기" },
          workflow: "remix-object-swap-open",
          values: { target: "the dancer", bad: { nested: true } },
          result: "swap-result.mp4",
          source: "swap-source.mp4",
          poster: "swap-poster.jpg",
          compare: "missing.mp4",
          models: ["bytedance/seedance-2"],
          keys: ["byteplus"],
          estimate: { usd: 0.76, basis: "5 s x $0.15/s" },
        },
        { id: "no-result", title: "No result", result: "absent.mp4" },
        { id: "../escape", title: "Escape", result: "swap-result.mp4" },
        { id: "dance-swap", title: "Duplicate", result: "swap-result.mp4" },
        { id: "traversal", title: "Traversal", result: "../showcase.json" },
      ],
    }),
  );
  const { base, close } = await serve(dir);
  try {
    const body = (await (await fetch(base + "/api/showcase")).json()) as { items: Record<string, unknown>[] };
    assert.equal(body.items.length, 1);
    const [item] = body.items;
    assert.equal(item!.id, "dance-swap");
    assert.deepEqual(item!.title, { en: "Dance swap", ko: "춤 바꾸기" });
    assert.equal(item!.result, "/api/showcase/media/swap-result.mp4");
    assert.equal(item!.poster, "/api/showcase/media/swap-poster.jpg");
    assert.equal(item!.compare, undefined);
    assert.deepEqual(item!.values, { target: "the dancer" });
    assert.deepEqual(item!.estimate, { usd: 0.76, basis: "5 s x $0.15/s" });
    const media = await fetch(base + "/api/showcase/media/swap-result.mp4", { headers: { Range: "bytes=0-9" } });
    assert.equal(media.status, 206);
    assert.equal((await media.arrayBuffer()).byteLength, 10);
    assert.equal((await fetch(base + "/api/showcase/media/showcase.json")).status, 404);
    assert.equal((await fetch(base + "/api/showcase/media/..%2Fx.mp4")).status, 404);
  } finally {
    await close();
  }
});

test("a missing folder or broken JSON is an empty list", async () => {
  assert.deepEqual(readShowcase(join(configDir, "does-not-exist")), []);
  const dir = await mkdtemp(join(configDir, "broken-"));
  await writeFile(join(dir, "showcase.json"), "{ not json");
  assert.deepEqual(readShowcase(dir), []);
  const { base, close } = await serve(dir);
  try {
    assert.deepEqual(await (await fetch(base + "/api/showcase")).json(), { items: [] });
  } finally {
    await close();
  }
});


test("items are sorted by order (unordered ones keep file order, after) and keep their type", async () => {
  const dir = await mkdtemp(join(configDir, "order-"));
  for (const name of ["a", "b", "c", "d"]) await writeFile(join(dir, name + ".mp4"), Buffer.alloc(8, 1));
  const item = (id: string, extra: Record<string, unknown>) => ({ id, title: id, result: id + ".mp4", models: [], keys: [], ...extra });
  await writeFile(
    join(dir, "showcase.json"),
    JSON.stringify({ items: [item("a", { type: "restyle" }), item("b", { order: 2, type: "motion-transfer" }), item("c", { order: 1, type: "Not Safe!" }), item("d", {})] }),
  );
  const items = readShowcase(dir);
  assert.deepEqual(items.map((i) => i.id), ["c", "b", "a", "d"]);
  assert.deepEqual(items.map((i) => i.type ?? null), [null, "motion-transfer", "restyle", null]);
});
