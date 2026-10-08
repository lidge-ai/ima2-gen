export type KeyProviderId = "openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai";

export type ProviderVendor = "openai" | "xai" | "google" | "atlascloud" | "88api" | "minimax" | "novelai" | "comfy";
export type ProviderModelKind = "image" | "video";
export type ProviderReferenceMode = "image" | "edit" | "video";
export type ProviderSurface = "generate" | "edit" | "multimode" | "node" | "video";
/** Application support, independent of current credentials and availability. */
export interface ProviderSurfaceSupport {
  supported: boolean;
  references: boolean;
  mask: boolean;
  streaming: boolean;
  catalogAccess: "static" | "runtime";
}
export type ElementTaxonomy = "gpt" | "gemini" | "grok";

export type ProviderCredential =
  | {
      kind: "api-key";
      keyVocabulary: KeyProviderId;
      envVars: readonly string[];
      keyPrefix?: string;
      validateUrl?: string;
      /**
       * Set when the runtime picks the validation endpoint per request instead
       * of using `validateUrl` verbatim (MiniMax resolves a region-aware host in
       * routes/keys.ts). `validateUrl` is then a documented fallback, not the
       * value actually called.
       */
      validateUrlIsFallback?: boolean;
      configKey?: string;
    }
  | { kind: "oauth-proxy"; envVars: readonly string[]; configKey?: string }
  /**
   * A first-party OAuth session this process owns end to end: ima2 runs the
   * device-code login, writes `authFile`, refreshes it, and signs each request.
   * Distinct from "oauth-proxy", where a separate local process holds the
   * session and ima2 only forwards to it, and it has no env vars because the
   * credential lives in a file rather than the environment.
   */
  | { kind: "oauth"; authFile: string }
  | { kind: "service-account"; envVars: readonly string[]; configKey?: string }
  | { kind: "local-cli"; envVars: readonly string[]; optionalApiKeyEnv?: string }
  /**
   * A user-run local HTTP server with no credential of its own.
   *
   * Distinct from "oauth-proxy": ima2 neither spawns nor supervises it.
   * Distinct from "local-cli": it is reached over HTTP, so its env var holds a
   * URL, not a filesystem path — inspecting one with existsSync reports a
   * missing file for a perfectly good origin.
   */
  | { kind: "local-http"; envVars: readonly string[]; configKey?: string };

export interface CoreProviderModel {
  id: string;
  aliases?: readonly string[];
  kind: ProviderModelKind;
  status?: "unverified";
  /**
   * Capabilities as the ACTIVE request path behaves, traced to the route that
   * serves the lane — not to dormant helpers. `mask` is true only when
   * routes/edit.ts lets the lane through to an adapter that accepts a mask.
   */
  supports: { generate: boolean; edit: boolean; mask: boolean; streaming: boolean };
}

export interface CoreProviderManifestBase {
  id: string;
  surfaces: readonly ProviderSurface[];
  vendor: ProviderVendor;
  credentials: readonly ProviderCredential[];
  models: readonly CoreProviderModel[];
  /**
   * How to read `models`.
   *
   * "static" (the default when absent) means `models` is the whole truth.
   * "runtime" means `models` is empty BY CONSTRUCTION and the real list lives
   * in a runtime store, because the set is user-authored and cannot exist at
   * compile time. Consumers that compare a lane's models against the registry
   * must branch on this, or they assert empty-equals-empty and protect nothing.
   *
   * Deliberately NOT the same field as lib/mcp/providerRegistry.ts's
   * McpCatalogAccess ("static" | "connected"), which solves the same temporal
   * problem for remote MCP servers in a different module. Do not wire a core
   * lane into the MCP branch on the strength of the shared name.
   */
  catalogAccess?: "static" | "runtime";
  referenceLimits: Partial<Record<ProviderReferenceMode, number>>;
  elementTaxonomy: ElementTaxonomy | null;
  limits: { timeoutMs: number; maxInputBytes?: number };
  errorPrefix: string | null;
}

export type CoreProviderManifest<Id extends string = string> =
  Omit<CoreProviderManifestBase, "id"> & { id: Id };
