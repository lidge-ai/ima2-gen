import type { Provider } from "../types";
import type { ComfyLaneModel } from "./api-comfy";
import type { getImageModelOptionsForProvider } from "./imageModels";

type ImageOption = ReturnType<typeof getImageModelOptionsForProvider>[number];

export function api88PickerModels(
  provider: Provider, options: readonly ImageOption[], phase: string, rows?: readonly ComfyLaneModel[],
): ImageOption[] {
  return options.filter((option) => option.providerHint === undefined || option.providerHint === provider)
    .filter((option) => provider !== "88api" || phase !== "ready"
      || Boolean(rows?.some((entry) => entry.id === option.value)));
}

export function api88PickerItem(provider: Provider, option: ImageOption, rows?: readonly ComfyLaneModel[]) {
  const entry = rows?.find((model) => model.id === option.value);
  return { value: option.value, label: option.shortLabel,
    ...(provider === "88api" && entry?.executable === false
      ? { disabled: true, ...(entry.lockReason ? { title: entry.lockReason } : {}) } : {}) };
}
