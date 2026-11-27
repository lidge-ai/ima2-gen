import { Fragment, useMemo, useState } from "react";
import { TALKING_TASKS, formRoutes, modelHasKey, type CatalogModel, type CatalogRoute, type MediaKind } from "@ima2/studio-kit";
import { href } from "../../router.ts";
import { useStudio } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { VendorLogo, vendorDisplayName } from "../../ui/VendorLogo.tsx";
import { modelKindList, routePrice } from "../../ui/format.ts";
import { messages, tr, useT } from "../../i18n.ts";
import "../../styles/models.css";

type Kind = MediaKind | "all";

const M = messages(
  {
    all: "All",
    video: "Video",
    image: "Image",
    audio: "Audio",
    kind: "Kind",
    source: "Source: {source} (checked {date})",
    noSource: "The provider publishes no price",
    notPublished: "Not published",
    keySaved: "Key saved",
    noKey: "No key",
    direct: "Direct",
    local: "This computer",
    localFree: "No provider charge",
    noKeyNeeded: "No key needed",
    ways: "Ways to run {model}",
    use: "Use this model",
    openAdd: "Add a key to use it",
    search: "Search models",
    byMaker: "Filter by maker",
    countAll: "{n} models",
    countSome: "{n} of {total} models",
    clear: "Clear filters",
    loading: "Loading models",
    title: "Models and prices",
    lead: "Prices are the providers' own published rates. ima2 adds nothing on top.",
    noMatch: "No model matches",
    noMatchHint: "Clear the filters or pick another maker.",
  },
  {
    all: "전체",
    video: "영상",
    image: "이미지",
    audio: "오디오",
    kind: "종류",
    source: "출처: {source} ({date} 확인)",
    noSource: "제공업체가 가격을 공개하지 않았어요",
    notPublished: "가격 비공개",
    keySaved: "키 저장됨",
    noKey: "키 없음",
    direct: "직결",
    local: "이 컴퓨터",
    localFree: "요금 없음",
    noKeyNeeded: "키 필요 없음",
    ways: "{model} 실행 경로",
    use: "이 모델 쓰기",
    openAdd: "키 넣고 쓰기",
    search: "모델 검색",
    byMaker: "제작사로 거르기",
    countAll: "모델 {n}개",
    countSome: "모델 {total}개 중 {n}개",
    clear: "필터 지우기",
    loading: "모델 불러오는 중",
    title: "모델과 가격",
    lead: "가격은 제공업체가 공개한 요금 그대로예요. ima2는 따로 붙이는 돈이 없어요.",
    noMatch: "맞는 모델이 없어요",
    noMatchHint: "필터를 지우거나 다른 제작사를 골라 보세요.",
  },
);

const KINDS: readonly { id: Kind; label: "all" | "video" | "image" | "audio" }[] = [
  { id: "all", label: "all" },
  { id: "video", label: "video" },
  { id: "image", label: "image" },
  { id: "audio", label: "audio" },
];

function priceSource(route: CatalogRoute): string {
  const first = route.pricing[0];
  return first ? tr(M, "source", { source: first.source, date: first.checkedAt }) : tr(M, "noSource");
}

function RouteLine({ route }: { route: CatalogRoute }) {
  const t = useT(M);
  const priced = route.pricing.length > 0;
  return (
    <li className="route-line">
      <VendorLogo id={route.providerId} size={18} />
      <span className="route-line-name">
        <span className="route-line-label" title={route.label}>{route.label}</span>
        {route.route === "direct" ? <span className="tag">{t("direct")}</span> : route.route === "local" ? <span className="tag">{t("local")}</span> : null}
      </span>
      {/* A local route has no published price to be missing and no key to be saved. */}
      <span className={"route-line-price" + (priced || route.route === "local" ? "" : " is-none")} title={route.route === "local" ? undefined : priceSource(route)}>
        {route.route === "local" ? t("localFree") : priced ? routePrice(route) : t("notPublished")}
      </span>
      <span className={"key-state " + (route.keyConfigured ? "is-on" : "is-off")}>
        {route.keyless ? t("noKeyNeeded") : route.keyConfigured ? t("keySaved") : t("noKey")}
      </span>
    </li>
  );
}

function ModelCard({ model }: { model: CatalogModel }) {
  const t = useT(M);
  const target = model.kind === "image" ? "image" : "video";
  // Lip-sync, avatar, dubbing and subtitle models open the talking form, the only one that can fill their inputs.
  const talking = TALKING_TASKS.some((task) => formRoutes(model, task).length > 0);
  return (
    <article className="model-card" aria-labelledby={"model-" + model.id}>
      <header className="model-card-head">
        <VendorLogo id={model.vendor} size={32} />
        <div>
          <h3 id={"model-" + model.id}>{model.label}</h3>
          <p className="model-card-maker">
            {[vendorDisplayName(model.vendor), ...modelKindList(model)].map((part, i) => (
              <Fragment key={part}>
                {i ? " · " : ""}
                <span className="kind">{part}</span>
              </Fragment>
            ))}
          </p>
        </div>
      </header>
      <p className="model-card-id">
        <code>{model.id}</code>
      </p>
      <ul className="route-lines" aria-label={t("ways", { model: model.label })}>
        {model.routes.map((route) => (
          <RouteLine key={route.providerId} route={route} />
        ))}
      </ul>
      <div className="model-card-foot">
        {model.kind !== "audio" ? (
          <a className="btn" href={href(target, { model: model.id, ...(talking ? { mode: "speak" } : {}) })}>
            {modelHasKey(model) ? t("use") : t("openAdd")}
            <Icon name="arrowRight" size={14} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function useFiltered(models: readonly CatalogModel[], kind: Kind, vendor: string | null, query: string) {
  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        (kind === "all" || m.kind === kind) &&
        (!vendor || m.vendor === vendor) &&
        (!needle || (m.label + " " + m.id).toLowerCase().includes(needle)),
    );
  }, [models, kind, vendor, query]);
}

function KindTabs({ kind, setKind }: { kind: Kind; setKind: (k: Kind) => void }) {
  const t = useT(M);
  return (
    <div className="tabs" role="group" aria-label={t("kind")}>
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          className="tab"
          aria-pressed={kind === k.id}
          onClick={() => setKind(k.id)}
        >
          {t(k.label)}
        </button>
      ))}
    </div>
  );
}

interface Filters {
  kind: Kind;
  setKind: (k: Kind) => void;
  vendor: string | null;
  setVendor: (v: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
}

function ModelFilters({ vendors, ...f }: Filters & { vendors: readonly string[] }) {
  const t = useT(M);
  return (
    <div className="models-filters">
      <div className="models-filters-row">
        <KindTabs kind={f.kind} setKind={f.setKind} />
        <label className="search-field">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={f.query}
            onChange={(e) => f.setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="chip-row" role="group" aria-label={t("byMaker")}>
        {vendors.map((v) => (
          <button
            key={v}
            type="button"
            className="chip chip-logo"
            aria-pressed={f.vendor === v}
            onClick={() => f.setVendor(f.vendor === v ? null : v)}
          >
            <VendorLogo id={v} size={18} withName />
          </button>
        ))}
      </div>
    </div>
  );
}

/** How many models show and which filters narrow them, with one way to clear them all. */
function ResultsBar({ count, total, ...f }: Filters & { count: number; total: number }) {
  const t = useT(M);
  const active = f.kind !== "all" || f.vendor !== null || f.query.trim() !== "";
  const parts = [
    f.vendor ? vendorDisplayName(f.vendor) : null,
    f.kind !== "all" ? t(KINDS.find((k) => k.id === f.kind)?.label ?? "all") : null,
    f.query.trim() ? '"' + f.query.trim() + '"' : null,
  ].filter(Boolean);
  return (
    <div className="results-bar">
      <p role="status">
        {active ? t("countSome", { n: count, total }) : t("countAll", { n: total })}
        {parts.length ? <span className="muted"> · {parts.join(" · ")}</span> : null}
      </p>
      {active ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            f.setKind("all");
            f.setVendor(null);
            f.setQuery("");
          }}
        >
          {t("clear")}
        </button>
      ) : null}
    </div>
  );
}

/** Every model the server can run, who makes it, every way to run it and what each costs. */
export function ModelsPage({ vendor: initialVendor }: { vendor?: string }) {
  const t = useT(M);
  const catalog = useStudio((s) => s.catalog);
  const [kind, setKind] = useState<Kind>("all");
  const [vendor, setVendor] = useState<string | null>(initialVendor ?? null);
  const [query, setQuery] = useState("");
  const models = catalog?.models ?? [];
  const vendors = useMemo(() => [...new Set(models.map((m) => m.vendor))].sort(), [models]);
  const shown = useFiltered(models, kind, vendor, query);
  const filters = { kind, setKind, vendor, setVendor, query, setQuery };
  if (!catalog)
    return (
      <div className="empty" role="status">
        {t("loading")}
      </div>
    );
  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("lead")}</p>
        </div>
      </header>
      <ModelFilters vendors={vendors} {...filters} />
      <ResultsBar count={shown.length} total={models.length} {...filters} />
      {shown.length === 0 ? (
        <div className="empty">
          <h2>{t("noMatch")}</h2>
          <p>{t("noMatchHint")}</p>
        </div>
      ) : (
        <div className="model-grid">
          {shown.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      )}
    </div>
  );
}
