import { test, expect } from "./fixtures/appServer";
import { MODEL_TRIGGER, PROVIDER_TRIGGER, openCreate, preflightJ6, selectionScreenshot,
  selectionViewports, selectOption, withJ6 } from "./fixtures/j6Selection";

// Guard before the browser fixture launches; no local runtime fallback.
test.beforeAll(async ({}, info) => { await preflightJ6(info); });

test("J6-S1 a comfy workflow left in storage does not blank the GPT model label", async ({ browser }, info) => {
  await withJ6(browser, info, {
    provider: "oauth", imageModel: "gpt-5.6-luna",
    generationDefaults: { comfyVideoWorkflow: "wf-anim-1", comfyWorkflow: "wf-still-1" },
  }, async (page, capture, origin) => {
    await openCreate(page, origin);
    await expect(page.locator(PROVIDER_TRIGGER)).toContainText("GPT");
    const model = page.locator(MODEL_TRIGGER + " .ctl-select__value");
    await expect(model).toBeVisible();
    await expect(model).toHaveText("6l");
    expect(capture.requests).toEqual([]);
    await selectionScreenshot(page, info, "j6-s1-gpt-label");
    await selectionViewports(page, info, "replan027-j6-s1-gpt-label", { provider: "GPT", model: "6l" });
  });
});

test("J6-S2 leaving the comfy lane clears its selections and converges the model", async ({ browser }, info) => {
  await withJ6(browser, info, {
    provider: "comfy", imageModel: "gpt-5.6-luna",
    generationDefaults: { comfyVideoWorkflow: "wf-anim-1", comfyWorkflow: "wf-still-1" },
  }, async (page, capture, origin) => {
    await openCreate(page, origin);
    await selectOption(page, PROVIDER_TRIGGER, "GPT");
    await expect(page.locator(PROVIDER_TRIGGER)).toContainText("GPT");
    await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("6l");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}"));
    expect(stored.comfyVideoWorkflow).toBeNull();
    expect(stored.comfyWorkflow).toBeNull();
    await selectionScreenshot(page, info, "j6-s2-after-lane-exit");
    await selectOption(page, PROVIDER_TRIGGER, "ComfyUI");
    await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("wf-anim-1");
    await page.reload();
    await expect(page.locator(MODEL_TRIGGER + " .ctl-select__value")).toHaveText("wf-anim-1");
    expect(capture.requests).toEqual([]);
    await selectionScreenshot(page, info, "j6-s2-comfy-return");
    await page.setViewportSize({ width: 390, height: 844 });
    await selectionScreenshot(page, info, "j6-s2-comfy-return-narrow");
    await selectionViewports(page, info, "replan027-j6-s2-comfy-return", { provider: "ComfyUI", model: "wf-anim-1" });
    expect(capture.requests).toEqual([]);
  });
});

test("J6-S3 a comfy workflow the catalog no longer lists still names itself", async ({ browser }, info) => {
  await withJ6(browser, info, {
    provider: "comfy", imageModel: "gpt-5.6-luna",
    generationDefaults: { comfyVideoWorkflow: "wf-deleted-by-user" },
  }, async (page, capture, origin) => {
    await openCreate(page, origin);
    const model = page.locator(MODEL_TRIGGER + " .ctl-select__value");
    await expect(model).toBeVisible();
    await expect(model).not.toHaveText("");
    await expect(model).toHaveText("wf-deleted-by-user");
    await page.reload();
    await expect(model).toHaveText("wf-deleted-by-user");
    expect(capture.requests).toEqual([]);
    await selectionScreenshot(page, info, "j6-s3-unlisted-workflow");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(model).toHaveText("wf-deleted-by-user");
    await selectionScreenshot(page, info, "j6-s3-unlisted-workflow-narrow");
    await selectionViewports(page, info, "replan027-j6-s3-unlisted-workflow", { provider: "ComfyUI", model: "wf-deleted-by-user" });
    expect(capture.requests).toEqual([]);
  });
});
