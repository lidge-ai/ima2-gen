export interface MediaExtraField {
  name: string;
  secret: boolean;
  required: boolean;
  configured?: boolean;
  source?: string;
  value?: string | null;
}

export interface MediaVocabulary {
  vocabulary: string;
  label: string;
  logo?: { id: string; name: string; urls: Partial<Record<"primary" | "dark" | "light" | "mark", string>>; source: string | null } | null;
  legacy: boolean;
  consoleUrl: string;
  keyPrefix: string | null;
  extraFields: MediaExtraField[];
}

export interface MediaKeyStatus {
  configured: boolean;
  source: string;
  maskedKey: string | null;
  extraFields?: MediaExtraField[];
}

export interface MediaKeyAdapter {
  keyVocabulary: string;
  extraFields: MediaExtraField[];
}

export function extraFieldStatus(vocabulary: MediaVocabulary, status: MediaKeyStatus | undefined,
  adapters: MediaKeyAdapter[]): MediaExtraField[] {
  const observed = status?.extraFields ?? adapters.find((a) => a.keyVocabulary === vocabulary.vocabulary)?.extraFields ?? [];
  return vocabulary.extraFields.map((field) => ({ ...field, ...observed.find((entry) => entry.name === field.name) }));
}
