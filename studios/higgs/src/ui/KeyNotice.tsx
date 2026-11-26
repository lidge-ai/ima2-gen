import { useId, useState, type KeyboardEvent } from "react";
import type { CatalogProvider, CatalogRoute } from "@ima2/studio-kit";
import { messages, useT } from "../i18n.ts";
import { href } from "../router.ts";
import { useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";
import { VendorLogo } from "./VendorLogo.tsx";

const M = messages(
  {
    title: "Add a key to run this model",
    body: "ima2 calls the provider with your own key at its published price. Paste a key here; your prompt and settings stay as they are.",
    via: "Key for",
    get: "Get a key from {provider}",
    newTab: "(new tab)",
    key: "API key",
    show: "Show",
    hide: "Hide",
    save: "Save key",
    saving: "Checking the key",
    saved: "Key saved. You can generate now.",
    failed: "The key was not saved: {reason}",
    required: "(required)",
    allKeys: "All API keys",
  },
  {
    title: "이 모델을 실행하려면 키가 필요해요",
    body: "ima2는 내 키로 제공업체를 부르고, 제공업체가 공개한 가격을 그대로 써요. 여기에 키를 붙여 넣으면 프롬프트와 설정은 그대로 남아요.",
    via: "키를 넣을 곳",
    get: "{provider}에서 키 발급",
    newTab: "(새 탭)",
    key: "API 키",
    show: "보기",
    hide: "숨기기",
    save: "키 저장",
    saving: "키 확인 중",
    saved: "키를 저장했어요. 이제 생성할 수 있어요.",
    failed: "키를 저장하지 못했어요: {reason}",
    required: "(필수)",
    allKeys: "전체 API 키",
  },
);

type Key = keyof typeof M.en;
type Translate = (key: Key, vars?: Record<string, string | number>) => string;

interface Props {
  routes: readonly CatalogRoute[];
  providers: readonly CatalogProvider[];
}

interface Row {
  route: CatalogRoute;
  provider: CatalogProvider;
}

/** Direct routes first, then the cheapest published price; unknown prices last. */
function order(rows: Row[]): Row[] {
  const cheapest = (r: Row) => Math.min(...r.route.pricing.map((p) => p.usd), Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => Number(b.route.route === "direct") - Number(a.route.route === "direct") || cheapest(a) - cheapest(b));
}

function useKeyEntry(provider: CatalogProvider) {
  const studio = useStudioApi();
  const [key, setKey] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (t: Translate) => {
    setBusy(true);
    setResult(null);
    try {
      await studio.saveKey(provider.keyVocabulary, { apiKey: key.trim(), extra });
      setKey("");
      setResult({ ok: true, text: t("saved") });
    } catch (err) {
      setResult({ ok: false, text: t("failed", { reason: err instanceof Error ? err.message : String(err) }) });
    } finally {
      setBusy(false);
    }
  };
  return { key, setKey, extra, setExtra, busy, result, save };
}

function KeyEntry({ provider }: { provider: CatalogProvider }) {
  const t = useT(M);
  const id = useId();
  const groupId = useId();
  const [show, setShow] = useState(false);
  const entry = useKeyEntry(provider);
  const missingExtra = provider.extraFields?.some((f) => f.required && !entry.extra[f.name]?.trim());
  const ready = !entry.busy && !!entry.key.trim() && !missingExtra;
  // This sits inside the generate form, so it cannot be a form itself: a nested form
  // lets Enter or Save submit the outer one. Enter saves the key here and stops there.
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (ready) void entry.save(t);
  };
  return (
    <div className="key-entry" role="group" aria-labelledby={groupId}>
      <span id={groupId} className="visually-hidden">
        {t("via")} {provider.label}
      </span>
      <a className="muted-link" href={provider.consoleUrl} target="_blank" rel="noreferrer">
        {t("get", { provider: provider.label })} <Icon name="external" size={12} /> <span className="visually-hidden">{t("newTab")}</span>
      </a>
      <label htmlFor={id}>{t("key")}</label>
      <div className="key-entry-row">
        <input id={id} type={show ? "text" : "password"} autoComplete="off" spellCheck={false} value={entry.key} onChange={(e) => entry.setKey(e.target.value)} onKeyDown={onEnter} />
        <button type="button" className="btn" aria-pressed={show} onClick={() => setShow(!show)}>
          {t(show ? "hide" : "show")}
        </button>
      </div>
      {provider.extraFields?.map((field) => (
        <label key={field.name} className="key-entry-extra">
          {field.name} {field.required ? t("required") : null}
          <input
            type={field.secret ? "password" : "text"}
            value={entry.extra[field.name] ?? ""}
            onChange={(e) => entry.setExtra({ ...entry.extra, [field.name]: e.target.value })}
            onKeyDown={onEnter}
          />
        </label>
      ))}
      <button type="button" className={entry.key.trim() ? "btn btn-primary" : "btn"} disabled={!ready} onClick={() => void entry.save(t)}>
        {t(entry.busy ? "saving" : "save")}
      </button>
      {entry.result ? (
        <p role={entry.result.ok ? "status" : "alert"} className={entry.result.ok ? "key-entry-ok" : "key-entry-error"}>
          {entry.result.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Shown instead of running when no candidate route has a key. The key goes in right here,
 * so the person never leaves the screen and loses what they typed; nothing is sent without one.
 */
export function KeyNotice({ routes, providers }: Props) {
  const t = useT(M);
  const titleId = useId();
  const rows = order(
    routes.flatMap((route) => {
      const provider = providers.find((p) => p.id === route.providerId);
      return provider ? [{ route, provider }] : [];
    }),
  );
  const [chosen, setChosen] = useState(rows[0]?.provider.id);
  const current = rows.find((r) => r.provider.id === chosen) ?? rows[0];
  if (!current) return null;
  return (
    <section className="notice key-notice" aria-labelledby={titleId}>
      <Icon name="key" />
      <div>
        <p className="notice-title" id={titleId}>
          {t("title")}
        </p>
        <p className="notice-body">{t("body")}</p>
        {rows.length > 1 ? (
          <div className="chip-row" role="group" aria-label={t("via")}>
            {rows.map(({ route, provider }) => (
              <button key={provider.id} type="button" className="chip chip-logo" aria-pressed={provider.id === current.provider.id} onClick={() => setChosen(provider.id)}>
                <VendorLogo id={route.providerId} size={16} /> {route.label}
              </button>
            ))}
          </div>
        ) : null}
        <KeyEntry key={current.provider.id} provider={current.provider} />
        <a className="muted-link" href={href("keys", { focus: current.provider.keyVocabulary })}>
          {t("allKeys")}
        </a>
      </div>
    </section>
  );
}

