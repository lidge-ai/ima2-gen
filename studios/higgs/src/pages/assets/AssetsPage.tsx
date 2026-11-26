import { useState } from "react";
import type { HistoryQuery, MediaKind } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { Tile } from "../../ui/Feed.tsx";
import { Lightbox } from "../../ui/Lightbox.tsx";
import { useAssetModels, useAssetPages } from "./useAssets.ts";
import "../../styles/assets.css";

const tabs = ["all", "images", "videos", "audio", "saved"] as const;
type Tab = (typeof tabs)[number];
const labels: Record<Tab, string> = { all: "All", images: "Images", videos: "Videos", audio: "Audio", saved: "Saved" };
const kinds: Partial<Record<Tab, MediaKind>> = { images: "image", videos: "video", audio: "audio" };

function emptyText(tab: Tab, model: string) {
  if (model) return "No assets match this model and filter.";
  return tab === "saved"
    ? "No saved assets yet. Save a result to find it here."
    : `No ${tab === "all" ? "assets" : tab} yet.`;
}

function AssetFilters({
  tab,
  model,
  setModel,
  models,
  density,
  setDensity,
}: {
  tab: Tab;
  model: string;
  setModel: (v: string) => void;
  models: readonly string[];
  density: string;
  setDensity: (v: "comfortable" | "compact") => void;
}) {
  const catalog = useStudio((s) => s.catalog);
  return (
    <div className="assets-filters">
      <nav className="tabs assets-tabs" aria-label="Asset filters">
        {tabs.map((value) => (
          <a key={value} className="tab" href={"#/assets/" + value} aria-current={tab === value ? "page" : undefined}>
            {labels[value]}
          </a>
        ))}
      </nav>
      <label className="assets-model">
        Model{" "}
        <select aria-label="Filter by model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">All models</option>
          {models.map((id) => (
            <option key={id} value={id}>
              {catalog?.models.find((m) => m.id === id)?.label ?? id}
            </option>
          ))}
        </select>
      </label>
      <div className="assets-density" role="group" aria-label="Grid density">
        {(["comfortable", "compact"] as const).map((value) => (
          <button
            key={value}
            className="btn"
            type="button"
            aria-pressed={density === value}
            onClick={() => setDensity(value)}
          >
            {value === "comfortable" ? "Comfortable" : "Compact"}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AssetsPage({ kind }: { kind?: string }) {
  const tab: Tab = tabs.includes(kind as Tab) ? (kind as Tab) : "all";
  const studio = useStudioApi();
  const history = useStudio((s) => s.history);
  const [model, setModel] = useState("");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [selected, setSelected] = useState<string | null>(null);
  const query: HistoryQuery = {
    ...(kinds[tab] ? { kind: kinds[tab] } : {}),
    ...(tab === "saved" ? { favorite: true } : {}),
    ...(model ? { model } : {}),
  };
  const { items, cursor, error, loading, revision, loadMore, retry } = useAssetPages(studio.client, query, history);
  const models = useAssetModels(studio.client, history, revision);
  const open = items.find((item) => item.historyId === selected) ?? null;
  return (
    <main className="page-pad assets-page">
      <header className="page-head">
        <div>
          <h1>Assets</h1>
          <p>Browse your generated media.</p>
        </div>
      </header>
      <AssetFilters
        tab={tab}
        model={model}
        setModel={setModel}
        models={models}
        density={density}
        setDensity={setDensity}
      />
      {error ? (
        <div role="alert">
          Could not load assets: {error}{" "}
          <button className="btn" onClick={retry}>
            Retry
          </button>
        </div>
      ) : null}
      {loading && !items.length ? <p role="status">Loading assets</p> : null}
      {!loading && !error && !items.length ? (
        <div className="empty">
          <h2>{emptyText(tab, model)}</h2>
          <a href={tab === "images" ? "#/image" : "#/video"}>
            {tab === "images" ? "Create an image" : "Create a video"}
          </a>
        </div>
      ) : null}
      <section className={"grid grid-" + density} aria-label="Assets results">
        {items.map((item) => (
          <Tile key={item.historyId} item={item} onOpen={(value) => setSelected(value.historyId)} />
        ))}
      </section>
      {cursor ? (
        <button
          type="button"
          className="btn load-more"
          disabled={loading}
          onClick={() => {
            void loadMore();
          }}
        >
          {loading ? "Loading" : "Load more"}
        </button>
      ) : null}
      <Lightbox item={open} onClose={() => setSelected(null)} />
    </main>
  );
}
