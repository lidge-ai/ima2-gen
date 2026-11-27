import { formRoutes, formatUsd, estimateCost, type Catalog, type MediaOptionSpec, type TalkingTask, type TaskForm } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import { navigate } from "../../router.ts";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { VideoModeTabs } from "../create/VideoModeTabs.tsx";
import { availableTasks, modelsFor, optionLabel, shownOptions, slotAccept, slotLabel, valueLabel } from "./speakForm.ts";
import { useSpeak } from "./useSpeak.ts";
import "../../styles/speak.css";

const M = messages(
  {
    title: "Talking video", tool: "Tool",
    lipsync: "Lip sync", avatar: "Avatar", dubbing: "Dubbing", subtitles: "Subtitles",
    lipsyncHelp: "The person in your video says your audio.",
    avatarHelp: "A face photo speaks your audio.",
    dubbingHelp: "The speech in your video is translated; each speaker keeps their voice.",
    subtitlesHelp: "Captions are added from the speech in your video.",
    optional: "Optional", required: "Required",
    resolution: "Resolution", route: "Run through", automatic: "Automatic", default: "Default",
    noPrice: "No published price", direct: "direct", aggregator: "aggregator", local: "this computer, no provider charge", noKey: "no key",
    generate: "Generate", sending: "Sending",
    estimate: "Estimated {cost} · {seconds} s", unpriced: "Price not published",
    afterAudio: "Add the audio to see the price", afterVideo: "Add the video to see the price", reading: "Reading the length", unknownLength: "Length unknown, no price",
    measuring: "Reading the length", unreadable: "This browser could not read the length of {label}, so the price is not shown.",
    nokey: "Add a key to generate.", none: "No model in this catalog can make a talking video yet.",
  },
  {
    title: "말하는 영상", tool: "도구",
    lipsync: "립싱크", avatar: "아바타", dubbing: "더빙", subtitles: "자막",
    lipsyncHelp: "영상 속 인물이 내 오디오를 말해요.",
    avatarHelp: "사진 속 얼굴이 내 오디오를 말해요.",
    dubbingHelp: "영상 속 말을 다른 언어로 바꿔요. 말하는 사람의 목소리는 그대로예요.",
    subtitlesHelp: "영상 속 말소리로 자막을 넣어요.",
    optional: "선택", required: "필수",
    resolution: "해상도", route: "실행 경로", automatic: "자동", default: "기본값",
    noPrice: "공개 가격 없음", direct: "직접", aggregator: "어그리게이터", local: "이 컴퓨터에서 실행, 요금 없음", noKey: "키 없음",
    generate: "생성", sending: "요청 중",
    estimate: "예상 {cost} · {seconds}초", unpriced: "공개 가격 없음",
    afterAudio: "오디오를 넣으면 가격이 계산돼요", afterVideo: "영상을 넣으면 가격이 계산돼요", reading: "길이를 읽는 중이에요", unknownLength: "길이를 몰라 가격이 없어요",
    measuring: "길이를 읽는 중이에요", unreadable: "이 브라우저에서 {label}의 길이를 읽지 못해 가격을 표시하지 않아요.",
    nokey: "생성하려면 키를 추가해 주세요.", none: "이 카탈로그에는 말하는 영상을 만들 수 있는 모델이 아직 없어요.",
  },
);

type Speak = ReturnType<typeof useSpeak>;

function ToolTabs({ tasks, speak }: { tasks: readonly TalkingTask[]; speak: Speak }) {
  const t = useT(M);
  return (
    <>
      <div className="segmented-wide speak-tools" role="group" aria-label={t("tool")}>
        {tasks.map((task) => (
          <button key={task} type="button" aria-pressed={speak.state.task === task} onClick={() => speak.setTask(task)}>
            {t(task)}
          </button>
        ))}
      </div>
      <p className="panel-note">{t((speak.state.task + "Help") as "lipsyncHelp")}</p>
    </>
  );
}

function Inputs({ form, speak }: { form: TaskForm; speak: Speak }) {
  const t = useT(M);
  const task = speak.state.task;
  return (
    <div className="slots">
      {form.inputs.map((need) => (
        <UploadSlot
          key={need.role}
          label={slotLabel(task, need.role)}
          role={need.role}
          accept={slotAccept(need.role)}
          value={speak.state.files[need.role] ?? null}
          onChange={(value) => speak.setFile(need.role, value)}
          hint={t(need.min > 0 ? "required" : "optional")}
        />
      ))}
    </div>
  );
}

function OptionField({ option, speak }: { option: MediaOptionSpec; speak: Speak }) {
  const t = useT(M);
  const label = optionLabel(option);
  const value = speak.state.options[option.name];
  if (option.type === "enum") {
    const choices = (option.values ?? []).map((v) => ({ value: v, label: valueLabel(option, v) }));
    // A list that has its own "auto" starts there; otherwise an unset choice reads as the provider's default.
    const unset = option.values?.includes("auto") ? "auto" : "";
    const listed = unset === "auto" || (option.required && value !== undefined);
    return (
      <SettingTile
        caption={label}
        value={typeof value === "string" ? value : unset}
        options={listed ? choices : [{ value: "", label: option.required ? "-" : t("default") }, ...choices]}
        onChange={(next) => speak.setOption(option.name, next)}
      />
    );
  }
  if (option.type === "boolean") {
    return (
      <button type="button" className="chip" aria-pressed={value === true} onClick={() => speak.setOption(option.name, value !== true)}>
        {label}
      </button>
    );
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input value={typeof value === "string" ? value : ""} maxLength={option.maxLength} onChange={(e) => speak.setOption(option.name, e.target.value)} />
    </label>
  );
}

function RouteTile({ speak }: { speak: Speak }) {
  const t = useT(M);
  const { model, state } = speak;
  const routes = model ? formRoutes(model, state.task) : [];
  if (routes.length < 2) return null;
  const price = (pricing: (typeof routes)[number]["pricing"]) => {
    const quote = estimateCost(pricing, { durationSec: 1, ...(state.resolution ? { resolution: state.resolution } : {}) });
    return quote.usd === null ? t("noPrice") : formatUsd(quote) + "/s";
  };
  const options = routes.map((route) => ({
    value: route.providerId,
    label: route.label,
    // A route on the user's own machine has no price and no key to be missing.
    meta: route.route === "local" ? t("local") : [t(route.route), price(route.pricing), ...(route.keyConfigured ? [] : [t("noKey")])].join(" · "),
  }));
  return <SettingTile caption={t("route")} value={state.provider} options={[{ value: "", label: t("automatic") }, ...options]} onChange={speak.pickRoute} />;
}

function Settings({ form, speak }: { form: TaskForm; speak: Speak }) {
  const t = useT(M);
  const options = shownOptions(form);
  return (
    <div className="tiles speak-settings">
      {form.resolutions.length > 0 && speak.state.resolution ? (
        <SettingTile
          caption={t("resolution")}
          value={speak.state.resolution}
          options={form.resolutions.map((value) => ({ value, label: value }))}
          onChange={speak.setResolution}
        />
      ) : null}
      {options.map((option) => (
        <OptionField key={option.name} option={option} speak={speak} />
      ))}
      <RouteTile speak={speak} />
    </div>
  );
}

/**
 * What the price line under Generate says: the estimate, or the reason there is none yet. "Not published"
 * is only for a route without a price; a route billed by length names the upload the price is waiting for.
 */
function costText(speak: Speak, t: (key: keyof typeof M.en, vars?: Record<string, string | number>) => string): string {
  if (!speak.priced || speak.priced.pricing.length === 0) return t("unpriced");
  if (speak.cost && speak.billed !== null) return t("estimate", { cost: speak.cost, seconds: speak.billed });
  const billed = (speak.form?.inputs ?? []).filter((need) => need.billedLength);
  const missing = billed.find((need) => !speak.state.files[need.role]);
  if (missing) return t(missing.role.endsWith("audio") ? "afterAudio" : "afterVideo");
  return t(billed.some((need) => speak.state.lengths[need.role] === null) ? "unknownLength" : "reading");
}

/** A file whose length the browser could not read: say so instead of leaving the price blank without a reason. */
function LengthNote({ form, speak }: { form: TaskForm; speak: Speak }) {
  const t = useT(M);
  const billed = form.inputs.filter((need) => need.billedLength && speak.state.files[need.role]);
  const unread = billed.find((need) => speak.state.lengths[need.role] === null);
  if (unread) return <p className="form-hint" role="status">{t("unreadable", { label: slotLabel(speak.state.task, unread.role) })}</p>;
  const pending = billed.some((need) => speak.state.lengths[need.role] === undefined);
  return pending ? <p className="form-hint" role="status">{t("measuring")}</p> : null;
}

function Foot({ speak }: { speak: Speak }) {
  const t = useT(M);
  const hint = speak.blocked ?? (speak.choice.kind === "needs-key" ? t("nokey") : null);
  return (
    <div className="panel-foot">
      {!speak.canSend && !speak.sending && hint ? <p className="form-hint">{hint}</p> : null}
      <button className="btn btn-primary btn-generate" type="submit" disabled={!speak.canSend} title={speak.blocked ?? undefined}>
        <span>{speak.sending ? t("sending") : t("generate")}</span>
        <span className="btn-cost">{costText(speak, t)}</span>
      </button>
    </div>
  );
}

export function SpeakPanel({ catalog, model: requested }: { catalog: Catalog; model?: string }) {
  const t = useT(M);
  const speak = useSpeak(catalog, requested);
  const tasks = availableTasks(catalog);
  const { form, choice } = speak;
  return (
    <form className="panel" aria-label={t("title")} onSubmit={(e) => { e.preventDefault(); void speak.submit(); }}>
      <VideoModeTabs mode="speak" modes={["create", "edit", "speak"]} onPick={(mode) => navigate("video", mode === "edit" ? { mode } : undefined)} />
      <div className="panel-body">
        {tasks.length === 0 ? <p className="panel-note">{t("none")}</p> : <ToolTabs tasks={tasks} speak={speak} />}
        {form ? <Inputs form={form} speak={speak} /> : null}
        {tasks.length > 0 ? (
          <ModelPicker models={modelsFor(catalog, speak.state.task)} kind="video" tasks={[speak.state.task]} value={speak.state.model} onChange={speak.pickModel} />
        ) : null}
        {form ? <Settings form={form} speak={speak} /> : null}
        {form ? <LengthNote form={form} speak={speak} /> : null}
        {choice.kind === "needs-key" ? <KeyNotice routes={choice.candidates} providers={catalog.providers} /> : null}
        {speak.error ? <p className="form-error" role="alert">{speak.error}</p> : null}
      </div>
      <Foot speak={speak} />
    </form>
  );
}
