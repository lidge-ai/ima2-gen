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

