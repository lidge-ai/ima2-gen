import { modelHasKey, type CatalogModel, type MediaKind, type MediaTask } from "@ima2/studio-kit";

/** First model of this kind that can run now, else the first one listed. */
export function defaultModel(
  models: readonly CatalogModel[],
  kind: MediaKind,
  tasks?: readonly MediaTask[],
): CatalogModel | undefined {
  const fits = models.filter((m) => m.kind === kind && (!tasks || m.tasks.some((t) => tasks.includes(t))));
  return fits.find(modelHasKey) ?? fits[0];
}
