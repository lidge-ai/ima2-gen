import { messages, useT } from "../../i18n.ts";
import { useRef, useState, type ReactNode } from "react";
import type { Catalog } from "@ima2/studio-kit";
import { useStudioApi } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { ParamControls } from "./ParamControls.tsx";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import type { CreateForm } from "./form.ts";
import { useCreate } from "./useCreate.ts";

const M = messages(
  {
    "add": "Add an image to edit",
    "file": "Image to edit",
    "count": "Number of images",
    "fewer": "Fewer images",
    "more": "More images",
    "prompt": "Prompt",
    "describe": "Describe the image you want",
    "create": "Create image",
    "sending": "Sending",
    "generate": "Generate",
    "nokey": "Add a key to generate.",
    "unavailable": "No route is available for this model.",
    "uploadError": "Upload failed. Try again.",
  },
  {
    "add": "편집할 이미지 추가",
    "file": "편집할 이미지",
    "count": "이미지 수",
    "fewer": "이미지 수 줄이기",
    "more": "이미지 수 늘리기",
    "prompt": "프롬프트",
    "describe": "원하는 이미지를 설명해 주세요",
    "create": "이미지 생성",
    "sending": "요청 중",
    "generate": "생성",
    "nokey": "생성하려면 키를 추가해 주세요.",
    "unavailable": "이 모델을 사용할 수 있는 경로가 없어요.",
    "uploadError": "업로드하지 못했어요. 다시 시도해 주세요.",
  },
);

const CREATE = ["text-to-image"] as const;

interface Props {
  catalog: Catalog;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
  /** The tool tabs, shared with the image tools. */
  tabs?: ReactNode;
  /** An image added here opens the Edit tool with it; absent when no model can edit. */
  onAttach?: ((image: SlotValue) => void) | undefined;
}

function useImageUpload(onAttach: (image: SlotValue) => void) {
  const studio = useStudioApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      onAttach({ role: "source-image", upload: await studio.upload(file), name: file.name });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, take };
}

function Attach({ onAttach }: { onAttach: (image: SlotValue) => void }) {
  const t = useT(M);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, take } = useImageUpload(onAttach);
  return (
    <>
      <button
        type="button"
        className="dock-icon"
        aria-label={t("add")}
        disabled={busy}
        title={t("add")}
        onClick={() => input.current?.click()}
      >
        <Icon name={busy ? "clock" : "plus"} size={16} />
      </button>
      {error ? <span className="form-error" role="alert">{t("uploadError")}</span> : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={t("file")}
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function Count({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useT(M);
  return (
    <span className="stepper" role="group" aria-label={t("count")}>
      <button type="button" aria-label={t("fewer")} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        -
      </button>
      <span aria-live="polite">{value}/4</span>
      <button type="button" aria-label={t("more")} disabled={value >= 4} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

type Create = ReturnType<typeof useCreate>;

function DockFields({ catalog, form, set, create, onAttach }: Props & { create: Create }) {
  const t = useT(M);
  const { model } = create;
  return (
    <div className="dock-fields">
      <label className="visually-hidden" htmlFor="image-prompt">
        {t("prompt")}
      </label>
      <textarea
        id="image-prompt"
        rows={2}
        value={form.prompt}
        placeholder={t("describe")}
        onChange={(e) => set({ prompt: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="dock-chips">
        {onAttach ? <Attach onAttach={onAttach} /> : null}
        <ModelPicker
          variant="chip"
          models={catalog.models}
          kind="image"
          tasks={CREATE}
          value={form.model}
          onChange={create.pickModel}
        />
        {model ? <ParamControls variant="chip" model={model} form={form} set={set} /> : null}
        <Count value={form.count} onChange={(count) => set({ count })} />
      </div>
    </div>
  );
}

/** Bottom-docked prompt bar for images: prompt on top, settings chips and Generate below. */
export function ImageDock({ catalog, form, set, tabs, onAttach }: Props) {
  const t = useT(M);
  const create = useCreate(catalog, form, set);
  return (
    <form
      className="dock"
      aria-label={t("create")}
      onSubmit={(e) => {
        e.preventDefault();
        void create.submit();
      }}
    >
      {create.choice.kind === "needs-key" ? (
        <KeyNotice routes={create.choice.candidates} providers={catalog.providers} />
      ) : null}
      {create.error ? (
        <p className="form-error" role="alert">
          {create.error}
        </p>
      ) : null}
      {form.notice ? (
        <p className="form-error" role="alert">
          {form.notice}
        </p>
      ) : null}
      {form.info ? <p className="form-hint" role="status">{form.info}</p> : null}
      {!create.canSend && !create.sending ? <p className="form-hint">{create.blocked ?? (create.choice.kind === "needs-key" ? t("nokey") : t("unavailable"))}</p> : null}
      {tabs}
      <div className="dock-main">
        <DockFields catalog={catalog} form={form} set={set} create={create} onAttach={onAttach} />
        <button
          className="btn btn-primary dock-generate"
          type="submit"
          disabled={!create.canSend}
          title={create.blocked ?? undefined}
        >
          <span>{create.sending ? t("sending") : t("generate")}</span>
          <span className="btn-cost" title={create.cost.title || undefined}>{create.cost.text}</span>
        </button>
      </div>
    </form>
  );
}
