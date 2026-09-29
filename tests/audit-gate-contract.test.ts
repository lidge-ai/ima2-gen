import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyAuditResult,
  countAtOrAbove,
  isCountableTally,
  loadExceptions,
  parseArgs,
  partitionFindings,
  validateException,
} from "../scripts/audit-gate.mjs";

// WP-A: `npm audit` exits 1 both when it finds a vulnerability and when the registry
// fails to answer. Conflating those turns an upstream outage into a red build and
// trains people to ignore the gate. These tests pin the distinction.

const REGISTRY_FAILURE = {
  status: 1,
  stdout: JSON.stringify({
    message: "invalid json response body at https://registry.npmjs.org/-/npm/v1/security/advisories/bulk reason: Unexpected token",
    error: { summary: "", detail: "" },
  }),
  stderr: "npm error audit endpoint returned an error",
};

const CLEAN_REPORT = {
  status: 0,
  stdout: JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 2, moderate: 1, high: 0, critical: 0 } },
  }),
  stderr: "",
};

const VULNERABLE_REPORT = {
  status: 1,
  stdout: JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 1 } },
    vulnerabilities: { "some-pkg": { severity: "high" } },
  }),
  stderr: "",
};

test("a registry transport failure is not a vulnerability finding", () => {
  // The exact shape observed in CI run 30191117813: the bulk advisories endpoint
  // returned gzip bytes npm could not decode, so nothing was actually audited.
  assert.equal(classifyAuditResult(REGISTRY_FAILURE).kind, "infrastructure");
});

test("common network failures are also classified as infrastructure", () => {
  for (const stderr of [
    "npm error code ENOTFOUND",
    "npm error network ETIMEDOUT",
    "npm error socket hang up",
    "npm error 503 Service Unavailable",
  ]) {
    assert.equal(
      classifyAuditResult({ status: 1, stdout: "", stderr }).kind,
      "infrastructure",
      `${stderr} should be infrastructure`,
    );
  }
});

test("a real advisory report is classified as a report even when npm exits 1", () => {
  const result = classifyAuditResult(VULNERABLE_REPORT);
  assert.equal(result.kind, "report");
  assert.equal(countAtOrAbove(result.report, "high"), 3, "2 high + 1 critical must be counted");
});

test("findings below the threshold do not trip the gate", () => {
  const result = classifyAuditResult(CLEAN_REPORT);
  assert.equal(result.kind, "report");
  assert.equal(countAtOrAbove(result.report, "high"), 0, "low/moderate must not fail a high gate");
  assert.equal(countAtOrAbove(result.report, "low"), 3, "the same report is non-zero at a lower gate");
});

test("an unrecognized failure fails closed rather than passing silently", () => {
  // Silence here would be the worst outcome: a broken gate that always reports success.
  const result = classifyAuditResult({ status: 1, stdout: "totally unexpected", stderr: "boom" });
  assert.equal(result.kind, "unknown");
});

test("a report without a countable tally is not accepted as clean", () => {
  // `vulnerabilities` without `metadata.vulnerabilities` would count as zero and let a
  // critical finding through. It must fail closed instead.
  const result = classifyAuditResult({
    status: 1,
    stdout: JSON.stringify({ vulnerabilities: { "bad-pkg": { severity: "critical" } } }),
    stderr: "",
  });
  assert.equal(result.kind, "unknown", "an uncountable report must not pass the gate");
});

test("a clean exit without a parseable report is not treated as a clean tree", () => {
  // npm exiting 0 with no usable output means nothing was verified. Calling that
  // "no vulnerabilities" turns "could not check" into "everything is fine".
  assert.equal(classifyAuditResult({ status: 0, stdout: "", stderr: "" }).kind, "unknown");
  assert.equal(classifyAuditResult({ status: 0, stdout: "not json", stderr: "" }).kind, "unknown");
});

test("a malformed tally is refused instead of counting as zero", () => {
  // Verified against npm 11.18.0: a real report always fills every severity plus
  // `total` (`{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`), so
  // requiring all five never rejects a genuine report.
  // `Number("garbage") || 0` collapses to 0, so a corrupted tally would read as a clean
  // tree. Every severity must be a real non-negative integer or the gate refuses to answer.
  const malformed: unknown[] = [
    { info: 0, low: 0, moderate: 0, high: "garbage", critical: 0 },
    { info: 0, low: 0, moderate: 0, high: -2, critical: 0 },
    { info: 0, low: 0, moderate: 0, high: 1.5, critical: 0 },
    { info: 0, low: 0, moderate: 0, critical: 0 }, // `high` missing entirely
    [],
    null,
    "nope",
  ];
  for (const tally of malformed) {
    assert.equal(isCountableTally(tally), false, `${JSON.stringify(tally)} must not be countable`);
    assert.equal(
      classifyAuditResult({ status: 1, stdout: JSON.stringify({ metadata: { vulnerabilities: tally } }), stderr: "" }).kind,
      "unknown",
      `${JSON.stringify(tally)} must fail closed`,
    );
    assert.throws(
      () => countAtOrAbove({ metadata: { vulnerabilities: tally } }, "high"),
      /countable/,
      `${JSON.stringify(tally)} must not be silently counted`,
    );
  }

  // A well-formed tally still works.
  assert.equal(isCountableTally({ info: 0, low: 1, moderate: 0, high: 2, critical: 0 }), true);
  // npm's own extra `total` key must not break acceptance.
  assert.equal(isCountableTally({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }), true);
});

// --- end-to-end exit-status checks -------------------------------------------------
// The classifier being right is not enough: the gate must actually exit non-zero. These
// run the real script against a stub `npm`.
//
// The stub is injected through IMA2_AUDIT_NPM rather than PATH: a shell-script `npm` on
// PATH is not executable on Windows, and `npm.cmd` shims differ per runner. Passing an
// explicit interpreter+script keeps this identical on every OS the CI matrix covers.

function runGateWithStubNpm(stubBody: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "ima2-audit-gate-"));
  try {
    const stubPath = join(dir, "npm-stub.mjs");
    writeFileSync(stubPath, stubBody);
    const result = spawnSync(
      process.execPath,
      ["scripts/audit-gate.mjs", "--audit-level", "high"],
      { encoding: "utf8", env: { ...process.env, IMA2_AUDIT_NPM: stubPath } },
    );
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const stubFor = (payload: unknown, exitCode: number) =>
  `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});\nprocess.exit(${exitCode});\n`;

test("the gate exits non-zero when the report contains high findings", () => {
  const result = runGateWithStubNpm(
    stubFor({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } } }, 1),
  );
  assert.equal(result.status, 1, "a high finding must fail the build");
  assert.match(result.stderr, /2 high\+ vulnerabilit/);
});

test("the gate exits zero for a clean report", () => {
  const result = runGateWithStubNpm(
    stubFor({ metadata: { vulnerabilities: { info: 0, low: 3, moderate: 1, high: 0, critical: 0 } } }, 0),
  );
  assert.equal(result.status, 0, "below-threshold findings must not fail the build");
  assert.match(result.stdout, /no high\+ vulnerabilities/);
});

test("the gate exits non-zero when it cannot read a tally", () => {
  const result = runGateWithStubNpm(stubFor({ vulnerabilities: { pkg: { severity: "critical" } } }, 1));
  assert.equal(result.status, 1, "an uncountable report must fail closed");
});

test("the gate exits non-zero for a malformed severity tally", () => {
  const result = runGateWithStubNpm(
    stubFor({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: "3", critical: 0 } } }, 1),
  );
  assert.equal(result.status, 1, "a string severity count must not read as zero");
});

test("the gate survives a registry outage without failing the build", () => {
  const stub =
    `process.stderr.write("npm error audit endpoint returned an error\\n");\nprocess.exit(1);\n`;
  const result = runGateWithStubNpm(stub);
  assert.equal(result.status, 0, "an upstream outage must not turn every push red");
  assert.match(result.stderr + result.stdout, /SKIPPED/);
  assert.match(result.stderr + result.stdout, /NOT verified/, "the skip must be stated loudly");
});

test("threshold arithmetic covers every severity at or above the level", () => {
  const report = { metadata: { vulnerabilities: { info: 1, low: 1, moderate: 1, high: 1, critical: 1 } } };
  assert.equal(countAtOrAbove(report, "critical"), 1);
  assert.equal(countAtOrAbove(report, "high"), 2);
  assert.equal(countAtOrAbove(report, "moderate"), 3);
  assert.equal(countAtOrAbove(report, "info"), 5);
  assert.throws(() => countAtOrAbove(report, "nonsense"));
});

test("argument parsing supports the ui prefix and omit flags the CI uses", () => {
  const args = parseArgs(["--prefix", "ui", "--audit-level", "high", "--omit", "dev"]);
  assert.equal(args.prefix, "ui");
  assert.equal(args.auditLevel, "high");
  assert.deepEqual(args.omit, ["dev"]);

  const defaults = parseArgs([]);
  assert.equal(defaults.prefix, null);
  assert.equal(defaults.auditLevel, "high", "the gate must default to the strict level");
});

// An exception mechanism is only safe if it stays narrow. These pin the ways it must
// refuse to widen: expiry, malformed entries, wrong scope, and new advisories.

const NOW = new Date("2026-08-12T00:00:00Z");

function exception(overrides: Record<string, unknown> = {}) {
  return {
    ghsa: "GHSA-w3rx-r6r6-pgpr",
    package: "image-size",
    scope: "ui",
    reason: "unreachable in the browser bundle",
    evidence: "grep of ui/dist shows 0 references",
    expires: "2026-11-12",
    ...overrides,
  };
}

test("an exception must carry every field, a real GHSA id, and a future expiry", () => {
  assert.deepEqual(validateException(exception(), NOW), []);

  for (const field of ["ghsa", "package", "scope", "reason", "evidence", "expires"]) {
    const problems = validateException(exception({ [field]: "" }), NOW);
    assert.ok(problems.some((p) => p.includes(field)), `${field} must be required`);
  }

  assert.match(validateException(exception({ ghsa: "CVE-2025-1234" }), NOW).join(), /not a GHSA id/);
  assert.match(validateException(exception({ expires: "someday" }), NOW).join(), /not a date/);
  assert.match(validateException(exception({ expires: "2026-08-11" }), NOW).join(), /expired on/);
  assert.deepEqual(validateException(null, NOW), ["entry is not an object"]);
});

test("an expired or malformed entry stops excluding instead of failing the file", () => {
  const raw = JSON.stringify({
    exceptions: [exception(), exception({ ghsa: "GHSA-5p2g-fcmc-qvqq", expires: "2020-01-01" }), { ghsa: "junk" }],
  });
  const { active, skipped } = loadExceptions(raw, NOW);
  assert.equal(active.length, 1, "only the valid, unexpired entry stays active");
  assert.equal(skipped.length, 2);
  assert.match(skipped.map((s) => s.problems.join()).join(" "), /expired on/);
});

test("a missing file means no exceptions, and a broken file throws rather than reading as empty", () => {
  assert.deepEqual(loadExceptions(null, NOW), { active: [], skipped: [] });
  assert.throws(() => loadExceptions("{not json", NOW), /not valid JSON/);
  assert.throws(() => loadExceptions(JSON.stringify({ nope: [] }), NOW), /`exceptions` array/);
});

const UI_REPORT = {
  vulnerabilities: {
    "image-size": {
      severity: "high",
      via: [
        { source: 1138808, title: "ICNS parser DoS", url: "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr" },
        { source: 1138809, title: "JXL/HEIF DoS", url: "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq" },
      ],
    },
    pptxgenjs: { severity: "high", via: ["image-size"] },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } },
};

function reportOf(vulnerabilities: Record<string, unknown>, high: number) {
  return { vulnerabilities, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0 } } };
}

test("excluding every advisory of a package also clears the parent that depends on it", () => {
  const both = [exception(), exception({ ghsa: "GHSA-5p2g-fcmc-qvqq" })];
  const split = partitionFindings(UI_REPORT, "high", both, "ui");
  assert.deepEqual(split.remaining, [], "nothing unexcepted should remain");
  assert.deepEqual(split.excluded.sort(), ["image-size", "pptxgenjs"]);
});

test("a partially covered package still fails the gate", () => {
  // Only one of image-size's two advisories is excepted: the package stays a finding,
  // so a NEW advisory on an already-excepted package cannot slip through.
  const split = partitionFindings(UI_REPORT, "high", [exception()], "ui");
  assert.deepEqual(split.remaining.sort(), ["image-size", "pptxgenjs"]);
  assert.deepEqual(split.excluded, []);
});

test("an exception does not leak across scopes", () => {
  const rootScoped = [exception({ scope: "root" }), exception({ ghsa: "GHSA-5p2g-fcmc-qvqq", scope: "root" })];
  const split = partitionFindings(UI_REPORT, "high", rootScoped, "ui");
  assert.deepEqual(split.remaining.sort(), ["image-size", "pptxgenjs"], "root exceptions must not cover ui");
});

test("a report without per-advisory detail fails closed instead of excluding blindly", () => {
  assert.throws(() => partitionFindings({ metadata: {} }, "high", [exception()], "ui"), /no per-advisory detail/);
});

// Regression: an earlier version filtered `via` down to entries it understood and then
// checked only those, so a mixed array quietly excused an unexcepted vulnerability.
test("a via entry the gate cannot fully read never excuses the finding", () => {
  const excepted = "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr";

  const mixed = reportOf({
    "image-size": { severity: "high", via: [{ url: excepted }, "other"] },
    other: { severity: "high", via: [{ url: "https://github.com/advisories/GHSA-zzzz-zzzz-zzzz" }] },
  }, 2);
  assert.deepEqual(partitionFindings(mixed, "high", [exception()], "ui").remaining.sort(), ["image-size", "other"]);

  const urlless = reportOf({ "image-size": { severity: "high", via: [{ url: excepted }, { source: 999 }] } }, 1);
  assert.deepEqual(partitionFindings(urlless, "high", [exception()], "ui").remaining, ["image-size"]);

  const emptyVia = reportOf({ "image-size": { severity: "high", via: [] } }, 1);
  assert.deepEqual(partitionFindings(emptyVia, "high", [exception()], "ui").remaining, ["image-size"]);
});

test("a report whose detail does not account for its own tally fails closed", () => {
  // The tally is what decides pass/fail, so a thinner detail list must not be excused.
  const understated = reportOf({ "image-size": UI_REPORT.vulnerabilities["image-size"] }, 2);
  const both = [exception(), exception({ ghsa: "GHSA-5p2g-fcmc-qvqq" })];
  assert.throws(() => partitionFindings(understated, "high", both, "ui"), /tally says 2/);
});

test("an exception naming the wrong package is an error, not a silent no-op", () => {
  const both = [exception({ package: "pptxgenjs" }), exception({ ghsa: "GHSA-5p2g-fcmc-qvqq" })];
  assert.throws(
    () => partitionFindings(UI_REPORT, "high", both, "ui"),
    /names package pptxgenjs but the advisory belongs to image-size/,
  );
});

test("the shipped exception file is well-formed and every active entry is justified", () => {
  const raw = readFileSync(new URL("../scripts/audit-exceptions.json", import.meta.url), "utf8");
  const { active, skipped } = loadExceptions(raw);
  for (const entry of active) {
    assert.ok(entry.evidence.length > 40, `${entry.ghsa} needs real evidence, not a placeholder`);
    assert.ok(Date.parse(entry.expires) - Date.now() < 400 * 24 * 60 * 60 * 1000, `${entry.ghsa} expiry must stay within about a year`);
  }
  // Skipped entries are allowed (they simply stop excluding) but should never be a typo
  // that someone believes is active, so surface them loudly if they exist.
  for (const { entry, problems } of skipped) {
    assert.ok(problems.every((p) => p.includes("expired")), `${entry?.ghsa}: ${problems.join("; ")}`);
  }
});
