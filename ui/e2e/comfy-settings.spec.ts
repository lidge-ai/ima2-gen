import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStaticApp, STATIC_ORIGIN, type StaticApp, type StaticLocale } from "./fixtures/staticClassicApp";

// The ComfyUI section of Settings: what a person sees when the server lacks something the workflow
// needs, when a file input has no role yet, when the file is the editor format, when the server is
// off, and the list of servers beyond this computer. The built UI runs on a synthetic origin and
// every /api/comfy answer below is a fixture shaped like routes/comfy.ts answers.

const SHOTS = process.env.L13_SHOTS;
const TOKEN = "fixture-token-never-shown";
const ORIGIN = "http://127.0.0.1:8188";
const API_GRAPH = { "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox" } }, "9": { class_type: "SaveVideo", inputs: {} } };
const EDITOR_GRAPH = { last_node_id: 3, nodes: [{ id: 1, type: "KSampler" }], links: [], version: 0.4 };
const WORKFLOWS = [
  { id: "klein", label: "FLUX.2 klein", origin: ORIGIN, mediaKind: "image", bind: { prompt: { node: "74", input: "text" }, output: { node: "9" } }, params: [], createdAt: 1, updatedAt: 1, health: { ok: true, version: "0.46.0" } },
  { id: "wan-i2v", label: "Wan 2.2 image to video", origin: "https://comfy.example.com", mediaKind: "video", bind: { prompt: { node: "6", input: "text" }, output: { node: "9" } }, params: [], createdAt: 1, updatedAt: 1, health: { ok: false, reason: "timeout" } },
  { id: "ace-step", label: "ACE-Step song", origin: ORIGIN, mediaKind: "audio", bind: { prompt: { node: "3", input: "tags" }, output: { node: "8" } }, params: [], createdAt: 1, updatedAt: 1, health: { ok: true } },
];
const CANDIDATES = [
  { field: "prompt", node: "6", input: "text", classType: "CLIPTextEncode", title: "Positive", unambiguous: true },
  { field: "seed", node: "3", input: "seed", classType: "KSampler", unambiguous: true },
  { field: "output", node: "9", input: "", classType: "SaveVideo", unambiguous: true },
];
const SLOTS = [
  { kind: "image", node: "52", input: "image", classType: "LoadImage", title: "Start" },
  { kind: "image", node: "53", input: "image", classType: "LoadImage", title: "End" },
  { kind: "audio", node: "60", input: "audio", classType: "LoadAudio", role: "source-audio" },
];
const PROBLEMS = {
  origin: ORIGIN, reachable: true,
  missingNodes: [{ classType: "WanAnimateToVideo", nodes: ["12", "14"] }],
  missingChoices: [
    { node: "4", classType: "UNETLoader", input: "unet_name", value: "wan2.2_ti2v_5B_fp16.safetensors", model: true },
    { node: "8", classType: "KSampler", input: "scheduler", value: "beta57", model: false },
  ],
  paidNodes: ["KlingImage2VideoNode"],
};

interface Fixture { server: unknown; calls: Array<{ method: string; path: string; body: unknown }>; remotes: Array<{ origin: string; hasToken: boolean; insecure: boolean }> }

async function installComfy(page: Page, server: unknown): Promise<Fixture> {
  const fixture: Fixture = { server, calls: [], remotes: [
    { origin: "https://comfy.example.com", hasToken: true, insecure: false },
    { origin: "http://192.168.0.24:8188", hasToken: false, insecure: true },
  ] };
  await page.route("**/api/comfy/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.method() === "GET" ? null : request.postDataJSON() as Record<string, unknown> | null;
    fixture.calls.push({ method: request.method(), path: url.pathname, body });
    const key = request.method() + " " + url.pathname;
    if (key === "GET /api/comfy/workflows") return route.fulfill({ json: { ok: true, workflows: WORKFLOWS } });
    if (key === "POST /api/comfy/inspect") {
      return route.fulfill({ json: { ok: true, nodes: [], candidates: CANDIDATES, needsConfirmation: false, mediaKind: "video",
        mediaSlots: (fixture.server as { reachable?: boolean }).reachable ? SLOTS : [], server: fixture.server } });
    }
    if (key === "POST /api/comfy/probe") return route.fulfill({ json: { ok: true, origin: ORIGIN, health: { ok: true, version: "0.46.0" } } });
    if (key === "POST /api/comfy/workflows") {
      return route.fulfill({ json: { ok: true, workflow: { ...WORKFLOWS[1], id: String(body?.id), origin: ORIGIN }, server: fixture.server, media: { model: "comfy/" + String(body?.id), task: "image-to-video" } } });
    }
    if (key === "GET /api/comfy/remotes") return route.fulfill({ json: { ok: true, remotes: fixture.remotes } });
    if (key === "PUT /api/comfy/remotes") {
      const remote = { origin: String(body?.origin), hasToken: typeof body?.token === "string", insecure: false };
      fixture.remotes = [...fixture.remotes, remote];
      return route.fulfill({ json: { ok: true, remote } });
    }
    if (key === "DELETE /api/comfy/remotes") {
      fixture.remotes = fixture.remotes.filter((remote) => remote.origin !== url.searchParams.get("origin"));
      return route.fulfill({ json: { ok: true, origin: url.searchParams.get("origin"), strandedWorkflows: ["wan-i2v"] } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: "not in this fixture" } } });
  });
  return fixture;
}

async function openSettings(app: StaticApp, server: unknown): Promise<Fixture> {
  const fixture = await installComfy(app.page, server);
  await app.page.goto(STATIC_ORIGIN + "/#settings");
  await app.page.locator("#comfy-workflow-manager-title").scrollIntoViewIfNeeded();
  await expect(app.page.locator(".comfy-workflow-table tbody tr")).toHaveCount(3);
  return fixture;
}

const chooseFile = (page: Page, name: string, graph: unknown) =>
  page.locator("#comfy-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(graph)) });

async function shot(page: Page, name: string, target: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.locator(target).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, name + ".png") });
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test("a workflow is checked against its server, file inputs need a role, and registering says how to use it", async ({ browser }) => {
  const app = await openStaticApp(browser, { viewport: { width: 1440, height: 900 } });
  try {
    const fixture = await openSettings(app, PROBLEMS);
    const page = app.page;
    // The list names each workflow's kind, including audio, and the media model it is listed as.
    await expect(page.locator(".comfy-workflow-table tbody tr").nth(2)).toContainText("Audio");
    await expect(page.locator(".comfy-workflow-table tbody tr").nth(2)).toContainText("comfy/ace-step");
    expect(fixture.calls.filter((call) => call.path === "/api/comfy/remotes")).toHaveLength(0);

    await chooseFile(page, "wan-i2v.json", API_GRAPH);
    const report = page.locator(".comfy-report--warn").first();
    await expect(report).toContainText(ORIGIN + " lacks something this workflow needs.");
    const inspect = fixture.calls.find((call) => call.path === "/api/comfy/inspect");
    expect((inspect?.body as { origin?: string }).origin, "the inspection names the server").toBe(ORIGIN);
    await expect(report).toContainText("WanAnimateToVideo");
    await expect(report).toContainText("wan2.2_ti2v_5B_fp16.safetensors");
    await expect(report).toContainText("beta57");
    await expect(report).toContainText("KlingImage2VideoNode");
    await expect(page.locator("#comfy-kind")).toHaveValue("video");

    // The audio input is settled by the graph; the two images are not, and block registration until a person says.
    await expect(page.locator("#comfy-slot-60-audio")).toHaveValue("source-audio");
    const register = page.getByRole("button", { name: "Register", exact: true });
    await expect(register).toBeDisabled();
    await page.locator("#comfy-slot-52-image").selectOption("first-frame");
    await expect(register).toBeDisabled();
    await page.locator("#comfy-slot-53-image").selectOption("last-frame");
    await expect(register).toBeEnabled();
    await register.click();

    const sent = fixture.calls.find((call) => call.method === "POST" && call.path === "/api/comfy/workflows")?.body as { bind: { inputs: unknown[] }; origin: string };
    expect(sent.origin).toBe(ORIGIN);
    expect(sent.bind.inputs).toEqual([
      { kind: "image", role: "first-frame", node: "52", input: "image" }, { kind: "image", role: "last-frame", node: "53", input: "image" },
      { kind: "audio", role: "source-audio", node: "60", input: "audio" },
    ]);
    await expect(page.locator(".comfy-report--ok")).toContainText("Registered. It is listed in the model picker as comfy/wan-i2v.");
    await expect(page.locator(".comfy-report--ok")).toContainText("ima2 media run --model comfy/wan-i2v --task image-to-video");
    // What the server lacks is still said after registering.
    await expect(page.locator(".comfy-report--warn")).toContainText("WanAnimateToVideo");
    await expect(page.locator("#comfy-id")).toHaveCount(0);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("the editor format is explained on the spot and never sent; a server that is off is said to be off", async ({ browser }) => {
  const app = await openStaticApp(browser, { viewport: { width: 1440, height: 900 } });
  try {
    const fixture = await openSettings(app, { origin: ORIGIN, reachable: false, reason: "connect ECONNREFUSED 127.0.0.1:8188" });
    const page = app.page;
    await chooseFile(page, "canvas.json", EDITOR_GRAPH);
    const help = page.getByRole("alert");
    await expect(help).toContainText("This file is ComfyUI's editor format, which cannot be registered.");
    await expect(help.locator("li")).toHaveText(["Open the workflow in ComfyUI.", "Choose Workflow > Export (API).", "Choose the exported file here."]);
    await expect(page.locator("#comfy-id")).toHaveCount(0);
    expect(fixture.calls.filter((call) => call.path === "/api/comfy/inspect")).toHaveLength(0);

    await chooseFile(page, "wan-i2v.json", API_GRAPH);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const report = page.locator(".comfy-report--warn");
    await expect(report).toContainText(ORIGIN + " did not answer, so the workflow was not checked against it.");
    await expect(report).toContainText("connect ECONNREFUSED 127.0.0.1:8188");
    // Without the server there are no file inputs to assign, and registering is still possible.
    await expect(page.locator('[id^="comfy-slot-"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Register", exact: true })).toBeEnabled();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("other servers are read when opened; a token is sent once and never shown", async ({ browser }) => {
  const app = await openStaticApp(browser, { viewport: { width: 1440, height: 900 } });
  try {
    const fixture = await openSettings(app, PROBLEMS);
    const page = app.page;
    const section = page.locator(".comfy-remotes");
    await section.locator("summary").click();
    await expect(section.locator(".comfy-remote-list li")).toHaveCount(2);
    await expect(section.locator(".comfy-remote-list li").nth(0)).toContainText("token saved");
    await expect(section.locator(".comfy-remote-list li").nth(1)).toContainText("Plain HTTP: the token and your files cross the network unencrypted.");
    await page.locator("#comfy-remote-origin").fill("https://gpu.example.net");
    await expect(page.locator("#comfy-remote-token")).toHaveAttribute("type", "password");
    await page.locator("#comfy-remote-token").fill(TOKEN);
    await section.getByRole("button", { name: "Add server", exact: true }).click();
    await expect(section.locator(".comfy-remote-list li")).toHaveCount(3);
    expect(fixture.calls.find((call) => call.method === "PUT")?.body).toEqual({ origin: "https://gpu.example.net", token: TOKEN });
    await expect(page.locator("#comfy-remote-token")).toHaveValue("");
    expect(await page.content()).not.toContain(TOKEN);

    await section.getByRole("button", { name: "Remove https://comfy.example.com", exact: true }).click();
    await expect(section.getByRole("status")).toHaveText("Removed. These workflows still point to it and will not run: wan-i2v");
    await expect(section.locator(".comfy-remote-list li")).toHaveCount(2);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

for (const locale of ["en", "ko"] as const satisfies readonly StaticLocale[]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test("comfy settings render at " + String(viewport.width) + " in " + locale, async ({ browser }) => {
      const app = await openStaticApp(browser, { locale, viewport });
      try {
        await openSettings(app, PROBLEMS);
        const page = app.page;
        const tag = locale + "-" + String(viewport.width);
        await shot(page, "comfy-list-" + tag, "#comfy-workflow-manager-title");
        await chooseFile(page, "canvas.json", EDITOR_GRAPH);
        await expect(page.getByRole("alert")).toBeVisible();
        await shot(page, "comfy-editor-format-" + tag, "#comfy-origin");
        await chooseFile(page, "wan-i2v.json", API_GRAPH);
        await expect(page.locator("#comfy-slot-52-image")).toBeVisible();
        await shot(page, "comfy-report-" + tag, ".comfy-report--warn");
        await shot(page, "comfy-slots-" + tag, "#comfy-bind-prompt");
        await page.locator(".comfy-remotes summary").click();
        await expect(page.locator(".comfy-remote-list li")).toHaveCount(2);
        await shot(page, "comfy-remotes-" + tag, ".comfy-remotes");
        expect(await noSidewaysScroll(page), "no sideways scroll").toBe(true);
        expect(app.errors).toEqual([]);
      } finally {
        await app.close();
      }
    });
  }
}

