import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const require = createRequire(import.meta.url);
const gate = require("../.github/scripts/pr-screenshot.cjs") as {
  UI_SCREENSHOT_WAIVER_LABEL: string;
  UI_OVERRIDE_RE: RegExp;
  isUiSurfacePath: (file: string) => boolean;
  uiPathsChanged: (files: string[]) => boolean;
  isChangedFileListTruncated: (count: unknown, listed: number, headMatches?: boolean) => boolean;
  stripNonRenderedRegions: (body: string) => string;
  hasScreenshotEvidence: (body: unknown) => boolean;
  hasUiOverride: (input: { comments?: unknown[] }) => boolean;
  hasWritePermission: (permission: unknown) => boolean;
  waiverLabelActorLogin: (events: unknown[]) => string | null;
  evaluateScreenshotGate: (input: Record<string, unknown>) => {
    status: string;
    reason: string;
    uiPaths: string[];
  };
};

const WORKFLOW = ".github/workflows/pr-screenshot-gate.yml";

describe("pr-screenshot gate helper", () => {
  describe("isUiSurfacePath", () => {
    it("counts the React app under ui/ except its test surfaces", () => {
      for (const path of [
        "ui/src/App.tsx",
        "ui/src/styles/base.css",
        "ui/public/fonts/font.woff2",
        "ui/vite.config.ts",
        "ui/mock/assets/logo.png",
      ]) {
        assert.equal(gate.isUiSurfacePath(path), true, path);
      }
      for (const path of [
        "ui/e2e/composer-input.spec.ts",
        "ui/e2e/fixtures/base.ts",
        "ui/src/App.test.tsx",
        "ui/src/lib/util.spec.ts",
      ]) {
        assert.equal(gate.isUiSurfacePath(path), false, path);
      }
    });

    it("counts public/ files and assets/ images, not other assets", () => {
      assert.equal(gate.isUiSurfacePath("public/index.html.legacy"), true);
      assert.equal(gate.isUiSurfacePath("assets/screenshots/home-light.png"), true);
      assert.equal(gate.isUiSurfacePath("assets/card-news/templates/x.json"), false);
      assert.equal(gate.isUiSurfacePath("assets/mcp-snapshots/list.json"), false);
      assert.equal(gate.isUiSurfacePath("lib/eventBus.ts"), false);
      assert.equal(gate.isUiSurfacePath("docs/guide.md"), false);
      assert.equal(gate.isUiSurfacePath("README.md"), false);
    });

    it("rejects empty and non-string paths", () => {
      assert.equal(gate.isUiSurfacePath(""), false);
      assert.equal(gate.uiPathsChanged([]), false);
      assert.equal(gate.uiPathsChanged(["server.ts", "ui/src/x.ts"]), true);
    });
  });

  describe("isChangedFileListTruncated", () => {
    it("fails closed on missing counts and head drift", () => {
      assert.equal(gate.isChangedFileListTruncated(3, 3), false);
      assert.equal(gate.isChangedFileListTruncated(4, 3), true);
      assert.equal(gate.isChangedFileListTruncated(0, 0), false);
      assert.equal(gate.isChangedFileListTruncated(undefined, 0), true);
      assert.equal(gate.isChangedFileListTruncated(-1, 0), true);
      assert.equal(gate.isChangedFileListTruncated(2.5, 3), true);
      assert.equal(gate.isChangedFileListTruncated(1, 1, false), true);
    });
  });

  describe("hasScreenshotEvidence", () => {
    it("accepts inline markdown, HTML, and defined reference images", () => {
      assert.equal(gate.hasScreenshotEvidence("![ui](https://x/img.png)"), true);
      assert.equal(gate.hasScreenshotEvidence('<img src="https://x/i.png">'), true);
      assert.equal(gate.hasScreenshotEvidence("![ui][shot]\n\n[shot]: https://x/i.png"), true);
      assert.equal(gate.hasScreenshotEvidence("![ui][]\n\n[ui]: https://x/i.png"), true);
    });

    it("rejects bare links, undefined references, and hidden regions", () => {
      assert.equal(gate.hasScreenshotEvidence("[img](https://x/i.png)"), false);
      assert.equal(gate.hasScreenshotEvidence("![ui][missing]"), false);
      assert.equal(gate.hasScreenshotEvidence(""), false);
      assert.equal(gate.hasScreenshotEvidence(null), false);
      assert.equal(
        gate.hasScreenshotEvidence("<!-- ![ui](https://x/i.png) -->"),
        false,
      );
      assert.equal(
        gate.hasScreenshotEvidence("```\n![ui](https://x/i.png)\n```"),
        false,
      );
      // A `<!--` inside a fence is literal text, never an open comment: the
      // real image after the fence still counts (fence-first stripping).
      assert.equal(
        gate.hasScreenshotEvidence("```\n<!--\n```\n\n![ui](https://x/i.png)"),
        true,
      );
      // An unclosed comment swallows everything after it, including evidence.
      assert.equal(
        gate.hasScreenshotEvidence("<!-- note\n![ui](https://x/i.png)"),
        false,
      );
    });
  });

  describe("UI_OVERRIDE_RE", () => {
    const yes = [
      "No UI changes here.",
      "doesn't touch the ui",
      "does not change the UI",
      "not touching the frontend",
      "the UI is unchanged",
      "ui surface is untouched",
      "UI 변경 없음",
      "frontend 수정 없다",
    ];
    const no = [
      // Negations that demand a screenshot must not waive the gate.
      "without a UI screenshot",
      "do not merge without a UI screenshot",
      "I do not think we should skip the UI screenshot",
      "Never ship frontend changes",
      "touches ui but only config",
      // The negation window must not cross a sentence boundary.
      "This does not change the API. Please add a ui screenshot.",
      "random text",
    ];
    it("accepts statements that the UI was not changed", () => {
      for (const body of yes) {
        assert.equal(gate.UI_OVERRIDE_RE.test(body), true, body);
      }
    });
    it("rejects screenshot demands and unrelated clauses", () => {
      for (const body of no) {
        assert.equal(gate.UI_OVERRIDE_RE.test(body), false, body);
      }
    });
  });

  describe("hasUiOverride", () => {
    const comment = (body: string, association = "MEMBER") => ({
      body,
      author_association: association,
    });

    it("prefilters on maintainer association only", () => {
      assert.equal(
        gate.hasUiOverride({ comments: [comment("No UI changes here.")] }),
        true,
      );
      assert.equal(
        gate.hasUiOverride({ comments: [comment("No UI changes.", "NONE")] }),
        false,
      );
      assert.equal(
        gate.hasUiOverride({ comments: [comment("No UI changes.", "CONTRIBUTOR")] }),
        false,
      );
      assert.equal(
        gate.hasUiOverride({ comments: [comment("touches ui but only config")] }),
        false,
      );
      assert.equal(gate.hasUiOverride({ comments: [] }), false);
    });
  });

  describe("waiver label provenance", () => {
    const ev = (event: string, actor: string, id: number) => ({
      event,
      actor: { login: actor },
      label: { name: gate.UI_SCREENSHOT_WAIVER_LABEL },
      id,
      created_at: `2026-01-0${id}T00:00:00Z`,
    });

    it("returns the actor of the latest labeled event only", () => {
      assert.equal(gate.waiverLabelActorLogin([ev("labeled", "jun", 1)]), "jun");
      assert.equal(
        gate.waiverLabelActorLogin([ev("labeled", "bot", 1), ev("unlabeled", "jun", 2)]),
        null,
      );
      assert.equal(
        gate.waiverLabelActorLogin([
          ev("labeled", "bot", 1),
          ev("unlabeled", "bot", 2),
          ev("labeled", "jun", 3),
        ]),
        "jun",
      );
      // Other labels never count.
      const other = { ...ev("labeled", "jun", 1), label: { name: "bug" } };
      assert.equal(gate.waiverLabelActorLogin([other]), null);
      assert.equal(gate.waiverLabelActorLogin([]), null);
    });
  });

  describe("evaluateScreenshotGate", () => {
    const base = {
      changedFilePaths: ["ui/src/App.tsx"],
      filesTruncated: false,
      body: "no image here",
      commentOverride: false,
      waiverLabelPresent: false,
      waiverActorPermission: null,
    };

    it("passes without UI changes or with evidence, fails otherwise", () => {
      assert.equal(
        gate.evaluateScreenshotGate({ ...base, changedFilePaths: ["lib/x.ts"] }).status,
        "pass",
      );
      assert.equal(
        gate.evaluateScreenshotGate({ ...base, body: "![ui](https://x/i.png)" }).status,
        "pass",
      );
      assert.equal(gate.evaluateScreenshotGate(base).status, "fail");
      // A truncated file list arms the gate even with no listed UI path.
      assert.equal(
        gate.evaluateScreenshotGate({
          ...base,
          changedFilePaths: ["lib/x.ts"],
          filesTruncated: true,
        }).status,
        "fail",
      );
    });

    it("waives on a privileged label actor or a maintainer comment", () => {
      assert.equal(
        gate.evaluateScreenshotGate({
          ...base,
          waiverLabelPresent: true,
          waiverActorPermission: "write",
        }).status,
        "waived",
      );
      // A contributor-applied waiver label does not waive.
      assert.equal(
        gate.evaluateScreenshotGate({
          ...base,
          waiverLabelPresent: true,
          waiverActorPermission: "read",
        }).status,
        "fail",
      );
      assert.equal(
        gate.evaluateScreenshotGate({ ...base, commentOverride: true }).status,
        "waived",
      );
    });
  });
});

describe("pr-screenshot-gate workflow", () => {
  const text = readFileSync(WORKFLOW, "utf8");
  const doc = parseDocument(text);

  it("is a pull_request_target gate with the documented triggers", () => {
    const on = doc.get("on", true) as { get?: (k: string, keep?: boolean) => unknown };
    const prt = on.get?.("pull_request_target", true) as { get?: (k: string) => unknown };
    assert.ok(prt, "pull_request_target trigger missing");
    const types = prt.get?.("types") as { items?: { value?: string }[] };
    const names = (types.items ?? []).map((item) => item.value).sort();
    assert.deepEqual(names, [
      "edited",
      "labeled",
      "opened",
      "ready_for_review",
      "reopened",
      "synchronize",
      "unlabeled",
    ]);
    // The named check is `screenshot-gate`.
    assert.match(text, /name: screenshot-gate/);
  });

  it("stays read-only and never checks out the PR head", () => {
    // actions/checkout cannot run at all without contents: read.
    assert.match(text, /contents: read/);
    assert.match(text, /pull-requests: read/);
    assert.match(text, /issues: read/);
    assert.doesNotMatch(text, /contents: write|pull-requests: write|issues: write/);
    assert.doesNotMatch(text, /pull_request\.head|github\.event\.pull_request\.head\.ref/);
    // pull_request_target executes the default-branch workflow, so no ref may
    // be set — a ref is the only way PR code could be checked out.
    assert.doesNotMatch(text, /^\s+ref:\s/m);
    assert.match(text, /pull_request_target/);
    assert.match(text, /persist-credentials: false/);
  });
});

// PR screenshot evidence belongs in the PR description or on the orphan
// `pr-assets` branch — never committed to a source branch, where it would ride
// a merge into the integration branch (the `docs/pr-assets/` lesson in
// opencodex). This guards tracked paths only (git ls-files): an untracked local
// `pr-assets/` folder must not fail the suite. Folder names are checked rather
// than image extensions so legitimate product screenshots
// (assets/screenshots/) stay untouched.
describe("pr-assets evidence hygiene", () => {
  const EVIDENCE_DIR_RE = /^(pr-assets|pr-screenshots?|screenshot-evidence)$/i;

  it("keeps committed evidence folders out of the source tree", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const offenders = tracked.filter((path) =>
      path.split("/").slice(0, -1).some((segment) => EVIDENCE_DIR_RE.test(segment)),
    );
    assert.deepEqual(offenders, []);
  });
});
