# 030 wp4 — Issue decisions (#338, #150)

Class C1 (maintainer replies, no code).

## #338 job persistence and SIGTERM drain

Default: accept the direction and let the contributor write the SQLite PR, with a design
contract in the reply so the PR lands in one review round. The contract comes from the sol
analysis (Carson) with file:line evidence, covering schema, restart recovery and its duplicate
upstream spend, drain timeout, desktop quit/update, reference-image lifetime and tests.
Implement here instead only if the analysis shows the contributor path is blocked.

## #150 Provider Adapter v1 RFC

Decide keep-open, defer or close from whether its premise still matches the code.

## Acceptance

- One posted comment per issue (URL recorded here).
- Labels unchanged unless the decision is close/defer.

## Decisions

Analysis: Carson (gpt-6-sol, agent 01a0ede8-c7fb-7750-8fa2-5209ae3b87ae), read-only at 82f4844e.

#338 — accept the direction; the contributor implements. Contract for the PR:

1. Durable admission: versioned `generation_queue` (request_id PK, kind, replay payload or durable
   asset refs, payload fingerprint, status, timestamps, attempts, owner/lease). Today `inflight`
   keeps only a 500-char prompt and summary (lib/inflight.ts:88, lib/db.ts:63); keep the #151
   terminal snapshot API (lib/inflight.ts:243).
2. Recovery by lease, never a blanket running→queued: two servers can share one DB after a port
   fallback (lib/runtimePorts.ts:77). Bounded attempts; at-least-once execution documented.
3. Duplicate requests: keep REQUEST_ID_IN_USE (lib/inflight.ts:99) and the Idempotency-Key replay
   contract (lib/jobs/idempotency.ts:129) working together.
4. Drain: SIGTERM hard deadline is 3 s (bin/lib/platform.ts:84) and the desktop kills its child
   after 5 s (desktop/lib/server.mjs:316); a drain timeout must be coordinated with both. Keep
   reference files alive until terminal (MCP temp refs expire after 1 h,
   lib/mcpTempReferenceStore.ts:6) and keep the 90-minute stale purge away from queued jobs
   (lib/inflight.ts:352).

#150 — keep open, defer. The registry now has ten lanes (comfy, nai added after the RFC,
lib/providers/registry.ts:197/233); seven have adapters, but generateImage/editImage are still
optional (lib/providers/adapters/types.ts:41), UI provider branches remain, no packages/ boundary.
Its "add no providers first" premise is already overtaken, so the reply updates the premise.

### Reflection amendment (Carson: MISALIGNED, narrow)

The #338 reply also requires: the queue transition and the terminal outcome commit in one
transaction; the same requestId with the same payload fingerprint returns the existing job, a
different payload returns 409; and named tests for restart of queued and running jobs, two servers
claiming one DB, cancellation, a missing reference file, SIGTERM drain timeout, and desktop
quit/update.

Posted: #338 https://github.com/lidge-ai/ima2-gen/issues/338#issuecomment-5894907057 (accept,
contributor implements, contract above); #150
https://github.com/lidge-ai/ima2-gen/issues/150#issuecomment-5894907458 (keep open, defer, premise
updated). Follow-up from #339: #351 (job-wide OAuth deadline).
