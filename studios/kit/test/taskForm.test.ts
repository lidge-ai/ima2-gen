import test from "node:test";
import assert from "node:assert/strict";
import { billedSeconds, chooseFormRoute, formRoutes, taskForm, toCatalog } from "../src/index.ts";
import { wireCatalog } from "../src/fake/catalog.ts";
import { Keys } from "../src/fake/keys.ts";

const keys = (...ids: string[]) => new Keys(ids);
const catalog = (...ids: string[]) => toCatalog(wireCatalog(keys(...ids)) as never);
const model = (id: string, ...keyed: string[]) => catalog(...keyed).models.find((m) => m.id === id)!;

test("a route's form comes from that route alone, and the model-level params do not mix forms", () => {
  const lips = model("sync/sync-lipsync-3", "sync", "fal");
  assert.equal(lips.params.inputs, undefined);
  assert.deepEqual(taskForm(lips, "sync", "lipsync")!.inputs.map((n) => n.role), ["source-video", "source-audio"]);
  assert.deepEqual(taskForm(lips, "sync", "lipsync")!.options.map((o) => o.name), ["sync_mode"]);
  assert.deepEqual(taskForm(lips, "fal", "lipsync")!.options, []);
  assert.equal(taskForm(lips, "fal", "avatar"), null);
});

test("only routes that declare a form are offered, even when another route has the key", () => {
  const kling = model("kling/kling-lipsync", "kling");
  assert.deepEqual(formRoutes(kling, "lipsync").map((r) => r.providerId), ["fal"]);
  const choice = chooseFormRoute(kling, "lipsync");
  assert.equal(choice.kind, "needs-key");
  assert.equal(choice.kind === "needs-key" && choice.route.providerId, "fal");
  const keyed = chooseFormRoute(model("kling/kling-lipsync", "kling", "fal"), "lipsync");
  assert.equal(keyed.kind === "default" && keyed.route.providerId, "fal");
  assert.equal(chooseFormRoute(model("bytedance/seedance-2.5", "fal"), "lipsync").kind, "unavailable");
});

test("the billed length is the longest billed input, and unknown until every one is measured", () => {
  const form = taskForm(model("sync/sync-lipsync-3", "fal"), "fal", "lipsync")!;
  assert.equal(billedSeconds(form, {}), null);
  assert.equal(billedSeconds(form, { "source-video": 4.2 }), null);
  assert.equal(billedSeconds(form, { "source-video": 4.2, "source-audio": null }), null);
  assert.equal(billedSeconds(form, { "source-video": 4.2, "source-audio": 7.5 }), 7.5);
  const avatar = taskForm(model("veed/veed-fabric-1.0", "fal"), "fal", "avatar")!;
  assert.equal(billedSeconds(avatar, { "source-audio": 3 }), 3);
});
