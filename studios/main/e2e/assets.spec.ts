import type { Page, Request } from "@playwright/test";
import { expect, test } from "@playwright/test";

const listed = (page: Page, has: (params: URLSearchParams) => boolean) =>
  page.waitForRequest((r: Request) => { const url = new URL(r.url()); return url.pathname === "/api/history" && has(url.searchParams); });

test("asset filters, favorites and deletion", async ({ page, request }) => {
  const prompt = `asset ${Date.now()}`;
  const response = await request.post("/api/media", {
    data: { model: "bytedance/seedance-2.5", task: "text-to-video", prompt, inputs: [] },
  });
  expect(response.ok()).toBeTruthy();
  await expect
    .poll(async () =>
      (await (await request.get("/api/history")).json()).items.some(
        (item: { prompt: string }) => item.prompt === prompt,
      ),
    )
    .toBeTruthy();
  await page.goto("/#/assets/videos");
  await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Model: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Seedance 2.5", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open ${prompt}` })).toBeVisible();
  await page.getByRole("button", { name: /^Model: / }).click();
  await page.getByRole("dialog").getByRole("button", { name: "All models", exact: true }).click();
  await page.getByRole("button", { name: `Open ${prompt}` }).click();
  const dialog = page.getByRole("dialog", { name: "Result" });
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saved" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: `Open ${prompt}` }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: `Open ${prompt}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Compact" }).click();
  await expect(page.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
});

test("history errors can be retried", async ({ page }) => {
  await page.goto("/#/assets/all");
  await expect(page.getByRole("heading", { name: "Assets", exact: true })).toBeVisible();
  await page.route("**/api/history?*", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "History unavailable" } } }),
  );
  await page.getByRole("link", { name: "Images", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("History unavailable");
  await page.unroute("**/api/history?*");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create an image" })).toBeVisible();
});

// These make results, so they come after the tests above that start from an empty history.
test("assets: search, kind, period and order are asked of the server; the count and a clear action follow the filters", async ({ page, request }) => {
  const mark = "mk" + Date.now().toString(36);
  const prompts = { fox: "harbor " + mark + " fox", whale: mark + " whale" };
  // One after the other: a result's time is when it finished, and the order below depends on it.
  for (const [n, data] of [
    { model: "openai/gpt-image-2", task: "text-to-image", prompt: prompts.fox, inputs: [] },
    { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: prompts.whale, inputs: [] },
  ].entries()) {
    expect((await request.post("/api/media", { data })).ok()).toBeTruthy();
    await expect.poll(async () => ((await (await request.get("/api/history?q=" + mark)).json()) as { matched: number }).matched, { timeout: 20_000 }).toBe(n + 1);
  }

  await page.goto("/#/assets/all");
  const tools = page.getByRole("group", { name: "Search, filter and sort" });
  const results = page.getByRole("region", { name: "Assets results" });
  let asked = listed(page, (p) => p.get("q") === mark && p.get("includeAudio") === "1" && p.get("facets") === "model");
  await tools.getByRole("searchbox", { name: "Search prompts and models" }).fill(mark);
  await asked;
  await expect(page.getByRole("status").filter({ hasText: "2 results" })).toBeVisible();
  // The search is in the address: a reload shows the same narrowed list.
  await expect(page).toHaveURL(new RegExp("#/assets/all\\?q=" + mark + "$"));
  await page.reload();
  await expect(tools.getByRole("searchbox")).toHaveValue(mark);
  await expect(page.getByRole("status").filter({ hasText: "2 results" })).toBeVisible();
  // Newest first: the video was made after the image.
  const order = () => results.getByRole("button", { name: /^Open / }).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  await expect.poll(order).toEqual(["Open " + prompts.whale, "Open " + prompts.fox]);

  asked = listed(page, (p) => p.get("order") === "asc" && p.get("q") === mark);
  await tools.getByRole("button", { name: "Order: Newest first", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Oldest first", exact: true }).click();
  await asked;
  await expect.poll(order).toEqual(["Open " + prompts.fox, "Open " + prompts.whale]);

  asked = listed(page, (p) => p.get("mediaType") === "video" && p.get("q") === mark);
  await page.getByRole("link", { name: "Videos", exact: true }).click();
  await asked;
  await expect(page.getByRole("status").filter({ hasText: "1 result" })).toBeVisible();
  await expect(results.getByRole("button", { name: "Open " + prompts.whale })).toBeVisible();
  await expect(results.getByRole("button", { name: "Open " + prompts.fox })).toHaveCount(0);

  asked = listed(page, (p) => Number(p.get("since")) > Date.now() - 25 * 60 * 60 * 1000 && p.get("q") === mark);
  await tools.getByRole("button", { name: "Period: Any time", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Last 24 hours", exact: true }).click();
  await asked;
  await expect(results.getByRole("button", { name: "Open " + prompts.whale })).toBeVisible();

  await tools.getByRole("searchbox").fill(mark + " nothing like this");
  await expect(page.getByRole("heading", { name: "Nothing matches this search and these filters." })).toBeVisible();
  // On a narrower tab, the same search can be taken to every tab.
  await expect(page.getByRole("link", { name: "Search every tab" })).toHaveAttribute("href", /^#\/assets\/all\?q=/);
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(tools.getByRole("searchbox")).toHaveValue("");
  await expect(results.getByRole("button", { name: "Open " + prompts.whale })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /result/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Language/ }).click();
  await expect(page.getByRole("group", { name: "검색, 필터, 정렬" }).getByRole("searchbox", { name: "프롬프트와 모델 검색" })).toBeVisible();
  await expect(page.getByRole("button", { name: "정렬: 오래된순", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "기간: 전체", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});

test("assets: an audio result is listed under All and Audio", async ({ page, request }) => {
  const prompt = "slow piano " + Date.now().toString(36);
  await request.put("/api/keys/elevenlabs", { data: { apiKey: "assets-spec-key" } });
  try {
    expect((await request.post("/api/media", { data: { model: "elevenlabs/elevenlabs-music-2.5", task: "text-to-audio", prompt, durationSec: 5, inputs: [] } })).ok()).toBeTruthy();
    await expect.poll(async () => ((await (await request.get("/api/history?mediaType=audio&q=" + encodeURIComponent(prompt))).json()) as { matched: number }).matched, { timeout: 20_000 }).toBe(1);
    // Asked the way the server's default is: audio is left out.
    expect(((await (await request.get("/api/history?q=" + encodeURIComponent(prompt))).json()) as { matched: number }).matched).toBe(0);
    await page.goto("/#/assets/audio");
    await expect(page.getByRole("region", { name: "Assets results" }).getByRole("button", { name: "Open " + prompt })).toBeVisible();
    await page.getByRole("link", { name: "All", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assets results" }).getByRole("button", { name: "Open " + prompt })).toBeVisible();
  } finally {
    await request.delete("/api/keys/elevenlabs");
  }
});
