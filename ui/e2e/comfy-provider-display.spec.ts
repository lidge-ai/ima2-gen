import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures/appServer";
import { preflightJ6, withJ6, selectOption, PROVIDER_TRIGGER, type J6CatalogState, type J6Seed } from "./fixtures/j6Selection";
import { openComfyPanel, readable, displayEvidence } from "./fixtures/comfyDisplayEvidence";
import type { LaneCatalog } from "../src/lib/api-comfy";

test.beforeAll(async ({}, info) => { await preflightJ6(info, "wp08c"); });
const BASE: J6Seed = { provider: "comfy", imageModel: "gpt-6-luna", nonGenerating: true,
  expectedSubmissions: 0, evidencePrefix: "wp08c", generationDefaults: { comfyWorkflow: "wf-selected", comfyVideoWorkflow: null, prompt: "Keep this draft" } };
const control = (panel: Locator) => panel.getByTestId("comfy-generation-controls");
const status = (panel: Locator) => panel.locator(".provider-status-line__value");
const refresh = (panel: Locator) => control(panel).getByRole("button", { name: "Refresh", exact: true });
async function choose(page: Page, panel: Locator, label: string) {
  await control(panel).getByRole("combobox").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
function catalog(image: Array<{ id: string; label: string; executable?: boolean; description?: string }> = [],
  video: Array<{ id: string; label: string; executable?: boolean; description?: string }> = [], state = "ready"): LaneCatalog {
  return { comfy: { status: state as "ready" | "disconnected" | "locked" | "key-missing", models: { image, video } },
    oauth: { status: "ready", models: { image: [{ id: "gpt-6-luna", label: "GPT" }], video: [] } } };
}

test("held shared read then ready; a pending catalog is drained on teardown", async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, catalog: { mode: "loading" } }, async (page, capture, origin) => {
    const panel = await openComfyPanel(page, origin);
    await expect(status(panel)).toHaveText("Checking workflows…");
    await expect(panel.locator(".provider-auth-chip")).toHaveText("Local HTTP");
    await expect(panel.locator(".provider-auth-chip__state")).toHaveCount(0);
    await expect(panel.locator(".provider-status-line")).toHaveAttribute("data-tone", "warn");
    await displayEvidence(page, info, "held", capture, panel);
    capture.catalog.mode = "ready"; capture.releaseCatalog();
    await expect(status(panel)).toHaveText("Available at the last catalog check.");
    await expect(control(panel).getByRole("combobox")).toContainText("Selected image");
    await displayEvidence(page, info, "released", capture, panel);
    capture.catalog.mode = "loading"; await refresh(panel).click();
    await expect(control(panel)).toHaveAttribute("aria-busy", "true");
    // Intentionally leave it held: withJ6 must abort/release before closing.
  });
});

for (const failure of ["error", "invalid", "schema"] as const) {
  test(`refresh ${failure} keeps selection and draft, retry restores the shared observation`, async ({ browser }, info) => {
    await withJ6(browser, info, BASE, async (page, capture, origin) => {
      const panel = await openComfyPanel(page, origin);
      await expect(status(panel)).toHaveText("Available at the last catalog check.");
      const beforeReads = capture.catalogReads;
      capture.catalog.mode = "loading"; await refresh(panel).click();
      await expect(status(panel)).toHaveText("Refreshing the last observation…");
      await expect(control(panel).getByRole("combobox")).toContainText("Selected image");
      capture.catalog.mode = failure; capture.releaseCatalog();
      await expect(status(panel)).toHaveText("Could not read the workflow catalog.");
      await expect(panel.locator(".provider-status-line")).toHaveAttribute("data-tone", "bad");
      await expect(page.locator(".composer__textarea:visible")).toHaveValue("Keep this draft");
      await displayEvidence(page, info, `refresh-${failure}`, capture, panel, { beforeReads });
      capture.catalog.mode = "ready"; await refresh(panel).click();
      await expect(status(panel)).toHaveText("Available at the last catalog check.");
      await expect(control(panel).getByRole("combobox")).toContainText("Selected image");
      await expect(page.locator(".composer__textarea:visible")).toHaveValue("Keep this draft");
      expect(capture.catalogReads).toBeGreaterThanOrEqual(beforeReads + 2);
      await displayEvidence(page, info, `retry-${failure}`, capture, panel);
    });
  });
}

const states: Array<{ name: string; catalog: J6CatalogState; selected?: string | null; message: string }> = [
  { name: "empty-ready", catalog: { mode: "ready", lanes: catalog() }, selected: null, message: "No workflows registered." },
  { name: "empty-disconnected", catalog: { mode: "ready", lanes: catalog([], [], "disconnected") }, selected: null, message: "No workflows registered." },
  { name: "missing-lane", catalog: { mode: "missing" }, message: "Workflow availability is unknown." },
  { name: "locked-lane", catalog: { mode: "ready", lanes: catalog([], [], "locked") }, message: "Workflow availability is unknown." },
  { name: "key-missing", catalog: { mode: "key-missing" }, message: "Workflow availability is unknown." },
  { name: "disconnected", catalog: { mode: "disconnected" }, message: "offline" },
  { name: "malformed-row", catalog: { mode: "malformed" }, message: "Could not read the workflow catalog." },
  { name: "auth401", catalog: { mode: "app-auth401" }, message: "App access is required to read the catalog." },
  { name: "auth403", catalog: { mode: "app-auth403" }, message: "App access is required to read the catalog." },
  { name: "deleted-last", catalog: { mode: "ready", lanes: catalog() }, message: "The selected workflow is no longer listed." },
  { name: "opposite-kind", catalog: { mode: "ready", lanes: catalog([], [{ id: "wf-selected", label: "Video only" }]) }, message: "The selected workflow is no longer listed." },
];
for (const entry of states) test(`Comfy ${entry.name} is a named local observation, not authentication`, async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, catalog: entry.catalog,
    generationDefaults: { ...BASE.generationDefaults, comfyWorkflow: entry.selected === undefined ? "wf-selected" : entry.selected } }, async (page, capture, origin) => {
    const panel = await openComfyPanel(page, origin);
    await expect(status(panel)).toHaveText(entry.message);
    await expect(panel.locator(".provider-status-line")).not.toHaveAttribute("data-tone", "ok");
    await expect(panel.locator(".provider-auth-chip")).toHaveText("Local HTTP");
    await expect(panel.locator(".provider-auth-chip")).toHaveAttribute("title", "Local HTTP");
    await expect(panel.locator(".provider-auth-chip__state")).toHaveCount(0);
    await expect(page.locator("#sidebar-generation-provider:visible")).toContainText("ComfyUI");
    await expect(panel.locator(".provider-compat-details, .size-picker, .multimode-toggle")).toHaveCount(0);
    await expect(panel.getByText("Quality", { exact: true })).toHaveCount(0);
    await displayEvidence(page, info, entry.name, capture, panel);
  });
});

for (const locked of [false, true]) test(`selected ${locked ? "locked" : "offline"} is distinct from another online workflow`, async ({ browser }, info) => {
  const lanes = catalog([{ id: "wf-selected", label: "Selected unavailable", ...(locked ? { executable: false } : { description: "origin (offline)" }) },
    { id: "online", label: "Online alternative" }]);
  await withJ6(browser, info, { ...BASE, catalog: { mode: "ready", lanes } }, async (page, capture, origin) => {
    const panel = await openComfyPanel(page, origin);
    await expect(status(panel)).toHaveText(locked ? "The selected workflow is locked." : "The selected workflow was offline at the last check.");
    await control(panel).getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Selected unavailable", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await choose(page, panel, "Online alternative");
    await expect(status(panel)).toHaveText("Available at the last catalog check.");
    await expect(control(panel).locator("code")).toHaveText("online");
    await displayEvidence(page, info, locked ? "selected-locked" : "selected-offline", capture, panel);
  });
});

test("image/video same ID and video-only first visit preserve media kind without auto-selection", async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, generationDefaults: { ...BASE.generationDefaults, comfyWorkflow: null },
    catalog: { mode: "ready", lanes: catalog([], [{ id: "shared", label: "Shared video" }]) } }, async (page, capture, origin) => {
    const panel = await openComfyPanel(page, origin);
    await expect(status(panel)).toHaveText("Choose a workflow");
    await expect(control(panel).locator("code")).toHaveCount(0);
    await choose(page, panel, "Shared video");
    await expect(control(panel).getByRole("combobox")).toContainText("Shared video");
    capture.catalog.lanes = catalog([{ id: "shared", label: "Shared image" }], [{ id: "shared", label: "Shared video" }]);
    await refresh(panel).click(); await expect(status(panel)).toHaveText("Available at the last catalog check.");
    await choose(page, panel, "Shared image");
    await expect(control(panel).getByRole("combobox")).toContainText("Shared image");
    await choose(page, panel, "Shared video");
    await expect(control(panel).getByRole("combobox")).toContainText("Shared video");
    await displayEvidence(page, info, "media-kind", capture, panel);
  });
});

test("Comfy to GPT to Comfy and actual MCP selection retain their own controls", async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, catalog: { mode: "ready", mcp: true } }, async (page, capture, origin) => {
    const panel = await openComfyPanel(page, origin);
    await expect(control(panel)).toBeVisible();
    await selectOption(page, PROVIDER_TRIGGER, "GPT");
    await expect(control(panel)).toHaveCount(0); await expect(panel.locator(".provider-compat-details")).toBeVisible();
    await selectOption(page, PROVIDER_TRIGGER, "ComfyUI");
    await expect(control(panel).getByRole("combobox")).toContainText("Selected image");
    await selectOption(page, PROVIDER_TRIGGER, "Runway");
    await expect(control(panel)).toHaveCount(0);
    await expect(panel.locator(".provider-auth-chip")).toContainText("MCP");
    await expect(panel).not.toContainText("Local HTTP");
    await displayEvidence(page, info, "mcp-priority", capture, panel);
  });
});

const TEXT = {
  en: { local: "Local HTTP", available: "Available at the last catalog check.", refresh: "Refresh", manage: "Manage workflows" },
  ko: { local: "로컬 HTTP", available: "최근 목록 확인 때 사용 가능했습니다.", refresh: "다시 확인", manage: "워크플로 관리" },
  "zh-Hans": { local: "本地 HTTP", available: "上次检查目录时可用。", refresh: "刷新", manage: "管理工作流" },
  "zh-Hant": { local: "本機 HTTP", available: "上次檢查目錄時可用。", refresh: "重新整理", manage: "管理工作流" },
};
for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"] as const) for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`Comfy Controls ${locale} ${viewport.width} labels and descriptions remain reachable`, async ({ browser }, info) => {
    await withJ6(browser, info, { ...BASE, locale, viewport }, async (page, capture, origin) => {
      const panel = await openComfyPanel(page, origin), controls = control(panel);
      await expect(status(panel)).toHaveText(TEXT[locale].available);
      await expect(panel.locator(".provider-auth-chip")).toHaveText(TEXT[locale].local);
      const providerChoice = panel.locator(".provider-status-select [role='combobox']");
      await expect(providerChoice.locator(".ctl-select__value")).toHaveText(`ComfyUI ${TEXT[locale].local}`);
      await expect(providerChoice.locator(".ctl-select__value-sub")).toHaveCount(0);
      const all = await page.locator("[data-testid='comfy-generation-controls'] [role='combobox']").evaluateAll((elements) =>
        elements.map((element) => ({ id: element.id, description: element.getAttribute("aria-describedby") })));
      expect(all.length).toBeGreaterThan(0);
      expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
      expect(new Set(all.map((item) => item.description)).size).toBe(all.length);
      for (const item of all) {
        expect(item.id).toBeTruthy(); expect(item.description).toBeTruthy();
        await expect(page.locator(`[id=${JSON.stringify(item.description)}]`)).toHaveCount(1);
      }
      expect(await panel.locator(".provider-status-select [role='combobox']").getAttribute("aria-describedby")).toBe(null);
      const metrics = [];
      for (const target of [providerChoice, status(panel), controls.getByRole("combobox"), controls.getByRole("button", { name: TEXT[locale].refresh, exact: true }),
        controls.getByRole("button", { name: TEXT[locale].manage, exact: true })]) metrics.push(await readable(target, true));
      await displayEvidence(page, info, `a11y-${locale}-${viewport.width}`, capture, panel, { all, metrics });
    });
  });
}

test("320px catalog error keeps the recovery row and selection controls visible", async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, viewport: { width: 320, height: 740 }, catalog: { mode: "error" } }, async (page, capture, origin) => {
    await page.goto(origin);
    const row = page.locator(".mobile-app-bar .gen-provider-model__catalog-state");
    await expect(row).toContainText("Could not read the workflow catalog.");
    const metrics = await readable(row);
    const spacing = await row.evaluate((element) => {
      const text = element.querySelector("span")!.getBoundingClientRect();
      const button = element.querySelector("button")!.getBoundingClientRect();
      return { separated: button.left >= text.right + 7 || button.top >= text.bottom + 3 };
    });
    expect(spacing.separated).toBe(true);
    await readable(row.getByRole("button", { name: "Refresh", exact: true }), true);
    await displayEvidence(page, info, "narrow-error", capture, page.locator(".mobile-app-bar"), metrics);
  });
});

test("Comfy readiness popup names the selected video and opens workflow management", async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, generationDefaults: { ...BASE.generationDefaults, comfyVideoWorkflow: "wf-video-selected" } }, async (page, capture, origin) => {
    await openComfyPanel(page, origin);
    await page.locator(".generate-row__readiness:visible").click();
    const dialog = page.locator(".provider-readiness");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("strong")).toHaveText("Available at the last catalog check.");
    await expect(dialog.locator(".provider-readiness__facts")).toContainText("Selected video");
    await expect(dialog.locator(".provider-readiness__facts")).toContainText("wf-video-selected");
    await expect(dialog).not.toContainText("GPT");
    await expect(dialog.locator(".modal__hint")).toHaveCount(0);
    await displayEvidence(page, info, "selected-video-popup", capture, dialog);
    await dialog.getByRole("button", { name: "Manage workflows", exact: true }).click();
    await expect(page.locator(".settings-workspace")).toBeVisible();
    await expect(page.locator("#comfy-workflow-manager-title")).toBeVisible();
    await page.locator("#comfy-workflow-manager-title").scrollIntoViewIfNeeded();
    await expect(page.locator("#comfy-workflow-manager-title")).toBeInViewport();
    await displayEvidence(page, info, "manage-workflows", capture, page.locator(".settings-workspace"));
  });
});

test("Home can select unavailable Comfy for setup without submitting or losing its draft", async ({ browser }, info) => {
  await withJ6(browser, info, { ...BASE, provider: "oauth", uiMode: "home", catalog: { mode: "empty" } }, async (page, capture, origin) => {
    await page.goto(origin);
    const home = page.locator(".home-prompt");
    await expect(home).toBeVisible();
    await home.getByRole("combobox").click();
    const option = page.getByRole("option").filter({ has: page.getByText("ComfyUI", { exact: true }) });
    await expect(option).not.toHaveAttribute("aria-disabled", "true"); await option.click();
    await expect(home.getByRole("combobox")).toContainText("ComfyUI");
    await expect(home.getByRole("combobox")).toContainText("No workflows registered.");
    await expect(home.locator("textarea")).toHaveValue("Keep this draft");
    await displayEvidence(page, info, "home-unavailable-setup", capture, home);
  });
});
