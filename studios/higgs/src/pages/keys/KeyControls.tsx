import type { RefObject } from "react";
import type { CatalogProvider, KeyStatus } from "@ima2/studio-kit";
import type { KeyForm } from "./ProviderRow.tsx";

function KeyInput({
  provider,
  input,
  form,
}: {
  provider: CatalogProvider;
  input: RefObject<HTMLInputElement | null>;
  form: KeyForm;
}) {
  return (
    <>
      <label htmlFor={"key-" + provider.id}>API key</label>
      <div className="key-input">
        <input
          ref={input}
          id={"key-" + provider.id}
          type={form.show ? "text" : "password"}
          value={form.key}
          autoComplete="off"
          placeholder="Enter a key"
          onChange={(e) => form.setKey(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          aria-label={(form.show ? "Hide" : "Show") + " key for " + provider.label}
          onClick={() => form.setShow(!form.show)}
        >
          {form.show ? "Hide" : "Show"}
        </button>
      </div>
      {provider.extraFields?.map((field) => (
        <label key={field.name} className="key-extra">
          {field.name}
          {field.required ? " (required)" : ""}
          <input
            type={field.secret ? "password" : "text"}
            value={form.extra[field.name] ?? ""}
            onChange={(e) => form.setExtra({ ...form.extra, [field.name]: e.target.value })}
          />
        </label>
      ))}
    </>
  );
}

function KeyActions({ provider, status, form }: { provider: CatalogProvider; status?: KeyStatus; form: KeyForm }) {
  const missing = provider.extraFields?.some(
    (f) => f.required && !form.extra[f.name] && !status?.extraFields.find((s) => s.name === f.name)?.configured,
  );
  return (
    <div className="key-actions">
      <button
        className="btn btn-primary"
        type="button"
        disabled={form.busy || !form.key || missing}
        onClick={() => {
          void form.run("save");
        }}
      >
        Save
      </button>
      <button
        className="btn"
        type="button"
        disabled={form.busy || !status?.configured}
        onClick={() => {
          void form.run("test");
        }}
      >
        Test
      </button>
      <button
        className="btn"
        type="button"
        disabled={form.busy || !status?.configured || status.source === "env"}
        onClick={() => {
          void form.run("remove");
        }}
      >
        Remove
      </button>
    </div>
  );
}

export function KeyControls({
  provider,
  status,
  input,
  form,
}: {
  provider: CatalogProvider;
  status?: KeyStatus;
  input: RefObject<HTMLInputElement | null>;
  form: KeyForm;
}) {
  return (
    <div className="key-controls">
      <KeyInput provider={provider} input={input} form={form} />
      <KeyActions provider={provider} status={status} form={form} />
      {status?.source === "env" ? (
        <p className="key-hint">Environment keys must be removed from the environment.</p>
      ) : null}
      {form.result ? (
        <p role="status" className="key-result">
          {form.result}
        </p>
      ) : null}
    </div>
  );
}
