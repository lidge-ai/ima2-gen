import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI capabilities contract", () => {
  it("server route exposes capabilities through an allowlisted builder", () => {
    const route = readSource("routes/capabilities.ts");
    const index = readSource("routes/index.ts");

    assert.match(route, /app\.get\("\/api\/capabilities"/);
    assert.match(route, /buildIma2Capabilities/);
    assert.doesNotMatch(route, /res\.json\(ctx\.config\)/);
    assert.match(index, /registerCapabilitiesRoutes/);
  });

  it("capability payload separates supported values and enforced limits", () => {
    const src = readSource("lib/capabilities.ts");

    assert.match(src, /supported:\s*toArray\(appConfig\.imageModels\.valid\)/);
    assert.match(src, /unsupported:\s*toArray\(appConfig\.imageModels\.unsupported\)/);
    assert.match(src, /reasoningEfforts:\s*toArray\(appConfig\.imageModels\.validReasoningEfforts\)/);
    assert.match(src, /quality:\s*toArray\(VALID_IMAGE_QUALITIES\)/);
    assert.match(src, /moderation:\s*toArray\(appConfig\.oauth\.validModeration\)/);
    assert.match(src, /modes:\s*\[\.\.\.VALID_MODES\]/);
    assert.match(src, /providers:\s*\[\.\.\.VALID_PROVIDERS\]/);
    assert.match(src, /const VALID_PROVIDERS = \["auto", \.\.\.deriveProviderIds\(\)\]/);
    assert.match(src, /"grok status"/);
    assert.match(src, /"prompt build"/);
    assert.match(src, /configKeys:/);
    assert.match(src, /maxGeneratedImages:\s*appConfig\.limits\.maxGeneratedImages/);
    assert.match(src, /enforced:\s*true/);
    assert.match(src, /server-side inflight capacity guard/);
    assert.match(src, /supported:\s*\["grok-imagine-video", "grok-imagine-video-1\.5"\]/);
    // Both aliases GET /v1/video-generation-models reports must fold onto the canonical id.
    assert.match(src, /"grok-imagine-video-1\.5-preview":\s*"grok-imagine-video-1\.5"/);
    assert.match(src, /"grok-imagine-video-1\.5-2026-05-30":\s*"grok-imagine-video-1\.5"/);
    assert.match(src, /resolutions:\s*\["480p", "720p", "1080p"\]/);
    assert.match(src, /resolutionNotes:\s*\{ "1080p": "grok-imagine-video-1\.5 text-to-video canvas shim or image-to-video; reference-to-video unsupported" \}/);
  });

  it("capabilities marks Agent Mode as web-UI only while exposing Grok defaults", () => {
    const src = readSource("lib/capabilities.ts");

    assert.match(src, /grok:\s*\{/);
    assert.match(src, /defaultImageModel/);
    assert.match(src, /plannerModel/);
    assert.match(src, /agentMode:\s*\{/);
    assert.match(src, /uiOnly:\s*true/);
    assert.match(src, /cliCommand:\s*null/);
  });

  it("capabilities command wires server discovery and local metadata", () => {
    const src = readSource("bin/commands/capabilities.ts");

    assert.match(src, /--require-server/);
    assert.match(src, /localCapabilities\(\)/);
    assert.match(src, /request\(server\.base, "\/api\/capabilities"/);
    // Fallback/auth behavior is exercised through the command in cli-lan-auth.test.ts.
  });
});
