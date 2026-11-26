import { getLocale, messages, tr } from "../../i18n.ts";

const M = messages(
  {
    motion: "", swap: "", restyle: "", studio: "", cinema: "", cast: "", locations: "",
    motionDescription: "", swapDescription: "", restyleDescription: "", subscriptionDescription: "", restyleSubscriptionDescription: "",
    studioDescription: "", cinemaDescription: "", castDescription: "", locationsDescription: "",
    video: "", images: "", styleImage: "", prompt: "", scene: "", look: "", target: "", characterImage: "", videos: "", audios: "",
    directorPrompt: "", sceneImage: "", count: "", duration: "", generateAudio: "", continuity: "", anchors: "", resolution: "", sound: "", tier: "", style: "", aspectRatio: "", camera: "", lens: "", palette: "", paletteColors: "",
  },
  {
    motion: "ë¦¬ë¯¹ì¤: 동작 따라하기", swap: "ë¦¬ë¯¹ì¤: 사물 바꾸기", restyle: "ë¦¬ë¯¹ì¤: 스타일 바꾸기", studio: "ëë í° 스튜디오", cinema: "ëë í° 시네마", cast: "ëë í° 인물", locations: "ëë í° 장소",
    motionDescription: "4~15초 영상의 동작을 피사체에 적용해요. 카메라, 타이밍과 소리는 원본을 따라가요.",
    swapDescription: "4~15초 영상에서 선택한 사람이나 사물을 바꾸고 나머지는 유지해요.",
    restyleDescription: "4~15초 영상의 동작과 소리를 유지하며 스타일을 바꿔요.",
    subscriptionDescription: "GPT로 원본의 고정 프레임에 피사체를 넣고 Grok 1.5로 그 사이 영상을 만들어요.",
    restyleSubscriptionDescription: "Grok으로 4~15초 영상을 최대 8.7초씩 나눠 스타일을 바꾸고 원본 소리를 더해요.",
    studioDescription: "프롬프트와 이미지, 영상, 오디오 레퍼런스로 장면과 소리를 갖춘 4~30초 영상을 만들어요.",
    cinemaDescription: "영화 같은 스틸 이미지를 만들어요.", castDescription: "일관된 인물 레퍼런스 시트를 만들어요.", locationsDescription: "영화 같은 장소 이미지를 만들어요.",
    video: "원본 영상", images: "레퍼런스 이미지", styleImage: "스타일 레퍼런스", prompt: "메모", scene: "장면", look: "스타일 설명", target: "바꿀 대상", characterImage: "인물 레퍼런스", videos: "레퍼런스 영상", audios: "레퍼런스 오디오",
    directorPrompt: "프롬프트", sceneImage: "장면 레퍼런스", count: "개수", duration: "길이(초)", generateAudio: "소리", continuity: "장면 연결", anchors: "고정 키프레임", resolution: "해상도", sound: "소리", tier: "품질", style: "스타일", aspectRatio: "화면 비율", camera: "카메라", lens: "렌즈", palette: "색상 팔레트", paletteColors: "사용자 팔레트",
  },
);
type Key = keyof typeof M.en;
const workflowKeys: Record<string, [Key, Key]> = {
  "remix-motion-transfer": ["motion", "motionDescription"], "remix-object-swap": ["swap", "swapDescription"],
  "remix-restyle": ["restyle", "restyleDescription"], "director-studio": ["studio", "studioDescription"],
  "director-cinema": ["cinema", "cinemaDescription"], "director-cast": ["cast", "castDescription"],
  "director-locations": ["locations", "locationsDescription"],
};
const fields: Record<string, Key> = { video: "video", images: "images", styleImage: "styleImage", prompt: "prompt", target: "target", characterImage: "characterImage", videos: "videos", audios: "audios", duration: "duration", generateAudio: "generateAudio", continuity: "continuity", anchors: "anchors", resolution: "resolution", sound: "sound", tier: "tier", style: "style", aspectRatio: "aspectRatio", camera: "camera", lens: "lens", palette: "palette", paletteColors: "paletteColors", n: "count" };

export function workflowText(id: string, kind: "label" | "description", fallback: string): string {
  const base = id.replace(/-subscription$/, "");
  const pair = workflowKeys[base];
  if (getLocale() !== "ko" || !pair) return fallback;
  const key = kind === "label" ? pair[0] : id.endsWith("-subscription") ? (base === "remix-restyle" ? "restyleSubscriptionDescription" : "subscriptionDescription") : pair[1];
  return tr(M, key) + (kind === "label" && id.endsWith("-subscription") ? " (구독)" : "");
}

export function fieldLabel(id: string, name: string, fallback: string): string {
  const base = id.replace(/-subscription$/, "");
  if (getLocale() !== "ko" || !workflowKeys[base]) return fallback;
  const key = name === "prompt" && base === "director-studio" ? "scene" : name === "prompt" && base.startsWith("director-") ? "directorPrompt" : name === "prompt" && id === "remix-restyle-subscription" ? "look" : name === "images" && base === "director-cinema" ? "sceneImage" : fields[name];
  return key ? tr(M, key) : fallback;
}
