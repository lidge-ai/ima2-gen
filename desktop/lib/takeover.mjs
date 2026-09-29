/**
 * Replace a native ima2 server with the bundled one: stop exactly the server the
 * user approved, through the bundled CLI, and prove the port is quiet before the
 * caller starts its own. This never signals a process itself.
 */

function identityOf(runtime) {
  return { pid: runtime?.pid, bootId: runtime?.bootId ?? null, startedAt: runtime?.startedAt ?? null };
}

function sameIdentity(a, b) {
  const x = identityOf(a);
  const y = identityOf(b);
  return x.pid === y.pid && x.bootId === y.bootId && x.startedAt === y.startedAt;
}

export function stopArgs(status) {
  const r = status.runtime;
  const args = ["stop", "--json", "--expect-pid", String(r.pid)];
  if (r.bootId) args.push("--expect-boot", r.bootId);
  else if (r.startedAt) args.push("--expect-started", String(r.startedAt));
  if (status.serviceOwnership === "managed") args.push("--service");
  return args;
}

async function waitQuiet(url, probe, { attempts = 20, needed = 3, delayMs = 250 } = {}) {
  let refused = 0;
  for (let i = 0; i < attempts && refused < needed; i++) {
    refused = (await probe(url)) === "refused" ? refused + 1 : 0;
    if (refused < needed) await new Promise((r) => setTimeout(r, delayMs));
  }
  return refused >= needed;
}

/**
 * @param approved the ima2-status/1 answer the user approved
 * @param resolve  () => Promise<{ok, status?, reason?}> — a fresh status answer
 * @param stop     (args) => Promise<{ok, report?, reason?}> — runs the bundled CLI stop
 * @param probe    (url) => Promise<"refused"|"answered"> — a raw liveness probe
 * @param cancelled () => boolean — true once the caller no longer wants this takeover
 */
export async function takeOver({ approved, resolve, stop, probe, quiet, cancelled = () => false }) {
  if (!approved?.stoppable || approved.serviceOwnership === "unknown" || !approved.runtime) {
    return { ok: false, reason: "this server cannot be taken over safely" };
  }
  const now = await resolve();
  // Checked right before the only destructive step: a quit or stop during the re-check wins.
  if (cancelled()) return { ok: false, cancelled: true, reason: "the takeover was cancelled" };
  if (!now.ok) return { ok: false, reason: now.reason };
  if (now.status.liveness !== "live" || !sameIdentity(now.status.runtime, approved.runtime)) {
    return { ok: false, reason: "the running server changed since you approved the takeover" };
  }
  const stopped = await stop(stopArgs(now.status));
  if (!stopped.ok) return { ok: false, reason: stopped.reason };
  if (!stopped.report.ok || !stopped.report.runtimeDown) return { ok: false, reason: stopped.report.message ?? "the stop was refused" };
  if (!(await waitQuiet(approved.runtime.url, probe, quiet))) return { ok: false, reason: "a server still answers after the stop" };
  return { ok: true };
}
