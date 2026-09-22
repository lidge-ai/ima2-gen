import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { MAC_SIGNING_INPUTS, resolveDesktopBuildPolicy, validateMacSigningCredentials } from "../desktop/scripts/desktop-build-policy.mjs";

const REQUIRED = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
type Step = { id?: string; uses?: string; if?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; "continue-on-error"?: boolean };
type Workflow = { on: { workflow_dispatch: { inputs: Record<string, { default: unknown }> }; push: { tags: string[] }; pull_request: unknown; pull_request_target?: unknown }; jobs: {
  prepare: { outputs: { matrix: string }; steps: Step[] };
  build: { needs: string; strategy: { matrix: string }; steps: Step[] };
  release: { needs: string[]; if: string };
} };
const loadWorkflow = (): Workflow => parse(readFileSync(".github/workflows/desktop.yml", "utf8"));

function condition(expression: string, eventName: string, ref: string, platform = "all", publish = false, target = "mac", outcome = "success") {
  return Boolean(runInNewContext(expression, {
    github: { event_name: eventName, ref, event: { inputs: { platform, publish: String(publish) } } },
    inputs: { platform, publish }, matrix: { target, signed: true, trusted: true },
    needs: { prepare: { outputs: { signed: "true", trusted: "true", release: "true" } } },
    steps: { mac_build: { outcome }, mac_verify: { outcome } },
    always: () => true, startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  }, { timeout: 1000 }));
}

function assertWorkflowBoundary(workflow: Workflow) {
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.on.push.tags, ["desktop-v*"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.on.workflow_dispatch.inputs.platform.default, "all");
  assert.equal(workflow.jobs.build.needs, "prepare");
  assert.equal(workflow.jobs.prepare.outputs.matrix, "${{ steps.policy.outputs.matrix }}");
  assert.equal(workflow.jobs.build.strategy.matrix, "${{ fromJSON(needs.prepare.outputs.matrix) }}");
  const prepare = workflow.jobs.prepare.steps.find((step) => step.id === "policy")!;
  assert.equal(prepare.run, "node desktop/scripts/desktop-build-policy.mjs --matrix");
  const steps = workflow.jobs.build.steps;
  const preview = steps.find((step) => step.env?.CSC_IDENTITY_AUTO_DISCOVERY === "false")!;
  const signed = steps.find((step) => step.id === "mac_build")!;
  const verify = steps.find((step) => step.id === "mac_verify")!;
  const proof = steps.find((step) => step.with?.name === "ima2-macos-signature-proof")!;
  const installers = steps.find((step) => step.with?.name === "ima2-desktop-${{ matrix.target }}")!;
  assert.deepEqual(Object.keys(preview.env!), ["CSC_IDENTITY_AUTO_DISCOVERY"]);
  assert.ok(preview.run?.includes("--config.mac.notarize=false"));
  assert.ok(preview.run?.includes("--publish never"));
  assert.equal(signed.env?.CSC_LINK, "${{ secrets.MAC_CSC_LINK }}");
  assert.equal(signed.env?.CSC_KEY_PASSWORD, "${{ secrets.MAC_CSC_KEY_PASSWORD }}");
  for (const name of REQUIRED.slice(2)) assert.equal(signed.env?.[name], "${{ secrets." + name + " }}");
  assert.ok(signed.run!.indexOf("--credentials") < signed.run!.indexOf("dist:mac"));
  for (const flag of ["--config.forceCodeSigning=true", "--config.mac.type=distribution", "--config.mac.notarize=true", "--publish never"]) {
    assert.ok(signed.run?.includes(flag));
  }
  assert.equal(verify.run, "node desktop/scripts/verify-mac-artifacts.mjs --dist desktop/dist");
  assert.equal(verify.env?.APPLE_TEAM_ID, "${{ secrets.APPLE_TEAM_ID }}");
  assert.equal(verify.env?.VERIFY_REQUIRE_STAPLED, "1");
  assert.equal(proof.with?.path, "desktop/dist/signature-proof/");
  assert.equal(proof.with?.["if-no-files-found"], "error");
  assert.ok(steps.indexOf(signed) < steps.indexOf(verify));
  assert.ok(steps.indexOf(verify) < steps.indexOf(proof));
  assert.ok(steps.indexOf(proof) < steps.indexOf(installers));
  assert.equal(installers.if, undefined, "installer upload retains GitHub's success-only default");
  for (const step of [signed, verify, proof, installers]) assert.notEqual(step["continue-on-error"], true);
  assert.deepEqual([...workflow.jobs.release.needs].sort(), ["build", "prepare"]);
  for (const ref of ["refs/heads/dev", "refs/tags/desktop-v3.16.1"]) {
    assert.equal(condition(signed.if!, "pull_request", ref), false, "PR outputs cannot grant signing");
    assert.equal(condition(verify.if!, "pull_request", ref), false);
    assert.equal(condition(preview.if!, "pull_request", ref), true);
    assert.equal(condition(workflow.jobs.release.if, "pull_request", ref, "all", true), false);
    for (const platform of ["all", "mac", "win", "linux"]) {
      assert.equal(condition(workflow.jobs.release.if, "workflow_dispatch", ref, platform, false), false);
      assert.equal(condition(workflow.jobs.release.if, "workflow_dispatch", ref, platform, true), platform === "all");
    }
    assert.equal(condition(signed.if!, "workflow_dispatch", ref), true);
    assert.equal(condition(signed.if!, "workflow_dispatch", ref, "all", false, "win"), false);
    assert.equal(condition(verify.if!, "workflow_dispatch", ref, "mac", false, "mac", "failure"), true);
    assert.equal(condition(proof.if!, "workflow_dispatch", ref, "mac", false, "mac", "failure"), true);
    assert.equal(condition(verify.if!, "workflow_dispatch", ref, "mac", false, "mac", "skipped"), false);
  }
  assert.equal(condition(workflow.jobs.release.if, "push", "refs/tags/desktop-v3.16.1"), true);
  assert.equal(condition(workflow.jobs.release.if, "push", "refs/heads/dev"), false);
  assert.equal(condition(signed.if!, "push", "refs/heads/dev"), false);
}

test("desktop matrix filters before scheduling and rejects partial publication", () => {
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform: "mac", publish: false }).matrix.include,
    [{ os: "macos-latest", label: "macOS (arm64 + x64)", target: "mac" }]);
  for (const platform of ["mac", "win", "linux"]) {
    assert.equal(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform, publish: "false" }).matrix.include.length, 1);
    assert.throws(() => resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform, publish: true }), /all desktop platforms/);
  }
  for (const eventName of ["push", "pull_request", "workflow_dispatch"]) {
    assert.deepEqual(resolveDesktopBuildPolicy({ eventName }).matrix.include.map((entry) => entry.target), ["mac", "win", "linux"]);
  }
  assert.throws(() => resolveDesktopBuildPolicy({ eventName: "pull_request_target" }));
  assert.throws(() => resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform: "arbitrary-runner" }));
  assert.throws(() => resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", publish: "maybe" }));
  const changed = resolveDesktopBuildPolicy({ eventName: "workflow_dispatch" });
  changed.matrix.include[0].os = "untrusted-runner";
  assert.equal(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch" }).matrix.include[0].os, "macos-latest");
});

test("signing preflight requires every input and never repeats a credential value", () => {
  assert.deepEqual(MAC_SIGNING_INPUTS, REQUIRED);
  const env = Object.fromEntries(REQUIRED.map((name) => [name, "fixture-credential-not-for-logs"]));
  assert.equal(validateMacSigningCredentials(env), true);
  for (const name of REQUIRED) {
    for (const absent of [undefined, "", "  "]) {
      assert.throws(() => validateMacSigningCredentials({ ...env, [name]: absent }), (error: Error) => {
        assert.ok(error.message.includes(name));
        assert.ok(!error.message.includes("fixture-credential-not-for-logs"));
        return true;
      });
    }
  }
});

test("actual desktop policy CLI emits matrix and fails missing credentials without leaking values", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ima2-desktop-policy-")));
  try {
    const output = join(root, "output");
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      DESKTOP_EVENT: "workflow_dispatch", DESKTOP_PLATFORM: "mac", DESKTOP_PUBLISH: "false", GITHUB_OUTPUT: output };
    const result = spawnSync(process.execPath, ["desktop/scripts/desktop-build-policy.mjs", "--matrix"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8").trim().slice("matrix=".length)).include.map((entry: { target: string }) => entry.target), ["mac"]);
    const failure = spawnSync(process.execPath, ["desktop/scripts/desktop-build-policy.mjs", "--credentials"], {
      env: { ...env, CSC_LINK: "fixture-sensitive-value" }, encoding: "utf8",
    });
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /CSC_KEY_PASSWORD/);
    assert.ok(!`${failure.stdout}${failure.stderr}`.includes("fixture-sensitive-value"));
  } finally {
    assert.equal(realpathSync(root), resolve(root));
    assert.ok(root.startsWith(join(realpathSync(tmpdir()), "ima2-desktop-policy-")));
    rmSync(root, { recursive: true, force: false });
  }
});

test("workflow gates credentials, native proof and publication by the actual event", () => assertWorkflowBoundary(loadWorkflow()));

test("workflow assertions reject unsafe changes while ignoring display labels", () => {
  const mutations: ((workflow: Workflow) => void)[] = [
    (w) => { w.jobs.release.if = "startsWith(github.ref, 'refs/tags/desktop-v')"; },
    (w) => { w.jobs.build.steps.find((s) => s.id === "mac_build")!.if = "matrix.trusted"; },
    (w) => { w.jobs.build.steps.find((s) => s.id === "mac_verify")!.env!.VERIFY_REQUIRE_STAPLED = "0"; },
    (w) => { w.jobs.build.steps.find((s) => s.id === "mac_verify")!["continue-on-error"] = true; },
    (w) => { w.jobs.build.steps.find((s) => s.env?.CSC_IDENTITY_AUTO_DISCOVERY === "false")!.env!.CSC_LINK = "${{ secrets.MAC_CSC_LINK }}"; },
    (w) => { w.jobs.build.steps.find((s) => s.with?.name === "ima2-desktop-${{ matrix.target }}")!.if = "always()"; },
  ];
  for (const mutate of mutations) { const workflow = loadWorkflow(); mutate(workflow); assert.throws(() => assertWorkflowBoundary(workflow)); }
});
