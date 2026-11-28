import { messages, tr, useT } from "../../i18n.ts";
import { resolutionParts, type CatalogModel } from "@ima2/studio-kit";
import { SettingTile, type TileOption } from "../../ui/SettingTile.tsx";
import { routeName, routePrice } from "../../ui/format.ts";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import type { CreateForm } from "./form.ts";

const M = messages(
  {
    "automatic": "Automatic",
    "directFirst": "direct first, keyed only",
    "direct": "direct",
    "aggregator": "aggregator",
    "local": "this computer, no provider charge",
    "noKey": "no key",
    "duration": "Duration",
    "aspect": "Aspect ratio",
    "resolution": "Resolution",
    "route": "Route",
    "via": "Route: {label}",
    "advanced": "Advanced",
    "avoid": "Avoid",
    "avoidPlaceholder": "What should not appear",
    "seed": "Seed",
    "random": "Random",
    "upscaled": "upscaled",
    "enhanced": "enhanced upscale",
  },
  {
    "automatic": "자동",
    "directFirst": "키가 있는 직접 연결 우선",
    "direct": "직접 연결",
    "aggregator": "중개 서비스",
    "local": "이 컴퓨터에서 실행, 요금 없음",
    "noKey": "키 없음",
    "duration": "길이",
    "aspect": "화면 비율",
    "resolution": "해상도",
    "route": "경로",
    "via": "경로: {label}",
    "advanced": "고급 설정",
    "avoid": "제외할 내용",
    "avoidPlaceholder": "이미지에 나타나지 않을 내용",
    "seed": "시드",
    "random": "무작위",
    "upscaled": "업스케일",
    "enhanced": "고급 업스케일",
  },
);

interface Props {
  model: CatalogModel;
  form: CreateForm;
  set: (patch: Partial<CreateForm>) => void;
  variant?: "tile" | "chip";
}

const opts = <T extends string | number>(
  values: readonly T[] | undefined,
  label: (v: T) => string = String,
): TileOption<T>[] => (values ?? []).map((value) => ({ value, label: label(value) }));

/** "1024x1024" (a ComfyUI workflow's size) reads "1024 × 1024". */
function pixelSize(value: string): string | null {
  const sides = value.toLowerCase().split("x").map((side) => side.trim());
  return sides.length === 2 && sides.every((side) => /^\d+$/.test(side)) ? sides.join(" × ") : null;
}

/** "1080p-esr & 60fps" reads "1080p · enhanced upscale · 60 fps"; "1k" reads "1K". */
export function resolutionLabel(value: string): string {
  const parts = resolutionParts(value);
  if (!parts) return pixelSize(value) ?? value;
  const tier = parts.tier ? tr(M, parts.tier === "esr" ? "enhanced" : "upscaled") : "";
  return [parts.base, tier, parts.fps ? parts.fps + " fps" : ""].filter(Boolean).join(" · ");
}

export function routeOptions(model: CatalogModel): TileOption<string>[] {
  return [
    { value: "", label: tr(M, "automatic"), meta: tr(M, "directFirst") },
    ...model.routes.map((route) => ({
      value: route.providerId,
      label: routeName(route),
      icon: <VendorLogo id={route.providerId} size={16} />,
      // A local route has no price and no key: it says where it runs instead.
      meta: route.route === "local"
        ? tr(M, "local")
        : (tr(M, route.route === "direct" ? "direct" : "aggregator")) +
          " · " +
          routePrice(route) +
          (route.keyConfigured ? "" : " · " + tr(M, "noKey")),
    })),
  ];
}

/** The route chip's text, the same words as its accessible name ("Route: fal"). */
export const routeChipText = (label: string): string => tr(M, "via", { label });

/** Settings the selected model accepts. Options come from the catalog, never a fixed list. */
export function ParamControls({ model, form, set, variant = "tile" }: Props) {
  const t = useT(M);
  const p = model.params;
  return (
    <div className={variant === "tile" ? "tiles" : "chips-inline"}>
      {p.durationsSec?.length && form.durationSec !== undefined ? (
        <SettingTile
          variant={variant}
          icon={variant === "chip" ? "clock" : undefined}
          caption={t("duration")}
          value={form.durationSec}
          options={opts(p.durationsSec, (v) => v + "s")}
          onChange={(durationSec) => set({ durationSec })}
        />
      ) : null}
      {p.aspectRatios?.length && form.aspectRatio ? (
        <SettingTile
          variant={variant}
          icon={variant === "chip" ? "ratio" : undefined}
          caption={t("aspect")}
          value={form.aspectRatio}
          options={opts(p.aspectRatios)}
          onChange={(aspectRatio) => set({ aspectRatio })}
        />
      ) : null}
      {p.resolutions?.length && form.resolution ? (
        <SettingTile
          variant={variant}
          icon={variant === "chip" ? "layers" : undefined}
          caption={t("resolution")}
          value={form.resolution}
          options={opts(p.resolutions, resolutionLabel)}
          onChange={(resolution) => set({ resolution })}
        />
      ) : null}
      {model.routes.length > 0 ? (
        <SettingTile
          variant={variant}
          caption={t("route")}
          chipText={(label) => t("via", { label })}
          value={form.provider}
          options={routeOptions(model)}
          onChange={(provider) => set({ provider })}
        />
      ) : null}
    </div>
  );
}

export function AdvancedFields({ model, form, set }: Omit<Props, "variant">) {
  const t = useT(M);
  const p = model.params;
  if (!p.negativePrompt && !p.seed) return null;
  return (
    <details className="advanced">
      <summary>{t("advanced")}</summary>
      {p.negativePrompt ? (
        <label className="field">
          <span>{t("avoid")}</span>
          <input
            value={form.negativePrompt}
            onChange={(e) => set({ negativePrompt: e.target.value })}
            placeholder={t("avoidPlaceholder")}
          />
        </label>
      ) : null}
      {p.seed ? (
        <label className="field">
          <span>{t("seed")}</span>
          <input
            inputMode="numeric"
            value={form.seed}
            onChange={(e) => set({ seed: e.target.value.replace(/\D/g, "") })}
            placeholder={t("random")}
          />
        </label>
      ) : null}
    </details>
  );
}
