# WP8: fashion specialization and source accounting

Class C3 specialization, C4 when writing shared references. Depends WP4/WP5/WP7.
Source final e3a731cb fashion files and mixed hunks from e60a69ee onward.

## Exact extraction
NEW lib/moTaTrangPhuc.ts, ui/src/lib/moTaTrangPhuc.ts and original scripts
wf-doi-do.mjs / wf-chup-thoi-trang.md (convert docs/symbols to existing English
convention while retaining original attribution). NEW lib/nodeTemplateThoiTrang.ts
split into shared builder/schema and concept data (<500 lines/file).
MODIFY lib/nodeTemplateSeeds.ts registration; add fashion role/description fields
to generic node role owner (original vaiTroNode.ts) and dictionary mappings.
Integrate explicit outfit-specialization calls in generic workflow dispatch;
only this slice introduces TRANG_PHUC, model/extract/dress/scene behavior.
NEW tests/fashion-template-library.test.ts and behavioral outfit sequencing tests.
Source full diffs are `git diff 5f33e44a e3a731cb -- <listed paths>`;
shared workflow hunks are identified by moTaTrangPhuc/TRANG_PHUC imports/calls.
.gitignore browser-profile entries move with scripts if those paths remain;
generated exploratory directory ignores have no runtime behavior and may be
rejected as unrelated personal workspace configuration with explicit accounting.

## Semantics and controls
Fashion template builder provides ten concepts, fixed extraction prompt,
editable model description, consistent location and ratio. Locale-aware labels.
Outfit extraction and description finish before dress/scene dispatch. Missing
required outfit image is rejected during preflight, before any provider work.
This unit offers no invented-garment opt-in. Preserve manual override precedence.
Replace only derived/generated garment references, retain user-attached refs.
Repeat run with a new outfit cannot reuse old description/image. No standalone
script may read existing user credentials or launch browser profiles automatically.

Field chain: fashion role and outfit description created by template/UI/readout,
stored in graph where intentional, rehydrated and consumed by dependent prompt
substitution and reference builder. Derived transient pending phase stripped
during save; old graphs lacking specialization fields remain ordinary nodes.
No new provider routing or paid live calls: provider behavior is mocked at existing
HTTP boundary; actual visual fidelity remains unclaimed.

## Final verification/disposition
Sol specialist reviews field propagation and repeated-run behavior; fresh final
Sol reviewer assesses exact PR head plus coverage. Tests activate missing input,
partial extraction failure, sequential runs with different outfits, explicit
description override, multiple consumers and user-ref retention.
Full gates and hosted fashion flow smoke when merge-ready. If dependencies remain
draft, publish ordinary manual child PR with parent base so review shows only
specialization. Do not merge child ahead of dependencies.
Account for every original changed path in 008_source_accounting.md: adopted
slice, reconstructed equivalent or rejected behavior with rationale. Recheck
original source SHA for new commits; additional commits are reported separately.
Final report lists each PR, merged/draft disposition, exact dev SHA and evidence.
Verify original #256 remains open unless maintainer separately authorizes closure.
Archive this unit to existing _fin only when its stated disposition/delivery is
complete; retain any actual implementation follow-up in _plan if needed.
