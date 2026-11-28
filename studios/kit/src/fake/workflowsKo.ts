import type { WorkflowText } from "../types.ts";
import type { WireWorkflow } from "../wire.ts";

/**
 * Korean text the fake server sends as i18n.ko on GET /api/workflows, the way the real server does
 * (lib/workflows/i18n). It only covers what the fake workflows show; clients fall back to English.
 */
const LABELS: Record<string, [string, string]> = {
  "remix-motion-transfer": ["리믹스: 동작 따라하기", "4~15초 영상의 동작을 피사체에 적용해요. 카메라, 타이밍과 소리는 원본을 따라가요."],
  "remix-object-swap": ["리믹스: 사물 바꾸기", "4~15초 영상에서 선택한 사람이나 사물을 바꾸고 나머지는 유지해요."],
  "remix-restyle": ["리믹스: 스타일 바꾸기", "4~15초 영상의 동작과 소리를 유지하며 스타일을 바꿔요."],
  "remix-motion-transfer-subscription": ["리믹스: 동작 따라하기 (구독)", "GPT로 원본의 고정 프레임에 피사체를 넣고 Grok 1.5로 그 사이 영상을 만들어요."],
  "remix-object-swap-subscription": ["리믹스: 사물 바꾸기 (구독)", "GPT로 원본의 고정 프레임에 피사체를 넣고 Grok 1.5로 그 사이 영상을 만들어요."],
  "remix-restyle-subscription": ["리믹스: 스타일 바꾸기 (구독)", "Grok으로 4~15초 영상을 최대 8.7초씩 나눠 스타일을 바꾸고 원본 소리를 더해요."],
  "remix-motion-transfer-open": ["리믹스: 동작 따라하기 (단계별)", "첫 프레임을 먼저 만들고 영상을 렌더해요."],
  "remix-object-swap-open": ["리믹스: 사물 바꾸기 (단계별)", "첫 프레임을 먼저 만들고 영상을 렌더해요."],
  "remix-restyle-open": ["리믹스: 스타일 바꾸기 (단계별)", "첫 프레임을 먼저 만들고 영상을 렌더해요."],
  "director-studio": ["디렉터 스튜디오", "프롬프트 하나나 직접 짠 컷 목록으로 영상을 연출해요. 4~30초를 샷으로 나눠 계획하거나, 직접 정한 2~6개 샷을 최대 60초까지 만들어요."],
  "director-cinema": ["디렉터 시네마", "영화 같은 스틸 이미지를 만들어요."],
  "director-cast": ["디렉터 인물", "일관된 인물 레퍼런스 시트를 만들어요."],
  "director-locations": ["디렉터 장소", "영화 같은 장소 이미지를 만들어요."],
};
const FIELDS: Record<string, string> = {
  video: "원본 영상", images: "레퍼런스 이미지", styleImage: "스타일 레퍼런스", target: "바꿀 대상", characterImage: "인물 레퍼런스",
  videos: "레퍼런스 영상", audios: "레퍼런스 오디오", sceneImage: "장면 레퍼런스", scene: "장면", duration: "길이(초)", shots: "컷 목록",
  generateAudio: "소리", continuity: "장면 연결", anchors: "고정 키프레임", resolution: "해상도", sound: "소리", tier: "품질",
  style: "스타일", aspectRatio: "화면 비율", camera: "카메라", lens: "렌즈", palette: "색상 팔레트", paletteColors: "사용자 팔레트", n: "개수",
};
const HELP: Record<string, string> = { images: "공연할 사람이나 사물 이미지 1~8장, 순서대로." };
const OPTIONS: Record<string, Record<string, string>> = {
  tier: { standard: "표준", lite: "라이트" },
  sound: { source: "원본 소리", generate: "새로 만들기", none: "없음" },
};
const SLOTS: Record<string, string> = {
  render: "영상 만들기", stylize: "첫 프레임 스타일 바꾸기", composite: "프레임에 피사체 넣기", edit: "구간별 스타일 바꾸기", image: "이미지", sound: "사운드",
};

const LOSSES: Record<string, string> = {
  "Motion is regenerated between pinned frames, so fine timing can drift.": "고정 프레임 사이를 다시 만들어서 세밀한 타이밍이 어긋날 수 있어요.",
  "720p at most; no 1080p.": "최대 720p, 1080p는 안 돼요.",
  "The style comes from text only; Grok's edit takes no style image.": "스타일은 글로만 정해요. Grok 편집은 스타일 이미지를 받지 않아요.",
};
const SLOT_TEXT: Record<string, string> = {
  subject: "원본의 첫 프레임에 내 대상을 넣어요.",
  stylize: "원본의 첫 프레임을 고른 스타일로 다시 그려요.",
  render: "다시 그린 첫 프레임을 따라 원본 영상을 새로 만들어요.",
};

export function koText(wire: WireWorkflow): WorkflowText {
  const [label, description] = LABELS[wire.id] ?? [undefined, undefined];
  const fields: Record<string, { label?: string; help?: string; options?: Record<string, string> }> = {};
  for (const field of wire.fields) {
    const name = field.name;
    const fieldLabel = name === "prompt" ? (wire.id === "director-studio" ? "장면" : wire.id.startsWith("director") ? "프롬프트" : field.label === "Look" ? "스타일 설명" : "메모") : FIELDS[name];
    const entry = { ...(fieldLabel ? { label: fieldLabel } : {}), ...(HELP[name] && wire.id.startsWith("remix-") ? { help: HELP[name] } : {}), ...(OPTIONS[name] ? { options: OPTIONS[name] } : {}) };
    if (Object.keys(entry).length) fields[name] = entry;
  }
  const slots = Object.fromEntries(wire.slots.filter((s) => SLOTS[s.name]).map((s) => [s.name, SLOTS[s.name]!]));
  const slotText = (name: string) => (name === "subject" && wire.id.includes("restyle") ? SLOT_TEXT.stylize : name === "render" && wire.id.endsWith("-open") ? "준비한 첫 프레임으로 영상을 렌더해요." : SLOT_TEXT[name]);
  const slotDescriptions = Object.fromEntries(wire.slots.filter((s) => s.description && slotText(s.name)).map((s) => [s.name, slotText(s.name)!]));
  const losses = wire.preset?.losses?.map((l) => LOSSES[l.detail ?? ""] ?? null);
  const preset = wire.preset ? { label: "구독만 (ChatGPT + Grok)", ...(losses?.some(Boolean) ? { losses } : {}) } : undefined;
  return { ...(label ? { label } : {}), ...(description ? { description } : {}), fields, slots, slotDescriptions, ...(preset ? { preset } : {}) };
}
