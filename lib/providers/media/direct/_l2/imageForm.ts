import type { MediaInputRequirement, MediaModelSpec, MediaTask, MediaTaskFieldName } from "../../contract.js";

/** What one image task takes on a direct route, said once next to the adapter that checks it. */
export interface ImageForm {
  task: MediaTask;
  /** Images sent as source-image: at least one, at most this many. */
  images: number;
  /** Further images sent as reference-image beside the one source image. */
  references?: number;
  /** The route takes a mask; conventions other than the provider's own rule are listed. */
  mask?: MediaInputRequirement["conventions"] | true;
  accepts: readonly MediaTaskFieldName[];
  requires?: readonly MediaTaskFieldName[];
}

/**
 * Adds params.inputs and params.taskFields for the listed models. tests/media-image-forms.test.ts hands each
 * adapter requests built from these and fails when the adapter refuses what is declared or takes what is not.
 */
export function withImageForms(models: readonly MediaModelSpec[], forms: Readonly<Record<string, ImageForm>>): MediaModelSpec[] {
  return models.map((model) => {
    const form = forms[model.id];
    if (!form) return model;
    const tasks = [form.task];
    const inputs: MediaInputRequirement[] = [
      { role: "source-image", min: 1, max: form.images, tasks },
      ...(form.references ? [{ role: "reference-image" as const, min: 0, max: form.references, tasks }] : []),
      ...(form.mask ? [{ role: "mask" as const, min: 0, max: 1, tasks, ...(form.mask === true ? {} : { conventions: form.mask }) }] : []),
    ];
    return {
      ...model,
      params: {
        ...model.params,
        inputs: [...(model.params.inputs ?? []), ...inputs],
        taskFields: { ...model.params.taskFields, [form.task]: { accepts: form.accepts, ...(form.requires ? { requires: form.requires } : {}) } },
      },
    };
  });
}
