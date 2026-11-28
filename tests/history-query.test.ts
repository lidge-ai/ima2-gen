// GET /api/history: search, kind/model/workflow filters, period, order, matched count, model facets, folders.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-history-query-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });

function seed(name: string, meta: Record<string, unknown>) {
  writeFileSync(join(GENERATED_DIR, name), "bytes-" + name);
  writeFileSync(join(GENERATED_DIR, name + ".json"), JSON.stringify(meta));
}
seed("a.png", { createdAt: 1000, prompt: "Red fox in snow", model: "m1", requestId: "req-a" });
seed("b.png", { createdAt: 2000, prompt: "blue whale", model: "m2" });
seed("e.png", { createdAt: 2000, prompt: "same moment as the whale", model: "m2" });
seed("c.mp4", { createdAt: 3000, prompt: "A FOX running", model: "m1", mediaType: "video", workflow: "wf-x" });
seed("d.mp3", { createdAt: 4000, prompt: "narration", model: "m3", mediaType: "audio" });

const { config } = await import("../config.ts");
const { registerHistoryRoutes } = await import("../routes/history.ts");
const { createAsset, createFolder } = await import("../lib/assetsStore.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function get(query: string, favorite?: { browserId: string; filename?: string }) {
  const app = express();
  app.use(express.json());
  registerHistoryRoutes(app, { config } as never);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as import("node:net").AddressInfo;
  try {
    const base = "http://127.0.0.1:" + address.port + "/api/history";
    const headers = favorite ? { "X-Ima2-Browser-Id": favorite.browserId, "Content-Type": "application/json" } : undefined;
    if (favorite?.filename) await fetch(base + "/favorite", { method: "POST", headers, body: JSON.stringify({ filename: favorite.filename }) });
    const response = await fetch(base + query, { headers });
    return { status: response.status, body: await response.json() as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const names = (body: any) => (body.items as { filename: string }[]).map((row) => row.filename);

describe("GET /api/history without the new parameters", () => {
  it("answers as before: newest first, no audio, total of every row, a before-cursor", async () => {
    const all = await get("");
    assert.equal(all.status, 200);
    assert.deepEqual(names(all.body), ["c.mp4", "e.png", "b.png", "a.png"]);
    assert.equal(all.body.total, 5);
    assert.equal(all.body.nextCursor, null);
    assert.ok(!("facets" in all.body), "facets are sent only when asked for");
    const first = await get("?limit=2");
    assert.deepEqual(names(first.body), ["c.mp4", "e.png"]);
    assert.deepEqual(first.body.nextCursor, { before: 2000, beforeFilename: "e.png" });
    const second = await get("?limit=2&before=2000&beforeFilename=e.png");
    assert.deepEqual(names(second.body), ["b.png", "a.png"]);
    const audio = await get("?includeAudio=1");
    assert.deepEqual(names(audio.body), ["d.mp3", "c.mp4", "e.png", "b.png", "a.png"]);
  });

  it("requestId and favoritesOnly still filter, and a favorite belongs to its browser", async () => {
    assert.deepEqual(names((await get("?requestId=req-a")).body), ["a.png"]);
    const mine = await get("?favoritesOnly=1", { browserId: "browser-1", filename: "b.png" });
    assert.deepEqual(names(mine.body), ["b.png"]);
    assert.equal(mine.body.items[0].isFavorite, true);
    assert.equal(mine.body.matched, 1);
    assert.deepEqual(names((await get("?favoritesOnly=1", { browserId: "browser-2" })).body), []);
    assert.deepEqual(names((await get("?favoritesOnly=1")).body), []);
  });
});

describe("GET /api/history filters", () => {
  it("q matches the prompt, model or filename without regard to case", async () => {
    assert.deepEqual(names((await get("?q=fox")).body), ["c.mp4", "a.png"]);
    assert.deepEqual(names((await get("?q=M2")).body), ["e.png", "b.png"]);
    assert.deepEqual(names((await get("?q=.mp4")).body), ["c.mp4"]);
    assert.deepEqual(names((await get("?q=nothing-like-this")).body), []);
  });

  it("mediaType keeps the listed kinds, audio included when it is listed", async () => {
    assert.deepEqual(names((await get("?mediaType=audio")).body), ["d.mp3"]);
    assert.deepEqual(names((await get("?mediaType=video,audio")).body), ["d.mp3", "c.mp4"]);
    assert.deepEqual(names((await get("?mediaType=image")).body), ["e.png", "b.png", "a.png"]);
    const bad = await get("?mediaType=hologram");
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /mediaType/);
  });

  it("model and workflow are exact matches", async () => {
    assert.deepEqual(names((await get("?model=m1")).body), ["c.mp4", "a.png"]);
    assert.deepEqual(names((await get("?model=m")).body), []);
    assert.deepEqual(names((await get("?workflow=wf-x")).body), ["c.mp4"]);
  });

  it("since and until bound the period; until includes its own moment", async () => {
    assert.deepEqual(names((await get("?since=1000&until=2000")).body), ["e.png", "b.png"]);
    assert.deepEqual(names((await get("?until=1000")).body), ["a.png"]);
  });

  it("matched counts the rows after filters and before the page is cut; total stays the whole history", async () => {
    const page = await get("?mediaType=image&limit=1");
    assert.deepEqual(names(page.body), ["e.png"]);
    assert.equal(page.body.matched, 3);
    assert.equal(page.body.total, 5);
    // The cursor does not change the count.
    const next = await get("?mediaType=image&limit=1&before=2000&beforeFilename=e.png");
    assert.deepEqual(names(next.body), ["b.png"]);
    assert.equal(next.body.matched, 3);
  });
});

describe("GET /api/history order=asc", () => {
  it("lists oldest first and pages with after + afterFilename, inside a period", async () => {
    const first = await get("?order=asc&limit=2");
    assert.deepEqual(names(first.body), ["a.png", "b.png"]);
    assert.deepEqual(first.body.nextCursor, { after: 2000, afterFilename: "b.png" });
    const second = await get("?order=asc&limit=2&after=2000&afterFilename=b.png");
    assert.deepEqual(names(second.body), ["e.png", "c.mp4"]);
    assert.equal(second.body.nextCursor, null);
    const bounded = await get("?order=asc&since=1000&until=3000&limit=1&after=2000&afterFilename=b.png");
    assert.deepEqual(names(bounded.body), ["e.png"]);
    assert.deepEqual(bounded.body.nextCursor, { after: 2000, afterFilename: "e.png" });
    assert.equal(bounded.body.matched, 3);
    const bad = await get("?order=sideways");
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /order/);
  });
});

describe("GET /api/history facets=model", () => {
  it("counts each model under every filter except the model filter", async () => {
    const page = await get("?facets=model&model=m1&mediaType=image,video,audio");
    assert.deepEqual(names(page.body), ["c.mp4", "a.png"]);
    assert.deepEqual(page.body.facets, { model: [{ value: "m1", count: 2 }, { value: "m2", count: 2 }, { value: "m3", count: 1 }] });
    const images = await get("?facets=model&mediaType=image&limit=1");
    assert.deepEqual(images.body.facets, { model: [{ value: "m2", count: 2 }, { value: "m1", count: 1 }] });
  });
});

describe("GET /api/history folders", () => {
  it("each row says which folder its file is filed in, and folderId keeps that folder's rows", async () => {
    const folder = createFolder({ name: "Foxes" });
    createAsset({ kind: "image", name: "fox", filePath: "a.png", folderId: folder.id });
    createAsset({ kind: "video", name: "unfiled clip", filePath: "c.mp4" });
    const all = await get("");
    const byName = new Map((all.body.items as { filename: string; folderId: string | null }[]).map((row) => [row.filename, row.folderId]));
    assert.equal(byName.get("a.png"), folder.id);
    assert.equal(byName.get("c.mp4"), null);
    assert.equal(byName.get("b.png"), null);
    const filed = await get("?folderId=" + folder.id);
    assert.deepEqual(names(filed.body), ["a.png"]);
    assert.equal(filed.body.matched, 1);
    assert.deepEqual(names((await get("?folderId=f_missing")).body), []);
  });
});
