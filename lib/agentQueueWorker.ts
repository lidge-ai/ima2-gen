import { config } from "../config.js";
import {
  claimNextAgentQueueItem,
  completeAgentQueueItem,
  failAgentQueueItem,
  getAgentQueueItem,
  cancelAgentQueueItem,
  recoverRunningAgentQueueItems,
  updateAgentQueueItemProgress,
  updateAgentQueueItemPlan,
  type AgentQueueLimits,
} from "./agentQueueStore.js";
import { requestAgentPlanFromModel } from "./agentPlannerModel.js";
import { hasAgentErrorTurnRecorded, runAgentGenerationPlan } from "./agentRuntime.js";
import { appendAgentTurn } from "./agentStore.js";
import type { AgentGenerationPlan, AgentQueueItem } from "./agentTypes.js";
import { errInfo } from "./errInfo.js";
import { finishJob, isStartJobFailure, setJobPhase, startJob } from "./inflight.js";
import { logEvent } from "./logger.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { errorEnvelopeFields } from "./errors/envelope.js";

const DEFAULT_LIMITS: AgentQueueLimits = {
  maxGlobalRunning: 2,
  maxSessionRunning: 1,
};

/** Read by tests/helpers/processGuard.mjs: a ticking worker reopens a database that was just closed. */
const RUNNING = Symbol.for("ima2.agentQueueWorker");
let workerTimer: NodeJS.Timeout | null = null;
let ticking = false;
let startupRecovered = false;
const runningControllers = new Map<string, AbortController>();

const IMAGE_TIMEOUT_MS = 10 * 60 * 1_000;
const VIDEO_TIMEOUT_MS = 30 * 60 * 1_000;

export function ensureAgentQueueWorker(ctx: RuntimeContext) {
  if (!startupRecovered) {
    recoverRunningAgentQueueItems();
    startupRecovered = true;
  }
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void tickAgentQueueWorker(ctx);
  }, 1_500);
  workerTimer.unref?.();
  (globalThis as Record<symbol, unknown>)[RUNNING] = true;
  void tickAgentQueueWorker(ctx);
}

export function stopAgentQueueWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    delete (globalThis as Record<symbol, unknown>)[RUNNING];
  }
  for (const controller of runningControllers.values()) controller.abort("Worker stopped");
  runningControllers.clear();
}

export function cancelRunningAgentQueueItem(id: string, reason = "Canceled by user") {
  const item = getAgentQueueItem(id);
  if (!item || (item.status !== "queued" && item.status !== "running")) return false;
  const canceled = cancelAgentQueueItem(id, reason);
  if (canceled && item.status === "running") runningControllers.get(id)?.abort(reason);
  return canceled;
}

export async function tickAgentQueueWorker(ctx: RuntimeContext) {
  if (ticking) return;
  ticking = true;
  try {
    while (true) {
      const item = claimNextAgentQueueItem(DEFAULT_LIMITS);
      if (!item) return;
      void runClaimedQueueItem(ctx, item.id).finally(() => {
        void tickAgentQueueWorker(ctx);
      });
    }
  } finally {
    ticking = false;
  }
}

// LLM planning runs only for plans the regex deriver produced automatically.
// Slash commands, manual settings, agy sessions, and already-LLM-planned
// retries keep their stored plan (audit decision F4/F5).
function isLlmPlanningEligible(item: AgentQueueItem): boolean {
  return Boolean(
    config.agentPlanner.enabled &&
    (item.plan.source === "auto-default" || item.plan.source === "auto-request") &&
    item.plan.command == null &&
    item.options.generationStrategy === "auto" &&
    item.options.provider !== "agy",
  );
}

async function resolveRuntimePlan(ctx: RuntimeContext, item: AgentQueueItem): Promise<AgentGenerationPlan> {
  if (!isLlmPlanningEligible(item)) return item.plan;
  try {
    const plan = await requestAgentPlanFromModel(ctx, {
      sessionId: item.sessionId,
      prompt: item.prompt,
      settings: item.options,
      requestId: item.requestId,
    });
    if (!plan) return item.plan;
    updateAgentQueueItemPlan(item.id, plan);
    return plan;
  } catch (error) {
    const err = errInfo(error);
    logEvent("agent_queue", "planner_fallback", { itemId: item.id, code: err.code, message: err.message });
    return item.plan;
  }
}

async function runClaimedQueueItem(ctx: RuntimeContext, itemId: string) {
  const item = getAgentQueueItem(itemId);
  if (!item) return;
  const controller = new AbortController();
  runningControllers.set(item.id, controller);
  const plan = await resolveRuntimePlan(ctx, item);
  if (controller.signal.aborted) {
    runningControllers.delete(item.id);
    return;
  }
  const timeoutMs = plan.mode === "video" ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort("timeout"), timeoutMs);
  timeout.unref?.();
 const signal = combineAbortSignals(controller.signal, timeoutController.signal);
  const started = startJob({
   requestId: item.requestId,
   kind: "agent_queue",
   prompt: item.prompt,
    meta: {
      sessionId: item.sessionId,
      queueItemId: item.id,
      variants: plan.plannedVariants,
      parallelism: plan.plannedParallelism,
     requestedVariants: plan.requestedVariants,
   },
 });
  if (started && isStartJobFailure(started)) {
    clearTimeout(timeout);
    runningControllers.delete(item.id);
    const reason = started.code === "TOO_MANY_JOBS"
      ? "Too many concurrent generation jobs"
      : "Request ID already in use";
    failAgentQueueItem(item.id, { code: started.code, message: reason });
    return;
  }
 try {
    logEvent("agent_queue", "start", { itemId: item.id, sessionId: item.sessionId });
    setJobPhase(item.requestId, "streaming");
    const result = await runAgentGenerationPlan(ctx, item.sessionId, item.prompt, plan, {
      ...item.options,
      requestId: item.requestId,
      webSearchEnabled: item.options.webSearchEnabled,
      parallelism: plan.plannedParallelism,
      signal,
      onProgressStage: (stage) => { updateAgentQueueItemProgress(item.id, stage); },
    }, {
      appendUserTurn: false,
    });
    completeAgentQueueItem(item.id, result.imageIds);
    finishJob(item.requestId, {
      status: "completed",
      meta: { imageIds: result.imageIds },
    });
    logEvent("agent_queue", "finish", { itemId: item.id, imageCount: result.imageIds.length });
  } catch (error) {
    const current = getAgentQueueItem(item.id);
    if (current?.status === "canceled") {
      finishJob(item.requestId, {
        status: "canceled",
        errorCode: "canceled",
        meta: { queueItemId: item.id },
      });
      logEvent("agent_queue", "canceled", { itemId: item.id, reason: current.errorMessage });
      return;
    }
    const err = errInfo(error);
    const timedOut = timeoutController.signal.aborted;
    const envelope = errorEnvelopeFields(err.raw) as { errorClass?: string; rawCode?: string };
    const failure = timedOut
      ? { code: "timeout", message: "timeout" }
      // rawCode must reach the DB: the Agent composer reads the QUEUE, so without it
      // the user only ever sees the generic wrapper code (issue #192).
      : { code: err.code, message: err.message, ...envelope };
    failAgentQueueItem(item.id, failure);
    // The chat pane must never fail silently — surface the failure as an
    // assistant error turn unless the runtime already recorded one.
    if (!hasAgentErrorTurnRecorded(error)) {
      try {
        appendAgentTurn({
          sessionId: item.sessionId,
          role: "assistant",
          text: failure.code ? `${failure.message} [${failure.code}]` : failure.message,
          status: "error",
        });
      } catch (turnError) {
        logEvent("agent_queue", "error_turn_failed", { itemId: item.id, message: errInfo(turnError).message });
      }
    }
    finishJob(item.requestId, {
      status: "failed",
      errorCode: failure.code,
      meta: { queueItemId: item.id },
    });
    logEvent("agent_queue", "error", { itemId: item.id, code: failure.code, message: failure.message });
  } finally {
    clearTimeout(timeout);
    runningControllers.delete(item.id);
  }
}

function combineAbortSignals(...signals: AbortSignal[]) {
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) abort(signal);
    else signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}
