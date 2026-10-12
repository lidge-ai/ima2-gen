# B amendment: preserve the job deadline through outer retry owners

Main traced actual consumers after entering B. `lib/providers/adapters/openaiExecution.ts:27-65` retries classic generation unless isNonRetryableGenerationError returns true. `lib/nodeGeneration.ts:317-336` has the same decision. Fresh direct execution of generationErrors with RESPONSES_IMAGE_TIMEOUT/status504 returned nonRetryable:false and normalizeGenerationFailure.code UNKNOWN. Thus a new job deadline using only that code would be retried with a fresh budget and lose its identity. This contradicts020's no-retry-after-job-timeout requirement.

H1 raw AbortError becomes cancellation in routes was falsified: generationCancel.ts:17 checks code, and generate/node/multimode/edit paths use that function or explicit user job state. H2 retry classification loses deadline was confirmed by the probe and source. H3 route normalization preserves RESPONSES_IMAGE_TIMEOUT was falsified by the actual normalizeGenerationFailure result. No production fix has been applied for this amendment yet.

## Minimal correction proposed to architect and independent reviewer

Reuse the EXISTING canonical OAUTH_IMAGE_TIMEOUT/status504 for the NEW whole-job deadline. It is already in PASSTHROUGH_CODES and isNonRetryableGenerationError, with statusForErrorCode mapping504. Keep standalone per-request OAuth timeout RESPONSES_IMAGE_TIMEOUT, and leave all API-key behavior unchanged. Avoid new wire flags or cause-chain inference.

The new abort helper uses an explicit kind rather than two ambiguous booleans:

```ts
type OAuthAbortKind = "cancel" | "request-timeout" | "job-timeout";
// OAuthJobAbort constructor(kind):
// cancel -> name AbortError, message Generation canceled,499/GENERATION_CANCELED
// request-timeout -> name AbortError, timeout message,504/RESPONSES_IMAGE_TIMEOUT
// job-timeout -> name AbortError, OAuth image generation timed out,504/OAUTH_IMAGE_TIMEOUT
```

createOAuthJobDeadline timer is the ONLY job-timeout creation site. Per-request timers and the existing bare AbortError fallback select request-timeout. Unknown parent abort reasons select cancel. Preserve the first typed reason when composing signals and copy its code/status into transport makeError. No change to generationErrors or public request payloads is required.

Field/enum chain: creation at job/request timer or user-cancel adapter → in-memory AbortSignal.reason → oauthAbortError reads the typed reason → transport code/status normalization → existing retry classifier and normalizeGenerationFailure → route/SSE terminal error. No disk/request serialization is introduced. The exported class remains local to OAuth lifecycle modules; original cancellation499 unchanged. Multi-image partial handling already recognizes status504; preserve completed images and slot-order error choice.

## Extra regression acceptance

At the actual prepareOpenaiExecution classic boundary, use the existing isolated mocked-backend fixture and a direct OAuth request with held upstream. Fire its job deadline, assert one upstream request, OAUTH_IMAGE_TIMEOUT504 terminal error, no outer retry even after more fake time, and no extra onFinalImage writes. Use the real generationErrors classifier and normalizer, not a mock of either. Add a focused node retry-classification assertion for the same actual error. Existing API compatibility tests must still observe RESPONSES_IMAGE_TIMEOUT and their old catch precedence.

Update only job-deadline expectations in020/021 tests to OAUTH_IMAGE_TIMEOUT. Request-timer tests remain RESPONSES_IMAGE_TIMEOUT. Before implementation, architect reflects on this exact document and independent reviewer re-audits. This is a correction to fulfill the existing objective, not additional feature scope.

Architect01a1020f-23c4-7fa0-a5e4-1e627cd5e059 returned ALIGNED; independent reviewer01a10240-30ec-7c03-8bb7-390950c02ed5 returned PASS (zero blockers). Main accepted both; implementation steering delivered before dependent deadline-code completion. Classic fixture must supply isJobCanceled in the inflight mock. Main probe of canonical OAUTH_IMAGE_TIMEOUT504 confirmed nonRetryable:true and normalized code/status preserved.
