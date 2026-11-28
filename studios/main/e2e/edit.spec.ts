import { expect, test, type Page, type Request } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));
const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
const generate = (page: Page) => page.getByRole("button", { name: /Generate/ });
const tool = (page: Page, name: string) => page.getByRole("group", { name: "Tool" }).getByRole("button", { name, exact: true });
const key = (page: Page, provider: string, method: "PUT" | "DELETE") =>
  page.request.fetch("/api/keys/" + provider, { method, ...(method === "PUT" ? { data: { apiKey: "edit-spec-key" } } : {}) });
const unsent = ["negativePrompt", "seed", "vendorOptions", "count"];

test("edit video: a model is not sent to a keyed route that only creates; the route that edits asks for its key", async ({ page }) => {
  await page.goto("/#/video?mode=edit&model=bytedance%2Fseedance-2");
  await expect(tool(page, "Change")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Seedance 2.0");
  // fal has a key and serves this model, but only to create. BytePlus edits and has no key yet.
  const notice = page.getByRole("region", { name: "Add a key to run this model" });
  await expect(notice).toContainText("BytePlus ModelArk");
  await expect(notice).not.toContainText("fal");
  await expect(generate(page)).toBeDisabled();
  await key(page, "byteplus", "PUT");
  try {
    await page.reload();
    await page.getByLabel("Video to change").setInputFiles(CLIP);
    await page.getByLabel(/^Prompt/).fill("make it snow");
    await expect(page.getByRole("button", { name: /^Length: / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Output size: / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Aspect ratio: / })).toBeVisible();
    await expect(generate(page)).toContainText(/Estimated \$\d+\.\d+ · \d+ s/);
    const request = submitted(page);
    await generate(page).click();
    const body = (await request).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ task: "video-to-video", adapter: "byteplus", prompt: "make it snow", audio: true });
    expect((body.inputs as { role: string }[]).map((i) => i.role)).toEqual(["source-video"]);
    for (const name of ["durationSec", "resolution", "aspectRatio"]) expect(body, name).toHaveProperty(name);
    for (const name of unsent) expect(body, name).not.toHaveProperty(name);
    await expect(page.getByRole("article").filter({ hasText: "Seedance 2.0" }).first().getByText("Done")).toBeVisible({ timeout: 15_000 });
  } finally {
    await key(page, "byteplus", "DELETE");
  }
});

test("edit video: an edit that follows its source sends only the prompt, and an extension only the added length", async ({ page }) => {
  await key(page, "xai", "PUT");
  try {
    await page.goto("/#/video?mode=edit&model=xai%2Fgrok-imagine-video");
    await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Grok Imagine Video");
    await expect(page.getByText("Length, size and sound follow the source video.")).toBeVisible();
    for (const name of [/^Length: /, /^Output size: /, /^Aspect ratio: /, /^Sound o/]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByText("Add the video.")).toBeVisible();
    await expect(generate(page)).toContainText("Add the video to see the price");
    await page.getByLabel("Video to change").setInputFiles(CLIP);
    await expect(page.getByText("Write what to do.")).toBeVisible();
    await expect(generate(page)).toBeDisabled();
    await page.getByLabel(/^Prompt/).fill("turn day into night");
    // The fixture lists $0.05 per second; the price follows the clip's own length.
    await expect(generate(page)).toContainText(/Estimated \$\d+\.\d+ · \d+ s/);
    const [, usd, secs] = /\$(\d+\.\d+) · (\d+) s/.exec((await generate(page).textContent()) ?? "")!;
    expect(Number(usd)).toBeCloseTo(Number(secs) * 0.05, 5);
    let request = submitted(page);
    await generate(page).click();
    let body = (await request).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ task: "video-to-video", adapter: "xai", prompt: "turn day into night" });
    for (const name of ["durationSec", "resolution", "aspectRatio", "audio", ...unsent]) expect(body, name).not.toHaveProperty(name);

    // The clip and the prompt stay when the tool changes.
    await tool(page, "Extend").click();
    await expect(page.getByRole("button", { name: /^Remove Video to extend/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Added length: / })).toBeVisible();
    await expect(page.getByText("Length, size and sound follow the source video.")).toHaveCount(0);
    request = submitted(page);
    await generate(page).click();
    body = (await request).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ task: "video-extend", adapter: "xai", prompt: "turn day into night" });
    expect(typeof body.durationSec).toBe("number");
    for (const name of ["resolution", "aspectRatio", "audio", ...unsent]) expect(body, name).not.toHaveProperty(name);
  } finally {
    await key(page, "xai", "DELETE");
  }
});

test("edit video: upscale has no prompt, offers the output size and prices the clip's length through the route that has a form", async ({ page }) => {
  await page.goto("/#/video?mode=edit");
  await tool(page, "Upscale").click();
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Topaz Video Upscale");
  await expect(page.getByLabel(/^Prompt/)).toHaveCount(0);
  // The direct route declares no form, so there is one way to run it and nothing to choose.
  await expect(page.getByRole("button", { name: /^Route: / })).toHaveCount(0);
  await expect(generate(page)).toContainText("Add the video to see the price");
  await page.getByLabel("Video to upscale").setInputFiles(CLIP);
  await expect(page.getByRole("button", { name: /^Output size: / })).toHaveAccessibleName("Output size: 1080p");
  await expect(generate(page)).toContainText(/Estimated \$\d+\.\d+ · \d+ s/);
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "video-upscale", adapter: "fal", resolution: "1080p" });
  for (const name of ["prompt", "durationSec", "aspectRatio", "audio", ...unsent]) expect(body, name).not.toHaveProperty(name);
  const card = page.getByRole("article").filter({ hasText: "Topaz Video Upscale" }).first();
  await expect(card.getByText("Done")).toBeVisible({ timeout: 15_000 });

  // "Extend" on that result brings the clip back with the tool chosen.
  await page.reload();
  await page.getByRole("button", { name: /^Open / }).first().click();
  const dialog = page.getByRole("dialog", { name: "Result" });
  await dialog.getByRole("button", { name: "Extend", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/video\?mode=edit/);
  await expect(tool(page, "Extend")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Remove Video to extend/ })).toBeVisible();
});

test("edit video: an upscaler's Use link opens the edit form, and Korean names every tool", async ({ page }) => {
  await page.goto("/#/models");
  await page.getByLabel("Search models").fill("Topaz Video");
  await page.getByRole("article").filter({ hasText: "Topaz Video Upscale" }).getByRole("link", { name: /Use this model|Add a key to use it/ }).click();
  await expect(page).toHaveURL(/#\/video\?.*mode=edit/);
  await expect(tool(page, "Upscale")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Language/ }).click();
  const tools = page.getByRole("group", { name: "도구" });
  for (const name of ["바꾸기", "연장", "업스케일"]) await expect(tools.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByText("같은 영상을 더 선명하고 크게 만들어요.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^생성/ })).toContainText("영상을 넣으면 가격이 계산돼요");
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});

test("edit video: a model no route here can edit is named instead of being swapped silently", async ({ page }) => {
  // Seedance 2.0 Mini lists an edit task, but none of its routes declares a form for it.
  await page.goto("/#/video?mode=edit&model=bytedance%2Fseedance-2-mini");
  await expect(page.getByRole("status").filter({ hasText: "Seedance 2.0 Mini has no route this form can run yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Model: / })).not.toContainText("Mini");
  await page.goto("about:blank");
  await page.goto("/#/video?mode=edit&model=xai%2Fgrok-imagine-video");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Grok Imagine Video");
  await expect(page.getByText("has no route this form can run yet")).toHaveCount(0);
});
