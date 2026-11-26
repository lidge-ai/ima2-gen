import type { CatalogModel } from "@ima2/studio-kit";
import { SettingTile, type TileOption } from "../../ui/SettingTile.tsx";
import { routePrice } from "../../ui/format.ts";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import type { CreateForm } from "./form.ts";

interface Props {
  model: CatalogModel;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
  variant?: "tile" | "chip";
}

const opts = <T extends string | number>(values: readonly T[] | undefined, label: (v: T) => string = String): TileOption<T>[] =>
  (values ?? []).map((value) => ({ value, label: label(value) }));

export function routeOptions(model: CatalogModel): TileOption<string>[] {
  return [
    { value: "", label: "Automatic", meta: "direct first, keyed only" },
    ...model.routes.map((route) => ({
      value: route.providerId,
      label: route.label,
      icon: <VendorLogo id={route.providerId} size={16} />,
      meta: (route.route === "direct" ? "direct" : "aggregator") + " · " + routePrice(route) + (route.keyConfigured ? "" : " · no key"),
    })),
  ];
}

/** Settings the selected model accepts. Options come from the catalog, never a fixed list. */
export function ParamControls({ model, form, set, variant = "tile" }: Props) {
  const p = model.params;
  return (
    <div className={variant === "tile" ? "tiles" : "chips-inline"}>
      {p.durationsSec?.length && form.durationSec !== undefined ? (
        <SettingTile variant={variant} icon={variant === "chip" ? "clock" : undefined} caption="Duration" value={form.durationSec} options={opts(p.durationsSec, (v) => v + "s")} onChange={(durationSec) => set({ durationSec })} />
      ) : null}
      {p.aspectRatios?.length && form.aspectRatio ? (
        <SettingTile variant={variant} icon={variant === "chip" ? "ratio" : undefined} caption="Aspect ratio" value={form.aspectRatio} options={opts(p.aspectRatios)} onChange={(aspectRatio) => set({ aspectRatio })} />
      ) : null}
      {p.resolutions?.length && form.resolution ? (
        <SettingTile variant={variant} icon={variant === "chip" ? "layers" : undefined} caption="Resolution" value={form.resolution} options={opts(p.resolutions)} onChange={(resolution) => set({ resolution })} />
      ) : null}
      {model.routes.length > 0 ? (
        <SettingTile variant={variant} caption="Run through" chipText={(label) => "via " + label} value={form.provider} options={routeOptions(model)} onChange={(provider) => set({ provider })} />
      ) : null}
    </div>
  );
}

export function AdvancedFields({ model, form, set }: Omit<Props, "variant">) {
  const p = model.params;
  if (!p.negativePrompt && !p.seed) return null;
  return (
    <details className="advanced">
      <summary>Advanced</summary>
      {p.negativePrompt ? (
        <label className="field">
          <span>Avoid</span>
          <input value={form.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} placeholder="What should not appear" />
        </label>
      ) : null}
      {p.seed ? (
        <label className="field">
          <span>Seed</span>
          <input inputMode="numeric" value={form.seed} onChange={(e) => set({ seed: e.target.value.replace(/\D/g, "") })} placeholder="Random" />
        </label>
      ) : null}
    </details>
  );
}
