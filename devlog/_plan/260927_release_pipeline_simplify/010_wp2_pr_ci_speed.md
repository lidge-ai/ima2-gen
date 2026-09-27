# wp2 — PR gate and CI e2e speed (D1)

## Change map

| File | Change |
|---|---|
| ui/playwright.config.ts | `workers`: `process.env.CI ? 3 : 1`. No new env var: the J6 preflight (ui/e2e/fixtures/appServer.ts assertJ6Isolation) rejects any `IMA2_*`/`PW_TEST_*` name, so a worker-count variable would block the suite. `fullyParallel` stays false (tests inside a file keep their order; files spread over workers). The isolation project still runs first through `dependencies`. |
| .github/workflows/pr-fast.yml | Replace the stale "355 files run in 79s" comment with the measured ~3m figure; note that e2e runs on parallel workers. No job/step removal. |
| .github/workflows/ci.yml | e2e job comment: suite runs on parallel workers (same config). |

Out: sharding across runners (each shard repays ~1.5m setup and the isolation dependency);
Playwright browser cache (install measured 19s; Playwright docs advise against caching);
moving tests out of the gate.

## Acceptance

- The PR's own `PR frontend checks` run passes with the e2e step well under the 12-17m
  serial baseline (target < 8m). Verifier: gh run view <run> --json jobs step timings.
  Reads the change: the step runs `npm --prefix ui run test:e2e` -> playwright.config.ts.
- A second run (rerun of the job) also passes: flake check for parallel workers.
- If parallel runs flake on shared state, fall back to fewer workers and record why.

## Result (PR #334 runs, frontend e2e step, 270 tests)

| Config | e2e | job | run |
|---|---|---|---|
| serial (before) | 17.3m | 19.1m | 36318668408 |
| 3 workers, file-parallel | 9.1m | 11.2m | 36321822908 |
| 4 workers, file-parallel | 12.1m | 14.1m | 36322547503 |
| 3 workers, fully parallel journeys | 12.4m | 14.7m | (549a0772 run) |

The runner is CPU-bound: summed test time grows from ~17m serial to ~31-35m under
parallel load because each test runs an app server plus Chromium on 4 vCPUs.
Fully parallel journeys also repeat per-file beforeAll preflights (composer bundle
build) on every worker. Final: 3 workers, file-parallel, list reporter on CI.

Follow-up (not in this unit): more speed needs more runners — shard the journeys
project over two jobs after checking how Playwright shards the isolation
dependency, or move the Tailwind build test (84s alone) out of the isolation
project's serial prefix.
