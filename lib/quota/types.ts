export interface QuotaWindow {
  id?: string;
  durationSeconds?: number | null;
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
  credits?: { hasCredits: boolean; unlimited: boolean; balance: string | number | null } | null;
  resetCredits?: { availableCount: number | null; applicableAvailableCount: number | null } | null;
  upsell?: { buyReset: boolean; viewUsage: boolean } | null;
  billing?: { usedUsd: number; limitUsd: number };
  nai?: { active: boolean; isNegative: boolean; anlasFixed: number; anlasPurchased: number; meter: "charge" | "missing" };
}
