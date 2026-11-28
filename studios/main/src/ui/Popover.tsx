import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type Placement = "bottom" | "top" | "right";

interface Props {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  anchor: RefObject<HTMLElement | null>;
  placement?: Placement;
  className?: string;
}

const MARGIN = 8;

function place(anchor: DOMRect, panel: DOMRect, placement: Placement): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsRight = anchor.right + 12 + panel.width <= vw - MARGIN;
  const side = placement === "right" && !fitsRight ? "bottom" : placement;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - panel.width - MARGIN));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - panel.height - MARGIN));
  if (side === "right")
    return { left: anchor.right + 12, top: clampY(anchor.top + anchor.height / 2 - panel.height / 2) };
  const below = anchor.bottom + 6;
  const above = anchor.top - 6 - panel.height;
  const top =
    side === "top"
      ? above >= MARGIN
        ? above
        : below
      : below + panel.height <= vh - MARGIN
        ? below
        : Math.max(MARGIN, above);
  return { left: clampX(anchor.left), top };
}

/**
 * Floating panel attached to its trigger. Rendered in body so scroll containers never clip it; when the trigger is
 * inside an open modal dialog, rendered in that dialog, because nothing outside a modal dialog can be seen or clicked.
 */
export function Popover({ open, onClose, label, children, anchor, placement = "bottom", className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const focusPending = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (!anchor.current || !ref.current) return;
      setStyle(place(anchor.current.getBoundingClientRect(), ref.current.getBoundingClientRect(), placement));
    };
    update();
    focusPending.current = true;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor, placement]);
  // Focus moves in once the panel is placed: a still-hidden panel (first open) cannot take focus.
  // A choice menu opens on the current value, scrolled into view in a long list such as 1-30 s.
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || !focusPending.current || !panel || style.visibility === "hidden") return;
    focusPending.current = false;
    (
      panel.querySelector<HTMLElement>('button[aria-pressed="true"]:not(:disabled)') ??
      panel.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")
    )?.focus();
  }, [open, style]);
  useEffect(() => {
    if (!open) return;
    const trigger = anchor.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Inside a modal dialog the same key would also close the dialog; this press is for the panel.
        event.preventDefault();
        event.stopPropagation();
        onClose();
        trigger?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !trigger?.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    // Escape closes this panel only, not the dialog it sits in.
    const dialog = trigger?.closest("dialog[open]");
    const onCancel = (event: Event) => event.preventDefault();
    dialog?.addEventListener("cancel", onCancel);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      dialog?.removeEventListener("cancel", onCancel);
      if (trigger && document.activeElement === document.body) trigger.focus();
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className={"popover " + (className ?? "")} role="dialog" aria-label={label} style={style}>
      {children}
    </div>,
    anchor.current?.closest("dialog[open]") ?? document.body,
  );
}
