import type { MediaInput, MediaModelSpec } from "../../providers/media/contract.js";
import type { LocalStep, MediaStep, ModelSlot, PlanEnv, ResolvedSlot, StepRuntime, WorkflowDefinition, WorkflowShot, WorkflowStep, WorkflowValues } from "../types.js";
import { fitDuration, fitShots, maxShotSeconds, planShotsStep, shotPrompt, splitDuration } from "./directorShots.js";
import { aspectField, checkLook, checkModelFit, inputsFrom, intOf, joinPrompt, lookFields, lookPrompt, option, refsOf, textOf, videoResolutionField } from "./shared.js";

const RENDER_SLOT: ModelSlot = {
  name: "render", label: "Video", task: "reference-to-video",
  description: "Generates the video for each planned shot.",
  defaultModel: "bytedance/seedance-2.5",
  alternatives: [
    "bytedance/seedance-2.5-flash", "bytedance/seedance-2", "bytedance/seedance-2-mini",
    "google/gemini-omni-flash-1.2", "xai/grok-imagine-video-1.5", "google/veo-3.1",
  ],
  rationale: "Seedance 2.5 (seed.bytedance.com launch post; docs.volcengine.com/docs/ark/video-generation-tutorial, read 2026-11-26): "
    + "up to 30 s per call with native audio and up to 30 images, 10 videos and 10 audio references. "
    + "Alternatives are split into shots by their listed clip lengths.",
};

const SOUND_SLOT: ModelSlot = {
  name: "sound", label: "Sound bed", task: "video-to-audio",
  description: "Adds a sound bed when the video model makes no sound.",
  defaultModel: "mirelo/mirelo-sfx-2.0", alternatives: [],
  rationale: "Used only when the video model makes no sound. Mirelo SFX 2.0 makes synchronized effects from video (mirelo.ai/changelog, read 2026-11-26).",
};

interface Shape {
  values: WorkflowValues;
  render: ResolvedSlot;
  native: boolean;
  wantSound: boolean;
  resolution: string;
  /** The caller's cut list, when given: shot prompts come from it instead of the planner. */
  shots?: readonly WorkflowShot[];
}

function referenceInputs(rt: StepRuntime, values: WorkflowValues): Promise<MediaInput[][]> {
  return Promise.all([
    inputsFrom(rt, refsOf(values, "images"), "reference-image"),
    inputsFrom(rt, refsOf(values, "videos"), "reference-video"),
    inputsFrom(rt, refsOf(values, "audios"), "reference-audio"),
  ]);
}

const shotsOf = (values: WorkflowValues): readonly WorkflowShot[] | undefined => values.shots as readonly WorkflowShot[] | undefined;

/** The scene text for one call: an explicit shot with the Scene as shared context, a planned shot, or the whole Scene. */
async function scenePrompt(rt: StepRuntime, shape: Shape, index: number, multi: boolean): Promise<string | undefined> {
  const scene = textOf(shape.values, "prompt");
  const explicit = shape.shots?.[index];
  if (explicit) return joinPrompt(explicit.prompt, scene ? "Shared context for every shot: " + scene : undefined);
  return multi ? shotPrompt(rt, index) : scene;
}

function shotStep(shape: Shape, index: number, seconds: number, multi: boolean, continuity: boolean): MediaStep {
  const { values, render } = shape;
  const id = multi ? "shot-" + (index + 1) : "render";
  const previous = multi && continuity && index > 0 ? "shot-" + index + "-last" : undefined;
  const deps = [...(multi && !shape.shots ? ["plan-shots"] : []), ...(previous ? [previous] : [])];
  const step: MediaStep = {
    id, label: multi ? "Shot " + (index + 1) : "Render the clip", kind: "media", slot: "render", model: render.model,
    outputKind: "video", dependsOn: deps,
    units: { unit: "second", quantity: seconds, variant: shape.resolution + (shape.native && shape.wantSound ? "+audio" : "") },
    async build(rt) {
      const scene = await scenePrompt(rt, shape, index, multi);
      const inputs = (await referenceInputs(rt, values)).flat();
      const prev = previous ? rt.artifactsOf(previous)[0] : undefined;
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

function lastFrameStep(index: number): LocalStep {
  const shotId = "shot-" + (index + 1);
  return {
    id: shotId + "-last", label: "Take the last frame of shot " + (index + 1), kind: "local", op: "frame", dependsOn: [shotId],
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
  checkModelFit(env, render.model, values, refsOf(values, "images").length);
  const shots = shotsOf(values);
  const durations = shots
    ? fitShots(shots, render.model, spec)
    : splitDuration(intOf(values, "duration", 5), maxShotSeconds(render.model, spec)).map((d) => fitDuration(d, spec));
  const shape: Shape = {
    values, render, native: spec?.params.nativeAudio === true,
    wantSound: values.generateAudio !== false, resolution: textOf(values, "resolution") ?? "720p",
    ...(shots ? { shots } : {}),
  };
  const multi = durations.length > 1;
  const continuity = (textOf(values, "continuity") ?? "first-frame") === "first-frame";
  const steps: WorkflowStep[] = multi && !shots ? [planShotsStep(textOf(values, "prompt") ?? "", durations)] : [];
  durations.forEach((seconds, i) => {
    steps.push(shotStep(shape, i, seconds, multi, continuity));
    if (multi && continuity && i < durations.length - 1) steps.push(lastFrameStep(i));
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
  description: "A directed clip from one prompt or your own cut list: 4-30 seconds planned into shots, or 2-6 shots of your own up to 60 seconds, with a look, a sound bed and image, video and audio references.",
  fields: [
    {
      name: "prompt", type: "text", label: "Scene", required: false, requiredUnless: "shots", maxLength: 4000, multiline: true,
      help: "What happens. Name references as image 1, video 1, audio 1.",
    },
    { name: "duration", type: "integer", label: "Length (seconds)", required: false, min: 4, max: 30, default: 5 },
    {
      name: "shots", type: "shots", label: "Shots", required: false, min: 2, max: 6, promptMaxLength: 1000,
      help: "Optional cut list: 2-6 shots in order, each with its own prompt and whole seconds, up to 60 seconds in all. Leave Length empty when you use it.",
    },
    videoResolutionField(),
    aspectField(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], "16:9"),
    { name: "generateAudio", type: "boolean", label: "Sound", required: false, default: true },
    { name: "images", type: "media", accept: "image", label: "Image references", required: false, min: 1, max: 30 },
    { name: "videos", type: "media", accept: "video", label: "Video references", required: false, min: 1, max: 10, maxDurationSec: 30 },
    { name: "audios", type: "media", accept: "audio", label: "Audio references", required: false, min: 1, max: 10, maxDurationSec: 30 },
    {
      name: "continuity", type: "enum", label: "Between shots", required: false, default: "first-frame",
      help: "Used when the clip has more than one shot.",
      options: [option("first-frame", "Continue from the previous shot's last frame"), option("independent", "Independent shots")],
    },
    ...lookFields(),
  ],
  slots: [RENDER_SLOT, SOUND_SLOT],
  check(values, provided) {
    if (shotsOf(values) && provided.has("duration")) return "duration: leave it out when shots are given; the shots set the length";
    return checkLook(values);
  },
  plan(values, models, env) {
    return { workflowId: "director-studio", steps: buildPlan(values, models, env) };
  },
};

