import { expect, test, type Locator } from "@playwright/test";

/** Playing means the browser is advancing frames, not merely showing a poster or a stopped first frame. */
const playing = (video: Locator) =>
  expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => !el.paused && el.readyState >= 2 && el.currentTime > 0), { timeout: 10_000 })
    .toBe(true);

test("home shows showcase clips; one opens Remix with its settings", async ({ page }) => {
  await page.goto("/#/");
  const showcase = page.getByRole("region", { name: "Made with ima2" });
  await expect(showcase.getByRole("article")).toHaveCount(2);
  const swap = showcase.getByRole("article", { name: "Swap the dancer" });
  await expect(swap).toContainText("About $0.76 when it was made");
  await expect(swap.getByRole("link", { name: "BytePlus ModelArk" })).toHaveAttribute("href", "#/keys?focus=byteplus");
  await swap.hover();
  await swap.getByRole("button", { name: "Compare with source" }).click();
  await expect(swap.getByText("Source", { exact: true })).toBeVisible();
  await swap.getByRole("button", { name: "Make one like this" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap$/);
  await expect(page.getByLabel("What to replace")).toHaveValue("the dancer");
});

test("no showcase items hides the section", async ({ page }) => {
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Models from" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Made with ima2" })).toHaveCount(0);
});

test("a subscription clip names the sign-in, not a key, and its zero cost as included", async ({ page }) => {
  const item = (id: string, keys: string[], usd: number) => ({
    id,
    title: { en: id },
    workflow: "remix-object-swap",
    result: "/generated/showcase-swap-result.mp4",
    models: [],
    keys,
    estimate: { usd },
  });
  const items = [item("restyle-grok", ["xai-oauth"], 0), item("swap-mixed", ["openai-oauth", "byteplus"], 1.39)];
  for (let i = 0; i < 8; i += 1) items.push(item("filler-" + i, [], 0.5));
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items } }));
  await page.goto("/#/");
  const showcase = page.getByRole("region", { name: "Made with ima2" });
  await expect(showcase.getByRole("article")).toHaveCount(4);
  await expect(showcase.getByRole("link", { name: "All 10 clips" })).toHaveAttribute("href", "#/remix");
  const grok = showcase.getByRole("article", { name: "restyle-grok" });
  await expect(grok).toContainText("Included in the Grok subscription");
  await expect(grok).toContainText("Uses your Grok sign-in");
  await expect(grok.getByRole("link")).toHaveCount(0);
  const mixed = showcase.getByRole("article", { name: "swap-mixed" });
  await mixed.hover();
  await expect(mixed).toContainText("About $1.39 when it was made");
  await expect(mixed).toContainText("Uses your ChatGPT sign-in");
  await expect(mixed.getByRole("link", { name: "BytePlus ModelArk" })).toBeVisible();
  await expect(mixed.getByRole("link", { name: /oauth/ })).toHaveCount(0);
});


test("compare plays source and result; turning it off brings the result back playing", async ({ page }) => {
  await page.goto("/#/");
  const swap = page.getByRole("region", { name: "Made with ima2" }).getByRole("article", { name: "Swap the dancer" });
  const toggle = swap.getByRole("button", { name: "Compare with source" });
  await swap.hover();
  await toggle.click();
  await playing(swap.locator("video[aria-label='Source']"));
  await playing(swap.locator("video[aria-label='Result']"));
  await toggle.click();
  await page.mouse.move(0, 0);
  await playing(swap.locator("video[aria-label='Play Swap the dancer']"));
});

test("a single compare clip plays when switched on, and the result returns when switched off", async ({ page }) => {
  // Registers the fake clip files, then serves an entry that has a ready-made comparison clip.
  const real = (await (await page.request.get("/api/showcase")).json()) as { items: { result: string; source: string }[] };
  const [first] = real.items;
  const item = { id: "with-compare", title: { en: "With compare" }, workflow: "remix-object-swap", result: first!.result, compare: first!.source, models: [], keys: [] };
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items: [item] } }));
  await page.goto("/#/");
  const tile = page.getByRole("article", { name: "With compare" });
  const toggle = tile.getByRole("button", { name: "Compare with source" });
  await tile.hover();
  await toggle.click();
  await playing(tile.locator("video[aria-label='Compare with source']"));
  await toggle.click();
  await page.mouse.move(0, 0);
  await playing(tile.locator("video[aria-label='Play With compare']"));
});

/** Adds what a real server reports (runnable now, the default session route) to the fake's swap workflow. */
async function swapRunnable(page: import("@playwright/test").Page, subjectRuns: Record<string, boolean>) {
  await page.route("**/api/workflows", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { workflows: { id: string; slots: Record<string, unknown>[] }[] };
    const swap = body.workflows.find((w) => w.id === "remix-object-swap")!;
    const render = swap.slots[0]!;
    swap.slots = [
      {
        name: "subject",
        label: "Subject frame",
        task: "image-to-image",
        defaultModel: "openai/gpt-image-2",
        alternatives: ["bytedance/seedream-5.5"],
        defaultRoute: "openai-oauth",
        rationale: "test",
        available: { "openai/gpt-image-2": true, "bytedance/seedream-5.5": true },
        runnable: subjectRuns,
      },
      { ...render, runnable: Object.fromEntries(Object.keys(render.available as object).map((m) => [m, true])) },
    ];
    await route.fulfill({ response, json: body });
  });
}

test("where the ChatGPT sign-in is off, the step that falls back to a keyed model is shown as ready", async ({ page }) => {
  await swapRunnable(page, { "openai/gpt-image-2": false, "bytedance/seedream-5.5": true });
  await page.goto("/#/");
  const swap = page.getByRole("region", { name: "Made with ima2" }).getByRole("article", { name: "Swap the dancer" });
  await expect(swap).toContainText("Ready to make:");
  await expect(swap).not.toContainText("ChatGPT");
  await expect(swap).not.toContainText("Needs:");
  await expect(swap).not.toContainText("oauth");
});

test("a missing sign-in is named in words, next to what is already ready", async ({ page }) => {
  await swapRunnable(page, { "openai/gpt-image-2": false, "bytedance/seedream-5.5": false });
  await page.goto("/#/");
  const swap = page.getByRole("region", { name: "Made with ima2" }).getByRole("article", { name: "Swap the dancer" });
  await expect(swap).toContainText("Needs: ChatGPT sign-in");
  await expect(swap).toContainText("Ready:");
  await expect(swap).not.toContainText("oauth");
});

test("clip details stay out of the way: hover, keyboard focus or a tap opens them, Escape closes them", async ({ page }) => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    id: "clip-" + i,
    title: { en: "Clip " + i },
    workflow: "remix-object-swap",
    result: "/generated/showcase-swap-result.mp4",
    models: [],
    keys: ["byteplus"],
    estimate: { usd: 0.5 },
  }));
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items } }));
  await page.goto("/#/");
  const tile = page.getByRole("region", { name: "Made with ima2" }).getByRole("article", { name: "Clip 1" });
  const details = tile.locator(".showcase-details");
  const height = () => details.evaluate((el) => el.getBoundingClientRect().height);
  await page.mouse.move(0, 0);
  await expect(tile.getByRole("heading", { name: "Clip 1" })).toBeVisible();
  await expect.poll(height).toBe(0);
  await tile.hover();
  await expect.poll(height).toBeGreaterThan(40);
  await expect(tile.getByRole("link", { name: "BytePlus ModelArk" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(height).toBe(0);
  await page.mouse.move(0, 0);
  // Tap path: the clip itself toggles the details. Tap near the top: on a pointer device the
  // hover-opened details cover the lower part of the clip, and a touch screen has no hover.
  const peek = tile.getByRole("button", { name: "Details for Clip 1" });
  await peek.click({ position: { x: 12, y: 12 } });
  await expect(peek).toHaveAttribute("aria-expanded", "true");
  await peek.click({ position: { x: 12, y: 12 } });
  await expect(peek).toHaveAttribute("aria-expanded", "false");
  await page.mouse.move(0, 0);
  // Keyboard path: tabbing into the details (the key link comes first) opens them.
  await page.keyboard.press("Tab");
  await expect(tile.getByRole("link", { name: "BytePlus ModelArk" })).toBeFocused();
  await expect.poll(height).toBeGreaterThan(40);
});

test("Home shows one full row of clips and the tools below it on the first screen", async ({ page }) => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: "row-" + i, title: { en: "Row " + i }, workflow: "remix-object-swap", result: "/generated/showcase-swap-result.mp4", models: [], keys: [], estimate: { usd: 0.5 } }));
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items } }));
  await page.goto("/#/");
  const showcase = page.getByRole("region", { name: "Made with ima2" });
  await expect(showcase.getByRole("article")).toHaveCount(4);
  // 1440 x 900: the showcase row and the start of the tool cards share the first screen.
  expect(await page.locator(".tool-row").evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(800);
  const tops = async () => showcase.getByRole("article").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  const rows = (values: number[]) => [...new Set(values)].map((top) => values.filter((v) => v === top).length);
  expect(rows(await tops())).toEqual([4]);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(showcase.getByRole("article")).toHaveCount(3);
  expect(rows(await tops())).toEqual([3]);
  await expect(showcase.getByRole("link", { name: "All 10 clips" })).toBeVisible();
});

test("a gallery-only clip (no workflow) shows what it is and what it cost, with no buttons", async ({ page }) => {
  const items = [{ id: "hero-train", title: { en: "Night train" }, result: "/generated/showcase-swap-result.mp4", source: "/generated/showcase-swap-source.mp4", models: ["kling/kling-3"], keys: ["fal"], estimate: { usd: 0.6 } }];
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items } }));
  await page.goto("/#/");
  const tile = page.getByRole("region", { name: "Made with ima2" }).getByRole("article", { name: "Night train" });
  await tile.hover();
  await expect(tile).toContainText("About $0.60 when it was made");
  await expect(tile.getByRole("button", { name: "Make one like this" })).toHaveCount(0);
  await expect(tile.getByRole("button", { name: "Compare with source" })).toHaveCount(0);
  await expect(tile).not.toContainText("This workflow is not on this server");
});

test("Home's row shows one clip of each kind before repeating a kind", async ({ page }) => {
  const kinds = ["motion-transfer", "motion-transfer", "motion-transfer", "object-swap", "restyle", "text-to-video", "restyle"];
  const items = kinds.map((type, i) => ({ id: "k" + i, title: { en: "Kind " + i }, type, result: "/generated/showcase-swap-result.mp4", models: [], keys: [] }));
  await page.route("**/api/showcase", (route) => route.fulfill({ json: { items } }));
  await page.goto("/#/");
  const titles = await page.getByRole("region", { name: "Made with ima2" }).getByRole("article").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(titles).toEqual(["Kind 0", "Kind 3", "Kind 4", "Kind 5"]);
});
