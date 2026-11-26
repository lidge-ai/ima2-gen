import { useMemo, useState } from "react";
import { modelHasKey, type CatalogModel, type MediaKind } from "@ima2/studio-kit";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";
import { fromPrice, modelKinds, vendorLabel } from "./format.ts";

interface Props {
  models: readonly CatalogModel[];
  kind: MediaKind;
  value: string | undefined;
  onChange: (modelId: string) => void;
  variant?: "row" | "chip";
  /** Restrict to models that can do at least one of these tasks. */
  tasks?: readonly string[];
}

function matches(model: CatalogModel, query: string, vendor: string | null): boolean {
  if (vendor && model.vendor !== vendor) return false;
  if (!query) return true;
  const hay = (model.label + " " + model.id + " " + model.vendor).toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
}

function specChips(model: CatalogModel): string[] {
  const chips: string[] = [];
  const res = model.params.resolutions;
  if (res?.length) chips.push(res.length > 1 ? res[0] + "-" + res[res.length - 1] : String(res[0]));
  const d = model.params.durationsSec;
  if (d?.length) chips.push(d.length > 1 ? Math.min(...d) + "s-" + Math.max(...d) + "s" : d[0] + "s");
  return chips;
}

function ModelRow({ model, selected, onPick }: { model: CatalogModel; selected: boolean; onPick: () => void }) {
  const keyed = modelHasKey(model);
  return (
    <li>
      <button type="button" className="model-row" aria-current={selected} onClick={onPick}>
        <span className="model-mark" aria-hidden>{model.vendor.charAt(0).toUpperCase()}</span>
        <span className="model-row-main">
          <span className="model-row-label">
            {model.label}
            {model.params.nativeAudio ? <span className="tag">Audio</span> : null}
          </span>
          <span className="model-row-sub">
            {specChips(model).map((chip) => <span key={chip} className="spec">{chip}</span>)}
            <span>{vendorLabel(model.vendor)} · {modelKinds(model)}</span>
          </span>
        </span>
        <span className="model-row-meta">
          <span className="model-row-price">{fromPrice(model.routes) ?? "No published price"}</span>
          <span className={"key-state " + (keyed ? "is-on" : "is-off")}>{keyed ? "Key ready" : "Needs key"}</span>
        </span>
        {selected ? <Icon name="check" size={16} /> : <span className="check-space" />}
      </button>
    </li>
  );
}

export function ModelPicker({ models, kind, value, onChange, variant = "row", tasks }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string | null>(null);
  const ofKind = useMemo(
    () => models.filter((m) => m.kind === kind && (!tasks || m.tasks.some((t) => tasks.includes(t)))),
    [models, kind, tasks],
  );
  const vendors = useMemo(() => [...new Set(ofKind.map((m) => m.vendor))].sort(), [ofKind]);
  const shown = ofKind.filter((m) => matches(m, query, vendor));
  const current = ofKind.find((m) => m.id === value);
  const close = () => setOpen(false);
  return (
    <div className={"picker picker-" + variant}>
      <button type="button" className="picker-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={"Model: " + (current?.label ?? "none")} onClick={() => setOpen(!open)}>
        {variant === "row" ? <span className="setting-caption">Model</span> : <span className="model-mark small" aria-hidden>{current?.vendor.charAt(0).toUpperCase() ?? "?"}</span>}
        <span className="setting-value">{current?.label ?? "Choose a model"}</span>
        <Icon name={variant === "row" ? "chevron" : "chevron"} size={16} />
      </button>
      <Popover open={open} onClose={close} label="Choose a model" className="model-popover">
        <div className="popover-search">
          <Icon name="search" />
          <input autoFocus type="search" placeholder="Search models" aria-label="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="chip-row" role="group" aria-label="Filter by maker">
          <button type="button" className="chip" aria-pressed={vendor === null} onClick={() => setVendor(null)}>All</button>
          {vendors.map((v) => (
            <button key={v} type="button" className="chip" aria-pressed={vendor === v} onClick={() => setVendor(vendor === v ? null : v)}>{vendorLabel(v)}</button>
          ))}
        </div>
        <ul className="model-list" aria-label="Models">
          {shown.map((model) => (
            <ModelRow key={model.id} model={model} selected={model.id === value} onPick={() => { onChange(model.id); close(); }} />
          ))}
          {shown.length === 0 ? <li className="empty-line">No model matches.</li> : null}
        </ul>
      </Popover>
    </div>
  );
}
