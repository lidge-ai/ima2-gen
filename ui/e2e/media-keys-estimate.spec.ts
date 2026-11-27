import { test, expect, type Browser, type Page } from "@playwright/test";
import { MODEL_CONTROL, openCreateScreen, openStaticApp, type StaticAppOptions } from "./fixtures/staticClassicApp";
import type { MediaFixture } from "./fixtures/mediaModels";

// Keys, the estimate and failures for media models in the classic studio.
// The built UI runs on a synthetic origin with fixture answers only: no app server, no provider.

const PROMPT = "a paper boat on a rainy street";
const dialog = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });
const card = (page: Page) => page.locator("#right-panel-tab-settings .media-card");
const composer = (page: Page) => page.locator(".composer:visible .composer__textarea");
const generate = (page: Page) => page.locator(".generate-btn:visible");
const hint = (page: Page) => page.locator(".generate-row__media:visible");

async function pick(page: Page, kind: "Image" | "Video", id: string): Promise<void> {
  await card(page).locator(".media-picker__open").first().click();
  await dialog(page).getByRole("group", { name: "Output" }).getByRole("button", { name: kind, exact: true }).click();
  await dialog(page).locator('.media-row[data-model="' + id + '"]').first().click();
  await expect(dialog(page)).toHaveCount(0);
}

function run(options: StaticAppOptions, body: (page: Page, media: MediaFixture) => Promise<void>) {
  return async ({ browser }: { browser: Browser }) => {
    const app = await openStaticApp(browser, options);
    try {
      await openCreateScreen(app.page);
      await composer(app.page).fill(PROMPT);
      await body(app.page, app.media);
      expect(app.unexpected).toEqual([]);
      expect(app.errors).toEqual([]);
    } finally { await app.close(); }
  };
}

const keyWrites = (media: MediaFixture) => media.calls.filter((call) => call.path.startsWith("/api/keys/")).map((call) => call.method + " " + call.path);

test("L11-K1 a key is entered beside the model, checked before it is saved, and the prompt stays", run({}, async (page, media) => {
  await pick(page, "Video", "kling/kling-4.0");
  const entry = card(page).getByRole("region", { name: "Kling needs an API key" });
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("link", { name: /Get a key at Kling/ })).toHaveAttribute("href", "https://example.com/keys/kling");
  await expect(entry).toContainText("ChatGPT and Grok sign-in models need no key.");
  await expect(generate(page)).toHaveAttribute("aria-disabled", "true");
  await expect(hint(page)).toHaveText("Add a Kling API key to generate.");
  // The button is aria-disabled, not disabled: it stays reachable so its reason is read out, and pressing it does nothing.
  await generate(page).click({ force: true });
  expect(media.submissions).toEqual([]);

  media.keyVerdict = "reject";
  await entry.getByLabel("API key").fill("kling-key-wrong");
  await entry.getByRole("button", { name: "Check and save" }).click();
  await expect(entry.getByRole("alert")).toContainText("Kling did not accept this key.");
  expect(keyWrites(media)).toEqual(["POST /api/keys/kling/validate"]);

  media.keyVerdict = "ok";
  await entry.getByLabel("API key").fill("kling-key-right");
  await entry.getByLabel("API key").press("Enter");
  await expect(page.locator(".toast")).toContainText("Kling key saved. You can generate now.");
  await expect(entry).toHaveCount(0);
  expect(keyWrites(media)).toEqual(["POST /api/keys/kling/validate", "POST /api/keys/kling/validate", "PUT /api/keys/kling"]);
  await expect(generate(page)).not.toHaveAttribute("aria-disabled", "true");
  await expect(composer(page)).toHaveValue(PROMPT);
  await expect(card(page)).toContainText("Now: Kling");
  // The sidebar names the provider as the catalog does, with its mark, not by an internal id.
  const lane = page.locator("#sidebar-generation-provider:visible");
  await expect(lane).toContainText("Kling");
  await expect(lane.locator(".media-mark")).toHaveCount(1);
}));

test("L11-K2 the estimate follows the settings and is confirmed by the server for the route that runs", run({}, async (page, media) => {
  await pick(page, "Video", "bytedance/seedance-2.5");
  const estimate = card(page).locator(".media-estimate");
  await expect(estimate).toContainText("$2.37");
  // The line a person reads is the sum; the price-list row it came from is one press away.
  await expect(estimate.locator("small")).toHaveText("5 s × $0.473/s");
  const basis = estimate.locator("details");
  await expect(basis.locator("p")).toBeHidden();
  await basis.getByText("Price basis", { exact: true }).click();
  await expect(basis.locator("p")).toHaveText("text-to-video:720p");
  await expect(hint(page)).toHaveText("Seedance 2.5 · est. $2.37");
  const estimates = () => media.calls.filter((call) => call.path === "/api/media/estimate").map((call) => call.body?.priceVariant);
  await expect.poll(estimates).toEqual(["text-to-video:720p"]);
  await card(page).getByRole("button", { name: "480p", exact: true }).click();
  await expect(estimate).toContainText("$1.11");
  await expect(hint(page)).toHaveText("Seedance 2.5 · est. $1.11");
  await expect.poll(estimates).toEqual(["text-to-video:720p", "text-to-video:480p"]);
  expect(media.calls.find((call) => call.path === "/api/media/estimate")?.body).toMatchObject({ model: "bytedance/seedance-2.5", adapter: "fal", task: "text-to-video", durationSec: 5 });
  // A price list with tiers this screen does not set is shown as a range, not as one number.
  await pick(page, "Image", "openai/gpt-image-2.5");
  await expect(card(page).locator(".media-estimate")).toContainText("$0.011–$0.167");
  // No published price is said plainly.
  await pick(page, "Video", "pixverse/v6");
  await expect(card(page).locator(".media-estimate")).toContainText("No published price");
}));

test("L11-K3 images that do not fit the task hold Generate back with the reason", run({}, async (page, media) => {
  await pick(page, "Video", "bytedance/seedance-2.5");
  await card(page).getByRole("button", { name: "From an image", exact: true }).click();
  await expect(hint(page)).toHaveText("This task needs at least 1 image in the composer (now 0).");
  await expect(generate(page)).toHaveAttribute("aria-disabled", "true");
  // The button is aria-disabled, not disabled: it stays reachable so its reason is read out, and pressing it does nothing.
  await generate(page).click({ force: true });
  expect(media.submissions).toEqual([]);
  await card(page).getByRole("button", { name: "From text", exact: true }).click();
  await expect(generate(page)).not.toHaveAttribute("aria-disabled", "true");
}));

test("L11-K4 a failed job says what to do next, and the card survives a reload until dismissed", run({}, async (page, media) => {
  await pick(page, "Video", "bytedance/seedance-2.5");
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  await media.emit(page, "error", String(media.submissions[0]!.requestId), { code: "FAL_INSUFFICIENT_CREDIT", error: "balance empty", status: 402, category: "quota", retryable: false, adapter: "fal" });
  const failure = card(page).locator(".media-failure");
  await expect(failure).toContainText("Seedance 2.5 did not finish");
  await expect(failure).toContainText("The fal account is out of credit or quota. Billing and refunds follow fal's own policy.");
  await expect(failure).toContainText("FAL_INSUFFICIENT_CREDIT balance empty");
  await expect(failure.getByRole("link", { name: /Open fal/ })).toHaveAttribute("href", "https://example.com/keys/fal");
  await page.reload();
  await expect(card(page).locator(".media-failure")).toContainText("Seedance 2.5 did not finish");
  await card(page).locator(".media-failure").getByRole("button", { name: "Dismiss" }).click();
  await expect(card(page).locator(".media-failure")).toHaveCount(0);
  await page.reload();
  await expect(card(page)).toContainText("Seedance 2.5");
  await expect(card(page).locator(".media-failure")).toHaveCount(0);
}));

test("L11-K5 a retryable failure runs the same settings again; a rejected key opens its replacement", run({}, async (page, media) => {
  await pick(page, "Video", "bytedance/seedance-2.5");
  await card(page).getByRole("button", { name: "480p", exact: true }).click();
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  await media.emit(page, "error", String(media.submissions[0]!.requestId), { code: "FAL_RATE_LIMIT", error: "slow down", status: 429, category: "rate-limit", retryable: true, adapter: "fal" });
  const failure = card(page).locator(".media-failure");
  await failure.getByRole("button", { name: "Try again with the same settings" }).click();
  await expect.poll(() => media.submissions.length).toBe(2);
  const { requestId: first, ...sent } = media.submissions[0]!;
  const { requestId: second, ...again } = media.submissions[1]!;
  expect(again).toEqual(sent);
  expect(second).not.toBe(first);
  await expect(failure).toHaveCount(0);
  await media.emit(page, "error", String(second), { code: "FAL_AUTH", error: "invalid key", status: 401, category: "auth", retryable: false, adapter: "fal" });
  await expect(failure).toContainText("fal rejected the key.");
  await failure.getByRole("button", { name: "Replace the key" }).click();
  await expect(card(page).getByRole("region", { name: "Replace the fal key" })).toBeVisible();
}));

test("L11-K6 a model priced by quality offers the quality, quotes one price for it and sends it", run({}, async (page, media) => {
  await pick(page, "Image", "openai/gpt-image-2");
  const estimate = card(page).locator(".media-estimate");
  const quality = card(page).locator(".option-group", { has: page.getByText("Quality", { exact: true }) });
  await expect(quality.getByRole("button", { name: "Medium", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(estimate.locator(".price")).toHaveText("$0.053");
  await quality.getByRole("button", { name: "Low", exact: true }).click();
  await expect(estimate.locator(".price")).toHaveText("$0.006");
  await expect(hint(page)).toHaveText("GPT Image 2 · est. $0.006");
  await expect.poll(() => media.calls.filter((call) => call.path === "/api/media/estimate").at(-1)?.body).toMatchObject({ quality: "low", priceVariant: "1K · low" });
  await composer(page).fill("a paper boat");
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  expect(media.submissions[0]).toMatchObject({ model: "openai/gpt-image-2", quality: "low", resolution: "1K" });
  // The choice survives a reload with the rest of the settings.
  await page.reload();
  await expect(card(page).locator(".option-group", { has: page.getByText("Quality", { exact: true }) }).getByRole("button", { name: "Low", exact: true })).toHaveAttribute("aria-pressed", "true");
}));
