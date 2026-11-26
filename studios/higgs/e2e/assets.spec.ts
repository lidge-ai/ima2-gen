import { expect, test } from "@playwright/test";

test("asset filters, favorites and deletion", async ({ page, request }) => {
  const prompt = `asset ${Date.now()}`;
  const response = await request.post("/api/media", { data: { model: "bytedance/seedance-2.5", task: "text-to-video", prompt, inputs: [] } });
  expect(response.ok()).toBeTruthy();
  await expect.poll(async () => (await (await request.get("/api/media/history")).json()).items.some((item: { prompt: string }) => item.prompt === prompt)).toBeTruthy();
  await page.goto("/#/assets/videos");
  await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Open ${prompt}` }).click();
  const dialog = page.getByRole("dialog", { name: "Result" });
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saved" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: `Open ${prompt}` }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: `Open ${prompt}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Compact" }).click();
  await expect(page.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
});

test("history errors can be retried", async ({ page }) => {
  await page.goto("/#/assets/all");
  await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible();
  await page.route("**/api/media/history?*", (route) => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "History unavailable" } } }));
  await page.getByRole("link", { name: "Images", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("History unavailable");
  await page.unroute("**/api/media/history?*");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create an image" })).toBeVisible();
});
