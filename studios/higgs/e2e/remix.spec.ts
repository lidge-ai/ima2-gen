import { test, expect } from "@playwright/test";

test("remix routes, inputs and history are usable", async ({ page }) => {
  await page.goto("/#/remix");
  await expect(
    page.getByRole("heading", { name: "Motion transfer" }),
  ).toBeVisible();
  await expect(page.getByText("4 to 30 seconds")).toBeVisible();
  await page.getByRole("button", { name: "Mood", exact: true }).click();
  await expect(page.getByRole("button", { name: /Neon rain/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Orbit/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Subject swap" }).click();
  await expect(page.getByLabel("What to replace")).toBeVisible();
  await page.getByRole("link", { name: "Restyle" }).click();
  await page.getByRole("switch", { name: "Prompt" }).check();
  await page.getByLabel("Direction").fill("A soft watercolor look");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("No remix results yet")).toBeVisible();
});

test("restyle uploads a source and runs a workflow", async ({ page }) => {
  await page.goto("/#/remix/remix-restyle");
  await page
    .getByLabel("Source video", { exact: true })
    .setInputFiles({
      name: "source.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("sample"),
    });
  await expect(
    page.getByRole("button", { name: "Remove Source video" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate/ })).toBeEnabled();
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Restyle a key frame").last()).toBeVisible();
  await expect(page.getByRole("button", { name: /Open/ }).first()).toBeVisible({
    timeout: 10000,
  });
});

test("a failed remix stays visible with its error", async ({ page }) => {
  await page.goto("/#/remix/remix-restyle");
  await page
    .getByLabel("Source video", { exact: true })
    .setInputFiles({
      name: "source.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("sample"),
    });
  await page.getByRole("switch", { name: "Prompt" }).check();
  await page.getByLabel("Direction").fill("[fail:quota]");
  await expect(page.getByRole("button", { name: /Generate/ })).toBeEnabled();
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByText("Simulated provider failure")).toBeVisible({
    timeout: 10000,
  });
});
