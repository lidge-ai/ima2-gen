import { expect, test } from "@playwright/test";

test("save, validate, search and remove a provider key", async ({ page }) => {
  await page.goto("/#/keys?focus=byteplus");
  const row = page.getByRole("article", { name: "BytePlus ModelArk" });
  const key = row.getByLabel("API key");
  await expect(key).toBeFocused();
  await expect(row.getByText("Not set")).toBeVisible();
  await key.fill("fake-byteplus-key");
  await row.getByLabel("region").fill("test-region");
  await row.getByRole("button", { name: "Show key" }).click();
  await expect(key).toHaveAttribute("type", "text");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row.getByText("Saved and validated")).toBeVisible();
  await expect(key).toHaveValue("");
  await expect(row.getByText("Saved", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Test", exact: true }).click();
  await expect(row.getByText("Validation passed")).toBeVisible();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row.getByText("Key removed")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search providers" }).fill("replicate");
  await expect(page.getByRole("heading", { name: "Aggregators" })).toBeVisible();
  await expect(row).toHaveCount(0);
});
