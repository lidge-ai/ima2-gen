# WP3: structured upstream image failure diagnostics

Class C4 confidentiality boundary; independent of WP1/2 but delivered sequentially.
Original source: fd3ea788 plus diagnostic hunks from 46921f06.

## Exact scope and rejected behavior
MODIFY lib/responsesParse.ts, lib/responsesErrors.ts, lib/generationErrors.ts,
lib/nodeGeneration.ts and tests/responses-parse-diagnostics.test.ts.
The source parser contains a literal NUL; never copy its whole blob.
Read textual source with `git diff --text 5f33e44a e3a731cb -- lib/responsesParse.ts`.

Reject safeDiagnosticMessage and all raw upstream sentence propagation. Pattern
redaction cannot prove prompt or credential confidentiality. Account for this
original feature as intentionally rejected unsafe behavior, not silently omitted.
```diff
- diagnostics.upstreamErrorMessage = arbitraryProviderSentence
+ diagnostics.upstreamErrorCode = safeDiagnosticLabel(code)
+ diagnostics.upstreamErrorType = safeDiagnosticLabel(type)
- message += upstreamSentence
+ retain stable ima2 message; expose only bounded machine classification
```
Keep safeDiagnosticLabel's existing redaction contract. Enumerate allowed public
fields in error propagation; do not broaden diagnostic objects with raw bodies.
If code/type already flow through existing owners, change only missing links.
No raw capture for streamErrorMessage that is subsequently discarded.

## Field chain and acceptance
Creation: image tool and stream error SSE events. Serialization: structured
diagnostic object. Deserialization: existing error normalizer. Consumers:
node final-error logging/API error envelopes. No persistent DB field.
Activate image-item failure, actual type:error stream, empty response, malformed
SSE and web-search-only response; assert stable codes and code/type reach intended
consumers. Feed synthetic Bearer/sk-/xai-/AIza/JWT/password/prompt text and prove
none appears in serialized error/log diagnostics. Test ordinary non-secret prose
also does not propagate. Normal Git diff must be textual, without control bytes.
Focused parser tests, server/test typecheck, full suite; CodeQL must settle.
Security Sol reviews the exact final diff; main owns source integration.
Update structure/03 API diagnostic contract, regenerate 01.
Boundary tier: application parser plus policy tests; providers remain untrusted.
