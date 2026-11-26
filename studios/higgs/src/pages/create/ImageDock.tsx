import { useRef, useState } from "react";
import type { Catalog } from "@ima2/studio-kit";
import { useStudioApi } from "../../studio/context.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelPicker } from "../../ui/ModelPicker.tsx";
import { ParamControls } from "./ParamControls.tsx";
import type { CreateForm } from "./form.ts";
import { useCreate } from "./useCreate.ts";

interface Props {
  catalog: Catalog;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
}

function Attach({ form, set, enabled }: Pick<Props, "form" | "set"> & { enabled: boolean }) {
  const studio = useStudioApi();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (form.sourceImage) {
    return (
      <span className="dock-attachment">
        <img src={form.sourceImage.upload.url} alt={form.sourceImage.name} />
        <button type="button" aria-label="Remove image" onClick={() => set({ sourceImage: null })}>
          <Icon name="close" size={12} />
        </button>
      </span>
    );
  }
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      set({ sourceImage: { role: "source-image", upload: await studio.upload(file), name: file.name } });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="dock-icon"
        aria-label="Add an image to edit"
        disabled={!enabled || busy}
        title={enabled ? "Add an image to edit" : "This model cannot edit images"}
        onClick={() => input.current?.click()}
      >
        <Icon name={busy ? "clock" : "plus"} size={16} />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label="Image to edit"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

function Count({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="stepper" role="group" aria-label="Number of images">
      <button type="button" aria-label="Fewer images" disabled={value <= 1} onClick={() => onChange(value - 1)}>
        -
      </button>
      <span aria-live="polite">{value}/4</span>
      <button type="button" aria-label="More images" disabled={value >= 4} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

type Create = ReturnType<typeof useCreate>;

function DockFields({ catalog, form, set, create }: Props & { create: Create }) {
  const { model } = create;
  return (
    <div className="dock-fields">
      <label className="visually-hidden" htmlFor="image-prompt">
        Prompt
      </label>
      <textarea
        id="image-prompt"
        rows={2}
        value={form.prompt}
        placeholder={form.sourceImage ? "Describe the change" : "Describe the image you want"}
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
  const create = useCreate(catalog, form, set);
  return (
    <form
      className="dock"
      aria-label="Create image"
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
      <div className="dock-main">
        <DockFields catalog={catalog} form={form} set={set} create={create} />
        <button
          className="btn btn-primary dock-generate"
          type="submit"
          disabled={!create.canSend}
          title={create.blocked ?? create.cost.title}
        >
          <span>{create.sending ? "Sending" : "Generate"}</span>
          <span className="btn-cost">{create.cost.text}</span>
        </button>
      </div>
    </form>
  );
}
