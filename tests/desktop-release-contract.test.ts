import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { readMacExpectations } from "../desktop/scripts/verify-mac-signature.mjs";

// Scope note: the signing gate itself is owned by desktop-signing-policy.test.ts.
// This file pins the multiplatform release asset contract the download site relies on.
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path: string): any {
  return parse(readFileSync(join(root, path), "utf8"));
}

function json(path: string): any {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function stepByName(steps: any[], name: string): any {
  const step = steps.find((candidate: any) => candidate.name === name);
  assert.ok(step, "missing workflow step: " + name);
  return step;
}

describe("multiplatform desktop release contract", () => {
  it("ships one installer per shipped architecture", () => {
    const config = read("desktop/electron-builder.yml");

    assert.deepEqual(config.mac.target, [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ]);
    // The release contract names per-arch NSIS installers and no Windows zip,
    // so every shipped Windows package is an updatable install.
    assert.deepEqual(config.win.target, ["nsis"]);
    assert.equal(config.nsis.buildUniversalInstaller, false,
      "a combined all-arch installer would not match the per-arch asset contract");
    assert.deepEqual(config.linux.target, ["AppImage", "deb"]);
    // A configured `arch:` list overrides the --x64/--arm64 flag a matrix leg
    // passes, so win/linux targets must leave it unset. macOS keeps an explicit
    // arch because it always ships arm64 regardless of the runner.
    for (const platform of ["win", "linux"]) {
      for (const target of config[platform].target) {
        assert.equal(typeof target === "string" ? undefined : target.arch, undefined);
      }
    }
    // electron-builder's ${os}/${arch} expansion is what produces the contract
    // names: win-x64/win-arm64.exe, linux-x86_64/linux-arm64.AppImage and
    // linux-amd64/linux-arm64.deb.
    assert.equal(config.artifactName, "${productName}-${version}-${os}-${arch}.${ext}");
  });

  it("derives the verified architectures from the builder config, not a second list", () => {
    // Widening distribution must not require editing the verifier: this is the
    // single place that decides what gets built and what gets proved.
    assert.deepEqual(readMacExpectations(root).expectedArchitectures, ["arm64"]);
    assert.equal(readMacExpectations(root).expectedVersion, json("package.json").version);
  });

  it("points the updater at draft GitHub releases under the desktop tag prefix", () => {
    const config = read("desktop/electron-builder.yml");

    assert.deepEqual(config.publish, {
      provider: "github",
      owner: "lidge-ai",
      repo: "ima2-gen",
      releaseType: "draft",
      tagNamePrefix: "desktop-v",
    });
    assert.equal(config.electronUpdaterCompatibility, ">=2.16");
  });

  it("keeps the updater in the packaged app and never lets the builder publish", () => {
    // directories.app points at the repository root, so the root manifest is the
    // packaged app: it owns both the runtime dependency and the shipped version.
    assert.equal(read("desktop/electron-builder.yml").directories.app, "..");
    assert.equal(json("package.json").dependencies["electron-updater"], "6.8.9");
    assert.equal(json("desktop/package.json").dependencies?.["electron-updater"], undefined);
    for (const script of ["dist", "dist:mac", "dist:win", "dist:linux"]) {
      assert.match(json("desktop/package.json").scripts[script], /--publish never/);
    }
  });

  it("binds the release tag to the packaged app version, not the build toolchain", () => {
    const draft = read(".github/workflows/desktop.yml").jobs.draft_release;
    const validation = stepByName(draft.steps, "Validate desktop release tag");

    assert.match(validation.run, /require\('\.\/package\.json'\)\.version/);
    assert.doesNotMatch(validation.run, /desktop\/package\.json/);
    assert.match(validation.run, /EXPECTED_TAG="desktop-v\$\{VERSION\}"/);
    assert.match(validation.run, /GITHUB_REF_NAME/);
    assert.match(validation.run, /exit 1/);
  });

  it("publishes exactly the multiplatform asset set and keeps the proof internal", () => {
    const workflow = read(".github/workflows/desktop.yml");
    const draft = workflow.jobs.draft_release;

    const downloads = draft.steps.filter((step: any) => step.uses?.startsWith("actions/download-artifact@"));
    assert.deepEqual(downloads.map((step: any) => step.with.name), [
      "ima2-desktop-mac-arm64",
      "ima2-desktop-win-x64",
      "ima2-desktop-win-arm64",
      "ima2-desktop-linux-x64",
      "ima2-desktop-linux-arm64",
      "ima2-macos-signature-proof",
    ]);

    const upload = stepByName(draft.steps, "Create or update draft release").run;
    for (const suffix of [".dmg", ".zip", ".dmg.blockmap", ".zip.blockmap"]) {
      assert.ok(upload.includes("mac-arm64" + suffix), "draft must upload " + suffix);
    }
    for (const name of ["win-x64.exe", "win-arm64.exe", "win-x64.exe.blockmap", "win-arm64.exe.blockmap"]) {
      assert.ok(upload.includes(name), "draft must upload " + name);
    }
    for (const name of ["linux-x86_64.AppImage", "linux-arm64.AppImage", "linux-amd64.deb", "linux-arm64.deb"]) {
      assert.ok(upload.includes(name), "draft must upload " + name);
    }
    for (const name of ["latest-mac.yml", "latest.yml", "latest-linux.yml", "latest-linux-arm64.yml", "SHA256SUMS.txt"]) {
      assert.ok(upload.includes("desktop/dist/" + name), "draft must upload " + name);
    }
    // A wildcard would quietly publish whatever else landed in dist.
    assert.doesNotMatch(upload, /desktop\/dist\/\*/);
    assert.doesNotMatch(upload, /report\.json|signature-proof/);
  });
});
