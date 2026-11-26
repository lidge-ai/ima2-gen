import { messages, useT } from "../i18n.ts";
import { useEffect, useState } from "react";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { ImageDock } from "./create/ImageDock.tsx";
import { defaultModel, presetText } from "./create/defaults.ts";
import { defaultsFor, emptyForm, type CreateForm } from "./create/form.ts";
import { useHandOff } from "./create/useHandOff.ts";
import { PRESETS, findPreset } from "../data/presets.ts";
import { navigate } from "../router.ts";

const M = messages(
  {
    "heading": "Describe it, pick a model, generate",
    "intro": "Images save to Assets. Pick a starting point below or write your own prompt.",
    "loading": "Loading models",
  },
  {
    "heading": "설명하고 모델을 골라 생성해요",
    "intro": "이미지는 에셋에 저장돼요. 아래 예시를 고르거나 직접 프롬프트를 작성하세요.",
    "loading": "모델을 불러오는 중이에요",
  },
);

function ImageEmpty() {
  const t = useT(M);
  const samples = PRESETS.filter((p) => p.kind === "image");
  return (
    <section className="image-empty">
      <div className="image-empty-stack" aria-hidden>
        {samples.map((p) => (
          <img key={p.id} src={p.sample} alt="" />
        ))}
      </div>
      <h1>{t("heading")}</h1>
      <p className="muted">{t("intro")}</p>
      <div className="chip-row center">
        {samples.map((p) => (
          <button key={p.id} type="button" className="chip" onClick={() => navigate("image", { preset: p.id })}>
            {presetText(p.id, p.label)}
          </button>
        ))}
      </div>
    </section>
  );
}

export function ImagePage({ preset, model: requested }: { preset?: string; model?: string }) {
  const t = useT(M);
  const catalog = useStudio((s) => s.catalog);
  const [form, setForm] = useState<CreateForm>(() => emptyForm());
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  useHandOff("image", (upload, name) => set({ sourceImage: { role: "source-image", upload, name } }));
  useEffect(() => {
    if (!catalog || form.model) return;
    const asked = catalog.models.find((m) => m.id === requested && m.kind === "image");
    const model = asked ?? defaultModel(catalog.models, "image", ["text-to-image", "image-to-image"]);
    setForm((f) => ({ ...f, model: model?.id, ...defaultsFor(model, f) }));
  }, [catalog, form.model, requested]);
  useEffect(() => {
    const p = findPreset(preset);
    if (p) setForm((f) => ({ ...f, preset: p.id, prompt: p.prompt, aspectRatio: p.aspectRatio ?? f.aspectRatio }));
  }, [preset]);
  if (!catalog)
    return (
      <div className="empty" role="status">
        {t("loading")}
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
