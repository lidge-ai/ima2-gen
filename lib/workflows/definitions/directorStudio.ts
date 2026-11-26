import type { MediaInput, MediaModelSpec } from "../../providers/media/contract.js";
import type { LocalStep, MediaStep, ModelSlot, PlanEnv, ResolvedSlot, StepRuntime, WorkflowDefinition, WorkflowStep, WorkflowValues } from "../types.js";
import { fitDuration, maxShotSeconds, planShotsStep, shotPrompt, splitDuration } from "./directorShots.js";
import { aspectField, checkLook, inputsFrom, intOf, joinPrompt, lookFields, lookPrompt, option, refsOf, textOf, videoResolutionField } from "./shared.js";

const RENDER_SLOT: ModelSlot = {
  name: "render", label: "Video", task: "reference-to-video",
  defaultModel: "bytedance/seedance-2.5",
  alternatives: ["bytedance/seedance-2.5-flash", "bytedance/seedance-2", "bytedance/seedance-2-mini", "google/gemini-omni-flash-1.2"],
  rationale: "Seedance 2.5 (seed.bytedance.com launch post; docs.volcengine.com/docs/ark/video-generation-tutorial, read 2026-11-26): "
    + "up to 30 s per call with native audio and up to 30 images, 10 videos and 10 audio references.",
};

const SOUND_SLOT: ModelSlot = {
  name: "sound", label: "Sound bed", task: "video-to-audio",
  defaultModel: "mirelo/mirelo-sfx-2.0", alternatives: [],
  rationale: "Used only when the video model makes no sound. Mirelo SFX 2.0 makes synchronized effects from video (mirelo.ai/changelog, read 2026-11-26).",
};

interface Shape {
  values: WorkflowValues;
  render: ResolvedSlot;
  native: boolean;
  wantSound: boolean;
  resolution: string;
}

function referenceInputs(rt: StepRuntime, values: WorkflowValues): Promise<MediaInput[][]> {
  return Promise.all([
    inputsFrom(rt, refsOf(values, "images"), "reference-image"),
    inputsFrom(rt, refsOf(values, "videos"), "reference-video"),
    inputsFrom(rt, refsOf(values, "audios"), "reference-audio"),
  ]);
}

function shotStep(shape: Shape, index: number, seconds: number, multi: boolean, continuity: boolean): MediaStep {
  const { values, render } = shape;
  const id = multi ? "shot-" + (index + 1) : "render";
  const deps = multi ? ["plan-shots", ...(continuity && index > 0 ? ["shot-" + index + "-last"] : [])] : [];
  const step: MediaStep = {
    id, label: multi ? "Shot " + (index + 1) : "Render the clip", kind: "media", slot: "render", model: render.model,
    outputKind: "video", dependsOn: deps,
    units: { unit: "second", quantity: seconds, variant: shape.resolution + (shape.native && shape.wantSound ? "+audio" : "") },
    async build(rt) {
      const scene = multi ? await shotPrompt(rt, index) : textOf(values, "prompt");
      const inputs = (await referenceInputs(rt, values)).flat();
      const prev = deps[1] ? rt.artifactsOf(deps[1])[0] : undefined;
      if (prev) inputs.unshift(await rt.asInput(prev, "first-frame"));
      return {
        model: render.model, task: inputs.length > 0 ? "reference-to-video" : "text-to-video",
        prompt: joinPrompt(scene, lookPrompt(values)), durationSec: seconds, resolution: shape.resolution,
        aspectRatio: textOf(values, "aspectRatio") ?? "16:9", audio: shape.native && shape.wantSound, inputs,
      };
    },
  };
  if (render.route) step.route = render.route;
  return step;
}

function lastFrameStep(shotId: string): LocalStep {
  return {
    id: shotId + "-last", label: "Take the last frame of " + shotId, kind: "local", op: "frame", dependsOn: [shotId],
    async run(rt) {
      const clip = rt.artifactsOf(shotId)[0];
      if (!clip) throw new Error(shotId + " output missing");
      const out = rt.tempPath("last.png");
      await rt.local.frame(clip.path, out, "last", rt.signal);
      return [{ kind: "image", mimeType: "image/png", path: out }];
    },
  };
}

function joinStep(shotIds: readonly string[]): LocalStep {
  return {
    id: "join", label: "Join the shots", kind: "local", op: "concat", dependsOn: shotIds,
    async run(rt) {
      const paths = shotIds.map((id) => rt.artifactsOf(id)[0]?.path ?? "");
      const out = rt.tempPath("joined.mp4");
      await rt.local.concat(paths, out, rt.signal);
      return [{ kind: "video", mimeType: "video/mp4", path: out }];
    },
  };
}

function soundSteps(slot: ResolvedSlot, videoStep: string, seconds: number): WorkflowStep[] {
  const sound: MediaStep = {
    id: "sound", label: "Make the sound bed", kind: "media", slot: "sound", model: slot.model, outputKind: "audio",
    dependsOn: [videoStep], units: { unit: "second", quantity: seconds },
    async build(rt) {
      const video = rt.artifactsOf(videoStep)[0];
      if (!video) throw new Error(videoStep + " output missing");
      return { model: slot.model, task: "video-to-audio", durationSec: seconds, inputs: [await rt.asInput(video, "source-video")] };
    },
  };
  if (slot.route) sound.route = slot.route;
  const mix: LocalStep = {
    id: "mix", label: "Lay the sound under the picture", kind: "local", op: "mux-audio", dependsOn: [videoStep, "sound"], final: true,
    async run(rt) {
      const video = rt.artifactsOf(videoStep)[0];
      const audio = rt.artifactsOf("sound")[0];
      if (!video || !audio) throw new Error("video or sound missing");
      const out = rt.tempPath("final.mp4");
      await rt.local.muxAudio(video.path, audio.path, out, rt.signal);
      return [{ kind: "video", mimeType: "video/mp4", path: out }];
    },
  };
  return [sound, mix];
}

function buildPlan(values: WorkflowValues, models: Readonly<Record<string, ResolvedSlot>>, env: PlanEnv): WorkflowStep[] {
  const render = models.render;
  const sound = models.sound;
  if (!render || !sound) throw new Error("director-studio slots missing");
  const spec: MediaModelSpec | undefined = env.catalog(render.model);
  const total = intOf(values, "duration", 5);
  const durations = splitDuration(total, maxShotSeconds(render.model, spec)).map((d) => fitDuration(d, spec));
  const shape: Shape = {
    values, render, native: spec?.params.nativeAudio === true,
    wantSound: values.generateAudio !== false, resolution: textOf(values, "resolution") ?? "720p",
  };
  const multi = durations.length > 1;
  const continuity = (textOf(values, "continuity") ?? "first-frame") === "first-frame";
  const steps: WorkflowStep[] = multi ? [planShotsStep(textOf(values, "prompt") ?? "", durations)] : [];
  durations.forEach((seconds, i) => {
    steps.push(shotStep(shape, i, seconds, multi, continuity));
    if (multi && continuity && i < durations.length - 1) steps.push(lastFrameStep("shot-" + (i + 1)));
  });
  if (multi) steps.push(joinStep(durations.map((_, i) => "shot-" + (i + 1))));
  const videoStep = multi ? "join" : "render";
  if (shape.wantSound && !shape.native) return [...steps, ...soundSteps(sound, videoStep, durations.reduce((a, b) => a + b, 0))];
  const last = steps[steps.length - 1];
  if (last) last.final = true;
  return steps;
}

export const directorStudio: WorkflowDefinition = {
  id: "director-studio",
  label: "Director studio",
  description: "A directed 4-30 second clip from one prompt: planned shots, a look and a sound bed, with image, video and audio references.",
  equivalents: ["sume/sume-director-studio-1"],
  fields: [
    { name: "prompt", type: "text", label: "Scene", required: true, maxLength: 4000, multiline: true, help: "What happens. Name references as image 1, video 1, audio 1." },
    { name: "duration", type: "integer", label: "Length (seconds)", required: false, min: 4, max: 30, default: 5 },
    videoResolutionField(),
    aspectField(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], "16:9"),
    { name: "generateAudio", type: "boolean", label: "Sound", required: false, default: true },
    { name: "images", type: "media", accept: "image", label: "Image references", required: false, min: 1, max: 30 },
    { name: "videos", type: "media", accept: "video", label: "Video references", required: false, min: 1, max: 10, maxDurationSec: 30 },
    { name: "audios", type: "media", accept: "audio", label: "Audio references", required: false, min: 1, max: 10, maxDurationSec: 30 },
    {
      name: "continuity", type: "enum", label: "Between shots", required: false, default: "first-frame",
      help: "Only used when the clip is longer than one model call.",
      options: [option("first-frame", "Continue from the previous shot's last frame"), option("independent", "Independent shots")],
    },
    ...lookFields(),
  ],
  slots: [RENDER_SLOT, SOUND_SLOT],
  check: checkLook,
  plan(values, models, env) {
    return { workflowId: "director-studio", steps: buildPlan(values, models, env) };
  },
};
