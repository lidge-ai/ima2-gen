import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { assertCiSha } from "../scripts/assert-ci-sha.mjs";

type Step = { name?: string; uses?: string; run?: string; if?: unknown; "continue-on-error"?: unknown; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = { jobs: { windows: { if: string; needs: string; steps: Step[]; strategy: { matrix: { include: { node: string; npm: string }[] } } } } };
const workflow = (): Workflow => parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const ref = "${{ github.event.inputs.sha || github.sha }}";

function assertWindowsCandidate(value: Workflow) {
  const job = value.jobs.windows, steps = job.steps;
  // Post-merge evidence: pushes run the Windows lanes through the changes
  // filter; schedule and dispatched candidates always request them.
  assert.equal(job.needs, "changes");
  assert.equal(job.if, "github.event_name != 'push' || needs.changes.outputs.ci == 'true'");
  const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkouts.length, 1);
  assert.equal(checkouts[0].with?.ref, ref);
  const setup = steps.findIndex((step) => step.uses?.startsWith("actions/setup-node@"));
  const guard = steps.findIndex((step) => step.run === "node scripts/assert-ci-sha.mjs");
  const dependency = steps.findIndex((step) => /\bnpm\b/.test(step.run ?? ""));
  assert.ok(setup >= 0 && guard > setup && dependency > guard, "SHA guard precedes package commands");
  assert.equal(steps[guard].env?.EXPECTED_SHA, ref);
  const installer = steps.findIndex((step) => step.run === "node --import tsx --test tests/install-runtime-contract.test.ts");
  for (const run of ["npm run build:server", "npm run build:cli", "npm --prefix ui run build"]) {
    const build = steps.findIndex((step) => step.run === run);
    assert.ok(build >= 0 && installer > build, "real installer fixture runs after builds");
  }
  for (const index of [guard, installer]) {
    assert.equal(steps[index].if, undefined);
    assert.ok(steps[index]["continue-on-error"] === undefined || steps[index]["continue-on-error"] === false);
  }
  assert.deepEqual(job.strategy.matrix.include, [{ node: "22.23.0", npm: "11.18.0" }, { node: "24.17.0", npm: "12.0.0" }]);
}

test("Windows candidate workflow keeps both exact-source installer lanes mandatory", () => assertWindowsCandidate(workflow()));

test("Windows candidate assertions reject missing or bypassed proof, not step labels", () => {
  const base = workflow();
  assertWindowsCandidate(base);
  const changes: ((value: Workflow) => void)[] = [
    (value) => { delete value.jobs.windows.steps[0].with?.ref; },
    (value) => { value.jobs.windows.steps[0].with!.ref = "main"; },
    (value) => { value.jobs.windows.if = "github.event_name == 'schedule'"; },
    (value) => { delete (value.jobs.windows as { needs?: string }).needs; },
    (value) => { const steps = value.jobs.windows.steps; steps.push(...steps.splice(steps.findIndex((step) => step.run?.includes("assert-ci-sha")), 1)); },
    (value) => { value.jobs.windows.steps.find((step) => step.run?.includes("assert-ci-sha"))!.if = "false"; },
    (value) => { value.jobs.windows.strategy.matrix.include.pop(); },
    (value) => { value.jobs.windows.steps = value.jobs.windows.steps.filter((step) => !step.run?.includes("install-runtime-contract.test.ts")); },
    (value) => { value.jobs.windows.steps.find((step) => step.run?.includes("install-runtime-contract.test.ts"))!["continue-on-error"] = true; },
  ];
  for (const change of changes) { const value = structuredClone(base); change(value); assert.throws(() => assertWindowsCandidate(value)); }
  for (const step of base.jobs.windows.steps) step.name = "Different display label";
  assertWindowsCandidate(base);
});

test("candidate comparator executes against the actual checkout and fails mismatches", () => {
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.deepEqual(assertCiSha(actual, actual), { expectedSha: actual, actualSha: actual });
  for (const expected of [actual, "0".repeat(40), "short", "", actual.toUpperCase()]) {
    const result = spawnSync(process.execPath, ["scripts/assert-ci-sha.mjs"], { encoding: "utf8", timeout: 10_000, env: { ...process.env, EXPECTED_SHA: expected } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected === actual ? 0 : 1);
    if (expected === actual) assert.equal(JSON.parse(result.stdout).actualSha, actual);
  }
  for (const invalid of [null, [], 123, undefined]) assert.throws(() => assertCiSha(invalid, actual));
});
