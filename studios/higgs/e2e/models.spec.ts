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
    .getByRole("link", { name: /Open and add a key|Use this model/ })
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
