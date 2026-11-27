import { test, expect } from "@playwright/test";

test("remix switches modes and subscription variants", async ({ page }) => {
  await page.goto("/#/remix/remix-motion-transfer");
  await expect(page.getByRole("heading", { name: "Remix: motion transfer", exact: true })).toBeVisible();
  await expect(page.getByText(/4-15 second clip/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reference images", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Object swap" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap$/);
  await expect(page.getByLabel("What to replace")).toBeVisible();
  await page.getByRole("navigation", { name: "How to run" }).getByRole("link", { name: "With your subscriptions" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-object-swap-subscription$/);
  await expect(page.getByText("Pinned keyframes")).toBeVisible();
  await page.getByRole("link", { name: "Restyle" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-restyle-subscription$/);
  await page.getByRole("navigation", { name: "How to run" }).getByRole("link", { name: "In one go" }).click();
  await expect(page.getByRole("button", { name: "Style reference" })).toBeVisible();
  await page.getByRole("switch", { name: "Prompt" }).check();
  await page.getByLabel("Notes").fill("A soft watercolor look");
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("No remix results yet")).toBeVisible();
});

test("restyle accepts the real source and style reference fields", async ({ page }) => {
  await page.goto("/#/remix/remix-restyle");
  // The first visit starts from an example clip; replace it with the person's own source.
  await page.getByRole("button", { name: "Remove Source video" }).click();
  await page.getByLabel("Source video", { exact: true }).setInputFiles({
    name: "source.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("sample"),
  });
  await page.getByLabel("Style reference", { exact: true }).setInputFiles({
    name: "style.png",
    mimeType: "image/png",
    buffer: Buffer.from("sample"),
  });
  await expect(page.getByRole("button", { name: "Remove Source video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Style reference" })).toBeVisible();
  await expect(page.getByText("Steps and estimated cost")).toBeVisible();
});

/** What a shared web instance reports at /api/web/session; a local server has no such route. */
const webSession = (spend: { spentUsd?: number; dailyCapUsd?: number; requestCapUsd?: number }) => ({
  email: "member@example.com",
  spend: { day: "2026-11-27", spentUsd: 0, dailyCapUsd: 20, requestCapUsd: 5, ...spend },
});

test("on a shared web server, an unpriced step is named before Generate, and a refusal shows the server's reason", async ({ page }) => {
  await page.route("**/api/web/session", (route) => route.fulfill({ json: webSession({}) }));
  let unpriced = true;
  await page.route("**/api/workflows/remix-restyle/estimate", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (unpriced) {
      body.estimate.complete = false;
      body.estimate.steps[0].usd = null;
    }
    await route.fulfill({ response, json: body });
  });
  const refusal = "workflow:remix-restyle has no published price, so this shared instance does not run it.";
  await page.route("**/api/workflows/remix-restyle", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 403, json: { ok: false, code: "WEB_SPEND_UNPRICED", error: refusal, status: 403 } })
      : route.fallback(),
  );
  await page.goto("/#/remix/remix-restyle");
  const generate = page.getByRole("button", { name: /^Generate/ });
  await expect(page.getByText("This shared server runs only priced steps. No published price: “Restyle the first frame”.")).toBeVisible();
  await expect(generate).toBeDisabled();
  // Priced again (another style), the button opens; if the server still refuses, its reason is shown as sent.
  unpriced = false;
  await page.getByRole("button", { name: /^Style: / }).click();
  await page.getByRole("dialog", { name: "Style" }).getByRole("button", { name: "watercolor" }).click();
  await expect(page.getByText(/runs only priced steps/)).toHaveCount(0);
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
});

test("in Korean, Remix reads the server's Korean workflow text: name, field help, options and step names", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.goto("/#/remix/remix-object-swap");
  await expect(page.getByRole("heading", { name: "리믹스: 사물 바꾸기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^품질: / }).click();
  await expect(page.getByRole("dialog", { name: "품질" }).getByRole("button", { name: "표준" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("공연할 사람이나 사물 이미지 1~8장, 순서대로.").first()).toBeAttached();
  await expect(page.getByText("1-8 images of the people or things")).toHaveCount(0);
  await expect(page.getByText("Standard", { exact: true })).toHaveCount(0);
});

test("a step shows the model the server's estimate planned, not the workflow default", async ({ page }) => {
  // A web instance without the ChatGPT sign-in plans another model for the first frame.
  await page.route("**/api/workflows/remix-restyle/estimate", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // The plan step's id need not match the slot; the server names the slot on each step.
    for (const s of body.estimate.steps) if (s.stepId === "stylize") Object.assign(s, { stepId: "frame-one", model: "openai/gpt-image-2" });
    for (const s of body.steps) if (s.id === "stylize") Object.assign(s, { id: "frame-one", slot: "stylize", model: "openai/gpt-image-2" });
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#/remix/remix-restyle");
  await expect(page.getByRole("button", { name: "Restyle the first frame: GPT Image 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restyle the first frame: Seedream 5.5" })).toHaveCount(0);
});

test("steps say what they do in two lines; credits sit once, collapsed, under Sources", async ({ page }) => {
  await page.goto("/#/remix/remix-restyle");
  const description = page.getByText("Redraws the source's first frame in the chosen style.");
  await expect(description).toBeVisible();
  expect(await description.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");
  const sources = page.locator("details.workflow-credits");
  await expect(sources.locator("summary")).toHaveText("Sources (2)");
  const link = sources.getByRole("link", { name: "D3voz/openjutsu" });
  await expect(link).toBeHidden();
  await sources.locator("summary").click();
  await expect(link).toHaveAttribute("href", "https://github.com/D3voz/openjutsu");
  await expect(sources.getByRole("link")).toHaveCount(2);
});

test("in Korean, step descriptions and the sources heading are Korean", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.goto("/#/remix/remix-restyle");
  await expect(page.getByText("원본의 첫 프레임을 고른 스타일로 다시 그려요.")).toBeVisible();
  await expect(page.locator("details.workflow-credits summary")).toHaveText("출처 (2)");
});

test("one reference image counts as one; the next empty slot adds another", async ({ page }) => {
  await page.goto("/#/remix/remix-motion-transfer");
  await page.getByLabel("Reference images", { exact: true }).setInputFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(page.getByRole("button", { name: "Remove Reference images" })).toBeVisible();
  await expect(page.getByText("Reference images · Required · 1 of 8")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add another: Reference images" })).toBeVisible();
  await expect(page.getByText(/Reference images 2/)).toHaveCount(0);
  await page.getByLabel("Add another: Reference images").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(page.getByRole("button", { name: "Remove Reference images 2" })).toBeVisible();
  await expect(page.getByText("Reference images · Required · 2 of 8")).toBeVisible();
});

test("before any upload, a step shows the model this server can run, not an unrunnable default", async ({ page }) => {
  await page.route("**/api/workflows", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { workflows: { id: string; slots: Record<string, unknown>[] }[] };
    const restyle = body.workflows.find((w) => w.id === "remix-restyle")!;
    restyle.slots = restyle.slots.map((slot) =>
      slot.name === "stylize"
        ? { ...slot, defaultModel: "openai/gpt-image-2", alternatives: ["bytedance/seedream-5.5"], defaultRoute: "openai-oauth", runnable: { "openai/gpt-image-2": false, "bytedance/seedream-5.5": true }, available: { "openai/gpt-image-2": true, "bytedance/seedream-5.5": true } }
        : slot,
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto("/#/remix/remix-restyle");
  await page.getByRole("button", { name: "Remove Source video" }).click().catch(() => undefined);
  await expect(page.getByRole("button", { name: /^Restyle the first frame: / })).toHaveAccessibleName("Restyle the first frame: Seedream 5.5");
});

test("Remix offers three ways to run, each saying what differs; step by step is reachable from the menu", async ({ page }) => {
  await page.goto("/#/remix/remix-motion-transfer");
  const ways = page.getByRole("navigation", { name: "How to run" });
  await expect(ways.getByRole("link")).toHaveText(["In one go", "With your subscriptions", "Step by step"]);
  await expect(ways.getByRole("link", { name: "In one go" })).toHaveAttribute("aria-current", "page");
  // Each way names its models, its step count and who bills it; the subscription way lists what it gives up.
  await expect(ways.getByRole("link", { name: "In one go" })).toHaveAccessibleDescription(/Seedance 2\.5 · 1 steps · your keys, provider prices/);
  await expect(ways.getByRole("link", { name: "With your subscriptions" })).toHaveAccessibleDescription(/720p at most/);
  await expect(ways.getByRole("link", { name: "Step by step" })).toHaveAccessibleDescription(/GPT Image 2 → Seedance 2\.5 · 2 steps/);
  await ways.getByRole("link", { name: "Step by step" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-motion-transfer-open$/);
  // Switching what to remix keeps the chosen way.
  await page.getByRole("link", { name: "Restyle" }).click();
  await expect(page).toHaveURL(/#\/remix\/remix-restyle-open$/);
  await expect(page.getByRole("navigation", { name: "How to run" }).getByRole("link", { name: "Step by step" })).toHaveAttribute("aria-current", "page");
});

test("in Korean the ways read 한 번에 / 구독으로 / 단계별로, with translated trade-offs", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.goto("/#/remix/remix-restyle-subscription");
  const ways = page.getByRole("navigation", { name: "실행 방식" });
  await expect(ways.getByRole("link")).toHaveText(["한 번에", "구독으로", "단계별로"]);
  await expect(ways.getByText("최대 720p, 1080p는 안 돼요.")).toBeVisible();
});
