import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
import { useMemo, useState } from "react";
import type { HistoryItem, MediaKind } from "@ima2/studio-kit";
import { href, navigate, replaceRoute } from "../../router.ts";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { Tile } from "../../ui/Feed.tsx";
import { Lightbox } from "../../ui/Lightbox.tsx";
import { AssetFilters, NO_NARROW, PERIODS, narrowQuery, type Narrow, type Period } from "./AssetFilters.tsx";
import { ElementsPanel } from "./ElementsPanel.tsx";
import { useAssetPages } from "./useAssets.ts";
import "../../styles/assets.css";

const tabs = ["all", "images", "videos", "audio", "saved", "elements"] as const;
export type Tab = (typeof tabs)[number];
const kinds: Partial<Record<Tab, MediaKind>> = { images: "image", videos: "video", audio: "audio" };
const DAY = 24 * 60 * 60 * 1000;
const SPAN: Record<Period, number> = { any: 0, day: DAY, week: 7 * DAY, month: 30 * DAY };

/** Nothing to show: with a search or filter on, say so and offer to clear it; otherwise where to make something. */
function AssetEmpty({ tab, narrowed, clear, elsewhere }: { tab: Tab; narrowed: boolean; clear: () => void; elsewhere: string | null }) {
  const t = useT(M);
  const text = narrowed ? t("noMatch") : t(({ all: "noAll", images: "noImages", videos: "noVideos", audio: "noAudio", saved: "noSaved", elements: "noAll" } as const)[tab]);
  return (
    <div className="empty">
      <h2>{text}</h2>
      {narrowed ? (
        <div className="assets-empty-actions">
          <button className="btn" type="button" onClick={clear}>{t("clear")}</button>
          {/* A search that finds no image may still match a video. */}
          {elsewhere ? <a className="btn" href={elsewhere}>{t("searchAll")}</a> : null}
        </div>
      )
        : tab === "saved" ? <a href="#/assets/all">{t("browse")}</a>
        : <a href={tab === "images" ? "#/image" : tab === "audio" ? "#/audio" : "#/video"}>{t(tab === "images" ? "createImage" : tab === "audio" ? "createAudio" : "createVideo")}</a>}
    </div>
  );
}

interface AssetResultsProps {
  items: readonly HistoryItem[];
  tab: Tab;
  narrowed: boolean;
  matched: number | null;
  density: string;
  error: string;
  loading: boolean;
  cursor: string | null;
  retry: () => void;
  loadMore: () => Promise<void>;
  select: (id: string) => void;
  clear: () => void;
  /** The same search on the All tab, when this tab is narrower and a search is on. */
  elsewhere: string | null;
}

function LoadMore({ loading, loadMore }: { loading: boolean; loadMore: () => Promise<void> }) {
  const t = useT(M);
  return (
    <button type="button" className="btn load-more" disabled={loading} onClick={() => { void loadMore(); }}>
      {t(loading ? "loadingMore" : "loadMore")}
    </button>
  );
}

function AssetResults({ items, tab, narrowed, matched, density, error, loading, cursor, retry, loadMore, select, clear, elsewhere }: AssetResultsProps) {
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
      {!loading && !error && !items.length ? <AssetEmpty tab={tab} narrowed={narrowed} clear={clear} elsewhere={elsewhere} /> : null}
      {/* The count matters once something narrows the list; the whole library's size is not a result. */}
      {narrowed && matched !== null && items.length ? (
        <p className="assets-count" role="status">
          <span>{t(matched === 1 ? "countOne" : "count", { n: matched })}</span>
          <button type="button" className="chip" onClick={clear}>{t("clear")}</button>
        </p>
      ) : null}
      <section className={"grid grid-" + density} aria-label={t("results")}>
        {items.map((item) => (
          <Tile key={item.historyId} item={item} onOpen={(value) => select(value.historyId)} />
        ))}
      </section>
      {cursor ? <LoadMore loading={loading} loadMore={loadMore} /> : null}
    </>
  );
}

export function AssetsPage({ kind, q, model, period, order }: { kind?: string; q?: string; model?: string; period?: string; order?: string }) {
  const t = useT(M);
  const tab: Tab = tabs.includes(kind as Tab) ? (kind as Tab) : "all";
  const studio = useStudioApi();
  const history = useStudio((s) => s.history);
  // The search and filters live in the address: a reload, back and forward, and a shared link show the same list.
  const narrow: Narrow = useMemo(() => ({
    q: q ?? "", model: model ?? "", order: order === "oldest" ? "oldest" : "newest",
    period: PERIODS.includes(period as Period) ? (period as Period) : "any",
  }), [q, model, order, period]);
  const setAll = (next: Narrow, typing = false) => (typing ? replaceRoute : navigate)("assets/" + tab, narrowQuery(next));
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [selected, setSelected] = useState<string | null>(null);
  // The period starts when it is chosen, so paging and reloads ask for the same span.
  const sinceMs = useMemo(() => (narrow.period === "any" ? undefined : Date.now() - SPAN[narrow.period]), [narrow.period]);
  const pages = useAssetPages(studio.client, {
    ...(kinds[tab] ? { kind: kinds[tab] } : {}),
    ...(tab === "saved" ? { favorite: true } : {}),
    ...(narrow.model ? { model: narrow.model } : {}),
    ...(narrow.q ? { q: narrow.q } : {}),
    ...(narrow.order === "oldest" ? { order: "oldest" as const } : {}),
    ...(sinceMs !== undefined ? { sinceMs } : {}),
  }, history);
  const narrowed = !!(narrow.q || narrow.model || narrow.period !== "any");
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
        narrow={narrow}
        setNarrow={(patch) => setAll({ ...narrow, ...patch }, "q" in patch)}
        models={pages.models}
        density={density}
        setDensity={setDensity}
      />
      {tab === "elements" ? <ElementsPanel /> : (
        <AssetResults
          {...pages} tab={tab} narrowed={narrowed} density={density} select={setSelected}
          clear={() => setAll({ ...NO_NARROW, order: narrow.order })}
          elsewhere={narrow.q && tab !== "all" ? href("assets/all", narrowQuery({ ...narrow, model: "" })) : null}
        />
      )}
      <Lightbox item={open} onClose={() => setSelected(null)} />
    </main>
  );
}
