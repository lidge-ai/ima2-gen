import { test, expect } from "@playwright/test";

test("remix switches modes and subscription variants", async ({ page }) => {
  await page.goto("/#/remix/remix-motion-transfer");
  await expect(page.getByRole("heading", { name: "Remix: motion transfer", exact: true })).toBeVisible();
  await expect(page.getByText(/4-15 second clip/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Reference images 1/ })).toBeVisible();
  await page.getByRole("link", { name: "Object swap" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap$/);
  await expect(page.getByLabel("What to replace")).toBeVisible();
  await page.getByRole("link", { name: "Subscription" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap-subscription$/);
  await expect(page.getByText("Pinned keyframes")).toBeVisible();
  await page.getByRole("link", { name: "Restyle" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-restyle-subscription$/);
  await page.getByRole("link", { name: "API keys" }).click();
  await expect(page.getByRole("button", { name: "Style reference" })).toBeVisible();
  await page.getByRole("switch", { name: "Prompt" }).check();
  await page.getByLabel("Notes").fill("A soft watercolor look");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("No remix results yet")).toBeVisible();
});

test("restyle accepts the real source and style reference fields", async ({ page }) => {
  await page.goto("/#/remix/remix-restyle");
  await page.getByLabel("Source video", { exact: true }).setInputFiles({
    name: "source.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("sample"),
  });
  await page.getByLabel("Style reference", { exact: true }).setInputFiles({
    name: "style.png",
    mimeType: "image/png",
    buffer: Buffer.from("sample"),
  });
  await expect(page.getByRole("button", { name: "Remove Source video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Style reference" })).toBeVisible();
  await expect(page.getByText("Steps and estimated cost")).toBeVisible();
});
