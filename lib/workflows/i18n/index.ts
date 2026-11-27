import type { WorkflowDefinition, WorkflowText } from "../types.js";
import { KO } from "./ko.js";

/** Strings that read the same in every language (resolutions, ratios, sizes): never translated. */
export const UNTRANSLATED = /^[0-9]+(?:p|[kK]|:[0-9]+)?$/;

type Dict = Readonly<Record<string, string>>;

function pick(dict: Dict, en: string | undefined): string | undefined {
  if (en === undefined || UNTRANSLATED.test(en)) return undefined;
  return dict[en];
}

function set<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/**
 * One locale's text for a definition: every English string the wire carries, looked up in the
 * dictionary. Missing entries are left out, so the client falls back to the English field.
 */
export function localize(def: WorkflowDefinition, dict: Dict): WorkflowText {
  const text: WorkflowText = {};
  set(text, "label", pick(dict, def.label));
  set(text, "description", pick(dict, def.description));
  const fields: NonNullable<WorkflowText["fields"]> = {};
  for (const field of def.fields) {
    const entry: NonNullable<WorkflowText["fields"]>[string] = {};
    set(entry, "label", pick(dict, field.label));
    set(entry, "help", pick(dict, field.help));
    if (field.type === "enum") {
      const options = Object.fromEntries(field.options.flatMap((o) => { const t = pick(dict, o.label); return t ? [[o.value, t]] : []; }));
      if (Object.keys(options).length) entry.options = options;
    }
    if (Object.keys(entry).length) fields[field.name] = entry;
  }
  if (Object.keys(fields).length) text.fields = fields;
  const slots = Object.fromEntries(def.slots.flatMap((s) => { const t = pick(dict, s.label); return t ? [[s.name, t]] : []; }));
  if (Object.keys(slots).length) text.slots = slots;
  const slotDescriptions = Object.fromEntries(def.slots.flatMap((s) => { const t = pick(dict, s.description); return t ? [[s.name, t]] : []; }));
  if (Object.keys(slotDescriptions).length) text.slotDescriptions = slotDescriptions;
  if (def.preset) {
    const p = def.preset;
    const preset: NonNullable<WorkflowText["preset"]> = {};
    set(preset, "label", pick(dict, p.label));
    const requires = Object.fromEntries(p.requires.flatMap((r) => { const t = pick(dict, r.label); return t ? [[r.route, t]] : []; }));
    if (Object.keys(requires).length) preset.requires = requires;
    const losses = p.losses.map((l) => pick(dict, l.detail) ?? null);
    if (losses.some((l) => l !== null)) preset.losses = losses;
    set(preset, "billingNote", pick(dict, p.billingNote));
    if (Object.keys(preset).length) text.preset = preset;
  }
  if (def.combos) {
    const combos: NonNullable<WorkflowText["combos"]> = {};
    for (const c of def.combos) {
      const entry: { label?: string; note?: string } = {};
      set(entry, "label", pick(dict, c.label));
      set(entry, "note", pick(dict, c.note));
      if (Object.keys(entry).length) combos[c.id] = entry;
    }
    if (Object.keys(combos).length) text.combos = combos;
  }
  return text;
}

/** The i18n block GET /api/workflows sends: generated from the dictionaries, then the definition's own overrides. */
export function workflowI18n(def: WorkflowDefinition): { ko: WorkflowText } {
  const ko = localize(def, KO);
  const own = def.i18n?.ko;
  return { ko: own ? { ...ko, ...own } : ko };
}

/** Every English string a definition sends that needs a translation (for the completeness test). */
export function englishStrings(def: WorkflowDefinition): string[] {
  const out = [def.label, def.description];
  for (const f of def.fields) {
    out.push(f.label);
    if (f.help) out.push(f.help);
    if (f.type === "enum") out.push(...f.options.map((o) => o.label));
  }
  out.push(...def.slots.flatMap((s) => [s.label, ...(s.description ? [s.description] : [])]));
  if (def.preset) out.push(def.preset.label, ...def.preset.requires.map((r) => r.label), ...def.preset.losses.map((l) => l.detail), ...(def.preset.billingNote ? [def.preset.billingNote] : []));
  for (const c of def.combos ?? []) out.push(c.label, ...(c.note ? [c.note] : []));
  return [...new Set(out)].filter((s) => !UNTRANSLATED.test(s));
}
