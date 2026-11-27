import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { MediaOptionSpec, MediaRoute } from "../../lib/mediaCatalog";
import { lengthRange, parseLength, taskParams, type LengthRange } from "../../lib/mediaForm";
import type { MediaSelection } from "../../lib/mediaSelection";
import { fetchMediaVoices, filterVoices, type MediaVoice } from "../../lib/mediaVoices";
import { Segmented, Select } from "../controls";

type Update = (selection: MediaSelection) => void;
type Translate = (key: string, vars?: Record<string, string | number>) => string;

const NAMED_OPTIONS: readonly string[] = ["voice_id", "force_instrumental", "loop"];
/** How many voices are listed at once; a provider's library runs to hundreds, and search narrows it. */
const VOICE_PAGE = 60;

/** The option's name in words where this screen knows it; a provider's own name is read as words ("output_format" → "output format"). */
export function optionLabel(name: string, t: Translate): string {
  return NAMED_OPTIONS.includes(name) ? t("mediaPicker.option." + name) : name.replace(/[_-]+/g, " ");
}

/** A free length in seconds. What is typed is what is stored, so a value outside the range is named, not silently moved. */
export function LengthField({ range, selection, update }: { range: LengthRange; selection: MediaSelection; update: Update }) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState(selection.durationSec === undefined ? "" : String(selection.durationSec));
  useEffect(() => {
    // Typing "1." must not be rewritten to "1" under the cursor: only a different number replaces the text.
    setText((current) => (parseLength(current) === selection.durationSec ? current : selection.durationSec === undefined ? "" : String(selection.durationSec)));
  }, [selection.durationSec, selection.model, selection.adapter]);
  const typed = parseLength(text);
  const empty = text.trim() === "";
  const invalid = empty ? range.required : typed === undefined || typed < range.minSec || typed > range.maxSec;
  const change = (raw: string) => {
    const value = raw.replace(/[^0-9.]/g, "");
    setText(value);
    const seconds = parseLength(value);
    const { durationSec: _old, ...rest } = selection;
    update(seconds === undefined ? rest : { ...rest, durationSec: seconds });
  };
  return (
    <div className="media-parameter">
      <label className="section-title" htmlFor={id}>{t("mediaPicker.duration")}</label>
      <span className="media-length">
        <input id={id} className="video-topic-input" type="text" inputMode="decimal" autoComplete="off" value={text}
          placeholder={range.required ? "" : t("mediaPicker.lengthAuto")} aria-invalid={invalid} aria-describedby={id + "-hint"}
          onChange={(event) => change(event.target.value)} />
        <span aria-hidden="true">{t("mediaPicker.lengthUnit")}</span>
      </span>
      <p className={invalid ? "media-field-error" : "media-field-hint"} id={id + "-hint"} role={invalid ? "alert" : undefined}>
        {t(invalid && empty ? "mediaPicker.form.lengthRequired" : invalid ? "mediaPicker.form.lengthRange" : range.required ? "mediaPicker.lengthHint" : "mediaPicker.lengthHintOptional", { min: range.minSec, max: range.maxSec })}
      </p>
    </div>
  );
}

type VoiceLoad = { status: "idle" | "loading" } | { status: "ready"; voices: readonly MediaVoice[] } | { status: "failed" };

/** The provider's voices, read once per provider while its key is saved; retry asks the server to read the provider again. */
function useVoices(adapter: string, enabled: boolean): { load: VoiceLoad; retry: () => void } {
  const [load, setLoad] = useState<VoiceLoad>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) { setLoad({ status: "idle" }); return undefined; }
    let live = true;
    setLoad({ status: "loading" });
    fetchMediaVoices(adapter, attempt > 0).then(
      (voices) => { if (live) setLoad({ status: "ready", voices }); },
      () => { if (live) setLoad({ status: "failed" }); },
    );
    return () => { live = false; };
  }, [adapter, enabled, attempt]);
  return { load, retry: () => setAttempt((n) => n + 1) };
}

function languageName(tag: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag; } catch { return tag; }
}

function VoiceRow({ voice, chosen, playing, onPick, onPlay }: { voice: MediaVoice; chosen: boolean; playing: boolean; onPick: () => void; onPlay: () => void }) {
  const { t, locale } = useI18n();
  const facts = [voice.language ? languageName(voice.language, locale) : null, voice.gender ? t("mediaPicker.voice." + voice.gender) : null].filter(Boolean).join(" · ");
  return (
    <li className="media-voice__row">
      <button type="button" className="media-voice__pick" aria-pressed={chosen} data-voice={voice.id} onClick={onPick}>
        <span className="media-voice__name">{voice.name}</span>
        {facts ? <span className="media-voice__facts">{facts}</span> : null}
        {voice.description ? <span className="media-voice__about">{voice.description}</span> : null}
      </button>
      {voice.previewUrl ? (
        <button type="button" className="media-voice__play" aria-pressed={playing} onClick={onPlay}
          aria-label={t(playing ? "mediaPicker.voice.stop" : "mediaPicker.voice.play", { name: voice.name })}>
          <span aria-hidden="true">{playing ? "■" : "▶"}</span>
        </button>
      ) : null}
    </li>
  );
}

function VoiceList({ voices, value, onPick }: { voices: readonly MediaVoice[]; value: string | undefined; onPick: (voice: MediaVoice) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { player.current?.pause(); player.current = null; }, []);
  const play = (voice: MediaVoice) => {
    if (!voice.previewUrl) return;
    const audio = player.current ?? (player.current = new Audio());
    audio.pause();
    if (playing === voice.id) { setPlaying(null); return; }
    audio.onended = () => setPlaying(null);
    audio.onerror = () => setPlaying(null);
    audio.src = voice.previewUrl;
    setPlaying(voice.id);
    void audio.play().catch(() => setPlaying(null));
  };
  const matched = filterVoices(voices, query);
  const shown = matched.slice(0, VOICE_PAGE);
  const groups = [{ key: "mine", voices: shown.filter((voice) => voice.owned) }, { key: "library", voices: shown.filter((voice) => !voice.owned) }];
  const titled = groups.every((group) => group.voices.length > 0);
  return (
    <div className="media-voice__panel">
      {voices.length > 8 ? <input type="search" className="media-tools__search" placeholder={t("mediaPicker.voice.search")} aria-label={t("mediaPicker.voice.search")}
        value={query} onChange={(event) => setQuery(event.target.value)} /> : null}
      {voices.length === 0 ? <p className="media-inputs">{t("mediaPicker.voice.empty")}</p> : null}
      {voices.length > 0 && matched.length === 0 ? <p className="media-inputs">{t("mediaPicker.voice.none")}</p> : null}
      <div className="media-voice__scroll">
        {groups.map((group) => (group.voices.length === 0 ? null : (
          <section key={group.key}>
            {titled ? <h4 className="media-voice__group">{t("mediaPicker.voice." + group.key)}</h4> : null}
            <ul className="media-voice__list">
              {group.voices.map((voice) => <VoiceRow key={voice.id} voice={voice} chosen={voice.id === value} playing={playing === voice.id} onPick={() => onPick(voice)} onPlay={() => play(voice)} />)}
            </ul>
          </section>
        )))}
        {matched.length > shown.length ? <p className="media-inputs">{t("mediaPicker.voice.more", { n: matched.length - shown.length })}</p> : null}
      </div>
    </div>
  );
}

/**
 * The voice that reads the prompt. The list comes from the provider through its saved key, so without
 * a key this says so instead of showing an empty list. It opens by itself while no voice is chosen,
 * because nothing can be generated until one is.
 */
export function VoicePicker({ option, route, ready, selection, update }: { option: MediaOptionSpec; route: MediaRoute; ready: boolean; selection: MediaSelection; update: Update }) {
  const { t } = useI18n();
  const value = typeof selection.options?.[option.name] === "string" ? selection.options[option.name] as string : undefined;
  const [open, setOpen] = useState(value === undefined);
  useEffect(() => { if (value === undefined) setOpen(true); }, [value, route.adapter]);
  const { load, retry } = useVoices(route.adapter, ready && open);
  const pick = (voice: MediaVoice) => {
    update({ ...selection, options: { ...selection.options, [option.name]: voice.id }, voiceName: voice.name });
    setOpen(false);
  };
  return (
    <div className="option-group media-voice">
      <div className="section-title">{optionLabel(option.name, t)}</div>
      {!ready ? <p className="media-inputs" role="status">{t("mediaPicker.voice.needsKey", { provider: route.label })}</p> : (
        <>
          <button type="button" className="option-btn media-voice__current" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span>{value === undefined ? t("mediaPicker.voice.choose") : selection.voiceName ?? value}</span>
            {value === undefined ? null : <span className="media-voice__change">{t(open ? "mediaPicker.close" : "mediaPicker.voice.change")}</span>}
          </button>
          {open && load.status === "loading" ? <p className="media-inputs" role="status">{t("mediaPicker.voice.loading")}</p> : null}
          {open && load.status === "failed" ? (
            <p className="media-inputs media-inputs--problem" role="alert">{t("mediaPicker.voice.failed", { provider: route.label })}{" "}
              <button type="button" className="media-link" onClick={retry}>{t("mediaPicker.retry")}</button></p>
          ) : null}
          {open && load.status === "ready" ? <VoiceList voices={load.voices} value={value} onPick={pick} /> : null}
        </>
      )}
    </div>
  );
}

function OptionField({ option, route, ready, selection, update }: { option: MediaOptionSpec; route: MediaRoute; ready: boolean; selection: MediaSelection; update: Update }) {
  const { t } = useI18n();
  const label = optionLabel(option.name, t);
  const value = selection.options?.[option.name];
  const set = (next: string | boolean | undefined) => {
    const { [option.name]: _old, ...others } = selection.options ?? {};
    const options = next === undefined || next === "" || next === false ? others : { ...others, [option.name]: next };
    const { options: _all, ...rest } = selection;
    update(Object.keys(options).length > 0 ? { ...rest, options } : rest);
  };
  if (option.type === "voice") return <VoicePicker option={option} route={route} ready={ready} selection={selection} update={update} />;
  if (option.type === "boolean") {
    return <label className="media-toggle"><input type="checkbox" checked={value === true} onChange={(event) => set(event.target.checked)} />{label}</label>;
  }
  if (option.type === "enum") {
    const items = [...(option.required ? [] : [{ value: "", label: t("mediaPicker.default") }]), ...(option.values ?? []).map((item) => ({ value: item, label: item }))];
    const current = typeof value === "string" ? value : "";
    if (items.length <= 4) return <Segmented title={label} items={items} value={current} onChange={set} />;
    return <div className="option-group"><div className="section-title">{label}</div><Select ariaLabel={label} value={current} items={items} onChange={set} portal /></div>;
  }
  return (
    <label className="media-parameter"><span className="section-title">{label}</span>
      <input className="video-topic-input" value={typeof value === "string" ? value : ""} maxLength={option.maxLength} aria-required={option.required === true}
        onChange={(event) => set(event.target.value)} /></label>
  );
}

/** The length and the options the route declares for the task, in the catalog's order. Nothing is listed here by name. */
export function MediaFormFields({ route, ready, selection, update }: { route: MediaRoute; ready: boolean; selection: MediaSelection; update: Update }) {
  const params = taskParams(route, selection.task);
  const range = lengthRange(params);
  return (
    <>
      {(params.options ?? []).map((option) => <OptionField key={option.name} option={option} route={route} ready={ready} selection={selection} update={update} />)}
      {range ? <LengthField range={range} selection={selection} update={update} /> : null}
    </>
  );
}
