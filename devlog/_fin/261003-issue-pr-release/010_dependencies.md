# Dependency inputs

Depends on wp0. C4 dependency/release-input change; bounded to manifest/lock pins and CodeQL. Reuse exact reviewed upstream patches in 011 companions; no production logic changes.

## File delta

- MODIFY package.json: @modelcontextprotocol/sdk 1.30.0 → 1.30.1; @openai/codex 0.155.1 → 0.158.0; eslint 10.10.0 → 10.11.0; typescript-eslint 8.70.0 → 8.70.1.
- MODIFY package-lock.json: carry #361 and #362 resolved dependency/integrity updates, preserving the current root version and all unrelated packages.
- MODIFY ui/package.json and ui/package-lock.json: @xyflow/react range ^12.11.6 → ^12.12.0, system 0.0.82 → 0.0.83, @types/d3-selection 3.0.11 → 3.0.12 and matching integrity.
- MODIFY .github/workflows/codeql.yml: init/analyze pinned SHA 1c5b675653bb5c22dbe9b12b556ec555138e09fd → 2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2; leave job permissions, checkout identity and triggers intact.
- MODIFY devlog/_plan/README.md: insert this active unit; docs-only changelog records dependency intent without premature release version claims.

No new data fields or persistence format. No-op leaves stale reviewed fixes; configuration reuse is sufficient, so no new runtime abstraction. Before applying, compare upstream patch baselines to current dev; amend any conflict explicitly.

## Execution and proof

Main applies each pinned patch preserving source author in commits; bounded worker verifies dependency compatibility, no branch operations. Install root and UI dependencies using npm ci with repository script policy. Run typecheck then npm test and UI build, plus lint/typecheck:tests/native-deps/inventory/audit gates as appropriate. Use hosted PR Fast Gate and CodeQL at the final head as authoritative Linux integration; post-merge CI covers supported platforms. New UI dependency alone does not change screen design; use existing Node UI smoke and screenshot of tested UI for the carry if the gate requires it.

Create an ordinary dev PR containing only this dependency delta and roadmap docs. Merge only after expected jobs execute successfully, then inspect dev CI. Source #360–363 may be superseded with exact carry references only after landing. Failed install, lock mismatch, lint regression or UI smoke is a blocker requiring repair.

## Fresh security amendment

Baseline raw audit: root 5 high (trash10.1.1→globby14.1.0→fast-glob3.3.3→micromatch4.0.8→braces3.0.3, GHSA-vfj7-8cjw-p6xm); UI 2 high propagated from image-size1.2.1 (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr). Pinned source #361 does not remove these paths.

Additional MODIFY ui/package.json: add `overrides: { pptxgenjs: { "image-size": "2.0.4" } }`; regenerate UI lock to this patched parser. MODIFY scripts/audit-exceptions.json: remove the two image-size exceptions after confirming raw UI high=0. This 1→2 override is accepted only for the actual browser-only PPTX use: pptxgenjs browser mapping excludes image-size; verify build/bundle exclusion and actual PPTX export before merging. This is not a claim of Node pptxgenjs API compatibility.

Root braces has no patched published version as of investigation. At wp1 P inspect npm's trash9 remediation candidate against actual systemTrash semantics and dependencies. No new root exception is authorized by this plan; unresolved high severity blocks merge/release. Exact root remediation must be documented and independently audited before B. If no compatible remedy exists, finish independent scoped work and obtain explicit direction for the concrete remaining security decision.

## wp1 P continuity and security decision review

Previous D: roadmap locked at fa41f741; dependency/remediation wp1 next. Current dev and five pinned upstream heads remain unchanged. Existing dependency checks passed on the baseline; no implementation has started.

The no-exception assumption above is under explicit design review against the repository's pre-existing policy in scripts/audit-exceptions.json: evidence-proven unreachable paths may receive exact GHSA/scope/expiry entries. A trash9 downgrade is rejected: it regresses macOS multi-file Put Back, Linux trashinfo/mount fixes and WSL destination behavior. No native library replacement will be improvised. Architect and independent security reviewer must settle whether a narrow unreachable-path entry meets that existing policy before B. If approved on evidence, document it as an exception, never as removal of the vulnerable dependency or a clean raw root audit.

## Final wp1 P amendment: existing unreachable-path policy

Main accepts ARCH-02 security reflection and independent review requirements. This paragraph supersedes the earlier no-root-exception assumption: applying the already-established scripts/audit-exceptions.json unreachable-path policy is permitted only AFTER the following executable evidence passes. No audit matcher or severity threshold changes.

NEW tests/system-trash-glob-safety.test.ts: use existing executionTestProcess isolation and node module mocks. Import the REAL trash package and real moveToSystemTrash; replace globby with counted throwing sentinel and mock only trash's four platform implementation modules to capture paths. Ensure the IMA2_TEST_SYSTEM_TRASH_DIR seam is absent. Create disposable files under mkdtemp, including literal braces/brackets/star/exclamation names where the OS supports them; real package must deliver resolved paths to platform mock and never invoke globby. Positive control calls real trash with glob:true and must hit sentinel. Mutation removes glob:false temporarily, observes failure, restores source. Clean only created fixture files. Also assert the production lock graph has exactly the inspected trash→globby→fast-glob→micromatch→braces path and scan first-party production imports so another consumer invalidates this exception. Record import-time parser source review: no user pattern is evaluated on import.

MODIFY tests/audit-gate-contract.test.ts (or NEW focused adjacent test if file limit requires): fixture the actual five-node propagated graph; verify one exact root braces GHSA excludes exactly that graph; another braces advisory, unrelated high, mixed or unknown via, wrong scope/package and expired entry still fail. Preserve existing negative tests. Pin time in expiry tests; do not rely on current date to fake approval.

After BOTH evidence groups pass, MODIFY scripts/audit-exceptions.json: replace obsolete UI entries with ONE root entry:

```json
{"ghsa":"GHSA-vfj7-8cjw-p6xm","package":"braces","scope":"root","reason":"Unreachable vulnerable pattern parsing: the sole production trash caller passes glob:false; real installed trash regression and a positive control verify the glob boundary. Maintainers revalidate on dependency/caller changes and before expiry.","evidence":"tests/system-trash-glob-safety.test.ts; tests/audit-gate-contract.test.ts; devlog/_plan/261003-issue-pr-release/012_security-evidence.md; trash10.1.1/globby14.1.0/fast-glob3.3.3/micromatch4.0.8/braces3.0.3","expires":"2026-10-17T00:00:00.000Z"}
```

NEW 012_security-evidence.md records exact graph, source anchors, mutation/positive-control result, raw audit retained highs, policy gate result, UI parser patch/PPTX smoke and reviewer disposition. The root raw audit remains high and must be reported as a time-limited unreachable-path exception, not a fixed dependency.

Delegation write scope: dependency worker owns package*.json, ui/package*.json, .github/workflows/codeql.yml, scripts/audit-exceptions.json, tests/system-trash-glob-safety.test.ts, bounded new audit graph test if needed, docs/migration/runtime-test-inventory.md, 012_security-evidence.md. Main alone owns cherry-pick/commits/PRs and other roadmap docs. No new native trash implementation or downgrade. Security reviewer rechecks runtime evidence before merge. Frontend worker handles only browser/PPTX verification artifacts under .codexclaw and existing QA outputs, no overlapping source edits.

Threat model: asset deletion can carry attacker-influenced filenames from local assets across the application→trash package boundary. The advisory requires pattern parsing of nested braces, not mere module import. The existing literal-path call disables that parser; platform recycle-bin execution remains unchanged. A second production parser consumer, loss of glob:false, unknown advisory behavior or changed dependency graph invalidates this assumption and blocks the exemption. UI imported image bytes are handled by browser decoders; its excluded Node parser is still upgraded to a patched version. Evidence must show these specific boundaries, not a general claim that dependencies are secure.

## B verification repair: transient test-server socket reuse

The first broad suite required emitted server/CLI JS; main built those artifacts using existing scripts. It also reported billing-source.test.ts `reports env` ECONNRESET. Hypotheses: H1 shared HTTP keep-alive agent reuses a socket from a stopped test server (falsifier: no reused socket on failing probe); H2 route response/auth regression (falsifier: reproduce with trivial server and no application route); H3 external network/load interruption (falsifier: deterministic loopback lifecycle probe). A minimal loopback same-port stop/relisten probe reproduced 10/20 ECONNRESET failures, every failed request `reusedSocket:true`; with agent:false, 0/20. Thus H2/H3 cannot explain the reproduced defect.

C1 bounded repair MODIFY tests/billing-source.test.ts getJson request options: add `agent: false` so a one-request ephemeral server never borrows globalAgent's stale pooled socket. No production behavior changes, no retries/timeouts/skips. Existing billing assertions remain; rerun billing test and broad suite after runtime build. Probe stored task-locally in .codexclaw/billing-socket-probe.mjs. This is a verification fixture repair discovered by the dependency acceptance run, not a new feature phase.
