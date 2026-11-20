type AgentLlmProvider = "oauth" | "api" | "grok" | "agy";

export type AgentLlmModelOption = {
  value: string;
  shortLabel: string;
  fullLabel: string;
  provider: AgentLlmProvider;
};

export const AGENT_LLM_MODEL_OPTIONS: AgentLlmModelOption[] = [
  { value: "gpt-6-luna", shortLabel: "6l", fullLabel: "GPT-6 Luna", provider: "oauth" },
  { value: "gpt-6.1-terra", shortLabel: "6.1t", fullLabel: "GPT-6.1 Terra", provider: "oauth" },
  { value: "gpt-6.2-sol", shortLabel: "6.2s", fullLabel: "GPT-6.2 Sol", provider: "oauth" },
  { value: "gpt-6.2-astra", shortLabel: "6.2a", fullLabel: "GPT-6.2 Astra", provider: "oauth" },
  // grok-4.6 stays first: it is the fallback for an unknown saved Grok model.
  { value: "grok-4.6", shortLabel: "4.6", fullLabel: "Grok 4.6", provider: "grok" },
  { value: "grok-4.7", shortLabel: "4.7", fullLabel: "Grok 4.7", provider: "grok" },
  { value: "grok-4.5", shortLabel: "4.5", fullLabel: "Grok 4.5", provider: "grok" },
  { value: "grok-4.3", shortLabel: "4.3", fullLabel: "Grok 4.3", provider: "grok" },
];

export function getAgentLlmModelOption(settings: { model: string; provider: AgentLlmProvider }): AgentLlmModelOption {
  return AGENT_LLM_MODEL_OPTIONS.find((option) => option.value === settings.model)
    ?? AGENT_LLM_MODEL_OPTIONS.find((option) => option.provider === settings.provider)
    ?? AGENT_LLM_MODEL_OPTIONS[0];
}

export function agentModelProvider(option: AgentLlmModelOption, current: AgentLlmProvider): AgentLlmProvider {
  return option.provider === "oauth" && (current === "oauth" || current === "api") ? current : option.provider;
}
