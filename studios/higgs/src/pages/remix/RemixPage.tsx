import { useEffect, useState } from "react";
import type { WorkflowDef } from "@ima2/studio-kit";
import { messages, tr, useT } from "../../i18n.ts";
import { PRESETS, type Preset } from "../../data/presets.ts";
import { useStudio } from "../../studio/context.tsx";
import { handOffFile, takeHandOff, watchHandOff } from "../../studio/handoff.ts";
import { Feed } from "../../ui/Feed.tsx";
import { Showcase } from "../../ui/Showcase.tsx";
import { WorkflowInput, WorkflowParams, WorkflowSteps, Generate } from "../workflow/WorkflowFields.tsx";
import { useWorkflow, type WorkflowForm } from "../workflow/useWorkflow.ts";
import { WorkflowsError } from "../workflow/WorkflowsError.tsx";
import { useWorkflows } from "../../studio/workflows.ts";
import { RUN_STYLES, RunStyles, baseOf, styleOf, variantId } from "./RunStyles.tsx";
import "../../styles/remix.css";

const M = messages(
  { noVideo: "This workflow has no source video input", sampleUnavailable: "Sample clip is unavailable", sampleFailed: "Could not load sample clip", preview: "Preview unavailable", library: "Motion library", libraryHint: "Choose a clip to use as your source video.", categories: "Motion categories", all: "All", camera: "Camera", mood: "Mood", product: "Product", videoFailed: "Could not load video", slowPush: "Slow push", orbit: "Orbit", crane: "Crane up", handheld: "Handheld follow", rain: "Neon rain", turn: "Product turntable", motion: "Motion transfer", swap: "Object swap", restyle: "Restyle", workflow: "Remix workflow", views: "Remix views", history: "History", empty: "No remix results yet", emptyHint: "Generate a remix to see it here.", loadError: "Could not load workflows: {error}", none: "No remix workflows available", loading: "Loading remix workflows" },
  { noVideo: "이 워크플로에는 원본 영상 입력이 없어요", sampleUnavailable: "샘플 영상을 사용할 수 없어요", sampleFailed: "샘플 영상을 불러오지 못했어요", preview: "미리보기를 사용할 수 없어요", library: "모션 라이브러리", libraryHint: "원본 영상으로 쓸 클립을 골라 주세요.", categories: "모션 카테고리", all: "전체", camera: "카메라", mood: "분위기", product: "제품", videoFailed: "영상을 불러오지 못했어요", slowPush: "천천히 다가가기", orbit: "주변 회전", crane: "위로 상승", handheld: "핸드헬드 추적", rain: "네온 비", turn: "제품 회전", motion: "동작 따라하기", swap: "사물 바꾸기", restyle: "스타일 바꾸기", workflow: "리믹스 워크플로", views: "리믹스 화면", history: "기록", empty: "아직 리믹스 결과가 없어요", emptyHint: "리믹스를 생성하면 여기에 표시돼요.", loadError: "워크플로를 불러오지 못했어요: {error}", none: "사용할 수 있는 리믹스 워크플로가 없어요", loading: "리믹스 워크플로를 불러오는 중이에요" },
);

function useMotionSelection(form: WorkflowForm) {
  const [selected, setSelected] = useState("");
  const pick = async (item: Preset) => {
    try {
      form.setError(null);
      const input = form.def.inputs.find((entry) => entry.kind === "video");
      if (!input) throw new Error(tr(M, "noVideo"));
      const response = await fetch(new URL(item.sample, document.baseURI));
      if (!response.ok || !response.headers.get("content-type")?.startsWith("video/"))
        throw new Error(tr(M, "sampleUnavailable"));
      const file = new File([await response.blob()], item.id + ".mp4", {
        type: "video/mp4",
      });
      const upload = await form.studio.upload(file);
      form.setFiles((old) => ({
        ...old,
        [input.name]: [{ role: input.role ?? "source-video", upload, name: item.label }],
      }));
      setSelected(item.id);
    } catch (err) {
      form.setError(err instanceof Error ? err.message : tr(M, "sampleFailed"));
    }
  };
  return { selected, pick };
}

function MotionClip({
  item,
  selected,
  broken,
  pick,
  onError,
}: {
  item: Preset;
  selected: boolean;
  broken: boolean;
  pick: (item: Preset) => Promise<void>;
  onError: () => void;
}) {
  const t = useT(M);
  const labels = { "slow-push": t("slowPush"), orbit: t("orbit"), "crane-up": t("crane"), handheld: t("handheld"), "rain-neon": t("rain"), "product-turn": t("turn") } as Record<string, string>;
  return (
    <button
      className="remix-clip"
      type="button"
      aria-pressed={selected}
      onClick={() => {
        void pick(item);
      }}
    >
      {broken ? (
        <span className="remix-unavailable">{t("preview")}</span>
      ) : (
        <video src={item.sample} muted playsInline onError={onError} />
      )}
      <span className="remix-clip-label">{labels[item.id] ?? item.label}</span>
    </button>
  );
}

/**
 * The first visit to Remix starts from an example clip instead of an empty form (once per tab,
 * and never over a clip handed over from another screen); removing it leaves the form empty.
 */
function useSeededSource(form: WorkflowForm, clip: Preset | undefined, pick: (item: Preset) => Promise<void>) {
  useEffect(() => {
    const input = form.def.inputs.find((entry) => entry.kind === "video");
    if (!clip || !input || form.files[input.name]?.length) return;
    if (sessionStorage.getItem("ima2-studio-handoff") || sessionStorage.getItem("ima2-remix-seeded")) return;
    sessionStorage.setItem("ima2-remix-seeded", "1");
    void pick(clip);
    // Once per mount of this workflow; later changes are the person's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.def.id]);
}

function MotionLibrary({ form }: { form: WorkflowForm }) {
  const t = useT(M);
  const [category, setCategory] = useState("All");
  const [broken, setBroken] = useState<string[]>([]);
  const { selected, pick } = useMotionSelection(form);
  const clips = PRESETS.filter((item) => item.sampleKind === "video");
  const categories = ["All", ...new Set(clips.map((item) => item.category))];
  useSeededSource(form, clips[0], pick);
  return (
    <div className="gallery">
      <div className="remix-intro">
        <h1>{t("library")}</h1>
        <p className="muted">{t("libraryHint")}</p>
      </div>
      <div className="chip-row" aria-label={t("categories")}>
        {categories.map((name) => (
          <button
            type="button"
            key={name}
            className="chip"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name === "All" ? t("all") : name === "Camera" ? t("camera") : name === "Mood" ? t("mood") : name === "Product" ? t("product") : name}
          </button>
        ))}
      </div>
      <div className="remix-grid">
        {clips
          .filter((item) => category === "All" || item.category === category)
          .map((item) => (
            <MotionClip
              key={item.id}
              item={item}
              selected={selected === item.id}
              broken={broken.includes(item.id)}
              pick={pick}
              onError={() => setBroken((old) => [...old, item.id])}
            />
          ))}
      </div>
    </div>
  );
}

function useRemixHandOff(form: WorkflowForm) {
  useEffect(() => {
    const input = form.def.inputs.find((entry) => entry.kind === "video");
    if (!input) return;
    // Also listens while open: "Remix" on a result in this screen's history sends it here.
    return watchHandOff(() => {
      const handoff = takeHandOff("remix", form.def.id);
      if (!handoff) return false;
      // A showcase "make one like this" also carries the example's field values.
      for (const [name, value] of Object.entries(handoff.values ?? {})) {
        if (form.def.inputs.some((entry) => entry.kind === "text" && entry.name === name))
          form.setTexts((old) => ({ ...old, [name]: String(value) }));
        else if (form.def.params.some((param) => param.name === name)) form.setParams((old) => ({ ...old, [name]: value }));
      }
      void handOffFile(handoff)
        .then((file) => form.studio.upload(file))
        .then((upload) => {
          form.setFiles((old) => ({
            ...old,
            [input.name]: [{ role: input.role ?? "source-video", upload, name: handoff.name }],
          }));
        })
        .catch((err: unknown) => form.setError(err instanceof Error ? err.message : tr(M, "videoFailed")));
      return true;
    });
  }, [form.def, form.studio, form.setFiles, form.setError, form.setTexts, form.setParams]);
}

const modes = [
  { id: "remix-motion-transfer", label: "motion" },
  { id: "remix-object-swap", label: "swap" },
  { id: "remix-restyle", label: "restyle" },
];

function RemixModes({ def, workflows }: { def: WorkflowDef; workflows: readonly WorkflowDef[] }) {
  const t = useT(M);
  const base = baseOf(def.id);
  const style = styleOf(def.id);
  const has = (id: string) => workflows.some((item) => item.id === id);
  // Switching what to remix keeps how it runs when that variant exists.
  const target = (mode: string) =>
    [variantId(mode, style), ...RUN_STYLES.map((s) => variantId(mode, s))].find(has) ?? mode;
  return (
    <>
      <nav className="remix-modes" aria-label={t("workflow")}>
        {modes
          .filter((mode) => RUN_STYLES.some((s) => has(variantId(mode.id, s))))
          .map((mode) => (
            <a key={mode.id} href={`#/remix/${target(mode.id)}`} aria-current={mode.id === base ? "page" : undefined}>
              {t(mode.label as "motion" | "swap" | "restyle")}
            </a>
          ))}
      </nav>
      <RunStyles def={def} workflows={workflows} />
    </>
  );
}

function RemixPanel({
  def,
  workflows,
  form,
  onSubmit,
}: {
  def: WorkflowDef;
  workflows: readonly WorkflowDef[];
  form: WorkflowForm;
  onSubmit: () => void;
}) {
  const t = useT(M);
  return (
    <form
      className="panel"
      aria-label={t("workflow")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="panel-tabs">
        <strong>Remix</strong>
      </div>
      <div className="panel-body">
        <div className="workflow-card">
          <h2>{def.label}</h2>
          <p className="muted">{def.description}</p>
        </div>
        <RemixModes def={def} workflows={workflows} />
        {def.inputs.map((input) => (
          <WorkflowInput
            key={input.name}
            input={input}
            form={form}
            optionalSwitch={input.kind === "text" && !input.required && /^(notes|prompt)$/i.test(input.label)}
          />
        ))}
        <WorkflowParams def={def} form={form} />
        <WorkflowSteps def={def} form={form} />
      </div>
      <div className="panel-foot">
        <Generate form={form} />
      </div>
    </form>
  );
}

function RemixStage({
  form,
  view,
  setView,
}: {
  form: WorkflowForm;
  view: "library" | "history";
  setView: (view: "library" | "history") => void;
}) {
  const t = useT(M);
  return (
    <main className="stage">
      <div className="stage-head">
        <div className="tabs" role="group" aria-label={t("views")}>
          <button
            type="button"
            className="tab"
            aria-pressed={view === "library"}
            onClick={() => setView("library")}
          >
            {t("library")}
          </button>
          <button
            type="button"
            className="tab"
            aria-pressed={view === "history"}
            onClick={() => setView("history")}
          >
            {t("history")}
          </button>
        </div>
      </div>
      <div className="stage-body">
        {view === "library" ? (
          <>
            <Showcase />
            <MotionLibrary form={form} />
          </>
        ) : (
          <Feed workflow={(id) => id.startsWith("remix-")} empty={<div className="empty"><p>{t("empty")}</p><p>{t("emptyHint")}</p></div>} />
        )}
      </div>
    </main>
  );
}

function RemixWorkspace({ def, workflows }: { def: WorkflowDef; workflows: readonly WorkflowDef[] }) {
  const form = useWorkflow(def);
  const [view, setView] = useState<"library" | "history">("library");
  useRemixHandOff(form);
  return (
    <div className="workspace remix-workspace">
      <RemixPanel
        def={def}
        workflows={workflows}
        form={form}
        onSubmit={() => {
          void form.submit();
          setView("history");
        }}
      />
      <RemixStage form={form} view={view} setView={setView} />
    </div>
  );
}

export function RemixPage({ workflow }: { workflow?: string }) {
  const t = useT(M);
  const all = useWorkflows();
  const loaded = useStudio((s) => s.workflowsLoaded);
  const error = useStudio((s) => s.workflowsError);
  const workflows = all.filter((item) => item.family === "remix");
  const def =
    workflows.find((item) => item.id === workflow) ??
    workflows.find((item) => item.id === modes[0]?.id) ??
    workflows[0];
  if (error) return <WorkflowsError error={error} />;
  if (!def)
    return (
      <div className="empty" role="status">
        {t(loaded ? "none" : "loading")}
      </div>
    );
  return <RemixWorkspace key={def.id} def={def} workflows={workflows} />;
}
