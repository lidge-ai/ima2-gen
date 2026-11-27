import { messages, useT } from "../../i18n.ts";
import type { Catalog, CatalogModel } from "@ima2/studio-kit";
import { findPreset } from "../../data/presets.ts";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { AdvancedFields, ParamControls } from "./ParamControls.tsx";
import { PresetCard } from "./PresetCard.tsx";
import { RefSlots } from "./RefSlots.tsx";
import { CREATE_TASKS, type CreateForm } from "./form.ts";
import { useCreate } from "./useCreate.ts";
import { VideoModeTabs, videoModes } from "./VideoModeTabs.tsx";
import { navigate } from "../../router.ts";

const M = messages(
  {
    "input": "Input type",
    "frames": "Frames",
    "refs": "References",
    "start": "Start frame",
    "end": "End frame",
    "optional": "Optional",
    "promptOnly": "{model} works from the prompt only.",
    "prompt": "Prompt",
    "createPlaceholder": "Describe the shot: subject, motion, camera, light",
    "soundOn": "Sound on",
    "soundOff": "Sound off",
    "create": "Create video",
    "sending": "Sending",
    "generate": "Generate",
    "nokey": "Add a key to generate.",
    "unavailable": "No route is available for this model.",
  },
  {
    "input": "입력 유형",
    "frames": "프레임",
    "refs": "레퍼런스",
    "start": "시작 프레임",
    "end": "끝 프레임",
    "optional": "선택",
    "promptOnly": "{model} 모델은 프롬프트만 사용할 수 있어요.",
    "prompt": "프롬프트",
    "createPlaceholder": "장면의 피사체, 움직임, 카메라, 조명을 설명해 주세요",
    "soundOn": "사운드 켬",
    "soundOff": "사운드 끔",
    "create": "영상 생성",
    "sending": "요청 중",
    "generate": "생성",
    "nokey": "생성하려면 키를 추가해 주세요.",
    "unavailable": "이 모델을 사용할 수 있는 경로가 없어요.",
  },
);

interface Props {
  catalog: Catalog;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
  onOpenPresets: () => void;
}

function InputTypeToggle({ refMode, set }: { refMode: CreateForm["refMode"]; set: Props["set"] }) {
  const t = useT(M);
  return (
    <div className="segmented-wide" role="group" aria-label={t("input")}>
      <button
        type="button"
        aria-pressed={refMode === "frames"}
        onClick={() => set({ refMode: "frames", references: [] })}
      >
        <Icon name="image" size={15} /> {t("frames")}
      </button>
      <button
        type="button"
        aria-pressed={refMode === "references"}
        onClick={() => set({ refMode: "references", firstFrame: null, lastFrame: null })}
      >
        <Icon name="layers" size={15} /> {t("refs")}
      </button>
    </div>
  );
}

function FrameSlots({ form, set }: { form: CreateForm; set: Props["set"] }) {
  const t = useT(M);
  return (
    <div className="slots">
      <UploadSlot
        label={t("start")}
        role="first-frame"
        accept="image/*"
        value={form.firstFrame}
        onChange={(firstFrame) => set({ firstFrame })}
        hint={t("optional")}
      />
      <UploadSlot
        label={t("end")}
        role="last-frame"
        accept="image/*"
        value={form.lastFrame}
        onChange={(lastFrame) => set({ lastFrame })}
        hint={t("optional")}
      />
    </div>
  );
}

function CreateInputs({ model, form, set }: { model: CatalogModel; form: CreateForm; set: Props["set"] }) {
  const t = useT(M);
  const canFrames = model.tasks.includes("image-to-video");
  const canRefs = model.tasks.includes("reference-to-video");
  if (!canFrames && !canRefs) return <p className="panel-note">{t("promptOnly", { model: model.label })}</p>;
  const refMode = canFrames && canRefs ? form.refMode : canRefs ? "references" : "frames";
  return (
    <>
      {canFrames && canRefs ? <InputTypeToggle refMode={refMode} set={set} /> : null}
      {refMode === "frames" ? (
        <FrameSlots form={form} set={set} />
      ) : (
        <RefSlots
          values={form.references}
          max={model.params.maxReferenceImages ?? 3}
          onChange={(references) => set({ references })}
        />
      )}
    </>
  );
}

function PromptCard({ model, form, set }: { model: CatalogModel | undefined; form: CreateForm; set: Props["set"] }) {
  const t = useT(M);
  return (
    <div className="prompt-editor">
      <label htmlFor="video-prompt" className="prompt-editor-label">
        {t("prompt")}
      </label>
      <textarea
        id="video-prompt"
        value={form.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
        rows={4}
        placeholder={t("createPlaceholder")}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      {model?.params.nativeAudio ? (
        <div className="prompt-editor-chips">
          <button type="button" className="chip" aria-pressed={form.audio} onClick={() => set({ audio: !form.audio })}>
            <Icon name="audio" size={13} /> {t(form.audio ? "soundOn" : "soundOff")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Create = ReturnType<typeof useCreate>;

function PanelFoot({ create }: { create: Create }) {
  const t = useT(M);
  return (
    <div className="panel-foot">
      {!create.canSend && !create.sending ? <p className="form-hint">{create.blocked ?? (create.choice.kind === "needs-key" ? t("nokey") : t("unavailable"))}</p> : null}
      <button
        className="btn btn-primary btn-generate"
        type="submit"
        disabled={!create.canSend}
        title={create.blocked ?? undefined}
      >
        <span>{create.sending ? t("sending") : t("generate")}</span>
        <span className="btn-cost" title={create.cost.title || undefined}>{create.cost.text}</span>
      </button>
    </div>
  );
}

function SourceInputs({
  model,
  form,
  set,
  onOpenPresets,
}: {
  model: CatalogModel | undefined;
  form: CreateForm;
  set: Props["set"];
  onOpenPresets: () => void;
}) {
  return (
    <>
      <PresetCard
        preset={findPreset(form.preset)}
        modelLabel={model?.label}
        vendor={model?.vendor}
        onChange={onOpenPresets}
      />
      {model ? <CreateInputs model={model} form={form} set={set} /> : null}
    </>
  );
}

function PanelNotices({ create, catalog, notice }: { create: Create; catalog: Catalog; notice?: string | undefined }) {
  return (
    <>
      {create.choice.kind === "needs-key" ? (
        <KeyNotice routes={create.choice.candidates} providers={catalog.providers} />
      ) : null}
      {create.error ? (
        <p className="form-error" role="alert">
          {create.error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-error" role="alert">
          {notice}
        </p>
      ) : null}
    </>
  );
}

export function VideoPanel({ catalog, form, set, onOpenPresets }: Props) {
  const t = useT(M);
  const create = useCreate(catalog, form, set);
  const { model } = create;
  return (
    <form
      className="panel"
      aria-label={t("create")}
      onSubmit={(e) => {
        e.preventDefault();
        void create.submit();
      }}
    >
      <VideoModeTabs
        mode="create"
        modes={videoModes(catalog)}
        onPick={(mode) => navigate("video", mode === "create" ? undefined : { mode })}
      />
      <div className="panel-body">
        <SourceInputs model={model} form={form} set={set} onOpenPresets={onOpenPresets} />
        <PromptCard model={model} form={form} set={set} />
        <ModelPicker
          models={catalog.models}
          kind="video"
          tasks={CREATE_TASKS}
          value={form.model}
          onChange={create.pickModel}
        />
        {model ? <ParamControls model={model} form={form} set={set} /> : null}
        {model ? <AdvancedFields model={model} form={form} set={set} /> : null}
        <PanelNotices create={create} catalog={catalog} notice={form.notice} />
      </div>
      <PanelFoot create={create} />
    </form>
  );
}
