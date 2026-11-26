import { useEffect, useState } from "react";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { ImageDock } from "./create/ImageDock.tsx";
import { defaultModel } from "./create/defaults.ts";
import { defaultsFor, emptyForm, type CreateForm } from "./create/form.ts";
import { useHandOff } from "./create/useHandOff.ts";
import { PRESETS, findPreset } from "../data/presets.ts";
import { navigate } from "../router.ts";

function ImageEmpty() {
  const samples = PRESETS.filter((p) => p.kind === "image");
  return (
    <section className="image-empty">
      <div className="image-empty-stack" aria-hidden>
        {samples.map((p) => (
          <img key={p.id} src={p.sample} alt="" />
        ))}
      </div>
      <h1>Describe it, pick a model, generate</h1>
      <p className="muted">Images save to Assets. Pick a starting point below or write your own prompt.</p>
      <div className="chip-row center">
        {samples.map((p) => (
          <button key={p.id} type="button" className="chip" onClick={() => navigate("image", { preset: p.id })}>
            {p.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function ImagePage({ preset }: { preset?: string }) {
  const catalog = useStudio((s) => s.catalog);
  const [form, setForm] = useState<CreateForm>(() => emptyForm());
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  useHandOff("image", (upload, name) => set({ sourceImage: { role: "source-image", upload, name } }));
  useEffect(() => {
    if (!catalog || form.model) return;
    const model = defaultModel(catalog.models, "image", ["text-to-image", "image-to-image"]);
    setForm((f) => ({ ...f, model: model?.id, ...defaultsFor(model, f) }));
  }, [catalog, form.model]);
  useEffect(() => {
    const p = findPreset(preset);
    if (p) setForm((f) => ({ ...f, preset: p.id, prompt: p.prompt, aspectRatio: p.aspectRatio ?? f.aspectRatio }));
  }, [preset]);
  if (!catalog)
    return (
      <div className="empty" role="status">
        Loading models
      </div>
    );
  return (
    <div className="image-page">
      <main className="image-stage">
        <Feed kind="image" density="compact" empty={<ImageEmpty />} />
      </main>
      <ImageDock catalog={catalog} form={form} set={set} />
    </div>
  );
}
