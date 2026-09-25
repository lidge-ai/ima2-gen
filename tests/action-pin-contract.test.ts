import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertActionPinned,
  assertAllActionsPinned,
  isImmutablePin,
  parseActionUses,
  pinnedManifestPaths,
} from "./_actionPins.mjs";

const SHA = "a".repeat(40);
const WORKFLOW_DIR = ".github/workflows";

// Workflows that legitimately declare no actions. Naming them explicitly is the point: a numeric ref-count threshold
// would let someone convert pages.yml into a run-only workflow and still pass.
const RUN_ONLY_WORKFLOWS = new Set<string>();

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
}

/** Executable sources under the given roots, walked recursively. */
function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.[cm]?[jt]sx?$/.test(entry)) {
        out.push(path);
      }
    }
  };
  for (const root of roots) walk(root);
  return out;
}

/**
 * Zero-based indices of lines inside a `run:` block scalar.
 * The independent scan below must skip these, or crafted `run:` text would
 * inflate its count and make the comparison fail for the wrong reason.
 */
function runBlockLines(text: string): Set<number> {
  const lines = text.split(/\r?\n/);
  const inside = new Set<number>();
  let indent = -1;
  let explicit = 0;
  lines.forEach((line, index) => {
    if (indent >= 0) {
      const width = line.length - line.trimStart().length;
      const floor = explicit > 0 ? indent + explicit : indent + 1;
      if (line.trim() === "" || width >= floor) {
        inside.add(index);
        return;
      }
      indent = -1;
      explicit = 0;
    }
    // Block header, with the full YAML indicator grammar: `|`, `>`, an optional
    // explicit indentation digit, and an optional chomping `-`/`+` in either
    // order. `run: |2`, `|2-`, and `>2+` are all valid and actionlint accepts
    // them, so a scanner that only knows `|` and `|-` mistakes their content
    // for real steps.
    //
    // The two captured widths differ and both matter. Explicit indentation is
    // measured from the block scalar's own key column, so `- name: |2` inside a
    // sequence must count from the key, not from the dash - otherwise a sibling
    // `uses:` at the key's indent gets swallowed as scalar content.
    const open = /^([\t ]*)(-[\t ]+)?[\w"']+[\t ]*:[\t ]*[|>](?:([1-9])[-+]?|[-+]([1-9])?)?[\t ]*(?:#.*)?$/.exec(line);
    if (open) {
      indent = open[1].length;
      const keyColumn = indent + (open[2]?.length ?? 0);
      const digit = Number(open[3] ?? open[4] ?? 0);
      explicit = digit > 0 ? keyColumn + digit - indent : 0;
    }
  });
  return inside;
}

function step(ref: string): string {
  return ["jobs:", "  a:", "    steps:", `      - uses: actions/checkout@${ref}`].join("\n");
}

// This file is the regression guard for the pin gate itself. #162 and #178 were
// both the same bug: a test froze a literal commit SHA, so a correctly pinned
// Dependabot bump failed. The fix for #162 replaced one literal with
// /[0-9a-f]{40}\b/, which is not a pin check at all. Everything below exists so
// a future loosening fails here instead of shipping.
describe("action pin gate", () => {
  it("accepts any exact 40-hex lowercase commit", () => {
    assert.equal(isImmutablePin(SHA), true);
    assert.equal(isImmutablePin("ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd"), true);
    assert.doesNotThrow(() => assertAllActionsPinned(step(SHA), "fixture"));
  });

  it("rejects tag, branch, and short refs", () => {
    for (const ref of ["v4", "v4.37.8", "main", "dev", "latest", SHA.slice(0, 39), SHA.slice(0, 7)]) {
      assert.equal(isImmutablePin(ref), false, `${ref} must not count as a pin`);
      assert.throws(
        () => assertAllActionsPinned(step(ref), "fixture"),
        /not pinned to an immutable 40-hex commit/,
        `@${ref} must fail the gate`,
      );
    }
  });

  // The exact hole the round-1 audit found in the #162 pattern: a trailing \b
  // matches between the 40th hex digit and punctuation, so every ref below
  // passed while pointing at something a fork can move.
  it("rejects mutable refs that merely start with 40 hex characters", () => {
    for (const ref of [`${SHA}-evil`, `${SHA}/evil`, `${SHA}.evil`, `${SHA}_evil`, `${SHA}${SHA}`]) {
      assert.equal(isImmutablePin(ref), false, `${ref} must not count as a pin`);
      assert.throws(() => assertAllActionsPinned(step(ref), "fixture"), /not pinned to an immutable/);
    }
  });

  it("rejects uppercase hex so the ref is byte-comparable to git output", () => {
    assert.equal(isImmutablePin(SHA.toUpperCase()), false);
    assert.equal(isImmutablePin("A".repeat(40)), false);
  });

  it("does not let a trailing comment or quotes smuggle a second token", () => {
    const commented = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} # v7.0.1`;
    assert.doesNotThrow(() => assertAllActionsPinned(commented, "fixture"));
    const quoted = `jobs:\n  a:\n    steps:\n      - uses: "actions/checkout@${SHA}"`;
    assert.doesNotThrow(() => assertAllActionsPinned(quoted, "fixture"));
    const smuggled = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} extra`;
    // YAML reads this as one plain scalar, so the ref is "<sha> extra" and the
    // whole-token check is what rejects it.
    assert.throws(() => assertAllActionsPinned(smuggled, "fixture"), /not pinned to an immutable/);
  });

  it("fails loudly rather than passing vacuously", () => {
    assert.throws(() => assertAllActionsPinned("jobs:\n  a:\n    steps: []\n", "fixture"), /no .*uses.* steps/);
    assert.throws(() => assertActionPinned(step(SHA), "github/codeql-action/init", "fixture"), /does not use/);
  });

  // A line scanner passed both of these. actionlint accepts them, so they are
  // reachable YAML, not a hypothetical.
  it("sees flow-style steps a line scanner misses", () => {
    const flow = `jobs:\n  a:\n    steps: [{ uses: attacker/action@main }]`;
    assert.throws(() => assertAllActionsPinned(flow, "fixture"), /not pinned to an immutable/);
    const inlineMap = `jobs:\n  a:\n    steps:\n      - { uses: attacker/action@main }`;
    assert.throws(() => assertAllActionsPinned(inlineMap, "fixture"), /not pinned to an immutable/);
    const quotedKey = `jobs:\n  a:\n    steps:\n      - "uses": attacker/action@main`;
    assert.throws(() => assertAllActionsPinned(quotedKey, "fixture"), /not pinned to an immutable/);
  });

  it("does not count block-scalar text as a step", () => {
    const decoy = [
      "jobs:",
      "  a:",
      "    steps:",
      `      - { uses: attacker/action@main }`,
      "      - run: |",
      `          uses: actions/checkout@${SHA}`,
      `          uses: actions/setup-node@${SHA}`,
    ].join("\n");
    const entries = parseActionUses(decoy, "fixture");
    assert.equal(entries.length, 1, "run: block text must not be parsed as steps");
    assert.equal(entries[0].ref, "main");
    assert.throws(() => assertAllActionsPinned(decoy, "fixture"), /not pinned to an immutable/);
  });

  it("checks a job-level reusable-workflow uses", () => {
    const reusable = `jobs:\n  a:\n    uses: owner/repo/.github/workflows/x.yml@main`;
    assert.throws(() => assertAllActionsPinned(reusable, "fixture"), /not pinned to an immutable/);
    const pinned = `jobs:\n  a:\n    uses: owner/repo/.github/workflows/x.yml@${SHA}`;
    assert.doesNotThrow(() => assertAllActionsPinned(pinned, "fixture"));
  });

  it("resolves an alias to the ref it actually points at", () => {
    const aliased = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - uses: &pin attacker/action@main",
      "  b:",
      "    steps:",
      "      - uses: *pin",
    ].join("\n");
    assert.throws(() => assertAllActionsPinned(aliased, "fixture"), /not pinned to an immutable/);
  });

  it("rejects a uses value that is not a plain string", () => {
    const nonScalar = `jobs:\n  a:\n    steps:\n      - uses:\n          - attacker/action@main`;
    assert.throws(() => assertAllActionsPinned(nonScalar, "fixture"), /not a plain string/);
  });

  // A key named `uses` is legal in non-executable positions and means nothing to
  // the runner. An earlier version of this gate rejected these, which would have
  // failed a correctly pinned workflow.
  it("ignores a uses key in a position the runner never executes", () => {
    const workflowCallInput = [
      "on:",
      "  workflow_call:",
      "    inputs:",
      "      uses:",
      "        type: string",
      "jobs:",
      "  a:",
      "    steps:",
      `      - uses: actions/checkout@${SHA}`,
    ].join("\n");
    assert.doesNotThrow(() => assertAllActionsPinned(workflowCallInput, "fixture"));
    assert.equal(parseActionUses(workflowCallInput, "fixture").length, 1);

    const matrixDimension = [
      "jobs:",
      "  a:",
      "    strategy:",
      "      matrix:",
      "        uses: [one, two]",
      "    steps:",
      `      - uses: actions/checkout@${SHA}`,
      "        with:",
      "          uses: not-an-action",
    ].join("\n");
    assert.doesNotThrow(() => assertAllActionsPinned(matrixDimension, "fixture"));
    assert.equal(parseActionUses(matrixDimension, "fixture").length, 1);
  });

  it("sweeps a composite action manifest, not just workflows", () => {
    const composite = [
      "name: setup",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - uses: attacker/action@main",
    ].join("\n");
    assert.throws(() => assertAllActionsPinned(composite, "fixture"), /not pinned to an immutable/);
    const pinned = composite.replace("@main", `@${SHA}`);
    assert.doesNotThrow(() => assertAllActionsPinned(pinned, "fixture"));
  });

  // A JavaScript, Docker, or shell-only action has nothing external to pin, and
  // a workflow may reference only local actions. Both are valid and must not be
  // rejected for having no external ref.
  it("accepts manifests that legitimately declare nothing external", () => {
    const jsAction = ['name: probe', "runs:", "  using: node20", "  main: index.js"].join("\n");
    assert.doesNotThrow(() => assertAllActionsPinned(jsAction, "fixture", { requireUses: false }));
    assert.equal(parseActionUses(jsAction, "fixture").length, 0);

    const shellOnly = [
      "runs:",
      "  using: composite",
      "  steps:",
      "    - run: echo hi",
      "      shell: bash",
    ].join("\n");
    assert.doesNotThrow(() => assertAllActionsPinned(shellOnly, "fixture", { requireUses: false }));

    const localOnly = `jobs:\n  a:\n    steps:\n      - uses: ./tools/local`;
    const entries = assertAllActionsPinned(localOnly, "fixture");
    assert.equal(entries.length, 1);
    assert.equal(entries.filter((entry) => !entry.local).length, 0);
  });

  it("understands explicit block indentation indicators", () => {
    for (const indicator of ["|", "|-", "|+", ">", ">-", "|2", "|2-", ">2+"]) {
      const decoy = [
        "jobs:",
        "  a:",
        "    steps:",
        `      - uses: actions/checkout@${SHA}`,
        `      - run: ${indicator}`,
        "          uses: attacker/action@main",
      ].join("\n");
      const entries = parseActionUses(decoy, "fixture");
      assert.equal(entries.length, 1, `${indicator}: run block content must not parse as a step`);
      const inRun = runBlockLines(decoy);
      assert.ok(inRun.has(5), `${indicator}: line 6 must be recognised as block content`);
    }
  });

  // The floor has to come from the block scalar's key column, not from the
  // sequence dash, or a sibling key at the same indent as `uses:` gets counted
  // as scalar content and the independent scan under-reports.
  it("measures explicit indentation from the key, not the sequence dash", () => {
    const workflow = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - name: |2",
      "          two line",
      "          title",
      `        uses: actions/checkout@${SHA}`,
    ].join("\n");
    const entries = parseActionUses(workflow, "fixture");
    assert.equal(entries.length, 1, "the real step must still parse");
    const inRun = runBlockLines(workflow);
    assert.ok(inRun.has(4) && inRun.has(5), "the two scalar lines belong to the block");
    assert.ok(!inRun.has(6), "the sibling uses: line must not be swallowed by the block");
  });

  it("refuses unparseable YAML rather than reading zero refs from it", () => {
    assert.throws(() => assertAllActionsPinned("jobs:\n  a: [unclosed\n", "fixture"), /not parseable YAML/);
  });

  it("skips local composite actions, which carry no ref", () => {
    const local = `jobs:\n  a:\n    steps:\n      - uses: ./.github/actions/setup\n      - uses: actions/checkout@${SHA}`;
    const entries = assertAllActionsPinned(local, "fixture");
    assert.equal(entries.filter((entry) => entry.local).length, 1);
  });

  // The tree-wide sweep. Scoping the gate to a hand-listed set of workflows is
  // how codeql.yml ended up as the only pinned file in the first place.
  it("pins every external action in every workflow", () => {
    const files = workflowFiles();
    assert.ok(files.length >= 11, `expected the full workflow set, found ${files.length}`);
    for (const name of files) {
      const text = readFileSync(join(WORKFLOW_DIR, name), "utf8");
      const runOnly = RUN_ONLY_WORKFLOWS.has(name);
      const entries = assertAllActionsPinned(text, `${WORKFLOW_DIR}/${name}`, { requireUses: !runOnly });
      // The allowlist claim is "declares no actions at all", so that is what is
      // checked. A non-listed workflow must declare at least one action, but it
      // may legitimately be entirely local (`uses: ./tools/x`) - requiring an
      // EXTERNAL action would reject that valid shape.
      if (runOnly) {
        assert.equal(entries.length, 0, `${name} is listed as run-only but declares ${entries.length} uses; drop it from the allowlist`);
      }
    }
  });

  // Discovered, not listed: a composite action added later is swept without
  // anyone remembering to register it here.
  it("sweeps every discovered manifest, including composite actions", () => {
    const paths = pinnedManifestPaths();
    const workflows = paths.filter((path) => path.startsWith(WORKFLOW_DIR));
    assert.deepEqual(
      workflows.map((path) => path.slice(WORKFLOW_DIR.length + 1)),
      workflowFiles(),
      "discovery must find exactly the workflow files on disk",
    );
    for (const path of paths) {
      const name = path.split("/").pop() as string;
      // Action manifests are swept with requireUses off: a JavaScript, Docker,
      // or shell-only composite action declares no `uses:` at all and has
      // nothing to pin. Every entry that IS present is still checked.
      const isWorkflow = path.startsWith(WORKFLOW_DIR);
      const requireUses = isWorkflow && !RUN_ONLY_WORKFLOWS.has(name);
      assertAllActionsPinned(readFileSync(path, "utf8"), path, { requireUses });
    }
  });

  // Discovery is filesystem behaviour, so it is checked against a tree built for
  // the purpose. Asserting it against this repo alone would be tautological: the
  // repo has no composite actions, so every branch below is untested there.
  it("discovers manifests wherever a local action actually lives", () => {
    const root = mkdtempSync(join(tmpdir(), "pin-discovery-"));
    try {
      const write = (rel: string, body: string): void => {
        mkdirSync(join(root, dirname(rel)), { recursive: true });
        writeFileSync(join(root, rel), body);
      };
      const composite = (uses: string): string =>
        ["runs:", "  using: composite", "  steps:", `    - uses: ${uses}`].join("\n");

      write(".github/workflows/a.yml", `jobs:\n  j:\n    steps:\n      - uses: ./tools/local`);
      write(".github/workflows/b.yaml", `jobs:\n  j:\n    steps:\n      - uses: ./.github/actions/x/y`);
      write(".github/actions/x/y/action.yaml", composite(`actions/checkout@${SHA}`));
      // Outside .github/actions, reached only by following the local reference.
      write("tools/local/action.yml", composite("./deeper"));
      // One more hop, to prove discovery reaches a fixed point.
      write("deeper/action.yml", composite("attacker/action@main"));
      write("action.yml", composite(`actions/setup-node@${SHA}`));

      const found = pinnedManifestPaths(root);
      for (const expected of [
        ".github/workflows/a.yml",
        ".github/workflows/b.yaml",
        ".github/actions/x/y/action.yaml",
        "tools/local/action.yml",
        "deeper/action.yml",
        "action.yml",
      ]) {
        assert.ok(found.includes(expected), `discovery missed ${expected}; found ${found.join(", ")}`);
      }

      // The unpinned ref is two hops from any workflow, so this is what proves
      // the sweep is worth running over discovered paths at all.
      const offenders = found.filter((path) => {
        try {
          assertAllActionsPinned(readFileSync(join(root, path), "utf8"), path, { requireUses: false });
          return false;
        } catch {
          return true;
        }
      });
      assert.deepEqual(offenders, ["deeper/action.yml"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A symlinked directory has a repo-relative name but can resolve anywhere, so
  // the textual `..` filter alone does not bound the walk.
  it("does not follow a local reference that resolves outside the repo", () => {
    const base = mkdtempSync(join(tmpdir(), "pin-containment-"));
    try {
      const root = join(base, "repo");
      const outside = join(base, "outside");
      mkdirSync(join(root, ".github/workflows"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(
        join(outside, "action.yml"),
        ["runs:", "  using: composite", "  steps:", "    - uses: attacker/action@main"].join("\n"),
      );
      writeFileSync(
        join(root, ".github/workflows/a.yml"),
        [
          "jobs:",
          "  j:",
          "    steps:",
          "      - uses: ./link",
          "      - uses: ./sub/../../outside",
          "      - uses: ../../../../etc",
        ].join("\n"),
      );
      let linked = true;
      try {
        symlinkSync(outside, join(root, "link"));
      } catch {
        linked = false; // Some filesystems refuse symlinks; the textual cases still apply.
      }
      const found = pinnedManifestPaths(root);
      assert.deepEqual(found, [".github/workflows/a.yml"], `discovery escaped the repo: ${found.join(", ")}`);
      if (linked) assert.ok(!found.some((path) => path.startsWith("link")), "a symlinked local action must not be followed");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  // Hygiene check, not a guarantee: it catches the accidental copy-paste that
  // caused #162 and #178, and cannot catch a SHA built by concatenation. The
  // real gate is that assertActionPinned exists and is easier to reach for.
  it("leaves no literal action SHA frozen in test or script sources", () => {
    const SELF = "tests/action-pin-contract.test.ts";
    const offenders: string[] = [];
    for (const path of sourceFiles(["tests", "scripts"])) {
      if (path === SELF) continue;
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/[\w./-]+@[0-9a-f]{40}(?![0-9a-f])/.test(line)) offenders.push(`${path}:${index + 1}`);
        });
    }
    assert.deepEqual(
      offenders,
      [],
      `these lines freeze one commit, so the next Dependabot bump fails: ${offenders.join(", ")}`,
    );
  });

  // Independent cross-check so the sweep cannot narrow without anyone noticing.
  // Counting with a different method than the parser uses is the whole point:
  // comparing the parser against its own regex family would be circular. Today
  // every real step is block style, so the two agree exactly; if a workflow
  // adopts flow style this test is the one that must be updated deliberately.
  it("parses at least every uses: line a plain scan can see", () => {
    for (const name of workflowFiles()) {
      const text = readFileSync(join(WORKFLOW_DIR, name), "utf8");
      const inRunBlock = runBlockLines(text);
      const scanned = text
        .split(/\r?\n/)
        .filter((line, index) => !inRunBlock.has(index) && /^[\t ]*(?:-[\t ]+)?["']?uses["']?:/.test(line)).length;
      const parsed = parseActionUses(text, name).length;
      assert.ok(parsed >= scanned, `${name}: parser saw ${parsed} uses, a plain scan saw ${scanned}`);
    }
  });

  // `parsed >= scanned` alone would stay green if the parser silently stopped
  // reading a whole position, so each position is asserted to still work.
  it("still reads every position it claims to cover", () => {
    const step = parseActionUses(`jobs:\n  a:\n    steps:\n      - uses: o/r@${SHA}`, "f");
    assert.deepEqual(step.map((entry) => entry.where), ["jobs.a.steps[0].uses"]);
    const job = parseActionUses(`jobs:\n  a:\n    uses: o/r/.github/workflows/x.yml@${SHA}`, "f");
    assert.deepEqual(job.map((entry) => entry.where), ["jobs.a.uses"]);
    const runs = parseActionUses(`runs:\n  using: composite\n  steps:\n    - uses: o/r@${SHA}`, "f");
    assert.deepEqual(runs.map((entry) => entry.where), ["runs.steps[0].uses"]);
  });
});
