import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixtures } from "./j6Catalog";
import { installMediaFixture, type MediaFixture } from "./mediaModels";

// The built classic UI (ui/dist) on a synthetic origin with no app server behind it: static files
// come from disk and every API answer is a fixture. No process is started and no credential can be
// read, so this runs on any machine. Like the J6 capture, an API read the fixtures do not know is
// refused and recorded, which keeps "nothing new is requested at start" enforceable.

const UI = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(UI, "dist");
const VENDORS = join(UI, "..", "studios", "kit", "assets", "vendors");
export const STATIC_ORIGIN = "http://127.0.0.1:49161"; // Synthetic document origin, no listening socket.
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon" };

export type StaticLocale = "en" | "ko" | "zh-Hans" | "zh-Hant";
export interface StaticAppOptions {
  viewport?: { width: number; height: number };
  locale?: StaticLocale;
  theme?: "dark" | "light";
  /** Extra localStorage entries, e.g. a saved media selection. */
  storage?: Record<string, string>;
  /** Key vocabularies that start with a key. */
  keys?: string[];
  /** The catalog also lists a model on a keyless local route. */
  localRoute?: boolean;
}
export interface StaticApp {
  page: Page;
  context: BrowserContext;
  media: MediaFixture;
  /** Requests the fixtures refused: unknown API reads, mutations, other origins. */
  unexpected: string[];
  errors: string[];
  close(): Promise<void>;
}

async function file(root: string, relative: string): Promise<Buffer | null> {
  const full = normalize(join(root, relative));
  if (!full.startsWith(root + sep)) return null;
  return readFile(full).catch(() => null);
}

async function serve(route: Route, unexpected: string[]): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const refuse = async (why: string) => { unexpected.push(method + " " + url.pathname + " " + why); await route.abort("blockedbyclient"); };
  if (url.origin !== STATIC_ORIGIN) return refuse("other-origin");
  if (url.pathname.startsWith("/api/")) {
    if (method !== "GET") return refuse("mutation");
    // The media fixture swaps EventSource for a driven one, so this is only reached if a page skips it.
    if (url.pathname === "/api/events") return route.fulfill({ status: 204, body: "" });
    if (url.pathname === "/api/history") {
      return route.fulfill({ json: url.searchParams.has("groupBy") ? { sessions: [], loose: [], total: 0, nextCursor: null } : { items: [], total: 0, nextCursor: null } });
    }
    if (url.pathname === "/api/quota/grok/reset-coupons") return route.fulfill({ json: { accountLabel: null, accountRef: "fixture-account", coupons: [] } });
    if (url.pathname === "/api/quota/reset-operations") return route.fulfill({ json: { operations: [] } });
    const fixtures = readFixtures({ mode: "ready" }, false);
    if (Object.hasOwn(fixtures, url.pathname)) return route.fulfill({ json: fixtures[url.pathname] });
    return refuse("unknown-api-read");
  }
  if (method !== "GET") return refuse("mutation");
  if (url.pathname.startsWith("/media-assets/vendors/")) {
    const body = await file(VENDORS, decodeURIComponent(url.pathname.slice("/media-assets/vendors/".length)));
    return body ? route.fulfill({ contentType: TYPES[extname(url.pathname)] ?? "application/octet-stream", body }) : route.fulfill({ status: 404, body: "" });
  }
  const asset = url.pathname === "/" ? null : await file(DIST, decodeURIComponent(url.pathname.slice(1)));
  if (asset) return route.fulfill({ contentType: TYPES[extname(url.pathname)] ?? "application/octet-stream", body: asset });
  if (extname(url.pathname)) return route.fulfill({ status: 404, body: "" });
  const index = await file(DIST, "index.html");
  if (!index) throw new Error("ui/dist is missing: build the UI before running this spec");
  return route.fulfill({ contentType: "text/html", body: index });
}

export async function openStaticApp(browser: Browser, options: StaticAppOptions = {}): Promise<StaticApp> {
  const storage: Record<string, string> = {
    "ima2.locale": options.locale ?? "en", "ima2.onboardingDismissed": "1", "ima2.uiMode": "classic", "ima2.workspaceProfile": "default",
    "ima2.activeSessionId": "wp02-session", "ima2.imageModel": "gpt-6-luna", "ima2.videoDefaults": JSON.stringify({ model: false }),
    "ima2.generationDefaults": JSON.stringify({ provider: "oauth", multimode: false }),
    ...(options.theme ? { "ima2.themeMode": options.theme } : {}), ...options.storage,
  };
  // storageState seeds once; a reload then reads what the app itself saved.
  const context = await browser.newContext({ serviceWorkers: "block", viewport: options.viewport ?? { width: 1280, height: 800 }, reducedMotion: "reduce",
    storageState: { cookies: [], origins: [{ origin: STATIC_ORIGIN, localStorage: Object.entries(storage).map(([name, value]) => ({ name, value })) }] } });
  const unexpected: string[] = [];
  const errors: string[] = [];
  const handler = (route: Route) => serve(route, unexpected).catch(async (error: unknown) => { unexpected.push("route-error " + String(error)); await route.abort("failed").catch(() => {}); });
  await context.route("**/*", handler);
  const media = await installMediaFixture(context, { ...(options.keys ? { keys: options.keys } : {}), ...(options.localRoute ? { local: true } : {}) });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, context, media, unexpected, errors,
    close: async () => { await media.close(); await context.close(); } };
}

export const MODEL_CONTROL = "#sidebar-generation-model:visible";

/** Loads the app; the seeded mode is the classic Create screen, ready when its model control shows. */
export async function openCreateScreen(page: Page): Promise<void> {
  await page.goto(STATIC_ORIGIN + "/");
  await page.locator(MODEL_CONTROL).waitFor();
}
