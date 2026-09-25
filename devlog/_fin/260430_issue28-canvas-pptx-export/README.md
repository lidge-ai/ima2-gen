---
title: "Issue #28 — Canvas Composition PPTX Export"
status: open / implementation-ready hardened
created: 2026-04-30
updated: 2026-05-16
github: https://github.com/lidge-ai/ima2-gen/issues/28
tags: [canvas, pptx, export, pptxgenjs]
---

# Issue #28 — Canvas Composition PPTX Export

## Goal

Export the current Canvas composition as a PowerPoint deck. The MVP should create
a one-slide deck containing the current source image plus visible annotations.

Canonical issue:

- https://github.com/lidge-ai/ima2-gen/issues/28

## 2026-05-16 Implementation Lock

This issue remains open. The first implementation should be client-side and
should not wait for a server export route.

Build policy:

- add `pptxgenjs` as the PPTX writer dependency;
- add `ui/src/lib/canvas/pptxExport.ts`;
- create one 16:9 slide;
- fit the current source image/composition while preserving aspect ratio;
- include visible annotations, preferably by reusing #27 SVG overlay output;
- expose `Export PPTX` from Canvas toolbar with loading/error states;
- do not require saving a canvas version first.

Acceptance-critical tests:

- add `tests/canvas-pptx-export-contract.test.js`;
- assert dependency/package inclusion, toolbar action, utility import, no
  save-first requirement, and memo text/annotation payload path.

Manual QA:

- open the exported deck in PowerPoint, Keynote, or LibreOffice/Google Slides;
- verify image aspect ratio, annotation placement, readable memo text, and no
  local filesystem path leakage.

## Current Product Context

Canvas Mode already owns the required UI state:

- source image / canvas version image;
- annotation payload;
- memo/text annotation data;
- background cleanup preview;
- alpha/matte export settings.

Relevant files:

- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`
- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
- `ui/src/lib/canvas/*`
- `ui/src/types/canvas.ts`
- `tests/canvas-export-contract.test.js`
- `tests/canvas-apply-merged-contract.test.js`

## Reference Library

### PptxGenJS

Reference:

- https://github.com/gitbrent/PptxGenJS

Why it fits:

- Browser and Node support.
- Images, SVG, text boxes, and shapes.
- Can generate `.pptx` client-side without a server write.
- Better than manually writing OOXML.

Risks:

- Need manual slide coordinate mapping.
- Shape fidelity may differ between PowerPoint, Keynote, LibreOffice, and Google
  Slides.
- Freehand annotation might be better as an SVG/raster overlay rather than
  native PowerPoint primitives.

Decision:

- Direct adoption is recommended for #28.

## Implementation Options

### Option A — Raster snapshot MVP

Approach:

- Render current Canvas composition to a PNG.
- Put that PNG on a 16:9 slide.

Pros:

- Fastest.
- Least layout risk.
- Best visual fidelity.

Cons:

- Annotations are not editable in PowerPoint.
- Does not satisfy the richer "vector package" direction.

Use only if:

- MVP needs quick export and editability is deferred.

### Option B — Image + SVG overlay

Approach:

- Use source image as slide image.
- Generate SVG overlay for annotations using #27 exporter.
- Add SVG overlay on top via PptxGenJS.

Pros:

- Good fidelity.
- Reuses #27.
- Keeps source/annotation layers conceptually separate.

Cons:

- SVG editability inside PowerPoint may be limited depending on viewer.

Recommended:

- Yes, first complete version.

### Option C — Reconstruct annotations as PPT shapes

Approach:

- Source image as slide image.
- Boxes/arrows as native PPT shapes.
- Memos as native text boxes.
- Freehand paths as SVG/raster fallback.

Pros:

- More editable in PowerPoint.
- Better for user-facing "deck" workflows.

Cons:

- More mapping logic.
- PowerPoint shape coordinate quirks.

Recommended:

- Phase 2 after Option B.

## Preferred Diff Plan

### ADD dependency

- `pptxgenjs`

### ADD export utility

Candidate:

- `ui/src/lib/canvas/pptxExport.ts`

Responsibilities:

- create one-slide deck;
- choose slide dimensions;
- preserve source image aspect ratio;
- add image layer;
- add annotation SVG overlay or native shapes;
- trigger browser download.

### MODIFY Canvas toolbar

Add:

- `Export PPTX`

States:

- disabled when no current image;
- loading while export is building;
- error toast on failure.

### ADD tests

Candidate:

- `tests/canvas-pptx-export-contract.test.js`

Contracts:

- `package.json` includes `pptxgenjs`.
- export utility imports `pptxgenjs`.
- toolbar exposes PPTX action.
- export path can work without saving a canvas version first.
- memo text is included either as native text or documented fallback.

## Out Of Scope

- Multi-slide gallery export.
- Importing PPTX back into Canvas Mode.
- Theme/template editor.
- Perfect fidelity across every presentation application.

## Manual QA

At minimum, open exported files in:

- PowerPoint if available;
- Keynote on macOS;
- LibreOffice or Google Slides as fallback.

QA checklist:

- slide opens;
- image aspect ratio preserved;
- annotation placement visually matches Canvas Mode;
- memo text readable;
- no local filesystem paths leak into the deck.
