import { useCallback, useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktopShell";

const STORAGE_KEY = "ima2.sidebarCollapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage unavailable (private mode): collapse still applies for this session.
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/** Sidebar visibility shared by the top strip toggle and Cmd/Ctrl+B. The
    shortcut stays desktop-shell-only so a browser session keeps Ctrl/Cmd+B for
    its bookmark bar. */
export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!desktopBridge()) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "b") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { collapsed, toggle };
}
