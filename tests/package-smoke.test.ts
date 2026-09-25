import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePackOutput } from "../scripts/release-artifact-contract.mjs";
import { spawnNpmSync } from "../scripts/npm-subprocess.mjs";

const REQUIRED_SOURCE_PACK_FILES = [
  "LICENSE",
  "README.md",
  "docs/RECOVER_OLD_IMAGES.md",
  "server.js",
  "config.js",
  "routes/cardNews.js",
  "routes/metadata.js",
  "routes/storage.js",
  "integrations/comfyui/ima2_gen_bridge/__init__.py",
  "integrations/comfyui/ima2_gen_bridge/nodes.py",
  "integrations/comfyui/ima2_gen_bridge/README.md",
  "lib/cardNewsTemplateStore.js",
  "lib/imageMetadata.js",
  "lib/imageMetadataStore.js",
  "lib/openDirectory.js",
  "lib/storageMigration.js",
  "bin/ima2.js",
  "bin/lib/storage-doctor.js",
  "skills/ima2/SKILL.md",
  "skills/ima2-front/SKILL.md",
  "skills/ima2-front/references/anti-slop.md",
  "skills/ima2-uiux/SKILL.md",
  "skills/ima2-uiux/references/design-isms.md",
  "assets/card-news/templates/academy-lesson-square/template.json",
  "assets/card-news/templates/academy-lesson-square/base.png",
  "assets/card-news/templates/academy-lesson-square/preview.png",
  "assets/card-news/templates/clean-report-square/template.json",
  "assets/card-news/templates/clean-report-square/base.png",
  "assets/card-news/templates/clean-report-square/preview.png",
  "assets/mcp-snapshots/README.md",
  "assets/mcp-snapshots/runway.sanitized.json",
  "assets/mcp-snapshots/higgsfield.sanitized.json",
];

const REQUIRED_BUILD_PACK_FILES = [
  "ui/dist/index.html",
];

const REQUIRED_RUNTIME_PACK_FILES = [
  "server.js",
  "config.js",
  "bin/ima2.js",
  "routes/cardNews.js",
  "routes/storage.js",
  "lib/cardNewsTemplateStore.js",
];

let cachedPackManifest = null;

function readPackManifest() {
  if (cachedPackManifest) return cachedPackManifest;
  const packDestination = mkdtempSync(join(tmpdir(), "ima2-pack-smoke-"));
  try {
    const result = spawnNpmSync(["pack", "--dry-run", "--json", "--ignore-scripts", "--pack-destination", packDestination], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_loglevel: "silent",
      },
    });

    assert.strictEqual(
      result.status,
      0,
      `npm pack --dry-run failed\nerror:\n${result.error?.message || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
    );

    try {
      cachedPackManifest = parsePackOutput(result.stdout);
      return cachedPackManifest;
    } catch (error: any) {
      assert.fail(`Could not parse npm pack --dry-run --json output: ${error.message}`);
    }
  } finally {
    rmSync(packDestination, { recursive: true, force: true });
  }
}

describe("package smoke", () => {
  it("keeps publish dry-run from re-entering prepublishOnly smoke tests", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const script = readFileSync(join(process.cwd(), "scripts/publish-dry-run.mjs"), "utf8");

    assert.equal(pkg.scripts["publish:dry-run"], "node scripts/publish-dry-run.mjs");
    assert.match(script, /"publish", "--dry-run", "--ignore-scripts"/);
    assert.match(script, /previously published versions/);
  });

  it("includes release-critical source files in npm pack output", () => {
    const manifest = readPackManifest();
    const packedFiles = new Set(manifest.files.map((file) => file.path));

    for (const requiredFile of REQUIRED_SOURCE_PACK_FILES) {
      assert.ok(
        packedFiles.has(requiredFile),
        `npm package should include ${requiredFile}`,
      );
    }
  });

  it("includes built UI files when build output exists", () => {
    const manifest = readPackManifest();
    const packedFiles = new Set(manifest.files.map((file) => file.path));

    for (const requiredFile of REQUIRED_BUILD_PACK_FILES) {
      assert.ok(
        packedFiles.has(requiredFile),
        `npm package should include ${requiredFile}`,
      );
    }
  });

  it("includes emitted runtime JavaScript files for package execution", () => {
    const manifest = readPackManifest();
    const packedFiles = new Set(manifest.files.map((file) => file.path));

    for (const requiredFile of REQUIRED_RUNTIME_PACK_FILES) {
      assert.ok(
        packedFiles.has(requiredFile),
        `npm package should include emitted runtime file ${requiredFile}`,
      );
    }
  });

  it("excludes UI sourcemaps from normal release packages", () => {
    const manifest = readPackManifest();
    const mapFiles = manifest.files
      .map((file) => file.path)
      .filter((path) => path.startsWith("ui/dist/") && path.endsWith(".map"));

    assert.deepEqual(mapFiles, [], "normal npm package should not include ui/dist sourcemaps");
  });

  it("excludes docs screenshots, test assets, and Python caches from release packages", () => {
    const manifest = readPackManifest();
    const packedFiles = manifest.files.map((file) => file.path);
    const packedFileSet = new Set(packedFiles);

    assert.ok(!packedFileSet.has("assets/screenshot.png"));
    assert.ok(!packedFileSet.has("assets/phase-a-bg-cleanup-test.png"));
    assert.ok(!packedFiles.some((path) => path.startsWith("assets/screenshots/")));
    assert.ok(!packedFiles.some((path) => path.includes("__pycache__")));
    assert.ok(!packedFiles.some((path) => path.endsWith(".pyc")));
  });
});
