// What the audio routes need besides a prompt: a length the maker accepts as a range, switches such as
// "instrumental", and the source video for sound-for-video. A form built from the declaration must be a
// request the adapter accepts.
import test from "node:test";
import assert from "node:assert/strict";
import type { MediaAdapterContext, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { adapter as elevenlabs } from "../lib/providers/media/direct/elevenlabs.ts";
import { adapter as mirelo } from "../lib/providers/media/direct/mirelo.ts";
import { paramsFromSchemas, type EndpointSchema } from "../lib/providers/media/aggregator/shared/fields.ts";
import { validateAgainstSpec } from "../lib/providers/media/validate.ts";

const spec = (adapter: MediaProviderAdapter, id: string): MediaModelSpec => adapter.listModels().find((m) => m.id === id)!;

function recording(): { ctx: MediaAdapterContext; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { ctx: { apiKey: "test-key-0123456789", fetch: fetchImpl }, bodies };
}

async function reaches(adapter: MediaProviderAdapter, request: MediaSubmitRequest): Promise<unknown> {
  const { ctx, bodies } = recording();
  await adapter.submit(ctx, request).catch(() => undefined);
  assert.equal(bodies.length, 1, "the adapter refused the declared form: " + JSON.stringify(request));
  return bodies[0];
}

test("music and sound effects declare the length they accept and their switches", () => {
  const music = spec(elevenlabs, "elevenlabs/elevenlabs-music-2.5").params;
  assert.deepEqual(music.durationRange, { minSec: 3, maxSec: 600 });
  assert.deepEqual(music.options, [{ name: "force_instrumental", type: "boolean" }]);
  const sfx = spec(elevenlabs, "elevenlabs/eleven-text-to-sound-v3").params;
  assert.deepEqual(sfx.durationRange, { minSec: 0.5, maxSec: 30 });
  assert.deepEqual(sfx.options, [{ name: "loop", type: "boolean" }]);
  // Speech has no length to set: it follows the text.
  assert.equal(spec(elevenlabs, "elevenlabs/eleven-v3").params.durationRange, undefined);
});

test("ElevenLabs accepts both ends of each declared range, with and without the switch", async () => {
  for (const [id, option] of [["elevenlabs/elevenlabs-music-2.5", "force_instrumental"], ["elevenlabs/eleven-text-to-sound-v3", "loop"]] as const) {
    const range = spec(elevenlabs, id).params.durationRange!;
    for (const durationSec of [range.minSec, range.maxSec]) {
      await reaches(elevenlabs, { model: id, task: "text-to-audio", prompt: "rain on a tin roof", durationSec, inputs: [], vendorOptions: { [option]: true } });
    }
    await reaches(elevenlabs, { model: id, task: "text-to-audio", prompt: "rain on a tin roof", inputs: [] });
  }
});

test("Mirelo says a text request must carry a length, and sound-for-video takes one source video", async () => {
  const params = spec(mirelo, "mirelo/mirelo-sfx-2.0").params;
  assert.deepEqual(params.durationRange, { minSec: 1, maxSec: 600, tasks: ["text-to-audio"], required: true });
  assert.deepEqual(params.inputs, [{ role: "source-video", min: 1, max: 1, tasks: ["video-to-audio"], billedLength: true }]);
  const text = await reaches(mirelo, { model: "mirelo/mirelo-sfx-2.0", task: "text-to-audio", prompt: "footsteps on gravel", durationSec: 1, inputs: [] });
  assert.equal((text as { duration_ms: number }).duration_ms, 1000);
  await reaches(mirelo, { model: "mirelo/mirelo-sfx-2.0", task: "text-to-audio", prompt: "footsteps on gravel", durationSec: 600, inputs: [] });
  await reaches(mirelo, { model: "mirelo/mirelo-sfx-2.0", task: "video-to-audio", inputs: [{ role: "source-video", url: "https://example.test/clip.mp4", mimeType: "video/mp4" }] });
});

test("a declared range adds no refusal: lengths the adapters took before still pass the shared check", () => {
  const sfx = spec(elevenlabs, "elevenlabs/eleven-text-to-sound-v3");
  assert.doesNotThrow(() => validateAgainstSpec(sfx, { model: sfx.id, task: "text-to-audio", prompt: "x", durationSec: 2.5, inputs: [] } as never));
});

test("an aggregator's sound-for-video endpoint declares its source video from the published schema", () => {
  const endpoint: EndpointSchema = { endpoint: "acme/sfx/video-to-audio", task: "video-to-audio", required: ["video_url"],
    fields: { video_url: { type: "string" }, prompt: { type: "string" }, negative_prompt: { type: "string" }, seed: { type: "integer" } } };
  assert.deepEqual(paramsFromSchemas([endpoint]).inputs, [{ role: "source-video", min: 1, max: 1, tasks: ["video-to-audio"], billedLength: true }]);
});

