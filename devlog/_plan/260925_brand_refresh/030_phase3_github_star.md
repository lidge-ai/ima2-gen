# 030 Phase 3 — GitHub star backend and dialog

## HTTP contract

- `GET /api/github/star` → 200 `{ state: "starred" | "not-starred" | "unauthenticated", repo, url }`
- `POST /api/github/star` → 200 `{ ok: true, state: "starred" }`; 409 `{ ok: false, code: "GH_UNAUTHENTICATED" }`; 502 `{ ok: false, code: "GH_FAILED" }`. gh stdout/stderr never reaches a response (it can name the account).
- Loopback only: peer `req.socket.remoteAddress` ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}; otherwise 403 `{ code: "LOCAL_ONLY" }`. A LAN client must not star with the host's GitHub login.

## File change map

| Path | Action |
|---|---|
| lib/githubStar.ts | NEW — trusted gh resolution, async spawn with timeout, cached probe, star write, test seam |
| routes/github.ts | NEW — `registerGithubRoutes(app)` |
| routes/index.ts | MODIFY — import and call `registerGithubRoutes(app)` after `registerHealthRoutes` |
| tests/github-star.test.ts | NEW |
| ui/src/lib/githubStar.ts | NEW — `fetchStarStatus()`, `starRepo()` |
| ui/src/components/StarPrompt.tsx | NEW |
| ui/src/styles/star-prompt.css | NEW (imported the way sibling modal styles are) |
| ui/src/App.tsx | MODIFY — `<StarPrompt />` after `<OnboardingPopup />` |
| ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json | MODIFY — `starPrompt.*` |

## lib/githubStar.ts shape

```ts
export const STAR_REPO = "lidge-ai/ima2-gen";
export const STAR_REPO_URL = `https://github.com/${STAR_REPO}`;
export type StarState = "starred" | "not-starred" | "unauthenticated";
export interface StarDeps {
  runGh(args: string[], timeoutMs: number): Promise<{ status: number | null } | null>;
  nowMs(): number;
}
export function trustedGhDirectories(platform?: NodeJS.Platform): string[];   // OpenCodex literal list
export function resolveTrustedGh(platform?: NodeJS.Platform, exists?: (p: string) => boolean): string | null;
export async function probeStarState(deps?: StarDeps): Promise<StarState>;   // auth status --hostname github.com, then api /user/starred/<repo>
export async function getStarStatus(deps?: StarDeps): Promise<{ state: StarState; repo: string; url: string }>; // 10 min cache, inflight coalescing, generation guard
export async function starRepository(deps?: StarDeps): Promise<{ ok: true } | { ok: false; code: "gh_unavailable" | "gh_unauthenticated" | "gh_failed" }>;
export function setStarDepsForTests(deps: StarDeps | null): void;
```

## Conditional paths and activation scenarios

| Path | Trigger in tests |
|---|---|
| gh missing → unauthenticated | runGh returns null |
| auth fails → unauthenticated | auth status → 1 |
| starred / not-starred | api → 0 / 1 |
| cache hit | second call within TTL, runGh call count unchanged |
| write invalidates | POST ok, next GET = starred without extra runGh |
| unauthenticated write → 409 | auth status → 1 on POST |
| non-loopback → 403 | handler invoked with remoteAddress 192.168.0.5 |

## StarPrompt behavior

- On mount: GET status once. Never opens if `starred` or localStorage `ima2.starPrompt.v1` ∈ {dismissed, starred}.
- Opens when `history[0]` changes to an item whose `createdAt >= mountedAt` and whose mediaType is not video — the first image made in this session.
- Suppressed while the onboarding popup is open (checks the same dismissed key / store flag).
- not-starred: primary "Star on GitHub" → POST; success → thank-you line, localStorage starred, auto-close.
- unauthenticated: primary "Open on GitHub" (`window.open(url, "_blank", "noopener")`), note about `gh auth login`.
- Star count from `https://api.github.com/repos/lidge-ai/ima2-gen` `stargazers_count`; hidden on any failure.
- a11y: role=dialog, aria-modal, aria-labelledby, `useModalFocus`, Escape = dismiss.


## A round 1 amendments (002) — supersedes the file map above where they differ

Owner: one star module. `lib/githubStar.ts` owns the repo constant, trusted gh resolution, async spawn, state file (`join(config.storage.configDir, "state", "star-prompt.json")`, same path as today), cached probe and star write. `bin/lib/star-prompt.ts` keeps its exported API (tests/star-prompt.test.ts) but imports `STAR_REPO`, `starPromptStatePath`, `hasBeenPrompted`, `markPrompted` from `../../lib/githubStar.js`; its sync gh calls stay (CLI prompt runs before the server).

HTTP (all under the existing LAN guard + `checkBrowserRequest` cross-site refusal, lib/localAccessPolicy.ts:129):
- `GET /api/github/star` → `{ state, prompted, repo, url }`.
- `POST /api/github/star` → 200 `{ ok: true, state: "starred" }` and marks prompted; 409 `{ ok:false, code:"GH_UNAUTHENTICATED" }` when gh is missing or logged out (same state as the GET); 502 `GH_FAILED`.
- `POST /api/github/star/dismiss` → 200 `{ ok: true }`, marks prompted.
- All three refuse non-loopback peers with 403 `LOCAL_ONLY` using a new exported `isLoopbackPeer(address)` in lib/localAccessPolicy.ts built on the existing `literalHost` normalizer (covers `::ffff:127.0.0.1` and `::ffff:7f00:1`).

Extra files: docs/API.md, docs/API.zh-CN.md, docs/API.zh-TW.md (route rows, tests/api-docs-contract.test.js:38); tests/a11y-modal-contract.test.ts DIALOG_SURFACES += StarPrompt.tsx; ui/src/index.css imports star-prompt.css; docs/migration/runtime-test-inventory.md regenerated by `npm run test:inventory`; structure/01-file-function-map.md via `npm run` line-count refresh script if it exists (re-verify at P).

StarPrompt state: server `prompted` flag replaces localStorage. Opens only when `!prompted && state !== "starred"`, onboarding popup not open, settings not open, and a new history head with `createdAt >= mountedAt` (not video). Close/Escape/"Not now" → POST dismiss.
Activation for UI branches: covered by a small pure helper `shouldOpenStarPrompt(input)` in ui/src/lib/githubStar.ts with a node:test contract (`tests/star-prompt-ui-contract.test.ts`) driving prompted/starred/onboardingOpen/createdAt/video cases; star-count failure path hides the count (render harness).

## A round 2 amendments

- Shared gh contract: `lib/githubStar.ts` exports `STAR_REPO`, `GH_HOSTNAME`, `ghVersionArgs()`, `ghAuthStatusArgs()`, `ghStarredProbeArgs()`, `ghStarWriteArgs()` and the state helpers. The server path runs them with an async spawn; the CLI (`bin/lib/star-prompt.ts`) keeps a synchronous spawn because it prompts before the server exists, but builds every argument list from those exports. The spawn mode differs; the commands cannot drift.
- `ghStarWriteArgs()` returns `["api", "-X", "PUT", "/user/starred/lidge-ai/ima2-gen"]`, identical to the literal `tests/star-prompt.test.ts:23` pins, so the CLI test stays green unchanged. `--hostname github.com` is added only to the server's probe/auth calls, where GHES logins could otherwise answer.
- File map additions: `bin/lib/star-prompt.ts` MODIFY (import constants, arg builders and state helpers from ../../lib/githubStar.js), `tests/star-prompt.test.ts` unchanged (must stay green).
- StarPrompt also stays closed while `readinessPopupOpen` (ui/src/store/storeTypes.ts:414) is true.
- Citation fixes: `DEFAULT_GROK_PLANNER_MODEL` is config.ts:29 (050), `checkBrowserRequest` is lib/localAccessPolicy.ts:128.

## wp3 P re-verification (HEAD f146922d)

- routes/github.ts exports `createGithubStarHandlers(deps?)` → `{ status, star, dismiss }` Express handlers plus `registerGithubRoutes(app)`; tests call the handlers with fake req/res (`socket.remoteAddress` controls the loopback branch), because any real socket request in a test arrives from loopback and could not reach the LOCAL_ONLY path.
- `isLoopbackPeer(address)` exported from lib/localAccessPolicy.ts, built on the existing private `literalHost`: true for 127.0.0.0/8, ::1, ::ffff:127.x (dotted and hex forms).
- State helpers take an optional path for tests; production path stays `join(config.storage.configDir, "state", "star-prompt.json")` (bin/lib/star-prompt.ts:11-13). Server writes `{ prompted_at }` in the same shape the CLI writes, so either surface suppresses the other.
- Trusted gh resolution (server only): literal dirs /opt/homebrew/bin, /usr/local/bin, /usr/bin, /bin, /opt/local/bin, /home/linuxbrew/.linuxbrew/bin, /snap/bin, /run/current-system/sw/bin, C:\\Program Files\\GitHub CLI, C:\\Program Files (x86)\\GitHub CLI. Spawn uses `shell: false`, `stdio: "ignore"`, `windowsHide`, PATH limited to the gh directory, kill on timeout (auth 5s, api 10s).
- Tests: tests/github-star.test.ts (runtime test: imports lib/ and routes/), tests/star-prompt-ui-contract.test.ts (pure `shouldOpenStarPrompt` from ui/src/lib/githubStar.ts, imported via tsx). `node scripts/classify-tests.mjs` regenerates docs/migration/runtime-test-inventory.md.
- UI: `ui/src/lib/githubStar.ts` uses `jsonFetch`/`fetchApi` from api-core.ts; star-count fetch goes to api.github.com with `fetch` directly (cross-origin, public, no credentials) and is optional.
