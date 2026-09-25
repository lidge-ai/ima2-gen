---
title: "Issue #31 — Provider-Backed Masked Edit"
status: open / implementation-ready hardened
created: 2026-04-30
updated: 2026-05-16
github: https://github.com/lidge-ai/ima2-gen/issues/31
tags: [canvas, edit, mask, inpaint, provider]
---

# Issue #31 — Provider-Backed Masked Edit

## Goal

Turn the current Canvas mask-edit affordance into a verified provider-backed
feature. Do not fake masked edit through prompt-only full-image edits.

Canonical issue:

- https://github.com/lidge-ai/ima2-gen/issues/31

## 2026-05-16 Implementation Lock

This issue remains open because true provider-backed mask semantics are not yet
proven. Existing groundwork is useful, but the product must stay fail-closed
until a provider contract is verified.

Build policy:

- keep `IMA2_OAUTH_MASKED_EDIT_ENABLED` default off;
- reject unsupported masked edit before the upstream provider call;
- never silently fall back from requested mask edit to prompt-only full-image
  edit;
- send source image and mask as matching PNG bytes after provider contract proof;
- default clean edit input must not use merged annotation/export raster;
- logs may include mask presence, bytes, and dimensions, never raw mask data.

Guided-edit policy:

- marked-up raster guidance can exist only as an explicit mode;
- when used, prompt text must instruct the model to treat marks as edit
  guidance and remove guide marks from the final image;
- guided edit does not close the true provider-backed mask requirement.

Acceptance-critical tests:

- keep/extend `tests/edit-mask-api-contract.test.js`;
- keep/extend `tests/oauth-masked-edit-contract.test.js`;
- keep/extend `tests/oauth-proxy-edit-mask-contract.test.js`;
- add or extend `tests/canvas-edit-mask-flow-contract.test.js` for clean
  raster vs merged-raster leakage.

## Current Product Context

Existing groundwork:

- Canvas UI can render masks from annotations.
- `routes/edit.ts` validates optional PNG masks.
- `lib/responsesImageAdapter.ts` passes mask content as guidance on the API
  provider path.
- OAuth path has a feature flag and explicitly blocks unsupported masked edit.
- Docs say current mask behavior is guided edit, not pixel-perfect inpaint.

Relevant files:

- `ui/src/lib/canvas/maskRenderer.ts`
- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
- `routes/edit.ts`
- `lib/responsesImageAdapter.ts`
- `lib/oauthProxy/generators.ts`
- `config.ts`
- `tests/edit-mask-api-contract.test.js`
- `tests/oauth-masked-edit-contract.test.js`
- `tests/oauth-proxy-edit-mask-contract.test.js`

## Reference Libraries

### react-canvas-masker

Reference:

- https://github.com/3rChuss/react-canvas-masker

Fit:

- Brush-based mask drawing.
- Zoom/pan.
- Undo/redo.
- PNG mask output.
- Good UX reference for image-editing mask tools.

Use:

- Reference mask brush behavior.
- Reference extraction of black/white mask PNG.
- Do not replace current Canvas Mode unless it saves real code.

### Fabric.js

Reference:

- https://github.com/fabricjs/fabric.js

Fit:

- Free drawing brush and object model could support mature mask authoring.

Risks:

- Big migration.
- React synchronization complexity.
- SVG security note if used for export.

Use:

- Reference only for #31 unless broader Canvas Mode rewrite is approved.

## Provider Contract Risk

The important risk is not the mask UI. It is provider semantics.

The feature must answer:

- Does the selected provider accept a true image edit mask?
- Is the mask interpreted as transparent-edit area, white/black guide, or only a
  visual reference?
- Does the provider guarantee region-limited edits?
- What error shape is returned when mask is unsupported?
- Can OAuth and API providers differ?

Until this is verified, UI copy must not say "true inpaint" or "only edit this
region".

## Preferred Diff Plan

### Phase 1 — Contract proof

Tasks:

- Add a dev-only/manual smoke procedure.
- Record provider payload shape.
- Confirm whether mask changes only the intended region as much as provider
  allows.
- Keep logs to metadata only: mask present, bytes, dimensions.

Do not log raw mask data.

### Phase 2 — API route hardening

Files:

- `routes/edit.ts`
- `lib/responsesImageAdapter.ts`

Requirements:

- Preserve current mask validation.
- Source image and mask dimensions must match.
- Mask must be PNG with alpha.
- Do not silently fall back to full-image edit when mask is requested.
- If provider rejects mask, return stable actionable error.

### Phase 3 — OAuth gate

Files:

- `config.ts`
- `lib/oauthProxy/generators.ts`

Requirements:

- Keep `IMA2_OAUTH_MASKED_EDIT_ENABLED` default off until verified.
- When off, reject before upstream call.
- When on, forward only after payload contract is proven.

### Phase 4 — UX copy

Files:

- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
- `ui/src/i18n/*.json`

Copy policy:

- If true provider mask is verified: "Edit selected area".
- If only guided edit is available: "Use mask as edit guidance".
- Never overpromise pixel-perfect inpainting.

## Tests

Add or extend:

- `tests/edit-mask-api-contract.test.js`
- `tests/oauth-masked-edit-contract.test.js`
- `tests/oauth-proxy-edit-mask-contract.test.js`
- `tests/canvas-edit-mask-flow-contract.test.js`

Contracts:

- invalid masks rejected before provider call;
- raw mask is never logged;
- no prompt-only fallback when mask is present;
- unsupported provider returns explicit error;
- UI copy distinguishes true mask vs guided edit.

## Out Of Scope

- SVG/PPTX export.
- New background removal model.
- Replacing Canvas Mode editor library.
- "Magic" full auto inpaint.
