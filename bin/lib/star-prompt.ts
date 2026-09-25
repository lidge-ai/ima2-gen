import { spawnSync } from "node:child_process";
import {
  STAR_REPO,
  ghAuthStatusArgs,
  ghStarWriteArgs,
  ghVersionArgs,
  hasBeenPrompted,
  markPrompted,
  starPromptStatePath,
} from "../../lib/githubStar.js";
import { isAgentDriven } from "./agent-driven.js";
import { interactiveConfirm } from "./interactive-confirm.js";

// The studio's star dialog (routes/github.ts) shares this state file and these
// gh commands; the CLI keeps a synchronous spawn because it prompts before the
// server exists.
export { hasBeenPrompted, markPrompted, starPromptStatePath };

const REPO = STAR_REPO;

/**
 * Whether `gh` is both installed and logged in. Starring goes through the
 * user's own `gh` auth, so an unauthenticated CLI cannot fulfil a "Yes" — in
 * that case the prompt stays silent instead of asking for something it would
 * then fail to do.
 */
export function isGhInstalled(spawnSyncFn = spawnSync) {
  const version = spawnSyncFn("gh", ghVersionArgs(), {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 3000,
    windowsHide: true,
  });
  if (version.error || version.status !== 0) return false;

  const auth = spawnSyncFn("gh", ghAuthStatusArgs(), {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 5000,
    windowsHide: true,
  });
  return !auth.error && auth.status === 0;
}

export function starRepo(spawnSyncFn = spawnSync) {
  const result = spawnSyncFn("gh", ghStarWriteArgs(), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    return { ok: false, error: stderr || stdout || `gh exited ${result.status}` };
  }
  return { ok: true };
}

/**
 * Printed instead of the prompt when an agent is driving the CLI. The agent
 * reads this as its instruction: it must not answer, it must ask the person.
 */
export function agentDeferralLines(): string[] {
  return [
    `[ima2] ima2-gen isn't starred on GitHub yet.`,
    `[ima2] Agent: do not answer this yourself — it uses the user's GitHub identity.`,
    `[ima2] Ask the user whether to star ${REPO}, and only run`,
    `[ima2] \`gh api -X PUT /user/starred/${REPO}\` if they say yes.`,
  ];
}

export interface StarPromptDeps {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  hasBeenPromptedFn?: () => Promise<boolean> | boolean;
  isGhInstalledFn?: () => boolean;
  isAgentDrivenFn?: () => boolean;
  markPromptedFn?: () => Promise<void> | void;
  askYesNoFn?: () => Promise<boolean> | boolean;
  starRepoFn?: () => { ok: boolean; error?: string };
  logFn?: (line: string) => void;
  warnFn?: (line: string) => void;
}

export async function maybePromptGithubStar(deps: StarPromptDeps = {}) {
  const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY;
  const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY;
  if (!stdinIsTTY || !stdoutIsTTY) return;

  const hasBeenPromptedImpl = deps.hasBeenPromptedFn ?? hasBeenPrompted;
  if (await hasBeenPromptedImpl()) return;

  const isGhInstalledImpl = deps.isGhInstalledFn ?? isGhInstalled;
  if (!isGhInstalledImpl()) return;

  // An agent would answer this on the user's behalf, using the user's GitHub
  // identity. Hand the question to the agent to relay, and leave the state
  // unwritten so the user still gets the real prompt on their own run.
  const isAgentDrivenImpl = deps.isAgentDrivenFn ?? (() => isAgentDriven(deps.env));
  if (isAgentDrivenImpl()) {
    const log = deps.logFn ?? console.log;
    for (const line of agentDeferralLines()) log(line);
    return;
  }

  const markPromptedImpl = deps.markPromptedFn ?? markPrompted;
  await markPromptedImpl();

  const askYesNoImpl = deps.askYesNoFn
    ?? (() => interactiveConfirm({
      question: "[ima2] Enjoying ima2-gen? Star it on GitHub (via gh)?",
      defaultYes: true,
    }));
  const approved = await askYesNoImpl();
  if (!approved) return;

  const starRepoImpl = deps.starRepoFn ?? starRepo;
  const star = starRepoImpl();
  if (star.ok) {
    const log = deps.logFn ?? console.log;
    log("[ima2] Thanks for the star!");
    return;
  }

  const warn = deps.warnFn ?? console.warn;
  warn(`[ima2] Could not star repository automatically: ${star.error}`);
}
