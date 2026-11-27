import { expect, test, type Page, type Request } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));

/** Two seconds of silence: 8 kHz, mono, 8-bit PCM. */
function wav(seconds = 2): Buffer {
  const data = Buffer.alloc(8000 * seconds, 128);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24); head.writeUInt32LE(8000, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const audio = { name: "line.wav", mimeType: "audio/wav", buffer: wav() };
const face = {
  name: "face.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
};

const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
const generate = (page: Page) => page.getByRole("button", { name: /Generate/ });

test("talking video: lip sync asks for a video and audio, prices the longer one and sends only those", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByRole("button", { name: "Talking video" }).click();
  await expect(page).toHaveURL(/#\/video\?mode=speak/);
  await expect(page.getByRole("button", { name: "Lip sync" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Sync Lipsync 3");
  await expect(generate(page)).toBeDisabled();
  await expect(generate(page)).toContainText("Add the video to see the price");
  await expect(page.getByText("Add: Video of the speaker.")).toBeVisible();
  await expect(page.getByLabel("Prompt")).toHaveCount(0);

  await page.getByLabel("Video of the speaker").setInputFiles(CLIP);
  await expect(page.getByText("Add: Audio to speak.")).toBeVisible();
  await expect(generate(page)).toContainText("Add the audio to see the price");
  await page.getByLabel("Audio to speak").setInputFiles(audio);
  await expect(page.getByRole("button", { name: "Play line.wav" })).toBeVisible();
  await expect(page.locator(".slot-audio")).toContainText("0:02");
  // fal lists $0.10 per second in the fixture catalog; the clip is longer than the two-second line.
  await expect(generate(page)).toContainText(/Estimated \$\d+\.\d+ · \d+ s/);
  const label = (await generate(page).textContent()) ?? "";
  const [, usd, secs] = /\$(\d+\.\d+) · (\d+) s/.exec(label)!;
  expect(Number(secs)).toBeGreaterThanOrEqual(2);
  expect(Number(usd)).toBeCloseTo(Number(secs) * 0.1, 5);

  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.task).toBe("lipsync");
  expect(body.adapter).toBe("fal");
  expect((body.inputs as { role: string }[]).map((i) => i.role)).toEqual(["source-video", "source-audio"]);
  for (const key of ["prompt", "durationSec", "aspectRatio", "resolution", "vendorOptions"]) expect(body, key).not.toHaveProperty(key);
  const card = page.getByRole("article", { name: /sync\/sync-lipsync-3|Sync Lipsync 3/ }).first();
  await expect(card).toContainText("via fal");
  await expect(card.getByText("Done")).toBeVisible({ timeout: 15_000 });
  await expect(card.locator("video")).toBeVisible();
});

test("talking video: dubbing needs a language and sends it as the provider's option", async ({ page }) => {
  await page.goto("/#/video?mode=speak");
  await page.getByRole("button", { name: "Dubbing" }).click();
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("VEED Dubbing");
  await expect(page.getByText("Add: Video to dub.")).toBeVisible();
  await expect(page.getByLabel("Audio to speak")).toHaveCount(0);
  await page.getByLabel("Video to dub").setInputFiles(CLIP);
  // An English screen starts on English; the names are language names, the value sent is the provider's code.
  await page.getByRole("button", { name: "Dub into: English" }).click();
  await page.getByRole("button", { name: "Korean" }).click();
  await expect(generate(page)).toContainText(/Estimated \$/);
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.task).toBe("dubbing");
  expect(body.vendorOptions).toEqual({ target_language: "ko" });
  expect((body.inputs as { role: string }[]).map((i) => i.role)).toEqual(["source-video"]);
});

test("talking video: a model's Use link opens its tool with the model chosen, and the avatar form has a face and audio", async ({ page }) => {
  await page.goto("/#/models");
  await page.getByRole("searchbox").fill("VEED Fabric");
  await page.getByRole("article").filter({ hasText: "VEED Fabric 1.0" }).getByRole("link", { name: "Use this model" }).click();
  await expect(page).toHaveURL(/mode=speak/);
  await expect(page.getByRole("button", { name: "Avatar" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("VEED Fabric 1.0");
  await page.getByLabel("Face photo").setInputFiles(face);
  await page.getByLabel("Audio to speak").setInputFiles(audio);
  await expect(page.getByRole("button", { name: "Resolution: 480p" })).toBeVisible();
  // Two seconds of audio at $0.08.
  await expect(generate(page)).toContainText("Estimated $0.16 · 2 s");
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "avatar", resolution: "480p" });
  expect((body.inputs as { role: string }[]).map((i) => i.role)).toEqual(["source-image", "source-audio"]);
});

test("talking video: a model is run through the route that has a form, not the direct one that needs a session", async ({ page }) => {
  await page.goto("/#/video?mode=speak&model=kling%2Fkling-lipsync");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Kling Lip Sync");
  // One usable route: nothing to choose.
  await expect(page.getByRole("button", { name: /^Run through/ })).toHaveCount(0);
  await page.getByLabel("Video of the speaker").setInputFiles(CLIP);
  await page.getByLabel("Audio to speak").setInputFiles(audio);
  const request = submitted(page);
  await generate(page).click();
  expect(((await request).postDataJSON() as Record<string, unknown>).adapter).toBe("fal");
});

test("talking video: the tabs move between create, edit and talking, and Korean names every step", async ({ page }) => {
  await page.goto("/#/video?mode=speak");
  await page.getByRole("button", { name: "Edit video" }).click();
  await expect(page.getByLabel("Video to change")).toBeAttached();
  await page.getByRole("button", { name: "Talking video" }).click();
  await page.getByRole("button", { name: /Language/ }).click();
  await expect(page.getByRole("button", { name: "말하는 영상" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "립싱크" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("추가해 주세요: 말하는 사람 영상.")).toBeVisible();
  await page.getByRole("button", { name: "더빙" }).click();
  await expect(page.getByRole("button", { name: /^더빙할 언어: 한국어/ })).toBeVisible();
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});


test("talking video: without a key, the key form fits inside the panel", async ({ page }) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replaceAll('"hasKey":true', '"hasKey":false') });
  });
  await page.goto("/#/video?mode=speak");
  const notice = page.getByRole("region", { name: "Add a key to run this model" });
  await expect(notice).toBeVisible();
  const panel = (await page.locator("form.panel").boundingBox())!;
  // Each route chip shows its mark and then its name, with space between them.
  const chips = notice.locator(".chip-logo");
  expect(await chips.count()).toBeGreaterThan(1);
  for (const chip of await chips.all()) {
    const gap = await chip.evaluate((el) => {
      const logo = el.querySelector(".vendor-logo-box")!.getBoundingClientRect();
      const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim()).pop()!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const start = [...range.getClientRects()].find((r) => r.width > 0)!.left;
      return start - logo.right;
    });
    expect(gap, await chip.innerText()).toBeGreaterThanOrEqual(4);
  }
  for (const part of [notice, notice.getByLabel("API key"), notice.getByRole("button", { name: "Show" })]) {
    const box = (await part.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
  }
});

test("talking video: the price line's reason stays inside the Generate button, in English and Korean", async ({ page }) => {
  await page.goto("/#/video?mode=speak");
  for (const text of ["Add the video to see the price", "영상을 넣으면 가격이 계산돼요"]) {
    await expect(generate(page).or(page.getByRole("button", { name: /^생성/ }))).toContainText(text);
    const panel = (await page.locator("form.panel").boundingBox())!;
    const button = (await page.locator(".btn-generate").boundingBox())!;
    const cost = (await page.locator(".btn-generate .btn-cost").boundingBox())!;
    expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(cost.x + cost.width).toBeLessThanOrEqual(button.x + button.width);
    expect(cost.y + cost.height).toBeLessThanOrEqual(button.y + button.height);
    await page.getByRole("button", { name: /Language|언어/ }).click();
  }
});
