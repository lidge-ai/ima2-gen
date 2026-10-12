import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  inspectTokenRecord,
  invalidateTokenRecord,
  makeTokenBinding,
  readTokenRecord,
  tokenBindingMatches,
  updateTokenRecord,
  type McpCredentialScope,
  type McpCurrentBinding,
  type McpTokenInspectionState,
  type McpTokenMutation,
  type McpTokenRecord,
} from "./tokenStore.js";

export interface ServerOAuthProvider extends OAuthClientProvider {
  readonly lastAuthorizationUrl: string | null;
  readonly bindingState: McpTokenInspectionState;
}

export class McpOAuthGenerationStaleError extends Error {
  constructor() { super("MCP_OAUTH_GENERATION_STALE"); this.name = "McpOAuthGenerationStaleError"; }
}

/** Frozen migration allowlist for records written before endpoint binding existed. */
const LEGACY_PROVIDER_ENDPOINTS: Record<string, string> = {
  runway: "https://mcp.runwayml.com/mcp",
  higgsfield: "https://mcp.higgsfield.ai/mcp",
};

export function legacyEndpointForProvider(provider: string): string | undefined {
  return LEGACY_PROVIDER_ENDPOINTS[provider];
}

function asRecord(value: OAuthClientInformationMixed | OAuthTokens): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

/**
 * SDK 1.31+ re-saves client information from earlier versions with an `issuer` stamp
 * before saving refreshed tokens. Same credentials mean a re-stamp, not a new registration.
 */
function isSameClient(previous: Record<string, unknown> | undefined, next: Record<string, unknown>): boolean {
  return previous !== undefined
    && typeof next.client_id === "string"
    && previous.client_id === next.client_id
    && previous.client_secret === next.client_secret;
}

export function createServerOAuthProvider(options: {
  provider: string;
  tokenDir: string;
  origin: string;
  endpoint: string;
  oauthState: string;
  isCurrent: () => boolean;
}): ServerOAuthProvider {
  const { provider, tokenDir, origin, endpoint, oauthState, isCurrent } = options;
  const current: McpCurrentBinding = {
    provider,
    endpoint,
    redirectOrigin: origin,
    legacyEndpoint: LEGACY_PROVIDER_ENDPOINTS[provider],
  };
  const inspection = inspectTokenRecord(tokenDir, provider, current);
  const redirectUrl = `${new URL(origin).origin}/api/mcp/oauth/callback`;
  let record: McpTokenRecord = readTokenRecord(tokenDir, provider) ?? {};
  let expectedRevision = inspection.revision;
  let verifier: string | undefined;
  let stagedClientInformation: Record<string, unknown> | undefined;
  let lastAuthorizationUrl: string | null = null;

  const ensureCurrent = () => {
    if (!isCurrent()) throw new McpOAuthGenerationStaleError();
  };
  const credentialsVisible = () => isCurrent()
    && inspection.state !== "corrupt"
    && !record.tombstone
    && tokenBindingMatches(record, current);
  const adopt = (mutation: McpTokenMutation) => {
    record = mutation.record;
    expectedRevision = mutation.revision;
  };
  const persist = (update: (value: McpTokenRecord) => McpTokenRecord) => {
    ensureCurrent();
    adopt(updateTokenRecord(tokenDir, provider, expectedRevision, update));
  };
  const invalidate = (scope: McpCredentialScope) => {
    ensureCurrent();
    if (scope === "verifier" || scope === "all") verifier = undefined;
    if (scope === "client" || scope === "all") stagedClientInformation = undefined;
    if (scope === "discovery" || (scope === "verifier" && !record.codeVerifier)) return;
    adopt(invalidateTokenRecord(tokenDir, provider, scope, expectedRevision));
  };

  const providerImpl: ServerOAuthProvider = {
    redirectUrl,
    clientMetadata: {
      client_name: "ima2-gen local studio",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    } satisfies OAuthClientMetadata,
    state: () => oauthState,
    clientInformation: () => stagedClientInformation as OAuthClientInformationMixed | undefined
      ?? (credentialsVisible() ? record.clientInformation as OAuthClientInformationMixed | undefined : undefined),
    saveClientInformation(info) {
      if (!tokenBindingMatches(record, current) || record.tombstone) {
        ensureCurrent();
        stagedClientInformation = asRecord(info);
        return;
      }
      persist((previous) => {
        const base = tokenBindingMatches(previous, current) && !previous.tombstone ? previous : {};
        if (isSameClient(base.clientInformation, asRecord(info))) {
          return { ...base, clientInformation: asRecord(info) };
        }
        return {
          ...base,
          binding: makeTokenBinding(current),
          clientInformation: asRecord(info),
          tokens: undefined,
          codeVerifier: undefined,
          origin: undefined,
          tombstone: undefined,
        };
      });
    },
    tokens: () => credentialsVisible() ? record.tokens as OAuthTokens | undefined : undefined,
    saveTokens(tokens) {
      persist((previous) => {
        const base = tokenBindingMatches(previous, current) && !previous.tombstone ? previous : {};
        return {
          ...base,
          binding: makeTokenBinding(current),
          ...(stagedClientInformation ? { clientInformation: stagedClientInformation } : {}),
          tokens: asRecord(tokens),
          codeVerifier: undefined,
          origin: undefined,
          tombstone: undefined,
        };
      });
      stagedClientInformation = undefined;
    },
    redirectToAuthorization(url) { ensureCurrent(); lastAuthorizationUrl = url.toString(); },
    saveCodeVerifier(value) { ensureCurrent(); verifier = value; },
    codeVerifier() {
      ensureCurrent();
      if (!verifier) throw new Error("MCP_OAUTH_VERIFIER_MISSING");
      return verifier;
    },
    invalidateCredentials: invalidate,
    get lastAuthorizationUrl() { return lastAuthorizationUrl; },
    get bindingState() { return inspection.state; },
  };
  return providerImpl;
}
