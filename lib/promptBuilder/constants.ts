export const PROMPT_BUILDER_BACKENDS = ["auto", "oauth", "grok", "api", "grok-api"] as const;
export type PromptBuilderBackend = (typeof PROMPT_BUILDER_BACKENDS)[number];
export type ResolvedPromptBuilderBackend = Exclude<PromptBuilderBackend, "auto">;

// GPT OAuth runs GPT-6 only; the API-key lane keeps the models the OpenAI API serves.
const OAUTH_GPT_MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"] as const;
const API_GPT_MODELS = ["gpt-5.6-luna", "gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"] as const;
const grokModels = ["grok-4.3", "grok-4.6", "grok-4.5"] as const;

export const PROMPT_BUILDER_MODELS: Record<PromptBuilderBackend, readonly string[]> = {
  auto: ["auto"],
  oauth: OAUTH_GPT_MODELS,
  grok: grokModels,
  api: API_GPT_MODELS,
  "grok-api": grokModels,
};
export const DEFAULT_PROMPT_BUILDER_MODELS: Record<PromptBuilderBackend, string> = {
  auto: "auto",
  oauth: "gpt-6-luna",
  grok: "grok-4.3",
  api: "gpt-5.6-luna",
  "grok-api": "grok-4.3",
};
export const PROMPT_BUILDER_AUTO_ORDER: readonly ResolvedPromptBuilderBackend[] = [
  "oauth", "grok", "api", "grok-api",
];
export const MAX_MESSAGES = 24;
export const MAX_MESSAGE_CHARS = 16_000;
export const MAX_ATTACHMENTS = 6;
export const MAX_TEXT_ATTACHMENT_CHARS = 20_000;
export const MAX_ATTACHMENT_NAME_CHARS = 160;
export const MAX_ATTACHMENT_MIME_CHARS = 120;
export const PROMPT_BUILDER_RESPONSE_MAX_OUTPUT_TOKENS = 2400;
