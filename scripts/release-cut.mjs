#!/usr/bin/env node
/**
 * The release-cut steps that scripts/release.sh used to own: baseline guard, version
 * commit, preview proof, and the stable-tag decision.
 *
 * Nothing here publishes. publish.yml keeps that job and stays the only holder of
 * `id-token: write`; this module only decides whether a cut may proceed, so the guards
 * that protected the local flow now protect the CI flow.
 *
 * Ordering is load-bearing and mirrors the old script exactly:
 *   baseline -> version commit -> preview push -> npm preview proof -> stable tag.
 * The tag is a certificate that the preview build proved this SHA, never a trigger
 * issued ahead of that proof.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const PACKAGE_NAME = "ima2-gen";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * Reads npm metadata. Returns null ONLY for a genuine absence; every other failure
 * throws, because an indeterminate registry must never read as "not published".
 */
export function npmView(spec, field, run = execFileSync) {
  try {
    return JSON.parse(run("npm", ["view", spec, field, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch (error) {
    const stderr = String(error.stderr || "");
    if (/E404|is not in this registry|No match found/.test(stderr)) return null;
    throw new Error(`npm view ${spec} ${field} failed: ${stderr.trim() || error.message}`);
  }
}

function emit(values) {
  const path = process.env.GITHUB_OUTPUT;
  const body = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  if (path) appendFileSync(path, `${body}\n`);
  console.log(body);
}

/**
 * Mirrors the ancestry guards of the old scripts/release.sh: a release may only be cut
 * from a main that already contains dev and preview, so a tag can never orphan merged
 * work that lives only on another release branch.
 */
export function assertBaseline({ head, main, dev, preview, contains }) {
  const problems = [];
  if (main !== head) problems.push(`origin/main is ${main}, expected the checked-out ${head}`);
  if (!contains(dev, head)) problems.push(`main does not contain origin/dev (${dev})`);
  if (!contains(preview, head)) problems.push(`main does not contain origin/preview (${preview})`);
  return problems;
}

/**
 * Units this release line may not ship without. The list lives in code, not in the
 * JSON file: iterating the file would let an empty {} pass zero checks and read as
 * success, so the code names what is required and the file only supplies SHAs.
 */
export const REQUIRED_UNITS = ["wp9"];
const FULL_OID = /^[0-9a-f]{40}$/i;

/**
 * A UI-polish release may only be cut from a HEAD that already contains the modal
 * accessibility unit; cutting earlier would ship a version whose provenance does not
 * match the round it claims to close.
 *
 * Fail-closed by construction. A missing file, a missing key, null, a symbolic ref, or
 * an abbreviated hash are all refusals. Symbolic refs matter because git resolves
 * "HEAD" and "dev" happily, so contains() would return true for a value that proves
 * nothing - the full-oid test runs first for exactly that reason.
 */
export function assertUnitProvenance({ head, requiredCommits, contains }) {
  const problems = [];
  const map = requiredCommits && typeof requiredCommits === "object" && !Array.isArray(requiredCommits)
    ? requiredCommits
    : null;
  if (!map) return [".release/required-units.json must be a JSON object"];
  for (const label of REQUIRED_UNITS) {
    if (!Object.prototype.hasOwnProperty.call(map, label)) {
      problems.push(`required unit ${label} is missing from .release/required-units.json`);
      continue;
    }
    const sha = map[label];
    if (typeof sha !== "string" || !sha) {
      problems.push(`required unit ${label} has no recorded merge commit`);
    } else if (!FULL_OID.test(sha)) {
      problems.push(`required unit ${label} must be a full 40-hex commit id, got "${sha}"`);
    } else if (!contains(sha, head)) {
      problems.push(`HEAD does not contain ${label} (${sha})`);
    }
  }
  return problems;
}

/**
 * npm versions and git tags are both immutable, so a cut onto an already-published or
 * already-tagged version is refused before anything is pushed.
 */
export function assertCuttable({ version, publishedVersion, remoteTag }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`release version must be stable X.Y.Z (got ${version})`);
  if (publishedVersion) problems.push(`${PACKAGE_NAME}@${version} is already published`);
  if (remoteTag) problems.push(`remote tag v${version} already exists`);
  return problems;
}

/** A stable tag may only follow a preview build whose gitHead proves this exact SHA. */
export function assertPreviewProof({ version, sha, previewVersion, previewGitHead }) {
  const problems = [];
  if (previewGitHead !== sha) problems.push(`npm preview gitHead ${previewGitHead ?? "(none)"} does not prove ${sha}`);
  if (!String(previewVersion).startsWith(`${version}-preview.`)) {
    problems.push(`npm preview ${previewVersion ?? "(none)"} is not a ${version} candidate`);
  }
  return problems;
}

/**
 * D2 (release pipeline simplify): the release cut may reuse the main push CI
 * only when the version commit changed nothing but version files. A
 * package.json + lockfile bump carries no code delta, so the parent commit's
 * push CI already proves the tree. Any other file means the candidate must
 * prove itself.
 */
export function isVersionOnlyDiff(files) {
  if (!Array.isArray(files) || files.length === 0) return false;
  return files.every((file) => file === "package.json" || file === "package-lock.json");
}

function versionOnly(base, sha) {
  if (!base || !sha) throw new Error("usage: release-cut.mjs version-only <baseSha> <sha>");
  const files = git(["diff", "--name-only", base, sha]).split("\n").filter(Boolean);
  const versionOnly = isVersionOnlyDiff(files);
  console.log(`[release] version commit diff: ${files.join(", ") || "(empty)"}`);
  emit({ version_only: versionOnly });
}

function contains(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function fail(problems) {
  throw new Error(problems.join("; "));
}

function readRequiredUnits() {
  try {
    return JSON.parse(readFileSync(".release/required-units.json", "utf8"));
  } catch {
    return null;
  }
}

/** Ancestry-only portion of preflight, for readiness runs that must not publish. */
function baseline() {
  const problems = assertBaseline({
    head: git(["rev-parse", "HEAD"]),
    main: git(["rev-parse", "origin/main"]),
    dev: git(["rev-parse", "origin/dev"]),
    preview: git(["rev-parse", "origin/preview"]),
    contains,
  });
  if (problems.length) fail(problems);
  console.log("[release] baseline verified");
}

function preflight() {
  baseline();
  const problems = assertUnitProvenance({
    head: git(["rev-parse", "HEAD"]),
    requiredCommits: readRequiredUnits(),
    contains,
  });
  if (problems.length) fail(problems);
  console.log(`[release] required units present: ${REQUIRED_UNITS.join(", ")}`);
}

function commit(bump) {
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
  if (dirty) fail([`worktree is dirty before the version commit:\n${dirty}`]);
  execFileSync("npm", ["version", bump, "--no-git-tag-version"], { stdio: "inherit" });
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const problems = assertCuttable({
    version,
    publishedVersion: npmView(`${PACKAGE_NAME}@${version}`, "version"),
    remoteTag: git(["ls-remote", "--tags", "origin", `refs/tags/v${version}`]),
  });
  if (problems.length) fail(problems);
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  git(["add", "package.json", "package-lock.json"]);
  git(["commit", "-m", `[agent] chore: release v${version}`]);
  emit({ version, sha: git(["rev-parse", "HEAD"]) });
}

function previewProof(version, sha) {
  const problems = assertPreviewProof({
    version,
    sha,
    previewVersion: npmView(`${PACKAGE_NAME}@preview`, "version"),
    previewGitHead: npmView(`${PACKAGE_NAME}@preview`, "gitHead"),
  });
  if (problems.length) fail(problems);
  console.log(`[release] preview proof verified for v${version}@${sha}`);
}

/**
 * Release verification must not have rewritten tracked output. release.sh made the same
 * check: a build that regenerates a committed artifact means the commit about to be
 * promoted does not match what was verified.
 */
function assertClean() {
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
  if (dirty) fail([`release verification changed tracked output; commit generated artifacts and retry:\n${dirty}`]);
  console.log("[release] worktree is clean after verification");
}

/**
 * release.sh re-read the remotes after the preview publish and refused to tag if anything
 * had moved underneath it. Same guard here: preview must still be the release SHA, and
 * main must not have advanced past it while the preview build was being proven.
 */
export function assertRemotesUnmoved({ sha, main, preview }) {
  const problems = [];
  if (preview !== sha) problems.push(`origin/preview is ${preview}, expected the release ${sha}`);
  if (main !== sha) problems.push(`origin/main moved to ${main} during preview verification, expected ${sha}`);
  return problems;
}

function remotesUnmoved(sha) {
  const problems = assertRemotesUnmoved({
    sha,
    main: git(["rev-parse", "origin/main"]),
    preview: git(["rev-parse", "origin/preview"]),
  });
  if (problems.length) fail(problems);
  console.log(`[release] remotes still point at ${sha}`);
}

const COMMANDS = {
  preflight: () => preflight(),
  "assert-baseline": () => baseline(),
  commit: (args) => commit(args[0] || "patch"),
  "version-only": (args) => versionOnly(args[0], args[1]),
  "assert-clean": () => assertClean(),
  "assert-remotes-unmoved": (args) => remotesUnmoved(args[0]),
  "assert-preview-proof": (args) => previewProof(args[0], args[1]),
};

const isMain = process.argv[1] && process.argv[1].endsWith("release-cut.mjs");
if (isMain) {
  const [command, ...args] = process.argv.slice(2);
  try {
    const run = COMMANDS[command];
    if (!run) throw new Error("usage: release-cut.mjs preflight | assert-baseline | commit <bump> | version-only <baseSha> <sha> | assert-clean | assert-remotes-unmoved <sha> | assert-preview-proof <version> <sha>");
    run(args);
  } catch (error) {
    console.error(`[release-cut] ${error.message}`);
    process.exit(1);
  }
}
