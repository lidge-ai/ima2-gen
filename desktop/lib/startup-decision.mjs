import { realpathSync } from "node:fs";

/**
 * What the desktop does at startup with whatever ima2 server is already there.
 * Pure: the inputs are the bundled CLI's ima2-status/1 answer and the settings.
 * Only a proven absence with no login service about to start a server leads to
 * a spawn; anything uncertain blocks instead of starting a second server.
 */
export const EXISTING_SERVER_CHOICES = ["ask", "attach", "takeover"];

function same(a, b, realpath) {
  try {
    return realpath(a) === realpath(b);
  } catch {
    return false;
  }
}

/** A runtime is ours when the desktop launched it from this same app bundle. */
export function classifyRuntime(runtime, bundledRoot, realpath = realpathSync) {
  if (!runtime || runtime.launcher !== "desktop" || !runtime.root) return "native";
  return same(runtime.root, bundledRoot, realpath) ? "bundled" : "native";
}

/** Why a native runtime cannot be taken over, or null when it can. */
export function takeoverBlocker(status) {
  if (!status.stoppable) return "it was found by port scan without ~/.ima2/server.json, so it cannot be stopped safely";
  if (status.serviceOwnership === "unknown") return "cannot tell whether a login service manages it";
  return null;
}

/** @param parsed the parseStatus() result: {ok:true, status} or {ok:false, reason} */
export function decideStartup({ parsed, bundledRoot, existingServer = "ask", origin = "user", realpath = realpathSync }) {
  if (!parsed?.ok) return { action: "blocked", reason: parsed?.reason ?? "the bundled CLI could not report the runtime" };
  const status = parsed.status;
  if (status.liveness === "unknown") return { action: "blocked", reason: `an ima2 server may be running but cannot be identified: ${status.reason ?? "unknown"}` };
  if (status.liveness === "absent-proven") return decideAbsent(status);
  const kind = classifyRuntime(status.runtime, bundledRoot, realpath);
  if (kind === "bundled") return { action: "attach-bundled" };
  const blocker = takeoverBlocker(status);
  if (blocker) return { action: "attach-guest", reason: `takeover unavailable: ${blocker}` };
  if (existingServer === "attach") return { action: "attach-guest" };
  if (existingServer === "takeover") return { action: "takeover" };
  return origin === "login" ? { action: "attach-guest" } : { action: "ask" };
}

/** Nothing answers. Wait only for a login service that serves this same config dir. */
function decideAbsent({ manager, serviceSharesConfig }) {
  if (manager?.state === "unknown") return { action: "blocked", reason: `cannot tell whether a login service is about to start a server: ${manager.reason ?? ""}`.trim() };
  if (manager?.state === "bound" && manager.active && serviceSharesConfig !== false) return { action: "wait-service" };
  return { action: "start" };
}
