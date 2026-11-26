import { useId, useState } from "react";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

export interface TileOption<T> {
  value: T;
  label: string;
  meta?: string;
}

interface Props<T> {
  caption: string;
  value: T;
  options: readonly TileOption<T>[];
  onChange: (value: T) => void;
  /** "tile" is the panel card; "chip" is the compact dock button. */
  variant?: "tile" | "chip";
  icon?: Parameters<typeof Icon>[0]["name"];
}

/** A labelled setting that opens a single-choice menu. */
export function SettingTile<T extends string | number>({ caption, value, options, onChange, variant = "tile", icon }: Props<T>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = options.find((o) => o.value === value);
  return (
    <div className={"setting " + (variant === "chip" ? "setting-chip" : "setting-tile")}>
      <button
        type="button"
        className="setting-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={caption + ": " + (current?.label ?? "")}
        onClick={() => setOpen(!open)}
      >
        {icon ? <Icon name={icon} size={15} /> : null}
        {variant === "tile" ? <span className="setting-caption">{caption}</span> : null}
        <span className="setting-value">{current?.label ?? "-"}</span>
        {variant === "tile" ? <Icon name="chevron" size={16} /> : null}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={caption} className="menu-popover">
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
              <span>{option.label}</span>
              {option.meta ? <span className="menu-meta">{option.meta}</span> : null}
              {option.value === value ? <Icon name="check" size={15} /> : null}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
