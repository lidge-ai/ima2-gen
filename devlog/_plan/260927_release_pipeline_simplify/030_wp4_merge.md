# wp4 — merge

- Open one PR from codex/260927-release-pipeline-simplify to dev with before/after numbers.
- PR Fast Gate green (frontend e2e on parallel workers is itself the wp2 proof); rerun the
  frontend job once for flake evidence; merge (squash) into dev.
- PR #331 (Windows titleBarOverlay): Kimi review MERGE-WITH-FIXES; SHOULD-FIX (266px drag
  band on toggle-less Windows views) fixed in 178f9d13 on the PR branch. Merge after green.
- Observe post-merge dev CI (push run) and fix forward if red.


## Outcome

- #331 merged into dev as f72e10e1 (squash) after the drag-band fix 178f9d13;
  post-merge dev CI run for f72e10e1 succeeded (13:29-13:52 UTC).
- #334 carries wp2 (55843dd8..a76ce622, final: three workers, file-parallel) and
  wp3 (549a0772, f9fecea4). Local: typecheck, typecheck:tests, lint, test:inventory,
  lint:pkg, npm test 3857/0 fail. PR e2e 9.1-10.5m vs 12.3-17.3m serial.
- The release path itself is first exercised by the next real release; the
  release.yml changes cannot run from a PR (workflow_dispatch uses the default
  branch's copy once merged and promoted).
