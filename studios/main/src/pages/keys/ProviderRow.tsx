import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
import { Icon } from "../../ui/Icon.tsx";
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
  const t = useT(M);
  const [key, setKey] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const run = async (action: "save" | "remove") => {
    setBusy(true);
    setResult(null);
    try {
      if (action === "save") {
        await studio.saveKey(provider.keyVocabulary, { apiKey: key, extra });
        setKey("");
        setExtra({});
        setResult({ kind: "success", message: t("savedResult") });
      } else {
        await studio.removeKey(provider.keyVocabulary);
        setResult({ kind: "success", message: t("removedResult") });
      }
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
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
  const t = useT(M);
  return (
    <div className="key-info">
      <h3>
        <ProviderName id={provider.id} size={20} />
      </h3>
      <span className="key-status">{state}</span>
      <p>
        {t(models.length === 1 ? "oneModel" : "models", { count: models.length })}
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
        {t("getKey")} <Icon name="external" size={16} /><span className="key-new-tab">{t("newTab")}</span>
      </a>
    </div>
  );
}

export function ProviderRow({ provider, status, models, focused }: Props) {
  const t = useT(M);
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLElement>(null);
  const form = useKeyForm(provider);
  useEffect(() => {
    if (focused) {
      row.current?.scrollIntoView({ block: "center" });
      input.current?.focus({ preventScroll: true });
    }
  }, [focused]);
  const state = t(status?.source === "env" ? "fromEnv" : status?.configured ? "saved" : "notSet");
  return (
    <article className="key-row" ref={row} aria-label={provider.label}>
      <ProviderInfo provider={provider} models={models} state={state} />
      <KeyControls provider={provider} status={status} input={input} form={form} />
    </article>
  );
}
