// What a result remembers about the options it was made with (the sidecar's media.options): only
// options the route declares, in the shape it declares them, and never anything that looks like a secret.
import test from "node:test";
import assert from "node:assert/strict";
import { declaredResultOptions } from "../lib/providers/media/resultOptions.ts";
import type { MediaModelSpec } from "../lib/providers/media/contract.ts";

const spec = (options: NonNullable<MediaModelSpec["params"]["options"]>, tasks: MediaModelSpec["tasks"] = ["text-to-audio"]): Pick<MediaModelSpec, "params" | "tasks"> => ({ tasks, params: { options } });
const keep = (options: NonNullable<MediaModelSpec["params"]["options"]>, vendorOptions: Record<string, unknown> | undefined, task = "text-to-audio") =>
  declaredResultOptions(spec(options), { task: task as never, ...(vendorOptions ? { vendorOptions } : {}) });

test("declared options are kept in the shape the route declares", () => {
  const options = [
    { name: "voice_id", type: "voice" as const, required: true },
    { name: "force_instrumental", type: "boolean" as const },
    { name: "format", type: "enum" as const, values: ["mp3", "wav"] },
  ];
  assert.deepEqual(keep(options, { voice_id: "21m00Tcm4TlvDq8ikWAM", force_instrumental: true, format: "wav" }), { voice_id: "21m00Tcm4TlvDq8ikWAM", force_instrumental: true, format: "wav" });
  assert.deepEqual(keep(options, { voice_id: "a167e0f3-df7e-4d52-a9c3-f949145efdab" }), { voice_id: "a167e0f3-df7e-4d52-a9c3-f949145efdab" }, "a UUID voice id");
  assert.equal(keep(options, undefined), undefined);
  assert.equal(keep(options, {}), undefined);
});

test("what the route did not declare, or declared for another task, is not written", () => {
  const options = [{ name: "loop", type: "boolean" as const }, { name: "target_language", type: "enum" as const, values: ["ko", "en"], tasks: ["dubbing" as const] }];
  assert.deepEqual(keep(options, { loop: true, output_format: "mp3_44100_128", target_language: "ko", extra: { nested: 1 } }), { loop: true });
  assert.deepEqual(keep(options, { target_language: "ko" }, "dubbing"), { target_language: "ko" });
});

test("a value of the wrong shape is not written", () => {
  const options = [{ name: "loop", type: "boolean" as const }, { name: "format", type: "enum" as const, values: ["mp3", "wav"] }, { name: "voice_id", type: "voice" as const }];
  assert.equal(keep(options, { loop: "yes", format: "flac", voice_id: 42 }), undefined);
  assert.equal(keep(options, { voice_id: "has spaces and / slashes" }), undefined);
  assert.equal(keep(options, { voice_id: "x".repeat(65) }), undefined);
});

test("free text is never written, even when the route declares it", () => {
  assert.equal(keep([{ name: "style_note", type: "text" as const }], { style_note: "warm and slow" }), undefined);
});

test("nothing that looks like a secret is written: by name or by value", () => {
  const key = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";
  // A route that (wrongly) declares a key-like option still does not get it saved.
  for (const name of ["api_key", "apiKey", "access_token", "secret", "password", "authorization", "x-auth"]) {
    assert.equal(keep([{ name, type: "voice" as const }], { [name]: "plainvalue" }), undefined, name);
    assert.equal(keep([{ name, type: "enum" as const, values: ["plainvalue"] }], { [name]: "plainvalue" }), undefined, name);
  }
  // A key pasted where a voice id belongs.
  for (const value of [key, "xai-" + "a".repeat(40), "AIza" + "B".repeat(35), "fal-" + "c".repeat(30), "Bearer_abc", "r8_" + "d".repeat(37), "a".repeat(40) + "B1" + "c".repeat(22)]) {
    assert.equal(keep([{ name: "voice_id", type: "voice" as const }], { voice_id: value }), undefined, value.slice(0, 8));
  }
  assert.equal(keep([{ name: "tier", type: "enum" as const, values: [key] }], { tier: key }), undefined, "even a listed value");
});
