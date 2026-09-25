// Shared GitHub Actions pin assertions.
//
// Two prior incidents shaped this file. #162 and #178 both broke a Dependabot
// bump because a test froze one literal commit SHA, and the fix for #162 left a
// looser pattern behind: /[0-9a-f]{40}\b/ matches `@<sha>-evil`, `@<sha>/evil`,
// and `@<sha>.evil` too, because \b sits between the last hex digit and the
// punctuation. Those are all mutable refs a fork can move. So the rule here is
// "the whole ref token is exactly 40 lowercase hex characters", checked
// positively over every external `uses:` in the file rather than by blacklisting
// `@vN`.
//
// The refs are read from the parsed YAML document, not by scanning lines. A
// line scanner is defeated by valid YAML: `- { uses: attacker/action@main }` in
// flow style has no `uses:` at line start, and a `run: |` block scalar can
// contain text that looks exactly like a pinned step. Both were found by review
// against an earlier line-based version of this file, and actionlint accepted
// the crafted workflow, so this is reachable YAML rather than a hypothetical.
import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { parseDocument, isAlias, isMap, isSeq, isScalar } from "yaml";

// A commit-SHAPED ref: exactly 40 lowercase hex characters. This is a shape
// check, not a provenance check. It does not prove the value resolves to a
// commit object in the referenced repository, and a 40-hex string is a legal
// git ref name, so a repository could in principle publish a branch or tag with
// that name. Proving object identity needs an upstream lookup or GitHub's own
// sha_pinning_required setting, both outside a source-text test. What this gate
// does buy: no tag, no branch name that is not 40-hex, and no ref that merely
// starts with a SHA.
const COMMIT_SHAPED_REF = /^[0-9a-f]{40}$/;
// Local composite actions (`./.github/actions/x`) and reusable local workflows
// carry no ref and are covered by this repo's own review, not by pinning.
const LOCAL_USE = /^\.{1,2}\//;

/**
 * Every `uses:` in one workflow, read from the parsed document.
 *
 * Uses the YAML AST so flow-style steps and quoted keys are found, block
 * scalars are not mistaken for steps, and aliases resolve to their anchor.
 * Throws on a parse error or on a `uses:` whose value is not a plain string,
 * so nothing can drop out of the sweep silently.
 */
export function parseActionUses(text, label = "workflow") {
  const doc = parseDocument(text, { merge: true });
  assert.deepEqual(
    doc.errors.map((error) => error.message),
    [],
    `${label} is not parseable YAML, so the pin sweep cannot see its steps`,
  );
  const entries = [];
  const seen = new Set();
  // An alias node carries no value of its own; resolve it to the anchor so the
  // ref that Actions would actually run is what gets checked.
  const deref = (node) => (isAlias(node) ? node.resolve(doc) : node);
  const record = (node, where) => {
    node = deref(node);
    assert.ok(
      isScalar(node) && typeof node.value === "string",
      `${label} ${where} has a \`uses:\` whose value is not a plain string; this gate cannot verify it`,
    );
    // An alias points back at its anchor, so the same declaration can be
    // reached twice. Dedupe by source offset to keep this a count of
    // declarations rather than of references.
    const offset = node.range ? node.range[0] : null;
    if (offset !== null && seen.has(offset)) return;
    if (offset !== null) seen.add(offset);
    const value = node.value.trim();
    const at = value.lastIndexOf("@");
    entries.push({
      label,
      where,
      line: offset === null ? 0 : text.slice(0, offset).split(/\r?\n/).length,
      offset,
      raw: value,
      action: at === -1 ? value : value.slice(0, at),
      ref: at === -1 ? null : value.slice(at + 1),
      local: LOCAL_USE.test(value),
    });
  };

  // Walk the two structural positions Actions actually honours: a step's
  // `uses`, and a job-level `uses` for a reusable workflow. Reading the
  // structure rather than every `uses` key anywhere means a `uses` under
  // `with:` cannot masquerade as a step, and vice versa.
  const jobs = doc.get("jobs", true);
  if (isMap(jobs)) {
    for (const jobPair of jobs.items) {
      const jobName = isScalar(jobPair.key) ? String(jobPair.key.value) : "?";
      const job = deref(jobPair.value);
      if (!isMap(job)) continue;
      const jobUses = job.get("uses", true);
      if (jobUses !== undefined && jobUses !== null) record(jobUses, `jobs.${jobName}.uses`);
      const steps = job.get("steps", true);
      const stepSeq = deref(steps);
      if (!isSeq(stepSeq)) continue;
      stepSeq.items.forEach((rawStep, index) => {
        const stepNode = deref(rawStep);
        if (!isMap(stepNode)) return;
        const stepUses = stepNode.get("uses", true);
        if (stepUses !== undefined && stepUses !== null) {
          record(stepUses, `jobs.${jobName}.steps[${index}].uses`);
        }
      });
    }
  }

  // A composite action manifest carries its steps under `runs.steps`, so the
  // same external actions hide one level down. A workflow that calls
  // ./.github/actions/x is treated as local and never inspected, which is
  // exactly how an unpinned third-party action would slip in.
  const runs = deref(doc.get("runs", true));
  if (isMap(runs)) {
    const runSteps = deref(runs.get("steps", true));
    if (isSeq(runSteps)) {
      runSteps.items.forEach((rawStep, index) => {
        const stepNode = deref(rawStep);
        if (!isMap(stepNode)) return;
        const stepUses = stepNode.get("uses", true);
        if (stepUses !== undefined && stepUses !== null) record(stepUses, `runs.steps[${index}].uses`);
      });
    }
  }

  // Only the executable positions above are checked. A key literally named
  // `uses` is legal elsewhere and means nothing to the runner: a `workflow_call`
  // input, a matrix dimension, or a `with:` value can all be called `uses`, and
  // actionlint accepts every one. An earlier version of this file rejected them
  // and would have failed a correctly pinned workflow, so the structural walk is
  // deliberately the whole story. Block scalars (`run: |`) are not Pair nodes,
  // which is what keeps crafted `run:` text out of the step list.
  entries.sort((a, b) => a.line - b.line);
  return entries;
}

/**
 * True only when the whole ref token is commit-shaped: exactly 40 lowercase hex
 * characters. See COMMIT_SHAPED_REF - this is a shape check, not proof that the
 * ref resolves to a commit upstream.
 */
export function isImmutablePin(ref) {
  return typeof ref === "string" && COMMIT_SHAPED_REF.test(ref);
}

/**
 * Assert every external action in `text` is pinned to a 40-hex commit.
 * Rejects tags (`@v4`), branches (`@main`), short hex, and SHA-prefixed mutable
 * refs (`@<sha>-evil`).
 *
 * `requireUses` defaults to true so a call naming one workflow cannot pass on an
 * empty file. Pass false when sweeping the whole tree, where a run-only workflow
 * legitimately declares no actions; assert the
 * tree-wide ref total instead.
 */
export function assertAllActionsPinned(text, label = "workflow", { requireUses = true } = {}) {
  const entries = parseActionUses(text, label);
  if (requireUses) {
    assert.ok(entries.length > 0, `${label} declares no \`uses:\` steps; the pin sweep would pass vacuously`);
  }
  for (const entry of entries) {
    if (entry.local) continue;
    assert.ok(
      isImmutablePin(entry.ref),
      `${entry.label}:${entry.line} is not pinned to an immutable 40-hex commit: ${entry.raw}`,
    );
  }
  return entries;
}

/**
 * Assert a specific action is present and pinned, without freezing which commit.
 * The SHA identity is Dependabot's business; the pin property is ours.
 */
export function assertActionPinned(text, action, label = "workflow") {
  const matches = parseActionUses(text, label).filter((entry) => entry.action === action);
  assert.ok(matches.length > 0, `${label} does not use ${action}`);
  for (const entry of matches) {
    assert.ok(
      isImmutablePin(entry.ref),
      `${entry.label}:${entry.line} must pin ${action} to a 40-hex commit: ${entry.raw}`,
    );
  }
  return matches;
}

/** Every workflow file under .github/workflows, read from the repo root. */
export function readWorkflow(name, root = process.cwd()) {
  return readFileSync(join(root, ".github/workflows", name), "utf8");
}

/**
 * Every pin-bearing manifest in the repo: workflows plus composite-action
 * manifests under .github/actions. Discovered rather than listed, so adding a
 * composite action puts it under the gate without anyone remembering to.
 */
export function pinnedManifestPaths(root = process.cwd()) {
  const paths = new Set();
  // Every path in this set is a POSIX-separated repo-relative path, on every OS.
  //
  // `join` emits the platform separator, but the local `uses: ./x` references
  // resolved below are parsed out of YAML and are always POSIX. Mixing the two
  // in one Set breaks the `paths.has(candidate)` dedup on Windows — the same
  // manifest gets swept twice under two spellings — and leaves callers
  // comparing against a value whose shape depends on the runner. Normalizing at
  // insertion keeps one spelling per manifest; Windows Node accepts `/` when
  // these are later joined back onto `root` for reads.
  const rel = (path) => path.split(sep).join("/");
  const workflowDir = join(root, ".github/workflows");
  if (existsSync(workflowDir)) {
    for (const name of readdirSync(workflowDir).sort()) {
      if (/\.ya?ml$/.test(name)) paths.add(rel(join(".github/workflows", name)));
    }
  }
  // A repo-root action.yml is how a published action is declared, and GitHub
  // honours a local `uses: ./anywhere` too - so .github/actions is a convention,
  // not a boundary.
  for (const name of ["action.yml", "action.yaml"]) {
    if (existsSync(join(root, name))) paths.add(name);
  }
  const walk = (relDir) => {
    for (const entry of readdirSync(join(root, relDir)).sort()) {
      const rel = join(relDir, entry);
      // lstat, not stat: a symlinked directory can point at its own parent, and
      // following it would walk forever.
      const stats = lstatSync(join(root, rel));
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) walk(rel);
      else if (/^action\.ya?ml$/.test(entry)) paths.add(rel.split(sep).join("/"));
    }
  };
  if (existsSync(join(root, ".github/actions"))) walk(".github/actions");

  // Follow every local `uses: ./path` to the manifest it names. A local action
  // may live anywhere, and its own steps can pull in an unpinned third-party
  // action, so resolving the reference is what closes the gap rather than
  // trusting a directory convention. Iterates to a fixed point because a local
  // action can itself call another one.
  let frontier = [...paths];
  while (frontier.length > 0) {
    const next = [];
    for (const rel of frontier) {
      let entries;
      try {
        entries = parseActionUses(readFileSync(join(root, rel), "utf8"), rel);
      } catch {
        continue; // A malformed manifest is reported by the sweep, not here.
      }
      for (const entry of entries) {
        if (!entry.local) continue;
        for (const nativeCandidate of localManifestCandidates(entry.raw)) {
          const candidate = nativeCandidate.split(sep).join("/");
          if (paths.has(candidate)) continue;
          if (!containedInRoot(root, candidate)) continue;
          paths.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
  }
  return [...paths].sort();
}

/** `./x` or `./x/action.yml` -> the manifest paths that could satisfy it. */
function localManifestCandidates(use) {
  const rel = use.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!rel || rel.startsWith("..")) return [];
  const candidates = /\/action\.ya?ml$/.test(rel)
    ? [rel]
    : [join(rel, "action.yml"), join(rel, "action.yaml")];
  // join() normalizes, so `./sub/../../outside` collapses to `../outside/...`.
  // Drop anything that climbs out: a manifest outside the repo is not ours to
  // police, and reading it would take the walk somewhere unbounded.
  return candidates.filter((path) => !path.startsWith("..") && !path.startsWith("/"));
}

/**
 * True when `rel` exists and its real location is inside `root`.
 *
 * The textual `..` filter above is not enough on its own: a symlinked directory
 * has a repo-relative name yet can resolve anywhere, so `uses: ./link` would
 * pull a manifest from outside the tree into the sweep. Comparing resolved
 * paths is what actually bounds the walk.
 */
function containedInRoot(root, rel) {
  const target = join(root, rel);
  if (!existsSync(target)) return false;
  let realRoot;
  let realTarget;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathSync(target);
  } catch {
    return false;
  }
  return realTarget === realRoot || realTarget.startsWith(realRoot + sep);
}
