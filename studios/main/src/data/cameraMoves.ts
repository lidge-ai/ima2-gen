import { messages, tr } from "../i18n.ts";

/**
 * Camera moves as prompt wording, in ima2's own words. A move is a phrase that goes into the prompt being
 * written; it sets nothing else. How closely a model follows a phrase depends on the model.
 */
export interface CameraMove {
  id: string;
  group: MoveGroup;
  label: string;
  /** The English phrase inserted into the prompt. */
  phrase: string;
}

export const MOVE_GROUPS = ["push", "pan", "orbit", "crane", "follow", "focus"] as const;
export type MoveGroup = (typeof MOVE_GROUPS)[number];

const G = messages(
  { push: "Push and pull", pan: "Pan, tilt and roll", orbit: "Orbit and arc", crane: "Crane and drone", follow: "Follow and hold", focus: "Focus and zoom" },
  { push: "다가가기와 물러나기", pan: "패닝·틸트·롤", orbit: "돌기와 아크", crane: "크레인과 드론", follow: "따라가기와 고정", focus: "초점과 줌" },
);
export const moveGroupLabel = (group: MoveGroup) => tr(G, group);

const N = messages(
  { "push-in": "Push in", "pull-back": "Pull back", "dolly-zoom": "Dolly zoom", "fast-push": "Fast push in", "creep-in": "Slow creep", "pan-left": "Pan left", "pan-right": "Pan right", "tilt-up": "Tilt up", "tilt-down": "Tilt down", "whip-pan": "Whip pan", "roll": "Roll", "orbit-left": "Orbit left", "orbit-right": "Orbit right", "full-orbit": "Full orbit", "arc-low": "Low arc", "over-shoulder": "Over the shoulder", "crane-up": "Crane up", "crane-down": "Crane down", "drone-forward": "Drone flyover", "drone-rise": "Drone rise", "top-down": "Top-down", "fly-through": "Fly through", "track-behind": "Follow from behind", "track-side": "Side tracking", "lead-front": "Lead from the front", "handheld": "Handheld", "steadicam": "Steadicam glide", "locked-off": "Locked-off", "rack-focus": "Rack focus", "zoom-in": "Zoom in", "zoom-out": "Zoom out", "crash-zoom": "Crash zoom" },
  { "push-in": "다가가기", "pull-back": "물러나기", "dolly-zoom": "달리 줌", "fast-push": "빠르게 다가가기", "creep-in": "아주 천천히 다가가기", "pan-left": "왼쪽으로 패닝", "pan-right": "오른쪽으로 패닝", "tilt-up": "위로 틸트", "tilt-down": "아래로 틸트", "whip-pan": "휩 팬", "roll": "롤", "orbit-left": "왼쪽으로 돌기", "orbit-right": "오른쪽으로 돌기", "full-orbit": "한 바퀴 돌기", "arc-low": "낮은 아크", "over-shoulder": "어깨 너머", "crane-up": "크레인 상승", "crane-down": "크레인 하강", "drone-forward": "드론 전진", "drone-rise": "드론 상승", "top-down": "수직 부감", "fly-through": "통과 비행", "track-behind": "뒤에서 따라가기", "track-side": "옆에서 따라가기", "lead-front": "앞에서 이끌기", "handheld": "핸드헬드", "steadicam": "스테디캠", "locked-off": "고정 숏", "rack-focus": "초점 이동", "zoom-in": "줌 인", "zoom-out": "줌 아웃", "crash-zoom": "크래시 줌" },
);

const move = (group: MoveGroup, id: keyof typeof N.en, phrase: string): CameraMove => ({ id, group, phrase, get label() { return tr(N, id); } });

export const CAMERA_MOVES: readonly CameraMove[] = [
  move("push", "push-in", "The camera pushes in slowly toward the subject"),
  move("push", "pull-back", "The camera pulls back slowly, revealing more of the scene"),
  move("push", "dolly-zoom", "Dolly zoom: the camera moves back while zooming in, so the background stretches behind the subject"),
  move("push", "fast-push", "The camera rushes in fast toward the subject and stops close"),
  move("push", "creep-in", "A very slow, barely noticeable creep toward the subject"),
  move("pan", "pan-left", "The camera pans left at a steady speed"),
  move("pan", "pan-right", "The camera pans right at a steady speed"),
  move("pan", "tilt-up", "The camera tilts up from the ground to the subject's face"),
  move("pan", "tilt-down", "The camera tilts down from the sky to the subject"),
  move("pan", "whip-pan", "A fast whip pan with motion blur to a new subject"),
  move("pan", "roll", "The camera rolls slowly around its lens axis, tilting the horizon"),
  move("orbit", "orbit-left", "The camera orbits left around the subject at eye level, keeping it centered"),
  move("orbit", "orbit-right", "The camera orbits right around the subject at eye level, keeping it centered"),
  move("orbit", "full-orbit", "The camera makes a full 360-degree orbit around the subject"),
  move("orbit", "arc-low", "The camera arcs around the subject from a low angle, looking up"),
  move("orbit", "over-shoulder", "An over-the-shoulder shot that drifts slowly to one side"),
  move("crane", "crane-up", "The camera cranes up from ground level to a high wide view"),
  move("crane", "crane-down", "The camera cranes down from a high view to the subject's eye level"),
  move("crane", "drone-forward", "An aerial drone shot flying forward over the landscape"),
  move("crane", "drone-rise", "An aerial drone shot rising straight up, the subject getting smaller below"),
  move("crane", "top-down", "A top-down overhead shot looking straight down, drifting slowly"),
  move("crane", "fly-through", "The camera flies forward through an opening into the space beyond"),
  move("follow", "track-behind", "The camera follows the subject from behind at walking pace"),
  move("follow", "track-side", "The camera tracks alongside the subject, moving at the same speed"),
  move("follow", "lead-front", "The camera moves backward in front of the subject as they walk toward it"),
  move("follow", "handheld", "Handheld camera with natural sway and small corrections"),
  move("follow", "steadicam", "A smooth steadicam glide through the space, floating at chest height"),
  move("follow", "locked-off", "A locked-off static shot on a tripod, no camera movement"),
  move("focus", "rack-focus", "Rack focus from the foreground object to the subject in the background"),
  move("focus", "zoom-in", "A slow optical zoom in on the subject, the camera staying in place"),
  move("focus", "zoom-out", "A slow optical zoom out from the subject, the camera staying in place"),
  move("focus", "crash-zoom", "A sudden crash zoom onto the subject's face"),
];

export const findMove = (id: string | undefined): CameraMove | undefined => (id ? CAMERA_MOVES.find((entry) => entry.id === id) : undefined);

/** Moves whose name (in either language) or phrase contains the words typed. */
export function searchMoves(query: string): readonly CameraMove[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return CAMERA_MOVES;
  return CAMERA_MOVES.filter((entry) => [entry.label, N.en[entry.id as keyof typeof N.en], N.ko[entry.id as keyof typeof N.en], entry.phrase].some((text) => text.toLowerCase().includes(needle)));
}

/**
 * The prompt with a phrase put in at the caret (or over the selection), or at the end when there is no caret.
 * What was written stays; the phrase becomes its own sentence. Returns the text and where the caret goes after it.
 */
export function insertPhrase(text: string, phrase: string, start?: number | null, end?: number | null): { text: string; caret: number } {
  const from = start == null ? text.length : Math.max(0, Math.min(start, text.length));
  const to = end == null ? from : Math.max(from, Math.min(end, text.length));
  const before = text.slice(0, from).replace(/[ \t]+$/, "");
  const after = text.slice(to).replace(/^[ \t]+/, "");
  const lead = before === "" || /\n$/.test(before) ? "" : /[.!?,;:]$/.test(before) ? " " : ". ";
  const sentence = phrase.replace(/[.\s]+$/, "") + ".";
  const tail = after === "" ? "" : /^\n/.test(after) ? "" : " ";
  const head = before + lead + sentence;
  return { text: head + tail + after, caret: head.length };
}
