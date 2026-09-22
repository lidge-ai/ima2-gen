# WP5: durable node-local references

Class C4 data migration and input/storage boundary. Depends WP1.
Use exact source e3a731cb final ref files (initial 6dd19c6d with e3a731cb fixes).

## Change map
NEW lib/nodeRefStore.ts and routes/nodeRefs.ts; MODIFY lib/db.ts only node_refs
schema/index; MODIFY routes/index.ts only reference registration.
MODIFY ui/src/lib/nodeRefStorage.ts; reference-related hunks only of
ui/src/store/{storeGraphSave,storeSessionImpl,storeNodeRefImpl}.ts.
Preserve current graph generation and API image-model fields.
NEW tests/node-reference-persistence.test.ts; split applicable source reference
cases out of tests/workflow-api-contract.test.ts instead of importing engine.
Full source diff: `git diff 5f33e44a e3a731cb -- <listed paths>`;
exclude wf_runs, warnings and napWfApiDangChay hunks.

## Correctness fixes
```diff
- remove localStorage session after any migration attempted
+ remove only each successfully persisted legacy reference; retain failures
- apply response when current.length === request.length
+ serialize writes per session/node and ignore stale response revisions
- silent fire-and-forget persistence
+ surface save failure while retaining retryable local references
```
Use existing file import/containment helpers; URLs belong to configured generated
regular files and an existing session/node, never arbitrary disk/remote URL.
Migration remains retryable/idempotent and never discards the sole original.
Define deletion semantics: session delete cascades reference rows; graph node
delete prunes its rows, not unrelated assets. Do not erase generated files.
Request-only workflow overrides are a later consumer, not written to reference DB.

Field chain: reference input/browser legacy state -> serialized API request ->
validated generated URL in node_refs -> fetch on session reload -> UI node refs
-> base64 conversion for generation. Preserve user-pinned refs vs generated refs
as separate identities when later fashion integration is added.

## Proof and owner
Sol executor owns backend store/schema/routes and backend tests; UI executor
owns migration/write ordering and UI behavior tests; main integrations sequential.
Activate offline/4xx/partial migration, retry, equal-length A->B replacement with
delayed A response, concurrent session switch, deleted node/session and foreign
path. Assert latest acknowledged refs persisted and failed originals remain.
Real SQLite and injected deterministic request ordering; no sleep-based tests.
Run targeted tests, complete root gates, UI build and hosted ref reload smoke.
Update structure/03/05/06, docs/API.md and inventory. Data-loss findings block
merge; publish draft only with reproduced blockers if correction remains unsafe.
