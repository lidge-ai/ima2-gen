import {
  estimateCost,
  formatUsd,
  type CatalogModel,
  type CatalogRoute,
  type MediaPrice,
  type MediaTask,
} from "@ima2/studio-kit";
import { getLocale, messages, tr } from "../i18n.ts";

const TASKS = messages<MediaTask>(
  {
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
    "image-vectorize": "Vectorize",
    "image-segment": "Segment",
    dubbing: "Dubbing",
    subtitles: "Subtitles",
  },
  {
    "text-to-image": "텍스트로 이미지",
    "image-to-image": "편집",
    "image-upscale": "업스케일",
    "text-to-video": "텍스트로 영상",
    "image-to-video": "이미지로 영상",
    "reference-to-video": "레퍼런스",
    "video-to-video": "영상으로 영상",
    "video-extend": "늘리기",
    "video-upscale": "업스케일",
    lipsync: "립싱크",
    avatar: "아바타",
    "text-to-audio": "오디오",
    "video-to-audio": "영상 사운드",
    "image-vectorize": "벡터화",
    "image-segment": "분할",
    dubbing: "더빙",
    subtitles: "자막",
  },
);

const M = messages(
  {
    from: "from {price}",
    none: "No published price",
    justNow: "just now",
    min: "{n} min ago",
    hour: "{n} h ago",
    day: "{n} d ago",
    second: "s",
    image: "image",
    request: "request",
    megapixel: "MP",
    "1k-tokens": "1K tokens",
    minute: "min",
    character: "char",
  },
  {
    from: "{price}부터",
    none: "공개 가격 없음",
    justNow: "방금",
    min: "{n}분 전",
    hour: "{n}시간 전",
    day: "{n}일 전",
    second: "초",
    image: "장",
    request: "요청",
    megapixel: "MP",
    "1k-tokens": "1천 토큰",
    minute: "분",
    character: "자",
  },
);

export function taskLabel(task: MediaTask): string {
  return TASKS[getLocale()][task] ?? task;
}

function perUnit(price: MediaPrice): string {
  const units = ["second", "image", "request", "megapixel", "1k-tokens", "minute", "character"] as const;
  const unit = (units as readonly string[]).includes(price.unit) ? tr(M, price.unit as (typeof units)[number]) : price.unit;
  return formatUsd({ usd: price.usd, basis: "" }) + "/" + unit;
}

/** "from $0.05/s" across every route, or null when nothing is published. */
export function fromPrice(routes: readonly CatalogRoute[]): string | null {
  const prices = routes.flatMap((route) => route.pricing);
  if (prices.length === 0) return null;
  const cheapest = prices.reduce((min, price) => (price.usd < min.usd ? price : min));
  return tr(M, "from", { price: perUnit(cheapest) });
}

export function routePrice(route: CatalogRoute): string {
  if (route.pricing.length === 0) return tr(M, "none");
  const cheapest = route.pricing.reduce((min, price) => (price.usd < min.usd ? price : min));
  return route.pricing.length > 1 ? tr(M, "from", { price: perUnit(cheapest) }) : perUnit(cheapest);
}

export function estimateLabel(
  route: CatalogRoute | undefined,
  request: Parameters<typeof estimateCost>[1],
): { text: string; title: string } {
  if (!route) return { text: "-", title: "" };
  const estimate = estimateCost(route.pricing, request);
  return { text: formatUsd(estimate), title: estimate.basis };
}

export function modelKinds(model: CatalogModel): string {
  return modelKindList(model).join(" · ");
}

/** Up to three distinct task labels, for places that lay each one out on its own. */
export function modelKindList(model: CatalogModel): string[] {
  return model.tasks
    .map(taskLabel)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return tr(M, "justNow");
  if (seconds < 3600) return tr(M, "min", { n: Math.round(seconds / 60) });
  if (seconds < 86_400) return tr(M, "hour", { n: Math.round(seconds / 3600) });
  return tr(M, "day", { n: Math.round(seconds / 86_400) });
}

export function vendorLabel(vendor: string): string {
  return vendor
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
