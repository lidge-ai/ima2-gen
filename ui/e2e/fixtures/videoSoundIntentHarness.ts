import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installIsolatedComponentTransport, type IsolatedAsset, type IsolatedTraffic } from "./isolatedComponentTransport";
import type { SoundSeed } from "./videoSoundIntentComponent";

const UI = fileURLToPath(new URL("../../", import.meta.url));
const ORIGIN = "http://127.0.0.1:49155"; // Synthetic document, no listening socket.
const RESPONSES = {
  "/api/assets?kind=element&limit=500": { assets: [], nextCursor: null },
  "/api/capabilities": { valid: { videoModels: { referenceAudio: {
    knownPresets: ["fixture-voice"], maxVoices: 3, presetsAreAuthoritative: false,
  } } } },
  "/api/config/grok-planner": { model: "fixture-planner", options: ["fixture-planner"] },
};
export type SoundCase = { page: Page; seed: SoundSeed; checkpoints: Array<{ name: string; value: unknown }> };

function apiBoundaries(): Plugin {
  const owners = new Map([
    [resolve(UI, "src/store/storeVideoImpl.ts"), "postVideoGenerateStream"],
    [resolve(UI, "src/store/storeReferenceImpl.ts"), "readImageMetadata"],
  ]);
  return { name: "sound-intent-two-api-boundaries", setup(builder) {
    builder.onResolve({ filter: /^\.\.\/lib\/api$/ }, (args) => {
      const name = owners.get(resolve(args.importer));
      return name ? { path: name, namespace: "sound-boundary" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "sound-boundary" }, (args) => ({
      contents: `export * from ${JSON.stringify(resolve(UI, "src/lib/api.ts"))};
        export function ${args.path}(...args) { return window.${args.path === "postVideoGenerateStream"
          ? "wp3VideoBoundary" : "wp3MetadataBoundary"}(...args); }`, loader: "js", resolveDir: UI,
    }));
  } };
}

async function bundle() {
  const compiled = await build({ entryPoints: [join(UI, "e2e/fixtures/videoSoundIntentComponent.tsx")],
    absWorkingDir: UI, bundle: true, write: false, platform: "browser", format: "iife", target: "es2022",
    jsx: "automatic", metafile: true, logLevel: "silent", plugins: [apiBoundaries()],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"DEV":false,"PROD":true}' } });
  const inputs = Object.keys(compiled.metafile.inputs);
  expect(inputs.filter((input) => input.startsWith("sound-boundary:")).sort()).toEqual([
    "sound-boundary:postVideoGenerateStream", "sound-boundary:readImageMetadata",
  ]);
  for (const source of ["components/SoundIntentPicker.tsx", "components/VideoControlsPanel.tsx",
    "components/PromptComposer.tsx", "components/GenerateButton.tsx", "store/storePromptImpl.ts",
    "store/storeCoreSelectionImpl.ts", "store/storePersistence.ts", "store/storeGenerateEntryImpl.ts",
    "store/storeVideoImpl.ts", "store/storeReferenceImpl.ts", "lib/compress.ts"]) {
    expect(inputs).toContain(`src/${source}`);
  }
  expect(compiled.outputFiles).toHaveLength(1);
  const body = compiled.outputFiles[0].text;
  return { body, inputs, sha256: createHash("sha256").update(body).digest("hex") };
}

async function assetsFor(body: string) {
  const assets = new Map<string, IsolatedAsset>();
  assets.set(`${ORIGIN}/`, { contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="dark">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="icon" href="data:,"><link rel="stylesheet" href="/component.css"></head>
    <body style="margin:0"><main id="root" style="width:100%;max-width:760px;margin:0 auto;padding:12px;box-sizing:border-box"></main>
    <script src="/component.js"></script></body></html>` });
  assets.set(`${ORIGIN}/component.js`, { contentType: "text/javascript", body });
  const cssNames = (await readdir(join(UI, "dist/assets"))).filter((name) => /^index-[\w-]+\.css$/.test(name));
  expect(cssNames).toHaveLength(1);
  const css = await readFile(join(UI, "dist/assets", cssNames[0]));
  assets.set(`${ORIGIN}/component.css`, { contentType: "text/css", body: css });
  for (const name of await readdir(join(UI, "dist/fonts"))) {
    if (/^[\w-]+\.woff2$/.test(name)) assets.set(`${ORIGIN}/fonts/${name}`, {
      contentType: "font/woff2", body: await readFile(join(UI, "dist/fonts", name)),
    });
  }
  for (const [path, response] of Object.entries(RESPONSES)) assets.set(ORIGIN + path, {
    contentType: "application/json", body: JSON.stringify(response),
  });
  return { assets, cssSha256: createHash("sha256").update(css).digest("hex") };
}

export async function navigateSound(fixture: SoundCase, fresh: boolean) {
  if (fresh) await fixture.page.goto(`${ORIGIN}/`);
  else {
    const cleanup = await fixture.page.evaluate(() => window.wp3Sound.unmount());
    fixture.checkpoints.push({ name: "before-reload-cleanup", value: cleanup });
    await fixture.page.reload();
  }
  await fixture.page.evaluate(({ seed, initial }) => window.wp3Sound.mount(seed, initial), {
    seed: fixture.seed, initial: fresh,
  });
  await expect(fixture.page.locator("html")).toHaveAttribute("data-sound-ready", "true");
  await fixture.page.evaluate(async () => { await document.fonts.ready; });
}

export async function soundCheckpoint(fixture: SoundCase, name: string) {
  const value = await fixture.page.evaluate(() => window.wp3Sound.snapshot());
  fixture.checkpoints.push({ name, value });
  return value;
}

async function closeSound(context: BrowserContext, fixture: SoundCase) {
  const cleanup = { unmounted: false, pageClosed: false, contextClosed: false, errors: [] as string[] };
  try {
    if (!fixture.page.isClosed()) {
      try {
        const state = await fixture.page.evaluate(() => window.wp3Sound?.unmount());
        fixture.checkpoints.push({ name: "teardown", value: state });
        cleanup.unmounted = state !== undefined;
      } catch (error) { cleanup.errors.push(String(error)); }
      await fixture.page.close(); cleanup.pageClosed = true;
    }
  } finally {
    await context.close(); cleanup.contextClosed = true;
  }
  return cleanup;
}

export async function withSound(browser: Browser, info: TestInfo, seed: SoundSeed,
  run: (fixture: SoundCase) => Promise<void>) {
  const compiled = await bundle();
  const { assets, cssSha256 } = await assetsFor(compiled.body);
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 1100 } });
  const traffic: IsolatedTraffic = { attempts: [], unexpected: [], routes: [] };
  const errors: string[] = [];
  await installIsolatedComponentTransport(context, assets, Object.keys(RESPONSES).map((p) => ORIGIN + p), traffic);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const fixture: SoundCase = { page, seed, checkpoints: [] };
  let failure: unknown; let cleanup: Awaited<ReturnType<typeof closeSound>> | undefined;
  try { await navigateSound(fixture, true); await run(fixture); }
  catch (error) { failure = error; }
  finally {
    cleanup = await closeSound(context, fixture);
    await writeFile(info.outputPath("sound-evidence.json"), JSON.stringify({ capturedAt: new Date().toISOString(), seed,
      bundle: { inputs: compiled.inputs, sha256: compiled.sha256 }, cssSha256, traffic, errors, cleanup,
      checkpoints: fixture.checkpoints, serverStarted: false, failure: failure ? String(failure) : null }, null, 2));
  }
  if (failure) throw failure;
  expect(cleanup).toEqual({ unmounted: true, pageClosed: true, contextClosed: true, errors: [] });
  expect(errors).toEqual([]); expect(traffic.unexpected).toEqual([]);
  expect(traffic.attempts.filter((attempt) => !attempt.allowed)).toEqual([]);
  expect(traffic.routes.every((route) => route.method === "GET" && route.outcome === "fulfilled-synthetic")).toBe(true);
}
