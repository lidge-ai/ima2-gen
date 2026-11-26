import { expect, test } from "@playwright/test";

test("home shows showcase clips; one opens Remix with its settings", async ({ page }) => {
  await page.goto("/#/");
  const showcase = page.getByRole("region", { name: "Made with ima2" });
  await expect(showcase.getByRole("article")).toHaveCount(2);
  const swap = showcase.getByRole("article", { name: "Swap the dancer" });
  await expect(swap).toContainText("About $0.76 when it was made");
  await expect(swap.getByRole("link", { name: "BytePlus ModelArk" })).toHaveAttribute("href", "#/keys?focus=byteplus");
  await swap.getByRole("button", { name: "Compare with source" }).click();
  await expect(swap.getByText("Source", { exact: true })).toBeVisible();
  await swap.getByRole("button", { name: "Make one like this" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap$/);
  await expect(page.getByLabel("What to replace")).toHaveValue("the dancer");
});

test("no showcase items hides the section", async ({ page }) => {
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Models from" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Made with ima2" })).toHaveCount(0);
});

test("a subscription clip names the sign-in, not a key, and its zero cost as included", async ({ page }) => {
  const item = (id: string, keys: string[], usd: number) => ({
    id,
    title: { en: id },
    workflow: "remix-object-swap",
    result: "/generated/showcase-swap-result.mp4",
    models: [],
    keys,
    estimate: { usd },
  });
  const items = [item("restyle-grok", ["xai-oauth"], 0), item("swap-mixed", ["openai-oauth", "byteplus"], 1.39)];
  for (let i = 0; i < 8; i += 1) items.push(item("filler-" + i, [], 0.5));
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items } }));
  await page.goto("/#/");
  const showcase = page.getByRole("region", { name: "Made with ima2" });
  await expect(showcase.getByRole("article")).toHaveCount(8);
  await expect(showcase.getByRole("link", { name: "All 10 clips" })).toHaveAttribute("href", "#/remix");
  const grok = showcase.getByRole("article", { name: "restyle-grok" });
  await expect(grok).toContainText("Included in the Grok subscription");
  await expect(grok).toContainText("Uses your Grok sign-in");
  await expect(grok.getByRole("link")).toHaveCount(0);
  const mixed = showcase.getByRole("article", { name: "swap-mixed" });
  await expect(mixed).toContainText("About $1.39 when it was made");
  await expect(mixed).toContainText("Uses your ChatGPT sign-in");
  await expect(mixed.getByRole("link", { name: "BytePlus ModelArk" })).toBeVisible();
  await expect(mixed.getByRole("link", { name: /oauth/ })).toHaveCount(0);
});

