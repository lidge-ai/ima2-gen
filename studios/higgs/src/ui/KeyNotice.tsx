import type { CatalogProvider, CatalogRoute } from "@ima2/studio-kit";
import { href } from "../router.ts";
import { Icon } from "./Icon.tsx";
import { VendorLogo } from "./VendorLogo.tsx";

interface Props {
  routes: readonly CatalogRoute[];
  providers: readonly CatalogProvider[];
}

/** Shown instead of running when no candidate route has a key. Nothing is sent without one. */
export function KeyNotice({ routes, providers }: Props) {
  const rows = routes.map((route) => ({ route, provider: providers.find((p) => p.id === route.providerId) }));
  return (
    <div className="notice" role="status">
      <Icon name="key" />
      <div>
        <p className="notice-title">Add an API key to run this model</p>
        <p className="notice-body">
          ima2 calls each provider with your own key and their published price. Any one of these works:
        </p>
        <ul className="notice-list">
          {rows.map(({ route, provider }) => (
            <li key={route.providerId}>
              <VendorLogo id={route.providerId} size={16} />
              <a href={href("keys", { focus: provider?.keyVocabulary ?? route.providerId })}>{route.label}</a>
              {provider ? (
                <a className="muted-link" href={provider.consoleUrl} target="_blank" rel="noreferrer">
                  get a key <Icon name="external" size={12} />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
