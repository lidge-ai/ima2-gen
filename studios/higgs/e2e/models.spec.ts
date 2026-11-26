import { expect, test } from "@playwright/test";

test("models page shows makers, official names, routes and prices, and opens a model", async ({ page }) => {
  await page.goto("/#/models");
  await expect(page.getByRole("heading", { name: "Models and prices" })).toBeVisible();
  const seedance = page.getByRole("article", { name: "Seedance 2.5", exact: true });
  await expect(seedance.getByRole("list", { name: "Ways to run Seedance 2.5" }).getByRole("listitem")).toHaveCount(3);
  await expect(seedance).toContainText("BytePlus ModelArk");
  await expect(seedance).toContainText("$0.06/s");
  const kinds = page.getByRole("group", { name: "Kind" });
  await kinds.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByRole("article", { name: "Seedance 2.5", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "GPT Image 2", exact: true })).toBeVisible();
  await kinds.getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Search models").fill("veo 3.1 fast");
  await page
    .getByRole("article", { name: "Veo 3.1 Fast" })
    .getByRole("link", { name: /Add a key to use it|Use this model/ })
    .click();
  await expect(page).toHaveURL(/#\/video\?model=google%2Fveo-3.1-fast/);
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Veo 3.1 Fast");
});

test("every maker is shown by logo or by its official name", async ({ page }) => {
  await page.goto("/#/");
  const strip = page.getByRole("region", { name: "Models from" });
  await expect(strip.getByRole("link")).not.toHaveCount(0);
  for (const name of ["ByteDance", "Kling AI", "Google", "OpenAI"]) {
    await expect(strip.getByTitle(name)).toBeVisible();
  }
});

test("a long per-token price never runs into the key state, in Korean too", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const m of body.models)
      for (const r of m.routes) if (r.adapter === "byteplus") r.pricing = [{ unit: "1k-tokens", usd: 0.0057, source: "https://example.test", checkedAt: "2026-11-27" }];
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#/models");
  const lines = page.locator(".route-line");
  await expect(lines.first()).toBeVisible();
  const overlaps = await lines.evaluateAll((els) =>
    els.filter((el) => {
      const price = el.querySelector(".route-line-price")?.getBoundingClientRect();
      const key = el.querySelector(".key-state")?.getBoundingClientRect();
      return price && key && price.right > key.left - 4;
    }).length,
  );
  expect(overlaps).toBe(0);
  await expect(page.getByText(/$0.0057/1천 토큰/).first()).toBeVisible();
});
