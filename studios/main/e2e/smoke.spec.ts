import { expect, test } from "@playwright/test";

test("create video, cancel, handle errors and configure a key", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("link", { name: /video/i }).first()).toBeVisible();
  await page.goto("/#/video");
  await expect(page.getByRole("button", { name: /Model: Seedance 2.5/ })).toBeVisible();
  const prompt = page.getByLabel("Prompt", { exact: true });
  const generate = page.getByRole("button", { name: /Generate/ });
  await prompt.fill("A moving cloud");
  await generate.click();
  const done = page.getByRole("article", { name: "Done: A moving cloud" });
  await expect(done).toBeVisible();
  await expect(done.locator("video[controls]")).toBeVisible();
  await expect(done.getByRole("link", { name: "Download" })).toBeVisible();
  await prompt.fill("Cancel this cloud");
  await generate.click();
  const pending = page.getByRole("article", { name: /(?:Queued|Generating): Cancel this cloud/ });
  await pending.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("article", { name: "Canceled: Cancel this cloud" })).toBeVisible();
  await prompt.fill("[fail:moderation] blocked cloud");
  await generate.click();
  await expect(
    page.getByText("The provider's safety filter blocked this request. Change the prompt or inputs."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Model: Seedance 2.5/ }).click();
  await page.getByRole("button", { name: /Veo 3.1 Fast/ }).click();
  await expect(page.getByText("Add a key to run this model")).toBeVisible();
  await expect(generate).toBeDisabled();
  // The key goes in on the same screen; the prompt typed before stays.
  await prompt.fill("Cloud after key setup");
  const notice = page.getByRole("region", { name: "Add a key to run this model" });
  await notice.getByLabel("API key").fill("fake-google-key");
  await notice.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("Add a key to run this model")).toHaveCount(0);
  await expect(prompt).toHaveValue("Cloud after key setup");
  await expect(generate).toBeEnabled();
  await page.goto("/#/assets/videos");
  await expect(page.getByRole("button", { name: "Open A moving cloud" })).toBeVisible();
});
