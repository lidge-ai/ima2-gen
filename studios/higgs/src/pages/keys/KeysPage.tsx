import { useEffect, useState } from "react";
import type { KeyStatus } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { ProviderRow } from "./ProviderRow.tsx";
import "../../styles/keys.css";

export function KeysPage({ focus }: { focus?: string }) {
  const studio = useStudioApi();
  const catalog = useStudio((s) => s.catalog);
  const catalogError = useStudio((s) => s.catalogError);
  const storeKeys = useStudio((s) => s.keys);
  const [initialKeys, setInitialKeys] = useState<readonly KeyStatus[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
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
  if (catalogError || error)
    return (
      <main className="page-pad">
        <h1>API keys</h1>
        <div role="alert">
          Could not load providers: {catalogError ?? error}{" "}
          <button
            className="btn"
            onClick={() => {
              void studio.refreshCatalog();
              setRetry((v) => v + 1);
            }}
          >
            Retry
          </button>
        </div>
      </main>
    );
  if (!catalog || !initialKeys)
    return (
      <main className="page-pad">
        <h1>API keys</h1>
        <p role="status">Loading providers</p>
      </main>
    );
  const statuses = storeKeys.length ? storeKeys : initialKeys;
  const providers = catalog.providers.filter((p) => (p.label + " " + p.id).toLowerCase().includes(query.toLowerCase()));
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
    </main>
  );
}
