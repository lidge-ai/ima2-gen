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
}

export function fetchMediaCatalog(kind: "image" | "video") {
  return jsonFetch<{ models: MediaModel[]; adapters: unknown[] }>(`/api/media/catalog?kind=${kind}`);
}

export function logoUrl(logo: MediaLogo | null | undefined): string | undefined {
  // The light plate renders logos with brightness(0), so a file drawn for dark backgrounds works too.
  return logo?.urls.mark ?? logo?.urls.primary ?? logo?.urls.dark ?? logo?.urls.light;
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
