# WP1: graph compatibility and multiple image parents

Class C4 for public graph/request contract; dependency WP0.
Deliver ordinary PR on dev; no role/workflow fields in this slice.

## Exact extraction
MODIFY bin/commands/session.ts from source commit 36b46b8d (-x).
MODIFY lib/nodeGeneration.ts, lib/nodeHelpers.ts, lib/sessionStore.ts,
ui/src/lib/nodeGraph.ts, ui/src/store/storeGraphNodeImpl.ts,
ui/src/store/storeNodeGenImpl.ts, ui/src/store/storeTypes.ts from c3399094.
MODIFY ui/src/components/NodeCanvas.tsx, ui/src/lib/nodePortCatalog.ts and
four ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json files: only edge-role and input
cardinality hunks from 88e49462; omit unrelated dictionary reformatting.
The complete before/after is reproducible with
`git show 36b46b8d c3399094 88e49462 -- <paths above>`.
Preserve current dev imageToolModel consumers and all signing files.

## Required corrections
```diff
- incomingByTarget: Map<string, EdgeInput>
+ incomingByTarget: Map<string, EdgeInput[]> // ordered base, then refs
- reject second incoming edge
+ retain cycle/duplicate guards; accept ordered additional image parents
- silently load unbounded extraParentNodeIds
+ validate bounded array and IDs; deduplicate; reject invalid/missing supplied refs
- current.session.graph.version
+ current.session.graph?.version ?? current.session.graphVersion ?? 0
```
Do not infer a new base from a missing first-parent asset. parent-only must not
load extra references. Preserve cap accounting and admission before provider work.
Graph DB edge order must survive save/reload. Current table is a rowid table and
saveGraph deletes/reinserts its edges in array order. Change getSession's edge
SELECT to `ORDER BY rowid`; no schema migration is necessary. Test reverse-named
edge IDs and `PRAGMA reverse_unordered_selects = ON` to prove the explicit order,
then reconnect the database and verify the same base/ref roles.

Field chain: extraParentServerNodeIds is derived in nodeGraph/sessionStore,
stored through graph serialization and reconstructed on load; generateNode sends
extraParentNodeIds through nodeApi request type/nodeHelpers; nodeGeneration
validates/loads/counts refs and provider executions consume that list.
Missing/old fields normalize to []; explicit malformed API input fails.
The existing prepareImageExecution call currently receives refCheck.refDetails,
not refsForRequest. Pass ordered extra-parent details followed by existing user
refDetails to actual execution, not only count/log variables; assert adapter
payload bytes. Skip extra-parent loading in parent-only. Keep original user-ref
details for the existing legacy Atlas/MiniMax contracts, whose provider adapters
retain separately documented behavior; do not silently change them by passing
the globally filtered refsForRequest list. API/OAuth/Grok/Google retain their
existing adapter context filtering. Tests must cover both extra refs reaching the
wire and unchanged legacy parent-only user refs.

## Verification and delegation
Main owns CLI and docs/merge; Sol executor owns backend graph helper/normalization
and behavioral tests; separate executor owns disjoint UI graph/type/edge changes.
NEW tests/cli-session-graph.test.ts: emitted CLI against loopback HTTP fixture,
flat and nested graph, empty new session If-Match 0, missing session, conflict,
load/save roundtrip. MODIFY tests/node-parent-source-contract.test.ts to replace
single-parent refusal with order/dedup/removal/reload assertions.
NEW tests/node-extra-parents.test.ts verifies malformed/missing/limit inputs,
parent-only and actual prepared request refs; use existing provider harness.
MODIFY node-edge/cardinality contracts only where intended semantics changed.
NEW ui/e2e/node-multi-parent.spec.ts drives two incoming connections and labels,
reload, disconnect and existing cycle rejection with synthetic images.
All new tests use repository node:test/Playwright owners, no paid provider.
Run focused tests, typechecks, inventory, full suite and UI build; hosted E2E
proves rendered base/ref ordering. Reproduce regression red then green once.
Update structure/02-command-reference.md, 03-server-api.md, 05-node-mode.md,
docs/API.md and regenerate structure/01 counts.

Input enforcement: server boundary (E7 implementation review plus executed tests);
UI is bypassable by direct HTTP, so server validates independently. No claim of
unbypassable controls. Rollback: revert this PR, preserving existing graph data;
multi-parent sessions need exported backup before runtime downgrade.
