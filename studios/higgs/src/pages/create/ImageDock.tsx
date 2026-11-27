import { messages, useT } from "../../i18n.ts";
import { useRef, useState } from "react";
import type { Catalog } from "@ima2/studio-kit";
import { useStudioApi } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { ParamControls } from "./ParamControls.tsx";
import type { CreateForm } from "./form.ts";
import { useCreate } from "./useCreate.ts";

const M = messages(
  {
    "remove": "Remove image",
    "add": "Add an image to edit",
    "cannot": "This model cannot edit images",
    "file": "Image to edit",
    "count": "Number of images",
    "fewer": "Fewer images",
    "more": "More images",
    "prompt": "Prompt",
    "change": "Describe the change",
    "describe": "Describe the image you want",
    "create": "Create image",
    "sending": "Sending",
    "generate": "Generate",
    "estimate": "Estimated {cost}",
    "noPrice": "Price not published",
    "nokey": "Add a key to generate.",
    "unavailable": "No route is available for this model.",
    "uploadError": "Upload failed. Try again.",
  },
  {
    "remove": "이미지 삭제",
    "add": "편집할 이미지 추가",
    "cannot": "이 모델은 이미지를 편집할 수 없어요",
    "file": "편집할 이미지",
    "count": "이미지 수",
    "fewer": "이미지 수 줄이기",
    "more": "이미지 수 늘리기",
    "prompt": "프롬프트",
    "change": "바꾸고 싶은 내용을 적어 주세요",
    "describe": "원하는 이미지를 설명해 주세요",
    "create": "이미지 생성",
    "sending": "요청 중",
    "generate": "생성",
    "estimate": "예상 {cost}",
    "noPrice": "공개 가격 없음",
    "nokey": "생성하려면 키를 추가해 주세요.",
    "unavailable": "이 모델을 사용할 수 있는 경로가 없어요.",
    "uploadError": "업로드하지 못했어요. 다시 시도해 주세요.",
  },
);

interface Props {
  catalog: Catalog;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
}

function useImageUpload(set: Props["set"]) {
  const studio = useStudioApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(false);
    try {
      set({ sourceImage: { role: "source-image", upload: await studio.upload(file), name: file.name } });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, take };
}

function Attach({ form, set, enabled }: Pick<Props, "form" | "set"> & { enabled: boolean }) {
  const t = useT(M);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, take } = useImageUpload(set);
  if (form.sourceImage) {
    return (
      <span className="dock-attachment">
        <img src={form.sourceImage.upload.url} alt={form.sourceImage.name} />
        <button type="button" aria-label={t("remove")} onClick={() => set({ sourceImage: null })}>
          <Icon name="close" size={12} />
        </button>
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className="dock-icon"
        aria-label={t("add")}
        disabled={!enabled || busy}
        title={enabled ? t("add") : t("cannot")}
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

function Count({ value, onChange }: { value: number; onChange: (n: number) => void }) {
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

function DockFields({ catalog, form, set, create }: Props & { create: Create }) {
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
        placeholder={form.sourceImage ? t("change") : t("describe")}
        onChange={(e) => set({ prompt: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="dock-chips">
        <Attach form={form} set={set} enabled={!!model?.tasks.includes("image-to-image")} />
        <ModelPicker
          variant="chip"
          models={catalog.models}
          kind="image"
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
export function ImageDock({ catalog, form, set }: Props) {
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
      {!create.canSend && !create.sending ? <p className="form-hint">{create.blocked ?? (create.choice.kind === "needs-key" ? t("nokey") : t("unavailable"))}</p> : null}
      <div className="dock-main">
        <DockFields catalog={catalog} form={form} set={set} create={create} />
        <button
          className="btn btn-primary dock-generate"
          type="submit"
          disabled={!create.canSend}
          title={create.blocked ?? undefined}
        >
          <span>{create.sending ? t("sending") : t("generate")}</span>
          <span className="btn-cost">{create.cost.text === "-" || create.cost.text === "Price not published" ? t("noPrice") : t("estimate", { cost: create.cost.text })}</span>
        </button>
      </div>
    </form>
  );
}
