import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byKeyVocabulary, REGISTRY } from "../lib/providers/registry.ts";
import {
  deriveCliImageModelSetFrom,
  deriveIdsFrom,
  deriveImageModelSetFrom,
  deriveModelsFrom,
  deriveReferenceLimitMapFrom,
} from "../lib/providers/deriveCore.ts";
import type { CoreProviderManifestBase } from "../lib/providers/types.ts";

describe("core provider registry contract", () => {
  it("contains exactly one manifest for every core lane", () => {
    const ids = REGISTRY.map((provider) => provider.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, [
      "oauth", "api", "grok", "grok-api", "agy", "gemini-api", "atlascloud", "88api", "minimax", "nai", "comfy",
    ]);
  });

  it("uses scanner-safe optional error prefixes", () => {
    for (const provider of REGISTRY) {
      if (provider.errorPrefix !== null) {
        assert.match(provider.errorPrefix, /^[A-Z][A-Z0-9_]*_$/);
      }
    }
  });

  it("represents credential shapes without assigning keys to proxy lanes", () => {
    assert.deepEqual(byKeyVocabulary("openai").map((provider) => provider.id), ["api"]);
    assert.deepEqual(byKeyVocabulary("xai").map((provider) => provider.id), ["grok-api"]);
    assert.deepEqual(byKeyVocabulary("gemini").map((provider) => provider.id), ["gemini-api"]);
    const gemini = REGISTRY.find((provider) => provider.id === "gemini-api")!;
    assert.deepEqual(gemini.credentials.map((credential) => credential.kind), ["api-key", "service-account"]);
    const agy = REGISTRY.find((provider) => provider.id === "agy")!;
    assert.equal(agy.credentials[0].kind, "local-cli");
    assert.equal(agy.credentials[0].optionalApiKeyEnv, "GEMINI_API_KEY");
    for (const provider of REGISTRY) {
      for (const credential of provider.credentials) {
        // A first-party "oauth" credential is file-backed by construction, so
        // requiring an env var would force a fake one into the manifest.
        if (credential.kind === "oauth") assert.ok(credential.authFile.length > 0);
        else assert.ok(credential.envVars.length > 0);
        if (credential.kind === "api-key") assert.ok(credential.keyVocabulary);
      }
    }
  });
});

// d5: adding a lane to the manifest alone must flow through the derived
// consumers. The fixture is fed to the same derive functions the production
// consumers call, so this fails if any consumer stops reading the registry.
const manifestOnlyLane = [
  ...REGISTRY,
  {
    id: "test-lane",
    surfaces: ["generate", "edit", "video"],
    vendor: "openai",
    credentials: [],
    models: [
      { id: "test-image", kind: "image", supports: { generate: true, edit: true, mask: false, streaming: false } },
      { id: "test-video", kind: "video", supports: { generate: true, edit: false, mask: false, streaming: false } },
    ],
    referenceLimits: { image: 2 },
    elementTaxonomy: null,
    limits: { timeoutMs: 1 },
    errorPrefix: "TEST_",
  },
] as const satisfies readonly CoreProviderManifestBase[];

type ManifestOnlyId = (typeof manifestOnlyLane)[number]["id"];

describe("manifest-only lane reaches the derived consumers (d5)", () => {
  it("types the new id without editing a hand-written union", () => {
    const manifestOnlyId: ManifestOnlyId = "test-lane";
    assert.equal(manifestOnlyId, "test-lane");
  });

  it("appears in derived ids, model sets, and reference limits", () => {
    assert.ok(deriveIdsFrom(manifestOnlyLane).includes("test-lane"));
    assert.deepEqual([...deriveModelsFrom(manifestOnlyLane, "test-lane", "image")], ["test-image"]);
    assert.deepEqual([...deriveModelsFrom(manifestOnlyLane, "test-lane", "video")], ["test-video"]);
    assert.ok(deriveImageModelSetFrom(manifestOnlyLane).has("test-image"));
    assert.ok(deriveCliImageModelSetFrom(manifestOnlyLane).has("test-image"));
    assert.equal(deriveReferenceLimitMapFrom(manifestOnlyLane, "image")["test-lane"], 2);
  });

  it("keeps the production registry unchanged by the fixture", () => {
    assert.equal(deriveIdsFrom(REGISTRY).includes("test-lane" as never), false);
  });
});
