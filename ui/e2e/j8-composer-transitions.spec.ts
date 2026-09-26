import { expect, test, seedBrowser, startApp } from "./fixtures/appServer";
import { reveal } from "./fixtures/composerGeometry";
import { openCreate, selectOption, withJ6, PROVIDER_TRIGGER, MODEL_TRIGGER, j6EvidenceIdentity, type J6Seed } from "./fixtures/j6Selection";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import en from "../src/i18n/en.json" with { type: "json" };
import ko from "../src/i18n/ko.json" with { type: "json" };
import zhHans from "../src/i18n/zh-Hans.json" with { type: "json" };
import zhHant from "../src/i18n/zh-Hant.json" with { type: "json" };

const seed: J6Seed = { provider: "nai", imageModel: "nai-diffusion-5-full", nonGenerating: true,
  viewport: { width: 1280, height: 900 }, catalog: { mode: "ready", mcp: true }, evidencePrefix: "wp09-j8",
  generationDefaults: { promptMode: "direct", multimode: false } };
const POSITIVE = "WP09 distinct positive draft / 초안";
const NEGATIVE = "@not-a-mention, WP09 negative draft";
const desktop = ".sidebar__scroll > .composer--sidebar";
const sheet = "#mobile-generate-sheet";

async function drafts(root: Locator, home = false) {
  const positive = root.locator(home ? "#home-prompt-input" : ".composer__textarea");
  const negative = root.locator(".negative-prompt__textarea");
  await expect(positive).toHaveValue(POSITIVE); await expect(negative).toHaveValue(NEGATIVE);
}
async function fillDrafts(root: Locator, home = false) {
  await root.locator(home ? "#home-prompt-input" : ".composer__textarea").fill(POSITIVE);
  await root.locator(".negative-prompt__textarea").fill(NEGATIVE);
}
async function capture(page: Page, info: TestInfo, name: string, metrics: unknown = {}) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: info.outputPath(`wp09-${name}.png`) });
  await writeFile(info.outputPath(`wp09-${name}.json`), JSON.stringify({ ...j6EvidenceIdentity(), metrics }, null, 2));
}
async function openSheet(page: Page) {
  await page.locator("button.mobile-app-bar__generate").click();
  await expect(page.locator(sheet)).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(sheet)).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
}

test("T1 Home to Create to Home preserves both NovelAI drafts", async ({ browser }, info) => {
  await withJ6(browser, info, { ...seed, uiMode: "home" }, async (page, observation, origin) => {
    await page.goto(origin); await fillDrafts(page.locator(".home-prompt"), true);
    await page.locator(".nav-rail").getByRole("button", { name: "Create", exact: true }).click();
    await drafts(page.locator(desktop)); await expect(page.locator(".composer:visible")).toHaveCount(1);
    await capture(page, info, "t1-create");
    await page.locator(".nav-rail").getByRole("button", { name: "Home", exact: true }).click();
    await drafts(page.locator(".home-prompt"), true);
    await capture(page, info, "t1-home"); expect(observation.requests).toEqual([]);
  });
});

test("T2 provider round trip and real reload preserve exact NovelAI selection and drafts", async ({ browser }, info) => {
  await withJ6(browser, info, seed, async (page, observation, origin) => {
    await openCreate(page, origin); const root = page.locator(desktop); await fillDrafts(root);
    await selectOption(page, PROVIDER_TRIGGER, "MiniMax");
    await expect(root.locator(".negative-prompt__textarea")).toHaveCount(0);
    await expect(root.locator(".composer__textarea")).toHaveValue(POSITIVE);
    await expect(page.locator(MODEL_TRIGGER)).toContainText("minimax");
    await selectOption(page, PROVIDER_TRIGGER, "NovelAI"); await drafts(root);
    await page.reload(); await drafts(root);
    await expect(page.locator(MODEL_TRIGGER)).toContainText("nai v5");
    const persisted = await page.evaluate(() => ({
      defaults: JSON.parse(localStorage.getItem("ima2.generationDefaults") ?? "{}"), model: localStorage.getItem("ima2.imageModel"),
    }));
    expect(persisted.defaults.provider).toBe("nai"); expect(persisted.model).toBe("nai-diffusion-5-full");
    await expect(page.locator(".element-mention-menu")).toHaveCount(0);
    await capture(page, info, "t2-reload", { provider: persisted.defaults.provider, model: persisted.model });
    expect(observation.requests).toEqual([]);
  });
});

test("T3 prompt-studio draft survives mobile sheet remount and breakpoint round trip", async ({ browser }, info) => {
  await withJ6(browser, info, { ...seed, profile: "prompt-studio" }, async (page, observation, origin) => {
    await openCreate(page, origin); await fillDrafts(page.locator(".composer--bottom"));
    for (const width of [800, 801, 390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= 800) {
        await openSheet(page); await drafts(page.locator(`${sheet} .composer`));
        await page.locator(`${sheet} .composer__textarea`).focus();
      } else {
        await expect(page.locator(sheet)).toHaveCount(0); await drafts(page.locator(".composer--bottom"));
        await page.locator(".composer--bottom .composer__textarea").focus();
        await expect(page.locator(".composer--bottom .composer__textarea")).toBeFocused();
      }
      await capture(page, info, `t3-width-${width}`);
    }
    expect(await page.evaluate(() => localStorage.getItem("ima2.workspaceProfile"))).toBe("prompt-studio");
    await selectOption(page, PROVIDER_TRIGGER, "MiniMax");
    for (const width of [800, 801, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= 800) await openSheet(page);
      else await expect(page.locator(sheet)).toHaveCount(0);
      const root = page.locator(width <= 800 ? `${sheet} .composer` : ".composer--bottom");
      await expect(root.locator(".composer__textarea")).toHaveValue(POSITIVE);
      await expect(root.locator(".negative-prompt__textarea, .composer__prompt-panes--dual")).toHaveCount(0);
      await capture(page, info, `t3-minimax-width-${width}`);
    }
    await selectOption(page, PROVIDER_TRIGGER, "NovelAI"); await drafts(page.locator(".composer--bottom"));
    expect(observation.requests).toEqual([]);
  });
});

test("T4 mobile tabs navigate with arrows and restore the real opener on Escape", async ({ browser }, info) => {
  await withJ6(browser, info, { ...seed, viewport: { width: 390, height: 844 } }, async (page, observation, origin) => {
    await openCreate(page, origin); await openSheet(page); await fillDrafts(page.locator(`${sheet} .composer`));
    await page.locator("#mobile-sheet-tab-prompt").focus();
    for (const [key, name] of [["ArrowRight", "controls"], ["End", "library"], ["ArrowLeft", "controls"], ["Home", "prompt"]]) {
      await page.keyboard.press(key!);
      const tab = page.locator(`#mobile-sheet-tab-${name}`), panel = page.locator(`#mobile-sheet-panel-${name}`);
      await expect(tab).toBeFocused(); await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(tab).toHaveAttribute("aria-controls", `mobile-sheet-panel-${name}`);
      await expect(panel).toBeVisible(); await expect(panel).toHaveAttribute("aria-labelledby", `mobile-sheet-tab-${name}`);
    }
    await drafts(page.locator(`${sheet} .composer`)); await page.keyboard.press("Escape");
    await expect(page.locator(sheet)).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(sheet)).toHaveAttribute("inert", "");
    await expect(page.locator("button.mobile-app-bar__generate")).toBeFocused();
    await openSheet(page); await drafts(page.locator(`${sheet} .composer`));
    await capture(page, info, "t4-reopened"); expect(observation.requests).toEqual([]);
  });
});

test("MCP popup observes the selected image model without showing core GPT facts", async ({ browser }, info) => {
  await withJ6(browser, info, { ...seed, provider: "oauth", imageModel: "gpt-5.6-luna" }, async (page, observation, origin) => {
    await openCreate(page, origin); await selectOption(page, PROVIDER_TRIGGER, "Runway");
    await selectOption(page, MODEL_TRIGGER, "MCP image");
    await page.locator(".generate-row__readiness:visible").click();
    const popup = page.locator(".provider-readiness"), details = popup.locator("[data-mcp-readiness]");
    await expect(details).toHaveAttribute("data-mcp-readiness", "ready");
    await expect(details).toContainText("runway · MCP"); await expect(details).toContainText("MCP image");
    await expect(popup).not.toContainText("GPT OAuth"); await expect(popup).not.toContainText("Reasoning");
    await capture(page, info, "mcp-image-ready");
    await popup.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(details).toHaveAttribute("data-mcp-readiness", "ready");
    await popup.getByRole("button", { name: en.readiness.openAccount, exact: true }).click();
    await expect(page.getByRole("main", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Providers", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await selectOption(page, PROVIDER_TRIGGER, "GPT");
    await page.locator(".generate-row__readiness:visible").click();
    await expect(popup.locator("[data-mcp-readiness]")).toHaveCount(0); await expect(popup).toContainText("GPT OAuth");
    await popup.getByRole("button", { name: "Close", exact: true }).click();
    expect(observation.requests).toEqual([]);
  });
});

for (const width of [320, 390]) for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"] as const) {
  test(`mobile navigation ${width} ${locale}: all destinations and keyboard focus remain reachable`, async ({ browser }, info) => {
    await withJ6(browser, info, { ...seed, locale, viewport: { width, height: 844 } }, async (page, observation, origin) => {
      await page.goto(origin);
      const labels = { en, ko, "zh-Hans": zhHans, "zh-Hant": zhHant }[locale].nav;
      const nav = page.locator(".nav-rail--mobile"), buttons = nav.getByRole("button");
      await expect(buttons).toHaveCount(7);
      const dimensions = await buttons.evaluateAll((elements) => elements.map((button) => {
        const r = button.getBoundingClientRect(), label = button.querySelector(".nav-rail__label")!;
        const range = document.createRange(); range.selectNodeContents(label);
        return { text: button.getAttribute("aria-label"), width: r.width, height: r.height,
          fits: Array.from(range.getClientRects()).every((t) => t.left >= r.left - 1 && t.right <= r.right + 1 && t.top >= r.top - 1 && t.bottom <= r.bottom + 1) };
      }));
      for (const row of dimensions) { expect(row.width).toBeGreaterThanOrEqual(44); expect(row.height).toBeGreaterThanOrEqual(44); expect(row.fits).toBe(true); }
      await buttons.first().focus();
      for (let index = 0; index < 7; index++) {
        if (index) await page.keyboard.press("Tab");
        await expect(buttons.nth(index)).toBeFocused(); await expect(buttons.nth(index)).toBeInViewport({ ratio: 0.99 });
      }
      for (let index = 5; index >= 0; index--) {
        await page.keyboard.press("Shift+Tab"); await expect(buttons.nth(index)).toBeFocused();
        await expect(buttons.nth(index)).toBeInViewport({ ratio: 0.99 });
      }
      await nav.getByRole("button", { name: labels.settings, exact: true }).click();
      await expect(page.locator(".app")).toHaveClass(/app--settings-open/);
      await expect(page).toHaveURL(/#settings$/);
      await expect(nav.getByRole("button", { name: labels.settings, exact: true })).toBeInViewport({ ratio: 0.99 });
      for (const [label, mode, hash] of [[labels.home, "home", "home"], [labels.create, "classic", "create"],
        [labels.node, "node", "node"], [labels.assets, "assets", "assets"], [labels.home, "home", "home"]]) {
        const button = nav.getByRole("button", { name: label!, exact: true }); await button.click();
        await expect(page.locator(".app")).not.toHaveClass(/app--settings-open/);
        await expect(page.locator(".app")).toHaveAttribute("data-ui-mode", mode!);
        await expect(page).toHaveURL(new RegExp(`#${hash}$`));
        await expect(button).toHaveAttribute("aria-current", "page"); await expect(button).toBeInViewport({ ratio: 0.99 });
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await capture(page, info, `nav-${width}-${locale}`, { dimensions, overflow }); expect(observation.requests).toEqual([]);
    });
  });
}

for (const surface of ["classic", "home"] as const) for (const field of ["positive", "negative"] as const) {
  for (const modifier of ["Control", "Meta"] as const) {
    test(`T5 ${surface} ${field} ${modifier}: mounted input blocks composition and submits once after commit`, async ({ browser }, info) => {
      await withJ6(browser, info, { ...seed, uiMode: surface === "home" ? "home" : "classic" }, async (page, observation, origin) => {
        const requests: unknown[] = [];
        await page.route("**/api/generate", async (route) => {
          if (route.request().method() === "POST") requests.push(route.request().postDataJSON());
          await route.fulfill({ status: 400, json: { error: "WP09 synthetic admission refusal", code: "INVALID_REQUEST" } });
        });
        await page.goto(origin);
        const root = page.locator(surface === "home" ? ".home-prompt" : desktop);
        await fillDrafts(root, surface === "home");
        const input = root.locator(field === "negative" ? ".negative-prompt__textarea"
          : surface === "home" ? "#home-prompt-input" : ".composer__textarea");
        await input.focus(); await input.press("End"); await input.press("Enter");
        await expect(input).toHaveValue((field === "negative" ? NEGATIVE : POSITIVE) + "\n");
        await input.evaluate((node, modifier) => {
          node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "한" }));
          node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter",
            ctrlKey: modifier === "Control", metaKey: modifier === "Meta", isComposing: true }));
        }, modifier);
        await page.evaluate(async () => { await Promise.resolve(); });
        expect(requests).toEqual([]); expect(observation.requests).toEqual([]);
        await input.evaluate((node) => { node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" })); });
        await page.evaluate(async () => { await Promise.resolve(); });
        await input.press(`${modifier}+Enter`);
        await expect.poll(() => requests.length).toBe(1);
        expect(requests[0]).toMatchObject({ provider: "nai", model: "nai-diffusion-5-full" });
        await expect(page.locator(".element-mention-menu")).toHaveCount(0);
        await capture(page, info, `t5-${surface}-${field}-${modifier}`, { requests: requests.length, upstreamRequests: observation.requests.length });
      });
    });
  }
}

test("T6 retired attachment highlight follows the mounted textarea after scroll and resize", async ({ browser }, info) => {
  await withJ6(browser, info, { ...seed, provider: "minimax", imageModel: "image-01" }, async (page, observation, origin) => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    let metadataReads = 0;
    await page.route(`${origin}/api/metadata/read`, async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ filename: "wp09-synthetic.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` });
      metadataReads++;
      await route.fulfill({ json: { ok: true, metadata: null, source: null } });
    });
    await openCreate(page, origin); const root = page.locator(desktop), input = root.locator(".composer__textarea");
    await root.locator("input[type=file]").setInputFiles({ name: "wp09-synthetic.png", mimeType: "image/png",
      buffer: png });
    await expect(root.locator(".composer__tray [role=listitem]")).toHaveCount(1);
    await expect(input).toHaveValue(/@Image_1/);
    await root.locator(".composer__tray-remove").click();
    await expect(root.locator(".composer__tray [role=listitem]")).toHaveCount(0);
    await expect(input).toHaveValue(/@Image_1/);
    await input.fill(Array.from({ length: 60 }, (_, index) => `line ${index} @Image_1`).join("\n"));
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await input.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
      const metrics = () => root.evaluate((element) => {
        const input = element.querySelector<HTMLTextAreaElement>(".composer__textarea")!;
        const mirror = element.querySelector<HTMLElement>(".composer__prompt-mirror")!;
        const actual = getComputedStyle(mirror), expected = getComputedStyle(input);
        /* Text-geometry keys must match exactly. Dimensional keys (width/height)
           tolerate sub-px divergence: the mirror is absolute inset:0 and resolves
           through the containing block's used height, while the textarea resolves
           its own percentage — the two paths can land one Chromium layout quantum
           (1/64px) apart after any flex redistribution, with no visual effect. */
        const keys = ["width", "height", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "lineHeight", "fontSize"] as const;
        const DIMENSIONAL = new Set<string>(["width", "height"]);
        const marks = Array.from(mirror.querySelectorAll<HTMLElement>(".dead-tag"));
        const box = input.getBoundingClientRect();
        const visible = marks.map((mark) => mark.getBoundingClientRect()).find((r) => r.top >= box.top && r.bottom <= box.bottom);
        return { aligned: keys.every((key) => DIMENSIONAL.has(key)
          ? Math.abs(parseFloat(actual[key]) - parseFloat(expected[key])) < 0.02
          : actual[key] === expected[key]), scrollTop: input.scrollTop,
          mirrorScrollTop: mirror.scrollTop, markCount: marks.length, pointerTransparent: actual.pointerEvents === "none",
          hitTextarea: !!visible && document.elementFromPoint(visible.left + visible.width / 2, visible.top + visible.height / 2) === input };
      });
      await expect.poll(async () => { const m = await metrics(); return m.aligned && m.scrollTop === m.mirrorScrollTop && m.hitTextarea; }).toBe(true);
      const result = await metrics(); expect(result.markCount).toBe(60); expect(result.scrollTop).toBeGreaterThan(0);
      expect(result.pointerTransparent).toBe(true); await capture(page, info, `t6-mirror-${width}`, result);
    }
    expect(metadataReads).toBe(1); expect(observation.requests).toEqual([]);
  });
});

for (const scenario of ["default", "image", "video", "missing", "model-locked", "locked", "disconnected", "malformed", "retry"] as const) {
  test(`MCP observed facts ${scenario}: current selection, execution locks and recovery`, async ({ browser }, info) => {
    await withJ6(browser, info, { ...seed, provider: "oauth", imageModel: "gpt-5.6-luna" }, async (page, observation, origin) => {
      let phase: string = "ready", providerReads = 0;
      await page.route(`${origin}/api/mcp/providers`, async (route) => {
        providerReads++;
        if (phase === "retry") { await route.fulfill({ status: 503, json: { error: "synthetic read failure" } }); return; }
        await route.fulfill({ json: { ok: true, providers: [{ id: "runway", endpoint: "http://synthetic.invalid",
          enabled: phase === "malformed" ? "wrong-type" : true, executable: phase !== "locked",
          status: { provider: "runway", state: phase === "disconnected" ? "disconnected" : "connected", toolCount: 1 } }] } });
      });
      await page.route(`${origin}/api/mcp/providers/runway/models`, async (route) => {
        const row = (label: string) => ({ id: "same-id", label, executable: phase !== "model-locked",
          capabilities: { source: "verified-contract", aspectRatios: [], parameters: [], inputRoles: ["text"] } });
        await route.fulfill({ json: { ok: true, models: {
          image: phase === "missing" ? [] : [row("Same ID image")], video: [row("Same ID video")],
        } } });
      });
      await openCreate(page, origin); await selectOption(page, PROVIDER_TRIGGER, "Runway");
      if (scenario !== "default") await selectOption(page, MODEL_TRIGGER, scenario === "video" ? "Same ID video" : "Same ID image");
      phase = scenario;
      await page.locator(".generate-row__readiness:visible").click();
      const popup = page.locator(".provider-readiness"), detail = popup.locator("[data-mcp-readiness]");
      const expected = ({ default: "default", image: "ready", video: "ready", missing: "model-missing",
        "model-locked": "model-locked", locked: "locked", disconnected: "disconnected", malformed: "error", retry: "error" })[scenario];
      await expect(detail).toHaveAttribute("data-mcp-readiness", expected);
      await expect(detail).toContainText("runway · MCP");
      await expect(detail.locator("dl > div").nth(2).locator("dd")).toHaveText(scenario === "video" ? "Video" : "Image");
      await expect(popup).not.toContainText("GPT OAuth"); await expect(popup).not.toContainText("Reasoning");
      if (scenario === "image" || scenario === "video") await expect(detail).toContainText(scenario === "video" ? "Same ID video" : "Same ID image");
      if (scenario === "default") await expect(detail).toContainText("Provider default model");
      await capture(page, info, `mcp-${scenario}`, { providerReads, expected });
      if (scenario === "retry") {
        const before = providerReads; phase = "ready";
        await popup.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(detail).toHaveAttribute("data-mcp-readiness", "ready");
        expect(providerReads).toBeGreaterThan(before); await expect(detail).toContainText("Same ID image");
        await capture(page, info, "mcp-recovered");
      }
      await popup.getByRole("button", { name: "Close", exact: true }).click();
      expect(observation.requests).toEqual([]);
    });
  });
}

test("MCP popup close aborts its pending observation and reopening reads fresh state", async ({ browser }, info) => {
  await withJ6(browser, info, { ...seed, provider: "oauth", imageModel: "gpt-5.6-luna" }, async (page, observation, origin) => {
    let hold = false, release!: () => void, arrived!: () => void, aborted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const submitted = new Promise<void>((resolve) => { arrived = resolve; });
    const cancelled = new Promise<void>((resolve) => { aborted = resolve; });
    let heldRequest: import("@playwright/test").Request | undefined;
    const pending = new Set<Promise<void>>();
    page.on("requestfailed", (request) => { if (request === heldRequest) aborted(); });
    await page.route(`${origin}/api/mcp/providers`, async (route) => {
      const send = async () => {
        if (hold) { heldRequest = route.request(); arrived(); await gate; }
        try { await route.fulfill({ json: { ok: true, providers: [{ id: "runway", endpoint: "http://synthetic.invalid",
          enabled: true, executable: true, status: { provider: "runway", state: "connected", toolCount: 1 } }] } }); }
        catch (error) { if (route.request() !== heldRequest) throw error; }
      };
      const work = send(); pending.add(work); try { await work; } finally { pending.delete(work); }
    });
    try {
      await openCreate(page, origin); await selectOption(page, PROVIDER_TRIGGER, "Runway");
      await selectOption(page, MODEL_TRIGGER, "MCP image"); hold = true;
      await page.locator(".generate-row__readiness:visible").click(); await submitted;
      const popup = page.locator(".provider-readiness");
      await expect(popup.locator("[data-mcp-readiness]")).toHaveAttribute("data-mcp-readiness", "loading");
      await popup.getByRole("button", { name: "Close", exact: true }).click();
      await cancelled; hold = false; release(); await Promise.all([...pending]);
      await expect(popup).toHaveCount(0);
      await page.locator(".generate-row__readiness:visible").click();
      await expect(popup.locator("[data-mcp-readiness]")).toHaveAttribute("data-mcp-readiness", "ready");
      await capture(page, info, "mcp-cancel-reopen", { aborted: true, pending: pending.size });
      await popup.getByRole("button", { name: "Close", exact: true }).click(); expect(observation.requests).toEqual([]);
    } finally { hold = false; release(); await Promise.allSettled([...pending]); }
  });
});

for (const width of [390, 1280]) test(`Home mode roster ${width}: real destinations preserve the composer draft`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const app = await startApp("minimax", { withoutMinimaxKey: true });
  try {
    await seedBrowser(page, { provider: "nai", imageModel: "nai-diffusion-5-full", dismissOnboarding: true,
      generationDefaults: { promptMode: "direct", multimode: false } });
    await page.goto(app.baseUrl);
    await page.locator(".nav-rail").getByRole("button", { name: "Home", exact: true }).click();
    await fillDrafts(page.locator(".home-prompt"), true);
    for (const [label, mode, hash, workspace] of [["Create", "classic", "create", ".canvas"],
      ["Node graph", "node", "node", ".node-canvas"], ["Agent", "agent", "agent", ".agent-workspace"],
      ["Assets", "assets", "assets", ".assets-workspace"]]) {
      const destination = page.locator(".home-modes__item").filter({ has: page.locator(".home-modes__label", { hasText: new RegExp(`^${label}$`) }) });
      const metrics = await reveal(destination, true); await capture(page, info, `home-roster-${width}-${hash}`, metrics);
      await destination.click(); await expect(page.locator(".app")).toHaveAttribute("data-ui-mode", mode!);
      await expect(page).toHaveURL(new RegExp(`#${hash}$`)); await expect(page.locator(workspace!)).toBeVisible();
      await page.locator(".nav-rail").getByRole("button", { name: "Home", exact: true }).click();
      await drafts(page.locator(".home-prompt"), true);
    }
    expect(app.stub.generationRequests).toEqual([]);
  } finally { await page.close(); await app.close(); }
});

for (const width of [390, 1280]) test(`Node default and explicit fit ${width}: HUD controls remain reachable`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); const app = await startApp("minimax");
  try {
    await seedBrowser(page, { dismissOnboarding: true }); await page.goto(app.baseUrl);
    await page.locator(".nav-rail").getByRole("button", { name: "Node graph", exact: true }).click();
    await expect(page.locator(".node-canvas__loading")).toHaveCount(0);
    await page.getByRole("button", { name: /Start with a blank canvas|Start blank/i }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await capture(page, info, `node-default-fit-${width}`);
    const fit = page.locator(".react-flow__controls-fitview"); await fit.click();
    await expect(page.locator(".react-flow__node")).toBeInViewport();
    for (const button of await page.locator(".node-studio-toolbar button, .node-batch-bar button, .node-studio-element-panel button, .node-canvas__controls button").all()) {
      if (!await button.isVisible()) continue;
      await reveal(button);
      if (await button.isEnabled()) await button.click({ trial: true });
    }
    const geometry = await page.locator(".node-canvas").evaluate((element) => {
      const selectors = [".node-studio-toolbar", ".node-studio-element-panel", ".node-canvas__controls", ".react-flow__node"];
      return selectors.map((selector) => {
        const node = element.querySelector(selector); if (!node) throw Error("Missing node HUD anchor");
        const r = node.getBoundingClientRect(); return { selector, left: r.left, top: r.top, width: r.width, height: r.height };
      });
    });
    await capture(page, info, `node-explicit-fit-${width}`, geometry); expect(app.stub.generationRequests).toEqual([]);
  } finally { await page.close(); await app.close(); }
});

for (const [field, interruption] of [["positive", "viewport"], ["negative", "viewport"], ["negative", "provider"]] as const) {
  test(`composition interrupted by ${interruption}: remounted ${field} input can submit`, async ({ browser }, info) => {
    await withJ6(browser, info, seed, async (page, observation, origin) => {
      let submissions = 0;
      await page.route("**/api/generate", async (route) => {
        if (route.request().method() === "POST") submissions++;
        await route.fulfill({ status: 400, json: { error: "synthetic admission refusal", code: "INVALID_REQUEST" } });
      });
      await openCreate(page, origin); await fillDrafts(page.locator(desktop));
      const selector = field === "positive" ? ".composer__textarea" : ".negative-prompt__textarea";
      const original = page.locator(`${desktop} ${selector}`); await original.focus();
      await original.evaluate((node) => { node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "한" })); });
      if (interruption === "viewport") { await page.setViewportSize({ width: 390, height: 844 }); await openSheet(page); }
      else {
        await selectOption(page, PROVIDER_TRIGGER, "MiniMax"); await expect(original).toHaveCount(0);
        await selectOption(page, PROVIDER_TRIGGER, "NovelAI");
      }
      expect(submissions).toBe(0);
      const root = page.locator(interruption === "viewport" ? `${sheet} .composer` : desktop); await drafts(root);
      await root.locator(selector).press("Control+Enter"); await expect.poll(() => submissions).toBe(1);
      await capture(page, info, `composition-interrupt-${field}-${interruption}`, { submissions, upstreamSubmissions: observation.requests.length });
    });
  });
}
