import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldOpenStarPrompt, type StarPromptInput } from "../ui/src/lib/githubStar.ts";

const base: StarPromptInput = {
  status: { state: "not-starred", prompted: false, repo: "lidge-jun/ima2-gen", url: "https://github.com/lidge-jun/ima2-gen" },
  head: { createdAt: 2_000, mediaType: "image" },
  mountedAt: 1_000,
  settingsOpen: false,
  readinessOpen: false,
};

test("star prompt opens after the first image made in this session", () => {
  assert.equal(shouldOpenStarPrompt(base), true);
  assert.equal(shouldOpenStarPrompt({ ...base, status: { ...base.status!, state: "unauthenticated" } }), true);
});

test("star prompt stays closed for answered, starred, unreadable or busy states", () => {
  const cases: Array<[string, Partial<StarPromptInput>]> = [
    ["status read failed (LAN 403)", { status: null }],
    ["already prompted", { status: { ...base.status!, prompted: true } }],
    ["already starred", { status: { ...base.status!, state: "starred" } }],
    ["history loaded from before this session", { head: { createdAt: 500, mediaType: "image" } }],
    ["no history", { head: null }],
    ["video result", { head: { createdAt: 2_000, mediaType: "video" } }],
    ["settings open", { settingsOpen: true }],
    ["readiness popup open", { readinessOpen: true }],
    ["item without a timestamp", { head: { createdAt: null, mediaType: "image" } }],
  ];
  for (const [name, patch] of cases) assert.equal(shouldOpenStarPrompt({ ...base, ...patch }), false, name);
});
