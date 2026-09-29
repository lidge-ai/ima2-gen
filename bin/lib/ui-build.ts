import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { resolveBin } from "./platform.js";

export type UiDistBuildStatus =
  | { needsBuild: false; reason: "fresh" | "source-missing" }
  | { needsBuild: true; reason: "missing" | "stale" }
  | { needsBuild: false; reason: "missing-source-and-dist"; error: string };

export type EnsureFreshUiDistResult =
  | { ok: true; built: boolean; reason: UiDistBuildStatus["reason"] }
  | { ok: false; reason: UiDistBuildStatus["reason"] | "build-failed"; error: string };

const SOURCE_DIRS = ["src", "public"];
const SOURCE_FILES = [
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
];

function latestMtimeMs(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = 0;
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".vite") continue;
    latest = Math.max(latest, latestMtimeMs(join(path, entry)));
  }
  return latest;
}

function latestUiSourceMtimeMs(uiDir: string): number {
  const sourceTimes = [
    ...SOURCE_DIRS.map((name) => latestMtimeMs(join(uiDir, name))),
    ...SOURCE_FILES.map((name) => latestMtimeMs(join(uiDir, name))),
  ];
  return Math.max(0, ...sourceTimes);
}

export function getUiDistBuildStatus(root: string): UiDistBuildStatus {
  const uiDir = join(root, "ui");
  const distIndex = join(uiDir, "dist", "index.html");
  const hasUiSource = existsSync(join(uiDir, "package.json"));

  if (!existsSync(distIndex)) {
    if (hasUiSource) return { needsBuild: true, reason: "missing" };
    return {
      needsBuild: false,
      reason: "missing-source-and-dist",
      error: "ui/dist not found and ui/ source is missing.",
    };
  }

  if (!hasUiSource) return { needsBuild: false, reason: "source-missing" };

  const distMtime = statSync(distIndex).mtimeMs;
  const sourceMtime = latestUiSourceMtimeMs(uiDir);
  if (sourceMtime > distMtime + 1000) return { needsBuild: true, reason: "stale" };
  return { needsBuild: false, reason: "fresh" };
}

/**
 * `toStderr` keeps stdout clean for commands whose stdout is a JSON document
 * (`ima2 start --json`): the notice and the build's own output go to stderr.
 */
export function ensureFreshUiDist(root: string, { toStderr = false }: { toStderr?: boolean } = {}): EnsureFreshUiDistResult {
  const status = getUiDistBuildStatus(root);
  if (!status.needsBuild) {
    if ("error" in status) return { ok: false, reason: status.reason, error: status.error };
    return { ok: true, built: false, reason: status.reason };
  }

  const reason = status.reason === "missing" ? "missing" : "stale";
  (toStderr ? console.error : console.log)(`\n  ui/dist ${reason} — running 'npm run build' first...\n`);
  try {
    execSync(`${resolveBin("npm")} run build`, { stdio: toStderr ? ["inherit", 2, 2] : "inherit", cwd: root });
    return { ok: true, built: true, reason };
  } catch {
    return { ok: false, reason: "build-failed", error: "Build failed. Try: cd ui && npm install && npm run build" };
  }
}
