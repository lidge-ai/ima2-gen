import { migrateOAuthImageModel } from "../imageModels.js";
import {
  DEFAULT_PROMPT_BUILDER_MODELS,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  PROMPT_BUILDER_AUTO_ORDER,
  PROMPT_BUILDER_BACKENDS,
  PROMPT_BUILDER_MODELS,
  type PromptBuilderBackend,
  type ResolvedPromptBuilderBackend,
} from "./constants.js";
import { promptBuilderError } from "./errors.js";
import { normalizeAttachments } from "./attachments.js";
import type { PromptBuilderConfig, PromptBuilderMessage } from "./types.js";

export function normalizePromptBuilderBackend(
  raw: unknown,
  fallback: PromptBuilderBackend = "auto",
): PromptBuilderBackend {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "string") {
    const candidate = raw.trim();
    if (!candidate) return fallback;
    if (PROMPT_BUILDER_BACKENDS.includes(candidate as PromptBuilderBackend)) {
      return candidate as PromptBuilderBackend;
    }
  }
  throw promptBuilderError(
    `backend must be one of: ${PROMPT_BUILDER_BACKENDS.join(", ")}`,
    "PROMPT_BUILDER_BAD_BACKEND",
  );
}

export function normalizePromptBuilderModel(
  backend: PromptBuilderBackend,
  raw: unknown,
): string {
  const given = typeof raw === "string" && raw.trim()
    ? raw.trim()
    : DEFAULT_PROMPT_BUILDER_MODELS[backend];
  // Saved GPT OAuth settings from before GPT-6 keep working on the matching GPT-6 tier.
  const candidate = backend === "oauth" ? migrateOAuthImageModel(given) : given;
  if (!PROMPT_BUILDER_MODELS[backend].includes(candidate)) {
    throw promptBuilderError(
      `model for ${backend} must be one of: ${PROMPT_BUILDER_MODELS[backend].join(", ")}`,
      "PROMPT_BUILDER_BAD_MODEL",
    );
  }
  return candidate;
}

export function normalizeRequestModel(
  backend: PromptBuilderBackend,
  raw: unknown,
): string {
  const candidate = typeof raw === "string" && raw.trim() ? raw.trim() : "";
  if (backend === "auto" && candidate && candidate !== "auto") {
    if (!lanesForModel(candidate).length) {
      throw promptBuilderError(
        `model ${candidate} is not in any Prompt Builder catalog`,
        "PROMPT_BUILDER_BAD_MODEL",
      );
    }
    return candidate;
  }
  return normalizePromptBuilderModel(backend, candidate || undefined);
}

export function lanesForModel(model: string): ResolvedPromptBuilderBackend[] {
  // A legacy GPT OAuth id still routes to GPT OAuth, on its GPT-6 tier (see promptBuilderLaneModel).
  return PROMPT_BUILDER_AUTO_ORDER.filter(
    (lane) => PROMPT_BUILDER_MODELS[lane].includes(promptBuilderLaneModel(lane, model)),
  );
}

/** The model id a lane actually receives: GPT OAuth takes the GPT-6 tier of a legacy id. */
export function promptBuilderLaneModel(lane: ResolvedPromptBuilderBackend, model: string): string {
  return lane === "oauth" ? migrateOAuthImageModel(model) : model;
}

export function normalizePromptBuilderConfig(
  raw: unknown,
  current: PromptBuilderConfig,
): PromptBuilderConfig {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const backend = normalizePromptBuilderBackend(body.backend, current.backend);
  const modelInput = body.model === undefined && backend !== current.backend
    ? DEFAULT_PROMPT_BUILDER_MODELS[backend]
    : body.model ?? current.model;
  return { backend, model: normalizePromptBuilderModel(backend, modelInput) };
}

export function normalizeMessages(raw: unknown): PromptBuilderMessage[] {
  if (!Array.isArray(raw)) {
    throw promptBuilderError("messages must be an array", "PROMPT_BUILDER_BAD_MESSAGES");
  }
  const messages = raw.slice(-MAX_MESSAGES).map((message): PromptBuilderMessage => {
    if (!message || typeof message !== "object") {
      throw promptBuilderError("each message must be an object", "PROMPT_BUILDER_BAD_MESSAGES");
    }
    const item = message as { role?: unknown; content?: unknown; attachments?: unknown };
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    if (!role) {
      throw promptBuilderError(
        "message role must be user or assistant",
        "PROMPT_BUILDER_BAD_MESSAGES",
      );
    }
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content && role === "user") {
      throw promptBuilderError("message content is required", "PROMPT_BUILDER_EMPTY_MESSAGE");
    }
    return {
      role,
      content: content.slice(0, MAX_MESSAGE_CHARS),
      attachments: normalizeAttachments(item.attachments),
    };
  });
  const last = messages.at(-1);
  if (!last || last.role !== "user" || !last.content.trim()) {
    throw promptBuilderError(
      "last message must be a non-empty user message",
      "PROMPT_BUILDER_EMPTY_MESSAGE",
    );
  }
  return messages;
}
