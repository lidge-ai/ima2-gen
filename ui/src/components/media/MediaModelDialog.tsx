import { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { useModalFocus } from "../../hooks/useModalFocus";
import { useMediaCatalog, loadMediaCatalog } from "../../lib/mediaCatalogStore";
import { makerName, type MediaModel } from "../../lib/mediaCatalog";
import { AUDIO_USES, audioUse, type AudioUse } from "../../lib/mediaForm";
import { filterModels, groupModels, offeredFeatures, sortModels, suggestModels, unsupportedModels, type ModelFeature, type ModelSort } from "../../lib/mediaModelList";
import { candidateRoutes, resolveRoute } from "../../lib/mediaRoutes";
import { reconcileSelection } from "../../lib/mediaSelection";
import { loadRecentModels, rememberModel } from "../../lib/mediaSelectionStore";
import { CLASSIC_TASKS, inferTask, isClassicTask, taskKind, type ClassicKind, type ClassicTask } from "../../lib/mediaTasks";
import { useAppStore } from "../../store/useAppStore";
import { MediaModelGroup, MediaRowSkeletons, MediaSuggestions, MediaUnsupported } from "./MediaModelRows";

const SORTS: readonly ModelSort[] = ["catalog", "price", "resolution", "duration"];
/** Sound has no resolution to sort by, and its prices come in units that do not compare. */
const AUDIO_SORTS: readonly ModelSort[] = ["catalog", "duration"];

function useReferenceCount(): number {
  return useAppStore((s) => s.referenceImages.length + (s.providerUrlReference ? 1 : 0));
}

/** The sound tab an opening starts on: the selected model's (a voice reads, or sound is described), otherwise speech. */
function openingUse(models: readonly MediaModel[], selection: { kind: string; model: string; adapter: string; task: string } | null): AudioUse {
  if (selection?.kind !== "audio") return "speech";
  const route = models.find((model) => model.id === selection.model)?.routes.find((entry) => entry.adapter === selection.adapter);
  return route ? audioUse(route, selection.task) : "speech";
}

function Tabs<V extends string>({ label, items, value, onChange }: { label: string; items: readonly { value: V; label: string }[]; value: V; onChange: (value: V) => void }) {
  return (
    <div className="media-tabs" role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.value} type="button" className="media-tabs__tab" aria-pressed={item.value === value} onClick={() => onChange(item.value)}>{item.label}</button>
      ))}
    </div>
  );
}

interface Narrowing { query: string; vendor: string; features: ModelFeature[]; sort: ModelSort }
const WIDE: Narrowing = { query: "", vendor: "", features: [], sort: "catalog" };

function Tools({ models, kind, task, narrowing, setNarrowing }: {
  models: readonly MediaModel[]; kind: ClassicKind; task: ClassicTask; narrowing: Narrowing; setNarrowing: (next: Narrowing) => void;
}) {
  const { t } = useI18n();
  const vendors = useMemo(() => [...new Map(models.map((model) => [model.vendor, makerName(model)])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [models]);
  const features = useMemo(() => offeredFeatures(models, kind, task), [models, kind, task]);
  const toggle = (feature: ModelFeature) => setNarrowing({ ...narrowing,
    features: narrowing.features.includes(feature) ? narrowing.features.filter((f) => f !== feature) : [...narrowing.features, feature] });
  const featureLabel = (feature: ModelFeature) => t(feature === "sharp" ? `mediaPicker.feature.sharp.${kind}` : `mediaPicker.feature.${feature}`);
  return (
    <div className="media-tools">
      <input type="search" className="media-tools__search" data-modal-initial-focus placeholder={t("mediaPicker.search")} aria-label={t("mediaPicker.search")}
        value={narrowing.query} onChange={(event) => setNarrowing({ ...narrowing, query: event.target.value })} />
      <label className="media-tools__select">
        <span>{t("mediaPicker.maker")}</span>
        <select value={narrowing.vendor} onChange={(event) => setNarrowing({ ...narrowing, vendor: event.target.value })}>
          <option value="">{t("mediaPicker.allMakers")}</option>
          {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="media-tools__select">
        <span>{t("mediaPicker.sortLabel")}</span>
        <select value={narrowing.sort} onChange={(event) => setNarrowing({ ...narrowing, sort: event.target.value as ModelSort })}>
          {(kind === "audio" ? AUDIO_SORTS : SORTS).map((sort) => <option key={sort} value={sort}>{t(`mediaPicker.sort.${sort}`)}</option>)}
        </select>
      </label>
      {features.length > 0 ? (
        <div className="media-tools__chips" role="group" aria-label={t("mediaPicker.filters")}>
          {features.map((feature) => (
            <button key={feature} type="button" className="media-chip" aria-pressed={narrowing.features.includes(feature)} onClick={() => toggle(feature)}>{featureLabel(feature)}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BuiltinRow({ active, onPick }: { active: boolean; onPick: () => void }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <section className="media-group" aria-labelledby={id}>
      <h3 className="media-group__title" id={id}>{t("mediaPicker.group.builtin")}</h3>
      <button type="button" className="media-row media-row--builtin" aria-current={active ? "true" : undefined} onClick={onPick}>
        <span className="media-row__main">
          <span className="media-row__name">{t("mediaPicker.builtinTitle")}</span>
          <span className="media-row__sub">{t("mediaPicker.builtinBody")}</span>
        </span>
      </button>
    </section>
  );
}

function ModelList({ models, kind, task, use, narrowing, selectedId, onPick, onBuiltin, onClear }: {
  models: readonly MediaModel[]; kind: ClassicKind; task: ClassicTask; use: AudioUse | undefined; narrowing: Narrowing; selectedId: string | null;
  onPick: (model: MediaModel) => void; onBuiltin: () => void; onClear: () => void;
}) {
  const { t } = useI18n();
  const scope = useMemo(() => ({ kind, task, ...(use ? { use } : {}) }), [kind, task, use]);
  const ofTask = useMemo(() => filterModels(models, scope), [models, scope]);
  const narrowed = narrowing.query !== "" || narrowing.vendor !== "" || narrowing.features.length > 0;
  const shown = useMemo(() => sortModels(filterModels(models, { ...scope, query: narrowing.query, vendor: narrowing.vendor || null, features: narrowing.features }), narrowing.sort, task),
    [models, scope, task, narrowing]);
  const suggestions = narrowed || narrowing.sort !== "catalog" ? [] : suggestModels(ofTask, task);
  // A suggested model is listed once, in the suggestions; the groups below hold the rest.
  const suggested = new Set(suggestions.map((entry) => entry.model));
  const groups = groupModels(shown.filter((model) => !suggested.has(model)), narrowed ? [] : loadRecentModels(), task);
  return (
    <>
      <p className="media-count" role="status">{t("mediaPicker.count", { n: shown.length, total: ofTask.length })}</p>
      {ofTask.length === 0 ? <p className="media-empty">{t("mediaPicker.emptyTask")}</p> : null}
      {ofTask.length > 0 && shown.length === 0 ? (
        <p className="media-empty">{t("mediaPicker.emptyFiltered")} <button type="button" className="media-link" onClick={onClear}>{t("mediaPicker.clearFilters")}</button></p>
      ) : null}
      <MediaSuggestions suggestions={suggestions} task={task} selectedId={selectedId} onPick={onPick} />
      <MediaModelGroup title={t("mediaPicker.group.recent")} models={groups.recent} task={task} selectedId={selectedId} onPick={onPick} />
      <MediaModelGroup title={t("mediaPicker.group.ready")} models={groups.ready} task={task} selectedId={selectedId} onPick={onPick} />
      {narrowed || kind === "audio" ? null : <BuiltinRow active={selectedId === null} onPick={onBuiltin} />}
      <MediaModelGroup title={t("mediaPicker.group.needsKey")} models={groups.needsKey} task={task} selectedId={selectedId} onPick={onPick} />
      {narrowing.features.length > 0 || narrowing.vendor ? null : <MediaUnsupported models={unsupportedModels(models, kind).filter((model) =>
        !narrowing.query || `${model.label} ${model.vendor}`.toLowerCase().includes(narrowing.query.toLowerCase()))} />}
    </>
  );
}

/**
 * The one place to choose a media model. It narrows by what is being made first (image or video,
 * from text or from the composer's images), then lists what the saved keys can run before what needs a key.
 */
export function MediaModelDialog() {
  const { t } = useI18n();
  const picker = useAppStore((s) => s.mediaPicker);
  const close = useAppStore((s) => s.closeMediaPicker);
  const selection = useAppStore((s) => s.mediaSelection);
  const setSelection = useAppStore((s) => s.setMediaSelection);
  const references = useReferenceCount();
  const open = picker !== null;
  const catalog = useMediaCatalog(open);
  const dialogRef = useModalFocus<HTMLDivElement>(open, close);
  const titleId = useId();
  const [kind, setKind] = useState<ClassicKind>("image");
  const [task, setTask] = useState<ClassicTask>("text-to-image");
  const [use, setUse] = useState<AudioUse>("speech");
  const [narrowing, setNarrowing] = useState<Narrowing>(WIDE);
  // Each opening starts from what the person is doing now: the selected model's task, or the task the composer implies.
  useEffect(() => {
    if (!picker) return;
    const current = selection && isClassicTask(selection.task) ? selection.task : null;
    const nextKind = picker.kind ?? (current ? taskKind(current) : "image");
    setKind(nextKind);
    setTask(current && taskKind(current) === nextKind ? current : inferTask(nextKind, references));
    setUse(openingUse(catalog.models, selection));
    setNarrowing(WIDE);
    // The opening state is read once per opening; later composer changes must not move the tabs under the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);
  if (!picker) return null;
  const changeKind = (next: ClassicKind) => { setKind(next); setTask(inferTask(next, references)); setNarrowing(WIDE); };
  const pick = (model: MediaModel) => {
    // For sound, the route that runs must be of the kind picked: a model can read aloud on one route and not on another.
    const fits = kind === "audio" ? candidateRoutes(model, task).filter((route) => audioUse(route, task) === use) : null;
    const resolved = resolveRoute(fits ? { ...model, routes: fits } : model, { routeMode: "auto", task });
    if (!resolved) return;
    const previous = selection && selection.kind === model.kind ? selection : null;
    const { selection: next, adjusted } = reconcileSelection(model, resolved.route, task, previous, "auto");
    rememberModel(model.kind, model.id);
    setSelection(next, adjusted);
    close();
  };
  const selectedId = selection && selection.kind === kind ? selection.model : null;
  const kinds: ClassicKind[] = ["image", "video", "audio"];
  const scope = { kind, task, ...(kind === "audio" ? { use } : {}) };
  return (
    <div className="modal-backdrop media-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} className="modal media-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="media-dialog__head">
          <div>
            <h2 className="media-dialog__title" id={titleId}>{t("mediaPicker.dialogTitle")}</h2>
            <p className="media-dialog__intro">{t("mediaPicker.dialogIntro")}</p>
          </div>
          <button type="button" className="media-dialog__close" onClick={close} aria-label={t("mediaPicker.close")}>×</button>
        </header>
        <div className="media-dialog__what">
          {picker.kind ? null : <Tabs label={t("mediaPicker.kindLabel")} value={kind} onChange={changeKind}
            items={kinds.map((value) => ({ value, label: t(`mediaPicker.kind.${value}`) }))} />}
          {kind === "audio" ? (
            <Tabs label={t("mediaPicker.use.label")} value={use} onChange={(next) => { setUse(next); setNarrowing(WIDE); }}
              items={AUDIO_USES.map((value) => ({ value, label: t(`mediaPicker.use.${value}`) }))} />
          ) : (
            <Tabs label={t("mediaPicker.task")} value={task} onChange={setTask}
              items={CLASSIC_TASKS[kind].map((value) => ({ value, label: t(`mediaPicker.tasks.${value}`) }))} />
          )}
          <p className="media-dialog__needs">{t(kind === "audio" ? `mediaPicker.useNeeds.${use}` : `mediaPicker.taskNeeds.${task}`)}</p>
        </div>
        <Tools models={filterModels(catalog.models, scope)} kind={kind} task={task} narrowing={narrowing} setNarrowing={setNarrowing} />
        <div className="media-dialog__list">
          {catalog.status === "loading" || catalog.status === "idle" ? <><p className="sr-only" role="status">{t("mediaPicker.loading")}</p><MediaRowSkeletons /></> : null}
          {catalog.status === "error" ? (
            <div className="media-empty" role="alert">
              <p>{t("mediaPicker.loadError")} <span className="media-error-detail">{catalog.error}</span></p>
              <p>{t("mediaPicker.loadErrorBuiltin")}</p>
              <button type="button" className="modal__btn modal__btn--secondary" onClick={() => void loadMediaCatalog(true)}>{t("mediaPicker.retry")}</button>
            </div>
          ) : null}
          {catalog.status === "ready" ? (
            <ModelList models={catalog.models} kind={kind} task={task} use={kind === "audio" ? use : undefined} narrowing={narrowing} selectedId={selectedId} onPick={pick}
              onBuiltin={() => { setSelection(null); close(); }} onClear={() => setNarrowing({ ...WIDE, sort: narrowing.sort })} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
