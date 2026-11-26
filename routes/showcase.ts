import type { Express, Request, Response } from "express";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";

/**
 * Showcase: finished example clips that studios show on their home and Remix screens.
 * The clips are not part of the repository: an operator drops showcase.json and its media
 * files into a folder (IMA2_SHOWCASE_DIR, default <config dir>/showcase), and the server
 * lists them at GET /api/showcase and serves the files at /api/showcase/media/<file>.
 * A missing or broken folder means an empty list, never an error.
 */
export interface ShowcaseOptions {
  dir?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

export interface ShowcaseItem {
  id: string;
  title: { en: string; ko?: string };
  workflow?: string;
  preset?: string;
  values?: Record<string, string | number | boolean>;
  result: string;
  source?: string;
  poster?: string;
  compare?: string;
  models: string[];
  keys: string[];
  estimate?: { usd: number | null; basis?: string };
  durationSec?: number;
  /** Kind of clip ("motion-transfer", "restyle", "text-to-video"...); Home mixes kinds in its first row. */
  type?: string;
}

const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,120}\.(mp4|webm|mov|jpe?g|png|webp)$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const MEDIA_PREFIX = "/api/showcase/media/";

export function showcaseDir(ctx: RuntimeContext, options: ShowcaseOptions = {}): string {
  const env = options.env ?? process.env;
  return env.IMA2_SHOWCASE_DIR || options.dir || join(dirname(ctx.config.storage.configFile), "showcase");
}

function fileUrl(dir: string, name: unknown): string | undefined {
  if (typeof name !== "string" || !SAFE_FILE.test(name)) return undefined;
  try {
    return statSync(join(dir, name)).isFile() ? MEDIA_PREFIX + encodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length < 200) : [];

function title(value: unknown): ShowcaseItem["title"] | null {
  if (typeof value === "string" && value.trim()) return { en: value.trim() };
  if (!value || typeof value !== "object") return null;
  const t = value as { en?: unknown; ko?: unknown };
  if (typeof t.en !== "string" || !t.en.trim()) return null;
  return typeof t.ko === "string" && t.ko.trim() ? { en: t.en.trim(), ko: t.ko.trim() } : { en: t.en.trim() };
}

function values(value: unknown): ShowcaseItem["values"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value))
    if (/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k) && ["string", "number", "boolean"].includes(typeof v))
      out[k] = v as string | number | boolean;
  return out;
}

function estimate(value: unknown): ShowcaseItem["estimate"] {
  if (!value || typeof value !== "object") return undefined;
  const e = value as { usd?: unknown; basis?: unknown };
  const usd = typeof e.usd === "number" && Number.isFinite(e.usd) && e.usd >= 0 ? e.usd : null;
  return typeof e.basis === "string" ? { usd, basis: e.basis.slice(0, 200) } : { usd };
}

/** One showcase.json entry, or null when it lacks an id, a title or an existing result file. */
export function toShowcaseItem(dir: string, raw: unknown): ShowcaseItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && SAFE_ID.test(r.id) ? r.id : null;
  const name = title(r.title);
  const result = fileUrl(dir, r.result);
  if (!id || !name || !result) return null;
  const item: ShowcaseItem = { id, title: name, result, models: strings(r.models), keys: strings(r.keys) };
  for (const key of ["source", "poster", "compare"] as const) {
    const url = fileUrl(dir, r[key]);
    if (url) item[key] = url;
  }
  if (typeof r.workflow === "string" && SAFE_ID.test(r.workflow)) item.workflow = r.workflow;
  if (typeof r.preset === "string" && SAFE_ID.test(r.preset)) item.preset = r.preset;
  const v = values(r.values);
  if (v && Object.keys(v).length) item.values = v;
  const e = estimate(r.estimate);
  if (e) item.estimate = e;
  if (typeof r.durationSec === "number" && r.durationSec > 0 && r.durationSec < 600) item.durationSec = r.durationSec;
  if (typeof r.type === "string" && SAFE_ID.test(r.type)) item.type = r.type;
  return item;
}

export function readShowcase(dir: string): ShowcaseItem[] {
  const file = join(dir, "showcase.json");
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { items?: unknown };
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    const seen = new Set<string>();
    // "order" ascending sets the gallery order; items without it keep file order after those with it.
    const rank = (raw: unknown) => {
      const order = (raw as { order?: unknown } | null)?.order;
      return typeof order === "number" && Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
    };
    return items
      .map((raw, index) => ({ raw, index, rank: rank(raw) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ raw }) => toShowcaseItem(dir, raw))
      .filter((item): item is ShowcaseItem => item !== null && !seen.has(item.id) && !!seen.add(item.id));
  } catch {
    return [];
  }
}

export function registerShowcaseRoutes(app: Express, ctxRaw: RouteRuntimeContext, options: ShowcaseOptions = {}) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.get("/api/showcase", (_req: Request, res: Response) => {
    res.json({ items: readShowcase(showcaseDir(ctx, options)) });
  });
  app.get(MEDIA_PREFIX + ":file", (req: Request, res: Response) => {
    const name = String(req.params.file ?? "");
    const dir = showcaseDir(ctx, options);
    if (!fileUrl(dir, name)) return res.status(404).json({ error: { code: "SHOWCASE_FILE_NOT_FOUND", message: "Not found" } });
    // sendFile answers Range requests, so videos can seek.
    return res.sendFile(name, { root: dir, dotfiles: "deny", maxAge: "1h" });
  });
}

