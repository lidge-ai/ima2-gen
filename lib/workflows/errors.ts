import type { MediaProviderError } from "../providers/media/contract.js";
import type { WorkflowErrorInfo } from "./types.js";

export interface WorkflowErrorOptions {
  status?: number;
  stepId?: string;
  category?: MediaProviderError["category"];
  retryable?: boolean;
  field?: string;
}

/** Coded workflow failure. Codes start with WORKFLOW_ or carry the adapter's own prefix. */
export class WorkflowError extends Error {
  readonly code: string;
  readonly status: number;
  readonly options: WorkflowErrorOptions;

  constructor(code: string, message: string, options: WorkflowErrorOptions = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.status = options.status ?? 400;
    this.options = options;
  }
}

export function inputError(field: string, message: string): WorkflowError {
  return new WorkflowError("WORKFLOW_INPUT_INVALID", field + ": " + message, { field, status: 400 });
}

/** Removes every secret value from a message. Secrets shorter than 6 chars are ignored to avoid shredding text. */
export function redact(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function fromProviderError(error: MediaProviderError, stepId: string, secrets: readonly string[]): WorkflowError {
  return new WorkflowError(error.code, redact(error.message, secrets), {
    stepId,
    category: error.category,
    retryable: error.retryable,
    ...(error.status === undefined ? {} : { status: error.status }),
  });
}

export function toErrorInfo(error: unknown, secrets: readonly string[] = []): WorkflowErrorInfo {
  if (error instanceof WorkflowError) {
    const info: WorkflowErrorInfo = {
      code: error.code,
      message: redact(error.message, secrets),
      retryable: error.options.retryable ?? false,
    };
    if (error.options.stepId) info.stepId = error.options.stepId;
    if (error.options.category) info.category = error.options.category;
    return info;
  }
  const message = error instanceof Error ? error.message : String(error);
  const coded = error as { code?: unknown; category?: unknown; retryable?: unknown } | null;
  if (coded && typeof coded.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(coded.code)) {
    const info: WorkflowErrorInfo = { code: coded.code, message: redact(message, secrets), retryable: coded.retryable === true };
    if (typeof coded.category === "string") info.category = coded.category as WorkflowErrorInfo["category"] & string;
    return info;
  }
  return { code: "WORKFLOW_INTERNAL", message: redact(message, secrets), retryable: false };
}
