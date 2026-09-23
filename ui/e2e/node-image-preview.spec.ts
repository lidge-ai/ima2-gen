import type { Page, TestInfo } from "@playwright/test";
import { expect, seedBrowser, startApp, test } from "./fixtures/appServer";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const NODE_ID = "wp2-node-with-a-long-generated-identifier-0123456789";

async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { copied: [] as string[], fail: false };
    (window as unknown as { __clipboard: typeof state }).__clipboard = state;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (state.fail) throw new Error("denied");
          state.copied.push(text);
        },
      },
    });
  });
}

async function seedGraph(page: Page, imageUrl: string): Promise<void> {
  await page.evaluate(async ({ id, url }) => {
    const created = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "WP2 node preview" }),
    });
    if (!created.ok) throw new Error(`session create failed: ${created.status}`);
    const { session } = await created.json();
    const nodes = [{
      id,
      x: 0,
      y: 0,
      data: {
        clientId: id, serverNodeId: "server-wp2", parentServerNodeId: null, extraParentServerNodeIds: [],
        prompt: "wp2 synthetic prompt", imageUrl: url, status: "ready", pendingRequestId: null,
      },
    }];
    const saved = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": "0" },
      body: JSON.stringify({ nodes, edges: [] }),
    });
    if (!saved.ok) throw new Error(`graph seed failed: ${saved.status}`);
    localStorage.setItem("ima2.activeSessionId", session.id);
  }, { id: NODE_ID, url: imageUrl });
}

async function attach(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function dragBy(page: Page, x: number, y: number, dx: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

test("WP2 node image zoom, copyable id and drag separation", async ({ page }, testInfo) => {
  const app = await startApp("minimax");
  try {
    await stubClipboard(page);
    await seedBrowser(page, { dismissOnboarding: true, locale: "ko" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(app.baseUrl);
    await page.waitForFunction(() => Boolean(localStorage.getItem("ima2.activeSessionId")));
    await seedGraph(page, PNG);
    await page.reload();
    await page.goto(`${app.baseUrl}/#node`);
    await expect(page.locator(".app")).toHaveAttribute("data-ui-mode", "node");
    const node = page.locator(`.react-flow__node[data-id="${NODE_ID}"]`);
    await expect(node).toBeVisible();

    // A graph edit that Ctrl+Z could undo if dialog keys leaked to the canvas.
    await node.getByRole("button", { name: "자식 노드 추가", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);

    // The id strip selects the node; keyboard opens the zoom without hovering.
    await node.locator(".image-node__id-text").click();
    await expect(node).toHaveClass(/selected/);
    const zoom = node.getByRole("button", { name: "크게 보기", exact: true });
    await zoom.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const nodeBox = await node.boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(nodeBox && dialogBox && dialogBox.width > nodeBox.width * 1.5).toBe(true);
    await expect(dialog.getByRole("button", { name: /배경 제거|SVG 변환|큐레이션/ })).toHaveCount(0);
    await attach(page, testInfo, "wp2-node-zoom-ko-1280.png");

    for (const key of ["ArrowRight", "ArrowRight", "Delete", "Backspace", "Control+z"]) {
      await page.keyboard.press(key);
    }
    await expect(dialog).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    const afterKeys = await node.boundingBox();
    expect(Math.abs((afterKeys?.x ?? 0) - (nodeBox?.x ?? 0))).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(zoom).toBeFocused();

    const copy = node.getByRole("button", { name: "노드 ID 복사", exact: true });
    await copy.click();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __clipboard: { copied: string[] } }).__clipboard.copied)).toEqual([NODE_ID]);
    await page.evaluate(() => { (window as unknown as { __clipboard: { fail: boolean } }).__clipboard.fail = true; });
    await copy.click();
    await expect(page.getByText("복사에 실패했습니다")).toBeVisible();

    const copyBox = await copy.boundingBox();
    const beforeCopyDrag = await node.boundingBox();
    if (!copyBox || !beforeCopyDrag) throw new Error("missing copy or node box");
    await dragBy(page, copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2, 120);
    const afterCopyDrag = await node.boundingBox();
    expect(Math.abs((afterCopyDrag?.x ?? 0) - beforeCopyDrag.x)).toBeLessThanOrEqual(1);

    const idText = await node.locator(".image-node__id-text").boundingBox();
    if (!idText) throw new Error("missing id text box");
    await dragBy(page, idText.x + Math.min(20, idText.width / 2), idText.y + idText.height / 2, 120);
    const afterIdDrag = await node.boundingBox();
    expect((afterIdDrag?.x ?? 0) - beforeCopyDrag.x).toBeGreaterThan(60);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(node.locator(".image-node__id-text")).toBeVisible();
    await attach(page, testInfo, "wp2-node-id-ko-390.png");
    expect(app.stub.generationRequests).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});
