/**
 * Korean step labels for plans, estimates and runs (steps[].i18n.ko.label). Step labels are built
 * from a few fixed phrases plus numbers and frame names ("Shot 2", "Take key frame 1"), so they are
 * matched here by pattern; fixed labels fall back to the definition dictionary (KO).
 * tests/workflow-i18n.test.ts plans every workflow and fails on any step without Korean.
 */
import { KO } from "./ko.js";

const STEPS: Readonly<Record<string, string>> = {
  "Render": "렌더링",
  "Render the clip": "영상 만들기",
  "Plan the shots": "샷 계획",
  "Join the shots": "샷 잇기",
  "Make the sound bed": "배경 사운드 만들기",
  "Lay the sound under the picture": "영상에 사운드 입히기",
  "Put the source sound back": "원본 소리 다시 넣기",
  "Regenerate the clip between the pinned frames": "고정 프레임 사이 영상 다시 만들기",
  "Regenerate between pinned frames": "고정 프레임 사이 다시 만들기",
  "Render with the source as motion reference": "원본 움직임을 참조해 렌더링",
  "Join the segments": "구간 잇기",
  "Find shot cuts": "컷 전환 찾기",
  "Describe the source shot": "원본 장면 설명",
  "Mask the target (first frame)": "대상 마스크 (첫 프레임)",
};

const FRAMES: Readonly<Record<string, string>> = {
  "the first frame": "첫 프레임",
  "the middle frame": "가운데 프레임",
  "the last frame": "마지막 프레임",
};

/** "the first frame" / "key frame 2" (definitions/shared.ts frameLabel) in Korean. */
function frameKo(en: string | undefined): string | undefined {
  const key = /^key frame (\d+)$/.exec(en ?? "");
  return key ? "키 프레임 " + key[1] : FRAMES[en ?? ""];
}

const withFrame = (ko: string | undefined, suffix: string) => (ko ? ko + suffix : undefined);

const PATTERNS: readonly (readonly [RegExp, (m: RegExpExecArray) => string | undefined])[] = [
  [/^Shot (\d+)$/, (m) => "샷 " + m[1]],
  [/^Take the last frame of shot (\d+)$/, (m) => "샷 " + m[1] + "의 마지막 프레임 가져오기"],
  [/^Cut segment (\d+)$/, (m) => "구간 " + m[1] + " 자르기"],
  [/^Restyle segment (\d+)$/, (m) => "구간 " + m[1] + " 스타일 바꾸기"],
  [/^Take (.+)$/, (m) => withFrame(frameKo(m[1]), " 가져오기")],
  [/^Prepare (.+)$/, (m) => withFrame(frameKo(m[1]), " 준비")],
  [/^Put the subject into (.+)$/, (m) => withFrame(frameKo(m[1]), "에 대상 넣기")],
];

/** The Korean label for a step label, or undefined when there is none (the client shows English). */
export function stepLabelKo(label: string): string | undefined {
  const fixed = STEPS[label] ?? KO[label];
  if (fixed) return fixed;
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(label);
    const ko = match ? build(match) : undefined;
    if (ko) return ko;
  }
  return undefined;
}
