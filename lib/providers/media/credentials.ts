import { readFile } from "node:fs/promises";
import type { MediaCredentialSpec, MediaProviderAdapter } from "./contract.js";

export type MediaKeySource = "env" | "config" | "none";

export interface ResolvedMediaCredential {
  apiKey: string | undefined;
  source: MediaKeySource;
  extra: Record<string, string>;
  extraSources: Record<string, MediaKeySource>;
  /** Required extra fields with no value. */
  missingExtra: string[];
  /** Every secret value, for redaction. */
  secrets: string[];
  /** A secret extra field has a value (some vendors authenticate with an access-key pair alone). */
  hasSecretExtra: boolean;
  /** The route needs no key (MediaCredentialSpec.keyless). */
  keyless: boolean;
}

export interface MediaKeyLookup {
  env: Readonly<Record<string, string | undefined>>;
  fileConfig: Readonly<Record<string, unknown>>;
}

/** Legacy vocabularies keep the key names the server already reads (routes/keys.ts). */
export const LEGACY_KEY_VOCABULARIES = ["openai", "xai", "gemini", "atlascloud", "minimax", "nai", "vertex"] as const;

export async function readConfigFileSafe(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function storedExtras(fileConfig: Readonly<Record<string, unknown>>, vocabulary: string): Record<string, unknown> {
  const all = fileConfig.mediaKeyExtras;
  if (!all || typeof all !== "object") return {};
  const mine = (all as Record<string, unknown>)[vocabulary];
  return mine && typeof mine === "object" ? mine as Record<string, unknown> : {};
}

function resolveApiKey(spec: MediaCredentialSpec, lookup: MediaKeyLookup): { apiKey?: string; source: MediaKeySource } {
  for (const name of spec.envVars) {
    const v = nonEmpty(lookup.env[name]);
    if (v) return { apiKey: v, source: "env" };
  }
  const fromFile = nonEmpty(lookup.fileConfig[spec.configKey]);
  return fromFile ? { apiKey: fromFile, source: "config" } : { source: "none" };
}

/** env first, then config.json; extra fields from their own env var, then config.mediaKeyExtras. */
export function resolveMediaCredential(spec: MediaCredentialSpec, lookup: MediaKeyLookup): ResolvedMediaCredential {
  const key = resolveApiKey(spec, lookup);
  const stored = storedExtras(lookup.fileConfig, spec.keyVocabulary);
  const extra: Record<string, string> = {};
  const extraSources: Record<string, MediaKeySource> = {};
  const missingExtra: string[] = [];
  const secrets = key.apiKey ? [key.apiKey] : [];
  let hasSecretExtra = false;
  for (const field of spec.extraFields ?? []) {
    const fromEnv = nonEmpty(lookup.env[field.envVar]);
    const value = fromEnv ?? nonEmpty(stored[field.name]);
    extraSources[field.name] = fromEnv ? "env" : value ? "config" : "none";
    if (value) {
      extra[field.name] = value;
      if (field.secret) { secrets.push(value); hasSecretExtra = true; }
    } else if (field.required) {
      missingExtra.push(field.name);
    }
  }
  return { apiKey: key.apiKey, source: key.source, extra, extraSources, missingExtra, secrets, hasSecretExtra, keyless: spec.keyless === true };
}

/**
 * Usable when the main key or any secret extra field is set (L2: Kling's newer API key and
 * Tencent's SecretId/SecretKey are extras), and no required extra is missing. The adapter
 * reports a credential its chosen endpoint still lacks as its own auth error.
 * A keyless route is always usable here: it has nothing to be missing.
 */
export function credentialReady(resolved: ResolvedMediaCredential): boolean {
  if (resolved.keyless) return true;
  return (Boolean(resolved.apiKey) || resolved.hasSecretExtra) && resolved.missingExtra.length === 0;
}

/** One key-store entry per vocabulary; the first registered adapter defines it. Keyless routes have no entry. */
export function mediaKeyVocabularies(adapters: readonly MediaProviderAdapter[]): Map<string, MediaProviderAdapter> {
  const out = new Map<string, MediaProviderAdapter>();
  for (const adapter of adapters) {
    if (adapter.credential.keyless) continue;
    if (!out.has(adapter.credential.keyVocabulary)) out.set(adapter.credential.keyVocabulary, adapter);
  }
  return out;
}

/** Resolves credentials for many adapters against one env + config snapshot. */
export class MediaKeySnapshot {
  private readonly cache = new Map<string, ResolvedMediaCredential>();
  constructor(private readonly lookup: MediaKeyLookup) {}

  static async load(configFile: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<MediaKeySnapshot> {
    return new MediaKeySnapshot({ env, fileConfig: await readConfigFileSafe(configFile) });
  }

  resolve(adapter: MediaProviderAdapter): ResolvedMediaCredential {
    const hit = this.cache.get(adapter.id);
    if (hit) return hit;
    const resolved = resolveMediaCredential(adapter.credential, this.lookup);
    this.cache.set(adapter.id, resolved);
    return resolved;
  }

  hasKey(adapter: MediaProviderAdapter): boolean {
    return credentialReady(this.resolve(adapter));
  }
}
