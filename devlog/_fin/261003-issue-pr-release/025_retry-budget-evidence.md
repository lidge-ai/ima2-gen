# Prepared execution budget verification

The024 repair retains a monotonic deadline across early-error retries and concurrent calls of one prepared OAuth job. Classic prepare-time values remain captured; API retry timing, live signal reads and callback awaiting remain unchanged. No global cache or serialized field was added.

Before production edits, the new fixture had4 actual budget failures and2 passing controls. Final focused execution:14 deadline cases and87 provider-boundary cases pass with zero failures/cancellations/skips. Coverage includes classic/node early500 at60ms ending by100ms, no request after expiry, fresh jobs, prepare-vs-execute timing, concurrent expiry, independent forward/backward wall-clock movement, parent cancellation propagation/cleanup, persistence awaiting, scalar capture and API compatibility. Logs: .codexclaw/wp2-execution-budget-red.log, wp2-budget-focused.log, wp2-boundary-repair.log.

The first broad run found only a stale OAuth signal-reference oracle. The new feature intentionally uses an invocation-local deadline signal. Only that provider's assertion was updated; all other provider identities remain strict. A real active-parent-cancel test supplies stronger propagation and cleanup proof. No production change was made for that test repair.

Architect Plato and independent plan reviewer Gibbs accepted024 before production changes. Independent implementation reviewer Pasteur (01a10251-fc35-74e1-bf10-da139be96ac9) reviewed runtime plus new14 tests and boundary interdiff:PASS, zero blockers. Both typechecks, lint with0errors, server/CLI builds and structure drift checks passed. Final canonical suite and fresh HTTP receipt run after this checkpoint; their immutable head and results are recorded in PR370 and the next cycle closeout, not claimed completed here.

| File | SHA256 |
|---|---|
| `lib/providers/adapters/openaiExecution.ts` | `41c0e4ed9cb03e49188909e2faa54dc2edd4e5cc1c33429e3ae50587615af42e` |
| `tests/oauth-execution-deadline.test.ts` | `9b767bc9e1325a38e621ff84d5e2af7b4572d65d44f847bdc5dc7eb93731c5a6` |
| `tests/_executionBoundaryProbe.ts` | `27a218a38443b16958fc0a1a0866e1d4f35683ab114b2428ae963316f2f27231` |
