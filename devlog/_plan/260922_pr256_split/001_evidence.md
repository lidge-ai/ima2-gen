# Source and verification evidence

## Baseline

- Repository root: current task's `ima2-gen` checkout.
- Starting dev: `203fa69d0cad38c9f1d18dfc9b546e48524a14c0`.
- Source head: `e3a731cbd2ba4600e8cf06951126486860ff5fa2`.
- Source merge base: `5f33e44a7886580330ee03ea58a71a4d842014e5`.
- CLI graph correction is isolated in `36b46b8ddcb50785b7a42ea9671ecc1a38705d98`.
- Multi-parent core starts in `c33990941967d0979a37736914a5fd02801f5714`;
  UI admission/edge roles follow in `88e4946293f89e6a3a8735132bc132976e3c32f9`.
- Lightbox: `7b32f495ece73d3578647d75b7ade6c190fb2b4b` and portal correction
  `65dcdae02a249d1b4602fefa48eee5dac14a1053`.
- Portable templates: `6a596ea0` includes an unrelated workflow-chain hunk;
  extract only template files and scoped shared UI/i18n changes.
- Diagnostics starts at `fd3ea788`; source `responsesParse.ts` is reported as
  binary by Git and must be inspected as bytes before adoption.

## Confirmed independent seams

`bin/commands/session.ts:132` reads `session.graph.version`, but current
`lib/sessionStore.ts` returns `graphVersion`, `nodes` and `edges` directly.
`graphLoad` repeats that mismatch. Test the emitted CLI against a loopback HTTP
fixture: flat payload, legacy nested payload, missing session, version conflict,
empty graph and load/save preservation.

`lib/nodeTemplateStore.ts` already owns stripping and SQLite template storage.
Portable files should extend that owner, with dedicated file parsing and routes.
Original file parser accepts any numeric version <=1, and routes count UTF-16
characters rather than UTF-8 bytes. The collision helper truncates after adding
the suffix, so 80-character names can discard their suffix. These are observable
input-boundary cases to fix before that slice merges.

Original `create` stripping preserves some runtime URLs and server node IDs;
portable export must not promise that all media/runtime data are stripped until
tests exercise the actual exported file. Existing template behavior has explicit
contracts; scope new sanitation to portable import/export when changing the old
store would break established behavior.

## Baseline commands

| Command | Result | Observes |
|---|---|---|
| `npm run typecheck` | exit 0 | server/lib/routes TS includes |
| `npm run typecheck:tests` | exit 0 | test TS and imports |
| `npm run test:inventory` | exit 0 | canonical test registry |
| `node scripts/refresh-structure-line-counts.mjs --check` | exit 0 | structure file counts |
| `npm test` | exit 0, 3621 pass, 0 fail, 7 skip | all canonical root tests |
| `npm --prefix ui run build` | exit 0, existing chunk warning | UI TS/E2E TS/Vite |

Hosted PR E2E is required because the project deliberately refuses local
credential-bearing machines in `ui/e2e/fixtures/appServer.ts:118`. Preserve that
boundary and inspect hosted artifacts instead of spoofing runner identity.

## Scope and privacy

No new secrets or customer inputs are needed. Use synthetic images and loopback
fixtures, never live paid providers. Exclude browser profiles, generated outputs,
local credentials and machine-specific evidence from pushes. Original public
contributor attribution is provenance, not copied private conversation data.

## Sol discovery dispositions

- Architect proposed graph, diagnostics, portable templates, media boundary,
  generic kernel, durable runtime and fashion integration. Accept the dependency
  DAG; add a separate generic lightbox/copy-ID slice confirmed by the UI explorer.
- Security review found raw upstream sentences can contain prompts or provider
  keys not covered by the contributor regex. Reject the prose propagation; retain
  safe structured classifications only. The literal NUL in the proposed regex
  also makes Git treat `responsesParse.ts` as binary; do not import that blob.
- Media review found unbounded count/bytes/concurrency, no request cancellation,
  symlink acceptance, timestamp output collision and unsafe stderr envelopes.
  Fix by extending existing process/file-boundary patterns, then reassess merge.
- UI review found loss of legacy localStorage refs after unsuccessful migration,
  and equal-length updates overwritten by stale PUT responses. Durable runtime
  must preserve failed migration entries and serialize/revision reference writes.
- Runner filter requests can finish out of order; add request identity/abort.
  Role names and statuses need existing locale dictionaries and accessible status.
- Architect found `wfEngine.ghiNode` logs and returns after exhausted version
  conflicts. That cannot certify a successful persisted run; emit a stable failure
  or explicit partial outcome and test actual contention.
- Main corrected the UI review's first finding: comparing dev directly with the
  fork shows missing newer dev work, but the original PR merge-base delta does not
  delete it. The risk applies to whole-tree copying; scoped extraction preserves it.

All findings above are static source evidence, not claims of runtime reproduction.
Each accepted defect needs an activating test before its corrected slice merges.

## Activated baseline failures

- `.codexclaw/pr256-cli-probe.mjs` invoked emitted `bin/ima2.js session graph
  load fixture` against an owned loopback fixture returning graphVersion 7 and
  one node. Exit 1, empty stdout, stderr `no graph for session`. Only health and
  session GETs occurred; server closed and child exited. No live provider used.
- An in-memory SQLite table matching edges' composite primary key and session
  index returned reference before base with `reverse_unordered_selects=ON`.
  The same SELECT with `ORDER BY rowid` returned base then reference, confirming
  the planned ordering regression is constructible.
- Pinned contributor nodeGeneration builds `refsForRequest` from extra parents,
  but its `prepareImageExecution` still receives only `refCheck.refDetails`.
  Logs/counts cannot prove those extra images reached the provider. WP1 explicitly
  tests actual adapter request image bytes, retaining legacy provider semantics.
