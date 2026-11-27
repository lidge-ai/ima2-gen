/**
 * Maps a MediaSubmitRequest onto one upstream endpoint's input schema.
 *
 * fal, Atlas Cloud and Replicate publish a JSON schema per endpoint, and their
 * field names mostly follow the same conventions (prompt, image_url,
 * aspect_ratio, generate_audio). Driving the body from the schema means every
 * value lands on a field the endpoint declares; anything the endpoint cannot
 * take is refused with an invalid-request error instead of being dropped, so a
 * user is never billed for a different job than the one they asked for.
 */
import type { MediaInputRequirement, MediaInputRole, MediaModelSpec, MediaOptionSpec, MediaSubmitRequest, MediaTask, MediaTaskFieldName, MediaTaskFields } from "../../contract.js";
import { invalidRequest } from "./errors.js";
import { inputToUrl } from "./inputs.js";

export interface InputField {
  type?: string;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  /** Item type for arrays ("string" for URL lists). */
  items?: string;
  maxItems?: number;
}

export interface EndpointSchema {
  /** Upstream endpoint or model id. */
  endpoint: string;
  task: MediaTask;
  required: readonly string[];
  fields: Readonly<Record<string, InputField>>;
}

/** Field names tried in order for each input role. */
const ROLE_FIELDS: Record<MediaInputRole, readonly string[]> = {
  "first-frame": ["image_url", "start_image_url", "first_frame_url", "first_frame_image_url", "first_frame_image", "start_image", "first_frame", "image", "image_urls"],
  "last-frame": ["end_image_url", "last_frame_url", "tail_image_url", "last_image_url", "last_frame_image", "end_image", "last_image", "last_frame", "tail_image"],
  "reference-image": ["reference_image_urls", "image_urls", "reference_images", "image_references", "image_input", "input_images", "images", "reference_image_url", "image_url", "image"],
  "reference-video": ["reference_video_urls", "video_urls", "reference_videos", "reference_video_url", "reference_video", "video_url", "video"],
  "reference-audio": ["reference_audio_urls", "audio_urls", "reference_audios", "reference_audio_url", "audio_url", "audio"],
  "source-image": ["image_url", "image_urls", "image", "images", "image_input", "input_images", "input_image", "input_image_url", "start_image_url"],
  "source-video": ["video_url", "video", "base_video", "input_video", "input_video_url", "video_urls"],
  "source-audio": ["audio_url", "audio", "audio_file", "input_audio", "audio_urls"],
  mask: ["mask_url", "mask_image_url", "mask", "mask_image"],
};

const SCALAR_FIELDS = {
  prompt: ["prompt"],
  negativePrompt: ["negative_prompt"],
  durationSec: ["duration", "duration_seconds", "seconds"],
  resolution: ["resolution", "image_size"],
  quality: ["quality"],
  aspectRatio: ["aspect_ratio", "ratio"],
  seed: ["seed"],
  audio: ["generate_audio", "enable_audio", "sound", "audio"],
  count: ["num_images", "num_outputs", "number_of_images", "n"],
} as const satisfies Record<string, readonly string[]>;

type ScalarKey = keyof typeof SCALAR_FIELDS;

type FieldFilter = (field: InputField) => boolean;

/** Inputs are URLs: they can only land on string, untyped or array fields. */
const URL_FIELD: FieldFilter = (field) => field.type === undefined || field.type === "string" || field.type === "array";
/** "audio" doubles as an input name on some endpoints; the generate-audio flag must be boolean. */
const SCALAR_FILTER: Partial<Record<ScalarKey, FieldFilter>> = { audio: (field) => field.type === undefined || field.type === "boolean" };

function pickField(schema: EndpointSchema, names: readonly string[], used: ReadonlySet<string>, accept?: FieldFilter): string | undefined {
  return names.find((name) => {
    const field = schema.fields[name];
    return field !== undefined && !used.has(name) && (!accept || accept(field));
  });
}

function matchEnum(values: readonly (string | number)[], value: string | number): string | number | undefined {
  const wanted = [String(value), `${value}s`].map((v) => v.toLowerCase());
  return values.find((candidate) => wanted.includes(String(candidate).toLowerCase()));
}

/** Encodes a scalar for the declared field type; undefined means the value is not accepted. */
export function encodeScalar(field: InputField, value: string | number | boolean): string | number | boolean | undefined {
  if (field.type === "object" || field.type === "array") return undefined;
  if (typeof value === "boolean") return field.type === undefined || field.type === "boolean" ? value : undefined;
  if (field.enum && field.enum.length > 0) return matchEnum(field.enum, value);
  if (field.type === "integer" || field.type === "number") {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num) || (field.type === "integer" && !Number.isInteger(num))) return undefined;
    if ((field.minimum !== undefined && num < field.minimum) || (field.maximum !== undefined && num > field.maximum)) return undefined;
    return num;
  }
  return field.type === "string" ? String(value) : value;
}

function describeAllowed(field: InputField): string {
  if (field.enum) return `allowed: ${field.enum.join(", ")}`;
  if (field.minimum !== undefined || field.maximum !== undefined) return `range: ${field.minimum ?? "-"}..${field.maximum ?? "-"}`;
  return `type: ${field.type ?? "any"}`;
}

function applyScalars(prefix: string, schema: EndpointSchema, request: MediaSubmitRequest, body: Record<string, unknown>, used: Set<string>): void {
  for (const key of Object.keys(SCALAR_FIELDS) as ScalarKey[]) {
    const raw = request[key];
    if (raw === undefined || raw === "") continue;
    // A quality goes to the tier field the endpoint prices by; an endpoint that only takes a free-text quality keeps that field.
    const tier = key === "quality" ? qualityField(schema) : undefined;
    const name = tier && !used.has(tier) ? tier : pickField(schema, SCALAR_FIELDS[key], used, SCALAR_FILTER[key]);
    if (!name) throw invalidRequest(prefix, `${schema.endpoint} does not accept ${key}`, "UNSUPPORTED_OPTION");
    const field = schema.fields[name] ?? {};
    const encoded = encodeScalar(field, raw);
    if (encoded === undefined) {
      throw invalidRequest(prefix, `${schema.endpoint} does not accept ${key}=${String(raw)} (${describeAllowed(field)})`, "UNSUPPORTED_OPTION");
    }
    body[name] = encoded;
    used.add(name);
  }
}

function applyInputs(prefix: string, schema: EndpointSchema, request: MediaSubmitRequest, body: Record<string, unknown>, used: Set<string>): void {
  const roles = [...new Set(request.inputs.map((input) => input.role))];
  for (const role of roles) {
    const inputs = request.inputs.filter((input) => input.role === role);
    const name = pickField(schema, ROLE_FIELDS[role], used, URL_FIELD);
    if (!name) throw invalidRequest(prefix, `${schema.endpoint} does not accept a ${role} input`, "UNSUPPORTED_INPUT");
    const field = schema.fields[name] ?? {};
    const urls = inputs.map((input) => inputToUrl(prefix, input));
    if (field.type === "array") {
      if (field.maxItems !== undefined && urls.length > field.maxItems) {
        throw invalidRequest(prefix, `${schema.endpoint} accepts at most ${field.maxItems} ${role} inputs`, "TOO_MANY_INPUTS");
      }
      body[name] = urls;
    } else {
      if (urls.length > 1) throw invalidRequest(prefix, `${schema.endpoint} accepts one ${role} input`, "TOO_MANY_INPUTS");
      body[name] = urls[0];
    }
    used.add(name);
  }
}

function applyVendorOptions(prefix: string, schema: EndpointSchema, request: MediaSubmitRequest, body: Record<string, unknown>, used: Set<string>): void {
  for (const [key, value] of Object.entries(request.vendorOptions ?? {})) {
    if (!(key in schema.fields)) throw invalidRequest(prefix, `${schema.endpoint} has no option ${key}`, "UNSUPPORTED_OPTION");
    if (used.has(key)) throw invalidRequest(prefix, `vendorOptions.${key} conflicts with a request field`, "UNSUPPORTED_OPTION");
    body[key] = value;
    used.add(key);
  }
}

/** Builds the JSON input for one endpoint, refusing anything it does not declare. */
export function buildSchemaBody(prefix: string, schema: EndpointSchema, request: MediaSubmitRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const used = new Set<string>();
  applyScalars(prefix, schema, request, body, used);
  applyInputs(prefix, schema, request, body, used);
  applyVendorOptions(prefix, schema, request, body, used);
  const missing = schema.required.filter((name) => !(name in body));
  if (missing.length > 0) {
    throw invalidRequest(prefix, `${schema.endpoint} requires: ${missing.join(", ")}`, "MISSING_INPUT");
  }
  return body;
}

function durationsOf(field: InputField | undefined): number[] {
  if (!field) return [];
  if (field.enum) return field.enum.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isFinite(n) && n > 0);
  if (field.type === "integer" && field.minimum !== undefined && field.maximum !== undefined && field.maximum - field.minimum <= 60) {
    // Sentinels such as -1 ("model decides") are not durations.
    const low = Math.max(1, field.minimum);
    return Array.from({ length: Math.max(0, field.maximum - low + 1) }, (_, i) => low + i);
  }
  return [];
}

function stringsOf(field: InputField | undefined): string[] {
  return field?.enum ? field.enum.map(String) : [];
}

/** Fields a provider prices by tier: quality, Ideogram's rendering speed, Kling's mode. Tried in this order. */
const TIER_FIELDS = ["quality", "rendering_speed", "mode"] as const;

/**
 * The tier names a field offers, or none when the field is something else: some endpoints use "quality"
 * for a resolution list, and "mode" is a price tier only where it offers a standard and a pro setting.
 */
function tiersOf(name: string, field: InputField | undefined): string[] {
  const values = stringsOf(field);
  if (values.length < 2) return [];
  if (name === "mode") return values.some((value) => /^(?:std|standard)$/i.test(value)) && values.some((value) => /^pro$/i.test(value)) ? values : [];
  return values.some((value) => /^\d+(?:\.\d+)?[pk]$/i.test(value)) ? [] : values;
}

/** The field a request's quality is sent on for this endpoint. */
export function qualityField(schema: EndpointSchema): string | undefined {
  return TIER_FIELDS.find((name) => tiersOf(name, schema.fields[name]).length > 0);
}

function qualitiesOf(schema: EndpointSchema): string[] {
  const name = qualityField(schema);
  return name ? tiersOf(name, schema.fields[name]) : [];
}

function union<T>(lists: readonly T[][]): T[] {
  return [...new Set(lists.flat())];
}

function maxArrayItems(schemas: readonly EndpointSchema[], role: MediaInputRole): number | undefined {
  const counts = schemas.flatMap((schema) => {
    const name = ROLE_FIELDS[role].find((n) => schema.fields[n]?.type === "array");
    const field = name ? schema.fields[name] : undefined;
    return field?.maxItems !== undefined ? [field.maxItems] : [];
  });
  return counts.length > 0 ? Math.max(...counts) : undefined;
}

/** Tasks whose form is media inputs rather than a prompt; the roles to look for and which of them the bill follows. */
const INPUT_TASKS: Partial<Record<MediaTask, { roles: readonly MediaInputRole[]; billed: readonly MediaInputRole[] }>> = {
  lipsync: { roles: ["source-video", "source-audio"], billed: ["source-video", "source-audio"] },
  avatar: { roles: ["source-image", "source-video", "source-audio"], billed: ["source-audio"] },
  dubbing: { roles: ["source-video"], billed: ["source-video"] },
  subtitles: { roles: ["source-video"], billed: ["source-video"] },
  "video-to-audio": { roles: ["source-video"], billed: ["source-video"] },
};
/** Required scalar fields a form always sends when the spec lists them. */
const FORM_SCALARS: ReadonlySet<string> = new Set([...SCALAR_FIELDS.resolution, ...SCALAR_FIELDS.aspectRatio]);
const ALL_SCALARS: ReadonlySet<string> = new Set(Object.values(SCALAR_FIELDS).flat());

function optionOf(name: string, field: InputField, required: boolean, task: MediaTask): MediaOptionSpec | undefined {
  const base = { name, ...(required ? { required: true } : {}), tasks: [task] };
  if (field.enum && field.enum.length > 0) return { ...base, type: "enum", values: field.enum.map(String) };
  if (field.type === "boolean") return { ...base, type: "boolean" };
  if (field.type === "string") return { ...base, type: "text" };
  return undefined;
}

/** What one endpoint needs from a form, or undefined when a required field is something a form cannot fill. */
function formOf(schema: EndpointSchema): { inputs: MediaInputRequirement[]; options: MediaOptionSpec[] } | undefined {
  const plan = INPUT_TASKS[schema.task];
  if (!plan) return undefined;
  const used = new Set<string>();
  const inputs: MediaInputRequirement[] = [];
  for (const role of plan.roles) {
    const name = pickField(schema, ROLE_FIELDS[role], used, URL_FIELD);
    if (!name) continue;
    used.add(name);
    const field = schema.fields[name] ?? {};
    inputs.push({
      role, min: schema.required.includes(name) ? 1 : 0, max: field.type === "array" ? field.maxItems ?? 1 : 1,
      tasks: [schema.task], ...(plan.billed.includes(role) ? { billedLength: true } : {}),
    });
  }
  const options: MediaOptionSpec[] = [];
  for (const [name, field] of Object.entries(schema.fields)) {
    if (used.has(name) || ALL_SCALARS.has(name)) continue;
    const option = optionOf(name, field, schema.required.includes(name), schema.task);
    if (option) options.push(option);
  }
  const fillable = (name: string) => used.has(name) || FORM_SCALARS.has(name) || options.some((option) => option.name === name);
  if (inputs.length === 0 || !schema.required.every(fillable)) return undefined;
  // Required options first, in the schema's order.
  return { inputs, options: [...options.filter((o) => o.required), ...options.filter((o) => !o.required)] };
}

/** Tasks that rework one source video. Their form is that video plus whichever common fields the endpoint has. */
const EDIT_TASKS: ReadonlySet<MediaTask> = new Set<MediaTask>(["video-to-video", "video-extend", "video-upscale"]);
const TASK_FIELDS: readonly MediaTaskFieldName[] = ["prompt", "negativePrompt", "durationSec", "resolution", "aspectRatio", "audio", "seed"];
const SCALAR_VALUE: FieldFilter = (field) => field.type !== "object" && field.type !== "array";

/** What an edit endpoint takes, or undefined when it has no source-video field or requires something a form cannot fill. */
function editFormOf(schema: EndpointSchema): { input: MediaInputRequirement; fields: MediaTaskFields } | undefined {
  if (!EDIT_TASKS.has(schema.task)) return undefined;
  const used = new Set<string>();
  const taken = new Map<MediaTaskFieldName, InputField>();
  const required: MediaTaskFieldName[] = [];
  for (const key of TASK_FIELDS) {
    const filter = SCALAR_FILTER[key];
    const name = pickField(schema, SCALAR_FIELDS[key], used, (field) => SCALAR_VALUE(field) && (!filter || filter(field)));
    if (!name) continue;
    used.add(name);
    taken.set(key, schema.fields[name] ?? {});
    if (schema.required.includes(name)) required.push(key);
  }
  const video = pickField(schema, ROLE_FIELDS["source-video"], used, URL_FIELD);
  if (!video || !schema.required.every((name) => name === video || used.has(name))) return undefined;
  const durations = durationsOf(taken.get("durationSec")), resolutions = stringsOf(taken.get("resolution")), ratios = stringsOf(taken.get("aspectRatio"));
  // Without a length of its own, an edit or upscale is as long as its source, and is billed by it.
  const billed = schema.task !== "video-extend" && !taken.has("durationSec");
  return {
    input: { role: "source-video", min: 1, max: 1, tasks: [schema.task], ...(billed ? { billedLength: true } : {}) },
    fields: {
      accepts: [...taken.keys()],
      ...(required.length > 0 ? { requires: required } : {}),
      ...(durations.length > 0 ? { durationsSec: durations } : {}),
      ...(resolutions.length > 0 ? { resolutions } : {}),
      ...(ratios.length > 0 ? { aspectRatios: ratios } : {}),
    },
  };
}

/** Tasks that rework images: the form is the image (or several), an optional mask and whichever common fields the endpoint has. */
const IMAGE_TASKS: ReadonlySet<MediaTask> = new Set<MediaTask>(["image-to-image", "image-upscale", "image-vectorize", "image-segment"]);
/** In the order the body builder places them, so a shared field name goes to the same key here and there. */
const IMAGE_FIELDS: readonly MediaTaskFieldName[] = ["prompt", "negativePrompt", "resolution", "quality", "aspectRatio", "seed", "count"];
/** A list field without a stated limit takes as many images as one request may carry. */
const MAX_LIST_IMAGES = 16;

/** What an image endpoint takes, or undefined when it has no image field or requires something a form cannot fill. */
function imageFormOf(schema: EndpointSchema): { inputs: MediaInputRequirement[]; fields: MediaTaskFields } | undefined {
  const used = new Set<string>();
  const taken = new Map<MediaTaskFieldName, InputField>();
  const required: MediaTaskFieldName[] = [];
  for (const key of IMAGE_FIELDS) {
    const filter = SCALAR_FILTER[key];
    const tier = key === "quality" ? qualityField(schema) : undefined;
    if (key === "quality" && !tier) continue;
    const name = tier ?? pickField(schema, SCALAR_FIELDS[key], used, (field) => SCALAR_VALUE(field) && (!filter || filter(field)));
    if (!name || used.has(name)) continue;
    used.add(name);
    taken.set(key, schema.fields[name] ?? {});
    if (schema.required.includes(name)) required.push(key);
  }
  const role = (["source-image", "reference-image"] as const).find((candidate) => pickField(schema, ROLE_FIELDS[candidate], used, URL_FIELD));
  const image = role ? pickField(schema, ROLE_FIELDS[role], used, URL_FIELD) : undefined;
  if (!role || !image) return undefined;
  used.add(image);
  const mask = pickField(schema, ROLE_FIELDS.mask, used, URL_FIELD);
  if (mask) used.add(mask);
  if (!schema.required.every((name) => used.has(name))) return undefined;
  const field = schema.fields[image] ?? {};
  const resolutions = stringsOf(taken.get("resolution")), ratios = stringsOf(taken.get("aspectRatio"));
  return {
    inputs: [
      { role, min: 1, max: field.type === "array" ? field.maxItems ?? MAX_LIST_IMAGES : 1, tasks: [schema.task] },
      // The mask follows the provider's own rule: an endpoint schema does not say which one that is.
      ...(mask ? [{ role: "mask" as const, min: schema.required.includes(mask) ? 1 : 0, max: 1, tasks: [schema.task] }] : []),
    ],
    fields: {
      accepts: [...taken.keys()],
      ...(required.length > 0 ? { requires: required } : {}),
      ...(resolutions.length > 0 ? { resolutions } : {}),
      ...(ratios.length > 0 ? { aspectRatios: ratios } : {}),
    },
  };
}

/** Derives the advertised MediaModelSpec params from the endpoints that serve a model. */
export function paramsFromSchemas(schemas: readonly EndpointSchema[]): MediaModelSpec["params"] {
  const has = (names: readonly string[]) => schemas.some((s) => names.some((n) => n in s.fields));
  const durations = union(schemas.map((s) => durationsOf(s.fields.duration ?? s.fields.duration_seconds))).sort((a, b) => a - b);
  const resolutions = union(schemas.map((s) => stringsOf(s.fields.resolution)));
  const aspectRatios = union(schemas.map((s) => stringsOf(s.fields.aspect_ratio ?? s.fields.ratio)));
  const qualities = union(schemas.map(qualitiesOf));
  const maxRefImages = maxArrayItems(schemas, "reference-image");
  const maxRefVideos = maxArrayItems(schemas, "reference-video");
  // One form per task: the first endpoint that a form can fill.
  const tasks = new Set<MediaTask>();
  const forms = schemas.flatMap((schema) => {
    const form = tasks.has(schema.task) ? undefined : formOf(schema);
    if (form) tasks.add(schema.task);
    return form ?? [];
  });
  // An edit task runs on the first endpoint listed for it, so that endpoint alone decides its form.
  const edits = schemas.flatMap((schema) => {
    const image = IMAGE_TASKS.has(schema.task);
    if ((!image && !EDIT_TASKS.has(schema.task)) || tasks.has(schema.task)) return [];
    tasks.add(schema.task);
    if (image) {
      const form = imageFormOf(schema);
      return form ? [{ task: schema.task, ...form }] : [];
    }
    const form = editFormOf(schema);
    return form ? [{ task: schema.task, inputs: [form.input], fields: form.fields }] : [];
  });
  const inputs = [...forms.flatMap((form) => form.inputs), ...edits.flatMap((edit) => edit.inputs)];
  const options = forms.flatMap((form) => form.options);
  return {
    ...(durations.length > 0 ? { durationsSec: durations } : {}),
    ...(resolutions.length > 0 ? { resolutions } : {}),
    ...(aspectRatios.length > 0 ? { aspectRatios } : {}),
    ...(qualities.length > 1 ? { qualities } : {}),
    ...(maxRefImages !== undefined ? { maxReferenceImages: maxRefImages } : {}),
    ...(maxRefVideos !== undefined ? { maxReferenceVideos: maxRefVideos } : {}),
    ...(schemas.some((s) => SCALAR_FIELDS.audio.some((n) => s.fields[n] !== undefined && SCALAR_FILTER.audio?.(s.fields[n] as InputField))) ? { nativeAudio: true } : {}),
    ...(has(SCALAR_FIELDS.negativePrompt) ? { negativePrompt: true } : {}),
    ...(has(SCALAR_FIELDS.seed) ? { seed: true } : {}),
    ...(inputs.length > 0 ? { inputs } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(edits.length > 0 ? { taskFields: Object.fromEntries(edits.map((edit) => [edit.task, edit.fields])) } : {}),
  };
}
