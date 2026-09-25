import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePackOutput, sha512, verifyArtifactDigest } from "./release-artifact-contract.mjs";
import { verifyRegistrySignatures } from "./registry-signature-proof.mjs";

export { parsePackOutput, verifyArtifactDigest } from "./release-artifact-contract.mjs";

const PACKAGE_NAME = "ima2-gen";
const REPOSITORY = "https://github.com/lidge-ai/ima2-gen";
const WORKFLOW_PATH = ".github/workflows/publish.yml";
const IN_TOTO_TYPE = "https://in-toto.io/Statement/v1";
const PROVENANCE_TYPE = "https://slsa.dev/provenance/v1";
const SLSA_BUILD_TYPE = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
// release.yml dispatches publish.yml, and a dispatched run always executes on
// the default branch regardless of which ref it publishes.
const DISPATCH_HOST_REF = "refs/heads/main";
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeoutMs,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout || ""}${result.stderr || ""}${result.error?.message || ""}`,
    );
  }
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeOutput(values) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  appendFileSync(output, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

function assertReleaseToolchain() {
  const manifest = readJson(resolve("package.json"));
  const expectedNode = readFileSync(resolve(".node-version"), "utf8").trim().replace(/^v/, "");
  const expectedNpm = String(manifest.packageManager || "").match(/^npm@(.+)$/)?.[1];
  const actualNode = process.version.replace(/^v/, "");
  const actualNpm = run(commandName("npm"), ["--version"]).stdout.trim();
  if (!expectedNpm) throw new Error("packageManager must pin an exact npm version");
  if (actualNode !== expectedNode || actualNpm !== expectedNpm) {
    throw new Error(`release toolchain mismatch: node ${actualNode}/npm ${actualNpm}, expected node ${expectedNode}/npm ${expectedNpm}`);
  }
  console.log(`[release-contract] toolchain node ${actualNode}, npm ${actualNpm}`);
}

/**
 * The ref/sha/event actually being published.
 *
 * release.yml drives the cut and re-triggers publish.yml by dispatch, because a
 * GITHUB_TOKEN push emits no push event. A dispatch runs on the default branch, so the
 * event context describes the dispatch rather than the release — publish.yml passes the
 * real values through PUBLISH_REF/PUBLISH_SHA.
 *
 * This only decides WHICH ref is inspected. classifyPublish still accepts nothing but
 * refs/heads/preview or a v* tag matching package.json, and validateRemoteRefs still
 * requires the live remotes to agree, so an override cannot publish something new.
 */
function publishRef() {
  return process.env.PUBLISH_REF || process.env.GITHUB_REF;
}

function publishSha(run) {
  return process.env.PUBLISH_SHA || process.env.GITHUB_SHA || run("git", ["rev-parse", "HEAD"]).stdout.trim();
}

/** A dispatch from release.yml is a push in contract terms: the same refs, the same gates. */
function publishEventName() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event === "workflow_dispatch" && process.env.PUBLISH_REF) return "push";
  return event;
}

function assertOidcPublishContext() {
  const workflowRef = process.env.GITHUB_WORKFLOW_REF || "";
  const expectedWorkflow = `${process.env.GITHUB_REPOSITORY || ""}/${WORKFLOW_PATH}@`;
  // The workflow path check is the real boundary: only publish.yml may publish, whether
  // it was reached by a push or by release.yml's dispatch.
  const event = publishEventName();
  if (
    process.env.GITHUB_ACTIONS !== "true"
    || event !== "push"
    || !workflowRef.startsWith(expectedWorkflow)
    || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  ) {
    throw new Error("directory publish is restricted to the OIDC publish workflow; use the release scripts");
  }
  console.log("[release-contract] OIDC publish context verified");
}

export function parseStableVersion(value, label = "version") {
  const match = STABLE_VERSION.exec(String(value || ""));
  if (!match) throw new Error(`${label} must be stable X.Y.Z (got ${value || "empty"})`);
  return match.slice(1).map(Number);
}

export function compareStableVersions(left, right) {
  const a = parseStableVersion(left, "left version");
  const b = parseStableVersion(right, "right version");
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function nextPatch(version) {
  const [major, minor, patch] = parseStableVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function utcStamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error(`invalid preview date ${date}`);
  const two = (part) => String(part).padStart(2, "0");
  return `${String(value.getUTCFullYear()).slice(2)}${two(value.getUTCMonth() + 1)}${two(value.getUTCDate())}`;
}

export function buildPreviewVersion({ packageVersion, latestVersion, date, runId, runAttempt }) {
  parseStableVersion(packageVersion, "package version");
  parseStableVersion(latestVersion, "npm latest");
  if (!/^\d+$/.test(String(runId)) || !/^[1-9]\d*$/.test(String(runAttempt))) {
    throw new Error("runId and runAttempt must be positive numeric identifiers");
  }
  const base = compareStableVersions(packageVersion, latestVersion) > 0
    ? packageVersion
    : nextPatch(latestVersion);
  return `${base}-preview.${utcStamp(date)}.${runId}.${runAttempt}`;
}

export function classifyPublish(input) {
  const {
    eventName, ref, sha, packageVersion, latestVersion, latestGitHead,
    tagsAtHead = [], runId, runAttempt, date = new Date(),
  } = input;
  if (eventName !== "push") throw new Error(`unsupported publish event ${eventName}`);

  if (ref === "refs/heads/preview") {
    const stableTag = `v${packageVersion}`;
    if (tagsAtHead.includes(stableTag) && latestVersion === packageVersion && latestGitHead === sha) {
      return { shouldPublish: false, shouldVerify: false, channel: "preview", npmTag: "preview", version: packageVersion };
    }
    return {
      shouldPublish: true,
      shouldVerify: false,
      channel: "preview",
      npmTag: "preview",
      version: buildPreviewVersion({ packageVersion, latestVersion, date, runId, runAttempt }),
    };
  }

  if (ref.startsWith("refs/tags/")) {
    const tag = ref.slice("refs/tags/".length);
    if (tag !== `v${packageVersion}`) {
      throw new Error(`stable tag ${tag} does not match package version v${packageVersion}`);
    }
    parseStableVersion(packageVersion, "stable package version");
    parseStableVersion(latestVersion, "npm latest");
    if (latestVersion === packageVersion && latestGitHead === sha) {
      return { shouldPublish: false, shouldVerify: true, channel: "latest", npmTag: "latest", version: packageVersion };
    }
    if (compareStableVersions(packageVersion, latestVersion) <= 0) {
      throw new Error(`stable package version ${packageVersion} must be newer than npm latest ${latestVersion}`);
    }
    return { shouldPublish: true, shouldVerify: false, channel: "latest", npmTag: "latest", version: packageVersion };
  }

  throw new Error(`unsupported publish ref ${ref}`);
}

export function validateRemoteRefs({ ref, sha, refs }) {
  const required = ref === "refs/heads/preview"
    ? ["preview"]
    : ref.startsWith("refs/tags/")
      ? ["main", "dev", "preview", ref.slice("refs/tags/".length)]
      : [];
  if (!required.length) throw new Error(`unsupported publish ref ${ref}`);
  for (const name of required) {
    if (refs[name] !== sha) throw new Error(`remote ${name} is ${refs[name] || "missing"}, expected ${sha}`);
  }
}

function npmView(spec, fields) {
  const result = run(commandName("npm"), ["view", spec, ...fields, "--json"], { timeoutMs: 30_000 });
  return JSON.parse(result.stdout);
}

async function fetchProvenance(version) {
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${PACKAGE_NAME}@${version}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`attestation lookup failed: HTTP ${response.status}`);
  const body = await response.json();
  const attestation = body.attestations?.find((item) => item.predicateType === PROVENANCE_TYPE);
  if (!attestation) throw new Error(`SLSA provenance missing for ${PACKAGE_NAME}@${version}`);
  const bundle = attestation.bundle;
  if (bundle?.mediaType !== "application/vnd.dev.sigstore.bundle.v0.3+json") {
    throw new Error(`unsupported Sigstore bundle media type ${bundle?.mediaType || "missing"}`);
  }
  if (bundle.dsseEnvelope?.payloadType !== "application/vnd.in-toto+json" || !bundle.dsseEnvelope?.signatures?.length) {
    throw new Error("SLSA attestation has no signed in-toto DSSE envelope");
  }
  return JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
}

export function validateProvenance(statement, expected) {
  const definition = statement.predicate?.buildDefinition;
  const workflow = definition?.externalParameters?.workflow;
  const github = definition?.internalParameters?.github;
  const dependency = definition?.resolvedDependencies?.find((item) => item.digest?.gitCommit);
  const subject = statement.subject?.find((item) => item.digest?.sha512);
  const builder = statement.predicate?.runDetails?.builder?.id;
  const invocation = statement.predicate?.runDetails?.metadata?.invocationId;
  const checks = [
    [statement?._type, IN_TOTO_TYPE, "statement type"],
    [statement?.predicateType, PROVENANCE_TYPE, "predicate type"],
    [definition?.buildType, SLSA_BUILD_TYPE, "build type"],
    [workflow?.repository, REPOSITORY, "repository"],
    [workflow?.path, WORKFLOW_PATH, "workflow path"],
    [dependency?.digest?.gitCommit, expected.sha, "source commit"],
    [subject?.digest?.sha512, expected.sha512, "subject sha512"],
    [builder, GITHUB_HOSTED_BUILDER, "builder"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted) throw new Error(`provenance ${label} mismatch: ${actual} != ${wanted}`);
  }
  // npm records the ref the workflow RAN on, which is only the publish target
  // for a push. release.yml reaches publish.yml by workflow_dispatch (a
  // GITHUB_TOKEN push emits no event), and a dispatch always runs on the
  // default branch — so demanding refs/heads/preview here can never pass.
  // The publish target is already pinned by `source commit` above; the ref is
  // narrowed to the refs this repository may publish from rather than dropped.
  const eventName = github?.event_name;
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    throw new Error(`provenance event mismatch: ${eventName} != push|workflow_dispatch`);
  }
  const observedRef = workflow?.ref;
  const allowedRefs = eventName === "push"
    ? [expected.ref]
    : [expected.ref, DISPATCH_HOST_REF];
  if (!allowedRefs.includes(observedRef)) {
    throw new Error(`provenance source ref mismatch: ${observedRef} != ${allowedRefs.join("|")}`);
  }
  if (expected.version && subject?.name !== `pkg:npm/${PACKAGE_NAME}@${expected.version}`) {
    throw new Error(`provenance subject mismatch: ${subject?.name || "missing"}`);
  }
  const invocationPrefix = `${REPOSITORY}/actions/runs/`;
  const invocationMatch = String(invocation || "").startsWith(invocationPrefix)
    ? String(invocation).slice(invocationPrefix.length).match(/^(\d+)\/attempts\/([1-9]\d*)$/)
    : null;
  if (!invocationMatch) {
    throw new Error(`provenance invocation is not an exact repository Actions attempt: ${invocation || "missing"}`);
  }
  const identity = { runId: invocationMatch[1], runAttempt: invocationMatch[2], runUrl: `${REPOSITORY}/actions/runs/${invocationMatch[1]}` };
  if (expected.runId && expected.runAttempt && (
    identity.runId !== String(expected.runId) || identity.runAttempt !== String(expected.runAttempt)
  )) {
    throw new Error(`provenance invocation mismatch: ${invocation}`);
  }
  return identity;
}

async function verifyRegistry({ version, npmTag, ref, sha, manifest, runId, runAttempt }) {
  const metadata = npmView(`${PACKAGE_NAME}@${version}`, ["version", "gitHead", "dist.integrity"]);
  const tags = npmView(PACKAGE_NAME, ["dist-tags"]);
  const registryIntegrity = metadata["dist.integrity"];
  const expectedIntegrity = manifest?.integrity || registryIntegrity;
  if (!String(expectedIntegrity || "").startsWith("sha512-")) throw new Error("registry integrity is not SHA-512");
  const digest = Buffer.from(String(expectedIntegrity).slice("sha512-".length), "base64").toString("hex");
  if (metadata.version !== version) throw new Error(`registry version mismatch ${metadata.version} != ${version}`);
  if (metadata.gitHead !== sha) throw new Error(`registry gitHead mismatch ${metadata.gitHead} != ${sha}`);
  if (tags[npmTag] !== version) throw new Error(`dist-tag ${npmTag} points to ${tags[npmTag]} not ${version}`);
  if (manifest && registryIntegrity !== manifest.integrity) throw new Error("registry integrity mismatch");
  const provenance = await fetchProvenance(version);
  const identity = validateProvenance(provenance, {
    ref,
    sha,
    sha512: digest,
    version,
    runId,
    runAttempt,
  });
  verifyRegistrySignatures({ version, packageName: PACKAGE_NAME, provenanceType: PROVENANCE_TYPE });
  return { version, gitHead: metadata.gitHead, integrity: registryIntegrity, npmTag, signatureVerified: true, ...identity };
}

function registryVersionExists(version) {
  const result = run(commandName("npm"), ["view", `${PACKAGE_NAME}@${version}`, "version", "--json"], {
    allowFailure: true,
    timeoutMs: 30_000,
  });
  if (result.status === 0) return true;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (/\bE404\b|404 Not Found/i.test(output)) return false;
  throw new Error(`npm registry lookup failed for ${PACKAGE_NAME}@${version}\n${output}${result.error?.message || ""}`);
}

async function guardPublishCommand(manifestPath, npmTag, ref, sha) {
  const manifest = readJson(resolve(manifestPath));
  if (!registryVersionExists(manifest.version)) {
    writeOutput({ should_publish: "true" });
    return console.log(`[release-contract] ${PACKAGE_NAME}@${manifest.version} is unpublished`);
  }
  const proof = await verifyRegistryEventually({ version: manifest.version, npmTag, ref, sha, manifest });
  writeOutput({ should_publish: "false" });
  console.log(JSON.stringify({ shouldPublish: false, reason: "verified-existing", ...proof }));
}

// npm processes provenance-bearing publishes asynchronously; 3.16.1 and 3.17.0 took 5-6 minutes
// to appear, which the old 120s window turned into red publish jobs for successful publishes.
export const REGISTRY_PROOF_TIMEOUT_MS = 15 * 60_000;
export const REGISTRY_PROOF_MAX_TIMEOUT_MS = 20 * 60_000;
export const REGISTRY_PROOF_POLL_MS = 10_000;
// Worst case for one attempt, since the deadline is only checked between attempts: two npm views
// and the provenance fetch (30s each) plus npm install and audit signatures (120s each).
export const REGISTRY_PROOF_ATTEMPT_BUDGET_MS = 330_000;

/** Local/manual override only; publish.yml does not pass it. An invalid value fails closed. */
export function registryProofTimeoutMs(env = process.env) {
  const raw = env.IMA2_REGISTRY_PROOF_TIMEOUT_MS;
  if (raw === undefined || raw === "") return REGISTRY_PROOF_TIMEOUT_MS;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > REGISTRY_PROOF_MAX_TIMEOUT_MS) {
    throw new Error(`IMA2_REGISTRY_PROOF_TIMEOUT_MS must be 1..${REGISTRY_PROOF_MAX_TIMEOUT_MS} ms, got ${raw}`);
  }
  return value;
}

export async function verifyRegistryEventually(input, {
  timeoutMs = registryProofTimeoutMs(),
  pollMs = REGISTRY_PROOF_POLL_MS,
  verify = verifyRegistry,
  sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
  now = Date.now,
  log = (message) => console.error(message),
} = {}) {
  const started = now();
  const deadline = started + timeoutMs;
  // Every wait is followed by another attempt, and the last wait ends exactly at the deadline,
  // so the final attempt sees the registry as late as the window allows.
  for (;;) {
    try {
      return await verify(input);
    } catch (error) {
      if (now() >= deadline) throw error;
      const elapsed = Math.round((now() - started) / 1000);
      log(`[release-contract] registry proof pending (${elapsed}s): ${error.message}`);
      await sleep(Math.min(pollMs, deadline - now()));
    }
  }
}

function runList() {
  const fields = "databaseId,event,headBranch,headSha,status,conclusion,url,createdAt";
  return JSON.parse(run(commandName("gh"), ["run", "list", "--workflow=publish.yml", "--limit=30", "--json", fields]).stdout);
}

function runIdentity(runId) {
  return JSON.parse(run(commandName("gh"), ["run", "view", String(runId), "--json", "attempt,url"]).stdout);
}

async function waitForRun({ sha, headBranch, npmTag, ref, version }) {
  const deadline = Date.now() + 180_000;
  let matched = null;
  while (Date.now() < deadline) {
    matched = runList().find((item) => item.event === "push" && item.headSha === sha && item.headBranch === headBranch);
    if (matched) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000));
  }
  if (!matched) throw new Error(`publish workflow did not start for ${headBranch}@${sha}`);
  run(commandName("gh"), ["run", "watch", String(matched.databaseId), "--exit-status"], { inherit: true });
  const identity = runIdentity(matched.databaseId);
  const resolvedVersion = version || npmView(PACKAGE_NAME, ["dist-tags"])[npmTag];
  return {
    runId: matched.databaseId,
    runUrl: matched.url,
    ...await verifyRegistryEventually({
      version: resolvedVersion,
      npmTag,
      ref,
      sha,
      runId: String(matched.databaseId),
      runAttempt: String(identity.attempt),
    }),
  };
}

async function verifyPreviewProof(packageVersion, sha) {
  const preview = npmView(`${PACKAGE_NAME}@preview`, ["version", "gitHead"]);
  if (preview.gitHead !== sha) throw new Error(`npm preview gitHead ${preview.gitHead} does not prove ${sha}`);
  if (!String(preview.version).startsWith(`${packageVersion}-preview.`)) {
    throw new Error(`npm preview version ${preview.version} is not a ${packageVersion} candidate`);
  }
  return verifyRegistryEventually({
    version: preview.version,
    npmTag: "preview",
    ref: "refs/heads/preview",
    sha,
  });
}

function remoteRefMap(ref) {
  const refs = {
    main: run("git", ["rev-parse", "origin/main"]).stdout.trim(),
    dev: run("git", ["rev-parse", "origin/dev"]).stdout.trim(),
    preview: run("git", ["rev-parse", "origin/preview"]).stdout.trim(),
  };
  if (ref.startsWith("refs/tags/")) {
    const tag = ref.slice("refs/tags/".length);
    refs[tag] = run("git", ["rev-list", "-n1", ref]).stdout.trim();
  }
  return refs;
}

function assertRemoteRefCommand(ref, sha) {
  run("git", ["fetch", "origin", "main", "dev", "preview", "--tags"]);
  validateRemoteRefs({ ref, sha, refs: remoteRefMap(ref) });
  console.log(`[release-contract] live refs verified for ${ref}@${sha}`);
}

async function prepareCommand() {
  const manifest = readJson(resolve("package.json"));
  const latest = npmView(`${PACKAGE_NAME}@latest`, ["version", "gitHead"]);
  const ref = publishRef();
  const sha = publishSha(run);
  const tagsAtHead = run("git", ["tag", "--points-at", sha]).stdout.trim().split(/\s+/).filter(Boolean);
  const plan = classifyPublish({
    eventName: publishEventName(),
    ref,
    sha,
    packageVersion: manifest.version,
    latestVersion: latest.version,
    latestGitHead: latest.gitHead,
    tagsAtHead,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  if (plan.channel === "latest") {
    validateRemoteRefs({ ref, sha, refs: remoteRefMap(ref) });
    await verifyPreviewProof(manifest.version, sha);
  } else {
    run("git", ["merge-base", "--is-ancestor", "origin/main", sha]);
  }
  writeOutput({
    should_publish: String(plan.shouldPublish),
    should_verify: String(plan.shouldVerify),
    channel: plan.channel,
    npm_tag: plan.npmTag,
    version: plan.version,
    source_ref: ref,
  });
  console.log(JSON.stringify(plan));
}

function packCommand(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const packagePath = resolve("package.json");
  const originalPackage = readFileSync(packagePath, "utf8");
  const manifest = JSON.parse(originalPackage);
  // This gitHead is the provenance the stable tag later verifies, so it must be the SHA
  // being released, not the dispatch's checkout.
  const gitHead = publishSha(run);
  let entry;
  try {
    writeFileSync(packagePath, `${JSON.stringify({ ...manifest, gitHead }, null, 2)}\n`);
    entry = parsePackOutput(run(commandName("npm"), ["pack", "--json", "--pack-destination", outputDir]).stdout);
  } finally {
    writeFileSync(packagePath, originalPackage);
  }
  for (const name of manifest.bundleDependencies || []) {
    if (!entry.bundled?.includes(name)) throw new Error(`packed artifact missing bundled dependency ${name}`);
  }
  const tarballPath = resolve(outputDir, entry.filename);
  const digest = sha512(tarballPath);
  const releaseManifest = {
    schemaVersion: 1,
    name: manifest.name,
    version: manifest.version,
    filename: entry.filename,
    sha512: digest.toString("hex"),
    integrity: `sha512-${digest.toString("base64")}`,
    gitHead,
    bundled: [...(manifest.bundleDependencies || [])].sort(),
  };
  const manifestPath = resolve(outputDir, "release-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
  const sbom = run(commandName("npm"), ["sbom", "--sbom-format=cyclonedx", "--omit=dev"]).stdout;
  const sbomPath = resolve(outputDir, "sbom.cdx.json");
  writeFileSync(sbomPath, sbom);
  writeOutput({ tarball: tarballPath, manifest: manifestPath, sbom: sbomPath, version: manifest.version });
  console.log(JSON.stringify(releaseManifest));
}

function previousStableTag(version) {
  const current = `v${version}`;
  return run("git", ["tag", "--sort=-v:refname"]).stdout
    .trim()
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag) && tag !== current)[0] || "";
}

export function buildStableReleaseNotes(version, previousTag = previousStableTag(version)) {
  const tag = `v${version}`;
  const range = previousTag ? `${previousTag}..${tag}` : tag;
  const generated = run("node", [resolve("scripts/generate-release-notes.mjs"), range], { allowFailure: true });
  const notes = String(generated.stdout || "").trim();
  if (generated.status === 0 && notes) return notes;
  const fallback = [
    "## What's Changed",
    "",
    `Published to npm as \`${PACKAGE_NAME}@${version}\`.`,
    "",
    `**Full Changelog**: ${REPOSITORY}/compare/${previousTag || tag}...${tag}`,
  ];
  return fallback.join("\n");
}

function releaseExists(tag) {
  const result = run(commandName("gh"), ["release", "view", tag], { allowFailure: true });
  return result.status === 0;
}

function downloadReleaseEvidence(runId, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  run(commandName("gh"), ["run", "download", String(runId), "--name", "npm-release-artifact", "--dir", outputDir]);
  const manifestPath = resolve(outputDir, "release-manifest.json");
  const sbomPath = resolve(outputDir, "sbom.cdx.json");
  if (!readFileSync(manifestPath, "utf8") || !readFileSync(sbomPath, "utf8")) {
    throw new Error(`release evidence missing for run ${runId}`);
  }
  return { manifestPath, sbomPath };
}

function attachReleaseEvidence(tag, artifactDir) {
  const manifestPath = resolve(artifactDir, "release-manifest.json");
  const sbomPath = resolve(artifactDir, "sbom.cdx.json");
  readJson(manifestPath);
  readFileSync(sbomPath, "utf8");
  run(commandName("gh"), ["release", "upload", tag, manifestPath, sbomPath, "--clobber"]);
}

export async function ensureGithubRelease({ version, sha, artifactDir, makeLatest = true }) {
  parseStableVersion(version, "stable package version");
  if (!/^[0-9a-f]{40}$/i.test(String(sha || ""))) throw new Error("ensure-github-release requires a full 40-char commit SHA");
  const tag = `v${version}`;
  const tagSha = run("git", ["rev-list", "-n1", tag]).stdout.trim();
  if (tagSha !== sha) throw new Error(`${tag} points to ${tagSha}, expected ${sha}`);
  const proof = await verifyRegistryEventually({
    version,
    npmTag: "latest",
    ref: `refs/tags/${tag}`,
    sha,
  });
  const notes = buildStableReleaseNotes(version);
  if (!releaseExists(tag)) {
    const args = ["release", "create", tag, "--verify-tag", "--title", tag, "--notes", notes];
    if (makeLatest) args.push("--latest");
    run(commandName("gh"), args);
  } else if (makeLatest) {
    run(commandName("gh"), ["release", "edit", tag, "--latest"]);
  }
  let evidenceDir = artifactDir ? resolve(artifactDir) : "";
  let temporaryEvidence = false;
  if (!evidenceDir) {
    evidenceDir = resolve(process.env.RUNNER_TEMP || process.env.TMPDIR || "/tmp", `ima2-release-evidence-${proof.runId || "local"}`);
    temporaryEvidence = true;
    downloadReleaseEvidence(proof.runId, evidenceDir);
  }
  try {
    attachReleaseEvidence(tag, evidenceDir);
  } finally {
    if (temporaryEvidence) {
      run("rm", ["-rf", evidenceDir], { allowFailure: true });
    }
  }
  return {
    version,
    sha,
    tag,
    runId: proof.runId,
    runUrl: proof.runUrl,
    integrity: proof.integrity,
    createdOrUpdated: true,
  };
}

async function ensureGithubReleaseCommand(version, sha, artifactDir) {
  const result = await ensureGithubRelease({ version, sha, artifactDir });
  console.log(JSON.stringify(result));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "assert-toolchain") return assertReleaseToolchain();
  if (command === "assert-publish-context") return assertOidcPublishContext();
  if (command === "assert-remote-ref") return assertRemoteRefCommand(args[0], args[1]);
  if (command === "prepare") return prepareCommand();
  if (command === "pack") return packCommand(resolve(args[0] || "release-artifact"));
  if (command === "verify-artifact") {
    const manifestPath = resolve(args[0]);
    const manifest = readJson(manifestPath);
    return console.log(JSON.stringify(verifyArtifactDigest(manifest, join(dirname(manifestPath), manifest.filename))));
  }
  if (command === "guard-publish") return guardPublishCommand(args[0], args[1], args[2], args[3]);
  if (command === "verify-registry") {
    const manifest = readJson(resolve(args[0]));
    return console.log(JSON.stringify(await verifyRegistryEventually({
      manifest,
      npmTag: args[1],
      ref: args[2],
      sha: args[3],
      version: manifest.version,
      runId: process.env.IMA2_EXPECT_CURRENT_PROVENANCE === "true" ? process.env.GITHUB_RUN_ID : undefined,
      runAttempt: process.env.IMA2_EXPECT_CURRENT_PROVENANCE === "true" ? process.env.GITHUB_RUN_ATTEMPT : undefined,
    })));
  }
  if (command === "wait") {
    const [sha, headBranch, npmTag, ref, version] = args;
    return console.log(JSON.stringify(await waitForRun({ sha, headBranch, npmTag, ref, version })));
  }
  if (command === "finalize-check") {
    const [version, sha] = args;
    const tagSha = run("git", ["rev-list", "-n1", `v${version}`]).stdout.trim();
    if (tagSha !== sha) throw new Error(`v${version} points to ${tagSha}, expected ${sha}`);
    return console.log(JSON.stringify(await verifyRegistryEventually({
      version,
      npmTag: "latest",
      ref: `refs/tags/v${version}`,
      sha,
    })));
  }
  if (command === "ensure-github-release") {
    const [version, sha, artifactDir] = args;
    if (!version || !sha) throw new Error("usage: release-contract.mjs ensure-github-release X.Y.Z <sha> [artifactDir]");
    return ensureGithubReleaseCommand(version, sha, artifactDir);
  }
  if (command === "verify-channel") {
    const [version, npmTag, ref, sha] = args;
    return console.log(JSON.stringify(await verifyRegistryEventually({
      version,
      npmTag,
      ref,
      sha,
    })));
  }
  throw new Error("usage: release-contract.mjs assert-toolchain|assert-publish-context|assert-remote-ref|prepare|pack|verify-artifact|guard-publish|verify-registry|wait|finalize-check|ensure-github-release|verify-channel");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(`[release-contract] ${error.message}`); process.exit(1); });
