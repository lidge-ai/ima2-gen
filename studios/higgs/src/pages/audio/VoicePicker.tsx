import { useEffect, useRef, useState } from "react";
import type { MediaVoice } from "@ima2/studio-kit";
import { getLocale, messages, useT } from "../../i18n.ts";
import { useStudioApi } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/Popover.tsx";

const M = messages(
  {
    voice: "Voice", choose: "Choose a voice", label: "Voice: {name}", search: "Search voices", mine: "My voices", library: "Voice library",
    loading: "Loading voices", failed: "Could not load voices: {error}", retry: "Try again", none: "No voice matches your search.",
    empty: "This account has no voices yet.", needsKey: "Needs the key", play: "Play a sample of {name}", stop: "Stop the sample of {name}",
    female: "Female", male: "Male", neutral: "Neutral",
  },
  {
    voice: "목소리", choose: "목소리 고르기", label: "목소리: {name}", search: "목소리 검색", mine: "내 목소리", library: "목소리 라이브러리",
    loading: "목소리를 불러오는 중이에요", failed: "목소리를 불러오지 못했어요: {error}", retry: "다시 시도", none: "검색과 맞는 목소리가 없어요.",
    empty: "이 계정에는 아직 목소리가 없어요.", needsKey: "키가 필요해요", play: "{name} 샘플 재생", stop: "{name} 샘플 정지",
    female: "여성", male: "남성", neutral: "중성",
  },
);

type Load = { status: "idle" | "loading" } | { status: "ready"; voices: readonly MediaVoice[] } | { status: "failed"; error: string };

/** The provider's voices, read once per provider while the key is there; retry asks the server to read again. */
function useVoices(providerId: string | undefined, enabled: boolean) {
  const studio = useStudioApi();
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!providerId || !enabled) { setLoad({ status: "idle" }); return; }
    const control = new AbortController();
    setLoad({ status: "loading" });
    studio.client.voices.list(providerId, { refresh: attempt > 0, signal: control.signal }).then(
      (list) => setLoad({ status: "ready", voices: list.voices }),
      (error: unknown) => { if (!control.signal.aborted) setLoad({ status: "failed", error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => control.abort();
  }, [studio, providerId, enabled, attempt]);
  return { load, retry: () => setAttempt((n) => n + 1) };
}

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function VoiceRow({ voice, chosen, playing, onPick, onPlay }: { voice: MediaVoice; chosen: boolean; playing: boolean; onPick: () => void; onPlay: () => void }) {
  const t = useT(M);
  const facts = [voice.language ? languageName(voice.language) : null, voice.gender ? t(voice.gender) : null].filter(Boolean).join(" · ");
  return (
    <li className="voice-row">
      <button type="button" className="voice-pick" aria-pressed={chosen} onClick={onPick}>
        <span className="voice-name">{voice.name}</span>
        {facts ? <span className="voice-facts">{facts}</span> : null}
        {voice.description ? <span className="voice-about">{voice.description}</span> : null}
      </button>
      {voice.previewUrl ? (
        <button type="button" className="voice-play" aria-pressed={playing} aria-label={t(playing ? "stop" : "play", { name: voice.name })} onClick={onPlay}>
          <Icon name={playing ? "stop" : "play"} size={14} />
        </button>
      ) : null}
    </li>
  );
}

function VoiceList({ voices, value, onPick }: { voices: readonly MediaVoice[]; value: MediaVoice | null; onPick: (voice: MediaVoice) => void }) {
  const t = useT(M);
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = voices.filter((v) => !needle || [v.name, v.description, v.language, v.language ? languageName(v.language) : ""].join(" ").toLowerCase().includes(needle));
  const play = (voice: MediaVoice) => {
    const element = audio.current;
    if (!element || !voice.previewUrl) return;
    if (playing === voice.id) { element.pause(); setPlaying(null); return; }
    element.src = voice.previewUrl;
    setPlaying(voice.id);
    void element.play().catch(() => setPlaying(null));
  };
  const group = (title: string, items: readonly MediaVoice[]) => (items.length ? (
    <>
      <li className="group-title" role="presentation">{title}</li>
      {items.map((voice) => (
        <VoiceRow key={voice.id} voice={voice} chosen={voice.id === value?.id} playing={playing === voice.id} onPick={() => onPick(voice)} onPlay={() => play(voice)} />
      ))}
    </>
  ) : null);
  return (
    <>
      <input type="search" className="voice-search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="voice-list">
        {group(t("mine"), shown.filter((v) => v.owned))}
        {group(t("library"), shown.filter((v) => !v.owned))}
        {shown.length === 0 ? <li className="empty-line">{t(voices.length === 0 ? "empty" : "none")}</li> : null}
      </ul>
      <audio ref={audio} onEnded={() => setPlaying(null)} hidden />
    </>
  );
}

interface Props {
  providerId: string | undefined;
  /** False while the route has no key: the list cannot be read, and the tile says why. */
  keyed: boolean;
  value: MediaVoice | null;
  onChange: (voice: MediaVoice) => void;
}

/** The voice a speech model reads with, chosen from the provider's own list. */
export function VoicePicker({ providerId, keyed, value, onChange }: Props) {
  const t = useT(M);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { load, retry } = useVoices(providerId, keyed);
  return (
    <div className="picker picker-row">
      <button ref={trigger} type="button" className="picker-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={!keyed}
        aria-label={t("label", { name: value?.name ?? t("choose") })} onClick={() => setOpen(!open)}>
        <span className="setting-caption">{t("voice")}</span>
        <span className="setting-value picker-value"><Icon name="audio" size={16} /> {value?.name ?? t(keyed ? "choose" : "needsKey")}</span>
        <Icon name="chevron" size={16} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={t("choose")} className="voice-popover" anchor={trigger} placement="right">
        {load.status === "ready" ? (
          <VoiceList voices={load.voices} value={value} onPick={(voice) => { onChange(voice); setOpen(false); trigger.current?.focus(); }} />
        ) : load.status === "failed" ? (
          <div className="voice-state" role="alert">
            <p>{t("failed", { error: load.error })}</p>
            <button type="button" className="btn" onClick={retry}>{t("retry")}</button>
          </div>
        ) : (
          <p className="voice-state" role="status">{t("loading")}</p>
        )}
      </Popover>
    </div>
  );
}
