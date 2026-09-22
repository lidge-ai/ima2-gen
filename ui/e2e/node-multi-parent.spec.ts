import type { Page, TestInfo } from "@playwright/test";
import { expect, seedBrowser, startApp, test } from "./fixtures/appServer";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function seedGraph(page: Page): Promise<string> {
  return page.evaluate(async ({ imageUrl }) => {
    const created = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "WP12 multi-parent" }),
    });
    if (!created.ok) throw new Error(`session create failed: ${created.status}`);
    const { session } = await created.json();
    const data = (id: string, serverNodeId: string) => ({
      clientId: id,
      serverNodeId,
      parentServerNodeId: null,
      extraParentServerNodeIds: [],
      prompt: `${id} synthetic prompt`,
      imageUrl,
      status: "ready",
      pendingRequestId: null,
    });
    const nodes = [
      { id: "base", x: 0, y: 0, data: data("base", "server-base") },
      { id: "reference", x: 0, y: 360, data: data("reference", "server-reference") },
      { id: "target", x: 560, y: 180, data: data("target", "server-target") },
    ];
    const saved = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": "0" },
      body: JSON.stringify({ nodes, edges: [] }),
    });
    if (!saved.ok) throw new Error(`graph seed failed: ${saved.status}`);
    localStorage.setItem("ima2.activeSessionId", session.id);
    return session.id as string;
  }, { imageUrl: PNG });
}

async function connect(page: Page, sourceId: string, targetId: string): Promise<void> {
  const source = page.locator(`.react-flow__node[data-id="${sourceId}"] [data-handleid="source-right"]`);
  const target = page.locator(`.react-flow__node[data-id="${targetId}"] [data-handleid="target-left"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error(`missing connection handles: ${sourceId} -> ${targetId}`);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function readEdges(page: Page, sessionId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`session read failed: ${response.status}`);
    return (await response.json()).session.edges as Array<{
      id: string; source: string; target: string; data?: { targetHandle?: string | null };
    }>;
  }, sessionId);
}

async function attachScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  const name = "wp12-multi-parent-ko.png";
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("WP12 ordered image parents show localized roles and survive graph edits", async ({ page }, testInfo) => {
  const app = await startApp("minimax");
  try {
    await seedBrowser(page, { dismissOnboarding: true, locale: "ko" });
    await page.goto(app.baseUrl);
    await page.waitForFunction(() => Boolean(localStorage.getItem("ima2.activeSessionId")));
    const sessionId = await seedGraph(page);
    await page.reload();
    await page.goto(`${app.baseUrl}/#node`);
    await expect(page.locator(".app")).toHaveAttribute("data-ui-mode", "node");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    for (const id of ["base", "reference", "target"]) {
      await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
    }

    await connect(page, "base", "target");
    const saved = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/sessions/${sessionId}/graph`);
    await connect(page, "reference", "target");
    await saved;
    await expect(page.locator(".react-flow__edge-text", { hasText: "원본" })).toBeVisible();
    await expect(page.locator(".react-flow__edge-text", { hasText: "참조" })).toBeVisible();
    await expect.poll(async () => (await readEdges(page, sessionId))
      .map(({ source, target }) => `${source}->${target}`)).toEqual([
      "base->target",
      "reference->target",
    ]);
    let edges = await readEdges(page, sessionId);
    expect(edges.map(({ source, target }) => `${source}->${target}`)).toEqual([
      "base->target",
      "reference->target",
    ]);
    // The drops land on the visible source dots; the stored edges must use the input handle.
    expect(edges.map(({ data }) => data?.targetHandle)).toEqual(["target-left", "target-left"]);

    await page.reload();
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await expect(page.locator(".react-flow__edge-text", { hasText: "원본" })).toBeVisible();
    await expect(page.locator(".react-flow__edge-text", { hasText: "참조" })).toBeVisible();
    await attachScreenshot(page, testInfo);

    await connect(page, "target", "base");
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    expect(await readEdges(page, sessionId)).toHaveLength(2);

    const referenceEdge = edges[1]!.id;
    await page.locator(`.react-flow__edge[data-id="${referenceEdge}"] .react-flow__edge-interaction`).click({ force: true });
    const disconnected = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/sessions/${sessionId}/graph`);
    await page.getByRole("button", { name: "선택한 연결선 끊기", exact: true }).click();
    await disconnected;
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
    // Selecting the edge also queues a delayed save, which may be the PUT awaited above.
    await expect.poll(async () => (await readEdges(page, sessionId))
      .map(({ source, target }) => `${source}->${target}`)).toEqual(["base->target"]);
    expect(app.stub.generationRequests).toEqual([]);
  } finally {
    await page.close();
    await app.close();
  }
});
