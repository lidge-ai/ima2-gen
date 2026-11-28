// Elements made from an uploaded image, and the checks on the files an element points at.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-element-inputs-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
const INPUTS_DIR = join(TEST_DIR, "media-inputs");
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(join(GENERATED_DIR, "a.png"), "png-a");
writeFileSync(join(GENERATED_DIR, "b.png"), "png-b");

const { registerAssetsRoutes } = await import("../routes/assets.ts");
const { storeMediaInput, resolveMediaInputRef } = await import("../lib/providers/media/inputs.ts");
const { listHistoryRows } = await import("../lib/historyList.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function withApp(fn: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  registerAssetsRoutes(app, {});
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as import("node:net").AddressInfo;
  try {
    await fn("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function request(base: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(base + path, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}
const upload = (text: string, mime = "image/png") => storeMediaInput(INPUTS_DIR, Buffer.from(text), mime);
const element = (refs: unknown, extra: Record<string, unknown> = {}) => ({ kind: "element", name: "Hero", metadata: { elementKind: "character", name: "Hero", refs, ...extra } });

describe("elements from uploads", () => {
  it("an uploaded image becomes an element whose file is kept with the generated files, out of the history", async () => withApp(async (base) => {
    const input = await upload("face-bytes");
    const made = await request(base, "/api/assets/promote-element", "POST", { inputRef: input.ref, name: "Mina", elementKind: "character" });
    assert.equal(made.status, 201);
    assert.equal(made.body.asset.kind, "element");
    assert.equal(made.body.asset.name, "Mina");
    const [ref] = made.body.asset.metadata.refs as string[];
    assert.match(ref!, /^elements\/[a-f0-9]{24}\.png$/);
    // A copy: the element does not depend on the upload folder.
    assert.equal(readFileSync(join(GENERATED_DIR, ref!), "utf8"), "face-bytes");

    // The same path works as a media input, which is how a form sends an element.
    const asInput = await resolveMediaInputRef({ role: "reference-image", filename: ref }, { generatedDir: GENERATED_DIR, inputsDir: INPUTS_DIR, maxBytes: 1024 });
    assert.equal(Buffer.from(asInput.bytes!).toString("utf8"), "face-bytes");
    assert.equal(asInput.mimeType, "image/png");

    // History lists results, not element files.
    const rows = await listHistoryRows(GENERATED_DIR);
    const names = rows.map((row: any) => String(row.filename));
    assert.ok(names.includes("a.png"), "results are still listed: " + names.join(", "));
    assert.ok(!names.some((name: string) => name.startsWith("elements/")), "an element file is listed as a result: " + names.join(", "));
  }));

  it("refuses an upload that is not an image, an unknown upload, and a request that names both an upload and a result", async () => withApp(async (base) => {
    const clip = await upload("mp4-bytes", "video/mp4");
    const video = await request(base, "/api/assets/promote-element", "POST", { inputRef: clip.ref });
    assert.deepEqual([video.status, video.body.error.code], [400, "INVALID_ELEMENT_REFS"]);
    const unknown = await request(base, "/api/assets/promote-element", "POST", { inputRef: "input:" + "0".repeat(24) + ".png" });
    assert.deepEqual([unknown.status, unknown.body.error.code], [400, "INVALID_ELEMENT_REFS"]);
    const outside = await request(base, "/api/assets/promote-element", "POST", { inputRef: "input:../../sessions.db" });
    assert.equal(outside.status, 400);
    const image = await upload("x");
    const both = await request(base, "/api/assets/promote-element", "POST", { inputRef: image.ref, path: "a.png" });
    assert.deepEqual([both.status, both.body.error.code], [400, "INVALID_ELEMENT_REFS"]);
    // Nothing was copied for the refused requests.
    const kept = existsSync(join(GENERATED_DIR, "elements")) ? readdirSync(join(GENERATED_DIR, "elements")) : [];
    assert.equal(kept.length, 1, "only the first test's element file exists: " + kept.join(", "));
  }));
});

describe("element refs point at files that exist", () => {
  it("POST /api/assets refuses an element with a missing file or a path outside the generated files", async () => withApp(async (base) => {
    const ok = await request(base, "/api/assets", "POST", element(["a.png", "b.png"]));
    assert.equal(ok.status, 201);
    const missing = await request(base, "/api/assets", "POST", element(["a.png", "nope.png"]));
    assert.deepEqual([missing.status, missing.body.error.code], [400, "INVALID_FILENAME"]);
    const outside = await request(base, "/api/assets", "POST", element(["../sessions.db"]));
    assert.equal(outside.status, 400);
  }));

  it("PATCH checks the refs it adds and leaves the ones already stored alone", async () => withApp(async (base) => {
    const made = await request(base, "/api/assets", "POST", element(["a.png"]));
    const id = made.body.asset.id as string;
    // The file behind a stored ref goes away later; the element can still be renamed and re-noted.
    rmSync(join(GENERATED_DIR, "a.png"));
    try {
      const renamed = await request(base, "/api/assets/" + id, "PATCH", { name: "Hero 2", metadata: { elementKind: "character", name: "Hero 2", refs: ["a.png"] } });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.asset.name, "Hero 2");
      const added = await request(base, "/api/assets/" + id, "PATCH", { metadata: { elementKind: "character", name: "Hero 2", refs: ["a.png", "b.png"] } });
      assert.equal(added.status, 200);
      assert.deepEqual(added.body.asset.metadata.refs, ["a.png", "b.png"]);
      const bad = await request(base, "/api/assets/" + id, "PATCH", { metadata: { elementKind: "character", name: "Hero 2", refs: ["a.png", "b.png", "ghost.png"] } });
      assert.deepEqual([bad.status, bad.body.error.code], [400, "INVALID_FILENAME"]);
      const after = await request(base, "/api/assets/" + id);
      assert.deepEqual(after.body.asset.metadata.refs, ["a.png", "b.png"]);
    } finally {
      writeFileSync(join(GENERATED_DIR, "a.png"), "png-a");
    }
  }));

  it("GET /api/assets filters elements by kind", async () => withApp(async (base) => {
    const scene = await request(base, "/api/assets", "POST", { kind: "element", name: "Harbor", metadata: { elementKind: "scene", name: "Harbor", refs: ["b.png"] } });
    assert.equal(scene.status, 201);
    const scenes = await request(base, "/api/assets?kind=element&elementKind=scene");
    assert.deepEqual(scenes.body.assets.map((asset: any) => asset.name), ["Harbor"]);
    const characters = await request(base, "/api/assets?kind=element&elementKind=character");
    assert.ok(characters.body.assets.length > 0 && characters.body.assets.every((asset: any) => asset.metadata.elementKind === "character"));
    const bad = await request(base, "/api/assets?kind=element&elementKind=vehicle");
    assert.equal(bad.status, 400);
  }));
});
describe("deleting an element removes the upload copy only it used", () => {
  const fromUpload = async (base: string, text: string) => {
    const made = await request(base, "/api/assets/promote-element", "POST", { inputRef: (await upload(text)).ref, name: "Copy" });
    assert.equal(made.status, 201);
    return { id: made.body.asset.id as string, ref: (made.body.asset.metadata.refs as string[])[0]! };
  };

  it("the copy made for an element is removed with it", async () => withApp(async (base) => {
    const one = await fromUpload(base, "only-mine");
    assert.ok(existsSync(join(GENERATED_DIR, one.ref)));
    const removed = await request(base, "/api/assets/" + one.id, "DELETE");
    assert.deepEqual([removed.status, removed.body.ok], [200, true]);
    assert.ok(!existsSync(join(GENERATED_DIR, one.ref)), "the element's copy is still on disk");
  }));

  it("a copy another element still points at stays until the last of them is deleted", async () => withApp(async (base) => {
    const first = await fromUpload(base, "shared");
    const second = await request(base, "/api/assets", "POST", element([first.ref, "a.png"]));
    assert.equal(second.status, 201);
    assert.equal((await request(base, "/api/assets/" + first.id, "DELETE")).status, 200);
    assert.ok(existsSync(join(GENERATED_DIR, first.ref)), "a file another element uses was removed");
    assert.equal((await request(base, "/api/assets/" + second.body.asset.id, "DELETE")).status, 200);
    assert.ok(!existsSync(join(GENERATED_DIR, first.ref)), "the copy outlived every element that used it");
    assert.ok(existsSync(join(GENERATED_DIR, "a.png")), "a result was removed with an element");
  }));

  it("results, files in subfolders of elements/ and other asset kinds are never removed", async () => withApp(async (base) => {
    mkdirSync(join(GENERATED_DIR, "elements", "nested"), { recursive: true });
    writeFileSync(join(GENERATED_DIR, "elements", "nested", "deep.png"), "deep");
    writeFileSync(join(GENERATED_DIR, "elements", "kept.png"), "kept");
    const made = await request(base, "/api/assets", "POST", element(["b.png", "elements/nested/deep.png", "./elements/../b.png"]));
    assert.equal(made.status, 201);
    assert.equal((await request(base, "/api/assets/" + made.body.asset.id, "DELETE")).status, 200);
    assert.ok(existsSync(join(GENERATED_DIR, "b.png")), "a result was removed with an element");
    assert.ok(existsSync(join(GENERATED_DIR, "elements", "nested", "deep.png")), "a file below a subfolder was removed");
    // An image asset whose file happens to sit in elements/ is a catalog row, not an element.
    const image = await request(base, "/api/assets", "POST", { kind: "image", name: "Kept", filePath: "elements/kept.png" });
    assert.equal(image.status, 201);
    assert.equal((await request(base, "/api/assets/" + image.body.asset.id, "DELETE")).status, 200);
    assert.ok(existsSync(join(GENERATED_DIR, "elements", "kept.png")), "an image asset's file was removed");
    // An unknown id is still a 404.
    assert.equal((await request(base, "/api/assets/nope", "DELETE")).status, 404);
  }));
});
