import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/appServer";
import { MODEL_TRIGGER, PROVIDER_TRIGGER, J6_WORKFLOWS, openCreate, preflightJ6, requestObject,
  composerMode, selectionScreenshot, selectionViewports, selectOption, withJ6, type J6Capture } from "./fixtures/j6Selection";

test.beforeAll(async ({}, info) => { await preflightJ6(info); });

async function assertSelection(page: Page, provider: string, model: string): Promise<void> {
  await expect(page.locator(PROVIDER_TRIGGER)).toContainText(provider);
  await expect(page.locator(`${MODEL_TRIGGER} .ctl-select__value`)).toHaveText(model);
}

async function submitSelection(page: Page, capture: J6Capture, origin: string,
  expected: { path: string; provider: string; model?: string }): Promise<void> {
  const before = capture.requests.length;
  await page.locator(".composer__textarea:visible").fill("WP02 synthetic selection fixture");
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url() === `${origin}${expected.path}`
      && response.request().method() === "POST" && response.status() === 202),
    page.getByRole("button", { name: "Generate", exact: true }).click(),
  ]);
  expect(capture.requests).toHaveLength(before + 1);
  const recorded = capture.requests[before];
  expect(recorded.path).toBe(expected.path);
  const payload = requestObject(recorded.body);
  expect(payload.provider).toBe(expected.provider);
  expect(payload.model).toBe(expected.model);
  expect(payload.async).toBe(true);
  expect(typeof payload.requestId).toBe("string");
  expect(await response.json()).toEqual({ requestId: payload.requestId });
  expect(capture.unexpected).toEqual([]);
}

test("WP02 Grok API survives true reload and another Grok image click", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "grok-api", imageModel: "grok-imagine-image-quality" },
    async (page, capture, origin) => {
      await openCreate(page, origin);
      await assertSelection(page, "xAI API", "grok+");
      await page.reload();
      await assertSelection(page, "xAI API", "grok+");
      await selectionScreenshot(page, info, "grok-api-reload");
      await page.setViewportSize({ width: 390, height: 844 });
      await assertSelection(page, "xAI API", "grok+");
      await selectionScreenshot(page, info, "grok-api-reload-narrow");
      await page.setViewportSize({ width: 1280, height: 800 });
      await selectionViewports(page, info, "replan027-grok-api-reload", { provider: "xAI API", model: "grok+" });
      await submitSelection(page, capture, origin, { path: "/api/generate", provider: "grok-api", model: "grok-imagine-image-quality" });
      await selectOption(page, MODEL_TRIGGER, "grok2");
      await assertSelection(page, "xAI API", "grok2");
      expect(await page.evaluate(() => localStorage.getItem("ima2.imageModel"))).toBe("grok-imagine-image-2.0");
      await page.reload();
      await assertSelection(page, "xAI API", "grok2");
      await submitSelection(page, capture, origin, { path: "/api/generate", provider: "grok-api", model: "grok-imagine-image-2.0" });
      expect(capture.requests.every(({ body }) => requestObject(body).provider === "grok-api")).toBe(true);
    });
});

test("WP02 Grok API video preview alias reloads and submits the canonical video id", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "grok-api", imageModel: "grok-imagine-image-quality",
    videoModel: "grok-imagine-video-1.5-preview" }, async (page, capture, origin) => {
    await openCreate(page, origin);
    await page.reload();
    await assertSelection(page, "xAI API", "grokv1.5");
    await submitSelection(page, capture, origin, { path: "/api/video/generate", provider: "grok-api", model: "grok-imagine-video-1.5" });
  });
});

test("WP02 missing Comfy image id survives empty, failed and offline catalogs", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "comfy", imageModel: "wf-missing" }, async (page, capture, origin) => {
    expect(J6_WORKFLOWS.image.some((row) => row.id === "wf-missing")).toBe(false);
    await openCreate(page, origin);
    await assertSelection(page, "ComfyUI", "wf-missing");
    for (const mode of ["empty", "error", "offline", "ready"] as const) {
      capture.catalog.mode = mode;
      const catalogResponse = page.waitForResponse((response) => response.url() === `${origin}/api/models`);
      await page.reload();
      await catalogResponse;
      await assertSelection(page, "ComfyUI", "wf-missing");
    }
    expect(capture.requests).toEqual([]);
    await selectionScreenshot(page, info, "missing-comfy-image");
    await page.setViewportSize({ width: 390, height: 844 });
    await assertSelection(page, "ComfyUI", "wf-missing");
    await selectionScreenshot(page, info, "missing-comfy-image-narrow");
    await page.setViewportSize({ width: 1280, height: 800 });
    await selectionViewports(page, info, "replan027-missing-comfy-image", { provider: "ComfyUI", model: "wf-missing" });
    await submitSelection(page, capture, origin, { path: "/api/generate", provider: "comfy", model: "wf-missing" });
  });
});

test("WP02 Comfy video to image, leave and return sends the selected image workflow", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "comfy", generationDefaults: {
    comfyWorkflow: "wf-first", comfyVideoWorkflow: "wf-video-selected", multimode: true,
  } }, async (page, capture, origin) => {
    await openCreate(page, origin);
    await assertSelection(page, "ComfyUI", "Selected video");
    await selectOption(page, MODEL_TRIGGER, "Selected image");
    await assertSelection(page, "ComfyUI", "Selected image");
    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}"));
    expect(stored.comfyWorkflow).toBe("wf-selected");
    expect(stored.comfyVideoWorkflow).toBeNull();
    expect(stored.multimode).toBe(true);
    await selectOption(page, PROVIDER_TRIGGER, "GPT");
    await assertSelection(page, "GPT", "6l");
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}"));
    expect(stored.comfyWorkflow).toBeNull();
    expect(stored.comfyVideoWorkflow).toBeNull();
    await selectOption(page, PROVIDER_TRIGGER, "ComfyUI");
    await assertSelection(page, "ComfyUI", "Selected image");
    await page.reload();
    await assertSelection(page, "ComfyUI", "Selected image");
    await selectionScreenshot(page, info, "comfy-image-return");
    await selectionViewports(page, info, "replan027-comfy-image", { provider: "ComfyUI", model: "Selected image", sequence: false });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}").multimode)).toBe(true);
    expect(capture.requests).toEqual([]);
    await submitSelection(page, capture, origin, { path: "/api/generate", provider: "comfy", model: "wf-selected" });
  });
});

test("WP02 Comfy video survives leave/return and bypasses saved multimode", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "comfy", generationDefaults: {
    comfyWorkflow: "wf-selected", multimode: true,
  } }, async (page, capture, origin) => {
    await openCreate(page, origin);
    await selectOption(page, MODEL_TRIGGER, "Selected video");
    await assertSelection(page, "ComfyUI", "Selected video");
    await selectOption(page, PROVIDER_TRIGGER, "GPT");
    await selectOption(page, PROVIDER_TRIGGER, "ComfyUI");
    await assertSelection(page, "ComfyUI", "Selected video");
    await page.reload();
    await assertSelection(page, "ComfyUI", "Selected video");
    await selectionScreenshot(page, info, "comfy-video-return");
    await selectionViewports(page, info, "replan027-comfy-video", { provider: "ComfyUI", model: "Selected video", sequence: false });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}").multimode)).toBe(true);
    expect(capture.requests).toEqual([]);
    await submitSelection(page, capture, origin, { path: "/api/video/generate", provider: "comfy", model: "wf-video-selected" });
    expect(capture.requests.map(({ path }) => path)).toEqual(["/api/video/generate"]);
  });
});

for (const positive of [
  { provider: "oauth", imageModel: "gpt-6-luna", label: "GPT", model: "6l" },
  { provider: "grok-api", imageModel: "grok-imagine-image-quality", label: "xAI API", model: "grok+" },
]) {
  test(`WP02 ${positive.provider} Sequence renders and survives Comfy switch-return without submission`, async ({ browser }, info) => {
    await withJ6(browser, info, { provider: positive.provider, imageModel: positive.imageModel, expectedSubmissions: 0,
      generationDefaults: { multimode: true, multimodeMaxImages: 4 } }, async (page, capture, origin) => {
      await openCreate(page, origin);
      const expected = { provider: positive.label, model: positive.model, sequence: true };
      await selectionViewports(page, info, `replan027-${positive.provider}-sequence`, expected);
      await selectOption(page, PROVIDER_TRIGGER, "ComfyUI");
      await selectOption(page, MODEL_TRIGGER, "Selected image");
      await assertSelection(page, "ComfyUI", "Selected image");
      await composerMode(page, info, `replan027-${positive.provider}-away`, false);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}").multimode)).toBe(true);
      await selectOption(page, PROVIDER_TRIGGER, positive.label);
      await assertSelection(page, positive.label, positive.model);
      await composerMode(page, info, `replan027-${positive.provider}-return`, true);
      await page.reload();
      await selectionViewports(page, info, `replan027-${positive.provider}-sequence-reload`, expected);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}").multimode)).toBe(true);
      // No Sequence endpoint allowance: both eligible lanes prove chrome only.
      expect(capture.requests).toEqual([]);
      expect(capture.unexpected).toEqual([]);
    });
  });
}

test("WP02 first visit to Comfy never auto-picks from a populated workflow catalog", async ({ browser }, info) => {
  await withJ6(browser, info, {}, async (page, capture, origin) => {
    await openCreate(page, origin);
    await selectOption(page, PROVIDER_TRIGGER, "ComfyUI");
    await expect(page.locator(MODEL_TRIGGER)).toContainText("Choose a model");
    await page.locator(MODEL_TRIGGER).click();
    await expect(page.getByRole("option", { name: "First image", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Selected image", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator(MODEL_TRIGGER)).toContainText("Choose a model");
    expect(capture.requests).toEqual([]);
    await submitSelection(page, capture, origin, { path: "/api/generate", provider: "comfy" });
    expect(requestObject(capture.requests[0].body)).not.toHaveProperty("model");
  });
});

test("WP02 same-origin second page storage event updates first-page lane and label", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "oauth", imageModel: "gpt-5.6-sol" }, async (page, capture, origin) => {
    await openCreate(page, origin);
    await assertSelection(page, "GPT", "6s");
    await page.locator(".composer__textarea:visible").fill("WP02 keep this dirty prompt");
    // Same guarded context, no re-seeding or direct calls to the store's sync action.
    const second = await page.context().newPage();
    await openCreate(second, origin);
    await assertSelection(second, "GPT", "6s");
    await second.evaluate(() => {
      localStorage.setItem("ima2.imageModel", "nano-banana-pro");
      localStorage.setItem("ima2.videoDefaults", JSON.stringify({ model: false }));
      localStorage.setItem("ima2.generationDefaults", JSON.stringify({ provider: "gemini-api", multimode: false }));
    });
    await assertSelection(page, "Gem API", "nbp api");
    await expect(page.locator(".composer__textarea:visible")).toHaveValue("WP02 keep this dirty prompt");
    await selectionScreenshot(page, info, "storage-event");
    expect(capture.requests).toEqual([]);
    await second.close();
    await submitSelection(page, capture, origin, { path: "/api/generate", provider: "gemini-api", model: "nano-banana-pro" });
  });
});
