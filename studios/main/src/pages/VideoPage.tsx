import { messages, useT } from "../i18n.ts";
import { useEffect, useState } from "react";
import type { Catalog } from "@ima2/studio-kit";
import { findPreset, type Preset } from "../data/presets.ts";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { Icon } from "../ui/Icon.tsx";
import { HowItWorks } from "./create/HowItWorks.tsx";
import { PresetGallery } from "./create/PresetGallery.tsx";
import { VideoPanel } from "./create/VideoPanel.tsx";
import { SpeakPanel } from "./speak/SpeakPanel.tsx";
import { EditPanel } from "./edit/EditPanel.tsx";
import { videoModes } from "./create/VideoModeTabs.tsx";
import { defaultModel } from "./create/defaults.ts";
import { CREATE_TASKS, defaultsFor, emptyForm, handOffFailed, withResult, withSentImage, type CreateForm } from "./create/form.ts";
import { useHandOff } from "./create/useHandOff.ts";
import { readDraft, syncModelToUrl, useRestore, writeDraft } from "../studio/draft.ts";

const M = messages(
  {
    "history": "History",
    "presets": "Presets",
    "guide": "How it works",
    "views": "Video views",
    "loading": "Loading models",
  },
  {
    "history": "기록",
    "presets": "프리셋",
    "guide": "사용 방법",
    "views": "영상 화면",
    "loading": "모델을 불러오는 중이에요",
  },
);

type View = "history" | "presets" | "guide";

function applyPreset(catalog: Catalog, form: CreateForm, preset: Preset | undefined): Partial<CreateForm> {
  if (!preset) return { preset: undefined };
  const model = catalog.models.find((m) => m.id === form.model);
  const fits = <T,>(options: readonly T[] | undefined, value: T | undefined) =>
    value !== undefined && options?.includes(value) ? value : undefined;
  return {
    preset: preset.id,
    prompt: preset.prompt,
    aspectRatio: fits(model?.params.aspectRatios, preset.aspectRatio) ?? form.aspectRatio,
    durationSec: fits(model?.params.durationsSec, preset.durationSec) ?? form.durationSec,
  };
}

const VIEWS: readonly { id: View; label: "history" | "presets" | "guide"; icon: "assets" | "presets" | "explore" }[] = [
  { id: "history", label: "history", icon: "assets" },
  { id: "presets", label: "presets", icon: "presets" },
  { id: "guide", label: "guide", icon: "explore" },
];

interface StageProps {
  view: View;
  setView: (v: View) => void;
  form: CreateForm;
  set: (p: Partial<CreateForm>) => void;
  catalog: Catalog;
  /** The talking form is open: presets do not apply to it. */
  speaking: boolean;
  editing: boolean;
}

function StageBody({ view, setView, form, set, catalog, speaking, editing }: StageProps) {
  const guide = <HowItWorks kind={speaking ? "speak" : editing ? "edit" : "video"} />;
  if (view === "guide") return guide;
  if (view === "history" || speaking || editing) return <Feed kind="video" empty={guide} />;
  return (
    <PresetGallery
      kind="video"
      selected={form.preset}
      onPick={(preset) => {
        set(applyPreset(catalog, form, preset));
        setView("history");
      }}
      onClose={() => setView("history")}
    />
  );
}

function Stage(props: StageProps) {
  const t = useT(M);
  return (
    <main className="stage">
      <div className="stage-head">
        <div className="tabs" role="group" aria-label={t("views")}>
          {VIEWS.filter((v) => !(props.speaking || props.editing) || v.id !== "presets").map((v) => (
            <button
              key={v.id}
              type="button"
              className="tab"
              aria-pressed={props.view === v.id}
              onClick={() => props.setView(v.id)}
            >
              <Icon name={v.icon} size={15} /> {t(v.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="stage-body">
        <StageBody {...props} />
      </div>
    </main>
  );
}

export function VideoPage({ preset, model: requested, mode }: { preset?: string; model?: string; mode?: string }) {
  const t = useT(M);
  const catalog = useStudio((s) => s.catalog);
  const speaking = mode === "speak";
  const editing = mode === "edit";
  const [form, setForm] = useState<CreateForm>(() => ({ ...emptyForm(), prompt: readDraft("video") }));
  const [view, setView] = useState<View>("history");
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, notice: undefined, noticeModel: undefined, info: undefined, ...patch }));
  useEffect(() => writeDraft("video", form.prompt), [form.prompt]);
  // The talking and edit forms keep their own model in the address.
  useEffect(() => { if (!speaking && !editing) syncModelToUrl("video", form.model); }, [form.model, speaking, editing]);
  // A failed job's "Edit the prompt" or "Try again" puts its prompt and model back here; a result's
  // "Same prompt and settings" also puts back the route, length, shape, size and sound it was made with.
  useRestore("video", (prompt, id, settings) =>
    setForm((f) => {
      const m = catalog?.models.find((x) => x.id === id && x.kind === "video");
      const base: CreateForm = m && m.id !== f.model ? { ...f, prompt, model: m.id, provider: "", ...defaultsFor(m, f) } : { ...f, prompt };
      return m ? withResult(m, { ...base, notice: undefined, info: undefined }, settings) : base;
    }),
    !!catalog,
  );
  // An image result sent here: "Animate" makes it the start frame; it can also come as the end frame or a reference.
  useHandOff(
    "video",
    (upload, name, values) => {
      const slot = values?.slot;
      if (slot === "last" || slot === "reference") setForm((f) => withSentImage(catalog?.models.find((m) => m.id === f.model), { ...f, info: undefined }, slot, { upload, name }));
      else set({ refMode: "frames", firstFrame: { role: "first-frame", upload, name } });
    },
    () => set({ notice: handOffFailed() }),
  );
  useEffect(() => {
    if (!catalog || form.model) return;
    const asked = catalog.models.find((m) => m.id === requested && m.kind === "video" && m.tasks.some((task) => CREATE_TASKS.includes(task)));
    const model = asked ?? defaultModel(catalog.models, "video", CREATE_TASKS);
    setForm((f) => {
      const next = { ...f, model: model?.id, ...defaultsFor(model, f) };
      return f.preset === undefined && preset ? { ...next, ...applyPreset(catalog, next, findPreset(preset)) } : next;
    });
  }, [catalog, form.model, preset, requested]);
  if (!catalog)
    return (
      <div className="empty" role="status">
        {t("loading")}
      </div>
    );
  return (
    <div className="workspace">
      {speaking ? (
        <SpeakPanel catalog={catalog} {...(requested ? { model: requested } : {})} />
      ) : editing ? (
        <EditPanel catalog={catalog} modes={videoModes(catalog)} {...(requested ? { model: requested } : {})} />
      ) : (
        <VideoPanel catalog={catalog} form={form} set={set} onOpenPresets={() => setView("presets")} />
      )}
      <Stage view={view} setView={setView} form={form} set={set} catalog={catalog} speaking={speaking} editing={editing} />
    </div>
  );
}
