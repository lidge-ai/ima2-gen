import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-character-bindings-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
const GENERATED_DIR = join(TEST_DIR, "generated");
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(join(GENERATED_DIR, "ref1.png"), "png!");
writeFileSync(join(GENERATED_DIR, "ref2.png"), "png!");
writeFileSync(join(GENERATED_DIR, "ref3.png"), "png!");

const store = await import("../lib/assetsStore.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function expectCode(fn: () => unknown, code: string, status: number) {
  assert.throws(fn, (error: unknown) => {
    const actual = error as { code?: string; status?: number };
    return actual.code === code && actual.status === status;
  });
}

function characterMetadata(overrides: Record<string, unknown> = {}) {
  return {
    elementKind: "character",
    name: "Hero",
    refs: ["ref1.png", "ref2.png"],
    ...overrides,
  };
}

function createCharacter(metadata: Record<string, unknown>) {
  return store.createAsset({ kind: "element", name: "Hero", metadata });
}

describe("character bindings contract (042)", () => {
  it("round-trips a runway stateless-refs binding with tag", () => {
    const asset = createCharacter(characterMetadata({
      characterBindings: [{ provider: "runway", mode: "stateless-refs", tag: "hero_01" }],
    }));
    const loaded = store.getElementById(asset.id);
    assert.deepEqual(loaded?.metadata?.characterBindings, [
      { provider: "runway", mode: "stateless-refs", tag: "hero_01" },
    ]);
  });

  it("rejects invalid combinations: runway trained-id, duplicate provider, >2 entries, non-character kind", () => {
    expectCode(
      () => createCharacter(characterMetadata({ characterBindings: [{ provider: "runway", mode: "trained-id" }] })),
      "INVALID_ELEMENT_METADATA", 400,
    );
    expectCode(
      () => createCharacter(characterMetadata({
        characterBindings: [
          { provider: "runway", mode: "stateless-refs" },
          { provider: "runway", mode: "stateless-refs", tag: "b" },
        ],
      })),
      "INVALID_ELEMENT_METADATA", 400,
    );
    expectCode(
      () => createCharacter(characterMetadata({
        characterBindings: [
          { provider: "runway", mode: "stateless-refs" },
          { provider: "higgsfield", mode: "trained-id" },
          { provider: "higgsfield", mode: "trained-id", externalId: "x" },
        ],
      })),
      "INVALID_ELEMENT_METADATA", 400,
    );
    expectCode(
      () => createCharacter(characterMetadata({
        elementKind: "product",
        characterBindings: [{ provider: "runway", mode: "stateless-refs" }],
      })),
      "INVALID_ELEMENT_METADATA", 400,
    );
  });

  it("rejects refs removal while a binding exists with 409 REFS_BOUND_TO_CHARACTER", () => {
    const asset = createCharacter(characterMetadata({
      refs: ["ref1.png", "ref2.png", "ref3.png"],
      characterBindings: [{ provider: "runway", mode: "stateless-refs" }],
    }));
    expectCode(
      () => store.updateAsset(asset.id, {
        metadata: characterMetadata({
          refs: ["ref1.png", "ref2.png"],
          characterBindings: [{ provider: "runway", mode: "stateless-refs" }],
        }),
      }),
      "REFS_BOUND_TO_CHARACTER", 409,
    );
  });

  it("allows refs removal when the same patch unlinks the bindings", () => {
    const asset = createCharacter(characterMetadata({
      refs: ["ref1.png", "ref2.png", "ref3.png"],
      characterBindings: [{ provider: "runway", mode: "stateless-refs" }],
    }));
    const updated = store.updateAsset(asset.id, {
      metadata: characterMetadata({ refs: ["ref1.png"] }),
    });
    assert.deepEqual((updated?.metadata as { refs: string[] }).refs, ["ref1.png"]);
    assert.equal(updated?.metadata?.characterBindings, undefined);
  });

  it("allows refs additions and reorders while keeping the binding", () => {
    const asset = createCharacter(characterMetadata({
      characterBindings: [{ provider: "runway", mode: "stateless-refs" }],
    }));
    const added = store.updateAsset(asset.id, {
      metadata: characterMetadata({
        refs: ["ref2.png", "ref1.png", "ref3.png"],
        characterBindings: [{ provider: "runway", mode: "stateless-refs" }],
      }),
    });
    assert.deepEqual((added?.metadata as { refs: string[] }).refs, ["ref2.png", "ref1.png", "ref3.png"]);
  });

  it("bindingDrift only fires for trained-id bindings whose snapshot differs from current refs", () => {
    const trained = {
      provider: "higgsfield" as const,
      mode: "trained-id" as const,
      externalId: "soul_1",
      trainedFromRefs: ["ref1.png", "ref2.png"],
    };
    assert.equal(store.bindingDrift(["ref1.png", "ref3.png"], trained), true);
    assert.equal(store.bindingDrift(["ref1.png"], trained), true);
    assert.equal(store.bindingDrift(["ref1.png", "ref2.png"], trained), false);
    assert.equal(
      store.bindingDrift(["ref1.png"], { provider: "runway", mode: "stateless-refs" }),
      false,
    );
  });
});
