import { estimateCost, formatUsd, type Catalog } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import { useStudio } from "../../studio/context.tsx";
import { Feed } from "../../ui/Feed.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { HowItWorks } from "../create/HowItWorks.tsx";
import { availableTools, lengthRange, modelsFor, switchLabel, switchesOf, toolRoutes, type AudioTool } from "./audioForm.ts";
import { useAudio } from "./useAudio.ts";
import { VoicePicker } from "./VoicePicker.tsx";
import "../../styles/audio.css";

const M = messages(
  {
    title: "Create audio", tool: "Tool", speech: "Speech", sound: "Music & SFX", video: "Video sound",
    speechHelp: "A voice reads your text.", soundHelp: "Music or a sound effect from a description.", videoHelp: "Sound effects made to fit your clip.",
    script: "Script", scriptHint: "Write exactly what the voice should say", describe: "Description", describeHint: "Genre, mood and instruments, or the sound you need",
    notes: "Notes", notesHint: "Optional: what the sound should be like", clip: "Video", required: "Required", count: "{n} characters",
    length: "Length in seconds", lengthAuto: "Decided by the model", lengthRange: "{min} to {max}",
    route: "Run through", automatic: "Automatic", direct: "direct", aggregator: "aggregator", noKey: "no key", noPrice: "No published price",
    generate: "Generate", sending: "Sending", estimate: "Estimated {cost}", unpriced: "Price not published",
    perCharacter: "Priced per character", perLength: "Priced by length", afterVideo: "Add the video to see the price",
    nokey: "Add a key to generate.", none: "No model in this catalog makes audio yet.", loading: "Loading models", history: "History", views: "Audio views",
  },
  {
    title: "오디오 만들기", tool: "도구", speech: "음성", sound: "음악·효과음", video: "영상 소리",
    speechHelp: "목소리가 내 글을 읽어요.", soundHelp: "설명으로 음악이나 효과음을 만들어요.", videoHelp: "내 영상에 맞는 효과음을 만들어요.",
    script: "대본", scriptHint: "목소리가 읽을 내용을 그대로 적어 주세요", describe: "설명", describeHint: "장르, 분위기, 악기나 필요한 소리를 적어 주세요",
    notes: "메모", notesHint: "선택: 어떤 소리면 좋은지 적어 주세요", clip: "영상", required: "필수", count: "{n}자",
    length: "길이(초)", lengthAuto: "모델이 정해요", lengthRange: "{min}~{max}",
    route: "실행 경로", automatic: "자동", direct: "직접", aggregator: "어그리게이터", noKey: "키 없음", noPrice: "공개 가격 없음",
    generate: "생성", sending: "요청 중", estimate: "예상 {cost}", unpriced: "공개 가격 없음",
    perCharacter: "글자 수에 따라 과금", perLength: "길이에 따라 과금", afterVideo: "영상을 넣으면 가격이 계산돼요",
    nokey: "생성하려면 키를 추가해 주세요.", none: "이 카탈로그에는 오디오를 만드는 모델이 아직 없어요.", loading: "모델을 불러오는 중이에요", history: "기록", views: "오디오 화면",
  },
);

type Audio = ReturnType<typeof useAudio>;
type T = (key: keyof typeof M.en, vars?: Record<string, string | number>) => string;

function ToolTabs({ tools, audio }: { tools: readonly AudioTool[]; audio: Audio }) {
  const t = useT(M);
  return (
    <>
      <div className="segmented-wide speak-tools" role="group" aria-label={t("tool")}>
        {tools.map((tool) => (
          <button key={tool} type="button" aria-pressed={audio.state.tool === tool} onClick={() => audio.setTool(tool)}>
            {t(tool)}
          </button>
        ))}
      </div>
      <p className="panel-note">{t((audio.state.tool + "Help") as "speechHelp")}</p>
    </>
  );
}

function TextCard({ audio }: { audio: Audio }) {
  const t = useT(M);
  const tool = audio.state.tool;
  const label = tool === "speech" ? "script" : tool === "sound" ? "describe" : "notes";
  return (
    <div className="prompt-editor">
      <label htmlFor="audio-text" className="prompt-editor-label">{t(label)}</label>
      <textarea
        id="audio-text" rows={tool === "speech" ? 6 : 3} value={audio.state.text} placeholder={t((label + "Hint") as "scriptHint")}
        onChange={(e) => audio.setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
      />
      {tool === "speech" ? <span className="audio-count">{t("count", { n: audio.state.text.trim().length })}</span> : null}
    </div>
  );
}

function RouteTile({ audio }: { audio: Audio }) {
  const t = useT(M);
  const routes = audio.model ? toolRoutes(audio.model, audio.state.tool) : [];
  if (routes.length < 2) return null;
  const options = routes.map((route) => ({
    value: route.providerId, label: route.label,
    meta: [t(route.route), route.pricing.length ? "" : t("noPrice"), route.keyConfigured ? "" : t("noKey")].filter(Boolean).join(" · "),
  }));
  return <SettingTile caption={t("route")} value={audio.state.provider} options={[{ value: "", label: t("automatic") }, ...options]} onChange={audio.pickRoute} />;
}

function SoundSettings({ audio }: { audio: Audio }) {
  const t = useT(M);
  const { model, shown, state } = audio;
  if (!model || !shown) return null;
  const range = lengthRange(model, shown.providerId, state.tool);
  const switches = switchesOf(model, shown.providerId, state.tool);
  if (!range && switches.length === 0) return null;
  return (
    <div className="audio-settings">
      {range ? (
        <label className="field">
          <span>{t("length")} <span className="audio-range">{t("lengthRange", { min: range.minSec, max: range.maxSec })}</span></span>
          <input inputMode="decimal" value={state.seconds} placeholder={range.required ? "" : t("lengthAuto")} onChange={(e) => audio.setSeconds(e.target.value)} />
        </label>
      ) : null}
      {switches.map((option) => (
        <button key={option.name} type="button" className="chip" aria-pressed={state.switches[option.name] === true} onClick={() => audio.toggle(option.name)}>
          {switchLabel(option)}
        </button>
      ))}
    </div>
  );
}

/** The estimate, or what it is waiting for. "Not published" is only for a route without a price. */
function costText(audio: Audio, t: T): string {
  if (!audio.shown || audio.shown.pricing.length === 0) return t("unpriced");
  if (audio.cost) return t("estimate", { cost: audio.cost });
  if (audio.state.tool === "speech") return t("perCharacter");
  if (audio.state.tool === "video") return audio.state.video ? t("perLength") : t("afterVideo");
  // A flat price per request needs no length; estimateCost gives it as soon as a route is known.
  const flat = estimateCost(audio.shown.pricing, {});
  return flat.usd !== null ? t("estimate", { cost: formatUsd(flat) }) : t("perLength");
}

function Foot({ audio }: { audio: Audio }) {
  const t = useT(M);
  const hint = audio.blocked ?? (audio.choice.kind === "needs-key" ? t("nokey") : null);
  return (
    <div className="panel-foot">
      {!audio.canSend && !audio.sending && hint ? <p className="form-hint">{hint}</p> : null}
      <button className="btn btn-primary btn-generate" type="submit" disabled={!audio.canSend} title={audio.blocked ?? undefined}>
        <span>{audio.sending ? t("sending") : t("generate")}</span>
        <span className="btn-cost">{costText(audio, t)}</span>
      </button>
    </div>
  );
}

function AudioPanel({ catalog, tool, model }: { catalog: Catalog; tool?: string; model?: string }) {
  const t = useT(M);
  const audio = useAudio(catalog, { ...(tool ? { tool } : {}), ...(model ? { model } : {}) });
  const tools = availableTools(catalog);
  const { state, choice } = audio;
  return (
    <form className="panel" aria-label={t("title")} onSubmit={(e) => { e.preventDefault(); void audio.submit(); }}>
      <div className="panel-body">
        {tools.length === 0 ? <p className="panel-note">{t("none")}</p> : <ToolTabs tools={tools} audio={audio} />}
        {state.tool === "video" && tools.length > 0 ? (
          <div className="slots">
            <UploadSlot label={t("clip")} role="source-video" accept="video/*" value={state.video} onChange={audio.setVideo} hint={t("required")} />
          </div>
        ) : null}
        {tools.length > 0 ? <TextCard audio={audio} /> : null}
        {state.tool === "speech" && tools.length > 0 ? (
          <VoicePicker providerId={audio.shown?.providerId} keyed={!!audio.route} value={state.voice} onChange={audio.setVoice} />
        ) : null}
        {tools.length > 0 ? (
          <ModelPicker models={modelsFor(catalog, state.tool)} kind="audio" value={state.model} onChange={audio.pickModel} />
        ) : null}
        {state.tool === "sound" ? <SoundSettings audio={audio} /> : null}
        <RouteTile audio={audio} />
        {choice.kind === "needs-key" ? <KeyNotice routes={choice.candidates} providers={catalog.providers} /> : null}
        {audio.error ? <p className="form-error" role="alert">{audio.error}</p> : null}
      </div>
      <Foot audio={audio} />
    </form>
  );
}

export function AudioPage({ tool, model }: { tool?: string; model?: string }) {
  const t = useT(M);
  const catalog = useStudio((s) => s.catalog);
  if (!catalog) return <div className="empty" role="status">{t("loading")}</div>;
  return (
    <div className="workspace">
      <AudioPanel catalog={catalog} {...(tool ? { tool } : {})} {...(model ? { model } : {})} />
      <main className="stage">
        <div className="stage-head">
          <div className="tabs" role="group" aria-label={t("views")}>
            <span className="tab" aria-current="true">{t("history")}</span>
          </div>
        </div>
        <div className="stage-body">
          <Feed kind="audio" empty={<HowItWorks kind="audio" />} />
        </div>
      </main>
    </div>
  );
}
