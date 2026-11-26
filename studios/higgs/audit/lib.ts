import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Shared capture helpers for the design audit (L7). Each cell is captured at every width
 * and saved as <out>/<phase>/<cell>__<width>__<locale>.jpg, with geometry findings appended
 * to <out>/<phase>/metrics.jsonl. Run: npx playwright test -c audit/playwright.audit.config.ts
 */
export const OUT = process.env.AUDIT_OUT ?? "audit/out";
export const PHASE = process.env.AUDIT_PHASE ?? "before";
export const WIDTHS = (process.env.AUDIT_WIDTHS ?? "1440,1280,768,390").split(",").map(Number);
export const LOCALES = (process.env.AUDIT_LOCALES ?? "en,ko").split(",");
const MAX_HEIGHT = Number(process.env.AUDIT_MAX_HEIGHT ?? 4000);

export function dir(): string {
  const path = join(OUT, PHASE);
  mkdirSync(path, { recursive: true });
  return path;
}

export function heightFor(width: number): number {
  return width <= 390 ? 844 : width <= 768 ? 1024 : 900;
}

export function record(entry: Record<string, unknown>): void {
  appendFileSync(join(dir(), "metrics.jsonl"), JSON.stringify(entry) + "\n");
}

/** Geometry checks a reviewer cannot see reliably by eye. */
export async function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const describe = (el: Element) => {
      const name = (el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? el.getAttribute("alt") ?? "").trim();
      return el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "") + (name ? " " + JSON.stringify(name.slice(0, 40)) : "");
    };
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - doc.clientWidth;
    const targets = [...document.querySelectorAll("a[href],button,input,select,textarea,summary,[role=button],[role=tab],[role=switch]")]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => (r.width < 24 || r.height < 24) && !(el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) && el.closest("label")))
      .slice(0, 25)
      .map(({ el, r }) => describe(el) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    const smallText = new Set<string>();
    for (const el of document.querySelectorAll("body *")) {
      if (smallText.size > 15) break;
      if (!visible(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 12) smallText.add(describe(el) + " " + getComputedStyle(el).fontSize);
    }
    const imgOverflow = [...document.images]
      .filter(visible)
      .map((img) => ({ img, r: img.getBoundingClientRect(), p: img.parentElement!.getBoundingClientRect() }))
      .filter(({ r, p }) => r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1)
      .slice(0, 15)
      .map(({ img, r, p }) => describe(img) + " " + img.src.split("/").pop() + " img " + Math.round(r.width) + "x" + Math.round(r.height) + " parent " + Math.round(p.width) + "x" + Math.round(p.height));
    const covered: string[] = [];
    for (const el of document.querySelectorAll("h1,h2,h3,p,code,li,label,button,a")) {
      if (covered.length > 15) break;
      if (!visible(el) || !(el as HTMLElement).innerText?.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const hit = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
      if (hit && !el.contains(hit) && !hit.contains(el) && hit.tagName === "IMG") covered.push(describe(el) + " under " + describe(hit));
    }
    return { overflowX, smallTargets: targets, smallText: [...smallText], imgOverflow, covered };
  });
}

let axe: undefined | null | ((page: Page) => Promise<{ id: string; impact: string; nodes: number; sample: string }[]>);
async function loadAxe() {
  if (axe !== undefined) return axe;
  try {
    const mod = (await import("@axe-core/playwright" as string)) as { default: new (o: { page: Page }) => { withTags(t: string[]): { analyze(): Promise<{ violations: { id: string; impact: string; nodes: { target: unknown[] }[] }[] }> } } };
    axe = async (page) =>
      (await new mod.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        sample: JSON.stringify(v.nodes.slice(0, 3).map((n) => n.target)),
      }));
  } catch {
    axe = null;
  }
  return axe;
}

/** Capture one cell at every width. Axe runs once per cell (at the first width) when installed. */
export async function shoot(page: Page, cell: string, locale: string, options: { widths?: number[]; full?: boolean } = {}) {
  const widths = options.widths ?? WIDTHS;
  for (const [index, width] of widths.entries()) {
    await page.setViewportSize({ width, height: heightFor(width) });
    await page.waitForTimeout(350);
    await page.evaluate(() => document.fonts.ready);
    const geometry = await measure(page);
    const run = index === 0 ? await loadAxe() : undefined;
    const a11y = run ? await run(page).catch((e: unknown) => [{ id: "axe-error", impact: "n/a", nodes: 0, sample: String(e) }]) : index === 0 ? "NOT_RUN" : undefined;
    const file = cell + "__" + width + "__" + locale + ".jpg";
    const height = Math.min(MAX_HEIGHT, await page.evaluate(() => document.documentElement.scrollHeight));
    await page.screenshot({
      path: join(dir(), file),
      type: "jpeg",
      quality: 78,
      fullPage: options.full !== false,
      clip: options.full === false ? undefined : { x: 0, y: 0, width, height },
      animations: "disabled",
    });
    record({ cell, width, locale, file, ...geometry, ...(a11y !== undefined ? { axe: a11y } : {}) });
  }
}

export function saveText(name: string, content: string): void {
  writeFileSync(join(dir(), name), content);
}

