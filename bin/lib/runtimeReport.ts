/**
 * Versioned JSON documents printed by `ima2 start|status --runtime|stop --json`.
 * Exactly one document goes to stdout; human text goes to stderr. The desktop
 * shell parses these, so a field rename is a wire break: bump the schema.
 */
import type { ManagerState, ServiceOwnership } from "./serviceManager.js";
import type { ResolveResult, RuntimeInfo } from "./runtime.js";

export const STATUS_SCHEMA = "ima2-status/1";
export const START_SCHEMA = "ima2-start/1";
export const STOP_SCHEMA = "ima2-stop/1";

/** LSB-style: 0 running, 3 not running, 1 unknown. */
export const STATUS_EXIT = { live: 0, "absent-proven": 3, unknown: 1 } as const;

export interface StatusReport {
  schema: typeof STATUS_SCHEMA;
  ok: boolean;
  liveness: ResolveResult["status"];
  source: ResolveResult["source"];
  runtime: RuntimeInfo | null;
  stoppable: boolean;
  advertiseStale: boolean;
  manager: ManagerState;
  serviceOwnership: ServiceOwnership;
  /** Whether the login service serves this config dir; null when there is no service or it cannot tell. */
  serviceSharesConfig: boolean | null;
  logFile: string;
  reason?: string;
}

export function buildStatusReport(
  resolved: ResolveResult,
  manager: ManagerState,
  serviceOwnership: ServiceOwnership,
  logFile: string,
  serviceSharesConfig: boolean | null = null,
): StatusReport {
  return {
    schema: STATUS_SCHEMA,
    ok: resolved.status !== "unknown",
    liveness: resolved.status,
    source: resolved.source,
    runtime: resolved.runtime,
    stoppable: resolved.stoppable,
    advertiseStale: resolved.advertiseStale,
    manager,
    serviceOwnership,
    serviceSharesConfig,
    logFile,
    ...(resolved.reason ? { reason: resolved.reason } : {}),
  };
}

export type StartOutcome = "started" | "already-running" | "refused" | "failed";

export interface StartReport {
  schema: typeof START_SCHEMA;
  ok: boolean;
  outcome: StartOutcome;
  pid: number | null;
  url: string | null;
  port: number | null;
  launcher: string | null;
  logFile: string;
  message: string;
}

export function buildStartReport(fields: Omit<StartReport, "schema" | "ok">): StartReport {
  const ok = fields.outcome === "started" || fields.outcome === "already-running";
  return { schema: START_SCHEMA, ok, ...fields };
}

export type StopOutcome = "stopped" | "not-running" | "refused" | "failed";
export type StopMethod = "graceful" | "term" | "kill" | "taskkill" | "service" | null;

export interface StopReport {
  schema: typeof STOP_SCHEMA;
  ok: boolean;
  outcome: StopOutcome;
  code?: string;
  method: StopMethod;
  pid: number | null;
  launcher: string | null;
  runtimeDown: boolean;
  message: string;
}

export function buildStopReport(fields: Omit<StopReport, "schema" | "ok">): StopReport {
  const ok = fields.outcome === "stopped" || fields.outcome === "not-running";
  return { schema: STOP_SCHEMA, ok, ...fields };
}

export function exitCodeForStop(report: StopReport): number {
  return report.ok ? 0 : 1;
}
