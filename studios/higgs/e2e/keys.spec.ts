import { expect, test } from "@playwright/test";

test("save, search and remove a provider key", async ({ page }) => {
  await page.goto("/#/keys?focus=byteplus");
  const row = page.getByRole("article", { name: "BytePlus ModelArk" });
  await expect(row.getByRole("heading", { name: /BytePlus ModelArk/ })).toBeVisible();
  await expect(row.getByText("Seedance 2.5", { exact: true })).toBeVisible();
  const key = row.getByLabel("API key");
  await expect(key).toBeFocused();
  await expect(row.getByText("Not set")).toBeVisible();
  await key.fill("fake-byteplus-key");
  await row.getByLabel("region").fill("test-region");
  await row.getByRole("button", { name: "Show key" }).click();
  await expect(key).toHaveAttribute("type", "text");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row.getByText("Saved. The provider accepted the key.")).toBeVisible();
  await expect(key).toHaveValue("");
  await expect(row.getByText("Saved", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row.getByText("Key removed")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search providers" }).fill("replicate");
  await expect(page.getByRole("heading", { name: "Aggregators" })).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("environment keys explain why removal is disabled", async ({ page }) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.adapters = body.adapters.map((a: { keyVocabulary: string }) =>
      a.keyVocabulary === "openai" ? { ...a, hasKey: true, keySource: "env" } : a,
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#/keys?focus=openai");
  const row = page.getByRole("article", { name: "OpenAI API" });
  await expect(row.getByText("From environment")).toBeVisible();
  await expect(row.getByRole("button", { name: "Remove" })).toBeDisabled();
  await expect(row.getByText("Environment keys must be removed from the environment.")).toBeVisible();
});

test("a key the provider rejects is not saved and the reason is shown", async ({ page }) => {
  await page.goto("/#/keys?focus=vidu");
  const row = page.getByRole("article", { name: "Vidu API" });
  await row.getByLabel("API key").fill("rejected-by-provider");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row.getByText(/API key validation failed/)).toBeVisible();
  await expect(row.getByText("Not set")).toBeVisible();
});
