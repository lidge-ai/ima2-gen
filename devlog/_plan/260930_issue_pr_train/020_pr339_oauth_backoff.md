# 020 wp3 — PR #339 OAuth per-minute 429 backoff

Class C3 (upstream retry behavior on a paid lane, new env knobs). Contributor branch
ree9622:feat/oauth-rate-limit-backoff, head a5b7d70c.

## Steps

1. After wp2 lands, in a /tmp worktree on the PR head, `git merge origin/dev`; regenerate the
   test inventory with `node scripts/classify-tests.mjs` and re-check `structure/01` line counts.
2. Verify: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`,
   `npm run test:inventory`, `node --test tests/oauth-rate-limit-retry.test.ts
   tests/oauth-rate-limit-lane.test.ts tests/grok-upstream-retry.test.ts
   tests/structure-line-counts-contract.test.ts` plus any transport tests the reviewer names.
   After the wp2 lesson (#350's temp-cleanup contract failed the first #340 gate), also run
   `tests/test-temp-cleanup-contract.test.ts` and the full `npm test` locally before pushing.
3. Fold the sol reviewer's blockers as small commits on the contributor branch.
4. Push, wait for the PR fast gate, merge with a merge commit, comment.

## Acceptance

- MERGED into dev; PR fast gate green on the final head.
- Transient 429 retries and succeeds; usage-limit 429 fails after one call; a long
  Retry-After with no body is not retried (lane test activations).
- The client never sees raw upstream error text (redaction test or reviewer evidence).

## Reviewer verdict

Wegener (gpt-6-sol, agent 01a0ede8-c732-7833-a005-28c5739393a5): MERGE-WITH-FIXES. Shared budget is
charged synchronously; no raw upstream text leaves the transport; the Grok jitter refactor keeps
its math; no competing 429 retry or pool rotation on this path. Focused tests 36/36 at
pr/339 + origin/dev.

B1 (accepted) — cancellation loses to a 429: withOAuthRateLimitRetry rethrows the upstream error
when the signal is already aborted (lib/oauthRateLimit.ts:192), and the unit test pins that. Fix:
an aborted signal after a transient 429 throws the 499 GENERATION_CANCELED error; update the
test to assert 499 for the abort-during-429 race.

B2 (rebutted) — a retried request can run past the job deadline: true, but not new. On dev the
planner and each render already get their own full generationTimeoutMs
(lib/responsesTransport.ts:286), so a job was never bounded by one deadline. The PR adds at most
maxTotalWaitMs (120 s) of waiting, and rejected attempts return fast. A job-wide timeout signal
is a separate OAuth-lane change, recorded as a follow-up. The budget doc comment is tightened so
it only claims that waits stop at the deadline.

Reflection (Wegener, same agent): ALIGNED. Gaps folded: the cancel test drops its real 20 ms timer
and 5 s wall-clock assertion and instead aborts from an injected sleep, so it is deterministic;
the job-wide deadline follow-up is opened as a GitHub issue after the merge (acceptance: one
AbortSignal per OAuth job bounds planner, renders and waits by generationTimeoutMs).
