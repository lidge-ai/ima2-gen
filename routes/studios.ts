import express from "express";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readConfigFileSafe } from "../lib/providers/media/credentials.js";
import { updateConfigFileAtomic } from "../lib/configFileStore.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";

export const CLASSIC_UI = "classic";
const STUDIO_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** Folders under studios/ that are libraries, not apps. */
const NOT_A_STUDIO = new Set(["kit", "node_modules"]);

export interface StudioOptions {
  /** Defaults to <rootDir>/studios. */
  root?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

export interface StudioEntry {
  name: string;
  built: boolean;
  url: string;
}

function studiosRoot(ctx: RuntimeContext, options: StudioOptions): string {
  return options.root ?? join(ctx.rootDir, "studios");
}

/**
 * The dist folder of a built studio, or null. The path is built from the directory
 * listing entry, never from the requested name, so a URL can only select a folder
 * that already exists under root.
 */
function builtDist(root: string, name: string): string | null {
  if (!STUDIO_NAME.test(name) || NOT_A_STUDIO.has(name)) return null;
  let entry: string | undefined;
  try {
    entry = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory() && d.name === name)?.name;
  } catch {
    return null;
  }
  if (!entry) return null;
  const dist = join(root, entry, "dist");
  return existsSync(join(dist, "index.html")) ? dist : null;
}

function isBuilt(root: string, name: string): boolean {
  return builtDist(root, name) !== null;
}

export function listStudios(root: string): StudioEntry[] {
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .filter((n) => STUDIO_NAME.test(n) && !NOT_A_STUDIO.has(n))
    .sort()
    .map((name) => ({ name, built: isBuilt(root, name), url: `/studio/${name}/` }));
}

/** env IMA2_DEFAULT_UI wins over config.json ui.defaultUi; anything unknown means the classic UI. */
export async function readDefaultUi(ctx: RuntimeContext, options: StudioOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  if (env.IMA2_DEFAULT_UI) return env.IMA2_DEFAULT_UI;
  const file = await readConfigFileSafe(ctx.config.storage.configFile);
  const ui = file.ui as { defaultUi?: unknown } | undefined;
  return typeof ui?.defaultUi === "string" && ui.defaultUi ? ui.defaultUi : CLASSIC_UI;
}

function studioHandler(root: string): RequestHandler {
  const statics = new Map<string, RequestHandler>();
  return (req: Request, res: Response, next: NextFunction) => {
    const name = String(req.params.name ?? "");
    const dist = builtDist(root, name);
    if (!dist) return next();
    if (req.originalUrl.split("?")[0] === `/studio/${name}`) return res.redirect(301, `/studio/${name}/`);
    // Keyed by the dist path from the directory listing, never by the requested name.
    let serve = statics.get(dist);
    if (typeof serve !== "function") {
      serve = express.static(dist, { index: "index.html", fallthrough: true });
      statics.set(dist, serve);
    }
    serve(req, res, () => {
      const wantsPage = (req.method === "GET" || req.method === "HEAD") && !/\.[a-z0-9]+$/i.test(req.path);
      if (!wantsPage) return next();
      res.sendFile(join(dist, "index.html"));
    });
  };
}

/**
 * Serves studios/<name>/dist at /studio/<name>/ and redirects "/" to the default
 * studio. Call before the classic ui/dist static handler; "/?ui=classic" always
 * reaches the classic UI.
 */
export function mountStudioUi(app: Express, ctxRaw: RouteRuntimeContext, options: StudioOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const root = studiosRoot(ctx, options);
  app.get("/", async (req: Request, res: Response, next: NextFunction) => {
    if (req.query.ui === CLASSIC_UI) return next();
    const preferred = await readDefaultUi(ctx, options);
    if (preferred !== CLASSIC_UI && isBuilt(root, preferred)) return res.redirect(302, `/studio/${preferred}/`);
    return next();
  });
  app.use("/studio/:name", studioHandler(root));
}

export function registerStudioRoutes(app: Express, ctxRaw: RouteRuntimeContext, options: StudioOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  const root = studiosRoot(ctx, options);
  app.get("/api/studios", async (_req: Request, res: Response) => {
    res.json({ studios: listStudios(root), defaultUi: await readDefaultUi(ctx, options) });
  });
  app.put("/api/studios/default", async (req: Request, res: Response) => {
    const name = req.body?.name;
    if (typeof name !== "string" || (name !== CLASSIC_UI && !isBuilt(root, name))) {
      return res.status(400).json({ ok: false, code: "STUDIO_UNKNOWN", error: "name must be \"classic\" or a built studio" });
    }
    await updateConfigFileAtomic(ctx.config.storage.configFile, (existing) => {
      const ui = existing.ui && typeof existing.ui === "object" ? existing.ui as Record<string, unknown> : {};
      existing.ui = { ...ui, defaultUi: name };
    });
    const env = options.env ?? process.env;
    return res.json({ ok: true, defaultUi: env.IMA2_DEFAULT_UI || name, ...(env.IMA2_DEFAULT_UI ? { overriddenByEnv: true } : {}) });
  });
}
