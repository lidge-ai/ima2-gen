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
}: {
  catalog: Catalog;
  statuses: readonly KeyStatus[];
  query: string;
  focus?: string;
}) {
  const providers = catalog.providers.filter((p) => (p.label + " " + p.id).toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      {!providers.length ? <p>No providers match your search.</p> : null}
      {(["direct", "aggregator"] as const).map((route) => {
        const group = providers.filter((provider) => provider.route === route);
        return group.length ? (
          <section className="key-group" key={route}>
            <h2>{route === "direct" ? "Direct from the model maker" : "Aggregators"}</h2>
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
  return (
    <main className="page-pad">
      <h1>API keys</h1>
      <div role="alert">
        Could not load providers: {error}{" "}
        <button className="btn" onClick={retry}>
          Retry
        </button>
      </div>
    </main>
  );
}

export function KeysPage({ focus }: { focus?: string }) {
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
        <h1>API keys</h1>
        <p role="status">Loading providers</p>
      </main>
    );
  return (
    <main className="page-pad keys-page">
      <header className="page-head">
        <div>
          <h1>API keys</h1>
          <p>Add keys to use models from your providers.</p>
        </div>
        <label>
          Search providers{" "}
          <input type="search" aria-label="Search providers" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </header>
      <ProviderGroups
        catalog={catalog}
        statuses={storeKeys.length ? storeKeys : initialKeys}
        query={query}
        focus={focus}
      />
    </main>
  );
}
