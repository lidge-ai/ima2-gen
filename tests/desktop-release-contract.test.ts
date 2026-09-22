import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { readMacExpectations } from "../desktop/scripts/verify-mac-signature.mjs";

// Scope note: the signing gate itself is owned by desktop-signing-policy.test.ts.
// This file pins what makes the release Apple Silicon only and updatable.
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

describe("Apple Silicon desktop release contract", () => {
  it("ships arm64 macOS only while keeping other platforms configured but dormant", () => {
    const config = read("desktop/electron-builder.yml");

    assert.deepEqual(config.mac.target, [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ]);
    assert.ok(config.win, "Windows packaging config stays available for a later widening");
    assert.ok(config.linux, "Linux packaging config stays available for a later widening");
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
      owner: "lidge-jun",
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

  it("publishes exactly the Apple Silicon asset set and keeps the proof internal", () => {
    const workflow = read(".github/workflows/desktop.yml");
    const draft = workflow.jobs.draft_release;

    const downloads = draft.steps.filter((step: any) => step.uses?.startsWith("actions/download-artifact@"));
    assert.deepEqual(downloads.map((step: any) => step.with.name), ["ima2-desktop-mac", "ima2-macos-signature-proof"]);

    const upload = stepByName(draft.steps, "Create or update draft release").run;
    for (const suffix of [".dmg", ".zip", ".dmg.blockmap", ".zip.blockmap"]) {
      assert.ok(upload.includes("mac-arm64" + suffix), "draft must upload " + suffix);
    }
    assert.match(upload, /desktop\/dist\/latest-mac\.yml/);
    assert.match(upload, /desktop\/dist\/SHA256SUMS\.txt/);
    // A wildcard would quietly publish whatever else landed in dist.
    assert.doesNotMatch(upload, /desktop\/dist\/\*/);
    assert.doesNotMatch(upload, /report\.json|signature-proof|\.exe|\.AppImage|\.deb/);
  });
});
