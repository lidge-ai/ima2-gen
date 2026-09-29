import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findAvailablePort } from "../lib/runtimePorts.ts";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-b9-home-"));
const GEN_DIR = mkdtempSync(join(tmpdir(), "ima2-b9-generated-"));
const SYSTEM_TRASH_DIR = join(GEN_DIR, ".system-trash");
const TEST_PREFIX = `b9test_${Date.now()}_`;

async function waitForHealth(base, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

describe("History: delete tombstone + pagination", () => {
  let child;
  let base;
  const createdFiles = [];
  let titledSessionId = null;

  before(async () => {
    const port = String(await findAvailablePort(4300 + Math.floor(Math.random() * 500), {
      maxAttempts: 200,
      host: "127.0.0.1",
    }));
    base = `http://localhost:${port}`;
    mkdirSync(GEN_DIR, { recursive: true });
    // Seed 3 tiny fake png files (valid PNG signature enough for listImages)
    const pngStub = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    for (let i = 0; i < 3; i++) {
      const ts = Date.now() + i;
      const fn = `${TEST_PREFIX}${ts}_${i}.png`;
      writeFileSync(join(GEN_DIR, fn), pngStub);
      createdFiles.push(fn);
    }

    child = spawn("node", ["--import", "tsx", "server.ts"], {
      env: {
        ...process.env,
        PORT: port,
        IMA2_CONFIG_DIR: join(FAKE_HOME, ".ima2"),
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
        IMA2_GENERATED_DIR: GEN_DIR,
        IMA2_TRASH_DIR: join(GEN_DIR, ".trash"),
        IMA2_TEST_SYSTEM_TRASH_DIR: SYSTEM_TRASH_DIR,
        NODE_ENV: "test",
        IMA2_NO_OAUTH_PROXY: "1",
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealth(base);

    const sessionRes = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Exam Graph" }),
    });
    assert.strictEqual(sessionRes.status, 201);
    titledSessionId = (await sessionRes.json()).session.id;
    writeFileSync(join(GEN_DIR, createdFiles[1] + ".json"), JSON.stringify({
      createdAt: Date.now() + 100,
      prompt: "session titled image",
      provider: "oauth",
      format: "png",
      sessionId: titledSessionId,
      refsCount: 2,
    }));
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
      await new Promise((r) => child.on("exit", r));
    }
    rmSync(FAKE_HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(GEN_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("delete moves file and sidecar to the configured OS-trash test seam", async () => {
    const target = createdFiles[0];
    const srcPath = join(GEN_DIR, target);
    const sidecarPath = join(GEN_DIR, `${target}.json`);
    assert.ok(existsSync(srcPath), "seed file exists");
    writeFileSync(sidecarPath, JSON.stringify({ prompt: "trash sidecar" }));

    const delRes = await fetch(`${base}/api/history/${encodeURIComponent(target)}`, {
      method: "DELETE",
    });
    assert.strictEqual(delRes.status, 200, "delete returns 200");
    const delBody = await delRes.json();
    assert.ok(delBody.ok);
    assert.strictEqual(delBody.trash, "system");
    assert.strictEqual(delBody.undoableInApp, false);
    assert.ok(!("trashId" in delBody), "OS-trash delete does not expose an in-app trashId");
    assert.ok(!("unlinkAt" in delBody), "OS-trash delete does not expose a TTL unlink time");
    assert.ok(!existsSync(srcPath), "source file removed from generated/");
    assert.ok(!existsSync(sidecarPath), "sidecar removed from generated/");

    assert.ok(existsSync(SYSTEM_TRASH_DIR), "system trash test seam created");
    const trashed = readdirSync(SYSTEM_TRASH_DIR);
    assert.ok(trashed.some((name) => name.endsWith(target)), "image moved through system trash seam");
    assert.ok(trashed.some((name) => name.endsWith(`${target}.json`)), "sidecar moved through system trash seam");
  });

  it("history pagination is deduped by composite cursor", async () => {
    const res1 = await fetch(`${base}/api/history?limit=2`);
    assert.strictEqual(res1.status, 200);
    const page1 = await res1.json();
    assert.ok(Array.isArray(page1.items), "items array present");
    if (!page1.nextCursor) return; // not enough history for pagination

    const { before, beforeFilename } = page1.nextCursor;
    const res2 = await fetch(
      `${base}/api/history?limit=2&before=${before}&beforeFilename=${encodeURIComponent(
        beforeFilename,
      )}`,
    );
    assert.strictEqual(res2.status, 200);
    const page2 = await res2.json();
    const overlap = page2.items.filter((b) =>
      page1.items.some((a) => a.filename === b.filename),
    );
    assert.strictEqual(overlap.length, 0, "no duplicates across pages");
  });

  it("favoritesOnly filters favorites before pagination", async () => {
    const favoriteTarget = createdFiles[2];
    const secondFavoriteTarget = createdFiles[1];
    const browserId = "history_favorites_before_page";
    for (const filename of [favoriteTarget, secondFavoriteTarget]) {
      const favRes = await fetch(`${base}/api/history/favorite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ima2-Browser-Id": browserId,
        },
        body: JSON.stringify({ filename }),
      });
      assert.strictEqual(favRes.status, 200);
    }

    const normalRes = await fetch(`${base}/api/history?limit=1`, {
      headers: { "X-Ima2-Browser-Id": browserId },
    });
    assert.strictEqual(normalRes.status, 200);
    const normalPage = await normalRes.json();
    assert.notStrictEqual(
      normalPage.items[0]?.filename,
      favoriteTarget,
      "seeded favorite must be outside the first normal page",
    );

    const favoriteRes = await fetch(`${base}/api/history?limit=1&favoritesOnly=1`, {
      headers: { "X-Ima2-Browser-Id": browserId },
    });
    assert.strictEqual(favoriteRes.status, 200);
    const favoritePage = await favoriteRes.json();
    assert.strictEqual(favoritePage.items.length, 1);
    assert.strictEqual(favoritePage.items[0].isFavorite, true);
    assert.ok(favoritePage.nextCursor, "favorite cursor exposes older favorites");

    const cursor = favoritePage.nextCursor;
    const olderFavoriteRes = await fetch(
      `${base}/api/history?limit=1&favoritesOnly=1&before=${cursor.before}&beforeFilename=${encodeURIComponent(cursor.beforeFilename)}`,
      { headers: { "X-Ima2-Browser-Id": browserId } },
    );
    assert.strictEqual(olderFavoriteRes.status, 200);
    const olderFavoritePage = await olderFavoriteRes.json();
    assert.strictEqual(olderFavoritePage.items.length, 1);
    assert.notStrictEqual(
      olderFavoritePage.items[0].filename,
      favoritePage.items[0].filename,
      "favorite pages do not duplicate the first favorite",
    );
    assert.strictEqual(olderFavoritePage.items[0].isFavorite, true);
  });

  it("groupBy=session returns sessions + loose arrays", async () => {
    const res = await fetch(`${base}/api/history?groupBy=session&limit=100`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions), "sessions array");
    assert.ok(Array.isArray(body.loose), "loose array");
    const titled = body.sessions.find((s) => s.sessionId === titledSessionId);
    assert.ok(titled, "seeded session group present");
    assert.strictEqual(titled.title, "Exam Graph");
    assert.strictEqual(titled.label, "Exam Graph");
    assert.strictEqual(titled.items[0].refsCount, 2);
  });
});
