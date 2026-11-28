import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
const unique = (label: string) => label + " " + Date.now().toString(36);
interface Row { filename: string; provider: string; prompt: string }

/** Makes one result through the API and returns its history row. */
async function made(request: APIRequestContext, data: Record<string, unknown>): Promise<Row> {
  expect((await request.post("/api/media", { data })).ok()).toBeTruthy();
  let row: Row | undefined;
  await expect.poll(async () => {
    row = ((await (await request.get("/api/history?includeAudio=1&q=" + encodeURIComponent(String(data.prompt)))).json()) as { items: Row[] }).items[0];
    return !!row;
  }, { timeout: 20_000 }).toBe(true);
  return row!;
}
const open = async (page: Page, tab: string, prompt: string) => {
  await page.goto("/#/assets/" + tab + "?q=" + encodeURIComponent(prompt));
  await page.getByRole("region", { name: "Assets results" }).getByRole("button", { name: "Open " + prompt }).click();
  return page.getByRole("dialog", { name: "Result" });
};

test("a video result's Same prompt and settings fills the video form with its length, shape, size, sound and route, and the next request carries them", async ({ page, request }) => {
  const prompt = unique("the harbor wakes");
  const row = await made(request, { model: "bytedance/seedance-2.5", task: "text-to-video", prompt, durationSec: 8, aspectRatio: "9:16", resolution: "1080p", audio: false, inputs: [] });
  const route = row.provider.replace(/^media:/, "");
  const dialog = await open(page, "videos", prompt);
  await dialog.getByRole("button", { name: "Same prompt and settings" }).click();
  await expect(page).toHaveURL(/#\/video\?model=bytedance%2Fseedance-2\.5/);
  await expect(page.getByLabel("Prompt")).toHaveValue(prompt);
  await expect(page.getByRole("button", { name: "Duration: 8s" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aspect ratio: 9:16" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolution: 1080p" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sound off" })).toBeVisible();
  // Nothing was made from input files, so nothing asks for them.
  await expect(page.getByText(/add (it|them) again/)).toHaveCount(0);
  const sent = submitted(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  expect({ durationSec: body.durationSec, aspectRatio: body.aspectRatio, resolution: body.resolution, audio: body.audio, adapter: body.adapter })
    .toEqual({ durationSec: 8, aspectRatio: "9:16", resolution: "1080p", audio: false, adapter: route });
});

test("the same action on the open video form fills it in place, and a result made from an input says the input must be added again", async ({ page, request }) => {
  const upload = (await (await request.post("/api/media/inputs", { data: PNG, headers: { "content-type": "image/png" } })).json()) as { ref: string };
  const prompt = unique("she turns to the window");
  await made(request, { model: "bytedance/seedance-2.5", task: "image-to-video", prompt, durationSec: 12, aspectRatio: "1:1", inputs: [{ role: "first-frame", ref: upload.ref }] });
  await page.goto("/#/video?model=bytedance%2Fseedance-2.5");
  await page.getByLabel("Prompt").fill("something else");
  await page.getByRole("button", { name: "Open " + prompt }).click();
  await page.getByRole("dialog", { name: "Result" }).getByRole("button", { name: "Same prompt and settings" }).click();
  await expect(page.getByRole("dialog", { name: "Result" })).toBeHidden();
  await expect(page.getByLabel("Prompt")).toHaveValue(prompt);
  await expect(page.getByRole("button", { name: "Duration: 12s" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aspect ratio: 1:1" })).toBeVisible();
  const note = page.getByRole("status").filter({ hasText: "The input file it used is not kept, so add it again." });
  await expect(note).toBeVisible();
  // It sits with the input slots, in view, not below the settings.
  await expect(note).toBeInViewport();
  // The note goes with the next change to the form.
  await page.getByLabel("Prompt").fill(prompt + ", slower");
  await expect(note).toHaveCount(0);
});

test("an image result's Same prompt and settings fills the image form with its shape, size and route", async ({ page, request }) => {
  const prompt = unique("a brass compass on a chart");
  const row = await made(request, { model: "openai/gpt-image-2", task: "text-to-image", prompt, aspectRatio: "3:2", resolution: "2K", inputs: [] });
  const dialog = await open(page, "images", prompt);
  await dialog.getByRole("button", { name: "Same prompt and settings" }).click();
  await expect(page).toHaveURL(/#\/image\?model=openai%2Fgpt-image-2/);
  await expect(page.getByLabel("Prompt")).toHaveValue(prompt);
  const sent = submitted(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  expect({ aspectRatio: body.aspectRatio, resolution: String(body.resolution).toUpperCase(), adapter: body.adapter })
    .toEqual({ aspectRatio: "3:2", resolution: "2K", adapter: row.provider.replace(/^media:/, "") });
});

test("an image result goes to the video form as the end frame or as a reference by its saved path, and a model that takes none says so", async ({ page, request }) => {
  const prompt = unique("a lighthouse at dusk");
  const row = await made(request, { model: "openai/gpt-image-2", task: "text-to-image", prompt, inputs: [] });
  let uploads = 0;
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/media/inputs") uploads += 1; });

  let dialog = await open(page, "images", prompt);
  await dialog.getByRole("button", { name: "Use in video" }).click();
  // The menu sits right under its button, inside the result's dialog.
  const button = (await dialog.getByRole("button", { name: "Use in video" }).boundingBox())!;
  const menu = (await page.getByRole("dialog", { name: "Use in video" }).boundingBox())!;
  const frame = (await dialog.boundingBox())!;
  expect({ dx: Math.round(Math.abs(menu.x - button.x)), dy: Math.round(menu.y - (button.y + button.height)) }).toEqual({ dx: 0, dy: 6 });
  expect(menu.x >= frame.x && menu.y + menu.height <= frame.y + frame.height, "the menu is inside the result's dialog").toBe(true);
  await page.getByRole("dialog", { name: "Use in video" }).getByRole("button", { name: "End frame", exact: true }).click();
  await expect(page).toHaveURL(/#\/video/);
  await expect(page.getByRole("button", { name: /^Remove End frame/ })).toBeVisible();
  // With no start frame the form says what the request will be.
  await expect(page.getByRole("status").filter({ hasText: "Add a start frame too" })).toBeInViewport();
  await page.getByLabel("Prompt").fill("the light comes on");
  let sent = submitted(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  let body = (await sent).postDataJSON() as { inputs: Record<string, unknown>[] };
  expect(body.inputs).toEqual([{ role: "last-frame", filename: row.filename }]);

  dialog = await open(page, "images", prompt);
  await dialog.getByRole("button", { name: "Use in video" }).click();
  await page.getByRole("dialog", { name: "Use in video" }).getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page.getByRole("button", { name: "References", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Remove Reference 1/ })).toBeVisible();
  await page.getByLabel("Prompt").fill("the keeper climbs the stairs");
  sent = submitted(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  body = (await sent).postDataJSON() as { inputs: Record<string, unknown>[] };
  expect(body.inputs).toEqual([{ role: "reference-image", filename: row.filename }]);
  expect(uploads, "the saved file was used where it is").toBe(0);

  // A model with no reference task keeps what it has and says why. The result is sent the way the lightbox sends it.
  await page.goto("/#/video?model=kling%2Fkling-3");
  // A reload, so the form opens on the model in the address instead of keeping the one it had.
  await page.reload();
  await expect(page.getByRole("button", { name: /Kling Video v3 Pro/ }).first()).toBeVisible();
  await page.evaluate((path) => {
    sessionStorage.setItem("ima2-studio-handoff", JSON.stringify({ url: "/generated/" + path, mimeType: "image/png", name: "lighthouse", target: "video", values: { slot: "reference" }, path }));
    window.dispatchEvent(new CustomEvent("ima2-handoff", { detail: { handled: false } }));
  }, row.filename);
  // The reason sits under the input slots, in view, and offers the next step.
  const refusal = page.getByRole("alert").filter({ hasText: "takes no reference images" });
  await expect(refusal).toBeInViewport();
  await refusal.getByRole("button", { name: "Choose a model" }).click();
  // The model list opens, where models that take references say so.
  await expect(page.getByRole("dialog").getByRole("button", { name: /· References/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Remove Reference/ })).toHaveCount(0);
});
