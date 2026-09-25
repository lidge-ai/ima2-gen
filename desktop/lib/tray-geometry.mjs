// Tray popup placement, ported from opencodex desktop/src-tauri/src/popup.rs `geometry`.
// Electron reports tray bounds and display work areas in DIPs, so the design size is used
// directly; the OS applies the display's scale factor.

export const POPUP_WIDTH = 380;
export const POPUP_HEIGHT = 560;
const EDGE = 8;
const GAP = 6;

/**
 * Centers the popup horizontally on the tray anchor and opens it below the anchor when it fits
 * (top taskbar / Linux top panel), otherwise above it (Windows' bottom taskbar), always clamped
 * into the work area so a left, right or top taskbar still lands the popup fully on screen.
 */
export function popupGeometry(anchor, workArea, size = { width: POPUP_WIDTH, height: POPUP_HEIGHT }) {
  const left = workArea.x;
  const top = workArea.y;
  const right = left + workArea.width;
  const bottom = top + workArea.height;
  const width = Math.max(1, Math.min(size.width, workArea.width - EDGE * 2));
  const height = Math.max(1, Math.min(size.height, workArea.height - EDGE * 2));
  const minX = left + EDGE;
  const maxX = Math.max(minX, right - EDGE - width);
  const minY = top + EDGE;
  const maxY = Math.max(minY, bottom - EDGE - height);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const ax = Math.round(anchor.x);
  const ay = Math.round(anchor.y);
  const x = clamp(ax - Math.floor(width / 2), minX, maxX);
  const below = ay + GAP;
  const above = ay - GAP - height;
  const y = clamp(below <= maxY ? below : above, minY, maxY);
  return { x, y, width, height };
}

/** Anchor point for a tray rect: its center, or the work area's bottom-right when the host has no rect. */
export function trayAnchor(bounds, workArea) {
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }
  return { x: workArea.x + workArea.width, y: workArea.y + workArea.height };
}
