# Post-publication CI fixture repair

3.26.2 publication in 042 remains successful and immutable. Documentation PR374
merged as21c94685. Its later CI37149939776 exposed a test fixture defect in Linux
Node24/npm12, job111281485517: `SqliteError: duplicate column name: error_raw_code`
in buildApp → queue initialization → getDb/migrate, before the first HTTP assertion
in backend-input-lan-hardening.test.ts. This later run is not claimed green.

## Check-phase scope amendment

This is a late wp4 Check repair to its verification harness, with no product runtime
or SQL changes. The bounded extension is C2 test-only work. Independent reviewer
01a1031f-1a15-7f02-a6bd-1305cab763e1 approved the concrete approach with zero blockers.
Executor01a10362-54b8-7381-b531-a6965948b052 owns the four named test files; main owns
this evidence, git and CI. No skips, retry-as-fix, assertions removed or gate changes.

MODIFY tests/backend-input-lan-hardening.test.ts, backend-hardening.test.ts,
generated-static-privacy.test.ts and node-template-portable.test.ts. Before: each
loads runtime config statically and buildApp can open inherited/default shared DB.
After: establish per-file owned temporary config/DB storage before all transitive
runtime imports; preserve real HTTP assertions; stop the queue worker, close DB and
remove only the owned temporary directory at teardown. Match the existing adjacent
agent-mode-queue-contract fixture convention. The real-app lan-session test already
uses isolateExecution/assertOwned and is excluded. No production helper is added.

## Root-cause alternatives and proof contract

H1 is shared inherited storage: independent processes can read the same migration
column snapshot before one adds a column. Source confirms inherited paths and the
hosted stack names that boundary. The controlled sentinel oracle proves path exposure
and its removal, not deterministic reproduction of the exact concurrent timing.
H2 is deterministic duplicate migration definitions: prior fresh main/release gates
passed, and this column has one migration addition; serial fresh-root probes and the
focused suite will check this alternative. H3 is input-validation regression: rejected
for the observed failure because initialization fails before listening or request dispatch.

Before/after commands use only temporary inherited config/DB sentinels. RED must
observe the original path exposure; GREEN must preserve sentinel bytes and exercise
all original assertions on each fixture's own DB. Main then runs the canonical suite,
test typecheck and independent diff review, followed by exact-head PR and dev CI.
Tests and devlog are excluded by .npmignore, so this fixture correction needs no
replacement or second publication of the already verified 3.26.2 runtime artifact.

Implementation evidence is appended below. Final hosted outcomes belong to the repair PR description and session receipts; this plan does not imply those checks already passed.


## Initial fixture proof

The unchanged backend-input-lan fixture failed twice with an inherited invalid
SQLite sentinel (2 pass / 3 fail, SQLITE_NOTADB). With a fresh empty inherited DB,
its five original tests passed. After isolation, the same invalid-sentinel invocation
passed all five tests and preserved sentinel SHA-256
`3b980967103ea0f9bc7f58c395c1018e05d7db1390c1f6e2b03df3028d0cdba1`.
The original five test bodies/assertions are byte-identical. Owned fixture directories
remaining: zero. Separate focused execution and test typecheck passed. This is
path-exposure RED/GREEN evidence, not a claimed deterministic duplicate-column race.


## Related fixtures

The other original sentinel runs were backend-hardening 4 pass/1 fail,
generated-static-privacy 0 pass/1 fail and node-template-portable 7 pass/1 fail,
all SQLITE_NOTADB before requests. Empty-DB controls passed 5, 1 and 8 tests.
After the same isolation repair, the same sentinel runs passed all 14 tests.
The four-file focused run passed 19/19 with no skips. Test typecheck passed;
assertion rows in the added three files (15/7/39) were preserved. Sentinel and
inherited-directory hashes stayed unchanged and all owned fixture roots were removed.

The repair also disposes each real app's LAN resources when its HTTP server closes.
No test coverage, auth/validation expectation, migration code or CI gate was removed.


A supplementary full run that forced IMA2_CONFIG_DIR globally failed two health
advertisement assertions: that fixture changes HOME and expects its advertisement
under the owned HOME, while the extra global config override redirected it elsewhere.
This was an invalid invocation for that existing fixture, not a passing gate. Main
removed that extra override and ran the repository's canonical `npm test` unchanged;
its result is recorded separately. No health assertion or product behavior was altered.


Main's canonical `npm test` completed with 4,144 tests: 4,141 pass, 3 skip,
0 fail. `node scripts/classify-tests.mjs --check --fail-js-runtime` and
`git diff --check` passed. The changed fixtures remain below 500 lines. Raw
RED/GREEN logs are in the session's temporary proof directories; canonical output
is `.codexclaw/release-3.26.2/fixture-canonical-tests.log`. Hosted acceptance remains
an exact-head repair-PR gate followed by the new dev push CI, recorded on the PR.
