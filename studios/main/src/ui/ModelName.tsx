import type { CatalogModel } from "@ima2/studio-kit";
import { useStudio } from "../studio/context.tsx";
import { VendorLogo, vendorDisplayName } from "./VendorLogo.tsx";

/** Catalog entry for a model id, if the catalog knows it. */
export function useCatalogModel(id: string | undefined): CatalogModel | undefined {
  return useStudio((s) => (id ? s.catalog?.models.find((m) => m.id === id) : undefined));
}

/** Maker logo and official model name for a model id; falls back to the id. */
export function ModelName({ id, size = 16 }: { id: string; size?: number }) {
  const model = useCatalogModel(id);
  const vendor = model?.vendor ?? id.split("/")[0] ?? id;
  return (
    <span className="model-name">
      <VendorLogo id={vendor} size={size} />
      <span className="model-name-text">{model?.label ?? id}</span>
    </span>
  );
}

/** Provider logo and name for a route id ("fal", "byteplus"). */
export function ProviderName({ id, size = 14 }: { id: string; size?: number }) {
  const label = useStudio((s) => s.catalog?.providers.find((p) => p.id === id)?.label);
  return (
    <span className="model-name">
      <VendorLogo id={id} size={size} />
      <span className="model-name-text">{label ?? vendorDisplayName(id)}</span>
    </span>
  );
}
