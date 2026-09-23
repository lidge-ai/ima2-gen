import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, seedBrowser, startApp, test } from "./fixtures/appServer";

const NAME = "WP4 portable";

async function seedTemplate(page: Page): Promise<void> {
  await page.evaluate(async (name) => {
    const response = await fetch("/api/node-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        graph: {
          nodes: [
            { id: "a", type: "imageNode", position: { x: 0, y: 0 }, style: { backgroundImage: "url(https://attacker.example/x)" },
              data: { prompt: "a red kite", provider: "openai", serverNodeId: "srv-1", imageUrl: "/generated/a.png" } },
            { id: "b", type: "imageNode", position: { x: 360, y: 0 }, data: { prompt: "closer" } },
          ],
          edges: [{ id: "e", source: "a", target: "b" }],
        },
      }),
    });
    if (!response.ok) throw new Error(`template seed failed: ${response.status}`);
  }, NAME);
}

async function chooseFile(page: Page, name: string, contents: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog").getByRole("button", { name: "파일 가져오기", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(contents, "utf8") });
}

test("WP4 template export and import through the picker", async ({ page }, testInfo) => {
  const app = await startApp("minimax");
  try {
    await seedBrowser(page, { dismissOnboarding: true, locale: "ko" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(app.baseUrl);
    await seedTemplate(page);
    await page.goto(`${app.baseUrl}/#node`);
    await expect(page.locator(".app")).toHaveAttribute("data-ui-mode", "node");
    await page.getByRole("button", { name: "템플릿", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const card = dialog.locator(".node-template-picker__card", { hasText: NAME }).first();
    await expect(card).toBeVisible();

    const downloadEvent = page.waitForEvent("download");
    await card.getByRole("button", { name: "내보내기", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("wp4-portable.ima2-template.json");
    const exported = await readFile(await download.path(), "utf8");
    const parsed = JSON.parse(exported);
    expect(parsed.kind).toBe("ima2.node-template");
    expect(parsed.name).toBe(NAME);
    for (const needle of ["attacker.example", "srv-1", "/generated/", "backgroundImage"]) expect(exported).not.toContain(needle);

    await chooseFile(page, "broken.json", '{"kind":"something-else","version":1}');
    const alert = dialog.getByRole("alert");
    await expect(alert).toHaveText("ima2 템플릿 파일이 아니에요.");
    await expect(card).toBeVisible();

    await chooseFile(page, "wp4-portable.ima2-template.json", exported);
    await expect(dialog.locator(".node-template-picker__card", { hasText: `${NAME} (2)` })).toBeVisible();
    await expect(page.getByText(`“${NAME} (2)” 템플릿을 가져왔어요.`)).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".node-template-picker")))).toBe(true);

    const path = testInfo.outputPath("wp12-template-import-ko.png");
    await page.screenshot({ path });
    await testInfo.attach("wp12-template-import-ko.png", { path, contentType: "image/png" });
    expect(app.stub.generationRequests).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});
