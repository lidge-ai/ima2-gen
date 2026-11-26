import { useEffect, useRef, useState } from "react";
import type { CatalogModel, CatalogProvider, KeyStatus } from "@ima2/studio-kit";
import { useStudioApi } from "../../studio/context.tsx";
import { ModelName, ProviderName } from "../../ui/ModelName.tsx";
import { KeyControls } from "./KeyControls.tsx";

interface Props {
  provider: CatalogProvider;
  status?: KeyStatus;
  models: readonly CatalogModel[];
  focused: boolean;
}

function useKeyForm(provider: CatalogProvider) {
  const studio = useStudioApi();
  const [key, setKey] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const run = async (action: "save" | "test" | "remove") => {
    setBusy(true);
    setResult("");
    try {
      if (action === "save") {
        const validation = await studio.saveKey(provider.keyVocabulary, { apiKey: key, extra });
        setKey("");
        setExtra({});
        setResult(
          validation
            ? validation.ok
              ? "Saved and validated"
              : `Saved. Validation failed: ${validation.reason ?? "Unknown reason"}`
            : "Saved. Validation not available.",
        );
      } else if (action === "test") {
        const validation = await studio.client.keys.validate(provider.keyVocabulary);
        setResult(validation.ok ? "Validation passed" : `Validation failed: ${validation.reason ?? "Unknown reason"}`);
      } else {
        await studio.removeKey(provider.keyVocabulary);
        setResult("Key removed");
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return { key, setKey, extra, setExtra, show, setShow, busy, result, run };
}

export type KeyForm = ReturnType<typeof useKeyForm>;

function ProviderInfo({
  provider,
  models,
  state,
}: {
  provider: CatalogProvider;
  models: readonly CatalogModel[];
  state: string;
}) {
  return (
    <div className="key-info">
      <h3>
        <ProviderName id={provider.id} size={20} />
      </h3>
      <span className="key-status">{state}</span>
      <p>
        {models.length} {models.length === 1 ? "model" : "models"}
        {models.length ? ": " : ""}
        {models.slice(0, 3).map((model, index) => (
          <span key={model.id}>
            {index ? ", " : ""}
            <ModelName id={model.id} />
          </span>
        ))}
        {models.length > 3 ? ", …" : ""}
      </p>
      <a href={provider.consoleUrl} target="_blank" rel="noreferrer">
        Get a key <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}

export function ProviderRow({ provider, status, models, focused }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLElement>(null);
  const form = useKeyForm(provider);
  useEffect(() => {
    if (focused) {
      row.current?.scrollIntoView({ block: "center" });
      input.current?.focus({ preventScroll: true });
    }
  }, [focused]);
  const state = status?.source === "env" ? "From environment" : status?.configured ? "Saved" : "Not set";
  return (
    <article className="key-row" ref={row} aria-label={provider.label}>
      <ProviderInfo provider={provider} models={models} state={state} />
      <KeyControls provider={provider} status={status} input={input} form={form} />
    </article>
  );
}
