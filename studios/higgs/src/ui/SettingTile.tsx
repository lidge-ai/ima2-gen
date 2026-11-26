import { useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

export interface TileOption<T> {
  value: T;
  label: string;
  meta?: string;
  /** Logo or icon shown before the label. */
  icon?: ReactNode;
}

interface Props<T> {
  caption: string;
  value: T;
  options: readonly TileOption<T>[];
  onChange: (value: T) => void;
  /** "tile" is the panel card; "chip" is the compact dock button. */
  variant?: "tile" | "chip";
  icon?: Parameters<typeof Icon>[0]["name"];
  /** Chip text when the value alone is unclear, e.g. "via fal". */
  chipText?: (label: string) => string;
}

/** A labelled setting that opens a single-choice menu. */
export function SettingTile<T extends string | number>({ caption, value, options, onChange, variant = "tile", icon, chipText }: Props<T>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);
  return (
    <div className={"setting " + (variant === "chip" ? "setting-chip" : "setting-tile")}>
      <button
        ref={trigger}
        type="button"
        className="setting-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={caption + ": " + (current?.label ?? "")}
        onClick={() => setOpen(!open)}
      >
        {icon ? <Icon name={icon} size={15} /> : null}
        {variant === "tile" ? <span className="setting-caption">{caption}</span> : null}
        <span className="setting-value picker-value">
          {current?.icon}
          {variant === "chip" && chipText ? chipText(current?.label ?? "-") : current?.label ?? "-"}
        </span>
        {variant === "tile" ? <Icon name="chevron" size={16} /> : null}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={caption} className="menu-popover" anchor={trigger} placement={variant === "chip" ? "top" : "bottom"}>
        <p className="menu-title" id={id}>{caption}</p>
        <div role="radiogroup" aria-labelledby={id} className="menu-list">
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={option.value === value}
              className="menu-item"
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              <span className="menu-label">{option.icon}{option.label}</span>
              {option.meta ? <span className="menu-meta">{option.meta}</span> : null}
              {option.value === value ? <Icon name="check" size={15} /> : null}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
