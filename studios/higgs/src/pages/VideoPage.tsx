import { useEffect, useState } from "react";
import type { Catalog } from "@ima2/studio-kit";
import { findPreset, type Preset } from "../data/presets.ts";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { Icon } from "../ui/Icon.tsx";
import { HowItWorks } from "./create/HowItWorks.tsx";
import { PresetGallery } from "./create/PresetGallery.tsx";
import { VideoPanel } from "./create/VideoPanel.tsx";
import { defaultModel } from "./create/defaults.ts";
import { EDIT_TASKS, defaultsFor, emptyForm, type CreateForm } from "./create/form.ts";
import { useHandOff } from "./create/useHandOff.ts";

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

function Stage({
  view,
  setView,
  form,
  set,
  catalog,
}: {
  view: View;
  setView: (v: View) => void;
  form: CreateForm;
  set: (p: Partial<CreateForm>) => void;
  catalog: Catalog;
}) {
  return (
    <main className="stage">
      <div className="stage-head">
        <div className="tabs" role="tablist" aria-label="Video views">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={view === "history"}
            onClick={() => setView("history")}
          >
            <Icon name="assets" size={15} /> History
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={view === "presets"}
            onClick={() => setView("presets")}
          >
            <Icon name="presets" size={15} /> Presets
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={view === "guide"}
            onClick={() => setView("guide")}
          >
            <Icon name="explore" size={15} /> How it works
          </button>
        </div>
      </div>
      <div className="stage-body">
        {view === "presets" ? (
          <PresetGallery
            kind="video"
            selected={form.preset}
            onPick={(preset) => {
              set(applyPreset(catalog, form, preset));
              setView("history");
            }}
            onClose={() => setView("history")}
          />
        ) : view === "guide" ? (
          <HowItWorks kind="video" />
        ) : (
          <Feed kind="video" empty={<HowItWorks kind="video" />} />
        )}
      </div>
    </main>
  );
}

export function VideoPage({ preset }: { preset?: string; model?: string }) {
  const catalog = useStudio((s) => s.catalog);
  const [form, setForm] = useState<CreateForm>(() => emptyForm());
  const [view, setView] = useState<View>("history");
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  useHandOff("video", (upload, name) =>
    set({ mode: "create", refMode: "frames", firstFrame: { role: "first-frame", upload, name } }),
  );
  useEffect(() => {
    if (!catalog || form.model) return;
    const tasks = form.mode === "edit" ? EDIT_TASKS : undefined;
    const model = defaultModel(catalog.models, "video", tasks);
    setForm((f) => {
      const next = { ...f, model: model?.id, ...defaultsFor(model, f) };
      return f.preset === undefined && preset ? { ...next, ...applyPreset(catalog, next, findPreset(preset)) } : next;
    });
  }, [catalog, form.model, form.mode, preset]);
  if (!catalog)
    return (
      <div className="empty" role="status">
        Loading models
      </div>
    );
  return (
    <div className="workspace">
      <VideoPanel catalog={catalog} form={form} set={set} onOpenPresets={() => setView("presets")} />
      <Stage view={view} setView={setView} form={form} set={set} catalog={catalog} />
    </div>
  );
}
