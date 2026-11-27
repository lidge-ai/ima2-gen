import { test, expect, type Browser, type Page } from "@playwright/test";
import { openCreateScreen, openStaticApp, type StaticAppOptions } from "./fixtures/staticClassicApp";
import { mediaHistoryRow, type MediaFixture } from "./fixtures/mediaModels";

// Review fixes for the classic media surfaces: one place for a failure, plain words first, display
// names in the details window, a phone result bar with the main actions, and the cheapest key to add.

const dialog = (page: Page) => page.getByRole("dialog", { name: "Choose a model" });
const card = (page: Page) => page.locator("#right-panel-tab-settings .media-card");
const generate = (page: Page) => page.locator(".generate-btn:visible");

async function pick(page: Page, kind: "Image" | "Video", id: string): Promise<void> {
  await card(page).locator(".media-picker__open").first().click();
  await dialog(page).getByRole("group", { name: "Output" }).getByRole("button", { name: kind, exact: true }).click();
  await dialog(page).locator('.media-row[data-model="' + id + '"]').first().click();
  await expect(dialog(page)).toHaveCount(0);
}

function run(options: StaticAppOptions & { rows?: Record<string, unknown>[] }, body: (page: Page, media: MediaFixture) => Promise<void>) {
  return async ({ browser }: { browser: Browser }) => {
    const { rows, ...rest } = options;
    const app = await openStaticApp(browser, rows ? { ...rest, storage: { "ima2.selectedFilename": String(rows[0]!.filename), ...rest.storage } } : rest);
    if (rows) app.media.history.push(...rows);
    try {
      await openCreateScreen(app.page);
      await body(app.page, app.media);
      expect(app.unexpected).toEqual([]);
      expect(app.errors).toEqual([]);
    } finally { await app.close(); }
  };
}

test("L11-P1 a failed job is told once, in the card: plain words, the next step, and the provider's text folded away", run({}, async (page, media) => {
  await page.locator(".composer:visible .composer__textarea").fill("a paper boat");
  await pick(page, "Video", "bytedance/seedance-2.5");
  await generate(page).click();
  await expect.poll(() => media.submissions.length).toBe(1);
  await media.emit(page, "error", String(media.submissions[0]!.requestId), { code: "FAL_INSUFFICIENT_CREDIT", error: "Exhausted balance.", status: 402, category: "quota", retryable: false, adapter: "fal" });
  const failure = card(page).locator(".media-failure");
  await expect(failure).toContainText("The fal account is out of credit or quota.");
  await expect(page.locator(".toast")).toHaveCount(0);
  const details = failure.locator("details");
  await expect(details.locator("summary")).toHaveText("Details");
  await expect(details.getByText("FAL_INSUFFICIENT_CREDIT")).toBeHidden();
  await details.locator("summary").click();
  await expect(details.getByText("FAL_INSUFFICIENT_CREDIT")).toBeVisible();
  await expect(details).toContainText("Exhausted balance.");
  // Where the person pressed Generate, one line points at the reason.
  await expect(page.locator(".generate-row__media:visible")).toHaveText("Seedance 2.5 did not finish. The reason and what to do next are in the model settings.");
}));

test("L11-P2 a rejected key is said in plain words with the provider's answer under Details", run({}, async (page, media) => {
  await pick(page, "Video", "kling/kling-4.0");
  const entry = card(page).getByRole("region", { name: "Kling needs an API key" });
  media.keyVerdict = "reject";
  await entry.getByLabel("API key").fill("kling-key-wrong");
  await entry.getByRole("button", { name: "Check and save" }).click();
  const alert = entry.getByRole("alert");
  await expect(alert.locator("p").first()).toHaveText("Kling did not accept this key. Check it and try again.");
  await expect(alert.getByText("HTTP 401")).toBeHidden();
  await alert.locator("summary").click();
  await expect(alert).toContainText("API key validation failed: HTTP 401: invalid api key");
}));

test("L11-P3 generation details name the provider and model as the catalog does, ids in small print", run({ rows: [mediaHistoryRow()] }, async (page) => {
  await page.locator(".result-actions:visible").first().getByRole("button", { name: "Info", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Generation Details" });
  await expect(details.locator(".metadata-modal__summary")).toContainText("fal · FLUX.2 Pro");
  const model = details.locator(".metadata-modal__row", { hasText: "Model" }).first();
  await expect(model.locator(".metadata-modal__name")).toHaveText("FLUX.2 Pro");
  await expect(model.locator("small")).toHaveText("black-forest-labs/flux-2-pro");
  await expect(model.locator(".media-mark")).toHaveCount(1);
  await expect(details.locator(".metadata-modal__row", { hasText: "Provider" }).first().locator(".media-mark")).toHaveCount(1);
}));

test("L11-P3b the details window is Korean in Korean", run({ rows: [mediaHistoryRow()], locale: "ko" }, async (page) => {
  await page.locator(".result-actions:visible").first().getByRole("button", { name: "정보", exact: true }).click();
  const details = page.getByRole("dialog", { name: "생성 세부 정보" });
  for (const text of ["제공자와 모델", "제공자", "요청 ID"]) await expect(details).toContainText(text);
  for (const text of ["PROVIDER & MODEL", "Provider", "Request ID"]) await expect(details.locator(".metadata-modal__body dt, .metadata-modal__body h4").filter({ hasText: text })).toHaveCount(0);
}));

test("L11-P4 on a phone the result bar shows the main actions, the rest behind More, clear of the tab bar", run({ rows: [mediaHistoryRow()], viewport: { width: 390, height: 844 } }, async (page) => {
  const bar = page.locator(".result-actions:visible").first();
  const shown = () => bar.locator(":scope > button:visible, :scope > details:visible").evaluateAll((items) => items.map((item) => (item.textContent ?? "").trim()));
  await expect.poll(shown).toEqual(["Download", "Continue here", "Make again", "More actions"]);
  const remake = bar.getByRole("button", { name: "Make again", exact: true });
  await remake.scrollIntoViewIfNeeded();
  // Nothing sits on top of it: the centre of the button is the button.
  expect(await remake.evaluate((button) => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })).toBe(true);
  const more = bar.getByRole("button", { name: "More actions", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(bar.getByRole("button", { name: "Info", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Fewer actions", exact: true })).toHaveAttribute("aria-expanded", "true");
  // Opened, the last row can still be brought clear of the tab bar.
  const last = bar.locator(":scope > button:visible, :scope > details:visible summary").last();
  await last.scrollIntoViewIfNeeded();
  expect(await last.evaluate((button) => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })).toBe(true);
}));

test("L11-P5 with no key anywhere, Automatic offers the cheapest route's key entry", run({ keys: [] }, async (page) => {
  await pick(page, "Video", "bytedance/seedance-2.5");
  await expect(card(page).getByRole("region", { name: "BytePlus ModelArk needs an API key" })).toBeVisible();
  // The extra field is named in words, not by its config key.
  await expect(card(page).getByRole("region", { name: "BytePlus ModelArk needs an API key" }).getByLabel("Region", { exact: true })).toBeVisible();
  await card(page).getByRole("button", { name: "Cheapest route: Sume, from $0.098/s. Add its key instead" }).click();
  await expect(card(page).getByRole("region", { name: "Sume needs an API key" })).toBeVisible();
  await expect(card(page).getByRole("radio", { name: /^Sume/ })).toBeChecked();
}));
