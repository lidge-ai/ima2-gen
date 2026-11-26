import type { CatalogProvider, KeyStatus } from "../types.ts";
export class Keys {
  readonly keyed: Set<string>;
  readonly secrets = new Set<string>();
  readonly extras = new Map<string, Set<string>>();
  constructor(initial: readonly string[]) {
    this.keyed = new Set(initial);
  }
  status(provider: CatalogProvider): KeyStatus {
    const configured = this.keyed.has(provider.id);
    return {
      keyVocabulary: provider.keyVocabulary,
      providerIds: [provider.id],
      configured,
      source: configured ? "config" : null,
      extraFields: (provider.extraFields ?? []).map((f) => ({
        ...f,
        configured: this.extras.get(provider.id)?.has(f.name) ?? false,
      })),
    };
  }
  scrub<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item !== "string") return item;
        let result = item;
        for (const secret of this.secrets) if (secret) result = result.split(secret).join("[redacted]");
        return result;
      }),
    ) as T;
  }
}
