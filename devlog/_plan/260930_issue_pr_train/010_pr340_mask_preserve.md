# 010 wp2 — PR #340 keep pixels outside the mask

Class C3 (edit route output contract, default-on flag). Contributor branch
ree9622:feat/preserve-outside-mask, head 4049f5a9.

## Steps

1. In a /tmp worktree on the PR head, `git merge origin/dev`; resolve
   `docs/migration/runtime-test-inventory.md` by regenerating it with
   `node scripts/classify-tests.mjs` (the `test:inventory` script is the same file with
   `--check --fail-js-runtime`), and re-check `structure/01` line counts.
2. Verify: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`,
   `npm run test:inventory`, `node --test tests/masked-edit-composite.test.ts
   tests/provider-execution-edit.test.ts tests/provider-surface-boundary.test.ts
   tests/cli-config-keys-contract.test.ts tests/cli-output-recovery-contract.test.ts
   tests/structure-line-counts-contract.test.ts`.
3. Fold the sol reviewer's blockers as small commits on the contributor branch.
4. Push to the contributor branch, wait for the PR fast gate, merge with a merge commit
   (keeps the contributor's commits), post a short thank-you/summary comment.

## Acceptance

- The PR is MERGED into dev; PR fast gate green on the final head.
- Masked edit saves the composite; unmasked edit and flag-off save provider bytes (tests above).
- Composite failure falls back to provider bytes with one `mask_preserve_failed` warning
  (activation: truncated mask in `masked-edit-composite.test.ts`).

## Reviewer verdict

Confucius (gpt-6-sol, agent 01a0ede8-c65d-7793-b91a-ab91e749e87f): MERGE-WITH-FIXES. Mask convention
matches ui/src/lib/canvas/maskRenderer.ts:33; config key, fallback, sidecar, alphaVerified correct;
CLI and canvas go through /api/edit, node/multimode have no mask flow. Focused tests exit 0 at
pr/340 + origin/dev.

B1 (accepted) — transparent kept pixels: keptSourceLayer multiplies source alpha by mask alpha and
lays it `over` the result, so where the source is transparent the provider pixel shows through
inside the keep area. Fix in lib/maskedEditComposite.ts: blend raw RGBA per channel,
`out = src*m + res*(1-m)` with m = maskAlpha/255, and keep an alpha channel only when some output
pixel has alpha < 255 (an all-opaque output stays RGB, so alphaVerified keeps its meaning).
Test: source with a transparent kept pixel, opaque blue result, mask keep → output pixel alpha 0.

B2 (amended) — memory on huge inputs: bound the composite, not the route (a pre-dispatch route cap
is a separate edit-route contract change). The bound is set in the A amendment below; above it
sharp throws and the existing fallback saves the provider bytes with one mask_preserve_failed.

### A amendment (Faraday audit FAIL #1)

50 MP is too loose with up to 12 parallel jobs. Final bound: `limitInputPixels` = 4096 × 4096
(16,777,216 px) on every sharp() in the composite, and composites run one at a time through a
module-level queue. Peak raw memory is then about 4 buffers × 67 MB ≈ 270 MB for the single
composite in flight, whatever the job concurrency. Sources above 4096² keep the provider bytes
through the fallback (one mask_preserve_failed warning). docs/API.md states the bound.
Tests: a PNG declaring 4097 × 4096 is rejected by preserveOutsideMask; two concurrent composites
both succeed (queue does not deadlock or drop a job).

Reflection (Confucius, same agent): ALIGNED. Gap: oversized sources are not rejected before the
provider call, so a >4096² masked edit saves unpreserved provider bytes. Disposition: kept as is.
/api/edit accepts such requests today; rejecting them pre-dispatch is an edit-route contract change
outside this PR. The fallback is logged and the sidecar omits maskOutsidePreserved, and docs/API.md
states the bound.
