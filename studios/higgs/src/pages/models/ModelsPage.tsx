import { useMemo, useState } from "react";
import { modelHasKey, type CatalogModel, type CatalogRoute, type MediaKind } from "@ima2/studio-kit";
import { href } from "../../router.ts";
import { useStudio } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import { modelKinds, routePrice } from "../../ui/format.ts";
import "../../styles/models.css";

const KINDS: readonly { id: MediaKind | "all"; label: string }[] = [
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
  return (
    <li className="route-line">
      <VendorLogo id={route.providerId} size={16} />
      <span className="route-line-name">{route.label}</span>
      <span className="tag">{route.route === "direct" ? "Direct" : "Aggregator"}</span>
      <span className="route-line-price" title={priceSource(route)}>
        {routePrice(route)}
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
    <article className="model-card" aria-label={model.label}>
      <div className="model-card-thumb">
        <VendorLogo id={model.vendor} shape="full" size={40} />
      </div>
      <div className="model-card-body">
        <h3>{model.label}</h3>
        <p className="muted">
          <code>{model.id}</code> · {modelKinds(model)}
        </p>
        <ul className="route-lines" aria-label={"Ways to run " + model.label}>
          {model.routes.map((route) => (
            <RouteLine key={route.providerId} route={route} />
          ))}
        </ul>
        {model.kind !== "audio" ? (
          <a className="btn" href={href(target, { model: model.id })}>
            <Icon name="sparkle" size={14} /> {modelHasKey(model) ? "Use this model" : "Open and add a key"}
          </a>
        ) : null}
      </div>
    </article>
  );
}

function useFiltered(models: readonly CatalogModel[], kind: MediaKind | "all", vendor: string | null, query: string) {
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

function KindTabs({ kind, setKind }: { kind: MediaKind | "all"; setKind: (k: MediaKind | "all") => void }) {
  return (
    <div className="tabs" role="tablist" aria-label="Kind">
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={kind === k.id}
          onClick={() => setKind(k.id)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

function ModelFilters(props: {
  vendors: readonly string[];
  kind: MediaKind | "all";
  setKind: (k: MediaKind | "all") => void;
  vendor: string | null;
  setVendor: (v: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  return (
    <div className="models-filters">
      <KindTabs kind={props.kind} setKind={props.setKind} />
      <label className="search-field">
        <Icon name="search" size={15} />
        <input
          type="search"
          placeholder="Search models"
          aria-label="Search models"
          value={props.query}
          onChange={(e) => props.setQuery(e.target.value)}
        />
      </label>
      <div className="chip-row" role="group" aria-label="Filter by maker">
        {props.vendors.map((v) => (
          <button
            key={v}
            type="button"
            className="chip"
            aria-pressed={props.vendor === v}
            onClick={() => props.setVendor(props.vendor === v ? null : v)}
          >
            <VendorLogo id={v} size={14} withName />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Every model the server can run, who makes it, every way to run it and what each costs. */
export function ModelsPage({ vendor: initialVendor }: { vendor?: string }) {
  const catalog = useStudio((s) => s.catalog);
  const [kind, setKind] = useState<MediaKind | "all">("all");
  const [vendor, setVendor] = useState<string | null>(initialVendor ?? null);
  const [query, setQuery] = useState("");
  const models = catalog?.models ?? [];
  const vendors = useMemo(() => [...new Set(models.map((m) => m.vendor))].sort(), [models]);
  const shown = useFiltered(models, kind, vendor, query);
  if (!catalog)
    return (
      <div className="empty" role="status">
        Loading models
      </div>
    );
  return (
    <div className="page-pad">
      <div className="page-head">
        <h1>Models and prices</h1>
        <p className="muted">Prices are the providers' own published rates. ima2 adds nothing on top.</p>
      </div>
      <ModelFilters
        vendors={vendors}
        kind={kind}
        setKind={setKind}
        vendor={vendor}
        setVendor={setVendor}
        query={query}
        setQuery={setQuery}
      />
      {shown.length === 0 ? (
        <div className="empty">
          <h2>No model matches</h2>
          <p>Clear the search or pick another maker.</p>
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
