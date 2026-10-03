import type { InsertedPrompt } from "../store/storeTypes";

export const SOUND_INTENT_PROMPT_ID_PREFIX = "video-sound-intent:";

export type VideoSoundIntentPreset = {
  id: "no-music" | "soft-bgm" | "tense-music" | "room-tone" | "sfx" | "no-dialogue";
  labelKey: string;
  text: string;
};

export const VIDEO_SOUND_INTENT_PRESETS: VideoSoundIntentPreset[] = [
  {
    id: "no-music",
    labelKey: "video.soundIntent.noMusic",
    text: "no background music; use only natural scene sound and room tone",
  },
  {
    id: "soft-bgm",
    labelKey: "video.soundIntent.softBgm",
    text: "soft cinematic background music, gentle ambience, no distracting sound effects",
  },
  {
    id: "tense-music",
    labelKey: "video.soundIntent.tenseMusic",
    text: "subtle tense background music that builds emotion without overpowering the scene",
  },
  {
    id: "room-tone",
    labelKey: "video.soundIntent.roomTone",
    text: "natural room tone and environmental sound only; keep the audio realistic",
  },
  {
    id: "sfx",
    labelKey: "video.soundIntent.sfx",
    text: "emphasize clear synchronized sound effects that match the visible action",
  },
  {
    id: "no-dialogue",
    labelKey: "video.soundIntent.noDialogue",
    text: "no dialogue or spoken words; communicate the moment through motion, music, and sound",
  },
];

export function isVideoSoundIntentPrompt(id: string): boolean {
  return id.startsWith(SOUND_INTENT_PROMPT_ID_PREFIX);
}

export function buildVideoSoundIntentPrompt(
  preset: VideoSoundIntentPreset,
  name = `Sound: ${preset.id}`,
): InsertedPrompt {
  return {
    id: `${SOUND_INTENT_PROMPT_ID_PREFIX}${preset.id}`,
    name,
    text: preset.text,
    placement: "after",
  };
}
