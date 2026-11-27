/**
 * Earlier names of a studio folder. A renamed studio keeps answering to its old name, so
 * bookmarks (/studio/<old>/...), IMA2_DEFAULT_UI, a saved ui.defaultUi and the CLI keep working.
 */
export const STUDIO_ALIASES: Readonly<Record<string, string>> = { higgs: "main" };

/** The current folder name for a studio name or one of its earlier names. */
export function studioName(name: string): string {
  return Object.hasOwn(STUDIO_ALIASES, name) ? STUDIO_ALIASES[name]! : name;
}
