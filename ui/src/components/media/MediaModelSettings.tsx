import { useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n";
import type { MediaAdapter, MediaModel, MediaRoute } from "../../lib/mediaCatalog";
import { candidateRoutes, cheapestRoute, lowestPrice, resolveRoute, type ResolvedRoute } from "../../lib/mediaRoutes";
import { parseSeed, reconcileSelection, type Adjustment, type MediaSelection } from "../../lib/mediaSelection";
import { inputLimits, inputProblem, modelTasks, type ClassicTask } from "../../lib/mediaTasks";
import { useAppStore } from "../../store/useAppStore";
import { Segmented, Select } from "../controls";
import { DurationSlider } from "../controls/DurationSlider";
import { MediaEstimate } from "./MediaEstimate";
import { MediaKeyEntry } from "./MediaKeyEntry";
import { MediaLogo } from "./MediaLogo";
import { fromPrice, qualityLabel, unitPrice } from "./mediaLabels";

type Update = (selection: MediaSelection, adjusted?: Adjustment[]) => void;
/** Says which earlier settings the new model could not keep, so a changed length or size is never a surprise at generate time. */
function AdjustmentNote() {
  const { t } = useI18n();
  const adjusted = useAppStore((s) => s.mediaAdjustments);
  const dismiss = useAppStore((s) => s.dismissMediaAdjustments);
  if (adjusted.length === 0) return null;
  const fieldName = (field: Adjustment["field"]) => t(field === "task" ? "mediaPicker.task" : field === "durationSec" ? "mediaPicker.duration"
    : field === "resolution" ? "mediaPicker.resolution" : field === "quality" ? "mediaPicker.quality" : field === "aspectRatio" ? "mediaPicker.aspect" : field === "audio" ? "mediaPicker.nativeAudio"
    : field === "seed" ? "mediaPicker.seed" : "mediaPicker.negativePrompt");
  const shown = (field: Adjustment["field"], value: string) => (field === "quality" ? qualityLabel(value, t) : value);
  return (
    <div className="media-note" role="status">
      <strong>{t("mediaPicker.adjustedTitle")}</strong>
      <ul>
        {adjusted.map((entry) => (
          <li key={entry.field}>{entry.to === null || entry.field === "audio" || entry.field === "negativePrompt"
            ? t("mediaPicker.adjustedDropped", { field: fieldName(entry.field) })
            : t("mediaPicker.adjustedTo", { field: fieldName(entry.field), from: shown(entry.field, entry.from), to: shown(entry.field, entry.to) })}</li>
        ))}
      </ul>
      <button type="button" className="media-link" onClick={dismiss}>{t("mediaPicker.dismiss")}</button>
    </div>
  );
}

/** Why Automatic is on this route: it is the direct one, or the direct one has no key, or there is none. */
function autoReason(model: MediaModel, task: string, resolved: ResolvedRoute, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const route = resolved.route.label;
  if (resolved.state === "needs-key") return t("mediaPicker.routeAutoNone");
  if (resolved.route.route === "direct") return t("mediaPicker.routeAutoNowDirect", { route });
  const direct = candidateRoutes(model, task).find((candidate) => candidate.route === "direct");
  return direct ? t("mediaPicker.routeAutoNowNoDirectKey", { route, direct: direct.label }) : t("mediaPicker.routeAutoNowCheapest", { route });
}

function RouteFacts({ route, kind }: { route: MediaRoute; kind: MediaModel["kind"] }) {
  const { t } = useI18n();
  return (
    <span className="media-route__main">
      <span className="media-route__name">{route.label}
        <span className={"media-route__key" + (route.hasKey ? " media-route__key--ready" : "")}>{t(route.hasKey ? "mediaPicker.keyReady" : "mediaPicker.routeKeyNeeded")}</span></span>
      <small>{t(`mediaPicker.${route.route}`)} · {fromPrice(lowestPrice(route, kind), t)}</small>
    </span>
  );
}

function RouteChoice({ model, selection, resolved, update }: { model: MediaModel; selection: MediaSelection; resolved: ResolvedRoute; update: Update }) {
  const { t } = useI18n();
  const name = useId();
  const routes = candidateRoutes(model, selection.task);
  if (routes.length < 2) {
    const only = routes[0] ?? resolved.route;
    return (
      <div className="option-group">
        <div className="section-title">{t("mediaPicker.route")}</div>
        <p className="media-route media-route--single"><MediaLogo logo={only.logo} label={only.label} size="sm" /><RouteFacts route={only} kind={model.kind} /></p>
      </div>
    );
  }
  const auto = selection.routeMode === "auto";
  const pin = (route: MediaRoute | null) => {
    const target = route ?? resolveRoute(model, { routeMode: "auto", task: selection.task })?.route;
    if (!target) return;
    const next = reconcileSelection(model, target, selection.task, selection, route ? "pinned" : "auto");
    update(next.selection, next.adjusted);
  };
  // With no key anywhere, Automatic asks for the direct route's key; when another route is cheaper, say so and offer its key instead.
  const cheaper = auto && resolved.state === "needs-key" ? cheapestRoute(model, selection.task) : undefined;
  return (
    <fieldset className="option-group media-routes">
      <legend className="section-title">{t("mediaPicker.route")}</legend>
      <label className="media-route">
        <input type="radio" name={name} checked={auto} onChange={() => pin(null)} />
        <span className="media-route__main"><span>{t("mediaPicker.routeAuto")}</span>
          <small>{auto ? autoReason(model, selection.task, resolved, t) : t("mediaPicker.routeAutoHint")}</small></span>
      </label>
      {routes.map((route) => (
        <label key={route.adapter} className="media-route">
          <input type="radio" name={name} checked={!auto && route.adapter === resolved.route.adapter} onChange={() => pin(route)} />
          <MediaLogo logo={route.logo} label={route.label} size="sm" />
          <RouteFacts route={route} kind={model.kind} />
        </label>
      ))}
      {cheaper && cheaper.adapter !== resolved.route.adapter ? (
        <button type="button" className="media-link" onClick={() => pin(cheaper)}>
          {t("mediaPicker.routeCheapestKey", { route: cheaper.label, price: fromPrice(lowestPrice(cheaper, model.kind), t) })}</button>
      ) : null}
    </fieldset>
  );
}

function SeedField({ selection, update }: { selection: MediaSelection; update: Update }) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState(selection.seed === undefined ? "" : String(selection.seed));
  useEffect(() => setText(selection.seed === undefined ? "" : String(selection.seed)), [selection.seed, selection.model, selection.adapter]);
  const invalid = text.trim() !== "" && parseSeed(text) === undefined;
  const change = (value: string) => {
    setText(value);
    const seed = parseSeed(value);
    const { seed: _old, ...rest } = selection;
    // An invalid entry is shown as invalid and never stored, so it cannot reach the request.
    if (value.trim() === "" || seed !== undefined) update(seed === undefined ? rest : { ...rest, seed });
  };
  return (
    <div className="media-parameter">
      <label className="section-title" htmlFor={id}>{t("mediaPicker.seed")}</label>
      <input id={id} className="video-topic-input" type="text" inputMode="numeric" autoComplete="off" placeholder={t("mediaPicker.seedPlaceholder")}
        value={text} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => change(event.target.value)} />
      {invalid ? <p className="media-field-error" id={`${id}-error`} role="alert">{t("mediaPicker.seedInvalid")}</p> : null}
    </div>
  );
}

function Choice({ title, value, items, update }: { title: string; value: string; items: readonly { value: string; label: string }[]; update: (value: string) => void }) {
  if (items.length <= 4) return <Segmented title={title} items={items} value={value} onChange={update} />;
  return (
    <div className="option-group"><div className="section-title">{title}</div>
      <Select ariaLabel={title} value={value} items={items} onChange={update} portal />
    </div>
  );
}

function RouteParams({ route, selection, update }: { route: MediaRoute; selection: MediaSelection; update: Update }) {
  const { t } = useI18n();
  const params = route.params;
  const durations = [...(params.durationsSec ?? [])].sort((a, b) => a - b);
  const { aspectRatio: _aspect, ...withoutAspect } = selection;
  return (
    <>
      {durations.length > 1 ? (
        <div className="option-group"><div className="section-title">{t("mediaPicker.duration")}</div>
          <DurationSlider values={durations} value={selection.durationSec ?? null} ariaLabel={t("mediaPicker.duration")}
            onChange={(next) => update({ ...selection, durationSec: next ?? durations[0]! })} />
        </div>
      ) : durations.length === 1 ? <p className="media-fixed">{t("mediaPicker.duration")}: {t("mediaPicker.seconds", { n: durations[0]! })}</p> : null}
      {params.resolutions?.length ? (params.resolutions.length > 1
        ? <Choice title={t("mediaPicker.resolution")} value={selection.resolution ?? ""} items={params.resolutions.map((item) => ({ value: item, label: item }))} update={(resolution) => update({ ...selection, resolution })} />
        : <p className="media-fixed">{t("mediaPicker.resolution")}: {params.resolutions[0]}</p>) : null}
      {params.qualities?.length ? (params.qualities.length > 1
        ? <Choice title={t("mediaPicker.quality")} value={selection.quality ?? ""} items={params.qualities.map((item) => ({ value: item, label: qualityLabel(item, t) }))} update={(quality) => update({ ...selection, quality })} />
        : <p className="media-fixed">{t("mediaPicker.quality")}: {qualityLabel(params.qualities[0]!, t)}</p>) : null}
      {params.aspectRatios?.length ? (
        <div className="option-group"><div className="section-title">{t("mediaPicker.aspect")}</div>
          <Select ariaLabel={t("mediaPicker.aspect")} value={selection.aspectRatio ?? ""} portal
            items={[{ value: "", label: t("mediaPicker.default") }, ...params.aspectRatios.map((item) => ({ value: item, label: item }))]}
            onChange={(aspectRatio) => update(aspectRatio ? { ...selection, aspectRatio } : withoutAspect)} />
        </div>
      ) : null}
      {params.nativeAudio ? <label className="media-toggle"><input type="checkbox" checked={selection.audio ?? false} onChange={(event) => update({ ...selection, audio: event.target.checked })} />{t("mediaPicker.nativeAudio")}</label> : null}
      {params.seed ? <SeedField selection={selection} update={update} /> : null}
      {params.negativePrompt ? <label className="media-parameter"><span className="section-title">{t("mediaPicker.negativePrompt")}</span>
        <input className="video-topic-input" value={selection.negativePrompt ?? ""} onChange={(event) => update({ ...selection, negativePrompt: event.target.value })} /></label> : null}
    </>
  );
}

/** How many composer images the task takes on this route, and what to change when the tray does not fit. */
function InputStatus({ route, selection }: { route: MediaRoute; selection: MediaSelection }) {
  const { t } = useI18n();
  const have = useAppStore((s) => s.referenceImages.length + (s.providerUrlReference ? 1 : 0));
  const limits = inputLimits(selection.task, route);
  const problem = inputProblem(selection.task, route, have);
  if (!problem && (!limits || limits.max === 0)) return null;
  return (
    <p className={`media-inputs${problem ? " media-inputs--problem" : ""}`} role="status">
      {problem ? t(`mediaPicker.problem.${problem.code}`, { min: problem.min, max: problem.max, have: problem.have })
        : t("mediaPicker.inputsOk", { have, max: limits?.max ?? 0 })}
    </p>
  );
}

function PriceList({ route }: { route: MediaRoute }) {
  const { t } = useI18n();
  if (route.pricing.length === 0 && !route.docsUrl) return null;
  return (
    <details className="provider-compat-details media-prices">
      <summary>{t("mediaPicker.prices")}</summary>
      {route.pricing.map((price, index) => (
        <div className="media-price" key={index}>{unitPrice(price, t)}{price.variant ? ` · ${price.variant}` : ""} · <a href={price.source} target="_blank" rel="noreferrer">{t("mediaPicker.checked", { date: price.checkedAt })}</a></div>
      ))}
      {route.pricing.length === 0 ? <div className="media-price">{t("mediaPicker.noPrice")}</div> : null}
      {route.docsUrl ? <a className="media-link" href={route.docsUrl} target="_blank" rel="noreferrer">{t("mediaPicker.documentation")}</a> : null}
    </details>
  );
}

/** Settings for the selected model: only what the catalog lists for the route that will run. */
export function MediaModelSettings({ model, selection, adapters }: { model: MediaModel; selection: MediaSelection; adapters: readonly MediaAdapter[] }) {
  const { t } = useI18n();
  const setSelection = useAppStore((s) => s.setMediaSelection);
  const openSettings = useAppStore((s) => s.openSettings);
  const keyPrompt = useAppStore((s) => s.mediaKeyPrompt);
  const closeKeyPrompt = useAppStore((s) => s.closeMediaKeyPrompt);
  const resolved = resolveRoute(model, selection);
  const adapter = resolved?.route.adapter;
  // Keys can change under an automatic choice (one is added or removed); follow it without touching the settings that still fit.
  useEffect(() => {
    if (!resolved || adapter === selection.adapter) return;
    const next = reconcileSelection(model, resolved.route, selection.task, selection, selection.routeMode ?? "pinned");
    setSelection(next.selection, next.adjusted.length ? next.adjusted : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, selection.adapter]);
  if (!resolved) return <p className="media-inputs media-inputs--problem" role="alert">{t("mediaPicker.missingModel")}</p>;
  const tasks = modelTasks(model);
  const lane = adapters.find((item) => item.id === resolved.route.adapter);
  const changeTask = (task: ClassicTask) => {
    const target = resolveRoute(model, { ...selection, task });
    if (!target) return;
    const next = reconcileSelection(model, target.route, task, selection, selection.routeMode ?? "pinned");
    setSelection(next.selection, next.adjusted.filter((entry) => entry.field !== "task"));
  };
  return (
    <div className="media-controls">
      <AdjustmentNote />
      {tasks.length > 1 ? (
        <Choice title={t("mediaPicker.task")} value={selection.task} items={tasks.map((task) => ({ value: task, label: t(`mediaPicker.tasks.${task}`) }))} update={(task) => changeTask(task as ClassicTask)} />
      ) : null}
      <InputStatus route={resolved.route} selection={selection} />
      <RouteChoice model={model} selection={selection} resolved={resolved} update={setSelection} />
      {resolved.state === "needs-key" ? (lane
        ? <MediaKeyEntry key={lane.id} adapter={lane} />
        : <p className="media-inputs media-inputs--problem" role="status">{t("mediaPicker.routeNeedsKey", { route: resolved.route.label })}{" "}
          <button type="button" className="media-link" onClick={() => openSettings("providers")}>{t("mediaPicker.settings")}</button></p>
      ) : lane && keyPrompt === lane.id ? <MediaKeyEntry key={lane.id} adapter={lane} replacing onDone={closeKeyPrompt} /> : null}
      <RouteParams route={resolved.route} selection={selection} update={setSelection} />
      <MediaEstimate route={resolved.route} selection={selection} />
      <PriceList route={resolved.route} />
    </div>
  );
}
