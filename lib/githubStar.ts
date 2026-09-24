/**
 * GitHub star state shared by the CLI prompt (bin/lib/star-prompt.ts) and the
 * studio's star dialog (routes/github.ts).
 *
 * Starring always goes through the user's own `gh` login; ima2 never holds a
 * GitHub token. Both surfaces build their gh arguments here and share one
 * "prompted" state file, so answering once in either place quiets the other.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, posix, win32 } from "node:path";
import { homedir } from "node:os";
import { config } from "../config.js";

export const STAR_REPO = "lidge-jun/ima2-gen";
export const STAR_REPO_URL = `https://github.com/${STAR_REPO}`;
/** Pinned so a GHES login cannot answer (or be starred) for a same-named repository. */
export const GH_HOSTNAME = "github.com";

const CACHE_TTL_MS = 10 * 60_000;
const AUTH_TIMEOUT_MS = 5_000;
const API_TIMEOUT_MS = 10_000;

export type StarState = "starred" | "not-starred" | "unauthenticated";
/** `state` is null once the prompt was answered: the prompt never reopens, so gh is not asked again. */
export interface StarStatus { state: StarState | null; prompted: boolean; repo: string; url: string }
/** `code` is set only when `ok` is false. One shape so non-strict consumers need no narrowing. */
export interface StarWriteResult { ok: boolean; code?: "gh_unauthenticated" | "gh_failed" }

export interface StarDeps {
  /** Runs gh; resolves null when gh is unavailable. Output is never captured. */
  runGh(args: string[], timeoutMs: number): Promise<{ status: number | null } | null>;
  nowMs(): number;
  statePath(): string;
}

export function ghVersionArgs(): string[] {
  return ["--version"];
}

export function ghAuthStatusArgs(hostname?: string): string[] {
  return hostname ? ["auth", "status", "--hostname", hostname] : ["auth", "status"];
}

export function ghStarredProbeArgs(): string[] {
  return ["api", "--hostname", GH_HOSTNAME, `/user/starred/${STAR_REPO}`];
}

export function ghStarWriteArgs(hostname?: string): string[] {
  const path = `/user/starred/${STAR_REPO}`;
  return hostname ? ["api", "--hostname", hostname, "-X", "PUT", path] : ["api", "-X", "PUT", path];
}

export function starPromptStatePath(): string {
  return join(config.storage.configDir, "state", "star-prompt.json");
}

export async function hasBeenPrompted(path = starPromptStatePath()): Promise<boolean> {
  if (!existsSync(path)) return false;
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    return typeof state.prompted_at === "string";
  } catch {
    return false;
  }
}

export async function markPrompted(path = starPromptStatePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ prompted_at: new Date().toISOString() }, null, 2));
}

/** Literal install roots only: the server never resolves gh through the caller's PATH. */
export function trustedGhDirectories(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return ["C:\\Program Files\\GitHub CLI", "C:\\Program Files (x86)\\GitHub CLI"];
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/opt/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/snap/bin",
    "/run/current-system/sw/bin",
  ];
}

export function resolveTrustedGh(
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const paths = platform === "win32" ? win32 : posix;
  const name = platform === "win32" ? "gh.exe" : "gh";
  for (const dir of trustedGhDirectories(platform)) {
    const candidate = paths.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

async function spawnGh(args: string[], timeoutMs: number): Promise<{ status: number | null } | null> {
  const executable = resolveTrustedGh();
  if (!executable) return null;
  const pathApi = process.platform === "win32" ? win32 : posix;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  // gh's own directory plus system tools only: credential helpers and the macOS keychain
  // (/usr/bin/security) still resolve, while the caller's PATH never picks the binary.
  const systemDirs = process.platform === "win32" ? [] : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  env.PATH = [pathApi.dirname(executable), ...systemDirs].join(delimiter);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: { status: number | null } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, { cwd: homedir(), env, stdio: "ignore", windowsHide: true, shell: false });
    } catch {
      settle(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(null);
    }, timeoutMs);
    child.once("error", () => { clearTimeout(timer); settle(null); });
    child.once("exit", (code) => { clearTimeout(timer); settle({ status: code }); });
  });
}

const productionDeps: StarDeps = { runGh: spawnGh, nowMs: () => Date.now(), statePath: starPromptStatePath };
let defaultDeps: StarDeps = productionDeps;
let cached: { at: number; state: StarState } | null = null;
let inflight: Promise<StarState> | null = null;
/** Bumped by every star write; a probe that started earlier must not overwrite its result. */
let generation = 0;

export async function probeStarState(deps: StarDeps = defaultDeps): Promise<StarState> {
  const auth = await deps.runGh(ghAuthStatusArgs(GH_HOSTNAME), AUTH_TIMEOUT_MS);
  if (!auth || auth.status !== 0) return "unauthenticated";
  const probe = await deps.runGh(ghStarredProbeArgs(), API_TIMEOUT_MS);
  if (!probe) return "unauthenticated";
  return probe.status === 0 ? "starred" : "not-starred";
}

async function cachedStarState(deps: StarDeps): Promise<StarState> {
  const now = deps.nowMs();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;
  if (!inflight) {
    const startedGeneration = generation;
    const probe = probeStarState(deps).then(
      (state) => {
        if (inflight === probe) inflight = null;
        if (startedGeneration !== generation) return cached?.state ?? state;
        cached = { at: now, state };
        return state;
      },
      (error) => {
        if (inflight === probe) inflight = null;
        throw error;
      },
    );
    inflight = probe;
  }
  return inflight;
}

export async function getStarStatus(deps: StarDeps = defaultDeps): Promise<StarStatus> {
  const prompted = await hasBeenPrompted(deps.statePath());
  const state = prompted ? null : await cachedStarState(deps);
  return { state, prompted, repo: STAR_REPO, url: STAR_REPO_URL };
}

export async function starRepository(deps: StarDeps = defaultDeps): Promise<StarWriteResult> {
  const auth = await deps.runGh(ghAuthStatusArgs(GH_HOSTNAME), AUTH_TIMEOUT_MS);
  if (!auth || auth.status !== 0) return { ok: false, code: "gh_unauthenticated" };
  const write = await deps.runGh(ghStarWriteArgs(GH_HOSTNAME), API_TIMEOUT_MS);
  if (!write || write.status !== 0) return { ok: false, code: "gh_failed" };
  generation += 1;
  inflight = null;
  cached = { at: deps.nowMs(), state: "starred" };
  // The star already landed; an unwritable config dir must not report it as a failure.
  await markPrompted(deps.statePath()).catch(() => {});
  return { ok: true };
}

export async function dismissStarPrompt(deps: StarDeps = defaultDeps): Promise<void> {
  await markPrompted(deps.statePath());
}

/** Tests install deterministic deps (never the user's gh) and must reset afterwards. */
export function setStarDepsForTests(deps: StarDeps | null): void {
  defaultDeps = deps ?? productionDeps;
  generation += 1;
  cached = null;
  inflight = null;
}
