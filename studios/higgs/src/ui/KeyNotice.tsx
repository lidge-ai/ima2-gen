import { messages, useT } from "../i18n.ts";
import type { CatalogProvider, CatalogRoute } from "@ima2/studio-kit";
import { href } from "../router.ts";
import { Icon } from "./Icon.tsx";
import { VendorLogo } from "./VendorLogo.tsx";

const M = messages({ title: "Add an API key to run this model", body: "ima2 calls each provider with your own key and their published price. Any one of these works:", get: "get a key" },
  { title: "이 모델을 실행하려면 API 키를 추가하세요", body: "ima2는 내 키를 사용하고 제공업체의 가격을 적용해요. 아래 키 중 하나를 추가하세요.", get: "키 발급" });

interface Props {
  routes: readonly CatalogRoute[];
  providers: readonly CatalogProvider[];
}

/** Shown instead of running when no candidate route has a key. Nothing is sent without one. */
export function KeyNotice({ routes, providers }: Props) {
  const t = useT(M);
  const rows = routes.map((route) => ({ route, provider: providers.find((p) => p.id === route.providerId) }));
  return (
    <div className="notice" role="status">
      <Icon name="key" />
      <div>
        <p className="notice-title">{t("title")}</p>
        <p className="notice-body">
          {t("body")}
        </p>
        <ul className="notice-list">
          {rows.map(({ route, provider }) => (
            <li key={route.providerId}>
              <VendorLogo id={route.providerId} size={16} />
              <a href={href("keys", { focus: provider?.keyVocabulary ?? route.providerId })}>{route.label}</a>
              {provider ? (
                <a className="muted-link" href={provider.consoleUrl} target="_blank" rel="noreferrer">
                  {t("get")} <Icon name="external" size={12} />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
