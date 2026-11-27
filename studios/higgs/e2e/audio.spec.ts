import { expect, test, type Page, type Request } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));
const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
const generate = (page: Page) => page.getByRole("button", { name: /^Generate/ });
const key = (page: Page, method: "PUT" | "DELETE") =>
  page.request.fetch("/api/keys/elevenlabs", { method, ...(method === "PUT" ? { data: { apiKey: "audio-spec-key" } } : {}) });

test("audio: speech needs a script and a voice from the provider's list, prices by characters and sends the voice id", async ({ page }) => {
  await key(page, "PUT");
  try {
    await page.goto("/#/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audio" }).click();
    await expect(page.getByRole("button", { name: "Speech" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Eleven v3");
    await expect(generate(page)).toBeDisabled();
    await expect(page.getByText("Write what the voice should say.")).toBeVisible();
    await expect(generate(page)).toContainText("Priced per character");
    await page.getByLabel("Script").fill("Welcome aboard. Doors close in two minutes.");
    await expect(page.getByText("43 characters")).toBeVisible();
    await expect(page.getByText("Choose a voice.")).toBeVisible();
    // 43 characters at $0.00008.
    await expect(generate(page)).toContainText("Estimated $0.0034");

    await page.getByRole("button", { name: "Voice: Choose a voice" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a voice" });
    await expect(picker.getByText("My voices")).toBeVisible();
    await expect(picker.getByRole("button", { name: /^My studio voice/ })).toBeVisible();
    await expect(picker.getByRole("button", { name: /^Yeji/ })).toContainText("Korean · Female");
    await expect(picker.getByRole("button", { name: "Play a sample of Bella" })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Play a sample of Yeji" })).toHaveCount(0);
    await picker.getByRole("searchbox", { name: "Search voices" }).fill("korean");
    await expect(picker.getByRole("button", { name: /^Bella/ })).toHaveCount(0);
    await picker.getByRole("button", { name: /^Yeji/ }).click();
    await expect(page.getByRole("button", { name: "Voice: Yeji" })).toBeVisible();

    const request = submitted(page);
    await generate(page).click();
    const body = (await request).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ model: "elevenlabs/eleven-v3", adapter: "elevenlabs", task: "text-to-audio", prompt: "Welcome aboard. Doors close in two minutes.", vendorOptions: { voice_id: "voice-yeji" } });
    expect(body).not.toHaveProperty("durationSec");
    const card = page.getByRole("article", { name: /Welcome aboard/ }).first();
    await expect(card.getByText("Done")).toBeVisible({ timeout: 15_000 });
    await expect(card.locator("audio")).toBeAttached();
  } finally {
    await key(page, "DELETE");
  }
});

test("audio: without the provider's key the voice list is not asked for, and the form says what to add", async ({ page }) => {
  let asked = 0;
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/media/voices") asked += 1; });
  await page.goto("/#/audio?tool=speech");
  await expect(page.getByRole("region", { name: "Add a key to run this model" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Voice: / })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Voice: / })).toContainText("Add the key to see this provider's voices.");
  await page.getByLabel("Script").fill("Hello");
  await expect(generate(page)).toBeDisabled();
  expect(asked).toBe(0);
});

test("audio: music and sound sends a description, a length inside the route's range and its switch", async ({ page }) => {
  await page.goto("/#/audio?tool=sound");
  await expect(page.getByRole("button", { name: "Music and sound" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Model: / }).click();
  await page.getByRole("dialog", { name: "Choose a model" }).getByRole("button", { name: /Eleven Music 2\.5/ }).click();
  // An optional length starts empty: the model decides.
  await expect(page.getByLabel(/^Length in seconds/)).toHaveValue("");
  await page.getByLabel("Description").fill("Warm lo-fi piano with soft rain");
  await page.getByLabel(/^Length in seconds/).fill("2");
  await expect(page.getByText("Length must be 3 to 600 seconds.")).toBeVisible();
  await expect(generate(page)).toBeDisabled();
  await page.getByLabel(/^Length in seconds/).fill("30");
  // fal lists $0.20 per minute in the fixture catalog.
  await expect(generate(page)).toContainText("Estimated $0.10");
  await page.getByRole("button", { name: "Instrumental only" }).click();
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ model: "elevenlabs/elevenlabs-music-2.5", adapter: "fal", task: "text-to-audio", prompt: "Warm lo-fi piano with soft rain", durationSec: 30, vendorOptions: { force_instrumental: true } });
});

test("audio: a sound effect model that needs a length starts with one", async ({ page }) => {
  await page.goto("/#/audio?tool=sound&model=mirelo%2Fmirelo-sfx-2.0");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Mirelo SFX 2.0");
  await expect(page.getByLabel(/^Length in seconds/)).toHaveValue("10");
  await page.getByLabel("Description").fill("Footsteps on gravel");
  await page.getByLabel(/^Length in seconds/).fill("");
  await expect(page.getByText("Set a length.")).toBeVisible();
  await page.getByLabel(/^Length in seconds/).fill("4");
  const request = submitted(page);
  await generate(page).click();
  expect((await request).postDataJSON()).toMatchObject({ task: "text-to-audio", durationSec: 4 });
});

test("audio: sound for video takes the clip, prices by its length and sends it as the source", async ({ page }) => {
  await page.goto("/#/audio?tool=video");
  await expect(page.getByText("Add the video.")).toBeVisible();
  await expect(generate(page)).toContainText("Add the video to see the price");
  await page.getByLabel("Video", { exact: true }).setInputFiles(CLIP);
  await expect(generate(page)).toContainText(/Estimated \$\d/);
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.task).toBe("video-to-audio");
  expect((body.inputs as { role: string }[]).map((i) => i.role)).toEqual(["source-video"]);
  expect(body).not.toHaveProperty("prompt");
});

test("audio: Korean names the tools and steps; Models and the empty audio tab lead here", async ({ page }) => {
  await page.goto("/#/models");
  await page.getByRole("searchbox").fill("Eleven Music");
  await page.getByRole("article").filter({ hasText: "Eleven Music 2.5" }).getByRole("link").last().click();
  await expect(page).toHaveURL(/#\/audio\?tool=sound&model=elevenlabs/);
  await page.getByRole("button", { name: /Language/ }).click();
  await expect(page.getByRole("button", { name: "음악과 효과음" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("만들 소리를 설명해 주세요.")).toBeVisible();
  await page.getByRole("button", { name: "영상에 소리" }).click();
  await expect(generate(page).or(page.getByRole("button", { name: /^생성/ }))).toContainText("영상을 넣으면 가격이 계산돼요");
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});

