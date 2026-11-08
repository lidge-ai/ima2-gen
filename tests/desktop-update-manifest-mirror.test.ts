import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mirrorManifests, rewriteManifest } from "../scripts/mirror-desktop-update-manifests.mjs";

const MAC = [
  "version: 3.26.0",
  "files:",
  "  - url: ima2-3.26.0-mac-arm64.zip",
  "    sha512: abc==",
  "    size: 1",
  "  - url: ima2-3.26.0-mac-arm64.dmg",
  "    sha512: def==",
  "    size: 2",
  "path: ima2-3.26.0-mac-arm64.zip",
  "sha512: abc==",
  "releaseDate: '2026-09-30T15:10:10.055Z'",
  "",
].join("\n");

// electron-updater 6.8.11 GitHubProvider.resolveFiles + util.newUrlFromBase.
function providerUrl(tag: string, fileUrl: string): string {
  return new URL("/lidge-ai/ima2-gen/releases/download/" + tag + "/" + fileUrl.replace(/ /g, "-"), "https://github.com").href;
}

test("rewrites every file url and path into the desktop release, keeping checksums", () => {
  const out = rewriteManifest(MAC, "desktop-v3.26.0");
  assert.match(out, /^  - url: \.\.\/desktop-v3\.26\.0\/ima2-3\.26\.0-mac-arm64\.zip$/m);
  assert.match(out, /^  - url: \.\.\/desktop-v3\.26\.0\/ima2-3\.26\.0-mac-arm64\.dmg$/m);
  assert.match(out, /^path: \.\.\/desktop-v3\.26\.0\/ima2-3\.26\.0-mac-arm64\.zip$/m);
  assert.match(out, /^version: 3\.26\.0$/m);
  assert.equal(out.match(/sha512: abc==/g)?.length, 2);
  assert.equal(
    providerUrl("v3.26.0", "../desktop-v3.26.0/ima2-3.26.0-mac-arm64.zip"),
    "https://github.com/lidge-ai/ima2-gen/releases/download/desktop-v3.26.0/ima2-3.26.0-mac-arm64.zip",
  );
});

test("refuses bad tags, nested paths and manifests without files", () => {
  assert.throws(() => rewriteManifest(MAC, "v3.26.0"), /desktop-vX\.Y\.Z/);
  assert.throws(() => rewriteManifest(MAC.replace("url: ima2-3.26.0-mac-arm64.dmg", "url: sub/x.dmg"), "desktop-v3.26.0"), /bare name/);
  assert.throws(() => rewriteManifest("version: 3.26.0\n", "desktop-v3.26.0"), /no url or path/);
});

test("mirrors only latest*.yml manifests into the output directory", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-mirror-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  writeFileSync(join(dir, "latest-mac.yml"), MAC);
  writeFileSync(join(dir, "latest-linux-arm64.yml"), MAC.replaceAll("mac-arm64.zip", "linux-arm64.AppImage"));
  writeFileSync(join(dir, "SHA256SUMS.txt"), "ignored");
  const out = join(dir, "out");
  assert.deepEqual(mirrorManifests(dir, out, "desktop-v3.26.0"), ["latest-linux-arm64.yml", "latest-mac.yml"]);
  assert.match(readFileSync(join(out, "latest-linux-arm64.yml"), "utf8"), /^path: \.\.\/desktop-v3\.26\.0\/ima2-3\.26\.0-linux-arm64\.AppImage$/m);
});

