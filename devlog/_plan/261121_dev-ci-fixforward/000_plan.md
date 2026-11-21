# Fix forward: post-merge dev CI red after #432/#433

dev CI was green at bc6fbcde and red at 75041138 (#432 merge) and 32e9bb12 (#433 merge).

| Failure | Cause | Fix |
|---|---|---|
| Package install smoke (all platforms): `installed GPT OAuth client should include 0.157.0` | #432 raised `CODEX_CLIENT_VERSION_FLOOR` to 0.166.0 for the GPT-6.x lineup; tests/package-install-smoke.mjs hard-coded 0.157.0 (it runs only in the post-merge CI, not the PR fast gate) | read the floor from lib/codexBackend/client.ts so the check follows the constant |
| Windows Run tests: reset-guard "keeps consume URLs in the transport module" | the test compares `join()` paths with a POSIX literal; Windows yields `lib\\reset\\transport.ts` | normalize separators before comparing |

Failing evidence: CI runs 44805865778 / 44834654963 (step logs), and locally `npm run test:package-install` exit 1 with the 0.157.0 assertion before the fix.
Acceptance: reset-guard 3/3 and package-install smoke pass locally; fast gate green on the PR; post-merge dev CI green on the merge commit. Test-only change; no product code.
