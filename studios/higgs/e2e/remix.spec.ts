import { test, expect } from "@playwright/test";

test("remix switches modes and subscription variants", async ({ page }) => {
  await page.goto("/#/remix/remix-motion-transfer");
  await expect(page.getByRole("heading", { name: "Remix: motion transfer", exact: true })).toBeVisible();
  await expect(page.getByText(/4-15 second clip/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reference images", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Object swap" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap$/);
  await expect(page.getByLabel("What to replace")).toBeVisible();
  await page.getByRole("link", { name: "Subscription" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap-subscription$/);
  await expect(page.getByText("Pinned keyframes")).toBeVisible();
  await page.getByRole("link", { name: "Restyle" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-restyle-subscription$/);
  await page.getByRole("navigation", { name: "Run on" }).getByRole("link", { name: "API keys", exact: true }).click();
  await expect(page.getByRole("button", { name: "Style reference" })).toBeVisible();
  await page.getByRole("switch", { name: "Prompt" }).check();
  await page.getByLabel("Notes").fill("A soft watercolor look");
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("No remix results yet")).toBeVisible();
});

test("restyle accepts the real source and style reference fields", async ({ page }) => {
  await page.goto("/#/remix/remix-restyle");
  // The first visit starts from an example clip; replace it with the person's own source.
  await page.getByRole("button", { name: "Remove Source video" }).click();
  await page.getByLabel("Source video", { exact: true }).setInputFiles({
    name: "source.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("sample"),
  });
  await page.getByLabel("Style reference", { exact: true }).setInputFiles({
    name: "style.png",
    mimeType: "image/png",
    buffer: Buffer.from("sample"),
  });
  await expect(page.getByRole("button", { name: "Remove Source video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Style reference" })).toBeVisible();
  await expect(page.getByText("Steps and estimated cost")).toBeVisible();
});

/** What a shared web instance reports at /api/web/session; a local server has no such route. */
const webSession = (spend: { spentUsd?: number; dailyCapUsd?: number; requestCapUsd?: number }) => ({
  email: "member@example.com",
  spend: { day: "2026-11-27", spentUsd: 0, dailyCapUsd: 20, requestCapUsd: 5, ...spend },
});

test("on a shared web server, an unpriced step is named before Generate, and a refusal shows the server's reason", async ({ page }) => {
  await page.route("**/api/web/session", (route) => route.fulfill({ json: webSession({}) }));
  let unpriced = true;
  await page.route("**/api/workflows/remix-restyle/estimate", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (unpriced) {
      body.estimate.complete = false;
      body.estimate.steps[0].usd = null;
    }
    await route.fulfill({ response, json: body });
  });
  const refusal = "workflow:remix-restyle has no published price, so this shared instance does not run it.";
  await page.route("**/api/workflows/remix-restyle", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 403, json: { ok: false, code: "WEB_SPEND_UNPRICED", error: refusal, status: 403 } })
      : route.fallback(),
  );
  await page.goto("/#/remix/remix-restyle");
  const generate = page.getByRole("button", { name: /^Generate/ });
  await expect(page.getByText("This shared server runs only priced steps. No published price: “Restyle the first frame”.")).toBeVisible();
  await expect(generate).toBeDisabled();
  // Priced again (another style), the button opens; if the server still refuses, its reason is shown as sent.
  unpriced = false;
  await page.getByRole("button", { name: /^Style: / }).click();
  await page.getByRole("dialog", { name: "Style" }).getByRole("button", { name: "watercolor" }).click();
  await expect(page.getByText(/runs only priced steps/)).toHaveCount(0);
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
});

test("in Korean, Remix reads the server's Korean workflow text: name, field help, options and step names", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.goto("/#/remix/remix-object-swap");
  await expect(page.getByRole("heading", { name: "리믹스: 사물 바꾸기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^품질: / }).click();
  await expect(page.getByRole("dialog", { name: "품질" }).getByRole("button", { name: "표준" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("공연할 사람이나 사물 이미지 1~8장, 순서대로.").first()).toBeAttached();
  await expect(page.getByText("1-8 images of the people or things")).toHaveCount(0);
  await expect(page.getByText("Standard", { exact: true })).toHaveCount(0);
});
