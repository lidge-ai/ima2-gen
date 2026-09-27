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
