# wp4 — merge

- Open one PR from codex/260927-release-pipeline-simplify to dev with before/after numbers.
- PR Fast Gate green (frontend e2e on parallel workers is itself the wp2 proof); rerun the
  frontend job once for flake evidence; merge (squash) into dev.
- PR #331 (Windows titleBarOverlay): Kimi review MERGE-WITH-FIXES; SHOULD-FIX (266px drag
  band on toggle-less Windows views) fixed in 178f9d13 on the PR branch. Merge after green.
- Observe post-merge dev CI (push run) and fix forward if red.

