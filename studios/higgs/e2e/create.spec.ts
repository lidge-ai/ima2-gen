import { expect, test } from "@playwright/test";

const unique = (label: string) => label + " " + Date.now().toString(36);

test("video: default keyed model, prompt, generate, progress, result with download", async ({ page }) => {
  await page.goto("/#/video");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Seedance 2.5");
  const generate = page.getByRole("button", { name: /Generate/ });
  await expect(generate).toBeDisabled();
  await expect(page.getByText("Write a prompt.")).toBeVisible();
  const prompt = unique("A paper boat in a rain gutter");
  await page.getByLabel("Prompt").fill(prompt);
  await expect(generate).toContainText("$0.30");
  await generate.click();
  const card = page.getByRole("article", { name: new RegExp(prompt) });
  await expect(card.getByText(/Queued|Generating/)).toBeVisible();
  await expect(card).toContainText("via fal");
  await expect(card.getByText("Done")).toBeVisible({ timeout: 15_000 });
  await expect(card.locator("video")).toBeVisible();
  await expect(card.getByRole("link", { name: "Download" })).toHaveAttribute("href", /\/(files|generated)\//);
  await expect(page.getByRole("button", { name: "Open " + prompt })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Open " + prompt }).click();
  const dialog = page.getByRole("dialog", { name: "Result" });
  await expect(dialog.locator(".lightbox-media video")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute("href", /\/(files|generated)\//);
});

test("video: cancel stops a running job", async ({ page }) => {
  await page.goto("/#/video");
  const prompt = unique("Slow orbit around a lighthouse");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: new RegExp(prompt) });
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByText("Canceled")).toBeVisible();
  await expect(card.getByRole("button", { name: "Cancel" })).toHaveCount(0);
});

test("video: provider failure shows a plain reason", async ({ page }) => {
  await page.goto("/#/video");
  const prompt = unique("[fail:moderation] crowd scene");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: new RegExp("Failed: .*crowd scene") });
  await expect(card.getByRole("alert")).toContainText("safety filter blocked this request");
  await expect(card.getByRole("alert")).toContainText("FAKE_MODERATION");
});

test("video: a model without any key asks for one and cannot run", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByRole("button", { name: /^Model: / }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await picker.getByLabel("Search models").fill("vidu");
  await expect(picker.getByText("Needs a key (add it after picking)")).toBeVisible();
  await expect(picker.getByText("Ready with your keys")).toHaveCount(0);
  await picker.getByRole("button", { name: /Vidu Q4/ }).click();
  await expect(page.getByText("Add a key to run this model")).toBeVisible();
  await expect(page.getByRole("link", { name: "All API keys" })).toHaveAttribute("href", "#/keys?focus=vidu");
  await page.getByLabel("Prompt").fill("anything");
  await expect(page.getByRole("button", { name: /Generate/ })).toBeDisabled();
});

test("video: choosing a route and settings changes the estimate", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByLabel("Prompt").fill("estimate check");
  const generate = page.getByRole("button", { name: /Generate/ });
  await page.getByRole("button", { name: /^Duration: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^10s/ }).click();
  await expect(generate).toContainText("$0.75");
  await page.getByRole("button", { name: /^Run through: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: /BytePlus ModelArk/ }).click();
  await expect(page.getByText("Add a key to run this model")).toBeVisible();
  await expect(generate).toBeDisabled();
});

test("video: a preset fills the prompt and shows on the card", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByRole("button", { name: "Presets", exact: true }).first().click();
  await page.getByRole("button", { name: /Neon rain/ }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue(/neon reflections/);
  await expect(page.locator(".preset-feature")).toContainText("Neon rain");
});

test("image: dock generates an image that later opens in the viewer", async ({ page }) => {
  await page.goto("/#/image");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("GPT Image 2");
  const prompt = unique("A ceramic teapot on linen");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: new RegExp(prompt) });
  await expect(card.getByRole("img", { name: prompt })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole("button", { name: "Open " + prompt }).click();
  await expect(page.getByRole("dialog", { name: "Result" }).getByRole("img", { name: prompt })).toBeVisible();
});
