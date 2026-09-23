import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// The draft and publish jobs are pure shell. Contract tests read their text, which
// cannot catch a quoting slip, an inverted test, or a guard that never runs. These
// tests execute the real `run:` blocks against a stubbed `gh`, so the refusal paths
// are proven before a tag spends an Apple notarization cycle on a public release.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow: any = parse(readFileSync(join(root, ".github/workflows/desktop.yml"), "utf8"));

const VERSION = "3.16.1";
const TAG = `desktop-v${VERSION}`;
const SHA = "a".repeat(40);
const CHECKSUMMED = [
  `ima2-${VERSION}-mac-arm64.dmg`,
  `ima2-${VERSION}-mac-arm64.zip`,
  `ima2-${VERSION}-mac-arm64.dmg.blockmap`,
  `ima2-${VERSION}-mac-arm64.zip.blockmap`,
  "latest-mac.yml",
];
const PUBLIC_ASSETS = [...CHECKSUMMED, "SHA256SUMS.txt"];

/** A `gh release` stand-in backed by a state directory, not the network. */
const GH_STUB = [
  "#!/bin/bash",
  "set -eo pipefail",
  'S="$GH_STUB_STATE"',
  'echo "$*" >> "$S/calls.log"',
  // gh reads the repository from the checkout's git remote and fails without
  // one, which is how a job with no checkout and no GH_REPO silently loses
  // every query. Refusing the same way is what makes that reachable here.
  'if [ -z "$GH_REPO" ] && ! git rev-parse --git-dir >/dev/null 2>&1; then',
  '  echo "failed to run git: fatal: not a git repository (or any of the parent directories): .git" >&2',
  "  exit 1",
  "fi",
  "shift",
  'sub="$1"; shift',
  'tag="$1"; shift',
  'case "$sub" in',
  "  view)",
  '    field=""',
  '    while [ "$#" -gt 0 ]; do',
  '      if [ "$1" = "--json" ]; then field="$2"; shift 2; continue; fi',
  '      if [ "$1" = "--jq" ]; then shift 2; continue; fi',
  "      shift",
  "    done",
  '    if [ "$(cat "$S/exists")" != "1" ]; then echo "release not found" >&2; exit 1; fi',
  '    case "$field" in',
  '      isDraft) cat "$S/isDraft" ;;',
  '      url) echo "https://github.com/lidge-jun/ima2-gen/releases/tag/$tag" ;;',
  '      body) cat "$S/body.md" ;;',
  '      assets) ls "$S/assets" ;;',
  "    esac",
  "    ;;",
  "  create)",
  '    if [ "$(cat "$S/exists")" = "1" ]; then echo "already exists" >&2; exit 1; fi',
  '    echo 1 > "$S/exists"',
  '    echo true > "$S/isDraft"',
  '    while [ "$#" -gt 0 ]; do',
  '      if [ "$1" = "--notes-file" ]; then cp "$2" "$S/body.md"; shift 2; continue; fi',
  "      shift",
  "    done",
  "    ;;",
  "  edit)",
  '    if [ "$(cat "$S/exists")" != "1" ]; then echo "release not found" >&2; exit 1; fi',
  '    while [ "$#" -gt 0 ]; do',
  '      if [ "$1" = "--notes-file" ]; then cp "$2" "$S/body.md"; shift 2; continue; fi',
  '      if [ "$1" = "--draft=false" ]; then echo false > "$S/isDraft"; shift; continue; fi',
  "      shift",
  "    done",
  "    ;;",
  "  upload)",
  '    while [ "$#" -gt 0 ]; do',
  '      if [ "$1" = "--clobber" ]; then shift; continue; fi',
  '      cp "$1" "$S/assets/$(basename "$1")"',
  "      shift",
  "    done",
  "    ;;",
  "  download)",
  '    dir="."',
  '    while [ "$#" -gt 0 ]; do',
  '      if [ "$1" = "--dir" ]; then dir="$2"; shift 2; continue; fi',
  "      shift",
  "    done",
  '    cp "$S"/assets/* "$dir"/',
  "    ;;",
  "esac",
  "",
].join("\n");

// macOS ships shasum, Linux runners ship sha256sum. The workflow targets ubuntu, so
// the shim exists only so this test can run on a developer Mac too.
const SHA256SUM_SHIM = [
  "#!/bin/bash",
  "args=()",
  'for a in "$@"; do',
  '  case "$a" in',
  '    --check|-c) args+=("-c") ;;',
  '    *) args+=("$a") ;;',
  "  esac",
  "done",
  'exec shasum -a 256 "${args[@]}"',
  "",
].join("\n");

function stepScript(job: string, name: string): string {
  const step = workflow.jobs[job].steps.find((candidate: any) => candidate.name === name);
  assert.ok(step?.run, `missing shell step ${job}/${name}`);
  return step.run;
}

/**
 * Resolve a step's declared env the way Actions would. Reading it from the
 * workflow instead of hardcoding it here is the point: whatever a step never
 * declares is simply absent when the script runs, exactly as on the runner.
 */
const EXPRESSIONS: Record<string, string> = {
  "${{ github.token }}": "fixture-token",
  "${{ github.repository }}": "lidge-jun/ima2-gen",
  "${{ github.ref_name }}": TAG,
};

function stepEnv(job: string, name: string, supplied: Record<string, string> = {}): Record<string, string> {
  const step = workflow.jobs[job].steps.find((candidate: any) => candidate.name === name);
  assert.ok(step, `missing workflow step ${job}/${name}`);
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.env ?? {})) {
    resolved[key] = supplied[key] ?? EXPRESSIONS[value as string] ?? String(value);
  }
  return resolved;
}

/** Only a job that checks out the repository gives gh its git context. */
function jobHasCheckout(job: string): boolean {
  return workflow.jobs[job].steps.some((step: any) => step.uses?.startsWith("actions/checkout@"));
}

const DRAFT_SCRIPT = stepScript("draft_release", "Create or update draft release");
const GATE_SCRIPT = stepScript("publish_release", "Require configured production approval gate");
const PUBLISH_SCRIPT = stepScript("publish_release", "Publish approved desktop release");

const hasSha256sum = spawnSync("sha256sum", ["--version"], { encoding: "utf8" }).status === 0;

// Both release jobs declare runs-on: ubuntu-latest, so a POSIX shell is the only
// environment this simulation describes. Windows runners have no /bin/bash, and
// re-running these scripts under a different shell would assert nothing about the
// job that actually ships the release.
const POSIX_SHELL = "/bin/bash";
const posixShell = process.platform !== "win32" && existsSync(POSIX_SHELL);

class Harness {
  readonly dir = mkdtempSync(join(tmpdir(), "ima2-release-shell-"));
  readonly bin = join(this.dir, "bin");
  readonly state = join(this.dir, "state");
  readonly workspace = join(this.dir, "workspace");
  readonly githubOutput = join(this.dir, "github-output");

  constructor() {
    mkdirSync(this.bin);
    mkdirSync(join(this.state, "assets"), { recursive: true });
    mkdirSync(join(this.workspace, "desktop/dist"), { recursive: true });
    writeFileSync(join(this.bin, "gh"), GH_STUB, { mode: 0o755 });
    if (!hasSha256sum) writeFileSync(join(this.bin, "sha256sum"), SHA256SUM_SHIM, { mode: 0o755 });
    writeFileSync(join(this.state, "exists"), "0\n");
    writeFileSync(join(this.state, "isDraft"), "true\n");
    writeFileSync(join(this.state, "body.md"), "");
    writeFileSync(join(this.state, "calls.log"), "");
    writeFileSync(this.githubOutput, "");
  }

  /** Everything the macOS build job hands to the draft job. */
  seedBuildOutput(): void {
    const dist = join(this.workspace, "desktop/dist");
    const lines: string[] = [];
    for (const name of CHECKSUMMED) {
      const body = `payload for ${name}\n`;
      writeFileSync(join(dist, name), body);
      const digest = this.sha256(join(dist, name));
      lines.push(`${digest}  ${name}`);
    }
    writeFileSync(join(dist, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
    writeFileSync(join(dist, "RELEASE_NOTES.md"), `Apple Silicon macOS build for ima2 ${VERSION}.\n`);
  }

  sha256(path: string): string {
    const tool = hasSha256sum ? ["sha256sum", [path]] : ["shasum", ["-a", "256", path]];
    const result = spawnSync(tool[0] as string, tool[1] as string[], { encoding: "utf8" });
    return result.stdout.trim().split(/\s+/)[0];
  }

  run(script: string, env: Record<string, string>, cwd = this.workspace) {
    const file = join(this.dir, "step.sh");
    writeFileSync(file, script);
    return spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", file], {
      cwd,
      encoding: "utf8",
      env: {
        PATH: `${this.bin}:${process.env["PATH"] ?? ""}`,
        HOME: this.dir,
        // Keep the git lookup inside the harness so an unlucky TMPDIR cannot
        // hand a job git context the real runner would never give it.
        GIT_CEILING_DIRECTORIES: this.dir,
        GH_STUB_STATE: this.state,
        GITHUB_SHA: SHA,
        GITHUB_OUTPUT: this.githubOutput,
        ...env,
      },
    });
  }

  /** Mirror the job: a checkout step is what leaves a git repository behind. */
  private applyCheckout(cwd: string, job: string): void {
    if (!jobHasCheckout(job)) return;
    spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  }

  runDraft() {
    this.applyCheckout(this.workspace, "draft_release");
    // DESKTOP_TAG and DESKTOP_VERSION reach the real step through GITHUB_ENV.
    return this.run(DRAFT_SCRIPT, {
      ...stepEnv("draft_release", "Create or update draft release"),
      DESKTOP_TAG: TAG,
      DESKTOP_VERSION: VERSION,
    });
  }

  runPublish(overrides: Record<string, string> = {}) {
    const outputs = this.outputs();
    const publishCwd = join(this.dir, `publish-${Math.random().toString(36).slice(2)}`);
    mkdirSync(publishCwd);
    this.applyCheckout(publishCwd, "publish_release");
    return this.run(
      PUBLISH_SCRIPT,
      {
        ...stepEnv("publish_release", "Publish approved desktop release", {
          EXPECTED_CHECKSUMS_SHA256: outputs["checksums_sha256"] ?? "",
          EXPECTED_NOTES_SHA256: outputs["notes_sha256"] ?? "",
        }),
        ...overrides,
      },
      publishCwd,
    );
  }

  outputs(): Record<string, string> {
    const entries = readFileSync(this.githubOutput, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("="));
    return Object.fromEntries(entries.map(([key, ...rest]) => [key, rest.join("=")]));
  }

  publishedAssets(): string[] {
    return readdirSync(join(this.state, "assets")).sort();
  }

  isDraft(): string {
    return readFileSync(join(this.state, "isDraft"), "utf8").trim();
  }

  calls(): string {
    return readFileSync(join(this.state, "calls.log"), "utf8");
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

function withHarness(body: (harness: Harness) => void): void {
  const harness = new Harness();
  try {
    body(harness);
  } finally {
    harness.cleanup();
  }
}

describe("desktop release workflow shell", {
  skip: posixShell ? false : "the release jobs run on ubuntu-latest; no POSIX shell here",
}, () => {
  it("drafts a tag-bound release carrying exactly the six public assets", () => {
    withHarness((harness) => {
      harness.seedBuildOutput();
      const draft = harness.runDraft();
      assert.equal(draft.status, 0, draft.stderr);

      assert.deepEqual(harness.publishedAssets(), [...PUBLIC_ASSETS].sort());
      assert.equal(harness.isDraft(), "true");

      const calls = harness.calls();
      assert.match(calls, /release create desktop-v3\.16\.1 --verify-tag --target a{40}/);
      assert.match(calls, /--draft/);
      assert.doesNotMatch(calls, /release-verification\.json/);

      const outputs = harness.outputs();
      assert.match(outputs["release_url"] ?? "", /releases\/tag\/desktop-v3\.16\.1$/);
      assert.match(outputs["checksums_sha256"] ?? "", /^[0-9a-f]{64}$/);
      assert.match(outputs["notes_sha256"] ?? "", /^[0-9a-f]{64}$/);
    });
  });

  it("refuses to replace the assets of an already public release", () => {
    withHarness((harness) => {
      harness.seedBuildOutput();
      assert.equal(harness.runDraft().status, 0);
      writeFileSync(join(harness.state, "isDraft"), "false\n");

      const rerun = harness.runDraft();
      assert.equal(rerun.status, 1);
      assert.match(rerun.stderr, /already public/);
    });
  });

  it("publishes only when the approval gate variable is configured", () => {
    withHarness((harness) => {
      assert.equal(harness.run(GATE_SCRIPT, { DESKTOP_RELEASE_GATE: "required-reviewer-v1" }).status, 0);
      for (const value of ["", "true", "required-reviewer-v2"]) {
        const blocked = harness.run(GATE_SCRIPT, { DESKTOP_RELEASE_GATE: value });
        assert.equal(blocked.status, 1, `gate accepted ${JSON.stringify(value)}`);
        assert.match(blocked.stderr, /not configured with the required approval gate/);
      }
    });
  });

  it("publishes the approved draft and never re-uploads or marks it latest", () => {
    withHarness((harness) => {
      harness.seedBuildOutput();
      assert.equal(harness.runDraft().status, 0);

      const publish = harness.runPublish();
      assert.equal(publish.status, 0, publish.stderr);
      assert.equal(harness.isDraft(), "false");
      assert.deepEqual(harness.publishedAssets(), [...PUBLIC_ASSETS].sort());
      assert.match(harness.calls(), /release edit desktop-v3\.16\.1 --draft=false --latest=false/);
      assert.equal(harness.calls().match(/release upload/g)?.length, 1);
    });
  });

  it("refuses blindly when a job without a checkout loses its repository context", () => {
    // This is how desktop-v3.17.0 actually failed: gh could not resolve the
    // repository, the isDraft probe returned nothing, and a valid draft was
    // refused. The release then went out by hand, skipping this job's checks.
    withHarness((harness) => {
      harness.seedBuildOutput();
      assert.equal(harness.runDraft().status, 0);

      const blind = harness.runPublish({ GH_REPO: "" });
      assert.notEqual(blind.status, 0);
      assert.match(blind.stderr, /not a git repository/);
      assert.equal(harness.isDraft(), "true", "the draft must survive a blind run");
      assert.doesNotMatch(harness.calls(), /--draft=false/);
    });
  });

  it("refuses publication when the draft no longer matches its verified state", () => {
    const mutations: Array<[string, (harness: Harness) => void, RegExp]> = [
      [
        "an extra asset appears",
        (harness) => writeFileSync(join(harness.state, "assets/extra-installer.exe"), "x"),
        /does not match the Apple Silicon allowlist/,
      ],
      [
        "a listed artifact is swapped",
        (harness) => writeFileSync(join(harness.state, `assets/ima2-${VERSION}-mac-arm64.dmg`), "tampered"),
        /SHA256SUMS\.txt|FAILED/,
      ],
      [
        "the checksum list is rewritten",
        (harness) => writeFileSync(join(harness.state, "assets/SHA256SUMS.txt"), "0  latest-mac.yml\n"),
        /SHA256SUMS\.txt changed/,
      ],
      [
        "the release notes are edited",
        (harness) => writeFileSync(join(harness.state, "body.md"), "Trust me, this build is fine.\n"),
        /Release notes changed/,
      ],
      [
        "the release was published behind the workflow",
        (harness) => writeFileSync(join(harness.state, "isDraft"), "false\n"),
        /is not a draft; refusing publication/,
      ],
    ];

    for (const [label, mutate, expected] of mutations) {
      withHarness((harness) => {
        harness.seedBuildOutput();
        assert.equal(harness.runDraft().status, 0);
        mutate(harness);

        const publish = harness.runPublish();
        assert.notEqual(publish.status, 0, `publication survived: ${label}`);
        assert.match(`${publish.stderr}${publish.stdout}`, expected, label);
        assert.doesNotMatch(harness.calls(), /--draft=false/, `${label} reached publication`);
      });
    }
  });
});
