import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
import { useState } from "react";
import type { HistoryItem, HistoryQuery, MediaKind } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { Tile } from "../../ui/Feed.tsx";
import { Lightbox } from "../../ui/Lightbox.tsx";
import { AssetFilters } from "./AssetFilters.tsx";
import { useAssetModels, useAssetPages } from "./useAssets.ts";
import "../../styles/assets.css";

const tabs = ["all", "images", "videos", "audio", "saved"] as const;
export type Tab = (typeof tabs)[number];
const kinds: Partial<Record<Tab, MediaKind>> = { images: "image", videos: "video", audio: "audio" };

function AssetEmpty({ tab, model, clearModel }: { tab: Tab; model: string; clearModel: () => void }) {
  const t = useT(M);
  const text = model ? t("noMatch") : t(({ all: "noAll", images: "noImages", videos: "noVideos", audio: "noAudio", saved: "noSaved" } as const)[tab]);
  return (
    <div className="empty">
      <h2>{text}</h2>
      {model ? <button className="btn" type="button" onClick={clearModel}>{t("clearModel")}</button>
        : tab === "saved" ? <a href="#/assets/all">{t("browse")}</a>
        : tab === "audio" ? <><p>{t("audioNext")}</p><a href="#/assets/all">{t("browse")}</a></>
        : <a href={tab === "images" ? "#/image" : "#/video"}>{t(tab === "images" ? "createImage" : "createVideo")}</a>}
    </div>
  );
}

interface AssetResultsProps {
  items: readonly HistoryItem[];
  tab: Tab;
  model: string;
  density: string;
  error: string;
  loading: boolean;
  cursor: string | null;
  retry: () => void;
  loadMore: () => Promise<void>;
  select: (id: string) => void;
  clearModel: () => void;
}

function LoadMore({ loading, loadMore }: { loading: boolean; loadMore: () => Promise<void> }) {
  const t = useT(M);
  return (
    <button type="button" className="btn load-more" disabled={loading} onClick={() => { void loadMore(); }}>
      {t(loading ? "loadingMore" : "loadMore")}
    </button>
  );
}

function AssetResults({
  items,
  tab,
  model,
  density,
  error,
  loading,
  cursor,
  retry,
  loadMore,
  select,
  clearModel,
}: AssetResultsProps) {
  const t = useT(M);
  return (
    <>
      {error ? (
        <div role="alert">
          {t("error", { error })}{" "}
          <button className="btn" onClick={retry}>
            {t("retry")}
          </button>
        </div>
      ) : null}
      {loading && !items.length ? <p role="status">{t("loading")}</p> : null}
      {!loading && !error && !items.length ? <AssetEmpty tab={tab} model={model} clearModel={clearModel} /> : null}
      <section className={"grid grid-" + density} aria-label={t("results")}>
        {items.map((item) => (
          <Tile key={item.historyId} item={item} onOpen={(value) => select(value.historyId)} />
        ))}
      </section>
      {cursor ? <LoadMore loading={loading} loadMore={loadMore} /> : null}
    </>
  );
}

export function AssetsPage({ kind }: { kind?: string }) {
  const t = useT(M);
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
  const pages = useAssetPages(studio.client, query, history);
  const models = useAssetModels(studio.client, history, pages.revision);
  const open = pages.items.find((item) => item.historyId === selected) ?? null;
  return (
    <main className="page-pad assets-page">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
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
      <AssetResults {...pages} tab={tab} model={model} density={density} select={setSelected} clearModel={() => setModel("")} />
      <Lightbox item={open} onClose={() => setSelected(null)} />
    </main>
  );
}
