import { expect, test } from "@playwright/test";

// The catalog and the key list come from the same endpoint in two requests. Home asked for a first key
// whenever the catalog had arrived and the key list had not, so a server with saved keys showed the prompt.
test("Home never asks for a first key while the saved keys are still loading", async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/media/catalog*", async (route) => {
    calls += 1;
    // The second request on start is the key list; hold it back.
    if (calls === 2) await held;
    await route.continue();
  });
  await page.goto("/#/");
  await expect(page.getByRole("link", { name: "Models and prices" })).toBeVisible();
  await expect(page.getByText("Add your first API key.")).toHaveCount(0);
  release();
  await expect(page.getByRole("link", { name: /^API keys 2/ })).toBeVisible();
  await expect(page.getByText("Add your first API key.")).toHaveCount(0);
});

test("Home asks for a first key once the key list says there is none", async ({ page }) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const body = await (await route.fetch()).json();
    for (const adapter of body.adapters) adapter.hasKey = false;
    for (const model of body.models) for (const r of model.routes) if (!r.keyless) r.hasKey = false;
    await route.fulfill({ json: body });
  });
  await page.goto("/#/");
  await expect(page.getByText("Add your first API key.")).toBeVisible();
});
