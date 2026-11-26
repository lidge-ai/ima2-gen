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
  accessibleLabel?: string;
  value: T;
  options: readonly TileOption<T>[];
  onChange: (value: T) => void;
  /** "tile" is the panel card; "chip" is the compact dock button. */
  variant?: "tile" | "chip";
  icon?: Parameters<typeof Icon>[0]["name"];
  /** Chip text when the value alone is unclear, e.g. "via fal". */
  chipText?: (label: string) => string;
}

interface MenuProps<T> {
  titleId: string;
  caption: string;
  value: T;
  options: readonly TileOption<T>[];
  onPick: (value: T) => void;
}

function OptionMenu<T extends string | number>({ titleId, caption, value, options, onPick }: MenuProps<T>) {
  return (
    <>
      <p className="menu-title" id={titleId}>
        {caption}
      </p>
      <div role="radiogroup" aria-labelledby={titleId} className="menu-list">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className="menu-item"
            onClick={() => onPick(option.value)}
          >
            <span className="menu-label">
              {option.icon}
              {option.label}
            </span>
            {option.meta ? <span className="menu-meta">{option.meta}</span> : null}
            {option.value === value ? <Icon name="check" size={15} /> : null}
          </button>
        ))}
      </div>
    </>
  );
}

function valueText<T>(
  current: TileOption<T> | undefined,
  variant: "tile" | "chip",
  chipText?: (label: string) => string,
) {
  const label = current?.label ?? "-";
  return variant === "chip" && chipText ? chipText(label) : label;
}

/** A labelled setting that opens a single-choice menu. */
export function SettingTile<T extends string | number>(props: Props<T>) {
  const { caption, accessibleLabel, value, options, onChange, variant = "tile", icon, chipText } = props;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const current = options.find((o) => o.value === value);
  return (
    <div className={"setting " + (variant === "chip" ? "setting-chip" : "setting-tile")}>
      <button
        ref={trigger}
        type="button"
        className="setting-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={accessibleLabel ?? caption + ": " + (current?.label ?? "")}
        onClick={() => setOpen(!open)}
      >
        {icon ? <Icon name={icon} size={15} /> : null}
        {variant === "tile" ? <span className="setting-caption">{caption}</span> : null}
        <span className="setting-value picker-value">
          {current?.icon}
          {valueText(current, variant, chipText)}
        </span>
        {variant === "tile" ? <Icon name="chevron" size={16} /> : null}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={caption}
        className="menu-popover"
        anchor={trigger}
        placement={variant === "chip" ? "top" : "bottom"}
      >
        <OptionMenu
          titleId={titleId}
          caption={caption}
          value={value}
          options={options}
          onPick={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}
