import { test, expect, type Browser, type Page } from "@playwright/test";
import { openCreateScreen, openStaticApp, type StaticAppOptions } from "./fixtures/staticClassicApp";
import { audioHistoryRow, type MediaFixture } from "./fixtures/mediaModels";

// Audio as an output of the default studio: the model window, the settings a route declares (a voice,
// a free length, switches), the estimate, running, the result with a player, and making it again.
// The built UI runs on a synthetic origin with fixture answers only: no app server, no provider.

const dialog = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });
const card = (page: Page) => page.locator("#right-panel-tab-settings .media-card");
const composer = (page: Page) => page.locator(".composer:visible .composer__textarea");
const generate = (page: Page) => page.locator(".generate-btn:visible");
const hint = (page: Page) => page.locator(".generate-row__media:visible");
const voice = (page: Page) => card(page).locator(".media-voice");
const voiceReads = (media: MediaFixture) => media.calls.filter((call) => call.path === "/api/media/voices").length;

async function openAudio(page: Page, use: "Speech" | "Music and sound effects"): Promise<void> {
  await card(page).locator(".media-picker__open").first().click();
  await dialog(page).getByRole("group", { name: "Output" }).getByRole("button", { name: "Audio", exact: true }).click();
  await dialog(page).getByRole("group", { name: "What to make" }).getByRole("button", { name: use, exact: true }).click();
}

async function pick(page: Page, use: "Speech" | "Music and sound effects", id: string): Promise<void> {
  await openAudio(page, use);
  await dialog(page).locator('.media-row[data-model="' + id + '"]').first().click();
  await expect(dialog(page)).toHaveCount(0);
}

function run(options: StaticAppOptions & { rows?: Record<string, unknown>[] }, body: (page: Page, media: MediaFixture) => Promise<void>) {
  return async ({ browser }: { browser: Browser }) => {
    const { rows, ...rest } = options;
    const app = await openStaticApp(browser, { keys: ["fal", "elevenlabs"], ...rest, ...(rows ? { storage: { "ima2.selectedFilename": String(rows[0]!.filename), ...rest.storage } } : {}) });
    if (rows) app.media.history.push(...rows);
    try {
      await openCreateScreen(app.page);
      await body(app.page, app.media);
      expect(app.unexpected).toEqual([]);
      expect(app.errors).toEqual([]);
    } finally { await app.close(); }
  };
}

test("AU1 the model window lists audio models by what they make: speech takes a voice, music and effects do not", run({}, async (page, media) => {
  expect(media.mediaReads(), "nothing media is read before the window opens").toBe(0);
  await openAudio(page, "Speech");
  await expect(dialog(page).getByRole("group", { name: "What to make" }).getByRole("button", { name: "Speech", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog(page).locator(".media-dialog__needs")).toHaveText("A voice reads the prompt aloud, exactly as written.");
  const rows = () => dialog(page).locator(".media-row[data-model]").evaluateAll((items) => items.map((item) => item.getAttribute("data-model")));
  await expect.poll(rows).toEqual(["elevenlabs/eleven-v4", "cartesia/sonic-3.6"]);
  const eleven = dialog(page).locator('.media-row[data-model="elevenlabs/eleven-v4"]');
  await expect(eleven.locator(".media-row__tag")).toHaveText("Voice");
  await expect(eleven.locator(".media-row__price")).toHaveText("from $0.08/1K chars");
  await expect(dialog(page).locator(".media-count")).toHaveText("2 of 2");
  // Built-in providers make no sound, so the window does not offer them here.
  await expect(dialog(page).locator(".media-row--builtin")).toHaveCount(0);

  await dialog(page).getByRole("group", { name: "What to make" }).getByRole("button", { name: "Music and sound effects", exact: true }).click();
  await expect(dialog(page).locator(".media-dialog__needs")).toHaveText("The prompt describes the music or sound to make.");
  await expect.poll(rows).toEqual(["elevenlabs/elevenlabs-music-2.5", "mirelo/mirelo-sfx-2.0", "stability/stable-audio-3"]);
  await expect(dialog(page).locator('.media-row[data-model="elevenlabs/elevenlabs-music-2.5"] .media-row__spec')).toHaveText("3–600 s");
  await expect(dialog(page).locator('.media-row[data-model="elevenlabs/elevenlabs-music-2.5"] .media-row__tag')).toHaveCount(0);
  // A model that only makes sound for a video is named with the reason, not hidden.
  const unsupported = dialog(page).locator(".media-unsupported");
  await expect(unsupported.locator("summary")).toHaveText("Not available in this composer (1)");
  await unsupported.locator("summary").click();
  await expect(unsupported).toContainText("Mirelo Foley");
  expect(voiceReads(media), "voices are not read while browsing models").toBe(0);
}));

test("AU2 speech: the voice is chosen from the provider's list with a sample, Generate waits for it, and the request carries it", run({}, async (page, media) => {
  await composer(page).fill("Welcome aboard. Please keep your seatbelt fastened.");
  await pick(page, "Speech", "elevenlabs/eleven-v4");
  await expect(card(page)).toContainText("Eleven v4");
  await expect(card(page).locator(".media-card__name small")).toHaveText("ElevenLabs · Audio");
  await expect(card(page).locator(".media-inputs[role=note]")).toHaveText("A voice reads the prompt aloud, exactly as written.");
  await expect(composer(page)).toHaveAttribute("placeholder", "Write what the voice should say...");

  // No voice yet: the list is open, and Generate says what it is waiting for.
  await expect(voice(page).locator(".media-voice__current")).toHaveText("Choose a voice");
  await expect(voice(page).locator(".media-voice__pick")).toHaveCount(10);
  await expect(voice(page).locator(".media-voice__group")).toHaveText(["My voices", "Voice library"]);
  expect(media.calls.filter((call) => call.path === "/api/media/voices").length).toBe(1);
  await expect(hint(page)).toHaveText("Choose a voice to generate.");
  await expect(generate(page)).toHaveAttribute("aria-disabled", "true");
  // The button stays focusable so its reason is announced; pressing it sends nothing.
  await generate(page).click({ force: true });
  expect(media.submissions).toEqual([]);

  await voice(page).getByLabel("Search voices").fill("calm");
  await expect(voice(page).locator(".media-voice__pick")).toHaveCount(1);
  const rachel = voice(page).locator(".media-voice__row", { hasText: "Rachel" });
  await expect(rachel.locator(".media-voice__facts")).toHaveText("English · Female");
  const sample = rachel.getByRole("button", { name: "Play a sample of Rachel" });
  await sample.click();
  await expect(rachel.getByRole("button", { name: "Stop the sample of Rachel" })).toHaveAttribute("aria-pressed", "true");
  await rachel.getByRole("button", { name: "Stop the sample of Rachel" }).click();
  await expect(sample).toHaveAttribute("aria-pressed", "false");
  await voice(page).getByLabel("Search voices").fill("zzz");
  await expect(voice(page)).toContainText("No voice matches.");
  await voice(page).getByLabel("Search voices").fill("rachel");
  await rachel.locator(".media-voice__pick").click();

  // Chosen: the list closes and the control shows the name.
  await expect(voice(page).locator(".media-voice__current")).toContainText("Rachel");
  await expect(voice(page).locator(".media-voice__pick")).toHaveCount(0);
  const estimate = card(page).locator(".media-estimate");
  await expect(estimate.locator(".price")).toHaveText("Billed by usage");
  await expect(estimate).toContainText("ElevenLabs charges this model per character");
  await expect(hint(page)).toHaveText("Eleven v4 · billed by usage");
  await card(page).locator(".media-prices summary").click();
  await expect(card(page).locator(".media-price").first()).toContainText("$0.08/1K chars");

  await expect(generate(page)).not.toHaveAttribute("aria-disabled", "true");
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  const sent = media.submissions[0]!;
  expect({ model: sent.model, adapter: sent.adapter, task: sent.task, prompt: sent.prompt, vendorOptions: sent.vendorOptions, inputs: sent.inputs }).toEqual({
    model: "elevenlabs/eleven-v4", adapter: "elevenlabs", task: "text-to-audio", prompt: "Welcome aboard. Please keep your seatbelt fastened.", vendorOptions: { voice_id: "v-rachel" }, inputs: [] });
  for (const field of ["durationSec", "resolution", "aspectRatio", "audio", "seed", "negativePrompt"]) expect(sent[field], field + " is not sent to a route that does not take it").toBeUndefined();

  // Running, then the result: a player on the stage and a tile that is not a broken picture.
  const id = String(sent.requestId);
  await media.emit(page, "submitted", id, {});
  await media.emit(page, "progress", id, { status: "running" });
  await expect(generate(page).locator(".generate-btn__count")).toHaveText("1");
  media.history.push(audioHistoryRow({ filename: "l11-speech.mp3", url: "/generated/l11-speech.mp3", model: "elevenlabs/eleven-v4", requestId: id,
    prompt: sent.prompt, userPrompt: sent.prompt, media: { task: "text-to-audio", durationSec: null, resolution: null, aspectRatio: null, seed: null, audio: null, inputRoles: [] } }));
  await media.emit(page, "done", id, { outputs: [{ filename: "l11-speech.mp3", url: "/generated/l11-speech.mp3", mediaType: "audio" }] });
  const result = page.locator(".result-audio:visible");
  await expect(result.locator("audio")).toHaveAttribute("src", /l11-speech\.mp3/);
  await expect(result.locator(".result-audio__title")).toHaveText("Eleven v4");
  await expect(page.locator(".result-audio__prompt"), "the prompt is shown once, under the result").toHaveCount(0);
  expect(await result.locator("audio").evaluate((node: HTMLAudioElement) => new Promise<number>((resolve) => {
    if (node.readyState >= 1) resolve(node.duration); else { node.onloadedmetadata = () => resolve(node.duration); node.onerror = () => resolve(-1); }
  })), "the player loads the file").toBeGreaterThan(0);
  await expect(page.locator("img[src*='l11-speech.mp3']"), "a sound file is never shown as a picture").toHaveCount(0);
  const actions = page.locator(".result-actions:visible").first();
  for (const name of ["Download", "Make again", "Info"]) await expect(actions.getByRole("button", { name, exact: true })).toBeVisible();
  for (const name of ["Copy image", "Continue here", "First node"]) await expect(actions.getByRole("button", { name, exact: true })).toHaveCount(0);

  // The selection, voice included, is still there after a reload.
  await page.reload();
  await expect(voice(page).locator(".media-voice__current")).toContainText("Rachel");
}));

test("AU3 sound: a required length starts in range, a value outside it is named and holds Generate, and the estimate follows it", run({}, async (page, media) => {
  await composer(page).fill("rain on a tin roof, distant thunder");
  await pick(page, "Music and sound effects", "mirelo/mirelo-sfx-2.0");
  await expect(card(page).locator(".media-inputs[role=note]")).toHaveText("The prompt describes the music or sound to make.");
  await expect(composer(page)).toHaveAttribute("placeholder", "Describe the music or sound to make...");
  // Automatic says why it is not on the maker's own route.
  await expect(card(page).locator(".media-routes")).toContainText("Now: fal (Mirelo direct needs a key)");
  const length = card(page).getByLabel("Duration", { exact: true });
  await expect(length).toHaveValue("10");
  await expect(card(page).locator(".media-field-hint")).toHaveText("1–600 seconds");
  const estimate = card(page).locator(".media-estimate");
  await expect(estimate.locator(".price")).toHaveText("$0.20");
  await expect(estimate.locator("small").first()).toHaveText("10 s × $0.02/s");

  await length.fill("700");
  await expect(card(page).locator(".media-field-error")).toHaveText("Duration must be 1 to 600 seconds.");
  await expect(hint(page)).toHaveText("Duration must be 1 to 600 seconds.");
  await expect(generate(page)).toHaveAttribute("aria-disabled", "true");
  await length.fill("");
  await expect(card(page).locator(".media-field-error")).toHaveText("Set a duration from 1 to 600 seconds.");
  await length.fill("12.5");
  await expect(estimate.locator(".price")).toHaveText("$0.25");
  await expect(card(page).locator(".media-field-error")).toHaveCount(0);
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  expect(media.submissions[0]).toMatchObject({ model: "mirelo/mirelo-sfx-2.0", adapter: "fal", task: "text-to-audio", durationSec: 12.5, inputs: [] });
  expect(media.submissions[0]!.vendorOptions).toBeUndefined();
}));

test("AU4 music: the length may be left to the model, and a declared switch is sent only when it is on", run({}, async (page, media) => {
  await composer(page).fill("slow lo-fi piano for a rainy evening");
  await pick(page, "Music and sound effects", "elevenlabs/elevenlabs-music-2.5");
  const length = card(page).getByLabel("Duration", { exact: true });
  await expect(length).toHaveValue("");
  await expect(length).toHaveAttribute("placeholder", "Model decides");
  await expect(card(page).locator(".media-field-hint")).toHaveText("3–600 seconds. Leave empty to let the model decide.");
  await expect(card(page).locator(".media-estimate .price")).toHaveText("Billed by usage");
  await expect(generate(page)).not.toHaveAttribute("aria-disabled", "true");
  await card(page).getByLabel("Instrumental only (no vocals)").check();
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  expect(media.submissions[0]).toMatchObject({ model: "elevenlabs/elevenlabs-music-2.5", adapter: "elevenlabs", task: "text-to-audio", vendorOptions: { force_instrumental: true } });
  expect(media.submissions[0]!.durationSec).toBeUndefined();

  // A list of lengths is still a slider, as for video; a route that takes a seed still offers it.
  await pick(page, "Music and sound effects", "stability/stable-audio-3");
  await expect(card(page).locator(".ctl-duration")).toBeVisible();
  await expect(card(page).getByLabel("Seed")).toBeVisible();
  await expect(card(page).getByLabel("Instrumental only (no vocals)")).toHaveCount(0);
}));

test("AU5 without the provider's key the voice list is not asked for, and it loads once the key is saved", run({ keys: ["fal"] }, async (page, media) => {
  await pick(page, "Speech", "elevenlabs/eleven-v4");
  const entry = card(page).getByRole("region", { name: "ElevenLabs needs an API key" });
  await expect(entry).toBeVisible();
  await expect(voice(page)).toContainText("Add the ElevenLabs key to list its voices.");
  await expect(hint(page)).toHaveText("Add a ElevenLabs API key to generate.");
  expect(voiceReads(media)).toBe(0);
  await entry.getByLabel("API key").fill("el-key-0000000000");
  await entry.getByRole("button", { name: "Check and save" }).click();
  await expect(voice(page).locator(".media-voice__pick")).toHaveCount(10);
  await expect(hint(page)).toHaveText("Choose a voice to generate.");
}));

test("AU6 a voice list that fails says so and reads again on request; an empty account says that instead", run({}, async (page, media) => {
  media.voiceMode = "error";
  await pick(page, "Speech", "elevenlabs/eleven-v4");
  const alert = voice(page).getByRole("alert");
  await expect(alert).toContainText("Could not load voices from ElevenLabs.");
  media.voiceMode = "empty";
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(voice(page)).toContainText("This account has no voices yet.");
  expect(media.calls.filter((call) => call.path === "/api/media/voices").length).toBe(2);
}));

test("AU7 changing to another provider drops the voice and says so; the prompt stays", run({ keys: ["fal", "elevenlabs", "cartesia"] }, async (page) => {
  await composer(page).fill("Mind the gap.");
  await pick(page, "Speech", "elevenlabs/eleven-v4");
  await voice(page).locator('.media-voice__pick[data-voice="v-jiho"]').click();
  await expect(voice(page).locator(".media-voice__current")).toContainText("Jiho");
  await pick(page, "Speech", "cartesia/sonic-3.6");
  await expect(card(page).locator(".media-note")).toContainText("Voice: not available here");
  await expect(voice(page).locator(".media-voice__current")).toHaveText("Choose a voice");
  await expect(card(page).locator(".media-estimate .price")).toHaveText("No published price");
  await expect(composer(page)).toHaveValue("Mind the gap.");
}));

test("AU8 a sound result opens with a player, and Make again restores its model and length without sending anything", run({ rows: [audioHistoryRow()] }, async (page, media) => {
  const result = page.locator(".result-audio:visible");
  await expect(result.locator("audio")).toHaveAttribute("src", /l11-music\.mp3/);
  await expect(page.locator(".result-preview-frame:visible .viewer-controls")).toHaveCount(0);
  expect(media.mediaReads(), "showing a result reads no media data").toBe(0);
  const actions = page.locator(".result-actions:visible").first();
  await actions.getByRole("button", { name: "Info", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Generation Details" });
  for (const text of ["ElevenLabs", "Eleven Music 2.5", "From text", "45 s"]) await expect(details).toContainText(text);
  await page.keyboard.press("Escape");
  await actions.getByRole("button", { name: "Make again", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Model, settings and prompt restored. Check the estimate, then press Generate.");
  await expect(card(page)).toContainText("Eleven Music 2.5");
  await expect(card(page).getByLabel("Duration", { exact: true })).toHaveValue("45");
  await expect(composer(page)).toHaveValue("slow lo-fi piano for a rainy evening");
  expect(media.submissions).toEqual([]);
}));

test("AU9 Make again for speech restores the model and asks for the voice, which a result does not keep", run({ rows: [audioHistoryRow({ model: "elevenlabs/eleven-v4", filename: "l11-speech.mp3", url: "/generated/l11-speech.mp3",
  media: { task: "text-to-audio", durationSec: null, resolution: null, aspectRatio: null, seed: null, audio: null, inputRoles: [] } })] }, async (page, media) => {
  await page.locator(".result-actions:visible").first().getByRole("button", { name: "Make again", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Model, settings and prompt restored. Choose a voice, then press Generate.");
  await expect(voice(page).locator(".media-voice__current")).toHaveText("Choose a voice");
  await expect(hint(page)).toHaveText("Choose a voice to generate.");
  expect(media.submissions).toEqual([]);
}));

test("AU10 a sound workflow on the user's own ComfyUI is listed under Audio, keyless and without a provider charge", run({ localRoute: true }, async (page) => {
  await composer(page).fill("an upbeat synth loop");
  await openAudio(page, "Music and sound effects");
  const row = dialog(page).locator('.media-row[data-model="comfy/ace-step"]');
  await expect(row.locator(".media-row__price")).toHaveText("No provider charge");
  await row.click();
  const route = card(page).locator(".media-route");
  await expect(route).toContainText("ComfyUI (this computer)");
  await expect(route.locator(".media-route__key")).toHaveText("No key needed");
  await expect(card(page).locator(".media-estimate .price")).toHaveText("No provider charge");
  await expect(hint(page)).toHaveText("ACE-Step (my workflow) · runs on this computer");
  await expect(generate(page)).not.toHaveAttribute("aria-disabled", "true");
}));

test("AU11 the audio surfaces are Korean in Korean", run({ locale: "ko" }, async (page) => {
  await card(page).locator(".media-picker__open").first().click();
  const window = page.locator(".media-dialog");
  await window.locator(".media-tabs").first().getByRole("button", { name: "오디오", exact: true }).click();
  await expect(window.getByRole("group", { name: "만들 소리" }).getByRole("button")).toHaveText(["음성", "음악·효과음"]);
  await window.locator('.media-row[data-model="elevenlabs/eleven-v4"]').click();
  await expect(voice(page).locator(".media-voice__current")).toHaveText("목소리 고르기");
  await expect(voice(page).locator(".media-voice__group")).toHaveText(["내 목소리", "목소리 라이브러리"]);
  await expect(voice(page).locator(".media-voice__row", { hasText: "Rachel" }).locator(".media-voice__facts")).toHaveText("영어 · 여성");
  await expect(hint(page)).toHaveText("생성하려면 목소리를 골라 주세요.");
}));
