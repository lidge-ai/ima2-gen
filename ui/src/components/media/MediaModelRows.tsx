import { useId } from "react";
import { useI18n } from "../../i18n";
import { makerName, type MediaModel } from "../../lib/mediaCatalog";
import { modelFacts, type ModelFacts, type Suggestion } from "../../lib/mediaModelList";
import type { ClassicTask } from "../../lib/mediaTasks";
import { CheckIcon } from "../controls";
import { MediaLogo } from "./MediaLogo";
import { durationText, fromPrice, resolutionText } from "./mediaLabels";

interface RowProps {
  model: MediaModel;
  task: ClassicTask;
  selected: boolean;
  onPick: (model: MediaModel) => void;
  /** One line on why this model is suggested; replaces the maker line. */
  reason?: string;
  facts?: ModelFacts;
}

/** One model: who makes it, then the same three facts in the same place on every row (price, resolution, length). */
export function MediaModelRow({ model, task, selected, onPick, reason, facts: given }: RowProps) {
  const { t } = useI18n();
  const facts = given ?? modelFacts(model, task);
  const resolution = resolutionText(facts);
  const duration = durationText(facts, t);
  return (
    <li>
      <button type="button" className="media-row" aria-current={selected ? "true" : undefined} data-model={model.id} onClick={() => onPick(model)}>
        <MediaLogo logo={model.logo} label={model.vendor} />
        <span className="media-row__main">
          <span className="media-row__name">
            {model.label}
            {facts.audio ? <span className="media-row__tag">{t("mediaPicker.audioTag")}</span> : null}
            {facts.voice ? <span className="media-row__tag">{t("mediaPicker.voiceTag")}</span> : null}
            {model.retiring ? <span className="media-row__tag">{t("mediaPicker.retiring")}</span> : null}
          </span>
          <span className="media-row__sub">{reason ?? makerName(model)}</span>
        </span>
        <span className="media-row__facts">
          {/* A local route has no price to be "unpublished": the row says there is no charge, as the settings do. */}
          <span className="media-row__price">{facts.local && !facts.price ? t("mediaPicker.localFree") : fromPrice(facts.price, t)}</span>
          <span className="media-row__spec">{[resolution, duration].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="media-row__check" aria-hidden="true">{selected ? <CheckIcon /> : null}</span>
        {selected ? <span className="sr-only">{t("mediaPicker.selected")}</span> : null}
      </button>
    </li>
  );
}

export function MediaModelGroup({ title, models, task, selectedId, onPick }: {
  title: string; models: readonly MediaModel[]; task: ClassicTask; selectedId: string | null; onPick: (model: MediaModel) => void;
}) {
  const id = useId();
  if (models.length === 0) return null;
  return (
    <section className="media-group" aria-labelledby={id}>
      <h3 className="media-group__title" id={id}>{title}</h3>
      <ul className="media-group__list">
        {models.map((model) => <MediaModelRow key={model.id} model={model} task={task} selected={model.id === selectedId} onPick={onPick} />)}
      </ul>
    </section>
  );
}

export function MediaSuggestions({ suggestions, task, selectedId, onPick }: {
  suggestions: readonly Suggestion[]; task: ClassicTask; selectedId: string | null; onPick: (model: MediaModel) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  if (suggestions.length === 0) return null;
  return (
    <section className="media-group" aria-labelledby={id}>
      <h3 className="media-group__title" id={id}>{t("mediaPicker.group.suggested")}</h3>
      <ul className="media-group__list">
        {suggestions.map((entry) => (
          <MediaModelRow key={entry.model.id} model={entry.model} task={task} facts={entry.facts} selected={entry.model.id === selectedId}
            onPick={onPick} reason={t(`mediaPicker.reason.${entry.reason}`)} />
        ))}
      </ul>
    </section>
  );
}

/** Models that need a video or audio input: listed with the reason so a search for them does not look like a gap. */
export function MediaUnsupported({ models }: { models: readonly MediaModel[] }) {
  const { t } = useI18n();
  if (models.length === 0) return null;
  return (
    <details className="media-unsupported">
      <summary>{t("mediaPicker.group.unsupported", { n: models.length })}</summary>
      <p>{t("mediaPicker.unsupportedWhy")}</p>
      <ul>
        {models.map((model) => <li key={model.id}><MediaLogo logo={model.logo} label={model.vendor} size="sm" /><span>{model.label}</span></li>)}
      </ul>
    </details>
  );
}

export function MediaRowSkeletons() {
  return (
    <ul className="media-group__list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <li key={index} className="media-row media-row--skeleton"><span /><span /><span /></li>)}
    </ul>
  );
}
