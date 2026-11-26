import { test } from "@playwright/test";
import { join } from "node:path";
import { dir, record, shoot } from "./lib.ts";

// Classic UI media surfaces (MediaModelPicker, MediaProviderKeys) against a running ima2 server.
// Start one with an isolated config dir and a placeholder media key so routes show as ready:
//   IMA2_CONFIG_DIR=$(mktemp -d) FAL_KEY=audit-placeholder IMA2_PORT=3333 node bin/ima2.js serve
// No generation is submitted, so the placeholder key is never sent to a provider.
const URL = process.env.CLASSIC_URL;

test.skip(!URL, "CLASSIC_URL is not set");

for (const locale of (process.env.AUDIT_LOCALES ?? "en,ko").split(",")) {
  test("classic media surfaces " + locale, async ({ browser }) => {
    const context = await browser.newContext({ locale: locale === "ko" ? "ko-KR" : "en-US", deviceScaleFactor: 2 });
    await context.addInitScript((value) => localStorage.setItem("ima2.locale", value), locale);
    const page = await context.newPage();
    await page.goto(URL!);
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Escape");
    const open = page.getByRole("button", { name: /Media models|미디어 모델|媒體模型|媒体模型/ }).first();
    try {
      await open.click({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      await shoot(page, "classic__picker", locale, { widths: [1440, 390] });
      const group = page.locator(".option-group").filter({ has: page.locator(".media-logo") }).first();
      await group.screenshot({ path: join(dir(), "classic__picker-list__1440__" + locale + ".png") });
      const ready = group.locator("button.option-btn:not([disabled])").nth(1);
      if (await ready.count()) {
        await ready.click();
        await page.waitForTimeout(800);
        await shoot(page, "classic__picker-selected", locale, { widths: [1440, 390] });
      }
    } catch (err) {
      record({ cell: "classic__picker", locale, unreachable: String(err).slice(0, 300) });
    }
    try {
      await page.getByRole("button", { name: /settings|설정|設定|设置/i }).first().click({ timeout: 10_000 });
      await page.getByRole("button", { name: /media provider keys|미디어 제공자 키|媒體|媒体/i }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      await shoot(page, "classic__keys", locale, { widths: [1440, 390] });
    } catch (err) {
      record({ cell: "classic__keys", locale, unreachable: String(err).slice(0, 300) });
    }
    await context.close();
  });
}

