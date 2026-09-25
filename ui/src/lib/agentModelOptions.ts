type AgentLlmProvider = "oauth" | "api" | "grok" | "agy";

export type AgentLlmModelOption = {
  value: string;
  shortLabel: string;
  fullLabel: string;
  provider: AgentLlmProvider;
};

export const AGENT_LLM_MODEL_OPTIONS: AgentLlmModelOption[] = [
  { value: "gpt-6-luna", shortLabel: "6l", fullLabel: "GPT-6 Luna", provider: "oauth" },
  { value: "gpt-6-sol", shortLabel: "6s", fullLabel: "GPT-6 Sol", provider: "oauth" },
  { value: "gpt-6-astra", shortLabel: "6a", fullLabel: "GPT-6 Astra", provider: "oauth" },
  { value: "grok-4.6", shortLabel: "4.6", fullLabel: "Grok 4.6", provider: "grok" },
  { value: "grok-4.5", shortLabel: "4.5", fullLabel: "Grok 4.5", provider: "grok" },
  { value: "grok-4.3", shortLabel: "4.3", fullLabel: "Grok 4.3", provider: "grok" },
];

export function getAgentLlmModelOption(settings: { model: string; provider: AgentLlmProvider }): AgentLlmModelOption {
  return AGENT_LLM_MODEL_OPTIONS.find((option) => option.value === settings.model)
    ?? AGENT_LLM_MODEL_OPTIONS.find((option) => option.provider === settings.provider)
    ?? AGENT_LLM_MODEL_OPTIONS[0];
}
