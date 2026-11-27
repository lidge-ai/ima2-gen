import type { MediaPrice } from "../../lib/mediaCatalog";
import { formatUsd } from "../../lib/mediaFormat";
import type { ModelFacts } from "../../lib/mediaModelList";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "$0.05/s": a unit price with the short unit name of the current locale. */
export function unitPrice(price: MediaPrice, t: Translate): string {
  return t("mediaPicker.perUnit", { amount: formatUsd(price.usd), unit: t(`mediaPicker.unitShort.${price.unit}`) });
}

/** "from $0.05/s", or the plain statement that the provider publishes no price. */
export function fromPrice(price: MediaPrice | null, t: Translate): string {
  return price ? t("mediaPicker.from", { price: unitPrice(price, t) }) : t("mediaPicker.noPrice");
}

export function resolutionText(facts: ModelFacts): string | null {
  if (!facts.resolutions) return null;
  const { low, high } = facts.resolutions;
  return low === high ? low : `${low}–${high}`;
}

export function durationText(facts: ModelFacts, t: Translate): string | null {
  if (!facts.durations) return null;
  const { min, max } = facts.durations;
  return min === max ? t("mediaPicker.seconds", { n: min }) : t("mediaPicker.secondsRange", { min, max });
}

const QUALITY_NAMES: readonly string[] = ["auto", "very_low", "low", "medium", "high", "xhigh", "max"];

/** A quality tier in words where it is one of the common names; a provider's own tier name is shown as it is. */
export function qualityLabel(value: string, t: (key: string) => string): string {
  const name = value.toLowerCase();
  return QUALITY_NAMES.includes(name) ? t(`mediaPicker.qualities.${name}`) : value;
}
