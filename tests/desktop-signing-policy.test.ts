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
type Step = { id?: string; name?: string; uses?: string; if?: string; run?: string; shell?: string; env?: Record<string, string>; with?: Record<string, unknown>; "continue-on-error"?: boolean };
type Workflow = { on: { workflow_dispatch: { inputs: Record<string, { default: unknown }> }; push: { tags: string[]; branches: string[] }; pull_request?: unknown; pull_request_target?: unknown }; jobs: {
  prepare: { outputs: { matrix: string; changed: string }; steps: Step[] };
  build: { needs: string; if: string; strategy: { matrix: string }; steps: Step[] };
  draft_release: { needs: string[]; if: string; steps: Step[] };
  publish_release: { needs: string; if: string; environment: { name: string; url: string }; steps: Step[] };
} };
const loadWorkflow = (): Workflow => parse(readFileSync(".github/workflows/desktop.yml", "utf8"));
const distMacScript = (): string => JSON.parse(readFileSync("desktop/package.json", "utf8")).scripts["dist:mac"];
const publishFlagCount = (command: string) => command.match(/--publish\b/g)?.length ?? 0;

function condition(expression: string, eventName: string, ref: string, platform = "all", publish = false, target = "mac", outcome = "success", changed = "") {
  return Boolean(runInNewContext(expression, {
    github: { event_name: eventName, ref, event: { inputs: { platform, publish: String(publish) } } },
    inputs: { platform, publish }, matrix: { target, signed: true, trusted: true },
    needs: { prepare: { outputs: { signed: "true", trusted: "true", release: "true", changed } } },
    steps: { mac_build: { outcome }, mac_verify: { outcome } },
    always: () => true, startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  }, { timeout: 1000 }));
}

function assertWorkflowBoundary(workflow: Workflow) {
  assert.equal(workflow.on.pull_request_target, undefined);
  // Desktop matrix builds are post-merge evidence: the unsigned preview moved
  // from pull_request to dev pushes, keeping the PR contract minimal.
  assert.equal(workflow.on.pull_request, undefined);
  assert.deepEqual(workflow.on.push.tags, ["desktop-v*"]);
  assert.deepEqual(workflow.on.push.branches, ["dev"]);
  // A tag is the only ref that can reach a release, so dispatch has no publish input.
  assert.equal(workflow.on.workflow_dispatch.inputs.publish, undefined);
  assert.equal(workflow.on.workflow_dispatch.inputs.platform.default, "all");
  assert.equal(workflow.jobs.build.needs, "prepare");
  // prepare's paths step only runs on branch pushes; '' keeps tags/dispatches
  // unconditionally selected while 'false' skips the matrix on docs-only pushes.
  assert.equal(workflow.jobs.prepare.outputs.changed, "${{ steps.paths.outputs.desktop }}");
  assert.equal(workflow.jobs.build.if, "needs.prepare.outputs.changed != 'false'");
  assert.equal(workflow.jobs.prepare.outputs.matrix, "${{ steps.policy.outputs.matrix }}");
  assert.equal(workflow.jobs.build.strategy.matrix, "${{ fromJSON(needs.prepare.outputs.matrix) }}");
  const prepare = workflow.jobs.prepare.steps.find((step) => step.id === "policy")!;
  assert.equal(prepare.run, "node desktop/scripts/desktop-build-policy.mjs --matrix");
  const steps = workflow.jobs.build.steps;
  const preview = steps.find((step) => step.env?.CSC_IDENTITY_AUTO_DISCOVERY === "false")!;
  const signed = steps.find((step) => step.id === "mac_build")!;
  const verify = steps.find((step) => step.id === "mac_verify")!;
  const proof = steps.find((step) => step.with?.name === "ima2-macos-signature-proof")!;
  const installers = steps.find((step) => step.with?.name === "ima2-desktop-${{ matrix.target }}-${{ matrix.arch }}")!;
  assert.deepEqual(Object.keys(preview.env!), ["CSC_IDENTITY_AUTO_DISCOVERY"]);
  assert.ok(preview.run?.includes("--config.mac.notarize=false"));
  // The dist:mac script owns --publish never. A second copy reaches electron-builder as an
  // array, which disables its "never" check and makes dispatch/tag builds try to upload.
  assert.equal(publishFlagCount(distMacScript()), 1);
  assert.match(distMacScript(), /--publish never/);
  for (const step of [preview, signed]) {
    assert.equal(publishFlagCount(`${distMacScript()} ${step.run}`), 1, `${step.name} passes --publish exactly once`);
  }
  assert.equal(signed.env?.CSC_LINK, "${{ secrets.MAC_CSC_LINK }}");
  assert.equal(signed.env?.CSC_KEY_PASSWORD, "${{ secrets.MAC_CSC_KEY_PASSWORD }}");
  for (const name of REQUIRED.slice(2)) assert.equal(signed.env?.[name], "${{ secrets." + name + " }}");
  assert.ok(signed.run!.indexOf("--credentials") < signed.run!.indexOf("dist:mac"));
  for (const flag of ["--config.forceCodeSigning=true", "--config.mac.type=distribution", "--config.mac.notarize=true"]) {
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
  // Windows and Linux legs build one arch each on a native runner.
  const win = steps.find((step) => step.name === "Build (Windows)")!;
  const linux = steps.find((step) => step.name === "Build (Linux)")!;
  assert.equal(win.if, "matrix.target == 'win'");
  assert.equal(linux.if, "matrix.target == 'linux'");
  assert.match(win.run!, /dist:win -- --\$\{\{ matrix\.arch \}\}/);
  assert.match(linux.run!, /dist:linux -- --\$\{\{ matrix\.arch \}\}/);
  assert.equal(win.shell, "pwsh", "Windows leg needs Get-AuthenticodeSignature for the signing marker");
  assert.equal(win.env?.WIN_CSC_LINK, "${{ secrets.WIN_CSC_LINK }}");
  assert.equal(win.env?.WIN_CSC_KEY_PASSWORD, "${{ secrets.WIN_CSC_KEY_PASSWORD }}");
  assert.match(win.run!, /signing-windows\.txt/);
  assert.ok(Object.values(linux.env ?? {}).every((value) => !String(value).includes("CSC")), "Linux builds are never signed");
  assert.deepEqual([...workflow.jobs.draft_release.needs].sort(), ["build", "prepare"]);
  assertApprovalBoundary(workflow);
  for (const ref of ["refs/heads/dev", "refs/tags/desktop-v3.16.1"]) {
    assert.equal(condition(signed.if!, "pull_request", ref), false, "PR outputs cannot grant signing");
    assert.equal(condition(verify.if!, "pull_request", ref), false);
    // The unsigned preview runs on branch pushes only, never on a tag or a PR.
    assert.equal(condition(preview.if!, "pull_request", ref), false);
    assert.equal(condition(workflow.jobs.draft_release.if, "pull_request", ref, "all", true), false);
    for (const platform of ["all", "mac", "win", "linux"]) {
      // No dispatch input combination can reach a release.
      assert.equal(condition(workflow.jobs.draft_release.if, "workflow_dispatch", ref, platform, false), false);
      assert.equal(condition(workflow.jobs.draft_release.if, "workflow_dispatch", ref, platform, true), false);
      assert.equal(condition(workflow.jobs.publish_release.if, "workflow_dispatch", ref, platform, true), false);
    }
    assert.equal(condition(signed.if!, "workflow_dispatch", ref), true);
    assert.equal(condition(signed.if!, "workflow_dispatch", ref, "all", false, "win"), false);
    assert.equal(condition(verify.if!, "workflow_dispatch", ref, "mac", false, "mac", "failure"), true);
    assert.equal(condition(proof.if!, "workflow_dispatch", ref, "mac", false, "mac", "failure"), true);
    assert.equal(condition(verify.if!, "workflow_dispatch", ref, "mac", false, "mac", "skipped"), false);
  }
  assert.equal(condition(workflow.jobs.draft_release.if, "push", "refs/tags/desktop-v3.16.1"), true);
  assert.equal(condition(workflow.jobs.draft_release.if, "push", "refs/heads/dev"), false);
  assert.equal(condition(signed.if!, "push", "refs/heads/dev"), false);
  assert.equal(condition(preview.if!, "push", "refs/heads/dev"), true);
  assert.equal(condition(preview.if!, "push", "refs/tags/desktop-v3.16.1"), false);
  // The build matrix is skipped only when a branch push touched nothing desktop.
  assert.equal(condition(workflow.jobs.build.if, "push", "refs/heads/dev", "all", false, "mac", "success", "false"), false);
  assert.equal(condition(workflow.jobs.build.if, "push", "refs/heads/dev", "all", false, "mac", "success", "true"), true);
  assert.equal(condition(workflow.jobs.build.if, "push", "refs/tags/desktop-v3.16.1"), true);
}

/**
 * The draft must exist before approval so a reviewer has something to inspect,
 * and only the approved job may flip it public.
 */
function assertApprovalBoundary(workflow: Workflow) {
  const draft = workflow.jobs.draft_release;
  const publish = workflow.jobs.publish_release;
  assert.equal(publish.needs, "draft_release");
  assert.equal((draft as { environment?: unknown }).environment, undefined);
  assert.deepEqual(publish.environment, {
    name: "desktop-production",
    url: "${{ needs.draft_release.outputs.release_url }}",
  });
  const gate = publish.steps.find((step) => step.name === "Require configured production approval gate")!;
  assert.deepEqual(gate.env, { DESKTOP_RELEASE_GATE: "${{ vars.DESKTOP_RELEASE_GATE }}" });
  assert.match(gate.run!, /required-reviewer-v1/);
  const release = publish.steps.find((step) => step.name === "Publish approved desktop release")!;
  assert.match(release.run!, /--draft=false --latest=false/);
  assert.doesNotMatch(release.run!, /gh release upload/);
  const prepare = draft.steps.find((step) => step.name === "Validate and prepare desktop release assets")!;
  assert.match(prepare.run!, /prepare-release-assets\.mjs/);
  assert.ok(draft.steps.indexOf(prepare) < draft.steps.findIndex((step) => step.id === "draft"));
  assertGhRepositoryIsExplicit(workflow);
}

/** gh reads the repository from the checkout's git remote; a job without a checkout must name it. */
function assertGhRepositoryIsExplicit(workflow: Workflow) {
  for (const [name, job] of Object.entries(workflow.jobs) as [string, { steps: Step[] }][]) {
    if (job.steps.some((step) => step.uses?.startsWith("actions/checkout@"))) continue;
    for (const step of job.steps.filter((candidate) => /(^|[\s;(|&$])gh\s/m.test(candidate.run ?? ""))) {
      assert.equal(step.env?.GH_REPO, "${{ github.repository }}", `${name}/${step.name} runs gh without a checkout or GH_REPO`);
    }
  }
}

const MAC_LEG = { os: "macos-latest", label: "macOS (Apple Silicon)", target: "mac", arch: "arm64" };
const WIN_LEGS = [
  { os: "windows-latest", label: "Windows (x64)", target: "win", arch: "x64" },
  { os: "windows-11-arm", label: "Windows (arm64)", target: "win", arch: "arm64" },
];
const LINUX_LEGS = [
  { os: "ubuntu-latest", label: "Linux (x64)", target: "linux", arch: "x64" },
  { os: "ubuntu-24.04-arm", label: "Linux (arm64)", target: "linux", arch: "arm64" },
];
const ALL_TARGETS = ["mac", "win", "win", "linux", "linux"];

test("desktop matrix filters before scheduling and rejects partial publication", () => {
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform: "mac", publish: false }).matrix.include,
    [MAC_LEG]);
  // A platform dispatch expands to every shipped arch leg.
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform: "win", publish: "false" }).matrix.include, WIN_LEGS);
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform: "linux", publish: "false" }).matrix.include, LINUX_LEGS);
  for (const platform of ["mac", "win", "linux"]) {
    assert.throws(() => resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform, publish: true }), /tag-only/);
  }
  // A dev-branch push keeps the cheap unsigned macOS preview only.
  for (const eventName of ["push", "pull_request"]) {
    assert.deepEqual(resolveDesktopBuildPolicy({ eventName, ref: "refs/heads/dev" }).matrix.include.map((entry) => entry.target), ["mac"]);
    assert.deepEqual(resolveDesktopBuildPolicy({ eventName }).matrix.include.map((entry) => entry.target), ["mac"]);
  }
  // A release tag and a bare dispatch build all five legs.
  for (const eventName of ["push", "pull_request"]) {
    assert.deepEqual(resolveDesktopBuildPolicy({ eventName, ref: "refs/tags/desktop-v3.16.1" }).matrix.include.map((entry) => entry.target), ALL_TARGETS);
  }
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch" })
    .matrix.include.map((entry) => entry.target), ALL_TARGETS);
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "workflow_dispatch", platform: "all" })
    .matrix.include.map((entry) => entry.target), ALL_TARGETS);
  // Native modules make cross-arch builds unreliable: every non-x64 leg runs on
  // a matching ARM runner, never a cross-arch x64 runner.
  const armRunners = resolveDesktopBuildPolicy({ eventName: "workflow_dispatch" }).matrix.include
    .filter((entry) => entry.arch === "arm64" && entry.target !== "mac")
    .map((entry) => entry.os);
  assert.deepEqual(armRunners.sort(), ["ubuntu-24.04-arm", "windows-11-arm"]);
  // A scheduled event cannot be steered to another platform by a stray input.
  assert.deepEqual(resolveDesktopBuildPolicy({ eventName: "push", platform: "win", ref: "refs/heads/dev" })
    .matrix.include.map((entry) => entry.target), ["mac"]);
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
    (w) => { w.jobs.draft_release.if = "startsWith(github.ref, 'refs/tags/desktop-v')"; },
    (w) => { w.jobs.publish_release.environment.name = "desktop-staging"; },
    (w) => { w.jobs.publish_release.steps.find((s) => s.name === "Require configured production approval gate")!.run = "true"; },
    (w) => { (w.jobs.draft_release as { environment?: unknown }).environment = { name: "desktop-production", url: "x" }; },
    (w) => { w.jobs.build.steps.find((s) => s.id === "mac_build")!.if = "matrix.trusted"; },
    (w) => { w.jobs.build.steps.find((s) => s.id === "mac_verify")!.env!.VERIFY_REQUIRE_STAPLED = "0"; },
    (w) => { w.jobs.build.steps.find((s) => s.id === "mac_verify")!["continue-on-error"] = true; },
    (w) => { w.jobs.build.steps.find((s) => s.env?.CSC_IDENTITY_AUTO_DISCOVERY === "false")!.env!.CSC_LINK = "${{ secrets.MAC_CSC_LINK }}"; },
    (w) => { w.jobs.build.steps.find((s) => s.with?.name === "ima2-desktop-${{ matrix.target }}-${{ matrix.arch }}")!.if = "always()"; },
  ];
  for (const mutate of mutations) { const workflow = loadWorkflow(); mutate(workflow); assert.throws(() => assertWorkflowBoundary(workflow)); }
});
