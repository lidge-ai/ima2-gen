export interface QuotaWindow {
  id?: string;
  label: string | null;
  percent: number | null;
  resetsAt: string | null;
}

export interface QuotaResult {
  provider: string;
  account?: { email: string | null; plan: string | null } | null;
  windows: QuotaWindow[];
  error?: boolean;
  authenticated?: boolean;
  billing?: { usedUsd: number; limitUsd: number };
  credits?: { balance: string | number | null; unlimited: boolean; hasCredits: boolean; overage?: boolean; approxMessages?: number | null } | null;
  resetCredits?: { availableCount: number | null; applicableAvailableCount: number | null } | null;
  upsell?: { buyReset?: boolean; viewUsage?: boolean } | null;
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
