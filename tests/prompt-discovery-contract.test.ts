import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchGitHubDiscovery } from "../lib/promptImport/githubDiscovery.ts";
import {
  listDiscoveryCandidates,
  listReviewedDiscoverySources,
  reviewDiscoveryCandidate,
  upsertDiscoveryCandidates,
} from "../lib/promptImport/discoveryRegistry.ts";
import { getPromptImportSources } from "../lib/promptImport/promptIndex.ts";

const root = process.cwd();
const originalFetch = globalThis.fetch;
const tempDirs = [];

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

async function testCtx() {
  const dir = await mkdtemp(join(tmpdir(), "ima2-discovery-"));
  tempDirs.push(dir);
  return {
    config: {
      github: { token: "ghp_secret" },
      storage: {
        promptImportDiscoveryRegistryFile: join(dir, "prompt-import-discovery.json"),
        promptImportIndexCacheFile: join(dir, "prompt-import-index.json"),
      },
      limits: {
        promptImportFetchTimeoutMs: 8000,
        promptImportDiscoverySearchLimit: 20,
        promptImportDiscoveryMaxQueries: 5,
        promptImportMaxRepoIndexFiles: 500,
        promptImportMaxFileBytes: 512 * 1024,
        promptImportMaxCandidatesPerFile: 100,
        promptImportMaxCandidatesPerImport: 100,
        promptImportMaxCandidateChars: 12000,
        promptImportMinCandidateChars: 40,
        promptImportMaxSourceCharsScanned: 512 * 1024,
        promptImportCuratedSearchLimit: 50,
        promptImportIndexCacheTtlMs: 24 * 60 * 60 * 1000,
      },
    },
  };
}

function repo(overrides = {}) {
  return {
    full_name: "openai/example-prompts",
    html_url: "https://github.com/openai/example-prompts",
    description: "GPT image generation prompt examples",
    default_branch: "main",
    stargazers_count: 1200,
    forks_count: 12,
    open_issues_count: 1,
    updated_at: "2026-04-01T00:00:00Z",
    pushed_at: "2026-04-01T00:00:00Z",
    license: { spdx_id: "MIT" },
    topics: ["prompt", "image-generation"],
    language: "Markdown",
    archived: false,
    disabled: false,
    fork: false,
    ...overrides,
  };
}

describe("prompt discovery contract", () => {
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
  });

  it("registers discovery routes and keeps search separate from commit", () => {
    const route = readSource("routes/promptImport.ts");
    const discovery = readSource("lib/promptImport/githubDiscovery.ts");
    assert.match(route, /\/api\/prompts\/import\/discovery/);
    assert.match(route, /\/api\/prompts\/import\/discovery-search/);
    assert.match(route, /\/api\/prompts\/import\/discovery-review/);
    assert.match(route, /searchGitHubDiscovery/);
    assert.doesNotMatch(discovery, /commitCandidates/);
    assert.doesNotMatch(discovery, /commitPromptImport/);
  });

  it("uses api.github.com search with server-only token and returns no token", async () => {
    const ctx = await testCtx();
    let requestedUrl = "";
    let authHeader = "";
    globalThis.fetch = (async (url, init) => {
      requestedUrl = String(url);
      authHeader = init.headers.Authorization;
      return {
        ok: true,
        status: 200,
        url: "https://api.github.com/search/repositories?q=x",
        headers: new Headers({ "x-ratelimit-remaining": "9", "x-ratelimit-limit": "10" }),
        json: async () => ({ items: [repo()] }),
      };
    }) as unknown as typeof fetch;
    const result = await searchGitHubDiscovery(ctx, { q: "gpt-image-2 prompt", seeds: [], limit: 1 });
    assert.match(requestedUrl, /^https:\/\/api\.github\.com\/search\/repositories/);
    assert.equal(authHeader, "Bearer ghp_secret");
    assert.equal(result.candidates.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /ghp_secret/);
  });

  it("maps rate limits and rejects redirected discovery fetches", async () => {
    const ctx = await testCtx();
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      url: "https://api.github.com/search/repositories",
      headers: new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1770000000" }),
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await assert.rejects(() => searchGitHubDiscovery(ctx, { q: "prompt" }), /rate limit/);

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      url: "https://api.github.com.evil.test/search/repositories",
      headers: new Headers(),
      json: async () => ({ items: [] }),
    })) as unknown as typeof fetch;
    await assert.rejects(() => searchGitHubDiscovery(ctx, { q: "prompt" }), /unsupported host/);
  });

  it("persists discovery candidates atomically and reviews approved sources", async () => {
    const ctx = await testCtx();
    await upsertDiscoveryCandidates(ctx, [{
      id: "github:openai/example-prompts",
      repo: "openai/example-prompts",
      owner: "openai",
      name: "example-prompts",
      fullName: "openai/example-prompts",
      htmlUrl: "https://github.com/openai/example-prompts",
      description: "Image prompt examples",
      defaultBranch: "main",
      stars: 10,
      forks: 1,
      openIssues: 0,
      updatedAt: "2026-04-01T00:00:00Z",
      pushedAt: "2026-04-01T00:00:00Z",
      licenseSpdx: "MIT",
      topics: ["prompt"],
      language: "Markdown",
      score: 20,
      scoreReasons: ["prompt-like"],
      warnings: [],
      status: "candidate",
      query: "prompt",
      discoveredAt: "2026-04-28T00:00:00Z",
    }]);
    const result = await reviewDiscoveryCandidate(ctx, {
      repo: "openai/example-prompts",
      status: "approved",
      allowedPaths: ["README.md"],
      defaultSearch: true,
    });
    assert.equal(result.source.trustTier, "reviewed");
    assert.equal(result.source.defaultSearch, true);
    assert.equal((await listReviewedDiscoverySources(ctx)).length, 1);
    assert.match(await readFile(ctx.config.storage.promptImportDiscoveryRegistryFile, "utf8"), /example-prompts/);
  });

  it("rejects invalid allowedPaths and keeps empty approved sources out of default search", async () => {
    const ctx = await testCtx();
    await upsertDiscoveryCandidates(ctx, [{
      ...repo(),
      id: "github:openai/example-prompts",
      repo: "openai/example-prompts",
      owner: "openai",
      name: "example-prompts",
      fullName: "openai/example-prompts",
      htmlUrl: "https://github.com/openai/example-prompts",
      defaultBranch: "main",
      licenseSpdx: "MIT",
      stars: 1,
      forks: 0,
      openIssues: 0,
      score: 1,
      scoreReasons: [],
      warnings: [],
      status: "candidate",
      query: "prompt",
      discoveredAt: "2026-04-28T00:00:00Z",
    }]);
    await assert.rejects(
      () => reviewDiscoveryCandidate(ctx, { repo: "openai/example-prompts", status: "approved", allowedPaths: ["../README.md"] }),
      /traversal/,
    );
    await assert.rejects(
      () => reviewDiscoveryCandidate(ctx, { repo: "openai/example-prompts", status: "approved", allowedPaths: ["https://example.com/a.md"] }),
      /repo-relative/,
    );
    await assert.rejects(
      () => reviewDiscoveryCandidate(ctx, { repo: "openai/example-prompts", status: "approved", allowedPaths: ["README.json"] }),
      /\.md/,
    );
    const result = await reviewDiscoveryCandidate(ctx, {
      repo: "openai/example-prompts",
      status: "approved",
      allowedPaths: [],
      defaultSearch: true,
    });
    assert.equal(result.source.defaultSearch, false);
    assert.ok(result.warnings.includes("discovery-requires-paths"));
  });

  it("keeps slash default branches out of default search and merges reviewed sources in source list", async () => {
    const ctx = await testCtx();
    await upsertDiscoveryCandidates(ctx, [{
      id: "github:openai/slash-branch-prompts",
      repo: "openai/slash-branch-prompts",
      owner: "openai",
      name: "slash-branch-prompts",
      fullName: "openai/slash-branch-prompts",
      htmlUrl: "https://github.com/openai/slash-branch-prompts",
      description: "Image prompt examples",
      defaultBranch: "release/main",
      stars: 10,
      forks: 1,
      openIssues: 0,
      updatedAt: "2026-04-01T00:00:00Z",
      pushedAt: "2026-04-01T00:00:00Z",
      licenseSpdx: "MIT",
      topics: ["prompt"],
      language: "Markdown",
      score: 20,
      scoreReasons: ["prompt-like"],
      warnings: [],
      status: "candidate",
      query: "prompt",
      discoveredAt: "2026-04-28T00:00:00Z",
    }]);
    const reviewed = await reviewDiscoveryCandidate(ctx, {
      repo: "openai/slash-branch-prompts",
      status: "approved",
      allowedPaths: ["README.md"],
      defaultSearch: true,
    });
    assert.equal(reviewed.source.defaultSearch, false);
    assert.ok(reviewed.warnings.includes("discovery-default-branch-unsupported"));
    const sources = await getPromptImportSources(ctx);
    assert.ok(sources.sources.some((source) => source.id === reviewed.source.id));
  });

  it("hides rejected candidates from reviewed sources while keeping them in the queue", async () => {
    const ctx = await testCtx();
    await upsertDiscoveryCandidates(ctx, [{
      ...repo(),
      id: "github:openai/rejected-prompts",
      repo: "openai/rejected-prompts",
      owner: "openai",
      name: "rejected-prompts",
      fullName: "openai/rejected-prompts",
      status: "candidate",
      score: 1,
      scoreReasons: [],
      warnings: [],
      query: "prompt",
      discoveredAt: "2026-04-28T00:00:00Z",
    }]);
    await reviewDiscoveryCandidate(ctx, { repo: "openai/rejected-prompts", status: "rejected" });
    assert.equal((await listReviewedDiscoverySources(ctx)).length, 0);
    assert.equal((await listDiscoveryCandidates(ctx, { status: "rejected" })).length, 1);
  });
});
