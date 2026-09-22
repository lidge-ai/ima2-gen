# WP7: generic workflow execution and run history

Class C4 public job API, concurrency/persistence. Depends WP1/WP5/WP6;
portable template examples require WP4. Deliver two separately verified ordinary
PRs: 7A pure kernel, then 7B runtime/history. Each targets dev after its predecessor
lands, or names its unmerged dependency as a manual-chain base if deferred.

## Mandatory PR boundaries

7A owns lib/wfChain.ts and a shared generic role contract (extracted from
ui/src/lib/vaiTroNode.ts), ui/src/lib/canhAnh.ts, plus the pure planning cases
from tests/node-workflow-run-contract.test.ts in sub-500-line test files.
It introduces no HTTP execution, persistent run schema, provider calls or Runner.
Accept only after DAG ordering, marker/image distinction, cycle/missing-end,
unknown-role, placeholder and ratio/source selection tests pass. Generic role
values are created by fixtures/templates initially; 7B introduces their UI.

7B owns wfEngine/wfRunStore/wfEvents, invocation/history routes, wf_runs schema,
request parsing, cancellation/recovery, and all workflow UI integration listed
below. It imports the verified 7A contract. Accept only after the lifecycle,
persistence, concurrency and hosted UI cases below pass. Fashion remains WP8.

## Exact source extraction and module ownership
Source e3a731cb: NEW lib/{wfChain,wfEngine,wfEvents,wfRunStore}.ts;
NEW routes/workflow.ts; lib/db.ts wf_runs/index + restart handling;
routes/index.ts workflow registration; ui/src/lib/{canhAnh,chayWorkflow,wfApi}.ts;
ui/src/store/storeWorkflowImpl.ts; workflow fields/actions in storeTypes/useAppStore;
eventChannel multiplex wiring; WfRunnerPanel/NodeApiPanel/NodeVideoSettings components;
workflow-only ImageNode/storeNodeGen/storeVideo/NodeCanvas/NodeStudioOverlays/
NodeElementTray/NodeBatchBar hunks; wf-runner.css and scoped node-workspace CSS;
four dictionaries workflow/status keys. Split generic cases from original
node-workflow-run-contract and workflow-api-contract tests (never a 1529-line test).
Retrieval is `git diff 5f33e44a e3a731cb -- <these paths>`.

Keep wfChain pure: graph nodes/edges, marker-vs-image edges, topological sort,
start/end discovery, generic placeholders, ratio and video source resolution.
Split 960-line wfEngine into focused execution, generation dispatch and graph
persistence modules; split 570-line route into invocation and run-history routes.
Use clear English symbols in new extracted files; map original symbols in PR
provenance. No speculative generic plug-in registry.
Strip direct fashion imports and TRANG_PHUC special cases into WP8 specialization.
Generic role ownership is WP7/7A, reconstructed from vaiTroNode without fashion
constants. Generic roles: image/video/merge-images/merge-videos/start/end; unknown roles
must not silently auto-execute. Preserve existing untyped image-node behavior.

## Required behavior corrections
```diff
- after 3 saveGraph conflicts: log and return
+ fail run with WF_GRAPH_CONFLICT; preserve produced assets and report partial work
- overlapping runs mutate one session without coordination
+ serialize/reject overlapping run for same session; independent sessions may run
- late runner filter result overwrites current filter
+ abort/request-generation identity before applying results
- Vietnamese role/status values rendered directly
+ stable internal values mapped through four locale dictionaries
```
202 + run ID, one existing eventChannel, history/poll/SSE readouts, bounded list/
retention, wait timeout, completed-run stream. Cancellation stops future steps;
document active-provider stop semantics honestly and propagate available abort.
Restart marks abandoned runs failed; no duplicate paid generation on restore.
Use optimistic graph versions, preserve unrelated edits, fail missing/deleted
session; request-only overrides never persist into template or reference store.
URLs use trusted configured/request origin without leaking LAN token.
Main HTTP generation boundary already provides provider admission; preserve
imageToolModel and source image/ref order across all dispatches.
No success if result persistence failed.

Field chain: role/size/video settings and request overrides created by Node UI/
template or external API, validated at route, serialized graph or run envelope,
read by planner, executed by runtime, run updates serialized via DB/event bus,
deserialized by storeWorkflow and rendered with request identity.
Transient abort/promise state is never serialized.

## Tests and merge decision
Sol executor(s) disjoint: pure planner, runtime persistence/API, UI consumer/tests;
main orchestrates sequential bounded slices, owns integration and disposition.
Meaningful tests: DAG branching order, cycles/missing end/unknown role/empty prompt,
fresh generated parent precedence, video continuation vs still input, ratio,
request-only override isolation, cancel, timeout, restart, concurrent edits and
exhausted graph save conflicts, event reconnect/history and cross-session writes.
Hosted E2E role -> run -> progress -> result -> cancel/runner-filter with stubs.
Check every request shape against existing node/video/media route tests.
Compile and run all relevant root/full gates and UI build, inspect hosted render.
Publish as draft if any named lifecycle/security defect or unverified execution
remains. Draft must contain runnable concrete code and exact outstanding failures,
not a placeholder PR. Main and independent Sol decide whether all blockers closed.
Update docs/API and structure/03/04/05/06/01 plus inventory.
