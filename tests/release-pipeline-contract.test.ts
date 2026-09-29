import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPreviewVersion,
  classifyPublish,
  parsePackOutput,
  REGISTRY_PROOF_ATTEMPT_BUDGET_MS,
  REGISTRY_PROOF_MAX_TIMEOUT_MS,
  REGISTRY_PROOF_POLL_MS,
  REGISTRY_PROOF_TIMEOUT_MS,
  registryProofTimeoutMs,
  STABLE_BRANCHES,
  validateProvenance,
  validateRemoteRefs,
  verifyArtifactDigest,
  verifyRegistryEventually,
} from "../scripts/release-contract.mjs";
import { gypfileNames, validateBundleParity, validateInstallPolicy } from "../scripts/check-install-policy.mjs";
import { npmInvocation } from "../scripts/npm-subprocess.mjs";
import { assertActionPinned, assertAllActionsPinned } from "./_actionPins.mjs";
import { assertUnitProvenance, isVersionOnlyDiff, REQUIRED_UNITS } from "../scripts/release-cut.mjs";
import { parse } from "yaml";

const SHA = "a".repeat(40);

function repoRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

describe("release channel contract", () => {
  it("accepts only preview branch pushes and matching stable tag pushes", () => {
    const preview = classifyPublish({
      eventName: "push", ref: "refs/heads/preview", sha: SHA,
      packageVersion: "2.0.13", latestVersion: "2.0.13", latestGitHead: SHA,
      runId: "123", runAttempt: "1", date: new Date("2026-07-10T00:00:00Z"),
    });
    assert.equal(preview.version, "2.0.14-preview.260710.123.1");
    assert.deepEqual(
      classifyPublish({
        eventName: "push", ref: "refs/tags/v2.0.14", sha: SHA,
        packageVersion: "2.0.14", latestVersion: "2.0.13", latestGitHead: SHA,
      }),
      { shouldPublish: true, shouldVerify: false, channel: "latest", npmTag: "latest", version: "2.0.14" },
    );
    assert.deepEqual(
      classifyPublish({
        eventName: "push", ref: "refs/tags/v2.0.14", sha: SHA,
        packageVersion: "2.0.14", latestVersion: "2.0.14", latestGitHead: SHA,
      }),
      { shouldPublish: false, shouldVerify: true, channel: "latest", npmTag: "latest", version: "2.0.14" },
    );
    assert.throws(
      () => classifyPublish({
        eventName: "push", ref: "refs/tags/v2.0.12", sha: SHA,
        packageVersion: "2.0.12", latestVersion: "2.0.13", latestGitHead: SHA,
      }),
      /must be newer/,
    );
    assert.throws(() => classifyPublish({ eventName: "workflow_dispatch", ref: "refs/heads/main" }), /unsupported publish event/);
    assert.throws(() => classifyPublish({ eventName: "push", ref: "refs/heads/main" }), /unsupported publish ref/);
    assert.throws(
      () => classifyPublish({ eventName: "push", ref: "refs/tags/v2.0.15", packageVersion: "2.0.14" }),
      /does not match/,
    );
  });

  it("makes same-day runs and reruns immutable-version safe", () => {
    const base = { packageVersion: "2.0.14", latestVersion: "2.0.13", date: new Date("2026-07-10T12:00:00Z") };
    const first = buildPreviewVersion({ ...base, runId: "900", runAttempt: "1" });
    const rerun = buildPreviewVersion({ ...base, runId: "900", runAttempt: "2" });
    const next = buildPreviewVersion({ ...base, runId: "901", runAttempt: "1" });
    assert.equal(new Set([first, rerun, next]).size, 3);
  });

  it("skips a stable-tagged SHA synced back to preview", () => {
    const plan = classifyPublish({
      eventName: "push", ref: "refs/heads/preview", sha: SHA,
      packageVersion: "2.0.14", latestVersion: "2.0.14", latestGitHead: SHA,
      tagsAtHead: ["v2.0.14"], runId: "1", runAttempt: "1",
    });
    assert.equal(plan.shouldPublish, false);
    assert.equal(plan.shouldVerify, false);
  });

  it("requires the stable tag to equal the SHA and the release branches to contain it", () => {
    const LATER = "c".repeat(40);
    const refs = { main: SHA, dev: LATER, preview: SHA, "v2.0.14": SHA };
    // dev kept receiving merges during the release (v3.23.2): a descendant is fine.
    const containsAll = (ancestor: string, descendant: string) => ancestor === SHA && [SHA, LATER].includes(descendant);
    assert.deepEqual(STABLE_BRANCHES, ["main", "dev", "preview"]);
    assert.doesNotThrow(() => validateRemoteRefs({ ref: "refs/tags/v2.0.14", sha: SHA, refs, contains: containsAll }));
    // A dev that lost the release commit would orphan it.
    assert.throws(
      () => validateRemoteRefs({ ref: "refs/tags/v2.0.14", sha: SHA, refs, contains: (_a: string, d: string) => d !== LATER }),
      /remote dev .* does not contain/,
    );
    // The tag itself is immutable and must match exactly.
    assert.throws(
      () => validateRemoteRefs({ ref: "refs/tags/v2.0.14", sha: SHA, refs: { ...refs, "v2.0.14": LATER }, contains: containsAll }),
      /remote v2\.0\.14 is c+, expected a+/,
    );
    assert.throws(
      () => validateRemoteRefs({ ref: "refs/tags/v2.0.14", sha: SHA, refs: { ...refs, preview: "" }, contains: containsAll }),
      /remote preview is missing/,
    );
    // Without a predicate a stable check must refuse rather than pass.
    assert.throws(() => validateRemoteRefs({ ref: "refs/tags/v2.0.14", sha: SHA, refs }), /contains\(\) predicate/);
  });

  it("keeps a preview publish exact", () => {
    assert.doesNotThrow(() => validateRemoteRefs({ ref: "refs/heads/preview", sha: SHA, refs: { preview: SHA } }));
    assert.throws(
      () => validateRemoteRefs({ ref: "refs/heads/preview", sha: SHA, refs: { preview: "b".repeat(40) }, contains: () => true }),
      /remote preview is b+, expected a+/,
    );
    assert.throws(() => validateRemoteRefs({ ref: "refs/heads/main", sha: SHA, refs: {} }), /unsupported publish ref/);
  });
});

describe("release artifact and provenance contract", () => {
  it("rejects artifact bytes that differ from the recorded digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "ima2-release-contract-"));
    try {
      const tarball = join(dir, "package.tgz");
      writeFileSync(tarball, "expected");
      const digest = createHash("sha512").update("expected").digest();
      const manifest = { sha512: digest.toString("hex"), integrity: `sha512-${digest.toString("base64")}` };
      assert.doesNotThrow(() => verifyArtifactDigest(manifest, tarball));
      writeFileSync(tarball, "changed");
      assert.throws(() => verifyArtifactDigest(manifest, tarball), /digest mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses only the trailing npm pack manifest after noisy lifecycle output", () => {
    const output = 'build log\n[{"not":"the manifest"}]\nmore output\n[\n  {"filename":"ima2-gen.tgz","bundled":[]}\n]\n';
    assert.equal(parsePackOutput(output).filename, "ima2-gen.tgz");
    const npm12Output = 'lifecycle log\n{\n  "ima2-gen": {"filename":"ima2-gen-12.tgz","bundled":[]}\n}\n';
    assert.equal(parsePackOutput(npm12Output).filename, "ima2-gen-12.tgz");
  });

  it("requires exact workflow, ref, commit, builder, run, and subject digest", () => {
    const statement: any = {
      _type: "https://in-toto.io/Statement/v1",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [{ name: "pkg:npm/ima2-gen@2.0.14", digest: { sha512: "digest" } }],
      predicate: {
        buildDefinition: {
          buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
          externalParameters: { workflow: { repository: "https://github.com/lidge-ai/ima2-gen", path: ".github/workflows/publish.yml", ref: "refs/tags/v2.0.14" } },
          internalParameters: { github: { event_name: "push" } },
          resolvedDependencies: [{ digest: { gitCommit: SHA } }],
        },
        runDetails: {
          builder: { id: "https://github.com/actions/runner/github-hosted" },
          metadata: { invocationId: "https://github.com/lidge-ai/ima2-gen/actions/runs/1/attempts/1" },
        },
      },
    };
    const identity = validateProvenance(statement, {
      ref: "refs/tags/v2.0.14", sha: SHA, sha512: "digest", version: "2.0.14", runId: "1", runAttempt: "1",
    });
    assert.deepEqual(identity, {
      runId: "1", runAttempt: "1", runUrl: "https://github.com/lidge-ai/ima2-gen/actions/runs/1",
    });
    assert.throws(() => validateProvenance(statement, {
      ref: "refs/tags/v2.0.14", sha: SHA, sha512: "digest", version: "2.0.14", runId: "1", runAttempt: "2",
    }), /invocation mismatch/);
    statement.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/preview";
    assert.throws(() => validateProvenance(statement, {
      ref: "refs/tags/v2.0.14", sha: SHA, sha512: "digest", version: "2.0.14", runId: "1", runAttempt: "1",
    }), /source ref mismatch/);
    statement.predicate.buildDefinition.externalParameters.workflow.ref = "refs/tags/v2.0.14";
    statement.predicateType = "https://example.invalid/provenance";
    assert.throws(() => validateProvenance(statement, {
      ref: "refs/tags/v2.0.14", sha: SHA, sha512: "digest", version: "2.0.14", runId: "1", runAttempt: "1",
    }), /predicate type mismatch/);
  });

  it("accepts the dispatch host ref only for a dispatched publish", () => {
    // release.yml reaches publish.yml by workflow_dispatch, and a dispatched run
    // always executes on the default branch. npm therefore records
    // refs/heads/main even when the published target is preview or a tag.
    const dispatched: any = {
      _type: "https://in-toto.io/Statement/v1",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [{ name: "pkg:npm/ima2-gen@2.0.14", digest: { sha512: "digest" } }],
      predicate: {
        buildDefinition: {
          buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
          externalParameters: { workflow: { repository: "https://github.com/lidge-ai/ima2-gen", path: ".github/workflows/publish.yml", ref: "refs/heads/main" } },
          internalParameters: { github: { event_name: "workflow_dispatch" } },
          resolvedDependencies: [{ digest: { gitCommit: SHA } }],
        },
        runDetails: {
          builder: { id: "https://github.com/actions/runner/github-hosted" },
          metadata: { invocationId: "https://github.com/lidge-ai/ima2-gen/actions/runs/1/attempts/1" },
        },
      },
    };
    const expected = { ref: "refs/heads/preview", sha: SHA, sha512: "digest", version: "2.0.14", runId: "1", runAttempt: "1" };
    assert.deepEqual(validateProvenance(dispatched, expected).runId, "1");

    // The relaxation is scoped to the default branch. Any other ref still fails,
    // so a dispatched run cannot claim an arbitrary source.
    dispatched.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/attacker";
    assert.throws(() => validateProvenance(dispatched, expected), /source ref mismatch/);

    // A push must still match the publish target exactly: no host-ref fallback.
    dispatched.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/main";
    dispatched.predicate.buildDefinition.internalParameters.github.event_name = "push";
    assert.throws(() => validateProvenance(dispatched, expected), /source ref mismatch/);

    // The commit is the real binding and stays exact under dispatch.
    dispatched.predicate.buildDefinition.internalParameters.github.event_name = "workflow_dispatch";
    dispatched.predicate.buildDefinition.resolvedDependencies = [{ digest: { gitCommit: "b".repeat(40) } }];
    assert.throws(() => validateProvenance(dispatched, expected), /source commit mismatch/);

    // An unexpected trigger is refused outright.
    dispatched.predicate.buildDefinition.resolvedDependencies = [{ digest: { gitCommit: SHA } }];
    dispatched.predicate.buildDefinition.internalParameters.github.event_name = "pull_request";
    assert.throws(() => validateProvenance(dispatched, expected), /event mismatch/);
  });
});

describe("package install policy contract", () => {
  it("preserves Windows npm argument boundaries without a command shell", () => {
    const args = ["install", "C:\\path with spaces\\ima2.tgz", "value&literal"];
    const invocation = npmInvocation(args, {
      platform: "win32",
      nodeExecPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
    });
    assert.equal(invocation.command, "C:\\Program Files\\nodejs\\node.exe");
    assert.deepEqual(invocation.args.slice(1), args);
    assert.match(invocation.args[0], /npm-cli\.js$/);
  });

  it("detects missing install-script approvals and bundle lock drift", () => {
    const lock = { packages: { "": { bundleDependencies: ["openai-oauth"] }, "node_modules/sharp": { version: "1.2.3", hasInstallScript: true } } };
    assert.deepEqual(validateInstallPolicy({ allowScripts: {} }, lock, "root"), ["root: missing allowScripts approval for sharp@1.2.3"]);
    assert.equal(validateInstallPolicy({ allowScripts: { "sharp@1.2.3": true } }, lock, "root").length, 0);
    assert.equal(validateBundleParity({ bundleDependencies: ["openai-oauth", "zod"] }, lock).length, 1);
  });

  it("accepts a name-only approval across a version bump", () => {
    // Version-pinned approvals go stale on every dependency bump, which is how
    // #135 and #137 both went red. Name-only entries absorb the drift; npm
    // itself writes them when approving without --allow-scripts-pin.
    const before = { packages: { "": {}, "node_modules/sharp": { version: "1.2.3", hasInstallScript: true } } };
    const after = { packages: { "": {}, "node_modules/sharp": { version: "2.0.0", hasInstallScript: true } } };
    const nameOnly = { allowScripts: { sharp: true } };

    assert.deepEqual(validateInstallPolicy(nameOnly, before, "root"), []);
    assert.deepEqual(validateInstallPolicy(nameOnly, after, "root"), []);

    // Control: the pinned form must still break on the same bump. If this stops
    // failing, the stale check itself died and the name-only switch above would
    // be proving nothing.
    assert.deepEqual(validateInstallPolicy({ allowScripts: { "sharp@1.2.3": true } }, after, "root"), [
      "root: missing allowScripts approval for sharp@2.0.0",
      "root: stale allowScripts approval sharp@1.2.3",
    ]);
  });

  it("still rejects an approval for a package that is not installed", () => {
    // Name-only approvals must not turn the stale check into a no-op: an entry
    // for a package the lockfile never mentions is still dead weight.
    const lock = { packages: { "": {}, "node_modules/sharp": { version: "1.2.3", hasInstallScript: true } } };
    assert.deepEqual(validateInstallPolicy({ allowScripts: { sharp: true, ghost: true } }, lock, "root"), [
      "root: stale allowScripts approval ghost",
    ]);
  });

  it("covers every copy of a hoisted dependency with one name-only entry", () => {
    // ui/package-lock.json really does carry two fsevents copies (2.3.2 under a
    // nested tree, 2.3.3 at the top). Pinning meant listing both and updating
    // both; one name-only entry covers whatever the tree ends up holding.
    const lock = {
      packages: {
        "": {},
        "node_modules/fsevents": { version: "2.3.3", hasInstallScript: true },
        "node_modules/vite/node_modules/fsevents": { version: "2.3.2", hasInstallScript: true },
        "node_modules/esbuild": { version: "0.28.1", hasInstallScript: true },
      },
    };
    assert.deepEqual(validateInstallPolicy({ allowScripts: { fsevents: true, esbuild: true } }, lock, "ui"), []);
  });

  it("treats a gypfile package as needing approval even without hasInstallScript", () => {
    // better-sqlite3 13 moved to prebuilt binaries and dropped its install hook,
    // so the lockfile records no hasInstallScript - but binding.gyp is still in
    // the tarball and npm will still consider running node-gyp. Asking npm
    // directly is circular: approve-scripts reports only what is not yet
    // approved, so its answer depends on the manifest under validation.
    const lock = { packages: { "": {}, "node_modules/better-sqlite3": { version: "13.0.3" } } };
    assert.deepEqual(validateInstallPolicy({ allowScripts: { "better-sqlite3": true } }, lock, "root", ["better-sqlite3"]), []);
    assert.deepEqual(validateInstallPolicy({ allowScripts: {} }, lock, "root", ["better-sqlite3"]), [
      "root: missing allowScripts approval for better-sqlite3@13.0.3",
    ]);
  });

  it("does not let the gypfile allowance excuse an unrelated approval", () => {
    // The allowance keys off a real binding.gyp on disk, so approving a package
    // that ships no install script and no gypfile is still dead weight - even
    // when the lockfile carries it.
    const lock = { packages: { "": {}, "node_modules/express": { version: "5.1.0" }, "node_modules/better-sqlite3": { version: "13.0.3" } } };
    assert.deepEqual(validateInstallPolicy({ allowScripts: { express: true } }, lock, "root", ["better-sqlite3"]), [
      "root: missing allowScripts approval for better-sqlite3@13.0.3",
      "root: stale allowScripts approval express",
    ]);
    assert.deepEqual(validateInstallPolicy({ allowScripts: { ghost: true } }, lock, "root", []), [
      "root: stale allowScripts approval ghost",
    ]);
  });

  it("refuses to probe for gypfiles without an installed tree", () => {
    // gypfileNames reads node_modules. On an uninstalled checkout it would find
    // nothing and quietly turn every real approval into a stale one, so the
    // absence has to be an error rather than an empty answer.
    assert.throws(
      () => gypfileNames(join(tmpdir(), "ima2-install-policy-absent"), { packages: { "": {} } }),
      /needs an installed tree/,
    );
  });

  it("keeps publishing inside the OIDC workflow", () => {
    // The local release scripts are gone: release.yml owns the cut end to end.
    for (const path of ["scripts/release.sh", "scripts/release-preview.sh"]) {
      assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} must not come back`);
    }
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
    // workflow_dispatch is how release.yml reaches this workflow, because a GITHUB_TOKEN
    // push emits no event. It cannot widen what may be published: the ref is still
    // classified, and classifyPublish accepts only preview or a matching v* tag.
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /publish_ref:/);
    assert.match(workflow, /publish_sha:/);
    assert.doesNotMatch(workflow, /(?:^|\n)on:[\s\S]{0,400}?(?:^|\n)\s{2}release:\s*(?:\n|$)/);
    assert.match(workflow, /branches:\s*\[preview\]/);
    assert.match(workflow, /tags:\s*\['v\*'\]/);
    // Three, not two: the old single publish job is now publish-preview and
    // publish-stable so each channel can carry its own approval environment.
    // The count still matters — it is what stops a fourth job from quietly
    // gaining the ability to publish.
    assert.equal(
      (workflow.match(/id-token:\s*write/g) || []).length,
      3,
      "only publish-preview, publish-stable, and create-github-release may mint OIDC tokens",
    );
    // Each publish lane must be pinned to its own environment, or the split
    // buys nothing: an unpinned stable job would publish without approval.
    assert.match(workflow, /publish-preview:[\s\S]{0,600}?name: npm-preview/);
    assert.match(workflow, /publish-stable:[\s\S]{0,900}?name: npm-stable/);
    assert.match(workflow, /publish-stable:[\s\S]{0,700}?channel == 'latest'/);
    assert.match(workflow, /publish-preview:[\s\S]{0,300}?channel == 'preview'/);
    assert.match(workflow, /create-github-release:[\s\S]*id-token:\s*write[\s\S]*attestations:\s*write/);
    // Pin property, not commit identity: freezing the SHA here would fail the
    // next Dependabot bump the same way #162 and #178 did.
    assertActionPinned(workflow, "actions/attest-build-provenance", ".github/workflows/publish.yml");
    assert.doesNotMatch(workflow, /package:[\s\S]{0,400}id-token:\s*write/, "package job stays OIDC-free");
    assertAllActionsPinned(workflow, ".github/workflows/publish.yml");
    assert.match(workflow, /verify-artifact release-artifact\/release-manifest\.json/);
    assert.match(workflow, /TARBALL=.*'\.\/release-artifact\/'[\s\S]*npm publish "\$TARBALL"/);
    assert.match(workflow, /verify-existing:/);
    assert.match(workflow, /windows-consumer:/);
    // 260819 release-speed unit: windows-consumer runs on the preview lane
    // only. The stable lane's evidence is the preview proof — prepare verifies
    // the npm preview's gitHead equals the publish sha, and that preview could
    // only publish after this matrix passed. That inference lives in the four
    // job-scoped pins below; a global needs regex would stay green while the
    // stable lane silently lost its dependency.
    // (a) The load-bearing pin: preview CANNOT publish without the matrix.
    assert.match(
      workflow,
      /publish-preview:\s*\n\s*needs:\s*\[prepare, package, windows-consumer\]/,
      "publish-preview must depend on windows-consumer — the stable lane's skip is only safe while this holds",
    );
    // (b) The matrix is scoped to the preview channel.
    assert.match(
      workflow,
      /windows-consumer:[\s\S]{0,600}?channel == 'preview'/,
      "windows-consumer must be preview-only",
    );
    // (c) Stable keeps the dependency edge and tolerates the skipped need
    //     without accepting a failed one.
    assert.match(
      workflow,
      /publish-stable:\s*\n\s*needs:\s*\[prepare, package, windows-consumer\]/,
      "publish-stable must keep its needs edge",
    );
    const stableBlock = workflow.slice(
      workflow.indexOf("publish-stable:"),
      workflow.indexOf("create-github-release:"),
    );
    assert.match(stableBlock, /!failure\(\) && !cancelled\(\)/, "publish-stable must accept a skipped windows-consumer");
    // (d) Never always(): a failed package job must still block the publish.
    assert.doesNotMatch(stableBlock, /always\(\)/, "publish-stable must not run over failures");
    // (e) success() is transitive over the needs chain, so every job downstream
    //     of the skipped windows-consumer needs the same override, gated on its
    //     direct publish need actually succeeding. Measured failure mode on the
    //     v3.7.1 cut: tag published, GitHub Release job silently skipped.
    const ghReleaseBlock = workflow.slice(workflow.indexOf("create-github-release:"));
    assert.match(
      ghReleaseBlock,
      /!failure\(\) && !cancelled\(\)[\s\S]{0,200}?needs\.publish-stable\.result == 'success'/,
      "create-github-release must tolerate the skipped matrix but require a successful stable publish",
    );
    assert.match(workflow, /test:package-global-update/);
    assert.match(workflow, /assert-remote-ref/);
    assert.match(workflow, /id: registry[\s\S]*guard-publish/);
    assert.match(workflow, /if: steps\.registry\.outputs\.should_publish == 'true'[\s\S]*npm publish/);
    assert.match(workflow, /IMA2_EXPECT_CURRENT_PROVENANCE: \$\{\{ steps\.registry\.outputs\.should_publish \}\}/);
    assert.match(workflow, /create-github-release:/);
    // The GitHub Release must follow the stable publish specifically. Pointing
    // it at publish-preview, or at nothing, would let a Release appear for a
    // version npm never accepted.
    assert.match(workflow, /needs:\s*\[prepare, publish-stable\]/);
    assert.match(workflow, /ensure-github-release/);
    assert.match(workflow, /channel == 'latest'/);
    assert.match(workflow, /permissions:[\s\S]*contents:\s*write[\s\S]*id-token:\s*write/);

    // Every checkout and every contract call must target the ref being released, not the
    // dispatch's default-branch checkout.
    assert.match(workflow, /PUBLISH_REF: \$\{\{ inputs\.publish_ref \|\| github\.ref \}\}/);
    assert.match(workflow, /PUBLISH_SHA: \$\{\{ inputs\.publish_sha \|\| github\.sha \}\}/);
    assert.equal((workflow.match(/ref: \$\{\{ inputs\.publish_sha \|\| github\.sha \}\}/g) || []).length,
      (workflow.match(/actions\/checkout@/g) || []).length,
      "every checkout must pin the published sha");
    assert.doesNotMatch(workflow, /\$GITHUB_SHA|\$GITHUB_REF/, "steps must use the effective PUBLISH_* values");
    assert.match(workflow, /group: publish-\$\{\{ inputs\.publish_ref \|\| github\.ref \}\}/);

    const contract = readFileSync(new URL("../scripts/release-contract.mjs", import.meta.url), "utf8");
    assert.match(contract, /export async function ensureGithubRelease/);
    assert.match(contract, /command === "ensure-github-release"/);
    assert.match(contract, /gh.*release create|release", "create"/);

    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.match(manifest.scripts.prepublishOnly, /assert-publish-context/);

    // The ordering invariant survived the move from release.sh into CI: the version
    // commit precedes the preview promotion, and the stable tag follows the npm proof.
    const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    const preflightIndex = release.indexOf("release-cut.mjs preflight");
    const commitIndex = release.indexOf("release-cut.mjs commit");
    const previewIndex = release.indexOf("refs/heads/preview");
    const proofIndex = release.indexOf("assert-preview-proof");
    const tagIndex = release.indexOf("git tag");
    assert.ok(preflightIndex >= 0 && preflightIndex < commitIndex, "the baseline guard must precede the version commit");
    assert.ok(commitIndex < previewIndex, "the version commit must precede preview promotion");
    assert.ok(previewIndex < proofIndex, "preview must be promoted before its proof is required");
    assert.ok(proofIndex >= 0 && proofIndex < tagIndex, "preview proof must finish before stable tag creation");
    // The cut never publishes and never mints OIDC: publish.yml keeps both.
    assert.doesNotMatch(release, /npm publish/);
    assert.doesNotMatch(release, /^\s+id-token:\s*write/m, "only publish.yml may request an OIDC token");
    assert.doesNotMatch(release, /gh release create/);
    assertAllActionsPinned(release, ".github/workflows/release.yml");
    assert.match(release, /gh workflow run publish\.yml/);
    assert.match(release, /git push --atomic origin/);

    // The cut guards are pure functions so the policy is testable without a release.
    const cut = readFileSync(new URL("../scripts/release-cut.mjs", import.meta.url), "utf8");
    assert.match(cut, /export function assertBaseline/);
    assert.match(cut, /export function assertCuttable/);
    assert.match(cut, /export function assertPreviewProof/);
    assert.doesNotMatch(cut, /npm publish/);

    // Guards release.sh had before it promoted anything must survive the move to CI.
    assert.match(release, /npm run verify:release/, "the candidate must be verified before it is pushed");
    const verifyIndex = release.indexOf("npm run verify:release");
    assert.ok(verifyIndex < release.indexOf('git push origin "HEAD:refs/heads/main"'), "verification must precede the main push");
    assert.match(release, /release-cut\.mjs assert-clean/);
    assert.match(release, /release-contract\.mjs assert-toolchain/);
    assert.match(release, /release-cut\.mjs assert-remotes-unmoved/);

    for (const path of ["scripts/install-mac.sh", "scripts/install-linux.sh", "scripts/install-windows.ps1"]) {
      const installer = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      assert.match(installer, /allow-scripts=ima2-gen,better-sqlite3,sharp/);
      assert.match(installer, /ima2 doctor/);
    }
  });

  it("refuses a cut whose baseline, version, or preview proof is not releasable", async () => {
    const { assertBaseline, assertCuttable, assertPreviewProof } = await import("../scripts/release-cut.mjs");
    const yes = () => true;

    assert.deepEqual(assertBaseline({ head: "a", main: "a", dev: "a", preview: "a", contains: yes }), []);
    assert.match(assertBaseline({ head: "a", main: "b", dev: "a", preview: "a", contains: yes }).join(), /origin\/main is b/);
    // A main that does not contain dev would orphan merged work behind the tag.
    assert.match(assertBaseline({ head: "a", main: "a", dev: "z", preview: "a", contains: () => false }).join(), /does not contain origin\/dev/);

    assert.deepEqual(assertCuttable({ version: "3.0.6", publishedVersion: null, remoteTag: "" }), []);
    assert.match(assertCuttable({ version: "3.0.6", publishedVersion: "3.0.6", remoteTag: "" }).join(), /already published/);
    assert.match(assertCuttable({ version: "3.0.6", publishedVersion: null, remoteTag: "abc\trefs/tags/v3.0.6" }).join(), /already exists/);
    assert.match(assertCuttable({ version: "3.0.6-rc.1", publishedVersion: null, remoteTag: "" }).join(), /stable X\.Y\.Z/);

    const proven = { version: "3.0.6", sha: "abc", previewVersion: "3.0.6-preview.260812.1.1", previewGitHead: "abc" };
    assert.deepEqual(assertPreviewProof(proven), []);
    assert.match(assertPreviewProof({ ...proven, previewGitHead: "zzz" }).join(), /does not prove abc/);
    assert.match(assertPreviewProof({ ...proven, previewVersion: "3.0.5-preview.1" }).join(), /not a 3\.0\.6 candidate/);
    // A missing preview build must never read as a proof.
    assert.equal(assertPreviewProof({ ...proven, previewVersion: null, previewGitHead: null }).length, 2);

    const { assertRemotesUnmoved } = await import("../scripts/release-cut.mjs");
    assert.deepEqual(assertRemotesUnmoved({ sha: "abc", main: "abc", preview: "abc" }), []);
    // Someone merging to main while the preview build was being proven must block the tag,
    // because the tag would then certify a SHA that main no longer points at.
    assert.match(assertRemotesUnmoved({ sha: "abc", main: "def", preview: "abc" }).join(), /origin\/main moved to def/);
    assert.match(assertRemotesUnmoved({ sha: "abc", main: "abc", preview: "def" }).join(), /origin\/preview is def/);
  });

  it("waits on the run it dispatched, not on a concurrent one", async () => {
    const { pickRun } = await import("../scripts/wait-publish-run.mjs");
    // The REST run object exposes no `inputs`, so correlation uses the pre-dispatch
    // high-water mark: run ids increase, so the first dispatch above the mark is ours.
    const mark = 100;
    const runs = [
      { databaseId: 99, event: "workflow_dispatch", createdAt: "2026-08-12T11:00:00Z" },  // before the mark
      { databaseId: 101, event: "push", createdAt: "2026-08-12T12:01:00Z" },              // not a dispatch
      { databaseId: 102, event: "workflow_dispatch", createdAt: "2026-08-12T12:02:00Z" }, // ours
      { databaseId: 103, event: "workflow_dispatch", createdAt: "2026-08-12T12:03:00Z" }, // a later release
    ];
    // Oldest above the mark, so a release that starts while we wait is not adopted.
    assert.equal(pickRun(runs, mark)?.databaseId, 102);
    assert.equal(pickRun([runs[0], runs[1]], mark), undefined);
    // Out-of-order listings must not change the answer.
    assert.equal(pickRun([...runs].reverse(), mark)?.databaseId, 102);
  });

  it("follows only the publish run for its own ref when given a run title", async () => {
    const { pickRun } = await import("../scripts/wait-publish-run.mjs");
    const runs = [
      // A hand dispatch for another ref landed first, above the mark.
      { databaseId: 201, event: "workflow_dispatch", displayTitle: "Publish refs/heads/preview" },
      { databaseId: 202, event: "workflow_dispatch", displayTitle: "Publish refs/tags/v3.24.1" },
    ];
    assert.equal(pickRun(runs, 200, "Publish refs/tags/v3.24.1")?.databaseId, 202);
    assert.equal(pickRun(runs, 200, "Publish refs/tags/v3.24.2"), undefined);
    // No title keeps the old behaviour.
    assert.equal(pickRun(runs, 200)?.databaseId, 201);
  });

  it("lands the release on dev by fast-forward, merge, or not at all", async () => {
    const { planDevLanding } = await import("../scripts/release-cut.mjs");
    assert.equal(planDevLanding({ devContainsSha: true, shaContainsDev: true }), "noop");
    assert.equal(planDevLanding({ devContainsSha: true, shaContainsDev: false }), "noop");
    // dev has not moved since the cut: the release commit sits right on top of it.
    assert.equal(planDevLanding({ devContainsSha: false, shaContainsDev: true }), "fast-forward");
    // A PR merged into dev during the release.
    assert.equal(planDevLanding({ devContainsSha: false, shaContainsDev: false }), "merge");
  });

  it("resumes only a version whose tag, package version and main agree", async () => {
    const { assertResumable } = await import("../scripts/release-cut.mjs");
    const ok = { version: "3.24.1", sha: SHA, packageVersion: "3.24.1", mainContainsSha: true };
    assert.deepEqual(assertResumable(ok), []);
    assert.match(assertResumable({ ...ok, sha: "" }).join(), /tag v3\.24\.1 does not exist/);
    // A missing tag reports only that; nothing else about it can be known.
    assert.equal(assertResumable({ ...ok, sha: "" }).length, 1);
    assert.match(assertResumable({ ...ok, sha: "abc123" }).join(), /does not exist/);
    assert.match(assertResumable({ ...ok, packageVersion: "3.24.0" }).join(), /package\.json at v3\.24\.1 is 3\.24\.0/);
    assert.match(assertResumable({ ...ok, packageVersion: null }).join(), /\(unreadable\)/);
    assert.match(assertResumable({ ...ok, mainContainsSha: false }).join(), /origin\/main does not contain v3\.24\.1/);
    assert.match(assertResumable({ ...ok, version: "3.24" }).join(), /stable X\.Y\.Z/);
  });

  it("resumes an untagged cut only with the npm preview proof for its version commit", async () => {
    const { assertResumable, releaseCommitSubject } = await import("../scripts/release-cut.mjs");
    assert.equal(releaseCommitSubject("3.24.1"), "[agent] chore: release v3.24.1");
    // v3.24.1: main and preview reached the version commit, npm was slow, the tag never came.
    const untagged = {
      version: "3.24.1", sha: SHA, packageVersion: "3.24.1", mainContainsSha: true, tagged: false,
      previewVersion: "3.24.1-preview.260929.36573790959.1", previewGitHead: SHA,
    };
    assert.deepEqual(assertResumable(untagged), []);
    assert.match(assertResumable({ ...untagged, previewGitHead: "b".repeat(40) }).join(), /does not prove/);
    assert.match(assertResumable({ ...untagged, previewVersion: "3.24.0-preview.1" }).join(), /not a 3\.24\.1 candidate/);
    // A missing preview must never read as a proof.
    assert.equal(assertResumable({ ...untagged, previewVersion: null, previewGitHead: null }).length, 2);
    // A tagged resume needs no preview proof: the tag already certified it.
    assert.deepEqual(assertResumable({ ...untagged, tagged: true, previewVersion: null, previewGitHead: null }), []);
    // The commit that cut() creates carries exactly the subject resume-guard looks for.
    const source = readFileSync(join(repoRoot(), "scripts/release-cut.mjs"), "utf8");
    assert.match(source, /git\(\["commit", "-m", releaseCommitSubject\(version\)\]\)/);
  });

  it("land-dev really fast-forwards, merges, skips, and stops on a conflict", () => {
    const script = join(repoRoot(), "scripts/release-cut.mjs");
    const root = mkdtempSync(join(tmpdir(), "ima2-land-dev-"));
    try {
      const git = (cwd: string, ...args: string[]) =>
        execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const origin = join(root, "origin.git");
      const work = join(root, "work");
      git(root, "init", "-q", "--bare", "-b", "main", origin);
      git(root, "clone", "-q", origin, work);
      git(work, "config", "user.name", "test");
      git(work, "config", "user.email", "test@example.test");
      const commit = (file: string, body: string, message: string) => {
        writeFileSync(join(work, file), body);
        git(work, "add", file);
        git(work, "commit", "-q", "-m", message);
        return git(work, "rev-parse", "HEAD");
      };
      const landDev = (sha: string) =>
        spawnSync(process.execPath, [script, "land-dev", sha, "9.9.9"], { cwd: work, encoding: "utf8" });
      const originDev = () => git(work, "ls-remote", origin, "refs/heads/dev").split(/\s+/)[0];
      const isAncestor = (a: string, d: string) =>
        spawnSync("git", ["merge-base", "--is-ancestor", a, d], { cwd: work }).status === 0;

      commit("package.json", '{"version":"9.9.8"}\n', "base");
      git(work, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/dev");

      // dev did not move: the release commit fast-forwards it.
      const release = commit("package.json", '{"version":"9.9.9"}\n', "release 9.9.9");
      let result = landDev(release);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /fast-forward/);
      assert.equal(originDev(), release);

      // dev already contains the release: nothing to do.
      result = landDev(release);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /noop/);

      // A PR merged into dev during the next release: merge, never force.
      git(work, "checkout", "-q", "-b", "feature", release);
      const feature = commit("feature.txt", "feature\n", "feature");
      git(work, "push", "-q", "origin", "HEAD:refs/heads/dev");
      git(work, "checkout", "-q", "--detach", release);
      const next = commit("package.json", '{"version":"9.9.10"}\n', "release 9.9.10");
      result = landDev(next);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /merge/);
      const merged = originDev();
      assert.ok(isAncestor(next, merged) && isAncestor(feature, merged), "dev keeps both the feature and the release");
      assert.match(git(work, "log", "-1", "--format=%s", merged), /land release v9\.9\.9 on dev/);

      // A conflicting dev change stops with the resume hint and leaves dev alone.
      git(work, "checkout", "-q", "--detach", merged);
      const conflicting = commit("package.json", '{"version":"dev-edit"}\n', "dev edits package.json");
      git(work, "push", "-q", "origin", "HEAD:refs/heads/dev");
      git(work, "checkout", "-q", "--detach", next);
      const clash = commit("package.json", '{"version":"9.9.11"}\n', "release 9.9.11");
      result = landDev(clash);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /conflicts[\s\S]*npm run release -- resume 9\.9\.9/);
      assert.equal(originDev(), conflicting);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps build caches out of the index so verification cannot dirty the release", () => {
    // A tracked .tsbuildinfo is rewritten by every UI build, so the release cut's
    // post-verification clean check failed on it (run 31604716464). These files are
    // already gitignored; being tracked as well was an accident.
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n");
    const caches = tracked.filter((path) => /\.tsbuildinfo$/.test(path));
    assert.deepEqual(caches, [], `build caches must not be tracked: ${caches.join(", ")}`);
  });

  it("keeps generated .js out of the index when its .ts source is tracked", () => {
    // Tracked build output drifts from its tracked source and dirties the release
    // verification worktree (run 31604716464 class of failure). ui/ and vendor/
    // keep their own checked-in artifacts and are out of scope here.
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const trackedSet = new Set(tracked);
    const paired = tracked.filter(
      (path) =>
        path.endsWith(".js") &&
        !/^(ui\/|vendor\/|node_modules)/.test(path) &&
        trackedSet.has(path.replace(/\.js$/, ".ts")),
    );
    assert.deepEqual(paired, [], `generated files must not be tracked: ${paired.join(", ")}`);
  });

  it("maps every release script to an explicit bump/dry_run pair", () => {
    // c1b: a missing or wrong dry_run flag turns a release command into a silent
    // no-op (or a dry dispatch into a real release). Assert exact strings.
    // D6 routes every entry through scripts/release.mjs, which dispatches
    // release.yml with the matching dry_run input itself.
    const pkg = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8"));
    assert.equal(pkg.scripts["release:dry"], "node scripts/release.mjs patch --dry-run");
    assert.equal(pkg.scripts["release:canary"], "node scripts/release.mjs patch --canary");
    assert.equal(pkg.scripts["release:patch"], "node scripts/release.mjs patch");
    assert.equal(pkg.scripts["release:minor"], "node scripts/release.mjs minor");
    assert.equal(pkg.scripts["release:major"], "node scripts/release.mjs major");
  });

  it("gates the tag job on a real release and keeps the candidate ref leased", () => {
    const workflow = readFileSync(join(repoRoot(), ".github/workflows/release.yml"), "utf8");
    // The most dangerous dry-run failure mode: a missing or permissive job-level
    // if performs a real release. dry_run must be == 'false' (not != 'true') so
    // canary cannot slip through, and !cancelled() must stay or a resume (which
    // skips the cut) could never reach the tag job.
    const tagIf = /\n  tag:\n[\s\S]*?\n    if: (.+)\n/.exec(workflow)?.[1] ?? "";
    assert.match(tagIf, /!cancelled\(\)/);
    assert.match(tagIf, /inputs\.dry_run == 'false'/);
    assert.match(tagIf, /needs\.cut\.result == 'success' && needs\.cut\.outputs\.dry_run == 'false'/);
    assert.match(tagIf, /inputs\.resume_version != ''/);
    assert.doesNotMatch(tagIf, /dry_run != 'true'/);
    // The workflow default must be the harmless mode.
    assert.match(workflow, /dry_run:[\s\S]*?default: 'true'/);
    // Candidate ref: leased replacement and owned cleanup.
    assert.match(workflow, /--force-with-lease="refs\/heads\/release-candidate:/);
    assert.match(workflow, /\[ "\$CURRENT" = "\$CANDIDATE_SHA" \]/);
    // The CI gate must run before main moves.
    const gateIndex = workflow.indexOf("Dispatch CI for the exact candidate SHA");
    const mainPushIndex = workflow.indexOf("Push the version commit to main");
    assert.ok(gateIndex > -1 && mainPushIndex > -1 && gateIndex < mainPushIndex);
  });

  it("every candidate job checks out and guards the dispatched SHA before package execution", () => {
    const ci = parse(readFileSync(join(repoRoot(), ".github/workflows/ci.yml"), "utf8"));
    const ref = "${{ github.event.inputs.sha || github.sha }}";
    assert.equal(ci.on.workflow_dispatch.inputs.sha.type, "string");
    // Cross-platform coverage is post-merge: pushes to the integration and
    // release lines run every leg, scoped by the changes filter on the same
    // pushed range. There is no pull_request trigger — the PR contract is the
    // PR fast gate alone.
    assert.equal(ci.on.pull_request, undefined);
    assert.deepEqual(ci.on.push.branches, ["main", "dev", "preview"]);
    for (const name of ["test", "windows", "macos-install", "e2e"]) {
      const steps = ci.jobs[name].steps;
      const checkout = steps.filter((s: any) => s.uses?.startsWith("actions/checkout@"));
      assert.equal(checkout.length, 1, name);
      assert.equal(checkout[0].with.ref, ref, name);
      assert.equal(checkout[0].with["fetch-depth"], 0, name);
      const index = steps.findIndex((s: any) => name === "e2e"
        ? s.env?.WP07_EXPECTED_SHA === ref : s.run === "node scripts/assert-ci-sha.mjs");
      assert.ok(index >= 0, `${name}: missing guard`);
      assert.equal(steps[index].if, undefined);
      assert.ok(!steps[index]["continue-on-error"]);
      assert.ok(index < steps.findIndex((s: any) => /\bnpm\b/.test(s.run ?? "")), name);
      if (name === "e2e") {
        assert.match(steps[index].run, /execFileSync\("git", \["rev-parse", "HEAD"\]/);
        assert.match(steps[index].run, /wanted !== actual/);
      } else assert.equal(steps[index].env.EXPECTED_SHA, ref);
      // Every heavy leg is scoped to what the push changed; dispatch and
      // schedule always request it, so the release candidate gate is whole.
      assert.equal(ci.jobs[name].needs, "changes", name);
      assert.equal(ci.jobs[name].if, "github.event_name != 'push' || needs.changes.outputs.ci == 'true'", name);
    }
    // The aggregate names every producer, so a job that never started cannot
    // report green through a skipped dependency chain.
    assert.deepEqual([...ci.jobs.ci.needs].sort(), ["changes", "e2e", "macos-install", "test", "windows"]);
    assert.equal(ci.jobs.ci.if, "always()");
    const mac = ci.jobs["macos-install"];
    assert.equal(mac["runs-on"], "macos-latest");
    assert.equal(mac.needs, "changes");
    assert.equal(mac.if, "github.event_name != 'push' || needs.changes.outputs.ci == 'true'");
    assert.ok(mac.steps.some((s: any) => s.run === "npm run test:package-install"));
    assert.ok(mac.steps.some((s: any) => s.run?.includes("tests/install-runtime-contract.test.ts")));
  });

  it("all PR bases use a guarded synthetic merge SHA distinct from the layer head", () => {
    const workflow = parse(readFileSync(join(repoRoot(), ".github/workflows/pr-fast.yml"), "utf8"));
    assert.deepEqual(workflow.on.pull_request, {});
    const steps = workflow.jobs.fast.steps;
    assert.equal(steps[0].with.ref, "${{ github.sha }}");
    const guard = steps.find((s: any) => s.run === "node scripts/assert-ci-sha.mjs");
    assert.equal(guard.env.EXPECTED_SHA, "${{ github.sha }}");
    assert.equal(guard.if, undefined);
    assert.ok(!guard["continue-on-error"]);
    assert.ok(steps.indexOf(guard) < steps.findIndex((s: any) => /\bnpm\b/.test(s.run ?? "")));
    const identity = steps.find((s: any) => s.env?.PR_HEAD_SHA);
    assert.equal(identity.env.PR_HEAD_SHA, "${{ github.event.pull_request.head.sha }}");
    assert.equal(identity.env.MERGE_SHA, "${{ github.sha }}");
  });

  it("PR frontend has a fresh runner and the preserved gate requires both jobs", () => {
    const workflow = parse(readFileSync(join(repoRoot(), ".github/workflows/pr-fast.yml"), "utf8"));
    const { fast, frontend, gate } = workflow.jobs;
    assert.equal(frontend.needs, "changes", "backend and UI must run independently");
    assert.equal(fast.needs, "changes");
    for (const job of [fast, frontend]) assert.equal(job.if, "needs.changes.outputs.code == 'true'");
    assert.equal(frontend["runs-on"], "ubuntu-latest");
    assert.equal(frontend.steps[0].with.ref, "${{ github.sha }}");
    assert.equal(frontend.steps[0].with["persist-credentials"], false);
    const commands = frontend.steps.map((s: any) => s.run).filter(Boolean);
    for (const command of ["node scripts/assert-ci-sha.mjs", "npm ci", "npm --prefix ui ci --no-audit --no-fund",
      "npm run build:server", "npm run build:cli", "npm --prefix ui run build:fixture", "npm --prefix ui run test:e2e"]) {
      assert.ok(commands.includes(command), command);
    }
    assert.equal(frontend.steps.find((s: any) => s.run === commands[0]).env.EXPECTED_SHA, "${{ github.sha }}");
    assert.equal(commands.includes("npm test"), false);
    assert.ok(fast.steps.some((s: any) => s.run === "npm test"));
    const uploads = frontend.steps.filter((s: any) => s.uses?.startsWith("actions/upload-artifact@"));
    assert.ok(uploads.some((s: any) => s.with.path.includes("wp12-*.png")));
    assert.ok(uploads.some((s: any) => s.with.path.includes("wp08c-*.png")));
    assert.equal(gate.name, "PR fast gate");
    assert.deepEqual(gate.needs, ["changes", "fast", "frontend"]);
    assert.equal(gate.if, "always()");
    assert.equal(gate.steps.length, 1);
    const step = gate.steps[0];
    assert.equal(step.if, undefined);
    assert.ok(!step["continue-on-error"]);
    assert.deepEqual(step.env, { CODE: "${{ needs.changes.outputs.code }}", BACKEND_RESULT: "${{ needs.fast.result }}", FRONTEND_RESULT: "${{ needs.frontend.result }}" });
    const predicate = /^node -e '([^']+)'$/.exec(step.run)?.[1];
    assert.ok(predicate, "execute the actual aggregate predicate without a platform shell");
    for (const code of ["true", "false", ""]) {
      for (const backend of ["success", "failure", "cancelled", "skipped"]) {
        for (const ui of ["success", "failure", "cancelled", "skipped"]) {
          const result = spawnSync(process.execPath, ["-e", predicate], {
            env: { CODE: code, BACKEND_RESULT: backend, FRONTEND_RESULT: ui }, timeout: 5000,
          });
          assert.equal(result.error, undefined);
          const expected = code === "true" ? backend === "success" && ui === "success"
            : code === "false" && backend === "skipped" && ui === "skipped";
          assert.equal(result.status === 0, expected, `${code}/${backend}/${ui}`);
        }
      }
    }
  });

  it("ci gate correlates runs by full candidate SHA only", async () => {
    const { pickRun, assertFullSha } = await import("../scripts/wait-ci-gate.mjs");
    const sha = "b".repeat(40);
    assert.throws(() => assertFullSha(sha.slice(0, 7)), /full 40-char SHA/);
    const runs = [
      { databaseId: 10, event: "workflow_dispatch", headSha: sha },           // before mark
      { databaseId: 11, event: "push", headSha: sha },                        // not a dispatch
      { databaseId: 12, event: "workflow_dispatch", headSha: "c".repeat(40) }, // different SHA
      { databaseId: 13, event: "workflow_dispatch", headSha: sha },           // ours
    ];
    assert.equal(pickRun(runs, 10, sha)?.databaseId, 13);
    assert.equal(pickRun(runs, 10, "d".repeat(40)), undefined);
  });
});

describe("release provenance guard (wp2)", () => {
  const HEAD = "f".repeat(40);
  const MERGED = "a".repeat(40);
  const containsAll = () => true;
  const containsNone = () => false;

  it("passes only for a full 40-hex commit that HEAD contains", () => {
    assert.deepEqual(
      assertUnitProvenance({ head: HEAD, requiredCommits: { wp9: MERGED }, contains: containsAll }),
      [],
    );
  });

  it("fails closed for null, a missing key, an empty object, and a non-object file", () => {
    for (const value of [{ wp9: null }, {}, { other: MERGED }]) {
      assert.equal(
        assertUnitProvenance({ head: HEAD, requiredCommits: value, contains: containsAll }).length,
        1,
        "expected one problem for " + JSON.stringify(value),
      );
    }
    // An empty {} is the case a file-iterating guard would pass with zero checks.
    assert.match(
      assertUnitProvenance({ head: HEAD, requiredCommits: {}, contains: containsAll })[0],
      /missing from \.release\/required-units\.json/,
    );
    for (const value of [null, undefined, [], true, "", 3]) {
      assert.deepEqual(
        assertUnitProvenance({ head: HEAD, requiredCommits: value as never, contains: containsAll }),
        [".release/required-units.json must be a JSON object"],
        "expected object rejection for " + JSON.stringify(value ?? null),
      );
    }
  });

  it("rejects symbolic refs and abbreviated hashes before asking git", () => {
    // git resolves HEAD and dev, so contains() would answer true for a value that
    // proves nothing. A throwing contains() proves the oid test runs first.
    const explode = () => {
      throw new Error("contains must not run for a non-oid value");
    };
    for (const sha of ["HEAD", "dev", "origin/dev", "v3.12.1", MERGED.slice(0, 8), MERGED.slice(0, 39), MERGED + "0"]) {
      const problems = assertUnitProvenance({ head: HEAD, requiredCommits: { wp9: sha }, contains: explode });
      assert.equal(problems.length, 1, sha + " must be refused");
      assert.match(problems[0], /full 40-hex commit id/);
    }
  });

  it("fails when the recorded commit is not an ancestor of HEAD", () => {
    assert.deepEqual(
      assertUnitProvenance({ head: HEAD, requiredCommits: { wp9: MERGED }, contains: containsNone }),
      ["HEAD does not contain wp9 (" + MERGED + ")"],
    );
  });

  it("names the required units in code, not in the JSON file", () => {
    assert.deepEqual(REQUIRED_UNITS, ["wp9"]);
    const source = readFileSync(join(repoRoot(), "scripts/release-cut.mjs"), "utf8");
    assert.ok(
      !/Object\.(entries|keys)\(\s*(map|requiredCommits)/.test(source),
      "iterating the file would let {} read as success",
    );
  });

  it("ships the required-units file fail-closed until wp9 lands", () => {
    const file = JSON.parse(readFileSync(join(repoRoot(), ".release/required-units.json"), "utf8"));
    for (const unit of REQUIRED_UNITS) {
      assert.ok(Object.prototype.hasOwnProperty.call(file, unit), unit + " must be present");
    }
    // A recorded SHA is only meaningful if it is a real commit this repo can reach.
    // Accepting any 40-hex string would let 9999... read as merged provenance.
    const realContains = (ancestor: string, descendant: string) => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
          cwd: repoRoot(),
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    };
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot(), encoding: "utf8" }).trim();
    const problems = assertUnitProvenance({ head, requiredCommits: file, contains: realContains });
    for (const unit of REQUIRED_UNITS) {
      if (file[unit] === null) {
        assert.ok(problems.length > 0, unit + " is unmerged, so the guard must refuse");
        continue;
      }
      assert.deepEqual(problems, [], "a recorded " + unit + " SHA must be a real ancestor of HEAD");
    }
  });

  it("keeps the guard on the publishing path and off the readiness path", () => {
    const source = readFileSync(join(repoRoot(), "scripts/release-cut.mjs"), "utf8");
    const preflight = source.slice(source.indexOf("function preflight()"));
    assert.match(preflight.slice(0, 400), /assertUnitProvenance/, "preflight must run the guard");
    const baseline = source.slice(source.indexOf("function baseline()"), source.indexOf("function preflight()"));
    assert.ok(!baseline.includes("assertUnitProvenance"), "assert-baseline must stay provenance-free");
    assert.match(source, /"assert-baseline": \(\) => baseline\(\)/, "the subcommand must be registered");
    assert.match(source, /usage: release-cut\.mjs preflight \| assert-baseline \|/, "usage must list it");
    // release.yml stays on full preflight: the publishing path must not be able to
    // opt into the baseline-only command.
    const release = readFileSync(join(repoRoot(), ".github/workflows/release.yml"), "utf8");
    assert.match(release, /release-cut\.mjs preflight/);
    assert.ok(!release.includes("release-cut.mjs assert-baseline"), "release.yml must not use the readiness command");
  });
});

describe("registry proof window", () => {
  type VerifyFn = NonNullable<Parameters<typeof verifyRegistryEventually>[1]>["verify"];
  const notFound = () => new Error("E404 No match found for version 3.17.0");

  function harness(failures: number) {
    let clock = 1_000_000;
    const calls = { verify: 0, sleeps: [] as number[], logs: [] as string[] };
    const options = {
      pollMs: REGISTRY_PROOF_POLL_MS,
      now: () => clock,
      sleep: async (ms: number) => { calls.sleeps.push(ms); clock += ms; },
      log: (message: string) => { calls.logs.push(message); },
      verify: (async () => {
        calls.verify += 1;
        if (calls.verify <= failures) throw notFound();
        return { version: "3.17.0" };
      }) as unknown as VerifyFn,
    };
    return { calls, options };
  }

  it("keeps polling through npm's async processing and returns the proof", async () => {
    const { calls, options } = harness(2);
    const proof = await verifyRegistryEventually({}, { ...options, timeoutMs: 60_000 });
    assert.deepEqual(proof, { version: "3.17.0" });
    assert.equal(calls.verify, 3);
    assert.deepEqual(calls.sleeps, [REGISTRY_PROOF_POLL_MS, REGISTRY_PROOF_POLL_MS]);
    assert.equal(calls.logs.length, 2);
    assert.match(calls.logs[0]!, /registry proof pending \(0s\): E404 No match found/);
    assert.match(calls.logs[1]!, /registry proof pending \(10s\): E404 No match found/);
  });

  it("does not wait when the first attempt proves the release", async () => {
    const { calls, options } = harness(0);
    await verifyRegistryEventually({}, { ...options, timeoutMs: 60_000 });
    assert.equal(calls.verify, 1);
    assert.deepEqual(calls.sleeps, []);
    assert.deepEqual(calls.logs, []);
  });

  it("makes a final attempt at the deadline and then rethrows its error", async () => {
    const { calls, options } = harness(Infinity);
    await assert.rejects(verifyRegistryEventually({}, { ...options, timeoutMs: 25_000 }), /E404 No match found/);
    // Attempts at 0s, 10s, 20s and 25s: the last wait is clipped to the deadline, none follows it.
    assert.equal(calls.verify, 4);
    assert.deepEqual(calls.sleeps, [10_000, 10_000, 5_000]);
  });

  it("still makes exactly one attempt with a zero window", async () => {
    const { calls, options } = harness(Infinity);
    await assert.rejects(verifyRegistryEventually({}, { ...options, timeoutMs: 0 }), /E404/);
    assert.equal(calls.verify, 1);
    assert.deepEqual(calls.sleeps, []);
  });

  it("covers observed npm delays by default and accepts only a bounded integer override", () => {
    // 3.24.1-preview was still E404 more than 15 minutes after its publish.
    assert.ok(REGISTRY_PROOF_TIMEOUT_MS >= 2 * 15.2 * 60_000, "default window covers twice the slowest observed delay");
    assert.equal(registryProofTimeoutMs({}), REGISTRY_PROOF_TIMEOUT_MS);
    assert.equal(registryProofTimeoutMs({ IMA2_REGISTRY_PROOF_TIMEOUT_MS: "" }), REGISTRY_PROOF_TIMEOUT_MS);
    assert.equal(registryProofTimeoutMs({ IMA2_REGISTRY_PROOF_TIMEOUT_MS: "60000" }), 60_000);
    assert.equal(registryProofTimeoutMs({ IMA2_REGISTRY_PROOF_TIMEOUT_MS: String(REGISTRY_PROOF_MAX_TIMEOUT_MS) }), REGISTRY_PROOF_MAX_TIMEOUT_MS);
    for (const raw of ["0", "-1", "abc", "1.5", "60000abc", String(REGISTRY_PROOF_MAX_TIMEOUT_MS + 1)]) {
      assert.throws(() => registryProofTimeoutMs({ IMA2_REGISTRY_PROOF_TIMEOUT_MS: raw }), /IMA2_REGISTRY_PROOF_TIMEOUT_MS/, raw);
    }
  });

  it("gives both publish verify steps room for the longest window plus one worst-case attempt", () => {
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
    const steps = [...workflow.matchAll(/- name: Verify registry, dist-tag, integrity, and provenance\n((?:\s+#.*\n)*)\s+timeout-minutes: (\d+)/g)];
    assert.equal(steps.length, 2);
    for (const step of steps) {
      assert.ok(Number(step[2]) * 60_000 >= REGISTRY_PROOF_MAX_TIMEOUT_MS + REGISTRY_PROOF_ATTEMPT_BUDGET_MS);
    }
    assert.equal(workflow.includes("IMA2_REGISTRY_PROOF_TIMEOUT_MS"), false, "the override stays local/manual");
  });
});

describe("version-only reuse classification (D2)", () => {
  it("accepts only a non-empty subset of package.json and package-lock.json", () => {
    assert.equal(isVersionOnlyDiff(["package.json"]), true);
    assert.equal(isVersionOnlyDiff(["package-lock.json"]), true);
    assert.equal(isVersionOnlyDiff(["package.json", "package-lock.json"]), true);
    // Empty diff is not a version commit; neither is anything else.
    assert.equal(isVersionOnlyDiff([]), false);
    assert.equal(isVersionOnlyDiff(["package.json", "README.md"]), false);
    assert.equal(isVersionOnlyDiff(["server.ts"]), false);
    for (const value of [null, undefined, {}, "package.json"] as never[]) {
      assert.equal(isVersionOnlyDiff(value), false, JSON.stringify(value));
    }
  });

  it("version-only step in the cut reads the diff against the parent commit", () => {
    const workflow = readFileSync(join(repoRoot(), ".github/workflows/release.yml"), "utf8");
    assert.match(workflow, /release-cut\.mjs version-only/);
    assert.match(workflow, /git rev-parse \$\{\{ steps\.commit\.outputs\.sha \}\}\^/);
    assert.match(workflow, /id: versiononly/);
    assert.match(workflow, /id: reuse/);
    assert.match(workflow, /wait-ci-gate\.mjs reuse-push/);
    // The version-only check runs after verify and before any reuse decision.
    const cleanIndex = workflow.indexOf("release-cut.mjs assert-clean");
    const versionOnlyIndex = workflow.indexOf("id: versiononly");
    const reuseIndex = workflow.indexOf("id: reuse");
    const candidateIndex = workflow.indexOf("Publish the candidate to its own ref");
    assert.ok(cleanIndex > -1 && cleanIndex < versionOnlyIndex, "version-only check follows assert-clean");
    assert.ok(versionOnlyIndex < reuseIndex, "reuse decision follows the version-only check");
    assert.ok(reuseIndex < candidateIndex, "reuse decision precedes the candidate push");
  });

  it("reuse is skipped in canary and every candidate step carries the reuse guard", () => {
    const workflow = readFileSync(join(repoRoot(), ".github/workflows/release.yml"), "utf8");
    assert.match(
      workflow,
      /if: \$\{\{ inputs\.dry_run != 'canary' && steps\.versiononly\.outputs\.version_only == 'true' \}\}/,
      "canary must still exercise the candidate CI gate",
    );
    const candidateNames = [
      "Publish the candidate to its own ref",
      "Record the CI run high-water mark",
      "Dispatch CI for the exact candidate SHA",
      "Wait for the candidate CI gate",
      "Clean up the candidate ref",
    ];
    for (const name of candidateNames) {
      const stepStart = workflow.indexOf(`name: ${name}`);
      assert.ok(stepStart > -1, name);
      const stepEnd = workflow.indexOf("\n      - ", stepStart);
      const stepBlock = workflow.slice(stepStart, stepEnd === -1 ? workflow.length : stepEnd);
      assert.match(
        stepBlock,
        /steps\.reuse\.outputs\.reusable != 'true'/,
        `${name} must be skipped when the main push CI was reused`,
      );
      assert.match(stepBlock, /inputs\.dry_run != 'true'/, `${name} keeps its dry_run guard`);
    }
  });

  it("classifies a main push run reusable only when it is green with every family run", async () => {
    const { classifyPushRun } = await import("../scripts/wait-ci-gate.mjs");
    const sha = "e".repeat(40);
    const run = { databaseId: 9, event: "push", headBranch: "main", headSha: sha, status: "completed", conclusion: "success" };
    const jobs = [
      { name: "ci", conclusion: "success" },
      { name: "test (ubuntu-latest, node 22.23.0, npm 11.18.0)", conclusion: "success" },
      { name: "windows (node 22.23.0, npm 11.18.0)", conclusion: "success" },
      { name: "macOS native installation", conclusion: "success" },
      { name: "frontend e2e (ubuntu)", conclusion: "success" },
    ];

    const green = classifyPushRun(run, jobs);
    assert.equal(green.reusable, true);
    assert.equal(green.red, false);

    // schedule/dispatch runs on the same SHA never count.
    for (const event of ["schedule", "workflow_dispatch"]) {
      const verdict = classifyPushRun({ ...run, event }, jobs);
      assert.equal(verdict.reusable, false, event);
      assert.equal(verdict.red, false, event);
      assert.match(verdict.reason, new RegExp(event));
    }

    // A run on any branch but main is not the main push CI.
    const branch = classifyPushRun({ ...run, headBranch: "dev" }, jobs);
    assert.equal(branch.reusable, false);
    assert.match(branch.reason, /not main/);

    // A skipped e2e job means the push CI never exercised the suite.
    const skipped = classifyPushRun(run, jobs.map((j) => j.name.startsWith("frontend e2e") ? { ...j, conclusion: "skipped" } : j));
    assert.equal(skipped.reusable, false);
    assert.equal(skipped.red, false);
    assert.match(skipped.reason, /frontend e2e/);

    // Missing ci aggregator -> not reusable.
    const noAggregator = classifyPushRun(run, jobs.filter((j) => j.name !== "ci"));
    assert.equal(noAggregator.reusable, false);
    assert.match(noAggregator.reason, /ci/);

    // A missing family entirely -> not reusable.
    const noWindows = classifyPushRun(run, jobs.filter((j) => !j.name.startsWith("windows (")));
    assert.equal(noWindows.reusable, false);
    assert.match(noWindows.reason, /windows/);

    // Failure is red: the parent tree itself is broken.
    const red = classifyPushRun({ ...run, conclusion: "failure" }, jobs);
    assert.deepEqual(red, { reusable: false, red: true, reason: `main CI is red for ${sha}` });

    // Cancelled/skipped/incomplete run -> fallback, never red.
    for (const conclusion of ["cancelled", "skipped", null]) {
      const verdict = classifyPushRun({ ...run, conclusion }, jobs);
      assert.equal(verdict.reusable, false, String(conclusion));
      assert.equal(verdict.red, false, String(conclusion));
    }

    // No run at all -> fallback.
    const none = classifyPushRun(null, jobs);
    assert.equal(none.reusable, false);
    assert.equal(none.red, false);
  });
});

describe("tag job dispatches (D4/D5)", () => {
  const releaseYml = () => readFileSync(join(repoRoot(), ".github/workflows/release.yml"), "utf8");
  // One step's text: from its name to the next step of the same job.
  const stepBlock = (workflow: string, name: string) => {
    const start = workflow.indexOf("name: " + name);
    assert.ok(start > -1, "missing step " + name);
    const next = workflow.indexOf("\n      - ", start);
    return workflow.slice(start, next === -1 ? undefined : next);
  };
  const tagJob = (workflow: string) => workflow.slice(workflow.indexOf("\n  tag:\n"));

  it("pushes main and the tag atomically, then lands the release on dev", () => {
    const workflow = releaseYml();
    const job = tagJob(workflow);
    const atomic = stepBlock(job, "Create and atomically push main and the tag");
    // A dev that moved during the release must not reject main and the tag.
    assert.doesNotMatch(atomic, /refs\/heads\/dev/);
    assert.match(atomic, /git push --atomic origin/);
    assert.match(atomic, /refs\/heads\/main/);
    assert.match(atomic, /if: inputs\.resume_version == ''/);
    const land = stepBlock(job, "Land the release on dev");
    assert.match(land, /release-cut\.mjs land-dev "\$SHA" "\$VERSION"/);
    assert.doesNotMatch(land, /if:/, "a resume lands dev too");
    assert.ok(job.indexOf("Create and atomically push main and the tag") < job.indexOf("Land the release on dev"));
    assert.ok(job.indexOf("Land the release on dev") < job.indexOf("Check the desktop release tag"));
    const cut = readFileSync(join(repoRoot(), "scripts/release-cut.mjs"), "utf8");
    assert.doesNotMatch(cut, /--force/, "dev is never force-pushed");
  });

  it("resolves version and SHA once and reads them from there in both modes", () => {
    const job = tagJob(releaseYml());
    const target = stepBlock(job, "Resolve the release version and SHA");
    assert.match(job, /- id: target\n\s+name: Resolve the release version and SHA/);
    assert.match(target, /release-cut\.mjs resume-guard "\$RESUME_VERSION"/);
    assert.ok(job.indexOf("Fetch release branches and tags") < job.indexOf("Resolve the release version and SHA"), "resume-guard needs origin/main");
    assert.ok(job.indexOf("Resolve the release version and SHA") < job.indexOf("Refuse to tag if the remotes moved"));
    // After the target step nothing reads the cut outputs, or a resume would see empty values.
    const afterTarget = job.slice(job.indexOf("Resolve the release version and SHA") + target.length);
    assert.doesNotMatch(afterTarget, /needs\.cut\.outputs/);
    // A resume checks out main, because the release tag may not exist yet.
    assert.match(job, /ref: \$\{\{ needs\.cut\.outputs\.sha \|\| 'main' \}\}/);
  });

  it("mints a missing release tag in a resume before landing dev", () => {
    const job = tagJob(releaseYml());
    const mint = stepBlock(job, "Create the missing release tag");
    assert.match(mint, /if: steps\.target\.outputs\.mint_tag == 'true'/);
    assert.match(mint, /git tag "v\$VERSION" "\$SHA"/);
    assert.match(mint, /git push origin "refs\/tags\/v\$VERSION:refs\/tags\/v\$VERSION"/);
    assert.doesNotMatch(mint, /refs\/heads\//, "minting touches no branch");
    assert.ok(job.indexOf("Resolve the release version and SHA") < job.indexOf("Create the missing release tag"));
    assert.ok(job.indexOf("Create the missing release tag") < job.indexOf("Land the release on dev"));
    const cut = readFileSync(join(repoRoot(), "scripts/release-cut.mjs"), "utf8");
    assert.match(cut, /emit\(\{ version, sha, mint_tag: String\(!tagged\) \}\)/);
    // Every normal release depends on this: the cut branch of the target step never
    // asks for a tag, or the mint step would run after the atomic push and fail.
    const target = stepBlock(job, "Resolve the release version and SHA");
    const cutBranch = target.slice(target.indexOf("else"));
    assert.ok(target.indexOf("else") > -1);
    assert.doesNotMatch(cutBranch, /mint_tag/);
  });

  it("finds the newest version commit with exactly this version's subject", async () => {
    const { findReleaseCommit } = await import("../scripts/release-cut.mjs");
    const root = mkdtempSync(join(tmpdir(), "ima2-find-release-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      git("init", "-q", "-b", "main");
      git("config", "user.name", "test");
      git("config", "user.email", "test@example.test");
      const commit = (subject: string) => { git("commit", "-q", "--allow-empty", "-m", subject); return git("rev-parse", "HEAD"); };
      commit("[agent] chore: release v3.24.1");
      const newer = commit("[agent] chore: release v3.24.1");
      commit("[agent] chore: release v3.24.10");
      commit("feat: mention [agent] chore: release v3.24.1 in a body-less subject suffix");
      const run = (args: string[]) => git(...args);
      assert.equal(findReleaseCommit("3.24.1", "main", run), newer);
      assert.equal(findReleaseCommit("3.24.2", "main", run), "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never pushes the admin-only desktop tag from CI and dispatches only for an existing tag", () => {
    const workflow = releaseYml();
    const job = tagJob(workflow);
    const check = stepBlock(job, "Check the desktop release tag");
    // An existing desktop-v tag must resolve to the release SHA or the job fails.
    assert.match(check, /git rev-parse -q --verify "refs\/tags\/desktop-v\$VERSION"/);
    assert.match(check, /desktop-v\$VERSION\^\{commit\}/);
    assert.match(check, /exit 1/);
    assert.match(check, /present=true/);
    assert.match(check, /present=false/);
    // v3.24.0: the workflow token cannot create desktop-v tags. The only mention
    // of a push is the by-hand hint inside the notice.
    assert.doesNotMatch(check, /^\s*git push/m);
    assert.doesNotMatch(workflow, /DESKTOP_TAG_DEPLOY_KEY/);
    const dispatchBlock = stepBlock(job, "Start the desktop release build");
    assert.match(dispatchBlock, /if: steps\.desktop_tag\.outputs\.present == 'true'/);
    // Never dispatch over a public release or a build still running for this tag
    // (desktop.yml cancels an in-flight run of the same ref).
    assert.match(dispatchBlock, /gh release view "desktop-v\$VERSION" --json isDraft --jq \.isDraft 2>\/dev\/null \|\| echo missing/);
    assert.match(dispatchBlock, /--branch "desktop-v\$VERSION"/);
    assert.match(dispatchBlock, /select\(\.status != "completed"\)/);
    assert.ok(job.indexOf("Check the desktop release tag") < job.indexOf("Start the desktop release build"));
    assert.match(dispatchBlock, /gh workflow run desktop\.yml/);
    assert.match(dispatchBlock, /--ref "desktop-v/);
    assert.match(dispatchBlock, /-f platform=all/);
    assert.match(dispatchBlock, /continue-on-error: true/);
    assert.match(dispatchBlock, /GH_TOKEN/);
    assert.match(dispatchBlock, /re-dispatch desktop:/);
  });

  it("skips the stable publish only when npm and GitHub already have this release", () => {
    const job = tagJob(releaseYml());
    const state = stepBlock(job, "Check whether the stable release already landed");
    assert.match(job, /- id: stable_state\n/);
    // Every probe tolerates "not found", or a normal release would die here.
    assert.match(state, /done=false/);
    assert.match(state, /npm view "ima2-gen@\$VERSION" gitHead 2>\/dev\/null \|\| true/);
    assert.match(state, /npm view ima2-gen@latest version 2>\/dev\/null \|\| true/);
    assert.match(state, /HAS_GH=1 \|\| HAS_GH=0/);
    assert.match(state, /echo "done=\$done" >> "\$GITHUB_OUTPUT"/);
    for (const name of ["Record the publish run high-water mark", "Publish the stable release", "Wait for the stable publish to finish"]) {
      assert.match(stepBlock(job, name), /if: steps\.stable_state\.outputs\.done != 'true'/, name);
    }
    // The wait follows only the run for this ref, never a hand dispatch for another.
    assert.match(stepBlock(job, "Wait for the stable publish to finish"), /PUBLISH_RUN_TITLE: Publish refs\/tags\/v\$\{\{ steps\.target\.outputs\.version \}\}/);
  });

  it("refuses a dry resume and keeps the cut out of a resume", () => {
    const workflow = releaseYml();
    assert.match(workflow, /resume_version:\n\s+description: .+\n\s+required: false\n\s+default: ''\n\s+type: string/);
    assert.match(workflow, /refuse-dry-resume:[\s\S]{0,120}?if: inputs\.resume_version != '' && inputs\.dry_run != 'false'/);
    assert.match(workflow, /\n  cut:\n\s+name: [^\n]+\n\s+if: inputs\.resume_version == ''/);
    assert.match(stepBlock(workflow, "Wait for the preview publish to finish"), /PUBLISH_RUN_TITLE: Publish refs\/heads\/preview/);
  });

  it("rechecks the stable refs only when publish-stable is about to publish", () => {
    const workflow = readFileSync(join(repoRoot(), ".github/workflows/publish.yml"), "utf8");
    const stable = workflow.slice(workflow.indexOf("publish-stable:"), workflow.indexOf("create-github-release:"));
    const recheck = stepBlock(stable, "Recheck live release refs");
    assert.match(recheck, /if: steps\.registry\.outputs\.should_publish == 'true'/);
    assert.ok(stable.indexOf("Guard immutable registry version") < stable.indexOf("Recheck live release refs"));
    const preview = workflow.slice(workflow.indexOf("publish-preview:"), workflow.indexOf("publish-stable:"));
    assert.doesNotMatch(stepBlock(preview, "Recheck live release refs"), /should_publish/);
  });

  it("deploys Pages after the stable wait and writes the summary before it", () => {
    const workflow = readFileSync(join(repoRoot(), ".github/workflows/release.yml"), "utf8");
    const waitIndex = workflow.indexOf("Wait for the stable publish to finish");
    const summaryIndex = workflow.indexOf("Write the release summary");
    const pagesIndex = workflow.indexOf("Deploy the Pages site for this release");
    assert.ok(waitIndex > -1 && waitIndex < summaryIndex, "summary follows the stable publish wait");
    assert.ok(summaryIndex < pagesIndex, "summary precedes the Pages dispatch");
    const pagesBlock = workflow.slice(pagesIndex);
    assert.match(pagesBlock, /gh workflow run pages\.yml/);
    assert.match(pagesBlock, /--ref main/);
    assert.match(pagesBlock, /-f release_sha=/);
    assert.match(pagesBlock, /-f release_version=/);
    assert.match(pagesBlock, /continue-on-error: true/);
    assert.match(pagesBlock, /GH_TOKEN/);
    const summaryBlock = workflow.slice(summaryIndex, pagesIndex);
    assert.match(summaryBlock, /desktop-v/);
    assert.match(summaryBlock, /re-dispatch desktop:/);
    assert.match(summaryBlock, /re-dispatch pages:/);
  });
});
