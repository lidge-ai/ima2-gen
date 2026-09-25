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
const WIN_ARCHES = ["x64", "arm64"] as const;
const LINUX_LEGS = [
  { arch: "x64", appImage: `ima2-${VERSION}-linux-x86_64.AppImage`, deb: `ima2-${VERSION}-linux-amd64.deb`, channel: "latest-linux.yml" },
  { arch: "arm64", appImage: `ima2-${VERSION}-linux-arm64.AppImage`, deb: `ima2-${VERSION}-linux-arm64.deb`, channel: "latest-linux-arm64.yml" },
] as const;

/** Published names in the exact order the script emits them. */
const EXPECTED_PUBLIC = [
  BASE + ".dmg", BASE + ".zip", BASE + ".dmg.blockmap", BASE + ".zip.blockmap",
  "latest-mac.yml",
  `ima2-${VERSION}-win-x64.exe`, `ima2-${VERSION}-win-x64.exe.blockmap`,
  `ima2-${VERSION}-win-arm64.exe`, `ima2-${VERSION}-win-arm64.exe.blockmap`,
  "latest.yml",
  `ima2-${VERSION}-linux-x86_64.AppImage`, `ima2-${VERSION}-linux-amd64.deb`, "latest-linux.yml",
  `ima2-${VERSION}-linux-arm64.AppImage`, `ima2-${VERSION}-linux-arm64.deb`, "latest-linux-arm64.yml",
  "SHA256SUMS.txt",
];

function sha512Base64(value: Buffer): string {
  return createHash("sha512").update(value).digest("base64");
}

function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The update-metadata shape electron-builder writes for one build leg. */
function updateMetadata(version: string, entries: Array<{ url: string; bytes: Buffer }>, extras = ""): string {
  return [
    "version: " + version,
    "files:",
    ...entries.flatMap((entry) => [
      "  - url: " + entry.url,
      "    sha512: " + sha512Base64(entry.bytes),
      "    size: " + entry.bytes.length,
      extras ? "    " + extras : "",
    ].filter(Boolean)),
    "path: " + entries[0].url,
    "sha512: " + sha512Base64(entries[0].bytes),
    "releaseDate: '2026-09-23T00:00:00.000Z'",
    "",
  ].join("\n");
}

type Proof = Record<string, any>;

function fixture(
  mutateProof: (proof: Proof) => void = () => {},
  options: { windowsSigned?: string } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "ima2-desktop-release-"));
  mkdirSync(join(directory, "signature-proof"));

  // Every name the release publishes, mapped to its payload bytes.
  const bytes = new Map<string, Buffer>();
  const put = (dir: string, name: string, payload = "bytes for " + name) => {
    const value = Buffer.from(payload);
    writeFileSync(join(dir, name), value);
    return value;
  };

  for (const name of INSTALLERS) bytes.set(name, put(directory, name, "signed bytes for " + name));
  for (const name of INSTALLERS) bytes.set(name + ".blockmap", put(directory, name + ".blockmap"));
  bytes.set("latest-mac.yml", Buffer.from(updateMetadata(VERSION, [
    { url: BASE + ".zip", bytes: bytes.get(BASE + ".zip")! },
    { url: BASE + ".dmg", bytes: bytes.get(BASE + ".dmg")! },
  ])));
  writeFileSync(join(directory, "latest-mac.yml"), bytes.get("latest-mac.yml")!);

  const marker = options.windowsSigned ?? "unsigned";
  for (const arch of WIN_ARCHES) {
    const dir = join(directory, "win-" + arch);
    mkdirSync(dir);
    const exe = `ima2-${VERSION}-win-${arch}.exe`;
    bytes.set(exe, put(dir, exe));
    bytes.set(exe + ".blockmap", put(dir, exe + ".blockmap"));
    writeFileSync(join(dir, "latest.yml"), updateMetadata(VERSION, [{ url: exe, bytes: bytes.get(exe)! }]));
    writeFileSync(join(dir, "signing-windows.txt"), marker);
  }
  for (const leg of LINUX_LEGS) {
    const dir = join(directory, "linux-" + leg.arch);
    mkdirSync(dir);
    bytes.set(leg.appImage, put(dir, leg.appImage));
    bytes.set(leg.deb, put(dir, leg.deb));

    bytes.set(leg.channel, Buffer.from(updateMetadata(VERSION, [
      { url: leg.appImage, bytes: bytes.get(leg.appImage)! },
      { url: leg.deb, bytes: bytes.get(leg.deb)! },
    ], "blockMapSize: 42")));
    writeFileSync(join(dir, leg.channel), bytes.get(leg.channel)!);
  }

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

  it("derives the public checksum list and notes for every shipped platform", () => {
    const run1 = fixture();
    try {
      const result = run(run1.directory);
      assert.deepEqual(result.publicAssets, EXPECTED_PUBLIC);

      // Every installer is lifted flat into dist for the release upload.
      for (const name of EXPECTED_PUBLIC.filter((name) => name !== "SHA256SUMS.txt")) {
        assert.ok(readFileSync(join(run1.directory, name)).length > 0, "missing flat asset " + name);
      }

      // Exact line membership, so a filename never has to survive regex escaping.
      const checksums = readFileSync(join(run1.directory, "SHA256SUMS.txt"), "utf8").split("\n").filter(Boolean);
      for (const [name, value] of run1.bytes) {
        assert.ok(checksums.includes(sha256Hex(value) + "  " + name), "no checksum line for " + name);
      }
      assert.equal(checksums.length, run1.bytes.size + 1, "only the published artifacts are listed");
      assert.ok(!checksums.some((line) => /report\.json|RELEASE_NOTES|signing-windows/.test(line)));

      const notes = readFileSync(join(run1.directory, "RELEASE_NOTES.md"), "utf8");
      assert.ok(notes.includes(SHA), "notes must record the build commit");
      assert.ok(notes.includes(TEAM), "notes must record the Apple Team ID");
      assert.match(notes, /Developer ID Application: Example/);
      assert.match(notes, /Architectures: arm64/);
      assert.match(notes, /Stapled notarization ticket: passed/);
      assert.match(notes, /not Authenticode signed/);
      assert.match(notes, /deb installs update through the package manager/);
    } finally {
      run1.cleanup();
    }
  });

  it("merges both Windows legs into one latest.yml the updater can pick an arch from", () => {
    const run1 = fixture();
    try {
      run(run1.directory);
      const merged = readFileSync(join(run1.directory, "latest.yml"), "utf8");
      assert.ok(merged.includes("url: ima2-" + VERSION + "-win-x64.exe"));
      assert.ok(merged.includes("url: ima2-" + VERSION + "-win-arm64.exe"));
      assert.ok(merged.includes("path: ima2-" + VERSION + "-win-x64.exe"));
      // Leg metadata stays internal; only the merged file publishes.
      const checksums = readFileSync(join(run1.directory, "SHA256SUMS.txt"), "utf8");
      assert.equal((checksums.match(/latest\.yml/g) ?? []).length, 1);
    } finally {
      run1.cleanup();
    }
  });

  it("labels the Windows installers signed only when both legs proved it", () => {
    const signed = fixture(() => {}, { windowsSigned: "signed" });
    try {
      run(signed.directory);
      const notes = readFileSync(join(signed.directory, "RELEASE_NOTES.md"), "utf8");
      assert.match(notes, /Authenticode signed/);
      assert.doesNotMatch(notes, /not Authenticode signed/);
    } finally {
      signed.cleanup();
    }

    const mixed = fixture();
    try {
      writeFileSync(join(mixed.directory, "win-arm64/signing-windows.txt"), "signed");
      assert.throws(() => run(mixed.directory), /disagree/);
    } finally {
      mixed.cleanup();
    }

    const missing = fixture();
    try {
      rmSync(join(missing.directory, "win-x64/signing-windows.txt"));
      assert.throws(() => run(missing.directory), /missing required file/);
    } finally {
      missing.cleanup();
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
      assert.throws(() => run(metadata.directory), /latest-mac\.yml version/);
    } finally {
      metadata.cleanup();
    }

    const duplicate = fixture();
    try {
      const path = join(duplicate.directory, "latest-mac.yml");
      writeFileSync(path, readFileSync(path, "utf8").replace("  - url: " + BASE + ".dmg", "  - url: " + BASE + ".zip"));
      assert.throws(() => run(duplicate.directory), /latest-mac\.yml files must contain exactly/);
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

  it("refuses Windows and Linux artifacts whose bytes drifted from their update metadata", () => {
    const tamperedExe = fixture();
    try {
      const path = join(tamperedExe.directory, "win-arm64/latest.yml");
      writeFileSync(path, readFileSync(path, "utf8").replace(/size: \d+/, "size: 1"));
      assert.throws(() => run(tamperedExe.directory), /win-arm64\/latest\.yml size mismatch/);
    } finally {
      tamperedExe.cleanup();
    }

    const tamperedAppImage = fixture();
    try {
      const path = join(tamperedAppImage.directory, "linux-arm64/latest-linux-arm64.yml");
      writeFileSync(path, readFileSync(path, "utf8").replace("version: " + VERSION, "version: 9.9.9"));
      assert.throws(() => run(tamperedAppImage.directory), /latest-linux-arm64\.yml version/);
    } finally {
      tamperedAppImage.cleanup();
    }

    const noAppImage = fixture();
    try {
      // A channel file that records only the deb is not updatable metadata.
      const path = join(noAppImage.directory, "linux-x64/latest-linux.yml");
      writeFileSync(path, readFileSync(path, "utf8")
        .replace(/  - url: [^\n]+AppImage\n(?:    [A-Za-z0-9]+: [^\n]+\n)+/, ""));
      assert.throws(() => run(noAppImage.directory), /must list/);
    } finally {
      noAppImage.cleanup();
    }

    const missingDeb = fixture();
    try {
      rmSync(join(missingDeb.directory, "linux-x64", `ima2-${VERSION}-linux-amd64.deb`));
      assert.throws(() => run(missingDeb.directory), /missing required file/);
    } finally {
      missingDeb.cleanup();
    }
  });
});
