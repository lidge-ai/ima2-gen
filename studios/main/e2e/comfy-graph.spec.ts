import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => label + " " + Date.now().toString(36);

async function openResult(page: Page, model: string, prompt: string) {
  await page.goto("/#/image?model=" + encodeURIComponent(model));
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("article").filter({ hasText: prompt }).getByRole("img", { name: prompt })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole("button", { name: "Open " + prompt }).click();
  return page.getByRole("dialog", { name: "Result" });
}

async function savedGraph(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: download.suggestedFilename(), graph: JSON.parse(await readFile(await download.path(), "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown> }> };
}

test("a ComfyUI result saves the graph ComfyUI ran, and says how to open it", async ({ page }) => {
  const prompt = unique("a fox in snow");
  const dialog = await openResult(page, "comfy/klein", prompt);
  const saved = await savedGraph(page, () => dialog.getByRole("button", { name: "Save ComfyUI graph" }).click());
  expect(saved.name).toMatch(/^[0-9a-f-]+\.comfy\.json$/);
  expect(saved.graph["6"]?.inputs.text).toBe(prompt);
  const note = dialog.getByRole("status");
  await expect(note).toContainText("Saved the graph file (.comfy.json). Drop it onto the ComfyUI canvas to open it.");
  await expect(note).toContainText("It is the graph ComfyUI ran for this result");
  await expect(note).not.toContainText("spending limit");
});

test("a result from a paid model saves an ima2 node graph that spends nothing as it is", async ({ page }) => {
  const prompt = unique("a heron at dawn");
  const dialog = await openResult(page, "openai/gpt-image-2", prompt);
  const saved = await savedGraph(page, () => dialog.getByRole("button", { name: "Save ComfyUI graph" }).click());
  expect(saved.graph["1"]).toMatchObject({ class_type: "Ima2MediaImage", inputs: { model: "openai/gpt-image-2", prompt, max_usd: 0 } });
  const note = dialog.getByRole("status");
  await expect(note).toContainText("It repeats this request with the ima2 node in ComfyUI.");
  await expect(note).toContainText("ComfyUI needs the comfyui-ima2 node pack");
  await expect(note).toContainText("spending limit is $0");
  // The server's two standard notes are said once, in the studio's words.
  await expect(note).not.toContainText("max_usd is 0");
});

test("when ComfyUI no longer has the job, nothing is saved and the reason is shown", async ({ page }) => {
  const prompt = unique("[graph:gone] a fox");
  const dialog = await openResult(page, "comfy/klein", prompt);
  let downloads = 0;
  page.on("download", () => (downloads += 1));
  await dialog.getByRole("button", { name: "Save ComfyUI graph" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("There is no ComfyUI graph for this result.");
  await expect(alert).toContainText("it is cleared when ComfyUI restarts");
  expect(downloads).toBe(0);
  // The button is still there to try again once ComfyUI has the job.
  await expect(dialog.getByRole("button", { name: "Save ComfyUI graph" })).toBeEnabled();
});

test("a shared web instance has no ComfyUI routes, so the button is not offered", async ({ page }) => {
  const prompt = unique("a quiet harbor");
  await page.route("**/api/web/session", (route) => route.fulfill({ json: { spend: { spentUsd: 0, dailyCapUsd: 5, requestCapUsd: 1 } } }));
  const dialog = await openResult(page, "openai/gpt-image-2", prompt);
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save ComfyUI graph" })).toHaveCount(0);
});

test("the button sits with Download, and Delete stays last", async ({ page }) => {
  const dialog = await openResult(page, "comfy/klein", unique("a fox in snow"));
  const labels = (await dialog.locator(".lightbox-actions > .btn").allTextContents()).map((label) => label.trim());
  expect(labels.slice(0, 2)).toEqual(["Download", "Save ComfyUI graph"]);
  expect(labels.at(-1)).toBe("Delete");
});

test("without ComfyUI set up, a result from another model does not offer a graph", async ({ page }) => {
  // The catalog with no local route: this server has no ComfyUI workflow registered.
  await page.route("**/api/media/catalog", async (route) => {
    const body = (await (await route.fetch()).json()) as { models: { id: string }[]; adapters?: { id: string }[] };
    await route.fulfill({ json: { ...body, models: body.models.filter((model) => !model.id.startsWith("comfy/")) } });
  });
  const dialog = await openResult(page, "openai/gpt-image-2", unique("a quiet harbor"));
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save ComfyUI graph" })).toHaveCount(0);
});

test("in Korean the button and its note are Korean", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  const prompt = unique("a fox in snow");
  await page.goto("/#/image?model=comfy%2Fklein");
  await page.getByLabel("프롬프트").fill(prompt);
  await page.getByRole("button", { name: /생성/ }).click();
  await expect(page.getByRole("article").filter({ hasText: prompt }).getByRole("img", { name: prompt })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole("button", { name: new RegExp(prompt) }).first().click();
  const dialog = page.getByRole("dialog");
  await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "ComfyUI 그래프 저장" }).click()]);
  await expect(dialog.getByRole("status")).toContainText("ComfyUI가 이 결과를 만들 때 실행한 그래프");
});
