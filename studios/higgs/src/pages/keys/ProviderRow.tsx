import { useEffect, useRef, useState } from "react";
import type { CatalogModel, CatalogProvider, KeyStatus } from "@ima2/studio-kit";
import { useStudioApi } from "../../studio/context.tsx";

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

export function ProviderRow({ provider, status, models, focused }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLElement>(null);
  const { key, setKey, extra, setExtra, show, setShow, busy, result, run } = useKeyForm(provider);
  useEffect(() => {
    if (focused) {
      row.current?.scrollIntoView({ block: "center" });
      input.current?.focus({ preventScroll: true });
    }
  }, [focused]);
  const state = status?.source === "env" ? "From environment" : status?.configured ? "Saved" : "Not set";
  return (
    <article className="key-row" ref={row} aria-label={provider.label}>
      <div className="key-info">
        <h3>{provider.label}</h3>
        <span className="key-status">{state}</span>
        <p>
          {models.length} {models.length === 1 ? "model" : "models"}
          {models.length
            ? ": " +
              models
                .slice(0, 3)
                .map((m) => m.label)
                .join(", ") +
              (models.length > 3 ? ", …" : "")
            : ""}
        </p>
        <a href={provider.consoleUrl} target="_blank" rel="noreferrer">
          Get a key <span aria-hidden="true">↗</span>
        </a>
      </div>
      <div className="key-controls">
        <label htmlFor={"key-" + provider.id}>API key</label>
        <div className="key-input">
          <input
            ref={input}
            id={"key-" + provider.id}
            type={show ? "text" : "password"}
            value={key}
            autoComplete="off"
            placeholder="Enter a key"
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            aria-label={(show ? "Hide" : "Show") + " key for " + provider.label}
            onClick={() => setShow(!show)}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {provider.extraFields?.map((field) => (
          <label key={field.name} className="key-extra">
            {field.name}
            {field.required ? " (required)" : ""}
            <input
              type={field.secret ? "password" : "text"}
              value={extra[field.name] ?? ""}
              onChange={(e) => setExtra({ ...extra, [field.name]: e.target.value })}
            />
          </label>
        ))}
        <div className="key-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              busy ||
              !key ||
              provider.extraFields?.some(
                (f) => f.required && !extra[f.name] && !status?.extraFields.find((s) => s.name === f.name)?.configured,
              )
            }
            onClick={() => {
              void run("save");
            }}
          >
            Save
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || !status?.configured}
            onClick={() => {
              void run("test");
            }}
          >
            Test
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || !status?.configured || status.source === "env"}
            onClick={() => {
              void run("remove");
            }}
          >
            Remove
          </button>
        </div>
        {status?.source === "env" ? (
          <p className="key-hint">Environment keys must be removed from the environment.</p>
        ) : null}
        {result ? (
          <p role="status" className="key-result">
            {result}
          </p>
        ) : null}
      </div>
    </article>
  );
}
