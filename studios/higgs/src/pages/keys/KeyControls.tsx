import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
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
  const t = useT(M);
  return (
    <>
      <label htmlFor={"key-" + provider.id}>{t("apiKey")}</label>
      <div className="key-input">
        <input
          ref={input}
          id={"key-" + provider.id}
          type={form.show ? "text" : "password"}
          value={form.key}
          autoComplete="off"
          placeholder={t("enterKey")}
          onChange={(e) => form.setKey(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          aria-label={t(form.show ? "hideKey" : "showKey", { provider: provider.label })}
          onClick={() => form.setShow(!form.show)}
        >
          {t(form.show ? "hide" : "show")}
        </button>
      </div>
      {provider.extraFields?.map((field) => (
        <label key={field.name} className="key-extra">
          {field.name}
          {field.required ? t("required") : ""}
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
  const t = useT(M);
  const missing = provider.extraFields?.some(
    (f) => f.required && !form.extra[f.name] && !status?.extraFields.find((s) => s.name === f.name)?.configured,
  );
  return (
    <div className="key-actions">
      <button
        className={form.key ? "btn btn-primary" : "btn"}
        type="button"
        disabled={form.busy || !form.key || missing}
        onClick={() => {
          void form.run("save");
        }}
      >
        {t("save")}
      </button>
      <button
        className="btn"
        type="button"
        disabled={form.busy || !status?.configured || status.source === "env"}
        onClick={() => {
          void form.run("remove");
        }}
      >
        {t("remove")}
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
  const t = useT(M);
  return (
    <div className="key-controls">
      <KeyInput provider={provider} input={input} form={form} />
      <KeyActions provider={provider} status={status} form={form} />
      {status?.source === "env" ? (
        <p className="key-hint">{t("envHint")}</p>
      ) : null}
      {form.result ? (
        <p role={form.result.kind === "error" ? "alert" : "status"} className={form.result.kind === "error" ? "key-result key-result-error" : "key-result"}>
          {form.result.message}
        </p>
      ) : null}
    </div>
  );
}
