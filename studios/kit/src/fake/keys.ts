export class Keys {
  readonly keyed: Set<string>;
  readonly env: Set<string>;
  readonly secrets = new Set<string>();
  readonly extras = new Map<string, Set<string>>();
  constructor(initial: readonly string[], env: readonly string[] = []) {
    this.env = new Set(env);
    this.keyed = new Set([...initial, ...env]);
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
