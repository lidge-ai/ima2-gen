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
import { defaultModel } from "./create/defaults.ts";
import { EDIT_TASKS, defaultsFor, emptyForm, type CreateForm } from "./create/form.ts";
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
}

function StageBody({ view, setView, form, set, catalog, speaking }: StageProps) {
  const guide = <HowItWorks kind={speaking ? "speak" : "video"} />;
  if (view === "guide") return guide;
  if (view === "history" || speaking) return <Feed kind="video" empty={guide} />;
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
          {VIEWS.filter((v) => !props.speaking || v.id !== "presets").map((v) => (
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
  const [form, setForm] = useState<CreateForm>(() => ({ ...emptyForm(), prompt: readDraft("video"), mode: mode === "edit" ? "edit" : "create" }));
  const [view, setView] = useState<View>("history");
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => writeDraft("video", form.prompt), [form.prompt]);
  // The talking form keeps its own model in the address.
  useEffect(() => { if (!speaking) syncModelToUrl("video", form.model); }, [form.model, speaking]);
  // Arriving from the talking form's tabs: the address says which of create and edit to show.
  useEffect(() => {
    if (speaking) return;
    const wanted = mode === "edit" ? "edit" : "create";
    setForm((f) => (f.mode === wanted ? f : { ...f, mode: wanted, model: undefined }));
  }, [mode, speaking]);
  // A failed job's "Edit the prompt" or "Try again" puts its prompt and model back here.
  useRestore("video", (prompt, id) =>
    setForm((f) => {
      const m = catalog?.models.find((x) => x.id === id && x.kind === "video");
      return m && m.id !== f.model ? { ...f, prompt, model: m.id, provider: "", ...defaultsFor(m, f) } : { ...f, prompt };
    }),
  );
  useHandOff("video", (upload, name) =>
    set({ mode: "create", refMode: "frames", firstFrame: { role: "first-frame", upload, name } }),
  );
  useEffect(() => {
    if (!catalog || form.model) return;
    const tasks = form.mode === "edit" ? EDIT_TASKS : undefined;
    const asked =
      form.mode === "create" ? catalog.models.find((m) => m.id === requested && m.kind === "video") : undefined;
    const model = asked ?? defaultModel(catalog.models, "video", tasks);
    setForm((f) => {
      const next = { ...f, model: model?.id, ...defaultsFor(model, f) };
      return f.preset === undefined && preset ? { ...next, ...applyPreset(catalog, next, findPreset(preset)) } : next;
    });
  }, [catalog, form.model, form.mode, preset, requested]);
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
      ) : (
        <VideoPanel catalog={catalog} form={form} set={set} onOpenPresets={() => setView("presets")} />
      )}
      <Stage view={view} setView={setView} form={form} set={set} catalog={catalog} speaking={speaking} />
    </div>
  );
}
