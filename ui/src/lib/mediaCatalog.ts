import { jsonFetch } from "./api-core";

export interface MediaLogo {
  id: string;
  name: string;
  urls: { primary?: string; dark?: string; light?: string; mark?: string };
  source: string | null;
}

export interface MediaPrice {
  unit: string;
  usd: number;
  variant?: string;
  source: string;
  checkedAt: string;
}

export interface MediaParams {
  durationsSec?: readonly number[];
  resolutions?: readonly string[];
  aspectRatios?: readonly string[];
  /** Quality tiers this route prices separately, in the provider's spelling. */
  qualities?: readonly string[];
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  nativeAudio?: boolean;
  negativePrompt?: boolean;
  seed?: boolean;
}

export interface MediaRoute {
  adapter: string;
  route: "direct" | "aggregator";
  label: string;
  logo: MediaLogo | null;
  upstreamId: string;
  tasks: readonly string[];
  params: MediaParams;
  pricing: readonly MediaPrice[];
  docsUrl: string;
  hasKey: boolean;
}

export interface MediaModel {
  id: string;
  label: string;
  vendor: string;
  logo: MediaLogo | null;
  kind: "image" | "video" | "audio";
  tasks: readonly string[];
  routes: readonly MediaRoute[];
  defaultRoute: string | null;
  /** The provider is retiring this model; only the model window says so. */
  retiring?: boolean;
}

/** A provider lane as the catalog lists it; never contains a key value. */
export interface MediaAdapter {
  id: string;
  label: string;
  route: "direct" | "aggregator";
  logo: MediaLogo | null;
  keyVocabulary: string;
  consoleUrl: string;
  keyPrefix: string | null;
  hasKey: boolean;
  keySource?: string;
  maskedKey?: string | null;
  extraFields: { name: string; secret: boolean; required: boolean; configured?: boolean; source?: string; value?: string | null }[];
}

const RETIRING: readonly string[] = ["deprecated", "legacy", "retiring"];

/**
 * Catalog labels mark a model being retired with a suffix ("GPT Image 2 (deprecated)"). The name is shown
 * clean everywhere; the model window reads the flag and shows its own badge (studios/kit does the same).
 */
export function modelName(label: string): { label: string; retiring: boolean } {
  const text = label.trimEnd();
  const open = text.lastIndexOf("(");
  if (!text.endsWith(")") || open <= 0) return { label, retiring: false };
  const name = text.slice(0, open).trimEnd();
  return RETIRING.includes(text.slice(open + 1, -1).trim().toLowerCase()) && name ? { label: name, retiring: true } : { label, retiring: false };
}

/** Catalog models with clean names; a model that is not retiring carries no flag. */
export function namedModels(models: readonly MediaModel[]): MediaModel[] {
  return models.map((model) => { const name = modelName(model.label); return name.retiring ? { ...model, label: name.label, retiring: true } : model; });
}

export function fetchMediaCatalog(kind: "image" | "video") {
  return jsonFetch<{ models: MediaModel[]; adapters: unknown[] }>(`/api/media/catalog?kind=${kind}`);
}

export function logoUrl(logo: MediaLogo | null | undefined): string | undefined {
  return logo?.urls.mark ?? logo?.urls.primary ?? logo?.urls.dark ?? logo?.urls.light;
}

/**
 * Plate behind the file logoUrl picks. Files are shown unaltered (no recolouring), so a
 * file drawn in white ink for dark backgrounds gets a dark plate and every other file a light one.
 */
export function logoPlate(logo: MediaLogo | null | undefined): "light" | "dark" {
  const url = logoUrl(logo);
  return url !== undefined && url === logo?.urls.dark ? "dark" : "light";
}

export function formatMediaPrice(price: MediaPrice): string {
  return `$${price.usd} / ${price.unit}${price.variant ? ` · ${price.variant}` : ""}`;
}

export function chooseMediaRoute(model: MediaModel, adapter?: string | null): MediaRoute | undefined {
  return model.routes.find((route) => route.adapter === (adapter ?? model.defaultRoute));
}

export function allowedMediaValue<T>(value: T | undefined, allowed: readonly T[] | undefined): T | undefined {
  return value !== undefined && allowed?.includes(value) ? value : undefined;
}
