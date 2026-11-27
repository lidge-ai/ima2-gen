import { expect, test } from "@playwright/test";

const unique = (label: string) => label + " " + Date.now().toString(36);

test("video: default keyed model, prompt, generate, progress, result with download", async ({ page }) => {
  await page.goto("/#/video");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Seedance 2.5");
  const generate = page.getByRole("button", { name: /Generate/ });
  await expect(generate).toBeDisabled();
  await expect(page.getByText("Write a prompt.")).toBeVisible();
  const prompt = unique("A paper boat in a rain gutter");
  await page.getByLabel("Prompt").fill(prompt);
  await expect(generate).toContainText("$0.30");
  await generate.click();
  const card = page.getByRole("article", { name: new RegExp(prompt) });
  await expect(card.getByText(/Queued|Generating/)).toBeVisible();
  await expect(card).toContainText("via fal");
  await expect(card.getByText("Done")).toBeVisible({ timeout: 15_000 });
  await expect(card.locator("video")).toBeVisible();
  await expect(card.getByRole("link", { name: "Download" })).toHaveAttribute("href", /\/(files|generated)\//);
  await expect(page.getByRole("button", { name: "Open " + prompt })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Open " + prompt }).click();
  const dialog = page.getByRole("dialog", { name: "Result" });
  await expect(dialog.locator(".lightbox-media video")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute("href", /\/(files|generated)\//);
});

test("video: cancel stops a running job", async ({ page }) => {
  await page.goto("/#/video");
  const prompt = unique("Slow orbit around a lighthouse");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: new RegExp(prompt) });
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByText("Canceled")).toBeVisible();
  await expect(card.getByRole("button", { name: "Cancel" })).toHaveCount(0);
});

test("video: provider failure shows a plain reason", async ({ page }) => {
  await page.goto("/#/video");
  const prompt = unique("[fail:moderation] crowd scene");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: new RegExp("Failed: .*crowd scene") });
  await expect(card.getByRole("alert")).toContainText("safety filter blocked this request");
  await expect(card.getByRole("alert")).toContainText("FAKE_MODERATION");
  // Each failure offers one next step; a blocked prompt goes back to the prompt.
  await card.getByRole("button", { name: "Edit the prompt" }).click();
  await expect(page.getByLabel("Prompt")).toBeFocused();
});

test("video: out of credit links to the provider; a rate limit puts the job back to send again", async ({ page }) => {
  await page.goto("/#/video");
  const generate = page.getByRole("button", { name: /Generate/ });
  const quota = unique("[fail:quota] harbor at dusk");
  await page.getByLabel("Prompt").fill(quota);
  await generate.click();
  const broke = page.getByRole("article", { name: new RegExp("Failed: .*harbor at dusk") });
  await expect(broke.getByRole("link", { name: /^Add credit at / })).toHaveAttribute("target", "_blank");
  // The reason survives a reload, when the card comes from the job list instead of the live event.
  await page.reload();
  await expect(broke.getByRole("link", { name: /^Add credit at / })).toBeVisible();
  await expect(broke.getByRole("alert")).toContainText("out of credit or quota");
  const rate = unique("[fail:rate-limit] tram in snow");
  await page.getByLabel("Prompt").fill(rate);
  await generate.click();
  const limited = page.getByRole("article", { name: new RegExp("Failed: .*tram in snow") });
  await expect(limited).toHaveCount(1);
  await page.getByLabel("Prompt").fill("something else");
  await limited.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue(rate);
  await expect(generate).toBeFocused();
  await generate.click();
  await expect(page.getByRole("article", { name: new RegExp("tram in snow") })).toHaveCount(2);
});

test("video: a model without any key asks for one and cannot run", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByRole("button", { name: /^Model: / }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await picker.getByLabel("Search models").fill("vidu");
  await expect(picker.getByText("Needs a key (add it after picking)")).toBeVisible();
  await expect(picker.getByText("Ready with your keys")).toHaveCount(0);
  await picker.getByRole("button", { name: /Vidu Q4/ }).click();
  await expect(page.getByText("Add a key to run this model")).toBeVisible();
  await expect(page.getByRole("link", { name: "All API keys" })).toHaveAttribute("href", "#/keys?focus=vidu");
  await page.getByLabel("Prompt").fill("anything");
  await expect(page.getByRole("button", { name: /Generate/ })).toBeDisabled();
  // Picked once, a keyless model is not promoted to Recent; it stays under "Needs a key".
  await page.getByRole("button", { name: /^Model: / }).click();
  await expect(picker.getByRole("list", { name: "Needs a key (add it after picking)" }).getByRole("button", { name: /Vidu Q4/ })).toBeVisible();
  await expect(picker.getByRole("list", { name: "Recent" }).getByRole("button", { name: /Vidu Q4/ })).toHaveCount(0);
});

test("video: choosing a route and settings changes the estimate", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByLabel("Prompt").fill("estimate check");
  const generate = page.getByRole("button", { name: /Generate/ });
  await page.getByRole("button", { name: /^Duration: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^10s/ }).click();
  await expect(generate).toContainText("$0.75");
  await page.getByRole("button", { name: /^Run through: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: /BytePlus ModelArk/ }).click();
  await expect(page.getByText("Add a key to run this model")).toBeVisible();
  await expect(generate).toBeDisabled();
});

test("video: a preset fills the prompt and shows on the card", async ({ page }) => {
  await page.goto("/#/video");
  await page.getByRole("button", { name: "Presets", exact: true }).first().click();
  await page.getByRole("button", { name: /Neon rain/ }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue(/neon reflections/);
  await expect(page.locator(".preset-feature")).toContainText("Neon rain");
});

test("image: dock generates an image that later opens in the viewer", async ({ page }) => {
  await page.goto("/#/image");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("GPT Image 2");
  const prompt = unique("A ceramic teapot on linen");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: new RegExp(prompt) });
  await expect(card.getByRole("img", { name: prompt })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole("button", { name: "Open " + prompt }).click();
  await expect(page.getByRole("dialog", { name: "Result" }).getByRole("img", { name: prompt })).toBeVisible();
});

test("video: on a shared web server, a run above the per-run limit is explained before sending", async ({ page }) => {
  await page.route("**/api/web/session", (route) =>
    route.fulfill({ json: { email: "member@example.com", spend: { day: "2026-11-27", spentUsd: 0, dailyCapUsd: 20, requestCapUsd: 0.1 } } }),
  );
  await page.goto("/#/video");
  await page.getByLabel("Prompt").fill("over the limit");
  await expect(page.getByText(/above this server's \$0\.10 limit per run/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate/ })).toBeDisabled();
});

test("a model being retired shows its plain name, with a 'Retiring soon' badge only in the picker", async ({ page }) => {
  await page.route("**/api/media/catalog*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const m of body.models) if (m.id === "openai/gpt-image-2") m.label = "GPT Image 2 (deprecated)";
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#/image?model=openai%2Fgpt-image-2");
  const chip = page.getByRole("button", { name: /^Model: / });
  await expect(chip).toHaveAccessibleName("Model: GPT Image 2");
  await chip.click();
  const row = page.getByRole("dialog", { name: "Choose a model" }).getByRole("button", { name: /GPT Image 2(?!\.)/ }).first();
  await expect(row).toContainText("Retiring soon");
  await expect(page.getByText("(deprecated)")).toHaveCount(0);
});
