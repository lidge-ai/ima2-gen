import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => label + " " + Date.now().toString(36);

async function makeImage(page: Page, prompt: string) {
  await page.goto("/#/image");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("article", { name: new RegExp(prompt) }).getByRole("img", { name: prompt })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
}

test("a result opened on the Image screen fills that screen: same prompt and model, then Edit", async ({ page }) => {
  const prompt = unique("A brass compass on a sea chart");
  await makeImage(page, prompt);
  const dialog = page.getByRole("dialog", { name: "Result" });
  await page.getByLabel("Prompt").fill("something else");
  await page.getByRole("button", { name: "Open " + prompt }).click();
  await dialog.getByRole("button", { name: "Same prompt and model" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Prompt")).toHaveValue(prompt);

  await page.getByRole("button", { name: "Open " + prompt }).click();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".dock-attachment").getByRole("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove image" })).toBeVisible();
  await expect(page).toHaveURL(/#\/image\?model=/);
});

test("Animate on an image result opens Video with the image as the start frame", async ({ page }) => {
  const prompt = unique("A paper lantern at night");
  await makeImage(page, prompt);
  await page.getByRole("button", { name: "Open " + prompt }).click();
  await page.getByRole("dialog", { name: "Result" }).getByRole("button", { name: "Animate" }).click();
  await expect(page).toHaveURL(/#\/video/);
  await expect(page.getByRole("button", { name: /^Remove Start frame/ })).toBeVisible();
});

test("video settings list each length and size once, in order, under readable names", async ({ page }) => {
  await page.goto("/#/video");
  // The default stays the running route's first length, not the shortest one another route adds.
  await expect(page.getByRole("button", { name: /^Duration: / })).toHaveAccessibleName("Duration: 4s");
  await page.getByRole("button", { name: /^Duration: / }).click();
  await expect(page.getByRole("group", { name: "Duration" }).getByRole("button")).toHaveText([
    "1s", "2s", "3s", "4s", "5s", "8s", "10s", "12s", "15s",
  ]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Resolution: / }).click();
  await expect(page.getByRole("group", { name: "Resolution" }).getByRole("button")).toHaveText([
    "480p",
    "720p",
    "720p · upscaled",
    "1080p",
    "1080p · enhanced upscale · 60 fps",
  ]);
});

test("image sizes from two routes show once each", async ({ page }) => {
  await page.goto("/#/image");
  await page.getByRole("button", { name: /^Resolution: / }).click();
  await expect(page.getByRole("group", { name: "Resolution" }).getByRole("button")).toHaveText(["1K", "2K", "4K"]);
});
