import { expect, test, type Page } from "@playwright/test";

const ORBIT = "The camera orbits left around the subject at eye level, keeping it centered.";
const PUSH = "The camera pushes in slowly toward the subject.";
const RISE = "An aerial drone shot rising straight up, the subject getting smaller below.";
const pickMove = async (page: Page, name: string, search?: string) => {
  await page.getByRole("button", { name: "Camera move", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Camera moves" });
  if (search !== undefined) await menu.getByRole("searchbox", { name: "Search camera moves" }).fill(search);
  await menu.getByRole("button", { name, exact: true }).click();
  await expect(menu).toBeHidden();
};

test("camera moves: a move adds its sentence to the prompt, at the end or where the caret is, and the request carries it", async ({ page }) => {
  await page.goto("/#/video?model=bytedance%2Fseedance-2.5");
  const prompt = page.getByLabel("Prompt");
  await prompt.fill("A fox on a pier");
  // Opened from elsewhere (the prompt is not being edited): the sentence goes at the end.
  await page.getByRole("button", { name: /^Duration: / }).focus();
  await pickMove(page, "Orbit left", "orbit");
  await expect(prompt).toHaveValue("A fox on a pier. " + ORBIT);
  await expect(page.getByRole("status").filter({ hasText: "Added to the prompt: Orbit left" })).toHaveCount(1);

  // With the caret inside the text, the sentence goes there and nothing written is lost.
  await prompt.fill("First part. Second part.");
  await prompt.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(11, 11); });
  await pickMove(page, "Push in");
  await expect(prompt).toHaveValue("First part. " + PUSH + " Second part.");
  // The caret is right after the inserted sentence, so typing continues there.
  expect(await prompt.evaluate((el: HTMLTextAreaElement) => [document.activeElement === el, el.selectionStart])).toEqual([true, ("First part. " + PUSH).length]);

  const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
  await page.getByRole("button", { name: /Generate/ }).click();
  expect(((await sent).postDataJSON() as { prompt: string }).prompt).toBe("First part. " + PUSH + " Second part.");
});

test("camera moves: the menu groups and searches the moves in both languages and says when nothing matches", async ({ page }) => {
  await page.goto("/#/video?model=bytedance%2Fseedance-2.5");
  await page.getByRole("button", { name: "Camera move", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Camera moves" });
  await expect(menu.getByText("How closely it is followed depends on the model.")).toBeVisible();
  // The menu opens to the right of the form, level with its button, so the prompt stays readable while choosing.
  const [form, button, box] = await Promise.all([page.locator(".panel").boundingBox(), page.getByRole("button", { name: "Camera move", exact: true }).boundingBox(), menu.boundingBox()]);
  expect(Math.round(box!.x - (form!.x + form!.width))).toBe(8);
  expect(Math.abs(box!.y - button!.y)).toBeLessThan(box!.height);
  // The sentence a move adds shows at the foot of the menu before it is chosen, by pointer and by keyboard.
  await menu.getByRole("button", { name: "Crane up", exact: true }).hover();
  await expect(menu.getByText("Adds: The camera cranes up from ground level to a high wide view.")).toBeVisible();
  await menu.getByRole("button", { name: "Top-down", exact: true }).focus();
  await expect(menu.getByText("Adds: A top-down overhead shot looking straight down, drifting slowly.")).toBeVisible();
  await expect(menu.getByRole("group", { name: "Crane and drone" }).getByRole("button")).toHaveCount(6);
  await menu.getByRole("searchbox").fill("drone");
  await expect(menu.getByRole("button")).toHaveText(["Drone flyover", "Drone rise"]);
  // A Korean name finds the move while the screen is in English.
  await menu.getByRole("searchbox").fill("핸드헬드");
  await expect(menu.getByRole("button")).toHaveText(["Handheld"]);
  await menu.getByRole("searchbox").fill("teleport");
  await expect(menu.getByRole("status")).toHaveText("No camera move matches.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Language/ }).click();
  await page.getByRole("button", { name: "카메라 무브", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "카메라 무브" }).getByRole("group", { name: "크레인과 드론" }).getByRole("button", { name: "드론 상승", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});

test("camera moves: the Presets tab lists them as text cards; Use adds the sentence to the video form's prompt once", async ({ page }) => {
  await page.goto("/#/video?model=bytedance%2Fseedance-2.5");
  await page.getByLabel("Prompt").fill("A lighthouse at dusk");
  await page.goto("/#/presets/moves");
  await expect(page.getByRole("link", { name: "Camera moves" })).toHaveAttribute("aria-current", "page");
  const list = page.getByRole("region", { name: "Camera moves", exact: true });
  await expect(list.getByRole("article")).toHaveCount(32);
  // A card is words only: no picture or clip stands in for a result.
  await expect(list.locator("img, video")).toHaveCount(0);
  // The kind chips narrow the cards to one group; search then narrows within it.
  const kinds = list.getByRole("group", { name: "Kind of move" });
  await kinds.getByRole("button", { name: "Focus and zoom" }).click();
  await expect(list.getByRole("article")).toHaveCount(4);
  await expect(kinds.getByRole("button", { name: "Focus and zoom" })).toHaveAttribute("aria-pressed", "true");
  await list.getByRole("searchbox", { name: "Search camera moves" }).fill("drone");
  await expect(list.getByRole("status")).toHaveText("No camera move matches. Change the search.");
  await kinds.getByRole("button", { name: "All", exact: true }).click();
  await expect(list.getByRole("article")).toHaveCount(2);
  // The English sentence is labelled as what gets added.
  await expect(list.getByRole("article", { name: "Drone rise" })).toContainText("Adds");
  await expect(list.getByRole("article", { name: "Drone rise" })).toContainText(RISE);
  await list.getByRole("link", { name: "Use Drone rise in a video" }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue("A lighthouse at dusk. " + RISE);
  // The address no longer names the move, and a reload does not add it a second time.
  await expect(page).not.toHaveURL(/move=/);
  await page.reload();
  await expect(page.getByLabel("Prompt")).toHaveValue("A lighthouse at dusk. " + RISE);
  await page.goto("/#/presets/moves");
  await page.getByRole("region", { name: "Camera moves", exact: true }).getByRole("searchbox").fill("teleport");
  await expect(page.getByRole("region", { name: "Camera moves", exact: true }).getByRole("status")).toHaveText("No camera move matches. Change the search.");
});

test("camera moves: Director studio's scene takes a move, and the stills workflows have no such button", async ({ page }) => {
  await page.goto("/#/director/director-studio");
  const scene = page.getByRole("textbox", { name: "Scene" });
  await scene.fill("She crosses the square");
  await page.getByRole("button", { name: /^Generate/ }).focus();
  await pickMove(page, "Crane up");
  await expect(scene).toHaveValue("She crosses the square. The camera cranes up from ground level to a high wide view.");
  const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/workflows/director-studio");
  await page.getByRole("button", { name: /^Generate/ }).click();
  expect(JSON.stringify((await sent).postDataJSON())).toContain("The camera cranes up from ground level to a high wide view.");
  await page.goto("/#/director/director-cast");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Director studio");
  await expect(page.getByRole("button", { name: "Camera move", exact: true })).toHaveCount(0);
});
