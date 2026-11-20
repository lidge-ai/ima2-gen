export interface QuotaWindow {
  label: string;
  percent: number;
  resetsAt: string | null;
}

export interface QuotaResult {
  provider: string;
  account?: { email: string | null; plan: string | null } | null;
  windows: QuotaWindow[];
  error?: boolean;
  authenticated?: boolean;
  billing?: { usedUsd: number; limitUsd: number };
  nai?: {
    active: boolean;
    isNegative: boolean;
    anlasFixed: number;
    anlasPurchased: number;
    meter: "charge" | "missing";
  };
}

export interface QuotaResponse {
  codex?: QuotaResult;
  grok?: QuotaResult;
  nai?: QuotaResult;
}

export interface SwitchState {
  phase: "idle" | "starting" | "waiting" | "complete" | "error";
  flow?: "browser" | "device";
  userCode?: string;
  verificationUrl?: string;
  sessionId?: string;
  error?: string;
}
