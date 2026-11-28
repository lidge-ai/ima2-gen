import { messages, useT } from "../i18n.ts";
import { useEffect, useState } from "react";
import { useStudio } from "../studio/context.tsx";
import { Feed } from "../ui/Feed.tsx";
import { ImageDock } from "./create/ImageDock.tsx";
import { defaultModel, presetText } from "./create/defaults.ts";
import { defaultsFor, emptyForm, handOffFailed, withResult, type CreateForm } from "./create/form.ts";
import { useHandOff } from "./create/useHandOff.ts";
import { IMAGE_TASKS, imageRoutes, type Catalog, type ImageTask } from "@ima2/studio-kit";
import { ImageToolDock } from "./image/ImageToolDock.tsx";
import { ImageToolTabs } from "./image/ImageToolTabs.tsx";
import { TOOL_MODE, availableTools, toolOfMode, type ImageTool } from "./image/imageState.ts";
import { useImageTool } from "./image/useImageTool.ts";
import { readDraft, syncModelToUrl, useRestore, writeDraft } from "../studio/draft.ts";
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
    "intro": "이미지는 에셋에 저장돼요. 아래 예시를 고르거나 직접 프롬프트를 입력해 주세요.",
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

/** The tool a link asks for: its mode, else the first tool a linked model that cannot create can run. */
function linkedTool(catalog: Catalog, tools: readonly ImageTask[], mode: string | undefined, requested: string | undefined): ImageTool {
  const asked = toolOfMode(mode);
  if (asked && tools.includes(asked)) return asked;
  const model = catalog.models.find((m) => m.id === requested && m.kind === "image");
  if (!model || model.tasks.includes("text-to-image")) return "create";
  return tools.find((tool) => imageRoutes(model, tool).length > 0) ?? "create";
}

function Workspace({ catalog, preset, requested, mode }: { catalog: Catalog; preset?: string | undefined; requested?: string | undefined; mode?: string | undefined }) {
  const [form, setForm] = useState<CreateForm>(() => ({ ...emptyForm(), prompt: readDraft("image") }));
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, notice: undefined, info: undefined, ...patch }));
  const tools = availableTools(catalog);
  const tool = linkedTool(catalog, tools, mode, requested);
  const creating = tool === "create";
  // The tool form stays alive while Create is open, so images added there are still in it when the person comes back.
  const [last, setLast] = useState<ImageTask>(tools[0] ?? "image-to-image");
  useEffect(() => { if (tool !== "create") setLast(tool); }, [tool]);
  const imageTool = useImageTool(catalog, creating ? last : tool, requested, !creating);
  const [failed, setFailed] = useState(false);
  const open = (next: ImageTool) => navigate("image", next === "create" ? undefined : { mode: TOOL_MODE[next] });
  useEffect(() => writeDraft("image", form.prompt), [form.prompt]);
  useEffect(() => { if (creating) syncModelToUrl("image", form.model); }, [form.model, creating]);
  // A failed job's "Edit the prompt" or "Try again" puts its prompt and model back here; a result's
  // "Same prompt and settings" also puts back the route, shape and size it was made with.
  useRestore("image", (prompt, id, settings) =>
    setForm((f) => {
      const m = catalog.models.find((x) => x.id === id && x.kind === "image");
      const base: CreateForm = m && m.id !== f.model ? { ...f, prompt, model: m.id, provider: "", ...defaultsFor(m, f) } : { ...f, prompt };
      return m ? withResult(m, { ...base, notice: undefined, info: undefined }, settings) : base;
    }),
  );
  const edit = tools.includes("image-to-image");
  const attach = (image: Parameters<typeof imageTool.addImages>[0][number]) => {
    imageTool.addImages([image]);
    open("image-to-image");
  };
  // "Edit" on a result: the image joins the Edit tool's images, here or after opening this screen.
  useHandOff(
    "image",
    (upload, name) => { setFailed(false); attach({ role: "source-image", upload, name }); },
    () => setFailed(true),
  );
  useEffect(() => {
    if (form.model) return;
    const asked = catalog.models.find((m) => m.id === requested && m.kind === "image" && m.tasks.includes("text-to-image"));
    const model = asked ?? defaultModel(catalog.models, "image", ["text-to-image"]);
    setForm((f) => ({ ...f, model: model?.id, ...defaultsFor(model, f) }));
  }, [catalog, form.model, requested]);
  useEffect(() => {
    const p = findPreset(preset);
    if (p) setForm((f) => ({ ...f, preset: p.id, prompt: p.prompt, aspectRatio: p.aspectRatio ?? f.aspectRatio }));
  }, [preset]);
  const tabs = <ImageToolTabs tool={tool} tools={tools} onPick={open} />;
  // A model opened by its link that the open tool cannot run: say so instead of quietly showing another one.
  const linked = catalog.models.find((m) => m.id === requested && m.kind === "image");
  const unrunnable = !creating && linked && IMAGE_TASKS.every((task) => imageRoutes(linked, task).length === 0) && imageTool.state.model !== linked.id ? linked.label : undefined;
  const notice = failed ? handOffFailed() : undefined;
  return (
    <div className="image-page">
      <main className="image-stage">
        <Feed kind="image" density="compact" empty={<ImageEmpty />} />
      </main>
      {creating ? (
        <ImageDock catalog={catalog} form={{ ...form, notice: form.notice ?? notice }} set={set} tabs={tabs} onAttach={edit ? attach : undefined} />
      ) : (
        <ImageToolDock catalog={catalog} tool={imageTool} tabs={tabs} unrunnable={unrunnable} notice={notice} />
      )}
    </div>
  );
}

export function ImagePage({ preset, model, mode }: { preset?: string; model?: string; mode?: string }) {
  const t = useT(M);
  const catalog = useStudio((s) => s.catalog);
  if (!catalog)
    return (
      <div className="empty" role="status">
        {t("loading")}
      </div>
    );
  return <Workspace catalog={catalog} preset={preset} requested={model} mode={mode} />;
}
