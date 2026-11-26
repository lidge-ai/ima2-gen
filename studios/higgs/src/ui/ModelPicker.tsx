import { messages, useT } from "../i18n.ts";
import { useMemo, useRef, useState } from "react";
import { modelHasKey, type CatalogModel, type MediaKind } from "@ima2/studio-kit";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";
import { fromPrice, modelKinds } from "./format.ts";
import { VendorLogo, vendorDisplayName } from "./VendorLogo.tsx";

const M = messages(
  {
    "audio": "Audio",
    "nonePrice": "No published price",
    "key": "Key ready",
    "noKey": "Needs key",
    "filter": "Filter by maker",
    "all": "All",
    "search": "Search models",
    "models": "Models",
    "empty": "No model matches.",
    "none": "none",
    "modelLabel": "Model: {model}",
    "model": "Model",
    "choose": "Choose a model",
  },
  {
    "audio": "오디오",
    "nonePrice": "공개 가격 없음",
    "key": "키 사용 가능",
    "noKey": "키 필요",
    "filter": "제조사 필터",
    "all": "전체",
    "search": "모델 검색",
    "models": "모델",
    "empty": "일치하는 모델이 없어요. 검색어나 필터를 바꿔 보세요.",
    "none": "없음",
    "modelLabel": "모델: {model}",
    "model": "모델",
    "choose": "모델 선택",
  },
);

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
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
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
  const t = useT(M);
  const keyed = modelHasKey(model);
  return (
    <li>
      <button type="button" className="model-row" aria-current={selected} onClick={onPick}>
        <VendorLogo id={model.vendor} size={30} />
        <span className="model-row-main">
          <span className="model-row-label">
            {model.label}
            {model.params.nativeAudio ? <span className="tag">{t("audio")}</span> : null}
          </span>
          <span className="model-row-sub">
            {specChips(model).map((chip) => (
              <span key={chip} className="spec">
                {chip}
              </span>
            ))}
            <span>
              {vendorDisplayName(model.vendor)} · {modelKinds(model)}
            </span>
          </span>
        </span>
        <span className="model-row-meta">
          <span className="model-row-price">{fromPrice(model.routes) ?? t("nonePrice")}</span>
          <span className={"key-state " + (keyed ? "is-on" : "is-off")}>{t(keyed ? "key" : "noKey")}</span>
        </span>
        {selected ? <Icon name="check" size={16} /> : <span className="check-space" />}
      </button>
    </li>
  );
}

interface PanelProps {
  models: readonly CatalogModel[];
  value: string | undefined;
  onPick: (modelId: string) => void;
}

function VendorFilter({
  vendors,
  vendor,
  setVendor,
}: {
  vendors: readonly string[];
  vendor: string | null;
  setVendor: (v: string | null) => void;
}) {
  const t = useT(M);
  return (
    <div className="chip-row" role="group" aria-label={t("filter")}>
      <button type="button" className="chip" aria-pressed={vendor === null} onClick={() => setVendor(null)}>
        {t("all")}
      </button>
      {vendors.map((v) => (
        <button
          key={v}
          type="button"
          className="chip"
          aria-pressed={vendor === v}
          onClick={() => setVendor(vendor === v ? null : v)}
        >
          <VendorLogo id={v} size={18} withName />
        </button>
      ))}
    </div>
  );
}

/** Search, maker filter and the model list inside the picker popover. */
function PickerPanel({ models, value, onPick }: PanelProps) {
  const t = useT(M);
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string | null>(null);
  const vendors = useMemo(() => [...new Set(models.map((m) => m.vendor))].sort(), [models]);
  const shown = models.filter((m) => matches(m, query, vendor));
  return (
    <>
      <div className="popover-search">
        <Icon name="search" />
        <input
          autoFocus
          type="search"
          placeholder={t("search")}
          aria-label={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <VendorFilter vendors={vendors} vendor={vendor} setVendor={setVendor} />
      <ul className="model-list" aria-label={t("models")}>
        {shown.map((model) => (
          <ModelRow key={model.id} model={model} selected={model.id === value} onPick={() => onPick(model.id)} />
        ))}
        {shown.length === 0 ? <li className="empty-line">{t("empty")}</li> : null}
      </ul>
    </>
  );
}

export function ModelPicker({ models, kind, value, onChange, variant = "row", tasks }: Props) {
  const t = useT(M);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const ofKind = useMemo(
    () => models.filter((m) => m.kind === kind && (!tasks || m.tasks.some((t) => tasks.includes(t)))),
    [models, kind, tasks],
  );
  const current = ofKind.find((m) => m.id === value);
  return (
    <div className={"picker picker-" + variant}>
      <button
        ref={trigger}
        type="button"
        className="picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("modelLabel", { model: current?.label ?? t("none") })}
        onClick={() => setOpen(!open)}
      >
        {variant === "row" ? <span className="setting-caption">{t("model")}</span> : null}
        <span className="setting-value picker-value">
          {current ? <VendorLogo id={current.vendor} size={variant === "row" ? 18 : 16} /> : null}
          {current?.label ?? t("choose")}
        </span>
        <Icon name="chevron" size={16} />
      </button>
      <Popover
        open={open}
        onClose={() => {
          const restore = document.activeElement !== trigger.current && document.activeElement?.closest(".model-popover");
          setOpen(false);
          if (restore) trigger.current?.focus();
        }}
        label={t("choose")}
        className="model-popover"
        anchor={trigger}
        placement={variant === "row" ? "right" : "top"}
      >
        <PickerPanel
          models={ofKind}
          value={value}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      </Popover>
    </div>
  );
}
