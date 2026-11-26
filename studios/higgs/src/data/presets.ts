import { messages, tr } from "../i18n.ts";

/**
 * ima2's own starting points. A preset fills the prompt and settings; it never
 * hides what will be sent. Sample media under public/samples was made for ima2.
 */
export interface Preset {
  id: string;
  kind: "image" | "video";
  label: string;
  category: string;
  prompt: string;
  aspectRatio?: string;
  durationSec?: number;
  /** Preferred model when the catalog has it; the person can change it. */
  model?: string;
  sample: string;
  sampleKind: "image" | "video";
}

const M = messages(
  { slow: "Slow push in", orbit: "Orbit", crane: "Crane up", handheld: "Handheld follow", rain: "Neon rain", turn: "Product turntable", editorial: "Editorial portrait", room: "Isometric room", packshot: "Packshot", landscape: "Wide landscape", camera: "Camera", mood: "Mood", product: "Product", portrait: "Portrait", illustration: "Illustration", scene: "Scene" },
  { slow: "천천히 다가가기", orbit: "회전", crane: "크레인 상승", handheld: "핸드헬드 추적", rain: "네온 빗길", turn: "제품 회전", editorial: "에디토리얼 인물", room: "아이소메트릭 방", packshot: "제품 사진", landscape: "넓은 풍경", camera: "카메라", mood: "분위기", product: "제품", portrait: "인물", illustration: "일러스트", scene: "장면" },
);

export const PRESETS: readonly Preset[] = [
  {
    id: "slow-push",
    kind: "video",
    get label() { return tr(M, "slow"); },
    category: "Camera",
    prompt: "Slow dolly push toward the subject, shallow depth of field, steady framing",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/slow-push.mp4",
    sampleKind: "video",
  },
  {
    id: "orbit",
    kind: "video",
    get label() { return tr(M, "orbit"); },
    category: "Camera",
    prompt: "Camera orbits 90 degrees around the subject at eye level, smooth parallax",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/orbit.mp4",
    sampleKind: "video",
  },
  {
    id: "crane-up",
    kind: "video",
    get label() { return tr(M, "crane"); },
    category: "Camera",
    prompt: "Camera rises from ground level to a high wide view, revealing the scene",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/crane-up.mp4",
    sampleKind: "video",
  },
  {
    id: "handheld",
    kind: "video",
    get label() { return tr(M, "handheld"); },
    category: "Camera",
    prompt: "Handheld camera follows the subject from behind, natural sway",
    durationSec: 5,
    aspectRatio: "9:16",
    sample: "samples/handheld.mp4",
    sampleKind: "video",
  },
  {
    id: "rain-neon",
    kind: "video",
    get label() { return tr(M, "rain"); },
    category: "Mood",
    prompt: "Night street in light rain, neon reflections on wet asphalt, slow motion drops",
    durationSec: 5,
    aspectRatio: "16:9",
    sample: "samples/rain-neon.mp4",
    sampleKind: "video",
  },
  {
    id: "product-turn",
    kind: "video",
    get label() { return tr(M, "turn"); },
    category: "Product",
    prompt: "Product rotates slowly on a seamless studio backdrop, soft key light",
    durationSec: 5,
    aspectRatio: "1:1",
    sample: "samples/product-turn.mp4",
    sampleKind: "video",
  },
  {
    id: "editorial",
    kind: "image",
    get label() { return tr(M, "editorial"); },
    category: "Portrait",
    prompt: "Editorial portrait, window light, muted palette, 85mm lens, film grain",
    aspectRatio: "3:4",
    sample: "samples/editorial.jpg",
    sampleKind: "image",
  },
  {
    id: "isometric",
    kind: "image",
    get label() { return tr(M, "room"); },
    category: "Illustration",
    prompt: "Isometric cutaway of a tiny studio apartment, clean soft shading, pastel palette",
    aspectRatio: "1:1",
    sample: "samples/isometric.jpg",
    sampleKind: "image",
  },
  {
    id: "packshot",
    kind: "image",
    get label() { return tr(M, "packshot"); },
    category: "Product",
    prompt: "Minimal product packshot on colored paper, hard shadow, top light",
    aspectRatio: "4:5",
    sample: "samples/packshot.jpg",
    sampleKind: "image",
  },
  {
    id: "landscape",
    kind: "image",
    get label() { return tr(M, "landscape"); },
    category: "Scene",
    prompt: "Wide landscape at blue hour, layered mountains, low fog, cinematic",
    aspectRatio: "16:9",
    sample: "samples/landscape.jpg",
    sampleKind: "image",
  },
];

export function presetsFor(kind: "image" | "video"): readonly Preset[] {
  return PRESETS.filter((preset) => preset.kind === kind);
}

export function findPreset(id: string | undefined): Preset | undefined {
  return id ? PRESETS.find((preset) => preset.id === id) : undefined;
}
