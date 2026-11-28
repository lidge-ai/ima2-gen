import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page) => {
  await page.goto("/#/director/director-studio");
  await expect(page.getByRole("heading", { name: "Director studio" })).toBeVisible();
};
const shots = (page: Page) => page.getByRole("region", { name: "Shots" });
const setLength = async (page: Page, n: number, seconds: number) => {
  await shots(page).getByRole("button", { name: new RegExp("^Shot " + n + " length: ") }).click();
  await page.getByRole("dialog", { name: "Length" }).getByRole("button", { name: seconds + " s", exact: true }).click();
};
const workflowRequest = (page: Page) => page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/workflows/director-studio");

test("cut list: shots with their own prompts and lengths are sent in order, priced per shot, without a single length", async ({ page }) => {
  await open(page);
  const generate = page.getByRole("button", { name: /^Generate/ });
  await expect(page.getByText("Required: Scene")).toBeVisible();
  await page.getByRole("group", { name: "How the clip is cut" }).getByRole("button", { name: "Cut list" }).click();
  // The shots set the length, so the one length for the whole clip is not offered with them.
  await expect(page.getByLabel("Length (seconds)", { exact: true })).toHaveCount(0);
  await expect(shots(page).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("Required: Shot 1, Shot 2")).toBeVisible();
  await expect(generate).toBeDisabled();
  await expect(shots(page).getByText("Seedance 2.5 makes shots of 1, 2, 3, 4, 5, 8, 10, 12, 15 seconds.")).toBeVisible();

  await shots(page).getByRole("textbox", { name: "Shot 1" }).fill("She opens the door");
  await shots(page).getByRole("textbox", { name: "Shot 2" }).fill("Rain on the window");
  await setLength(page, 2, 8);
  await shots(page).getByRole("button", { name: "Add shot" }).click();
  await shots(page).getByRole("textbox", { name: "Shot 3" }).fill("The street below");
  await expect(shots(page).getByRole("status")).toHaveText("3 shots · 18 s of 60 s");
  // A camera move goes into the shot it was opened from.
  await shots(page).getByRole("listitem").nth(2).getByRole("button", { name: "Camera move", exact: true }).click();
  await page.getByRole("dialog", { name: "Camera moves" }).getByRole("button", { name: "Crane up", exact: true }).click();
  await expect(shots(page).getByRole("textbox", { name: "Shot 3" })).toHaveValue("The street below. The camera cranes up from ground level to a high wide view.");
  // The last shot moves up: the list is what is sent, in the order shown.
  await shots(page).getByRole("button", { name: "Move shot 3 up" }).click();
  await expect(shots(page).getByRole("textbox", { name: "Shot 2" })).toHaveValue(/^The street below/);
  await expect(shots(page).getByRole("button", { name: "Move shot 1 up" })).toBeDisabled();
  await expect(shots(page).getByRole("button", { name: "Move shot 3 down" })).toBeDisabled();

  // The cost is broken down per shot, each by its own length (5 s and 8 s at the same price per second).
  const costs = page.getByLabel("Cost breakdown");
  await expect(costs.locator(".workflow-step")).toHaveCount(4);
  const usd = async (n: number) => Number((await costs.locator(".workflow-step").nth(n).locator(".muted").innerText()).replace(/[^0-9.]/g, ""));
  await expect(costs.locator(".workflow-step").nth(2)).toContainText("Shot 3");
  // What the server does itself (last frames, the join) is one line, not a $0 row each.
  await expect(costs.getByText("Take the last frame")).toHaveCount(0);
  await expect(costs.getByText("3 more steps (frames, joining, mixing) are done by ima2 at no charge.")).toBeVisible();
  expect((await usd(2)) / (await usd(0))).toBeCloseTo(8 / 5, 2);

  const sent = workflowRequest(page);
  await expect(generate).toBeEnabled();
  await generate.click();
  const values = ((await sent).postDataJSON() as { values: Record<string, unknown> }).values;
  expect(values.shots).toEqual([
    { prompt: "She opens the door", durationSec: 5 },
    { prompt: "The street below. The camera cranes up from ground level to a high wide view.", durationSec: 5 },
    { prompt: "Rain on the window", durationSec: 8 },
  ]);
  expect("duration" in values).toBe(false);
  // The scene was left empty: with a cut list it is optional shared context.
  expect(values.prompt).toBe("");
});

test("cut list: 2 to 6 shots and 60 seconds in all, said before anything is sent", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Cut list" }).click();
  await expect(shots(page).getByRole("button", { name: "Remove shot 1" })).toBeDisabled();
  for (let n = 3; n <= 6; n += 1) await shots(page).getByRole("button", { name: "Add shot" }).click();
  await expect(shots(page).getByRole("listitem")).toHaveCount(6);
  await expect(shots(page).getByRole("button", { name: "Add shot" })).toBeDisabled();
  await expect(shots(page).getByText("A cut list has at most 6 shots.")).toBeVisible();
  for (let n = 1; n <= 6; n += 1) await shots(page).getByRole("textbox", { name: "Shot " + n, exact: true }).fill("Shot text " + n);
  for (let n = 1; n <= 5; n += 1) await setLength(page, n, 12);
  let asked = 0;
  page.on("request", (r) => { if (r.url().includes("/api/workflows/director-studio/estimate")) asked += 1; });
  await setLength(page, 6, 12);
  await expect(shots(page).getByRole("alert")).toHaveText("The shots add up to 72 s. The most is 60 s; shorten or remove a shot.");
  // Generate says why there is no price, and nothing is asked of the server while the list is too long.
  await expect(page.getByRole("button", { name: /^Generate/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Generate/ })).toContainText("Shorten the cut list for price");
  await page.waitForTimeout(600);
  expect(asked).toBe(0);
  await shots(page).getByRole("button", { name: "Remove shot 6" }).click();
  await expect(shots(page).getByRole("alert")).toHaveCount(0);
  await expect(shots(page).getByRole("status")).toHaveText("5 shots · 60 s of 60 s");
  await expect(page.getByRole("button", { name: /^Generate/ })).toBeEnabled();
});

test("cut list: one scene still works as before, the list is kept while it is off, and Korean names every part", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Cut list" }).click();
  await shots(page).getByRole("textbox", { name: "Shot 1" }).fill("Kept while away");
  await page.getByRole("button", { name: "One scene" }).click();
  await expect(shots(page)).toHaveCount(0);
  await expect(page.getByLabel("Length (seconds)", { exact: true })).toBeVisible();
  await expect(page.getByText("Required: Scene")).toBeVisible();
  await page.getByRole("textbox", { name: "Scene" }).fill("A person walks into a quiet room");
  const sent = workflowRequest(page);
  await page.getByRole("button", { name: /^Generate/ }).click();
  const values = ((await sent).postDataJSON() as { values: Record<string, unknown> }).values;
  expect(values.duration).toBe(5);
  expect("shots" in values).toBe(false);
  await page.getByRole("button", { name: "Cut list" }).click();
  await expect(shots(page).getByRole("textbox", { name: "Shot 1" })).toHaveValue("Kept while away");
  // The stills workflows have no cut list.
  await page.goto("/#/director/director-cinema");
  await expect(page.getByLabel("Prompt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cut list" })).toHaveCount(0);

  await page.goto("/#/director/director-studio");
  await page.getByRole("button", { name: /Language/ }).click();
  await page.getByRole("group", { name: "컷 나누는 방식" }).getByRole("button", { name: "컷 목록" }).click();
  const list = page.getByRole("region", { name: "컷 목록" });
  await expect(list.getByRole("textbox", { name: "샷 1" })).toBeVisible();
  await expect(list.getByRole("status")).toHaveText("샷 2개 · 60초 중 10초");
  await expect(page.getByText("필수: 샷 1, 샷 2")).toBeVisible();
  // The cost rows and the running job's steps use the server's Korean step names.
  await list.getByRole("textbox", { name: "샷 1" }).fill("문이 열린다");
  await list.getByRole("textbox", { name: "샷 2" }).fill("창에 비가 내린다");
  await expect(page.getByLabel("비용 내역").locator(".workflow-step").first()).toContainText("샷 1");
  await page.getByRole("button", { name: /^생성/ }).click();
  await expect(page.locator(".job-steps").first()).toContainText("샷 1의 마지막 프레임 가져오기");
  // At phone width the settings and the list stay inside the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});

test("cut list: a shot the model cannot make that long is said as the next thing to change", async ({ page }) => {
  await page.route("**/api/workflows/director-studio/estimate", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "WORKFLOW_INPUT_INVALID", error: "shots: shot 2 is 12 s; bytedance/seedance-2.5 makes 4-10 s per shot", field: "shots", status: 400 }) }),
  );
  await open(page);
  await page.getByRole("button", { name: "Cut list" }).click();
  await shots(page).getByRole("textbox", { name: "Shot 1" }).fill("She opens the door");
  await shots(page).getByRole("textbox", { name: "Shot 2" }).fill("Rain on the window");
  await expect(page.getByText("Shot 2 is 12 s. Seedance 2.5 makes 4-10 s per shot; change its length.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Generate/ })).toBeDisabled();
  await expect(page.getByText(/Price estimate failed/)).toHaveCount(0);
});
