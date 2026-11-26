import { useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";
import { allowedMediaValue, chooseMediaRoute, fetchMediaCatalog, logoPlate, logoUrl, type MediaModel, type MediaRoute } from "../lib/mediaCatalog";
import type { MediaSelection } from "../lib/mediaSelection";
import { useAppStore } from "../store/useAppStore";
import { Select } from "./controls/Select";

type Selection = MediaSelection;
function selectionFor(model: MediaModel, route: MediaRoute, previous?: Selection | null): Selection {
  return {
    kind: model.kind as "image" | "video", model: model.id, adapter: route.adapter,
    task: previous && route.tasks.includes(previous.task) ? previous.task : route.tasks[0] ?? "",
    durationSec: allowedMediaValue(previous?.durationSec, route.params.durationsSec),
    resolution: allowedMediaValue(previous?.resolution, route.params.resolutions),
    aspectRatio: allowedMediaValue(previous?.aspectRatio, route.params.aspectRatios),
    audio: route.params.nativeAudio ? previous?.audio : undefined,
    negativePrompt: route.params.negativePrompt ? previous?.negativePrompt : undefined,
    seed: route.params.seed ? previous?.seed : undefined,
  };
}
function Logo({ logo, label }: { logo: MediaModel["logo"]; label: string }) {
  const [failed, setFailed] = useState(false);
  const url = logoUrl(logo);
  useEffect(() => setFailed(false), [url]);
  return url && !failed ? <span className={`media-logo media-logo--${logoPlate(logo)}`}><img src={url} alt="" onError={() => setFailed(true)} /></span> : <span className="media-logo media-logo__fallback">{logo?.name || label}</span>;
}
function ModelList({ id, models, selection, changeModel, error, loading, retry }: { id: string; models: MediaModel[]; selection: Selection | null; changeModel: (value: string) => void; error: boolean; loading: boolean; retry: () => void }) {
  const { t } = useI18n();
  const openSettings = useAppStore((state) => state.openSettings);
  return <>
    <div className="section-title" id={id}>{t("mediaPicker.model")}</div>
    {loading && <p role="status">{t("mediaPicker.loading")}</p>}
    {error && <div role="alert">{t("mediaPicker.loadError")} <button type="button" className="media-link" onClick={retry}>{t("mediaPicker.retry")}</button></div>}
    {!loading && !error && models.length === 0 && <p>{t("mediaPicker.empty")}</p>}
    <div role="group" aria-labelledby={id} className="media-list">
      <button type="button" className={`option-btn media-list__classic${!selection ? " active" : ""}`} aria-pressed={!selection} onClick={() => changeModel("")}>
        {t("mediaPicker.classic")}
      </button>
      {models.map((item) => {
        const available = item.routes.some((candidate) => candidate.hasKey);
        const selected = selection?.model === item.id && selection.kind === item.kind;
        return <button key={`${item.kind}:${item.id}`} type="button" className={`option-btn media-list__item${selected ? " active" : ""}`} aria-pressed={selected} aria-disabled={!available} onClick={() => { if (available) changeModel(`${item.kind}:${item.id}`); }}>
          <Logo logo={item.logo} label={item.vendor} />
          <span>{item.label}<br /><small>{item.vendor} · {t(`mediaPicker.kind.${item.kind}`)}{available ? "" : ` · ${t("mediaPicker.noKey")}`}</small></span>
        </button>;
      })}
    </div>
    {models.some((item) => item.routes.some((r) => !r.hasKey)) && <button className="media-link" type="button" onClick={() => openSettings("providers")}>{t("mediaPicker.settings")}</button>}
  </>;
}
function RouteList({ id, model, route, selection, setSelection }: { id: string; model: MediaModel; route: MediaRoute; selection: Selection; setSelection: (selection: Selection | null) => void }) {
  const { t } = useI18n();
  return <>
      <div className="section-title" id={`${id}-routes`}>{t("mediaPicker.route")}</div>
      <div role="group" aria-labelledby={`${id}-routes`} className="media-list">
        {model.routes.map((item) => <button key={item.adapter} type="button" className={`option-btn media-list__item${route.adapter === item.adapter ? " active" : ""}`} aria-pressed={route.adapter === item.adapter} aria-disabled={!item.hasKey} onClick={() => { if (item.hasKey) setSelection(selectionFor(model, item, selection)); }}>
          <Logo logo={item.logo} label={item.label} />
          <span>{item.label}<br /><small>{t(`mediaPicker.${item.route}`)} · {t(item.hasKey ? "mediaPicker.keyReady" : "mediaPicker.noKey")}</small></span>
        </button>)}
      </div>
  </>;
}
function RouteSelect({ title, value, values, onChange }: { title: string; value: string; values: string[]; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const tDefault = t("mediaPicker.default");
  return <div className="media-parameter"><div className="section-title">{title}</div>
    <Select ariaLabel={title} value={value} items={values.map((item) => ({ value: item, label: item || tDefault }))} onChange={onChange} portal />
  </div>;
}
function RouteControls({ route, selection, setSelection }: { route: MediaRoute; selection: Selection; setSelection: (selection: Selection | null) => void }) {
  const { t } = useI18n();
  const optional = (values: readonly (string | number)[]) => ["", ...values.map(String)];
  const choice = (title: string, value: string, values: string[], update: (value: string) => void) =>
    <RouteSelect title={title} value={value} values={values} onChange={update} />;
  return <div className="media-controls">
    {choice(t("mediaPicker.task"), selection.task, [...route.tasks], (task) => setSelection({ ...selection, task }))}
    {route.params.durationsSec?.length ? choice(t("mediaPicker.duration"), String(selection.durationSec ?? ""), optional(route.params.durationsSec), (v) => setSelection({ ...selection, durationSec: v ? Number(v) : undefined })) : null}
    {route.params.resolutions?.length ? choice(t("mediaPicker.resolution"), selection.resolution ?? "", optional(route.params.resolutions), (v) => setSelection({ ...selection, resolution: v || undefined })) : null}
    {route.params.aspectRatios?.length ? choice(t("mediaPicker.aspect"), selection.aspectRatio ?? "", optional(route.params.aspectRatios), (v) => setSelection({ ...selection, aspectRatio: v || undefined })) : null}
    {route.params.nativeAudio && <label className="media-toggle"><input type="checkbox" checked={selection.audio ?? false} onChange={(event) => setSelection({ ...selection, audio: event.target.checked })} />{t("mediaPicker.nativeAudio")}</label>}
    {route.params.negativePrompt && <label className="media-parameter"><span className="section-title">{t("mediaPicker.negativePrompt")}</span><input className="video-topic-input" value={selection.negativePrompt ?? ""} onChange={(event) => setSelection({ ...selection, negativePrompt: event.target.value })} /></label>}
    {route.params.seed && <label className="media-parameter"><span className="section-title">{t("mediaPicker.seed")}</span><input className="video-topic-input" type="number" value={selection.seed ?? ""} onChange={(event) => setSelection({ ...selection, seed: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
    {route.pricing.map((price, index) => <div className="media-price" key={index}>{t("mediaPicker.price", { amount: `$${price.usd}`, unit: t(`mediaPicker.units.${price.unit}`) })}{price.variant && ` · ${price.variant}`} · <a href={price.source} target="_blank" rel="noreferrer">{t("mediaPicker.checked", { date: price.checkedAt })}</a></div>)}
    {route.docsUrl && <a className="media-link" href={route.docsUrl} target="_blank" rel="noreferrer">{t("mediaPicker.documentation")}</a>}
  </div>;
}
export function MediaModelPicker({ kind }: { kind?: "image" | "video" }) {
  const id = useId();
  const selection = useAppStore((s) => s.mediaSelection) as Selection | null;
  const setSelection = useAppStore((s) => s.setMediaSelection);
  const { t } = useI18n();
  const [models, setModels] = useState<MediaModel[]>([]);
  const [error, setError] = useState(false);
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  // The classic UI makes no media requests until the user opens the picker or a media model is
  // already selected; the default classic flow keeps exactly its old network traffic.
  const active = opened || selection !== null;
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    setLoading(true); setError(false);
    const kinds = kind ? [kind] : ["image", "video"] as const;
    Promise.all(kinds.map(fetchMediaCatalog)).then((results) => { if (live) { setModels(results.flatMap((result) => result.models)); setLoading(false); } }).catch(() => { if (live) { setError(true); setLoading(false); } });
    return () => { live = false; };
  }, [kind, active, attempt]);
  if (!active) {
    return <div className="option-group">
      <button type="button" className="option-btn media-picker__open" onClick={() => setOpened(true)}>{t("mediaPicker.open")}</button>
    </div>;
  }
  const model = models.find((item) => item.id === selection?.model && item.kind === selection.kind);
  const route = model && chooseMediaRoute(model, selection?.adapter);
  const changeModel = (value: string) => {
    if (!value) { setSelection(null); return; }
    const next = models.find((item) => `${item.kind}:${item.id}` === value);
    if (!next) return;
    const preferred = chooseMediaRoute(next);
    const nextRoute = preferred?.hasKey ? preferred : next.routes.find((item) => item.hasKey);
    if (nextRoute) setSelection(selectionFor(next, nextRoute));
  };
  return <div className="option-group">
    <ModelList id={id} models={models} selection={selection} changeModel={changeModel} error={error} loading={loading} retry={() => setAttempt((n) => n + 1)} />
    {model && route && selection && <>
      <RouteList id={id} model={model} route={route} selection={selection} setSelection={setSelection} />
      <RouteControls route={route} selection={selection} setSelection={setSelection} />
    </>}
  </div>;
}
