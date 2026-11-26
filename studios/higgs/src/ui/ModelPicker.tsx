import { messages, useT } from "../i18n.ts";
import { useId, useMemo, useRef, useState } from "react";
import { modelHasKey, type CatalogModel, type MediaKind } from "@ima2/studio-kit";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";
import { fromPrice, modelKinds } from "./format.ts";
import { VendorLogo, vendorDisplayName } from "./VendorLogo.tsx";

const M = messages(
  {
    "audio": "Audio",
    "nonePrice": "No published price",
        "all": "All",
    "search": "Search models",
    "models": "Models",
    "empty": "No model matches.",
    "none": "none",
    "modelLabel": "Model: {model}",
    "model": "Model",
    "choose": "Choose a model",
    "filters": "Show only",
    "f_mine": "My keys",
    "f_audio": "Sound",
    "f_frames": "Start from an image",
    "f_refs": "References",
    "f_hd": "1080p or more",
    "f_long": "10 s or longer",
    "maker": "Maker",
    "count": "{n} of {total}",
    "recent": "Recent",
    "ready": "Ready with your keys",
    "needsKey": "Needs a key (add it after picking)",
  },
  {
    "audio": "오디오",
    "nonePrice": "공개 가격 없음",
        "all": "전체",
    "search": "모델 검색",
    "models": "모델",
    "empty": "일치하는 모델이 없어요. 검색어나 필터를 바꿔 보세요.",
    "none": "없음",
    "modelLabel": "모델: {model}",
    "model": "모델",
    "choose": "모델 선택",
    "filters": "이것만 보기",
    "f_mine": "내 키로 되는 것",
    "f_audio": "사운드",
    "f_frames": "이미지로 시작",
    "f_refs": "레퍼런스",
    "f_hd": "1080p 이상",
    "f_long": "10초 이상",
    "maker": "제작사",
    "count": "{total}개 중 {n}개",
    "recent": "최근 사용",
    "ready": "내 키로 바로 쓸 수 있어요",
    "needsKey": "키가 필요해요 (고른 뒤 넣을 수 있어요)",
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

/** Lines of the base resolution ("1080p", "4k"); upscale variants such as "4k-esr" count as their base. */
function lines(value: string): number | null {
  const m = /^(\d+)(p|k)/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "k" ? n * 540 : n;
}

const resName = (h: number) => (h >= 2160 ? h / 540 + "K" : h + "p");

/** Short ranges a person reads at a glance: "480p–4K", "4–15s". Never the option ids. */
function specChips(model: CatalogModel): string[] {
  const chips: string[] = [];
  const heights = (model.params.resolutions ?? []).map(String).map(lines).filter((h): h is number => h !== null);
  if (heights.length) {
    const lo = Math.min(...heights), hi = Math.max(...heights);
    chips.push(lo === hi ? resName(lo) : resName(lo) + "–" + resName(hi));
  }
  const d = model.params.durationsSec;
  if (d?.length) chips.push(d.length > 1 ? Math.min(...d) + "–" + Math.max(...d) + "s" : d[0] + "s");
  return chips;
}

function ModelRow({ model, selected, onPick }: { model: CatalogModel; selected: boolean; onPick: () => void }) {
  const t = useT(M);
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

type Feature = "mine" | "audio" | "frames" | "refs" | "hd" | "long";

const FEATURES: readonly { id: Feature; test: (m: CatalogModel) => boolean }[] = [
  { id: "mine", test: (m) => modelHasKey(m) },
  { id: "audio", test: (m) => !!m.params.nativeAudio },
  { id: "frames", test: (m) => m.tasks.includes("image-to-video") || m.tasks.includes("image-to-image") },
  { id: "refs", test: (m) => m.tasks.includes("reference-to-video") },
  { id: "hd", test: (m) => (m.params.resolutions ?? []).some((r) => /1080|1440|2k|4k/i.test(String(r))) },
  { id: "long", test: (m) => Math.max(0, ...(m.params.durationsSec ?? [])) >= 10 },
];

const RECENT_KEY = "ima2.studio.recentModels";

function recentIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((v) => v !== id)].slice(0, 3)));
  } catch {
    /* storage disabled */
  }
}

function FeatureFilter({ models, on, toggle }: { models: readonly CatalogModel[]; on: readonly Feature[]; toggle: (f: Feature) => void }) {
  const t = useT(M);
  const offered = FEATURES.filter((f) => models.some(f.test) && !models.every(f.test));
  if (!offered.length) return null;
  return (
    <div className="chip-row picker-filters" role="group" aria-label={t("filters")}>
      {offered.map((f) => (
        <button key={f.id} type="button" className="chip" aria-pressed={on.includes(f.id)} onClick={() => toggle(f.id)}>
          {t(("f_" + f.id) as "f_mine")}
        </button>
      ))}
    </div>
  );
}

function MakerSelect({ vendors, vendor, setVendor }: { vendors: readonly string[]; vendor: string | null; setVendor: (v: string | null) => void }) {
  const t = useT(M);
  return (
    <label className="picker-maker">
      <span>{t("maker")}</span>
      <select value={vendor ?? ""} onChange={(e) => setVendor(e.target.value || null)}>
        <option value="">{t("all")}</option>
        {vendors.map((v) => (
          <option key={v} value={v}>
            {vendorDisplayName(v)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Group({ title, models, value, onPick }: { title: string; models: readonly CatalogModel[]; value?: string; onPick: (id: string) => void }) {
  const id = useId();
  if (!models.length) return null;
  return (
    <li className="model-group-wrap">
      <p className="model-group" id={id}>
        {title}
      </p>
      <ul className="model-sublist" aria-labelledby={id}>
        {models.map((model) => (
          <ModelRow key={model.id} model={model} selected={model.id === value} onPick={() => onPick(model.id)} />
        ))}
      </ul>
    </li>
  );
}

/** Search, feature filters, maker and the model list; models your keys can run come first. */
function PickerPanel({ models, value, onPick }: PanelProps) {
  const t = useT(M);
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const vendors = useMemo(() => [...new Set(models.map((m) => m.vendor))].sort(), [models]);
  const shown = models.filter(
    (m) => matches(m, query, vendor) && features.every((f) => FEATURES.find((x) => x.id === f)!.test(m)),
  );
  const narrowed = !!query || !!vendor || features.length > 0;
  const recent = narrowed ? [] : recentIds().flatMap((id) => shown.filter((m) => m.id === id));
  const rest = shown.filter((m) => !recent.includes(m));
  const pick = (id: string) => {
    remember(id);
    onPick(id);
  };
  return (
    <>
      <div className="popover-search">
        <Icon name="search" />
        <input autoFocus type="search" placeholder={t("search")} aria-label={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="picker-tools">
        <FeatureFilter models={models} on={features} toggle={(f) => setFeatures((on) => (on.includes(f) ? on.filter((x) => x !== f) : [...on, f]))} />
        <MakerSelect vendors={vendors} vendor={vendor} setVendor={setVendor} />
      </div>
      <p className="picker-count" role="status">
        {t("count", { n: shown.length, total: models.length })}
      </p>
      <ul className="model-list" aria-label={t("models")}>
        <Group title={t("recent")} models={recent} value={value} onPick={pick} />
        <Group title={t("ready")} models={rest.filter(modelHasKey)} value={value} onPick={pick} />
        <Group title={t("needsKey")} models={rest.filter((m) => !modelHasKey(m))} value={value} onPick={pick} />
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
