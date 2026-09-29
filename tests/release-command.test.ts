import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bumpVersion,
  desktopTagAction,
  dryRunInput,
  isRuleRejection,
  isOwnRun,
  parseArgs,
  parseRemoteTags,
  runRelease,
  selectPendingApprovals,
} from "../scripts/release.mjs";

const MAIN_SHA = "b".repeat(40);

describe("release.mjs arg parsing", () => {
  it("accepts a bump plus any non-conflicting switches", () => {
    const { bump, flags } = parseArgs(["minor", "--promote", "--approve", "--yes"]);
    assert.equal(bump, "minor");
    assert.deepEqual([...flags].sort(), ["--approve", "--promote", "--yes"]);
  });

  it("rejects a missing or unknown bump", () => {
    assert.throws(() => parseArgs([]), /first argument must be one of/);
    assert.throws(() => parseArgs(["beta"]), /first argument must be one of/);
  });

  it("rejects unknown flags", () => {
    assert.throws(() => parseArgs(["patch", "--force"]), /unknown flag: --force/);
  });

  it("rejects conflicting --dry-run and --canary", () => {
    assert.throws(() => parseArgs(["patch", "--dry-run", "--canary"]), /mutually exclusive/);
  });
});

describe("release.mjs dry_run input", () => {
  it("defaults to false and maps each switch", () => {
    assert.equal(dryRunInput(new Set()), "false");
    assert.equal(dryRunInput(new Set(["--dry-run"])), "true");
    assert.equal(dryRunInput(new Set(["--canary"])), "canary");
  });
});

describe("release.mjs version bump", () => {
  it("bumps exactly one component and keeps suffixes", () => {
    assert.equal(bumpVersion("3.23.1", "patch"), "3.23.2");
    assert.equal(bumpVersion("3.23.1", "minor"), "3.24.0");
    assert.equal(bumpVersion("3.23.1", "major"), "4.0.0");
    assert.equal(bumpVersion("1.2.3-preview.1", "patch"), "1.2.4-preview.1");
  });
});

describe("release.mjs pending-deployment selection", () => {
  const pending = [
    { environment: { id: 11, name: "npm-stable" } },
    { environment: { id: 22, name: "desktop-production" } },
    { environment: { id: 33, name: "someone-elses-env" } },
    { environment: { id: 44, name: "npm-preview" } },
  ];

  it("selects only npm-stable and desktop-production", () => {
    assert.deepEqual(selectPendingApprovals(pending), [
      { environmentId: 11, environmentName: "npm-stable" },
      { environmentId: 22, environmentName: "desktop-production" },
    ]);
  });

  it("tolerates an empty or missing pending list", () => {
    assert.deepEqual(selectPendingApprovals([]), []);
    assert.deepEqual(selectPendingApprovals(undefined), []);
  });
});

describe("release.mjs own-run filter", () => {
  const base = { afterId: 100, version: "3.24.0" };

  it("accepts only newer runs on this release's tags", () => {
    const publish = { ...base, workflow: "publish.yml" };
    const desktop = { ...base, workflow: "desktop.yml" };
    // release.yml dispatches publish.yml on the default branch; run-name names the ref.
    const stable = { headBranch: "main", event: "workflow_dispatch", displayTitle: "Publish refs/tags/v3.24.0" };
    assert.equal(isOwnRun({ databaseId: 101, ...stable }, publish), true);
    assert.equal(isOwnRun({ databaseId: 100, ...stable }, publish), false);
    assert.equal(isOwnRun({ databaseId: 101, ...stable, displayTitle: "Publish refs/heads/preview" }, publish), false);
    assert.equal(isOwnRun({ databaseId: 101, ...stable, displayTitle: "Publish refs/tags/v3.23.9" }, publish), false);
    assert.equal(isOwnRun({ databaseId: 101, ...stable, event: "push" }, publish), false);
    assert.equal(isOwnRun({ databaseId: 102, headBranch: "desktop-v3.24.0", event: "workflow_dispatch" }, desktop), true);
    assert.equal(isOwnRun({ databaseId: 100, headBranch: "desktop-v3.24.0", event: "workflow_dispatch" }, desktop), false);
    assert.equal(isOwnRun({ databaseId: 101, headBranch: "dev", event: "push" }, desktop), false);
    assert.equal(isOwnRun({ databaseId: 101, headBranch: "desktop-v3.23.9", event: "workflow_dispatch" }, desktop), false);
  });
});

// A scripted command runner: tests never invoke git or gh. Responses are
// matched by every needle appearing in the joined argv, in order.
function scriptedRunner(responses: Array<{ needles: string[]; out: string }>) {
  const calls: Array<[string, string[]]> = [];
  const run = (bin: string, args: string[]) => {
    const joined = [bin, ...args].join(" ");
    for (const response of responses) {
      if (response.needles.every((needle) => joined.includes(needle))) {
        calls.push([bin, args]);
        return response.out;
      }
    }
    throw new Error("unexpected command: " + joined);
  };
  return { run, calls };
}

const BASE_RESPONSES = [
  { needles: ["gh", "auth", "status"], out: "Logged in" },
  { needles: ["git", "fetch", "origin", "main", "dev"], out: "" },
  { needles: ["git", "rev-list", "--count", "origin/main..origin/dev"], out: "0" },
  { needles: ["git", "rev-parse", "origin/main"], out: MAIN_SHA },
  { needles: ["git", "show", "origin/main:package.json"], out: JSON.stringify({ version: "3.23.1" }) },
  { needles: ["gh", "run", "list", "release.yml", "workflow_dispatch"], out: "PLACEHOLDER-LIST" },
  { needles: ["gh", "workflow", "run", "release.yml"], out: "" },
  {
    needles: ["gh", "run", "view"],
    out: JSON.stringify({ status: "completed", conclusion: "success", jobs: [] }),
  },
];

describe("release.mjs dispatch flow (injected runner)", () => {
  it("stops with exit code 2 when dev is ahead and --promote is absent", async () => {
    const log: string[] = [];
    const responses = BASE_RESPONSES.map((r) =>
      r.needles.includes("--count") ? { needles: r.needles, out: "3" } : r,
    );
    const { run, calls } = scriptedRunner(responses);
    const deps = {
      run,
      sleep: () => Promise.resolve(),
      log: (line: string) => log.push(line),
      ask: () => Promise.resolve(true),
    };
    await assert.rejects(runRelease(["patch"], deps), (error: { code?: number }) => error.code === 2);
    assert.ok(log.some((line) => line.includes("--promote")));
    assert.ok(!calls.some(([, args]) => args[0] === "workflow"));
  });

  it("dispatches release.yml with dry_run=true and never touches deployments in dry mode", async () => {
    const log: string[] = [];
    const responses = BASE_RESPONSES.map((response) =>
      response.out === "PLACEHOLDER-LIST"
        ? { needles: response.needles, out: "[]" } // high-water mark: nothing yet
        : response,
    );
    const { run, calls } = scriptedRunner(responses);
    // After the dispatch, the run list shows the new release run (id above the mark).
    let listCalls = 0;
    const runCounting = (bin: string, args: string[]) => {
      if (bin === "gh" && args[0] === "run" && args[1] === "list") {
        listCalls += 1;
        if (listCalls === 2) {
          calls.push([bin, args]);
          return JSON.stringify([
            { databaseId: 500, headBranch: "main", status: "completed", url: "https://example.test/run/500" },
          ]);
        }
      }
      return run(bin, args);
    };
    const code = await runRelease(["patch", "--dry-run", "--yes"], {
      run: runCounting,
      sleep: () => Promise.resolve(),
      log: (line: string) => log.push(line),
      ask: () => Promise.resolve(true),
    });
    assert.equal(code, 0);
    const dispatch = calls.find(([, args]) => args[0] === "workflow");
    assert.ok(dispatch);
    assert.deepEqual(dispatch?.[1], [
      "workflow", "run", "release.yml",
      "-f", "bump=patch", "-f", "dry_run=true", "-f", "expected_sha=" + MAIN_SHA,
    ]);
    assert.ok(!calls.some(([, args]) => args[0] === "api"));
    // Dry runs never touch tags.
    assert.ok(!calls.some(([, args]) => args[0] === "ls-remote" || args[0] === "push"));
  });

  it("--yes answers every prompt, even one the caller supplied", async () => {
    const responses = BASE_RESPONSES.map((response) =>
      response.out === "PLACEHOLDER-LIST" ? { needles: response.needles, out: "[]" } : response,
    );
    const { run } = scriptedRunner(responses);
    let listCalls = 0;
    const runCounting = (bin: string, args: string[]) => {
      if (bin === "gh" && args[0] === "run" && args[1] === "list" && ++listCalls === 2) {
        return JSON.stringify([{ databaseId: 500, status: "completed", url: "https://example.test/run/500" }]);
      }
      return run(bin, args);
    };
    const code = await runRelease(["patch", "--dry-run", "--yes"], {
      run: runCounting,
      sleep: () => Promise.resolve(),
      log: () => {},
      ask: () => { throw new Error("--yes must not prompt"); },
    });
    assert.equal(code, 0);
  });
});

describe("release.mjs resume", () => {
  it("parses resume X.Y.Z and refuses cut-only switches", () => {
    const parsed = parseArgs(["resume", "3.24.1", "--approve", "--yes"]);
    assert.equal(parsed.mode, "resume");
    assert.equal(parsed.version, "3.24.1");
    assert.deepEqual([...parsed.flags].sort(), ["--approve", "--yes"]);
    assert.equal(parseArgs(["patch"]).mode, "cut");
    assert.throws(() => parseArgs(["resume"]), /stable X\.Y\.Z/);
    assert.throws(() => parseArgs(["resume", "3.24"]), /stable X\.Y\.Z/);
    assert.throws(() => parseArgs(["resume", "3.24.1-preview.1"]), /stable X\.Y\.Z/);
    for (const flag of ["--promote", "--dry-run", "--canary"]) {
      assert.throws(() => parseArgs(["resume", "3.24.1", flag]), /resume does not take/);
    }
  });

  it("dispatches release.yml with resume_version, pushes the desktop tag once, and skips promotion", async () => {
    const SHA = "d".repeat(40);
    const calls: string[] = [];
    let lsRemote = 0;
    let desktopRuns = 0;
    const run = (bin: string, args: string[]) => {
      const joined = [bin, ...args].join(" ");
      calls.push(joined);
      if (joined.startsWith("gh run list") && joined.includes("release.yml")) {
        return calls.filter((c) => c.startsWith("gh run list") && c.includes("release.yml")).length === 1
          ? "[]"
          : JSON.stringify([{ databaseId: 700, status: "completed", url: "https://example.test/run/700" }]);
      }
      if (joined.startsWith("gh workflow run release.yml")) return "";
      if (joined.startsWith("gh run view 700")) {
        return JSON.stringify({ status: "completed", conclusion: "success", jobs: [] });
      }
      if (joined.startsWith("gh api")) return "[]";
      if (joined.startsWith("git ls-remote")) {
        lsRemote += 1;
        // First only the release tag exists; after the push both do.
        return lsRemote === 1
          ? SHA + "\trefs/tags/v3.24.1"
          : SHA + "\trefs/tags/v3.24.1\n" + SHA + "\trefs/tags/desktop-v3.24.1";
      }
      if (joined.startsWith("git push") || joined.startsWith("git fetch")) return "";
      if (joined.startsWith("gh release view desktop-v3.24.1")) {
        desktopRuns += 1;
        if (desktopRuns < 2) throw new Error("release not found");
        return JSON.stringify({ isDraft: false });
      }
      if (joined.startsWith("gh run list")) return "[]";
      throw new Error("unexpected command: " + joined);
    };
    const code = await runRelease(["resume", "3.24.1", "--yes"], {
      run,
      sleep: () => Promise.resolve(),
      log: () => {},
    });
    assert.equal(code, 0);
    assert.ok(calls.includes("gh workflow run release.yml -f bump=patch -f dry_run=false -f resume_version=3.24.1"));
    assert.deepEqual(calls.filter((c) => c.startsWith("git push")), ["git push origin " + SHA + ":refs/tags/desktop-v3.24.1"]);
    // No promotion in a resume.
    assert.ok(!calls.some((c) => c.includes("pr list") || c.includes("rev-list --count")));
  });

  it("pushes the desktop tag for a release commit this clone has never fetched", async () => {
    const root = mkdtempSync(join(tmpdir(), "ima2-desktop-tag-"));
    try {
      const git = (cwd: string, ...args: string[]) =>
        execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const origin = join(root, "origin.git");
      const ci = join(root, "ci");
      const maintainer = join(root, "maintainer");
      git(root, "init", "-q", "--bare", "-b", "main", origin);
      git(root, "clone", "-q", origin, ci);
      for (const clone of [ci]) {
        git(clone, "config", "user.name", "test");
        git(clone, "config", "user.email", "test@example.test");
      }
      writeFileSync(join(ci, "package.json"), '{"version":"3.24.0"}\n');
      git(ci, "add", "package.json");
      git(ci, "commit", "-q", "-m", "base");
      git(ci, "push", "-q", "origin", "HEAD:refs/heads/main");
      git(root, "clone", "-q", origin, maintainer);
      // CI cuts and tags a commit after the maintainer's last fetch.
      writeFileSync(join(ci, "package.json"), '{"version":"3.24.1"}\n');
      git(ci, "commit", "-q", "-am", "release 3.24.1");
      const releaseSha = git(ci, "rev-parse", "HEAD");
      git(ci, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/tags/v3.24.1");

      let desktopViews = 0;
      const run = (bin: string, args: string[]) => {
        if (bin === "git") return git(maintainer, ...args);
        const joined = [bin, ...args].join(" ");
        if (joined.startsWith("gh run list") && joined.includes("release.yml")) {
          return joined.includes("--event") && desktopViews === 0 && !run.dispatched
            ? "[]"
            : JSON.stringify([{ databaseId: 900, status: "completed", url: "https://example.test/run/900" }]);
        }
        if (joined.startsWith("gh workflow run release.yml")) { run.dispatched = true; return ""; }
        if (joined.startsWith("gh run view 900")) return JSON.stringify({ status: "completed", conclusion: "success", jobs: [] });
        if (joined.startsWith("gh api")) return "[]";
        if (joined.startsWith("gh run list")) return "[]";
        if (joined.startsWith("gh release view desktop-v3.24.1")) {
          desktopViews += 1;
          if (desktopViews < 2) throw new Error("release not found");
          return JSON.stringify({ isDraft: false });
        }
        throw new Error("unexpected command: " + joined);
      };
      run.dispatched = false;
      const code = await runRelease(["resume", "3.24.1", "--yes"], { run, sleep: () => Promise.resolve(), log: () => {} });
      assert.equal(code, 0);
      assert.equal(git(ci, "ls-remote", origin, "refs/tags/desktop-v3.24.1").split(/\s+/)[0], releaseSha);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe("release.mjs desktop tag", () => {
  it("waits for the release tag, pushes once, and refuses a desktop tag at another commit", () => {
    assert.equal(desktopTagAction({ releaseTagSha: "", desktopTagSha: "" }), "wait");
    assert.equal(desktopTagAction({ releaseTagSha: "a", desktopTagSha: "" }), "push");
    assert.equal(desktopTagAction({ releaseTagSha: "a", desktopTagSha: "a" }), "done");
    assert.equal(desktopTagAction({ releaseTagSha: "a", desktopTagSha: "b" }), "conflict");
  });

  it("reads lightweight tags and prefers the peeled commit of an annotated tag", () => {
    assert.deepEqual(parseRemoteTags("aaa\trefs/tags/v1.0.0\n"), { "v1.0.0": "aaa" });
    assert.deepEqual(
      parseRemoteTags("tagobj\trefs/tags/desktop-v1.0.0\ncommit1\trefs/tags/desktop-v1.0.0^{}\nnoise"),
      { "desktop-v1.0.0": "commit1" },
    );
    assert.deepEqual(parseRemoteTags(""), {});
  });

  it("recognises a tag ruleset rejection so a non-admin run stops retrying", () => {
    assert.ok(isRuleRejection({ stderr: "remote: error: GH013: Repository rule violations found" }));
    assert.ok(isRuleRejection(new Error("Cannot create ref due to creations being restricted.")));
    assert.ok(!isRuleRejection(new Error("Could not resolve host: github.com")));
  });
});
