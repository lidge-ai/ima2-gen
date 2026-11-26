import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}

/** Anchored panel that closes on Escape and outside clicks, and returns focus to the trigger. */
export function Popover({ open, onClose, label, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target) && !ref.current.parentElement?.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={"popover " + (className ?? "")} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
