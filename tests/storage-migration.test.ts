import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  getLegacyGeneratedCandidates,
  inspectGeneratedStorage,
  migrateGeneratedStorage,
} from "../lib/storageMigration.ts";

async function withTempDirs(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), "ima2-migrate-root-"));
  const targetDir = await mkdtemp(join(tmpdir(), "ima2-migrate-target-"));
  try {
    return await fn({ rootDir, targetDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(targetDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function makeCtx(rootDir, targetDir) {
  return {
    rootDir,
    config: {
      storage: {
        generatedDir: targetDir,
      },
    },
  };
}

test("legacy package generated assets are copied into the user data dir", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const legacyDir = join(rootDir, "generated");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "old.png"), "old");
    await writeFile(join(legacyDir, "old.png.json"), "{}");

    const ctx = makeCtx(rootDir, targetDir);
    const candidates = await getLegacyGeneratedCandidates(ctx);
    assert.ok(candidates.includes(resolve(legacyDir)));

    const result = await migrateGeneratedStorage(ctx, { legacyDirs: [legacyDir] });
    assert.equal(result.copied, 2);
    assert.equal(await readFile(join(targetDir, "old.png"), "utf8"), "old");
    assert.equal(await readFile(join(targetDir, "old.png.json"), "utf8"), "{}");
  });
});

test("migration is idempotent and never overwrites existing gallery files", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const legacyDir = join(rootDir, "generated");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "old.png"), "old");

    const ctx = makeCtx(rootDir, targetDir);
    const first = await migrateGeneratedStorage(ctx, { legacyDirs: [legacyDir] });
    assert.equal(first.copied, 1);

    await writeFile(join(targetDir, "old.png"), "kept");
    const second = await migrateGeneratedStorage(ctx, { legacyDirs: [legacyDir] });
    assert.equal(second.copied, 0);
    assert.equal(second.skippedExisting, 1);
    assert.equal(await readFile(join(targetDir, "old.png"), "utf8"), "kept");
  });
});

test("multiple legacy sources with the same filename copy only once", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const legacyA = join(rootDir, "generated-a");
    const legacyB = join(rootDir, "generated-b");
    await mkdir(legacyA, { recursive: true });
    await mkdir(legacyB, { recursive: true });
    await writeFile(join(legacyA, "same.png"), "from-a");
    await writeFile(join(legacyB, "same.png"), "from-b");
    await writeFile(join(legacyB, "other.png"), "other");

    const result = await migrateGeneratedStorage(makeCtx(rootDir, targetDir), {
      legacyDirs: [legacyA, legacyB],
    });

    assert.equal(result.copied, 2);
    assert.equal(result.skippedExisting, 1);
    assert.equal(await readFile(join(targetDir, "same.png"), "utf8"), "from-a");
    assert.equal(await readFile(join(targetDir, "other.png"), "utf8"), "other");
  });
});

test("nested legacy folders are copied once and skipped on repeat", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const nestedDir = join(rootDir, "generated", "session-1");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, "image.png"), "nested");

    const ctx = makeCtx(rootDir, targetDir);
    const first = await migrateGeneratedStorage(ctx, {
      legacyDirs: [join(rootDir, "generated")],
    });
    const second = await migrateGeneratedStorage(ctx, {
      legacyDirs: [join(rootDir, "generated")],
    });

    assert.equal(first.copied, 1);
    assert.equal(second.copied, 0);
    assert.equal(second.skippedExisting, 1);
    assert.equal(await readFile(join(targetDir, "session-1", "image.png"), "utf8"), "nested");
  });
});

test("card news generated sets are copied once and skipped on repeat", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const setDir = join(rootDir, "generated", "cardnews", "cs_test_release");
    await mkdir(setDir, { recursive: true });
    await writeFile(join(setDir, "manifest.json"), JSON.stringify({ setId: "cs_test_release" }));
    await writeFile(join(setDir, "card-01.json"), JSON.stringify({ cardId: "card-01" }));
    await writeFile(join(setDir, "card-01.png"), "png");

    const ctx = makeCtx(rootDir, targetDir);
    const first = await migrateGeneratedStorage(ctx, {
      legacyDirs: [join(rootDir, "generated")],
    });
    const second = await migrateGeneratedStorage(ctx, {
      legacyDirs: [join(rootDir, "generated")],
    });

    const migratedSetDir = join(targetDir, "cardnews", "cs_test_release");
    assert.equal(first.copied, 3);
    assert.equal(second.copied, 0);
    assert.equal(second.skippedExisting, 3);
    assert.equal(await readFile(join(migratedSetDir, "manifest.json"), "utf8"), JSON.stringify({ setId: "cs_test_release" }));
    assert.equal(await readFile(join(migratedSetDir, "card-01.json"), "utf8"), JSON.stringify({ cardId: "card-01" }));
    assert.equal(await readFile(join(migratedSetDir, "card-01.png"), "utf8"), "png");
  });
});

test("target and target-parent candidates are skipped to prevent recursive moves", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const sourceDir = join(rootDir, "generated");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "old.png"), "old");
    await writeFile(join(targetDir, "already.png"), "already");

    const result = await migrateGeneratedStorage(makeCtx(rootDir, targetDir), {
      legacyDirs: [targetDir, join(targetDir, "nested"), sourceDir],
    });

    assert.equal(result.sourcesSkipped, 2);
    assert.equal(result.copied, 1);
    assert.equal(await readFile(join(targetDir, "already.png"), "utf8"), "already");
    assert.equal(await readFile(join(targetDir, "old.png"), "utf8"), "old");
  });
});

test("candidate discovery includes npm prefix, appdata, npm-global, and version manager paths", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const ctx = makeCtx(rootDir, targetDir);
    const npmPrefix = join(rootDir, "prefix");
    const appData = join(rootDir, "AppData", "Roaming");
    const home = join(rootDir, "home");
    const candidates = await getLegacyGeneratedCandidates(ctx, {
      npm_config_prefix: npmPrefix,
      APPDATA: appData,
      IMA2_TEST_HOME: home,
    });

    assert.ok(candidates.includes(resolve(join(rootDir, "generated"))));
    assert.ok(candidates.includes(resolve(join(npmPrefix, "lib", "node_modules", "ima2-gen", "generated"))));
    assert.ok(candidates.includes(resolve(join(npmPrefix, "node_modules", "ima2-gen", "generated"))));
    assert.ok(candidates.includes(resolve(join(appData, "npm", "node_modules", "ima2-gen", "generated"))));
    assert.ok(candidates.includes(resolve(join(home, ".npm-global", "lib", "node_modules", "ima2-gen", "generated"))));
    assert.ok(candidates.includes(resolve(join(home, ".nvm", "versions", "node", process.version, "lib", "node_modules", "ima2-gen", "generated"))));
    assert.ok(candidates.includes(resolve(join(home, ".volta", "tools", "image", "packages", "ima2-gen", "lib", "node_modules", "ima2-gen", "generated"))));
    assert.ok(candidates.includes(resolve(join(home, ".fnm", "node-versions", process.version, "installation", "lib", "node_modules", "ima2-gen", "generated"))));
  });
});

test("candidate discovery covers Homebrew global installs when node resolves to Cellar", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const ctx = makeCtx(rootDir, targetDir);
    const candidates = await getLegacyGeneratedCandidates(ctx, {
      IMA2_TEST_EXEC_PATH: "/opt/homebrew/Cellar/node/25.2.1/bin/node",
      IMA2_TEST_ARGV1: "/opt/homebrew/bin/ima2",
    });

    assert.ok(candidates.includes(resolve("/opt/homebrew/lib/node_modules/ima2-gen/generated")));
    assert.ok(candidates.includes(resolve("/opt/homebrew/node_modules/ima2-gen/generated")));
  });
});

test("candidate discovery covers bun, yarn, pnpm, npx, and old node manager installs", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const ctx = makeCtx(rootDir, targetDir);
    const home = join(rootDir, "home");
    const localAppData = join(rootDir, "LocalAppData");
    const npmCache = join(rootDir, ".npm");
    const expected = [
      join(home, ".bun", "install", "global", "node_modules", "ima2-gen", "generated"),
      join(home, ".config", "yarn", "global", "node_modules", "ima2-gen", "generated"),
      join(home, "Library", "pnpm", "global", "5", "node_modules", "ima2-gen", "generated"),
      join(home, ".local", "share", "pnpm", "global", "5", "node_modules", "ima2-gen", "generated"),
      join(npmCache, "_npx", "abc123", "node_modules", "ima2-gen", "generated"),
      join(home, ".nvm", "versions", "node", "v22.0.0", "lib", "node_modules", "ima2-gen", "generated"),
      join(home, ".fnm", "node-versions", "v22.0.0", "installation", "lib", "node_modules", "ima2-gen", "generated"),
      join(home, ".asdf", "installs", "nodejs", "22.0.0", "lib", "node_modules", "ima2-gen", "generated"),
      join(home, ".local", "share", "mise", "installs", "node", "22.0.0", "lib", "node_modules", "ima2-gen", "generated"),
      join(localAppData, "Volta", "tools", "image", "packages", "ima2-gen", "lib", "node_modules", "ima2-gen", "generated"),
    ];
    for (const dir of expected) await mkdir(dir, { recursive: true });

    const candidates = await getLegacyGeneratedCandidates(ctx, {
      IMA2_TEST_HOME: home,
      LOCALAPPDATA: localAppData,
      npm_config_cache: npmCache,
    });

    for (const dir of expected) {
      assert.ok(candidates.includes(resolve(dir)), dir);
    }
  });
});

test("inspectGeneratedStorage summarizes recoverable and not_found states", async () => {
  await withTempDirs(async ({ rootDir, targetDir }) => {
    const home = join(rootDir, "home");
    const legacyDir = join(home, ".bun", "install", "global", "node_modules", "ima2-gen", "generated");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "old.png"), "old");

    const recoverable = await inspectGeneratedStorage(makeCtx(rootDir, targetDir), {
      env: { IMA2_TEST_HOME: home },
      legacyDirs: [legacyDir],
    });

    assert.equal(recoverable.state, "recoverable");
    assert.ok(recoverable.legacySourcesFound >= 1);
    assert.ok(recoverable.legacyFilesFound >= 1);

    await rm(legacyDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    const notFound = await inspectGeneratedStorage(makeCtx(rootDir, targetDir), {
      env: { IMA2_TEST_HOME: home },
      legacyDirs: [legacyDir],
    });
    assert.equal(notFound.state, "not_found");
    assert.equal(notFound.messageKind, "apology");
  });
});
