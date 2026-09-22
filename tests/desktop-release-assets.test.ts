import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareReleaseAssets } from "../desktop/scripts/prepare-release-assets.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION = "3.16.1";
const TAG = "desktop-v" + VERSION;
const SHA = "a".repeat(40);
const TEAM = "AB12CD34EF";
const BASE = "ima2-" + VERSION + "-mac-arm64";
const INSTALLERS = [BASE + ".dmg", BASE + ".zip"];

function sha512Base64(value: Buffer): string {
  return createHash("sha512").update(value).digest("base64");
}

function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

type Proof = Record<string, any>;

function fixture(mutateProof: (proof: Proof) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "ima2-desktop-release-"));
  mkdirSync(join(directory, "signature-proof"));

  const bytes = new Map<string, Buffer>();
  for (const name of INSTALLERS) bytes.set(name, Buffer.from("signed bytes for " + name));
  for (const name of INSTALLERS) bytes.set(name + ".blockmap", Buffer.from("blockmap for " + name));
  for (const [name, value] of bytes) writeFileSync(join(directory, name), value);

  const zip = bytes.get(BASE + ".zip")!;
  const dmg = bytes.get(BASE + ".dmg")!;
  writeFileSync(join(directory, "latest-mac.yml"), [
    "version: " + VERSION,
    "files:",
    "  - url: " + BASE + ".zip",
    "    sha512: " + sha512Base64(zip),
    "    size: " + zip.length,
    "  - url: " + BASE + ".dmg",
    "    sha512: " + sha512Base64(dmg),
    "    size: " + dmg.length,
    "path: " + BASE + ".zip",
    "sha512: " + sha512Base64(zip),
    "releaseDate: '2026-09-23T00:00:00.000Z'",
    "",
  ].join("\n"));

  const proof: Proof = {
    schemaVersion: 1,
    ok: true,
    source: { sha: SHA, githubSha: SHA, ref: "refs/tags/" + TAG, event: "push", runId: "1", attempt: "1" },
    expected: { expectedVersion: VERSION, expectedAppId: "com.lidge.ima2", expectedArchitectures: ["arm64"], expectedTeam: TEAM },
    originals: { arm64: { ok: true, authority: "Developer ID Application: Example (" + TEAM + ")", teamId: TEAM } },
    exports: INSTALLERS.map((name) => ({ name, ok: true })),
    hashes: INSTALLERS.map((name) => ({ name, sha256: sha256Hex(bytes.get(name)!) })),
  };
  mutateProof(proof);
  writeFileSync(join(directory, "signature-proof/report.json"), JSON.stringify(proof, null, 2) + "\n");

  return { directory, bytes, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function run(directory: string) {
  return prepareReleaseAssets({ distDir: directory, version: VERSION, tag: TAG, sha: SHA });
}

describe("desktop release asset preparation", () => {
  it("uses only Node built-ins because the release runner installs no dependencies", () => {
    const source = readFileSync(join(root, "desktop/scripts/prepare-release-assets.mjs"), "utf8");
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.length > 0);
    assert.ok(imports.every((specifier) => specifier.startsWith("node:")), imports.join(", "));
  });

  it("derives the public checksum list and notes from the signing proof", () => {
    const run1 = fixture();
    try {
      const result = run(run1.directory);
      assert.deepEqual(result.publicAssets, [
        BASE + ".dmg", BASE + ".zip", BASE + ".dmg.blockmap", BASE + ".zip.blockmap",
        "latest-mac.yml", "SHA256SUMS.txt",
      ]);

      // Exact line membership, so a filename never has to survive regex escaping.
      const checksums = readFileSync(join(run1.directory, "SHA256SUMS.txt"), "utf8").split("\n").filter(Boolean);
      for (const [name, value] of run1.bytes) {
        assert.ok(checksums.includes(sha256Hex(value) + "  " + name), "no checksum line for " + name);
      }
      assert.equal(checksums.length, run1.bytes.size + 1, "only the published artifacts are listed");
      assert.ok(!checksums.some((line) => /report\.json|RELEASE_NOTES/.test(line)));

      const notes = readFileSync(join(run1.directory, "RELEASE_NOTES.md"), "utf8");
      assert.ok(notes.includes(SHA), "notes must record the build commit");
      assert.ok(notes.includes(TEAM), "notes must record the Apple Team ID");
      assert.match(notes, /Developer ID Application: Example/);
      assert.match(notes, /Architectures: arm64/);
      assert.match(notes, /Stapled notarization ticket: passed/);
    } finally {
      run1.cleanup();
    }
  });

  it("refuses a proof that does not vouch for this exact release", () => {
    const cases: Array<[string, (proof: Proof) => void, RegExp]> = [
      ["the proof itself failed", (proof) => { proof.ok = false; proof.errors = ["export mismatch"]; }, /did not pass/],
      ["another commit was verified", (proof) => { proof.source.sha = "b".repeat(40); }, /source sha/],
      ["the runner disagreed with its own checkout", (proof) => { proof.source.githubSha = "c".repeat(40); }, /GITHUB_SHA/],
      ["the proof came from another ref", (proof) => { proof.source.ref = "refs/heads/dev"; }, /was not produced for/],
      ["the version drifted", (proof) => { proof.expected.expectedVersion = "9.9.9"; }, /version does not match/],
      ["no Apple team is recorded", (proof) => { proof.expected.expectedTeam = "nope"; }, /Apple Team ID/],
      ["the bundle is not Developer ID signed", (proof) => { proof.originals.arm64.authority = "Apple Development: Someone"; }, /Developer ID signed/],
      ["an original failed", (proof) => { proof.originals.arm64.ok = false; }, /passing original/],
      ["an export failed", (proof) => { proof.exports[0].ok = false; }, /failing export/],
      ["nothing was exported", (proof) => { proof.exports = []; }, /verified no exports/],
      ["a hash is missing", (proof) => { proof.hashes = proof.hashes.slice(1); }, /do not cover exactly/],
    ];

    for (const [label, mutate, expected] of cases) {
      const scenario = fixture(mutate);
      try {
        assert.throws(() => run(scenario.directory), expected, label);
      } finally {
        scenario.cleanup();
      }
    }
  });

  it("refuses artifacts that are not the bytes the proof covered", () => {
    const swapped = fixture();
    try {
      writeFileSync(join(swapped.directory, BASE + ".dmg"), "tampered installer");
      assert.throws(() => run(swapped.directory), /differs from the verified build/);
    } finally {
      swapped.cleanup();
    }

    const metadata = fixture();
    try {
      const path = join(metadata.directory, "latest-mac.yml");
      writeFileSync(path, readFileSync(path, "utf8").replace("version: " + VERSION, "version: 9.9.9"));
      assert.throws(() => run(metadata.directory), /metadata version/);
    } finally {
      metadata.cleanup();
    }

    const duplicate = fixture();
    try {
      const path = join(duplicate.directory, "latest-mac.yml");
      writeFileSync(path, readFileSync(path, "utf8").replace("  - url: " + BASE + ".dmg", "  - url: " + BASE + ".zip"));
      assert.throws(() => run(duplicate.directory), /metadata files/);
    } finally {
      duplicate.cleanup();
    }

    const missing = fixture();
    try {
      rmSync(join(missing.directory, BASE + ".zip.blockmap"));
      assert.throws(() => run(missing.directory), /missing required file/);
    } finally {
      missing.cleanup();
    }
  });
});
