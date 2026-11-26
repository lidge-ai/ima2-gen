import { useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";
import { allowedMediaValue, chooseMediaRoute, fetchMediaCatalog, formatMediaPrice, logoUrl, type MediaModel, type MediaRoute } from "../lib/mediaCatalog";
import type { MediaSelection } from "../lib/mediaSelection";
import { useAppStore } from "../store/useAppStore";

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
  return url && !failed ? <img src={url} alt="" width={24} height={24} onError={() => setFailed(true)} /> : <span>{logo?.name || label}</span>;
}
function ModelList({ id, models, selection, changeModel, error }: { id: string; models: MediaModel[]; selection: Selection | null; changeModel: (value: string) => void; error: boolean }) {
  const { t } = useI18n();
  const openSettings = useAppStore((state) => state.openSettings);
  return <>
    <div className="section-title" id={id}>{t("mediaPicker.model")}</div>
    {error && <p role="alert">{t("mediaPicker.loadError")}</p>}
    <div role="group" aria-labelledby={id} style={{ display: "grid", gap: 4, maxHeight: 240, overflowY: "auto" }}>
      <button type="button" className={`option-btn${!selection ? " active" : ""}`} aria-pressed={!selection} onClick={() => changeModel("")}>
        {t("mediaPicker.classic")}
      </button>
      {models.map((item) => {
        const available = item.routes.some((candidate) => candidate.hasKey);
        const selected = selection?.model === item.id && selection.kind === item.kind;
        return <button key={`${item.kind}:${item.id}`} type="button" className={`option-btn${selected ? " active" : ""}`} aria-pressed={selected} disabled={!available} onClick={() => changeModel(`${item.kind}:${item.id}`)} style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}>
          <Logo logo={item.logo} label={item.vendor} />
          <span>{item.label}<br /><small>{item.vendor} · {item.kind}{available ? "" : ` · ${t("mediaPicker.noKey")}`}</small></span>
        </button>;
      })}
    </div>
    {models.some((item) => item.routes.some((r) => !r.hasKey)) && <button type="button" onClick={() => openSettings("providers")}>{t("mediaPicker.settings")}</button>}
  </>;
}
function RouteList({ id, model, route, selection, setSelection }: { id: string; model: MediaModel; route: MediaRoute; selection: Selection; setSelection: (selection: Selection | null) => void }) {
  const { t } = useI18n();
  return <>
      <div className="section-title" id={`${id}-routes`}>{t("mediaPicker.route")}</div>
      <div role="group" aria-labelledby={`${id}-routes`} style={{ display: "grid", gap: 4 }}>
        {model.routes.map((item) => <button key={item.adapter} type="button" className={`option-btn${route.adapter === item.adapter ? " active" : ""}`} aria-pressed={route.adapter === item.adapter} disabled={!item.hasKey} onClick={() => setSelection(selectionFor(model, item, selection))} style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}>
          <Logo logo={item.logo} label={item.label} />
          <span>{item.label}<br /><small>{t(`mediaPicker.${item.route}`)} · {t(item.hasKey ? "mediaPicker.keyReady" : "mediaPicker.noKey")}</small></span>
        </button>)}
      </div>
  </>;
}
function RouteControls({ route, selection, setSelection }: { route: MediaRoute; selection: Selection; setSelection: (selection: Selection | null) => void }) {
  const { t } = useI18n();
  return <>
      <label>{t("mediaPicker.task")} <select value={selection.task} onChange={(event) => setSelection({ ...selection, task: event.target.value })}>{route.tasks.map((task) => <option key={task} value={task}>{task}</option>)}</select></label>
      {route.params.durationsSec?.length ? <label>{t("mediaPicker.duration")} <select value={selection.durationSec ?? ""} onChange={(event) => setSelection({ ...selection, durationSec: event.target.value ? Number(event.target.value) : undefined })}><option value="">{t("mediaPicker.default")}</option>{route.params.durationsSec.map((value) => <option key={value} value={value}>{value}s</option>)}</select></label> : null}
      {route.params.resolutions?.length ? <label>{t("mediaPicker.resolution")} <select value={selection.resolution ?? ""} onChange={(event) => setSelection({ ...selection, resolution: event.target.value || undefined })}><option value="">{t("mediaPicker.default")}</option>{route.params.resolutions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
      {route.params.aspectRatios?.length ? <label>{t("mediaPicker.aspect")} <select value={selection.aspectRatio ?? ""} onChange={(event) => setSelection({ ...selection, aspectRatio: event.target.value || undefined })}><option value="">{t("mediaPicker.default")}</option>{route.params.aspectRatios.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
      {route.params.nativeAudio && <label><input type="checkbox" checked={selection.audio ?? false} onChange={(event) => setSelection({ ...selection, audio: event.target.checked } as Selection)} />{t("mediaPicker.nativeAudio")}</label>}
      {route.params.negativePrompt && <label>{t("mediaPicker.negativePrompt")} <input value={selection.negativePrompt ?? ""} onChange={(event) => setSelection({ ...selection, negativePrompt: event.target.value } as Selection)} /></label>}
      {route.params.seed && <label>{t("mediaPicker.seed")} <input type="number" value={selection.seed ?? ""} onChange={(event) => setSelection({ ...selection, seed: event.target.value === "" ? undefined : Number(event.target.value) } as Selection)} /></label>}
      {route.pricing.map((price, index) => <div key={index} title={price.source}>{formatMediaPrice(price)} · {price.checkedAt}</div>)}
      {route.docsUrl && <a href={route.docsUrl} target="_blank" rel="noreferrer">{t("mediaPicker.documentation")}</a>}
  </>;
}
export function MediaModelPicker({ kind }: { kind?: "image" | "video" }) {
  const id = useId();
  const selection = useAppStore((s) => s.mediaSelection) as Selection | null;
  const setSelection = useAppStore((s) => s.setMediaSelection);
  const [models, setModels] = useState<MediaModel[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const kinds = kind ? [kind] : ["image", "video"] as const;
    Promise.all(kinds.map(fetchMediaCatalog)).then((results) => { if (active) setModels(results.flatMap((result) => result.models)); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [kind]);
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
    <ModelList id={id} models={models} selection={selection} changeModel={changeModel} error={error} />
    {model && route && selection && <>
      <RouteList id={id} model={model} route={route} selection={selection} setSelection={setSelection} />
      <RouteControls route={route} selection={selection} setSelection={setSelection} />
    </>}
  </div>;
}
