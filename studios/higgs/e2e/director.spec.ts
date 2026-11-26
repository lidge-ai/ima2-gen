import { test, expect } from "@playwright/test";

test("director renders the real studio and cinema fields", async ({ page }) => {
  await page.goto("/#/director/director-studio");
  await expect(page.getByRole("heading", { name: "Director studio" })).toBeVisible();
  await page.getByLabel("Scene").fill("A person walks into a quiet room");
  await expect(page.getByLabel("Length (seconds)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Image references 1" })).toBeVisible();
  await page.getByRole("link", { name: "Director cinema" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scene reference" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Character reference" })).toBeVisible();
});

test("director cast can be created and attached to a studio shot", async ({ page }) => {
  await page.goto("/#/director/director-cast");
  await page.getByLabel("Prompt", { exact: true }).fill("A traveler with a red coat");
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("button", { name: /Attach cast:/ }).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("link", { name: "Director studio" }).click();
  await page
    .getByRole("button", { name: /Attach cast:/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Remove Image references 1" })).toBeVisible();
});
