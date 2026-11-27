import { useState } from "react";
import { EDIT_TASKS, editRoutes, type Catalog, type EditForm, type EditTask } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import { navigate } from "../../router.ts";
import { routePrice } from "../../ui/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { resolutionLabel } from "../create/ParamControls.tsx";
import { useHandOff } from "../create/useHandOff.ts";
import { VideoModeTabs, type VideoMode } from "../create/VideoModeTabs.tsx";
import { availableTools, modelsFor, takes } from "./editState.ts";
import { useEdit } from "./useEdit.ts";
import "../../styles/speak.css";

const M = messages(
  {
    title: "Edit video", tool: "Tool",
    "video-to-video": "Change", "video-extend": "Extend", "video-upscale": "Upscale",
    "video-to-videoHelp": "Describe a change and the model reworks the clip.",
    "video-extendHelp": "The model continues the clip from its last frame.",
    "video-upscaleHelp": "The same clip, sharper and at a larger size.",
    "video-to-videoSource": "Video to change", "video-extendSource": "Video to extend", "video-upscaleSource": "Video to upscale",
    format: "MP4 or MOV", prompt: "Prompt", optional: "optional",
    "video-to-videoPrompt": "Describe the change: make it snow, turn day into night",
    "video-extendPrompt": "Describe what happens next",
    "video-upscalePrompt": "Describe what to keep or sharpen",
    added: "Added length", duration: "Length", resolution: "Output size", aspect: "Aspect ratio", soundOn: "Sound on", soundOff: "Sound off",
    route: "Run through", automatic: "Automatic", direct: "direct", aggregator: "aggregator", local: "this computer, no provider charge", noKey: "no key",
    follows: "Length, size and sound follow the source video.",
    generate: "Generate", sending: "Sending", nokey: "Add a key to generate.",
    estimate: "Estimated {cost} · {seconds} s", unpriced: "Price not published", noMatch: "No price listed for these settings", afterVideo: "Add the video to see the price",
    reading: "Reading the length", unknownLength: "Length unknown, no price",
    unreadable: "This browser could not read the length of the video, so the price is not shown.",
    none: "This catalog has no model that edits, extends or upscales a video yet.",
    notHere: "{model} has no route this form can run yet, so another model is selected.",
    handOff: "Could not bring that result here. Add it with the upload button.",
  },
  {
    title: "영상 편집", tool: "도구",
    "video-to-video": "바꾸기", "video-extend": "연장", "video-upscale": "업스케일",
    "video-to-videoHelp": "바꿀 내용을 적으면 모델이 영상을 다시 만들어요.",
    "video-extendHelp": "영상의 마지막 장면에서 이어서 만들어요.",
    "video-upscaleHelp": "같은 영상을 더 선명하고 크게 만들어요.",
    "video-to-videoSource": "바꿀 영상", "video-extendSource": "연장할 영상", "video-upscaleSource": "업스케일할 영상",
    format: "MP4 또는 MOV", prompt: "프롬프트", optional: "선택",
    "video-to-videoPrompt": "바꿀 내용을 적어 주세요. 예: 눈 내리게 하기, 낮을 밤으로 바꾸기",
    "video-extendPrompt": "이어질 장면을 적어 주세요",
    "video-upscalePrompt": "살리거나 선명하게 할 부분을 적어 주세요",
    added: "추가 길이", duration: "길이", resolution: "출력 크기", aspect: "화면 비율", soundOn: "사운드 켬", soundOff: "사운드 끔",
    route: "실행 경로", automatic: "자동", direct: "직접", aggregator: "어그리게이터", local: "이 컴퓨터에서 실행, 요금 없음", noKey: "키 없음",
    follows: "길이, 크기, 사운드는 원본 영상을 따라요.",
    generate: "생성", sending: "요청 중", nokey: "생성하려면 키를 추가해 주세요.",
    estimate: "예상 {cost} · {seconds}초", unpriced: "공개 가격 없음", noMatch: "이 설정의 가격이 공개되지 않았어요", afterVideo: "영상을 넣으면 가격이 계산돼요",
    reading: "길이를 읽는 중이에요", unknownLength: "길이를 몰라 가격이 없어요",
    unreadable: "이 브라우저에서 영상 길이를 읽지 못해 가격을 표시하지 않아요.",
    none: "이 카탈로그에는 영상을 편집, 연장, 업스케일할 수 있는 모델이 아직 없어요.",
    notHere: "{model} 모델은 아직 이 폼에서 실행할 수 있는 경로가 없어 다른 모델을 골랐어요.",
    handOff: "결과를 가져오지 못했어요. 업로드 버튼으로 직접 추가해 주세요.",
  },
);

type Edit = ReturnType<typeof useEdit>;
type T = (key: keyof typeof M.en, vars?: Record<string, string | number>) => string;

function ToolTabs({ tools, edit }: { tools: readonly EditTask[]; edit: Edit }) {
  const t = useT(M);
  return (
    <>
      <div className="segmented-wide speak-tools" role="group" aria-label={t("tool")}>
        {tools.map((tool) => (
          <button key={tool} type="button" aria-pressed={edit.state.tool === tool} onClick={() => edit.setTool(tool)}>
            {t(tool)}
          </button>
        ))}
      </div>
      <p className="panel-note">{t((edit.state.tool + "Help") as "video-extendHelp")}</p>
    </>
  );
}

function PromptCard({ form, edit }: { form: EditForm; edit: Edit }) {
  const t = useT(M);
  const tool = edit.state.tool;
  const required = form.fields.requires?.includes("prompt");
  return (
    <div className="prompt-editor">
      <label htmlFor="edit-prompt" className="prompt-editor-label">
        {t("prompt")}{required ? "" : " (" + t("optional") + ")"}
      </label>
      <textarea
        id="edit-prompt" rows={3} value={edit.state.prompt} placeholder={t((tool + "Prompt") as "video-extendPrompt")}
        onChange={(e) => edit.set({ prompt: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
      />
      {takes(form, "audio") ? (
        <div className="prompt-editor-chips">
          <button type="button" className="chip" aria-pressed={edit.state.audio} onClick={() => edit.set({ audio: !edit.state.audio })}>
            <Icon name="audio" size={13} /> {t(edit.state.audio ? "soundOn" : "soundOff")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RouteTile({ edit }: { edit: Edit }) {
  const t = useT(M);
  const routes = edit.model ? editRoutes(edit.model, edit.state.tool) : [];
  if (routes.length < 2) return null;
  const options = routes.map((route) => ({
    value: route.providerId, label: route.label,
    meta: route.route === "local" ? t("local") : [t(route.route), routePrice(route), ...(route.keyConfigured ? [] : [t("noKey")])].join(" · "),
  }));
  return <SettingTile caption={t("route")} value={edit.state.provider} options={[{ value: "", label: t("automatic") }, ...options]} onChange={edit.pickRoute} />;
}

function Settings({ form, edit }: { form: EditForm; edit: Edit }) {
  const t = useT(M);
  const { state } = edit;
  const shown = [form.durationsSec, form.resolutions, form.aspectRatios].some((list) => list.length > 0);
  return (
    <>
      <div className="tiles speak-settings">
        {form.durationsSec.length > 0 && state.durationSec !== undefined ? (
          <SettingTile caption={t(state.tool === "video-extend" ? "added" : "duration")} value={state.durationSec}
            options={form.durationsSec.map((value) => ({ value, label: value + "s" }))} onChange={(durationSec) => edit.set({ durationSec })} />
        ) : null}
        {form.resolutions.length > 0 && state.resolution ? (
          <SettingTile caption={t("resolution")} value={state.resolution}
            options={form.resolutions.map((value) => ({ value, label: resolutionLabel(value) }))} onChange={(resolution) => edit.set({ resolution })} />
        ) : null}
        {form.aspectRatios.length > 0 && state.aspectRatio ? (
          <SettingTile caption={t("aspect")} value={state.aspectRatio}
            options={form.aspectRatios.map((value) => ({ value, label: value }))} onChange={(aspectRatio) => edit.set({ aspectRatio })} />
        ) : null}
        <RouteTile edit={edit} />
      </div>
      {shown ? null : <p className="panel-note">{t("follows")}</p>}
    </>
  );
}

/** The estimate, or the reason there is none yet: an unpublished price is not the same as a length still to come. */
function costText(edit: Edit, t: T): string {
  if (!edit.priced || edit.priced.pricing.length === 0) return t("unpriced");
  if (edit.billed !== null) return edit.cost ? t("estimate", { cost: edit.cost, seconds: edit.billed }) : t("noMatch");
  if (!edit.form?.source.billedLength) return t("unpriced");
  if (!edit.state.source) return t("afterVideo");
  return t(edit.state.sourceSec === null ? "unknownLength" : "reading");
}

function Foot({ edit }: { edit: Edit }) {
  const t = useT(M);
  const hint = edit.blocked ?? (edit.choice.kind === "needs-key" ? t("nokey") : null);
  return (
    <div className="panel-foot">
      {!edit.canSend && !edit.sending && hint ? <p className="form-hint">{hint}</p> : null}
      <button className="btn btn-primary btn-generate" type="submit" disabled={!edit.canSend} title={edit.blocked ?? undefined}>
        <span>{edit.sending ? t("sending") : t("generate")}</span>
        <span className="btn-cost">{costText(edit, t)}</span>
      </button>
    </div>
  );
}

const isTool = (value: unknown): value is EditTask => (EDIT_TASKS as readonly unknown[]).includes(value);

export function EditPanel({ catalog, model: requested, modes }: { catalog: Catalog; model?: string; modes: readonly VideoMode[] }) {
  const t = useT(M);
  const edit = useEdit(catalog, requested);
  const tools = availableTools(catalog);
  const { form, choice, state } = edit;
  // "Extend" or "Upscale" on a video result: the clip lands in the slot with that tool chosen.
  const [notice, setNotice] = useState(false);
  useHandOff("video-edit", (upload, name, values) => {
    if (isTool(values?.tool) && tools.includes(values.tool)) edit.setTool(values.tool);
    edit.setSource({ role: "source-video", upload, name });
    setNotice(false);
  }, () => setNotice(true));
  // A model opened by its link that no tool here can run: say so instead of quietly showing another one.
  const asked = catalog.models.find((m) => m.id === requested);
  const unrunnable = asked && EDIT_TASKS.every((tool) => editRoutes(asked, tool).length === 0) ? asked : undefined;
  const billedUnread = form?.source.billedLength && state.source && state.sourceSec === null;
  return (
    <form className="panel" aria-label={t("title")} onSubmit={(e) => { e.preventDefault(); void edit.submit(); }}>
      <VideoModeTabs mode="edit" modes={modes} onPick={(mode) => navigate("video", mode === "create" ? undefined : { mode })} />
      <div className="panel-body">
        {tools.length === 0 ? <p className="panel-note">{t("none")}</p> : <ToolTabs tools={tools} edit={edit} />}
        {unrunnable && tools.length > 0 && state.model !== unrunnable.id ? <p className="form-hint" role="status">{t("notHere", { model: unrunnable.label })}</p> : null}
        {tools.length > 0 ? (
          <UploadSlot label={t((state.tool + "Source") as "video-extendSource")} role="source-video" accept="video/*" value={state.source} onChange={edit.setSource} hint={t("format")} />
        ) : null}
        {form && takes(form, "prompt") ? <PromptCard form={form} edit={edit} /> : null}
        {tools.length > 0 ? (
          <ModelPicker models={modelsFor(catalog, state.tool)} kind="video" tasks={[state.tool]} value={state.model} onChange={edit.pickModel} />
        ) : null}
        {form ? <Settings form={form} edit={edit} /> : null}
        {billedUnread ? <p className="form-hint" role="status">{t("unreadable")}</p> : null}
        {choice.kind === "needs-key" ? <KeyNotice routes={choice.candidates} providers={catalog.providers} /> : null}
        {edit.error ? <p className="form-error" role="alert">{edit.error}</p> : null}
        {notice ? <p className="form-error" role="alert">{t("handOff")}</p> : null}
      </div>
      <Foot edit={edit} />
    </form>
  );
}
