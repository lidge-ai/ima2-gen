import { useEffect } from "react";
import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX } from "../lib/brandMarkPath";

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

const BADGE_SIZE = 64;
const BASE_TITLE_FALLBACK = "ima2";
const MARK_HEIGHT = 34;

let baseTitle = BASE_TITLE_FALLBACK;
let initialized = false;
let faviconLink: HTMLLinkElement | null = null;
let originalFaviconHref = "";
let createdFaviconLink = false;

function getBadgeNavigator(): BadgeNavigator {
  return navigator as BadgeNavigator;
}

function getOrCreateFaviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  if (faviconLink) return faviconLink;

  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) {
    faviconLink = existing;
    originalFaviconHref = existing.href || existing.getAttribute("href") || "";
    return existing;
  }

  const link = document.createElement("link");
  link.rel = "icon";
  document.head.appendChild(link);
  faviconLink = link;
  createdFaviconLink = true;
  return link;
}

function renderBadgeFavicon(count: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_SIZE;
  canvas.height = BADGE_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) return originalFaviconHref;

  ctx.clearRect(0, 0, BADGE_SIZE, BADGE_SIZE);

  ctx.fillStyle = "#1c1d21";
  roundRect(ctx, 6, 6, 52, 52, 12);
  ctx.fill();

  drawBrandMark(ctx, 30, 33);

  ctx.beginPath();
  ctx.arc(48, 16, count > 1 ? 13 : 10, 0, Math.PI * 2);
  ctx.fillStyle = "#ff335f";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  if (count > 1) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.min(count, 9)), 48, 17);
  }

  return canvas.toDataURL("image/png");
}

/** Draws the ima2 mark centred on (cx, cy); synchronous so the badge needs no image load. */
function drawBrandMark(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const { x, y, width, height } = BRAND_MARK_VIEWBOX;
  const scale = MARK_HEIGHT / height;
  ctx.save();
  ctx.translate(cx - (width * scale) / 2, cy - MARK_HEIGHT / 2);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  ctx.fillStyle = "#f2f3f5";
  ctx.fill(new Path2D(BRAND_MARK_PATH));
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

async function setAppBadgeBestEffort(count: number): Promise<void> {
  const nav = getBadgeNavigator();
  if (typeof nav.setAppBadge !== "function") return;
  try {
    await nav.setAppBadge(count);
  } catch {
    // Browser support varies; title/favicon remain the reliable baseline.
  }
}

async function clearAppBadgeBestEffort(): Promise<void> {
  const nav = getBadgeNavigator();
  if (typeof nav.clearAppBadge !== "function") return;
  try {
    await nav.clearAppBadge();
  } catch {
    // Best-effort only.
  }
}

function applyAttentionBadge(count: number): void {
  document.title = `(${count}) ${baseTitle}`;
  const link = getOrCreateFaviconLink();
  if (link) link.href = renderBadgeFavicon(count);
  void setAppBadgeBestEffort(count);
}

function clearAttentionBadge(): void {
  document.title = baseTitle;
  if (faviconLink) {
    if (createdFaviconLink) {
      faviconLink.remove();
      faviconLink = null;
      createdFaviconLink = false;
    } else {
      faviconLink.href = originalFaviconHref;
    }
  }
  void clearAppBadgeBestEffort();
}

function initAttentionBadge(): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  baseTitle = document.title || BASE_TITLE_FALLBACK;
  getOrCreateFaviconLink();
}

export function useBrowserAttentionBadge(unseenCount: number): void {
  useEffect(() => {
    initAttentionBadge();
    return () => {
      if (initialized) clearAttentionBadge();
    };
  }, []);

  useEffect(() => {
    initAttentionBadge();
    if (unseenCount > 0) {
      applyAttentionBadge(unseenCount);
    } else {
      clearAttentionBadge();
    }
  }, [unseenCount]);
}
