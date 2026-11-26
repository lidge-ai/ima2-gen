import { useMemo, useState } from "react";
import { modelHasKey, type CatalogModel, type CatalogRoute, type MediaKind } from "@ima2/studio-kit";
import { href } from "../../router.ts";
import { useStudio } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { VendorLogo, vendorDisplayName } from "../../ui/VendorLogo.tsx";
import { modelKinds, routePrice } from "../../ui/format.ts";
import "../../styles/models.css";

type Kind = MediaKind | "all";

const KINDS: readonly { id: Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "image", label: "Image" },
  { id: "audio", label: "Audio" },
];

function priceSource(route: CatalogRoute): string {
  const first = route.pricing[0];
  return first ? "Source: " + first.source + " (checked " + first.checkedAt + ")" : "The provider publishes no price";
}

function RouteLine({ route }: { route: CatalogRoute }) {
  const priced = route.pricing.length > 0;
  return (
    <li className="route-line">
      <VendorLogo id={route.providerId} size={18} />
      <span className="route-line-name">
        <span className="route-line-label">{route.label}</span>
        {route.route === "direct" ? <span className="tag">Direct</span> : null}
      </span>
      <span className={"route-line-price" + (priced ? "" : " is-none")} title={priceSource(route)}>
        {priced ? routePrice(route) : "Not published"}
      </span>
      <span className={"key-state " + (route.keyConfigured ? "is-on" : "is-off")}>
        {route.keyConfigured ? "Key saved" : "No key"}
      </span>
    </li>
  );
}

function ModelCard({ model }: { model: CatalogModel }) {
  const target = model.kind === "image" ? "image" : "video";
  return (
    <article className="model-card" aria-labelledby={"model-" + model.id}>
      <header className="model-card-head">
        <VendorLogo id={model.vendor} size={32} />
        <div>
          <h3 id={"model-" + model.id}>{model.label}</h3>
          <p className="model-card-maker">
            {vendorDisplayName(model.vendor)} · {modelKinds(model)}
          </p>
        </div>
      </header>
      <p className="model-card-id">
        <code>{model.id}</code>
      </p>
      <ul className="route-lines" aria-label={"Ways to run " + model.label}>
        {model.routes.map((route) => (
          <RouteLine key={route.providerId} route={route} />
        ))}
      </ul>
      <div className="model-card-foot">
        {model.kind !== "audio" ? (
          <a className="btn" href={href(target, { model: model.id })}>
            {modelHasKey(model) ? "Use this model" : "Open and add a key"}
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
  return (
    <div className="tabs" role="group" aria-label="Kind">
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          className="tab"
          aria-pressed={kind === k.id}
          onClick={() => setKind(k.id)}
        >
          {k.label}
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
  return (
    <div className="models-filters">
      <div className="models-filters-row">
        <KindTabs kind={f.kind} setKind={f.setKind} />
        <label className="search-field">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search models"
            aria-label="Search models"
            value={f.query}
            onChange={(e) => f.setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="chip-row" role="group" aria-label="Filter by maker">
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
  const active = f.kind !== "all" || f.vendor !== null || f.query.trim() !== "";
  const parts = [
    f.vendor ? vendorDisplayName(f.vendor) : null,
    f.kind !== "all" ? KINDS.find((k) => k.id === f.kind)?.label : null,
    f.query.trim() ? '"' + f.query.trim() + '"' : null,
  ].filter(Boolean);
  return (
    <div className="results-bar">
      <p role="status">
        {active ? count + " of " + total + " models" : total + " models"}
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
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/** Every model the server can run, who makes it, every way to run it and what each costs. */
export function ModelsPage({ vendor: initialVendor }: { vendor?: string }) {
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
        Loading models
      </div>
    );
  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Models and prices</h1>
          <p className="muted">Prices are the providers' own published rates. ima2 adds nothing on top.</p>
        </div>
      </header>
      <ModelFilters vendors={vendors} {...filters} />
      <ResultsBar count={shown.length} total={models.length} {...filters} />
      {shown.length === 0 ? (
        <div className="empty">
          <h2>No model matches</h2>
          <p>Clear the filters or pick another maker.</p>
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
