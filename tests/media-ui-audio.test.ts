import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MediaModel, MediaRoute } from "../ui/src/lib/mediaCatalog.js";
import type { MediaSelection } from "../ui/src/lib/mediaSelection.js";

const { audioUse, formProblem, lengthRange, parseLength, sizeChoices, taskParams } = await import("../ui/src/lib/mediaForm.js");
const { reconcileSelection } = await import("../ui/src/lib/mediaSelection.js");
const { parseMediaSelection } = await import("../ui/src/lib/mediaSelectionStore.js");
const { buildMediaSubmitBody } = await import("../ui/src/lib/mediaSubmitBody.js");
const { inferTask, inputLimits, modelTasks, taskKind } = await import("../ui/src/lib/mediaTasks.js");
const { filterModels, modelFacts, suggestModels } = await import("../ui/src/lib/mediaModelList.js");
const { generateBlocker } = await import("../ui/src/lib/mediaReadiness.js");
const { remakePlan } = await import("../ui/src/lib/mediaResult.js");
const { isAudioItem } = await import("../ui/src/lib/audioMedia.js");
const { filterVoices } = await import("../ui/src/lib/mediaVoices.js");

// The default studio reads what a route takes from the catalog (params.options, durationRange, inputs,
// taskFields). These are the shapes GET /api/media/catalog sends for the audio adapters.

function route(adapter: string, params: MediaRoute["params"], over: Partial<MediaRoute> = {}): MediaRoute {
  return { adapter, route: "direct", label: adapter, logo: null, upstreamId: adapter, tasks: ["text-to-audio"], params, pricing: [], docsUrl: "", hasKey: true, ...over };
}
function model(id: string, routes: MediaRoute[], kind: MediaModel["kind"] = "audio"): MediaModel {
  return { id, label: id, vendor: id.split("/")[0]!, logo: null, kind, tasks: [...new Set(routes.flatMap((entry) => entry.tasks))], routes, defaultRoute: routes[0]?.adapter ?? null };
}

const speech = route("elevenlabs", { options: [{ name: "voice_id", type: "voice", required: true }] });
const music = route("elevenlabs", { durationRange: { minSec: 3, maxSec: 600 }, options: [{ name: "force_instrumental", type: "boolean" }] });
const effects = route("mirelo", {
  durationRange: { minSec: 1, maxSec: 600, tasks: ["text-to-audio"], required: true },
  inputs: [{ role: "source-video", min: 1, max: 1, tasks: ["video-to-audio"] }],
}, { tasks: ["video-to-audio", "text-to-audio"] });
const voiceModel = model("elevenlabs/eleven-v4", [speech]);
const musicModel = model("elevenlabs/elevenlabs-music-2.5", [music]);
const effectsModel = model("mirelo/mirelo-sfx-2.0", [effects]);

test("sound from text is a task the composer can feed with the prompt alone", () => {
  assert.equal(inferTask("audio", 0), "text-to-audio");
  assert.equal(inferTask("audio", 3), "text-to-audio");
  assert.equal(taskKind("text-to-audio"), "audio");
  assert.deepEqual(inputLimits("text-to-audio", speech), { min: 0, max: 0 });
  assert.deepEqual(modelTasks(effectsModel), ["text-to-audio"], "the task that needs a video stays out");
});

test("a task whose declared input is a video or an audio clip is not offered, whatever its name", () => {
  const needsClip = route("x", { maxReferenceImages: 2, inputs: [{ role: "source-video", min: 1, max: 1, tasks: ["image-to-video"] }] }, { tasks: ["image-to-video", "text-to-video"] });
  assert.equal(inputLimits("image-to-video", needsClip), null);
  assert.deepEqual(inputLimits("text-to-video", needsClip), { min: 0, max: 0 });
  const optionalClip = route("y", { inputs: [{ role: "reference-audio", min: 0, max: 1 }] }, { tasks: ["text-to-video"] });
  assert.deepEqual(inputLimits("text-to-video", optionalClip), { min: 0, max: 0 }, "an optional input does not block the task");
});

test("taskParams keeps only what the task declares it takes", () => {
  const edit = route("kling", {
    durationsSec: [5, 10], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16"], nativeAudio: true, seed: true, negativePrompt: true,
    taskFields: { "image-to-video": { accepts: ["prompt", "durationSec", "resolution"], resolutions: ["720p"] } },
  }, { tasks: ["text-to-video", "image-to-video"], resolutionOptions: [{ value: "720p", label: "HD" }, { value: "1080p", label: "Full HD" }] });
  const narrowed = taskParams(edit, "image-to-video");
  assert.deepEqual(narrowed.durationsSec, [5, 10]);
  assert.deepEqual(narrowed.resolutions, ["720p"]);
  assert.equal(narrowed.aspectRatios, undefined);
  assert.equal(narrowed.nativeAudio, undefined);
  assert.equal(narrowed.seed, undefined);
  assert.equal(narrowed.negativePrompt, undefined);
  assert.deepEqual(sizeChoices(edit, narrowed), [{ value: "720p", label: "HD" }]);
  const open = taskParams(edit, "text-to-video");
  assert.deepEqual(open.aspectRatios, ["16:9", "9:16"], "a task without a declaration keeps the route's lists");
  assert.equal(open.seed, true);
});

test("a free length and the options apply only to the tasks they name", () => {
  assert.deepEqual(lengthRange(taskParams(effects, "text-to-audio")), { minSec: 1, maxSec: 600, required: true });
  assert.equal(lengthRange(taskParams(effects, "video-to-audio")), null);
  assert.deepEqual(lengthRange(taskParams(music, "text-to-audio")), { minSec: 3, maxSec: 600, required: false });
  const scoped = route("z", { options: [{ name: "a", type: "boolean", tasks: ["video-to-audio"] }, { name: "b", type: "boolean" }] });
  assert.deepEqual(taskParams(scoped, "text-to-audio").options?.map((option) => option.name), ["b"]);
});

test("a route that takes a voice is speech; one that does not makes sound from a description", () => {
  assert.equal(audioUse(speech), "speech");
  assert.equal(audioUse(music), "sound");
  const models = [voiceModel, musicModel, effectsModel];
  assert.deepEqual(filterModels(models, { kind: "audio", task: "text-to-audio", use: "speech" }).map((entry) => entry.id), ["elevenlabs/eleven-v4"]);
  assert.deepEqual(filterModels(models, { kind: "audio", task: "text-to-audio", use: "sound" }).map((entry) => entry.id), ["elevenlabs/elevenlabs-music-2.5", "mirelo/mirelo-sfx-2.0"]);
  assert.equal(modelFacts(voiceModel, "text-to-audio").voice, true);
  assert.deepEqual(modelFacts(musicModel, "text-to-audio").durations, { min: 3, max: 600 });
  assert.deepEqual(suggestModels([voiceModel, musicModel, effectsModel, model("a/b", [speech])], "text-to-audio"), [], "prices in different units are not ranked");
});

test("picking an audio model starts a required length at ten seconds and leaves an optional one to the model", () => {
  assert.equal(reconcileSelection(effectsModel, effects, "text-to-audio", null, "auto").selection.durationSec, 10);
  const short = route("s", { durationRange: { minSec: 0.5, maxSec: 6, required: true } });
  assert.equal(reconcileSelection(model("s/s", [short]), short, "text-to-audio", null, "auto").selection.durationSec, 6);
  const fresh = reconcileSelection(musicModel, music, "text-to-audio", null, "auto").selection;
  assert.equal(fresh.kind, "audio");
  assert.equal(fresh.use, "sound", "kept so the composer can say what the prompt is for without the catalog");
  assert.equal(reconcileSelection(voiceModel, speech, "text-to-audio", null, "auto").selection.use, "speech");
  assert.equal(fresh.durationSec, undefined);
  assert.equal(fresh.options, undefined);
});

test("changing the model keeps a length the new range holds, moves one it does not, and says so", () => {
  const previous: MediaSelection = { kind: "audio", model: musicModel.id, adapter: "elevenlabs", task: "text-to-audio", durationSec: 45, options: { force_instrumental: true } };
  const sfx = route("elevenlabs", { durationRange: { minSec: 0.5, maxSec: 30 }, options: [{ name: "loop", type: "boolean" }] });
  const moved = reconcileSelection(model("elevenlabs/sfx", [sfx]), sfx, "text-to-audio", previous, "auto");
  assert.equal(moved.selection.durationSec, 30);
  assert.equal(moved.selection.options, undefined, "an option the new route does not declare is not sent");
  assert.deepEqual(moved.adjusted, [{ field: "durationSec", from: "45", to: "30" }]);
  const same = reconcileSelection(musicModel, music, "text-to-audio", previous, "pinned");
  assert.equal(same.selection.durationSec, 45);
  assert.deepEqual(same.selection.options, { force_instrumental: true });
  assert.deepEqual(same.adjusted, []);
});

test("a voice stays with its provider and is dropped, with a note, on another provider", () => {
  const previous: MediaSelection = { kind: "audio", model: voiceModel.id, adapter: "elevenlabs", task: "text-to-audio", options: { voice_id: "v-rachel" }, voiceName: "Rachel" };
  const sibling = model("elevenlabs/eleven-turbo-v2.5", [speech]);
  const kept = reconcileSelection(sibling, speech, "text-to-audio", previous, "auto");
  assert.deepEqual(kept.selection.options, { voice_id: "v-rachel" });
  assert.equal(kept.selection.voiceName, "Rachel");
  assert.deepEqual(kept.adjusted, []);
  const other = route("cartesia", { options: [{ name: "voice_id", type: "voice", required: true }] });
  const dropped = reconcileSelection(model("cartesia/sonic-3.6", [other]), other, "text-to-audio", previous, "auto");
  assert.equal(dropped.selection.options, undefined);
  assert.equal(dropped.selection.voiceName, undefined);
  assert.deepEqual(dropped.adjusted, [{ field: "voice", from: "Rachel", to: null }]);
});

test("a listed choice keeps a listed value, and a required one starts at the first", () => {
  const choice = route("c", { options: [{ name: "format", type: "enum", values: ["mp3", "wav"], required: true }, { name: "style", type: "enum", values: ["a", "b"] }, { name: "note", type: "text", maxLength: 4 }] });
  const fresh = reconcileSelection(model("c/c", [choice]), choice, "text-to-audio", null, "auto").selection;
  assert.deepEqual(fresh.options, { format: "mp3" });
  const previous: MediaSelection = { ...fresh, options: { format: "wav", style: "gone", note: "abcdefgh" } };
  assert.deepEqual(reconcileSelection(model("c/c", [choice]), choice, "text-to-audio", previous, "auto").selection.options, { format: "wav", note: "abcd" });
});

test("the form names the first declared setting still missing", () => {
  assert.deepEqual(formProblem(speech, { task: "text-to-audio" }), { code: "voice" });
  assert.equal(formProblem(speech, { task: "text-to-audio", options: { voice_id: "v-rachel" } }), null);
  assert.deepEqual(formProblem(effects, { task: "text-to-audio" }), { code: "lengthRequired", min: 1, max: 600 });
  assert.deepEqual(formProblem(effects, { task: "text-to-audio", durationSec: 700 }), { code: "lengthRange", min: 1, max: 600 });
  assert.equal(formProblem(effects, { task: "text-to-audio", durationSec: 12 }), null);
  assert.equal(formProblem(music, { task: "text-to-audio" }), null, "an optional length may be left to the model");
  const needsText = route("t", { options: [{ name: "language", type: "enum", values: ["en"], required: true }] });
  assert.deepEqual(formProblem(needsText, { task: "text-to-audio" }), { code: "option", name: "language" });
});

test("Generate is held until the form is complete, after the key and the inputs", () => {
  assert.deepEqual(generateBlocker({ route: speech, state: "auto" }, "text-to-audio", 0, {}), { code: "form", problem: { code: "voice" } });
  assert.equal(generateBlocker({ route: speech, state: "auto" }, "text-to-audio", 0, { options: { voice_id: "v" } }), null);
  assert.equal(generateBlocker({ route: speech, state: "needs-key" }, "text-to-audio", 0, {})?.code, "key");
  assert.equal(generateBlocker({ route: speech, state: "auto" }, "text-to-audio", 2, {})?.code, "input");
});

test("a typed length is a number of seconds as written", () => {
  assert.equal(parseLength("12"), 12);
  assert.equal(parseLength(" 0.5 "), 0.5);
  assert.equal(parseLength("1."), 1, "a number still being typed");
  assert.equal(parseLength("0"), 0, "kept as typed so the range check can name it");
  for (const bad of ["", ".", "-3", "1e3", "abc", "1.2345", "12s", "12345"]) assert.equal(parseLength(bad), undefined, bad);
});

test("the request carries the declared options as vendorOptions and nothing when there are none", () => {
  const body = buildMediaSubmitBody({ kind: "audio", model: voiceModel.id, adapter: "elevenlabs", task: "text-to-audio", options: { voice_id: "v-rachel" }, voiceName: "Rachel" }, "Hello there", "r1", "s1", []);
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { requestId: "r1", sessionId: "s1", prompt: "Hello there", model: voiceModel.id, adapter: "elevenlabs", task: "text-to-audio",
    vendorOptions: { voice_id: "v-rachel" }, inputs: [] });
  const plain = buildMediaSubmitBody({ kind: "audio", model: musicModel.id, adapter: "elevenlabs", task: "text-to-audio", durationSec: 30, options: {} }, "lofi", "r2", null, []);
  assert.equal("vendorOptions" in plain, false);
  assert.equal(plain.durationSec, 30);
});

test("a saved audio selection is read back with its options and voice name; other shapes are dropped", () => {
  const saved = parseMediaSelection({ kind: "audio", model: voiceModel.id, adapter: "elevenlabs", task: "text-to-audio", routeMode: "auto",
    durationSec: 12.5, options: { voice_id: "v-rachel", loop: true, bad: 3, nested: { a: 1 } }, voiceName: "Rachel", use: "speech" });
  assert.deepEqual(saved, { kind: "audio", model: voiceModel.id, adapter: "elevenlabs", task: "text-to-audio", routeMode: "auto", durationSec: 12.5,
    options: { voice_id: "v-rachel", loop: true }, voiceName: "Rachel", use: "speech" });
  assert.equal(parseMediaSelection({ kind: "audio", model: "m", adapter: "a", task: "text-to-audio", options: ["x"] })?.options, undefined);
  assert.equal(parseMediaSelection({ kind: "sound", model: "m", adapter: "a", task: "text-to-audio" }), null);
});

test("Make again restores an audio result's model and length, and asks for a voice again", () => {
  const row = { provider: "media:elevenlabs", adapter: "elevenlabs", model: musicModel.id, mediaType: "audio",
    media: { task: "text-to-audio", durationSec: 45, resolution: null, aspectRatio: null, seed: null, audio: null, inputRoles: [] } };
  const plan = remakePlan(row, [voiceModel, musicModel]);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.selection.kind, "audio");
    assert.equal(plan.selection.durationSec, 45);
    assert.equal(plan.selection.routeMode, "pinned");
    assert.equal(plan.voiceNeeded, false);
  }
  const spoken = remakePlan({ ...row, model: voiceModel.id, media: { ...row.media, durationSec: null } }, [voiceModel, musicModel]);
  assert.equal(spoken.ok && spoken.voiceNeeded, true);
  // A result that recorded its options brings the voice and the switches back.
  const recorded = remakePlan({ ...row, model: voiceModel.id, media: { ...row.media, durationSec: null, options: { voice_id: "v-rachel", nested: { a: 1 }, undeclared: true } } }, [voiceModel, musicModel]);
  assert.equal(recorded.ok && recorded.voiceNeeded, false);
  assert.deepEqual(recorded.ok && recorded.selection.options, { voice_id: "v-rachel" }, "only what the route still declares");
  assert.deepEqual(remakePlan({ ...row, mediaType: "video" }, [voiceModel, musicModel]), { ok: false, reason: "model-gone" });
});

test("a sound file is told apart from pictures and clips", () => {
  assert.equal(isAudioItem({ image: "/generated/a.mp3", url: "/generated/a.mp3", filename: "a.mp3" }), true);
  assert.equal(isAudioItem({ image: "/generated/a.png", filename: "a.png", mediaType: "audio" }), true);
  assert.equal(isAudioItem({ image: "/generated/a.mp4", filename: "a.mp4", mediaType: "video" }), false);
  assert.equal(isAudioItem({ image: "/generated/a.png", filename: "a.png" }), false);
  assert.equal(isAudioItem(null), false);
});

test("voices are searched by name, description, language and gender", () => {
  const voices = [{ id: "1", name: "Rachel", description: "calm narrator", language: "en", gender: "female" as const }, { id: "2", name: "Jiho", language: "ko", gender: "male" as const }];
  assert.deepEqual(filterVoices(voices, "calm").map((voice) => voice.id), ["1"]);
  assert.deepEqual(filterVoices(voices, "ko male").map((voice) => voice.id), ["2"]);
  assert.equal(filterVoices(voices, "  ").length, 2);
});
