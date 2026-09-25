import type { AgentGenerationSettings } from "../components/agent/agentTypes";
import { MAX_GENERATION_COUNT } from "./generationLimits";
import { DEFAULT_IMAGE_MODEL } from "./imageModels";

export const MAX_AGENT_VARIANTS = MAX_GENERATION_COUNT;
export const MAX_AGENT_PARALLELISM = MAX_GENERATION_COUNT;

export const DEFAULT_AGENT_GENERATION_SETTINGS: AgentGenerationSettings = {
  provider: "oauth",
  model: DEFAULT_IMAGE_MODEL,
  quality: "medium",
  size: "1024x1024",
  format: "png",
  moderation: "low",
  reasoningEffort: "none",
  webSearchEnabled: true,
  generationStrategy: "auto",
  variants: 1,
  maxAutoVariants: MAX_AGENT_VARIANTS,
  parallelism: 2,
};

export function withAgentGenerationDefaults(
  value: Partial<AgentGenerationSettings> | null | undefined,
): AgentGenerationSettings {
  return {
    ...DEFAULT_AGENT_GENERATION_SETTINGS,
    ...(value ?? {}),
  };
}
