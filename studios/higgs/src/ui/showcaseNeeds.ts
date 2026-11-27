import type { Catalog, CatalogModel, KeyStatus, ShowcaseItem, WorkflowDef } from "@ima2/studio-kit";
import { href } from "../router.ts";

/** Subscription sessions appear beside key vocabularies; they are sign-ins, never keys. */
export const SUBSCRIPTIONS: Readonly<Record<string, string>> = { "openai-oauth": "ChatGPT", "xai-oauth": "Grok" };

/** One thing a run needs. ready: true (have it), false (missing), null (this server cannot tell). */
export interface Need {
  id: string;
  label: string;
  signIn: boolean;
  ready: boolean | null;
  href?: string;
}

function keyNeed(provider: Catalog["providers"][number], ready: boolean): Need {
  return { id: provider.id, label: provider.label, signIn: false, ready, href: href("keys", { focus: provider.keyVocabulary }) };
}

/** A model needs one key; prefer the route the server would use, else a direct maker route. */
function modelNeed(model: CatalogModel | undefined, catalog: Catalog, ready: boolean): Need | null {
  if (!model) return null;
  const route =
    model.routes.find((r) => r.providerId === model.defaultRoute) ??
    model.routes.find((r) => r.route === "direct") ??
    model.routes[0];
  const provider = route && catalog.providers.find((p) => p.id === route.providerId);
  return provider ? keyNeed(provider, ready) : null;
}

/** What this server would use for each step: the default when it can run, else the first alternative that can. */
function fromWorkflow(workflow: WorkflowDef, catalog: Catalog): Need[] {
  const needs: Need[] = [];
  for (const step of workflow.steps) {
    if (!step.model || !step.runnable) continue;
    const choices = step.modelChoices?.length ? step.modelChoices : [step.model];
    const runs = choices.find((m) => step.runnable?.[m]);
    const session = step.route ? SUBSCRIPTIONS[step.route] : undefined;
    if (session && (runs === step.model || !runs)) {
      needs.push({ id: step.route!, label: session, signIn: true, ready: runs === step.model });
      continue;
    }
    const need = modelNeed(catalog.models.find((m) => m.id === (runs ?? step.model)), catalog, !!runs);
    if (need) needs.push(need);
  }
  return needs;
}

/** Older servers send no runnable map: fall back to the key vocabularies the clip was made with. */
function fromItem(item: ShowcaseItem, catalog: Catalog, keys: readonly KeyStatus[]): Need[] {
  return item.keys.flatMap((vocab): Need[] => {
    const session = SUBSCRIPTIONS[vocab];
    if (session) return [{ id: vocab, label: session, signIn: true, ready: null }];
    const provider = catalog.providers.find((p) => p.keyVocabulary === vocab);
    const ready = keys.some((k) => k.keyVocabulary === vocab && k.configured);
    return provider ? [keyNeed(provider, ready)] : [{ id: vocab, label: vocab, signIn: false, ready, href: href("keys", { focus: vocab }) }];
  });
}

export function showcaseNeeds(item: ShowcaseItem, workflow: WorkflowDef | undefined, catalog: Catalog | null, keys: readonly KeyStatus[]): Need[] {
  if (!catalog) return [];
  const known = workflow?.steps.some((s) => s.model && s.runnable);
  const all = known && workflow ? fromWorkflow(workflow, catalog) : fromItem(item, catalog, keys);
  const seen = new Map<string, Need>();
  for (const need of all) {
    const prior = seen.get(need.id);
    // One missing step is enough to make the requirement missing.
    if (!prior || need.ready === false) seen.set(need.id, need);
  }
  return [...seen.values()];
}
