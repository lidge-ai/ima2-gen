import { messages, tr } from "../../i18n.ts";
import { modelHasKey, type CatalogModel, type MediaKind, type MediaTask } from "@ima2/studio-kit";

/** First model of this kind that can run now, else the first one listed. */
export function defaultModel(
  models: readonly CatalogModel[],
  kind: MediaKind,
  tasks?: readonly MediaTask[],
): CatalogModel | undefined {
  const fits = models.filter((m) => m.kind === kind && (!tasks || m.tasks.some((t) => tasks.includes(t))));
  return fits.find(modelHasKey) ?? fits[0];
}

const PRESET_LABELS = messages(
  {
    "slow-push": "Slow push in", orbit: "Orbit", "crane-up": "Crane up", handheld: "Handheld follow",
    "rain-neon": "Neon rain", "product-turn": "Product turntable", editorial: "Editorial portrait",
    isometric: "Isometric room", packshot: "Packshot", landscape: "Wide landscape",
    Camera: "Camera", Mood: "Mood", Product: "Product", Portrait: "Portrait", Illustration: "Illustration", Scene: "Scene",
  },
  {
    "slow-push": "천천히 다가가기", orbit: "회전", "crane-up": "크레인 상승", handheld: "핸드헬드 추적",
    "rain-neon": "네온과 비", "product-turn": "제품 회전", editorial: "에디토리얼 인물 사진",
    isometric: "아이소메트릭 방", packshot: "제품 사진", landscape: "넓은 풍경",
    Camera: "카메라", Mood: "분위기", Product: "제품", Portrait: "인물", Illustration: "일러스트", Scene: "풍경",
  },
);

export function presetText(key: string, fallback: string): string {
  return key in PRESET_LABELS.en ? tr(PRESET_LABELS, key as keyof typeof PRESET_LABELS.en) : fallback;
}
