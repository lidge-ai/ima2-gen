// Provider-aware composer reference-image limits. Mirrors the server's hard
// caps so users hit the boundary at attach time, not as a 400 at generate:
// - lib/generatePipeline.ts: grok/grok-api/agy/gemini-api image editing <= 3
// - routes/video.ts: grok ref2v <= MAX_REF2V_REFERENCES (7)
// - routes/mcpMedia.ts: MCP lane takes up to 3 references [{filename, tag}];
//   direct attachments ride POST /api/mcp/temp-references (batch upload into
//   generated storage), so the tray cap is 3 (composer-tray 010 A5).
// - lib/minimaxImageAdapter.ts: MiniMax takes a single subject_reference
// - gpt oauth/api: server capabilities.limits.maxRefCount (referenceLimit)
import type { Provider } from "../types";
import { isCoreProviderId, PROVIDER_REFERENCE_LIMITS, PROVIDER_SURFACE_SUPPORT } from "../generated/providers";

import { api88UiVideoSpec } from "./api88Video";

export const GROK_FAMILY_IMAGE_REF_LIMIT = PROVIDER_REFERENCE_LIMITS.grok.image;
export const MINIMAX_IMAGE_REF_LIMIT = PROVIDER_REFERENCE_LIMITS.minimax.image;
export const GROK_VIDEO_REF_LIMIT = PROVIDER_REFERENCE_LIMITS.grok.video;
export const MCP_REFERENCE_LIMIT = 3;

type LaneLimits = { readonly image?: number; readonly edit?: number; readonly video?: number };

// Every lane cap comes from the manifest by lookup, not by matching Grok's
// number. Value-matching silently dropped Atlas (10), so the tray allowed more
// references than lib/generatePipeline.ts accepts whenever serverLimit > 10.
function laneLimit(provider: Provider, mode: "image" | "video"): number | undefined {
  const limits = (PROVIDER_REFERENCE_LIMITS as Record<string, LaneLimits | undefined>)[provider];
  return limits?.[mode];
}

export function effectiveReferenceLimit(input: {
  provider: Provider;
  serverLimit: number;
  videoModelSelected: boolean | string;
  mcpProvider: string | null;
}): number {
  if (input.mcpProvider) return MCP_REFERENCE_LIMIT;
  if (input.videoModelSelected) {
    if (input.provider === "88api") {
      const spec = api88UiVideoSpec(input.videoModelSelected);
      return spec ? Math.min(input.serverLimit, spec.imageLimit) : 0;
    }
    const limit = laneLimit(input.provider, "video");
    return Math.min(input.serverLimit, limit ?? GROK_VIDEO_REF_LIMIT);
  }
  // An absent numeric cap is not the same as an unsupported reference input.
  if (isCoreProviderId(input.provider) && !PROVIDER_SURFACE_SUPPORT[input.provider].generate.references) return 0;
  const lane = laneLimit(input.provider, "image");
  return lane === undefined ? input.serverLimit : Math.min(input.serverLimit, lane);
}
