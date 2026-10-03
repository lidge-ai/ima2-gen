# wp1 security remediation evidence

2026-10-03; scoped executor evidence on the dependency carry tree (starting HEAD `0274a4a3`). Local environment: Node `v24.17.0`, npm `11.18.0`, macOS. Independent review and browser/PPTX validation remain main-owned gates; this document does not certify release readiness.

## Decision and threat boundary

The approved final amendment in `010_dependencies.md` permits the existing unreachable-path exception policy after executable proof. Attacker-influenced asset filenames cross `lib/systemTrash.ts:19` into trash. The reviewed advisory concerns nested pattern parsing. The sole first-party caller disables glob expansion. No production trash behavior, audit matcher, severity threshold, root manifest or root lock was changed by this worker.

Configuration reuse is sufficient for UI remediation. The root remedy uses the already-established exception mechanism; it does not patch or remove braces. The source/lock guards and regression must be revalidated on dependency or caller changes and before expiry. No new runtime abstraction or library was added.

## UI dependency patch

`ui/package.json` adds only `overrides.pptxgenjs.image-size = "2.0.4"`. `ui/package-lock.json` changes image-size `1.2.1` to `2.0.4`, updates its registry URL/integrity and Node requirement (`>=18`), removes its obsolete queue dependency, and removes queue `6.0.2`. No other lock entries changed in this worker's diff. The pre-existing root Node requirement is `>=22`.

Command: `npm --prefix ui install --ignore-scripts`.
Result: exit 0; removed 1 package, changed 4 installed packages, audited 129; `found 0 vulnerabilities`. Install scripts were not executed. The lockfile was then frozen for the independent frontend worker.

Command: `npm --prefix ui audit --audit-level=high --json`.
Result: exit 0; all vulnerability tallies are zero, including high and critical. The obsolete two UI image-size exceptions were removed only after this result and both root evidence groups passed.

Browser mapping/bundle exclusion and real browser PPTX export remain assigned to the independent frontend QA worker. This evidence makes no claim about Node pptxgenjs compatibility, rendered UI, or export success.

## Exact root graph and caller guard

The production lock and installed packages match:

`trash@10.1.1 → globby@14.1.0 → fast-glob@3.3.3 → micromatch@4.0.8 → braces@3.0.3`.

`tests/system-trash-glob-safety.test.ts` verifies exact production incoming edges, versions, unique package locations, and installed versions. A second production dependency edge into this chain fails the test. Its first-party source scan uses the existing TypeScript preprocessor to inspect static/dynamic imports, re-exports and require calls, including package subpaths; it expects only `lib/systemTrash.ts → trash`. Synthetic positive cases cover each import form for every package. This is an import guard, not general-purpose dynamic-code taint analysis.

Searches used: `executionTestProcess`, `mock.module`, `trash|globby|fast-glob|micromatch|braces`. Reused the existing `tests/_executionTestProcess.ts` child isolation helper and `scripts/audit-gate.mjs` functions. The graph suite is adjacent to the existing audit suite to keep files below 500 lines.

## Real-package boundary and mutation

The child process imports real `trash` and real `moveToSystemTrash`. It replaces only globby with a counted throwing sentinel and all four OS trash implementations with path-capture mocks. The `IMA2_TEST_SYSTEM_TRASH_DIR` seam is absent. No OS recycle-bin operation runs. Only synthetic mkdtemp fixtures are removed by cleanup.

Observed macOS cases: ordinary name, literal braces, brackets, leading exclamation, star and question mark; one relative single-file call and one absolute multi-file call. All six files remain present after the mocked platform boundary, and received paths match exact resolved literal paths. Star/question mark cases are conditional on non-Windows filename support.

GREEN command:

```sh
node --import tsx --test tests/system-trash-glob-safety.test.ts tests/audit-trash-graph-contract.test.ts
```

Result before exception creation: exit 0; six audit tests and isolated parent fixture passed; the child ran all three safety tests with zero failures/skips. Runtime diagnostic: `{"literalFiles":6,"platformCalls":2,"globCalls":1,"realOsCalls":0}`. The one globby call is the explicit real-trash `glob:true` positive control; both wrapper calls caused zero globby calls. The positive control throws the exact sentinel before reaching a platform implementation.

RED mutation: replaced only `trash(paths, { glob: false })` with `trash(paths)` temporarily and ran `node --import tsx --test tests/system-trash-glob-safety.test.ts`. Exit 1; the real-package behavioral test failed with `Error: GLOBBY_PATTERN_PARSER_REACHED`. The graph/caller checks still passed, demonstrating behavioral sensitivity rather than a source-string assertion. Source restoration ran in `finally` and verified byte equality. Restored SHA-256:

`5cfd20eb5fa5273d62152772bd1ce0550d57e38f2e5761b2a730e723f64b4e5e`.

GREEN after restoration: same two-file command exited 0, including all three child cases. `git diff -- lib/systemTrash.ts` is empty.

## Import-time source review

The behavioral sentinel replaces globby and therefore alone does not establish the real dependency tree's import-time behavior. Installed source inspection supplies the separate proof:

- `node_modules/trash/index.js:4` imports globby, but the only pattern call is inside `trash()` and its `if (glob)` branch (`:11`, `:20`). Paths are otherwise checked by lstat and resolved before platform dispatch.
- `node_modules/globby/index.js:87` defines a higher-order argument normalizer. Export initialization at `:220` constructs a function; pattern generation and fastGlob execution occur inside its callback (`:225`, `:229`). Synchronous and stream exports use the same deferred shape. `globby/ignore.js:68` and `:89` likewise defer ignore-file pattern work to exported calls.
- `node_modules/fast-glob/out/index.js:8` places source validation and work creation inside FastGlob; `:88` places task generation inside getWorks. Its top-level IIFE attaches method references, including sync/stream/posix/win32 helpers, rather than supplying user patterns.
- `node_modules/micromatch/index.js:4` imports braces. Its brace parser calls occur inside `micromatch.braces` (`:451`) and `braceExpand` (`:463`).
- `node_modules/braces/index.js:22` defines the exported callable; parse/compile/expand/create are deferred functions (`:58`, `:96`, `:120`, `:155`). `node_modules/braces/lib/parse.js:31` defines the parser and `:331` exports it. Importing these modules defines functions/constants; it does not supply user pattern input to the vulnerable parser.

This proves the inspected filename-to-pattern boundary; it does not claim all possible third-party behavior is secure.

## Audit exclusion evidence

`tests/audit-trash-graph-contract.test.ts` fixtures the actual five-node propagated high-severity graph. Six tests establish: exactly those five findings excluded by one root braces GHSA; another braces advisory restores all five; an unrelated high remains; mixed/unknown/empty via fails closed; wrong scope/package cannot widen coverage; and expiry at exactly `2026-10-17T00:00:00.000Z` restores all findings. Clock fixtures are pinned, including one millisecond before expiry.

The pre-existing `tests/audit-gate-contract.test.ts` retains all negative cases. Its high-findings CLI fixture now supplies two unrelated per-advisory entries alongside the tally, so it exercises the same rejection with or without a shipped root exception. Its assertions were not weakened.

Only after these and the real-package tests passed was `scripts/audit-exceptions.json` updated to one entry: `GHSA-vfj7-8cjw-p6xm`, package `braces`, scope `root`, expiry `2026-10-17T00:00:00.000Z`. Evidence references both new suites, the existing suite and this document.

Command: `npm audit --omit=dev --audit-level=high --json`.
Result: exit 1, raw **5 high, 5 moderate, 0 critical**. All five highs are the reviewed braces chain. This is a time-limited unreachable-path exception, not a fixed dependency or clean raw root audit. Moderate packages reported: ajv, fast-uri, hono, ip-address, qs; they are not excepted or changed in this task.

Commands and results:

```text
node scripts/audit-gate.mjs --omit dev --audit-level high
  exit 0; no unexcepted high+ vulnerabilities (5 excluded)
  excluded: braces, micromatch, fast-glob, globby, trash
node scripts/audit-gate.mjs --prefix ui --audit-level high
  exit 0; no high+ vulnerabilities in ui dependencies
node --import tsx --test tests/system-trash-glob-safety.test.ts tests/audit-trash-graph-contract.test.ts tests/audit-gate-contract.test.ts
  exit 0; 33 parent tests passed; safety child 3/3 passed; no failures/skips
npm run typecheck:tests
  exit 0
node scripts/classify-tests.mjs
  547 files: 248 runtime / 299 contract
```

Main independently owns root typecheck, broad gates, hosted CI and review before merge. No commit, push, branch operation, server start, or deployment was performed by this executor.

## Broad-gate cleanup follow-up

Main's broad suite identified a new cleanup-contract failure: the sentinel fixture's `rmSync` lacked retry options. Updated only `tests/system-trash-glob-safety.test.ts:63` to the existing repository pattern, `maxRetries: 10, retryDelay: 100`. The cleanup still targets only this test's synthetic mkdtemp directory. No production mutation or assertion change was needed.

Command: `node --import tsx --test tests/system-trash-glob-safety.test.ts tests/test-temp-cleanup-contract.test.ts`.
Result: exit 0; 3 parent tests and all 3 safety child tests passed, zero failures/skips. Both cleanup-contract cases passed, including “never removes a temp tree without retries”; the real-trash diagnostic remained `{"literalFiles":6,"platformCalls":2,"globCalls":1,"realOsCalls":0}`. Main owns the emitted server/CLI artifact repair and subsequent broad rerun.
