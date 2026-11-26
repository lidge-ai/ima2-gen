import { useT } from "../../i18n.ts";
import { M } from "./messages.ts";
import { useEffect, useState } from "react";
import type { Catalog, KeyStatus } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { ProviderRow } from "./ProviderRow.tsx";
import "../../styles/keys.css";

function useInitialKeys(retry: number) {
  const studio = useStudioApi();
  const [initialKeys, setInitialKeys] = useState<readonly KeyStatus[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    studio.client.keys.list().then(
      (keys) => {
        if (active) setInitialKeys(keys);
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [studio, retry]);
  return { initialKeys, error };
}

function ProviderGroups({
  catalog,
  statuses,
  query,
  focus,
  clearSearch,
}: {
  catalog: Catalog;
  statuses: readonly KeyStatus[];
  query: string;
  focus?: string;
  clearSearch: () => void;
}) {
  const t = useT(M);
  const providers = catalog.providers.filter((p) => (p.label + " " + p.id).toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      {!providers.length ? <div><p>{t("noMatch")}</p><button className="btn" type="button" onClick={clearSearch}>{t("clearSearch")}</button></div> : null}
      {(["direct", "aggregator"] as const).map((route) => {
        const group = providers.filter((provider) => provider.route === route);
        return group.length ? (
          <section className="key-group" key={route}>
            <h2>{t(route === "direct" ? "direct" : "aggregators")}</h2>
            {group.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                status={statuses.find((s) => s.keyVocabulary === provider.keyVocabulary)}
                models={catalog.models.filter((m) => m.routes.some((r) => r.providerId === provider.id))}
                focused={focus === provider.keyVocabulary}
              />
            ))}
          </section>
        ) : null;
      })}
    </>
  );
}

function KeysError({ error, retry }: { error: string; retry: () => void }) {
  const t = useT(M);
  return (
    <main className="page-pad">
      <h1>{t("title")}</h1>
      <div role="alert">
        {t("loadError", { error })}{" "}
        <button className="btn" onClick={retry}>
          {t("retry")}
        </button>
      </div>
    </main>
  );
}

export function KeysPage({ focus }: { focus?: string }) {
  const t = useT(M);
  const studio = useStudioApi();
  const catalog = useStudio((s) => s.catalog);
  const catalogError = useStudio((s) => s.catalogError);
  const storeKeys = useStudio((s) => s.keys);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const { initialKeys, error } = useInitialKeys(retry);
  if (catalogError || error)
    return (
      <KeysError
        error={catalogError ?? error}
        retry={() => {
          void studio.refreshCatalog();
          setRetry((v) => v + 1);
        }}
      />
    );
  if (!catalog || !initialKeys)
    return (
      <main className="page-pad">
        <h1>{t("title")}</h1>
        <p role="status">{t("loading")}</p>
      </main>
    );
  return (
    <main className="page-pad keys-page">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        <label>
          {t("search")}{" "}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </header>
      <ProviderGroups
        catalog={catalog}
        statuses={storeKeys.length ? storeKeys : initialKeys}
        query={query}
        focus={focus}
        clearSearch={() => setQuery("")}
      />
    </main>
  );
}
