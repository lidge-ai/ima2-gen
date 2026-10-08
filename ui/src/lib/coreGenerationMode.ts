import { isCoreProviderId, PROVIDER_SURFACE_SUPPORT } from "../generated/providers";

import { isVideoModelValue } from "./imageModels";

export type CoreGenerationMode = "image" | "multimode" | "video";

/** Derived execution meaning, shared by dispatch and core composer chrome. */
export function effectiveCoreGenerationMode(input: {
  provider: string;
  uiMode: string;
  multimode: boolean;
  videoModelSelected?: string | false | null;
  comfyVideoWorkflow?: string | null;
}): CoreGenerationMode {
  if ((input.provider === "comfy" && input.comfyVideoWorkflow)
    || isVideoModelValue(input.videoModelSelected, input.provider)) {
    return "video";
  }
  if (input.uiMode === "classic" && input.multimode && input.provider !== "nai"
    && isCoreProviderId(input.provider) && PROVIDER_SURFACE_SUPPORT[input.provider].multimode.supported) {
    return "multimode";
  }
  return "image";
}

/** MCP dispatch is owned separately; retain its existing composer preference. */
export function composerUsesMultimode(
  input: Parameters<typeof effectiveCoreGenerationMode>[0] & { mcpProvider?: string | null },
): boolean {
  return input.mcpProvider ? input.multimode : effectiveCoreGenerationMode(input) === "multimode";
}
