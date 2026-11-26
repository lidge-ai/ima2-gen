import type { Catalog, CatalogModel } from "@ima2/studio-kit";
import { findPreset } from "../../data/presets.ts";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { AdvancedFields, ParamControls } from "./ParamControls.tsx";
import { PresetCard } from "./PresetCard.tsx";
import { RefSlots } from "./RefSlots.tsx";
import { EDIT_TASKS, type CreateForm } from "./form.ts";
import { useCreate } from "./useCreate.ts";

interface Props {
  catalog: Catalog;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
  onOpenPresets: () => void;
}

function InputTypeToggle({ refMode, set }: { refMode: CreateForm["refMode"]; set: Props["set"] }) {
  return (
    <div className="segmented-wide" role="radiogroup" aria-label="Input type">
      <button
        type="button"
        role="radio"
        aria-checked={refMode === "frames"}
        onClick={() => set({ refMode: "frames", references: [] })}
      >
        <Icon name="image" size={15} /> Frames
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={refMode === "references"}
        onClick={() => set({ refMode: "references", firstFrame: null, lastFrame: null })}
      >
        <Icon name="layers" size={15} /> References
      </button>
    </div>
  );
}

function FrameSlots({ form, set }: { form: CreateForm; set: Props["set"] }) {
  return (
    <div className="slots">
      <UploadSlot
        label="Start frame"
        role="first-frame"
        accept="image/*"
        value={form.firstFrame}
        onChange={(firstFrame) => set({ firstFrame })}
        hint="Optional"
      />
      <UploadSlot
        label="End frame"
        role="last-frame"
        accept="image/*"
        value={form.lastFrame}
        onChange={(lastFrame) => set({ lastFrame })}
        hint="Optional"
      />
    </div>
  );
}

function CreateInputs({ model, form, set }: { model: CatalogModel; form: CreateForm; set: Props["set"] }) {
  const canFrames = model.tasks.includes("image-to-video");
  const canRefs = model.tasks.includes("reference-to-video");
  if (!canFrames && !canRefs) return <p className="panel-note">{model.label} works from the prompt only.</p>;
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
  return (
    <div className="prompt-card">
      <label htmlFor="video-prompt" className="prompt-card-label">
        Prompt
      </label>
      <textarea
        id="video-prompt"
        value={form.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
        rows={4}
        placeholder={
          form.mode === "edit"
            ? "Describe the change: make it snow, turn day into night"
            : "Describe the shot: subject, motion, camera, light"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      {model?.params.nativeAudio ? (
        <div className="prompt-card-chips">
          <button type="button" className="chip" aria-pressed={form.audio} onClick={() => set({ audio: !form.audio })}>
            <Icon name="audio" size={13} /> Sound {form.audio ? "on" : "off"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ModeTabs({ mode, set }: { mode: CreateForm["mode"]; set: Props["set"] }) {
  return (
    <div className="panel-tabs" role="tablist" aria-label="Video mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "create"}
        onClick={() => set({ mode: "create", model: undefined })}
      >
        Create video
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "edit"}
        onClick={() => set({ mode: "edit", model: undefined })}
      >
        Edit video
      </button>
    </div>
  );
}

type Create = ReturnType<typeof useCreate>;

function PanelFoot({ create }: { create: Create }) {
  return (
    <div className="panel-foot">
      {create.blocked && create.model ? <p className="form-hint">{create.blocked}</p> : null}
      <button
        className="btn btn-primary btn-generate"
        type="submit"
        disabled={!create.canSend}
        title={create.cost.title}
      >
        <span>{create.sending ? "Sending" : "Generate"}</span>
        <span className="btn-cost">{create.cost.text}</span>
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
  if (form.mode === "edit") {
    return (
      <UploadSlot
        label="Video to edit"
        role="source-video"
        accept="video/*"
        value={form.sourceVideo}
        onChange={(sourceVideo) => set({ sourceVideo })}
        hint="MP4 or MOV"
      />
    );
  }
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

function PanelNotices({ create, catalog }: { create: Create; catalog: Catalog }) {
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
    </>
  );
}

export function VideoPanel({ catalog, form, set, onOpenPresets }: Props) {
  const create = useCreate(catalog, form, set);
  const { model } = create;
  const tasks = form.mode === "edit" ? EDIT_TASKS : ["text-to-video", "image-to-video", "reference-to-video"];
  return (
    <form
      className="panel"
      aria-label="Create video"
      onSubmit={(e) => {
        e.preventDefault();
        void create.submit();
      }}
    >
      <ModeTabs mode={form.mode} set={set} />
      <div className="panel-body">
        <SourceInputs model={model} form={form} set={set} onOpenPresets={onOpenPresets} />
        <PromptCard model={model} form={form} set={set} />
        <ModelPicker
          models={catalog.models}
          kind="video"
          tasks={tasks}
          value={form.model}
          onChange={create.pickModel}
        />
        {model ? <ParamControls model={model} form={form} set={set} /> : null}
        {model ? <AdvancedFields model={model} form={form} set={set} /> : null}
        <PanelNotices create={create} catalog={catalog} />
      </div>
      <PanelFoot create={create} />
    </form>
  );
}
