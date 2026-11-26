import { estimateCost, formatUsd, type CatalogModel, type CatalogRoute, type MediaPrice, type MediaTask } from "@ima2/studio-kit";

const TASK_SHORT: Partial<Record<MediaTask, string>> = {
  "text-to-image": "Text to image",
  "image-to-image": "Edit",
  "image-upscale": "Upscale",
  "text-to-video": "Text to video",
  "image-to-video": "Image to video",
  "reference-to-video": "References",
  "video-to-video": "Video to video",
  "video-extend": "Extend",
  "video-upscale": "Upscale",
  lipsync: "Lip sync",
  avatar: "Avatar",
  "text-to-audio": "Audio",
  "video-to-audio": "Sound for video",
};

export function taskLabel(task: MediaTask): string {
  return TASK_SHORT[task] ?? task;
}

function perUnit(price: MediaPrice): string {
  return formatUsd({ usd: price.usd, basis: "" }) + "/" + (price.unit === "second" ? "s" : price.unit);
}

/** "from $0.05/s" across every route, or null when nothing is published. */
export function fromPrice(routes: readonly CatalogRoute[]): string | null {
  const prices = routes.flatMap((route) => route.pricing);
  if (prices.length === 0) return null;
  const cheapest = prices.reduce((min, price) => (price.usd < min.usd ? price : min));
  return "from " + perUnit(cheapest);
}

export function routePrice(route: CatalogRoute): string {
  if (route.pricing.length === 0) return "No published price";
  const cheapest = route.pricing.reduce((min, price) => (price.usd < min.usd ? price : min));
  return (route.pricing.length > 1 ? "from " : "") + perUnit(cheapest);
}

export function estimateLabel(route: CatalogRoute | undefined, request: Parameters<typeof estimateCost>[1]): { text: string; title: string } {
  if (!route) return { text: "-", title: "" };
  const estimate = estimateCost(route.pricing, request);
  return { text: formatUsd(estimate), title: estimate.basis };
}

export function modelKinds(model: CatalogModel): string {
  return model.tasks.map(taskLabel).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(" · ");
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
  if (seconds < 86_400) return Math.round(seconds / 3600) + " h ago";
  return Math.round(seconds / 86_400) + " d ago";
}

export function vendorLabel(vendor: string): string {
  return vendor.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
