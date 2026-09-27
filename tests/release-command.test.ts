import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bumpVersion,
  dryRunInput,
  isOwnRun,
  parseArgs,
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
  });
});
