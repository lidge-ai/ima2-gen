import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/appServer";
import { MODEL_TRIGGER, PROVIDER_TRIGGER, openCreate, preflightJ6, requestObject,
  selectOption, withJ6, type J6Capture } from "./fixtures/j6Selection";

test.beforeAll(async ({}, info) => { await preflightJ6(info, "image25"); });

async function chooseTool(page: Page, label: string) {
  await page.getByRole("combobox", { name: "API image model", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function submit(page: Page, capture: J6Capture, origin: string) {
  await page.locator(".composer__textarea:visible").fill("Image25 selection fixture");
  await Promise.all([
    page.waitForResponse((response) => response.url() === `${origin}/api/generate`
      && response.request().method() === "POST" && response.status() === 202),
    page.getByRole("button", { name: "Generate", exact: true }).click(),
  ]);
  return requestObject(capture.requests.at(-1)!.body);
}

async function settings(page: Page) {
  const toggle = page.locator(".right-panel-toggle");
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await page.locator(".right-panel").getByRole("tab", { name: "Settings", exact: true }).click();
}

test("API image tool selection persists, submits separately and resets on default/OAuth", async ({ browser }, info) => {
  await withJ6(browser, info, { provider: "api", imageModel: "gpt-5.6-luna", expectedSubmissions: 2 },
    async (page, capture, origin) => {
      await openCreate(page, origin);
      await settings(page);
      const tool = page.getByRole("combobox", { name: "API image model", exact: true });
      await expect(tool).toContainText("Default (upstream)");
      await expect(page.getByRole("button", { name: "Maximum", exact: true })).toHaveCount(0);
      await chooseTool(page, "GPT Image2.5 Flare");
      await page.getByRole("button", { name: "Maximum", exact: true }).click();
      await page.reload();
      await settings(page);
      await expect(tool).toContainText("GPT Image2.5 Flare");
      await expect(page.getByRole("button", { name: "Maximum", exact: true })).toHaveClass(/active/);
      const qualityWidths = await page.locator(".quality-options-expanded .option-btn")
        .evaluateAll((buttons) => buttons.map((button) => ({
          content: button.scrollWidth, visible: button.clientWidth,
        })));
      expect(qualityWidths).toHaveLength(5);
      for (const width of qualityWidths) expect(width.content).toBeLessThanOrEqual(width.visible);
      await expect(page.locator(MODEL_TRIGGER)).toContainText("5.6l");
      await page.screenshot({ path: info.outputPath("wp02-image25-selected.png") });
      const api = await submit(page, capture, origin);
      expect(api.provider).toBe("api");
      expect(api.model).toBe("gpt-5.6-luna");
      expect(api.imageToolModel).toBe("gpt-image-2.5-flare");
      expect(api.quality).toBe("max");
      await chooseTool(page, "Default (upstream)");
      await expect(page.getByRole("button", { name: "Maximum", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ima2.generationDefaults")!).quality)).toBe("medium");
      await chooseTool(page, "GPT Image2.5 Sunburst");
      await page.getByRole("button", { name: "Extra high", exact: true }).click();
      await selectOption(page, PROVIDER_TRIGGER, "GPT");
      await expect(tool).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Extra high", exact: true })).toHaveCount(0);
      await page.reload();
      const oauth = await submit(page, capture, origin);
      expect(oauth.provider).toBe("oauth");
      expect(oauth.model).toBe("gpt-6-luna"); // GPT OAuth runs the legacy id on its GPT-6 tier
      expect(oauth).not.toHaveProperty("imageToolModel");
      expect(oauth.quality).toBe("medium");
      await selectOption(page, PROVIDER_TRIGGER, "GPT API");
      await settings(page);
      await expect(tool).toContainText("Default (upstream)");
      expect(capture.unexpected).toEqual([]);
    });
});
