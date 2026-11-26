import { test, expect } from "@playwright/test";

test("director changes workflow and runs a studio shot", async ({ page }) => {
  await page.goto("/#/director");
  await expect(page.getByRole("heading", { name: "Studio shot" })).toBeVisible();
  await page.getByLabel("Scene").fill("A person walks into a quiet room");
  await page.getByRole("button", { name: /^Genre:/ }).click();
  await page.getByRole("radio", { name: "Drama" }).click();
  await expect(page.getByRole("button", { name: /^Genre: Drama/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate/ })).toBeEnabled();
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByText("Compose the key frame").last()).toBeVisible();
  await expect(page.getByRole("button", { name: /Open/ }).first()).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("link", { name: "Cinema", exact: true }).click();
  await expect(page.getByLabel("Script")).toBeVisible();
  await expect(page.getByLabel("Shots")).toBeVisible();
});

test("director cast can be created and attached to a studio shot", async ({ page }) => {
  await page.goto("/#/director/director-cast");
  await page.getByLabel("Character", { exact: true }).fill("A traveler with a red coat");
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("button", { name: /Attach cast:/ }).first()).toBeVisible({ timeout: 10000 });
  await page.getByRole("link", { name: "Studio shot", exact: true }).click();
  await page
    .getByRole("button", { name: /Attach cast:/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Remove Cast 1" })).toBeVisible();
});
