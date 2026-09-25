---
title: "Issue #27 — Canvas Annotation SVG / Vector Export"
status: open / implementation-ready hardened
created: 2026-04-30
updated: 2026-05-16
github: https://github.com/lidge-ai/ima2-gen/issues/27
tags: [canvas, svg, vector, annotations, export]
---

# Issue #27 — Canvas Annotation SVG / Vector Export

## Goal

Export the current Canvas composition as an SVG/vector package. The first version
should vectorize the annotation layer, not trace the generated raster image.

Canonical issue:

- https://github.com/lidge-ai/ima2-gen/issues/27

## 2026-05-16 Implementation Lock

This issue remains open. It should start from the current annotation model and
avoid a Canvas framework migration.

Build policy:

- implement direct serialization in `ui/src/lib/canvas/svgExport.ts`;
- preserve source image natural dimensions as the SVG viewport;
- embed the source raster as a data/URL `<image>` element without local paths;
- serialize only Canvas annotations as vector elements;
- support unsaved local annotations;
- do not mutate Canvas state, write server files, or create a canvas version.

Acceptance-critical tests:

- add `tests/canvas-svg-export-contract.test.js`;
- assert `<svg viewBox>` dimensions, `<image>` embedding, escaped memo text,
  path/rect/arrow output, and no state mutation.

Out-of-scope lock:

- no Potrace/raster tracing;
- no Fabric migration;
- no SVG import back into Canvas Mode.

## Current Product Context

Canvas Mode already supports:

- source image display;
- zoom and pan;
- annotation tools;
- eraser;
- memo/sticky note behavior;
- background cleanup masks;
- alpha/matte export;
- canvas versions.

Relevant files:

- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`
- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
- `ui/src/hooks/useCanvasAnnotations.ts`
- `ui/src/types/canvas.ts`
- `routes/annotations.ts`
- `lib/db.ts` annotation persistence table
- `tests/canvas-annotation-contract.test.js`
- `tests/canvas-persistence-contract.test.js`

## Reference Libraries

### Option A — Direct SVG serializer from current annotation model

Reference links:

- SVG spec overview: https://developer.mozilla.org/en-US/docs/Web/SVG
- Canvas coordinates reference: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API

Approach:

- Read source image natural width/height.
- Create `<svg viewBox="0 0 W H" width="W" height="H">`.
- Embed source image with `<image href="data:image/...">`.
- Map normalized annotation coordinates to pixel coordinates.
- Serialize:
  - pen/freehand strokes to `<path>`;
  - boxes to `<rect>`;
  - arrows to `<line>` plus marker;
  - memos to `<foreignObject>` or `<text>` fallback.

Pros:

- Smallest dependency surface.
- Fits existing data model and tests.
- Easier to keep stable than a full Canvas framework migration.
- Avoids Fabric JSON/SVG security concerns.

Cons:

- More manual serialization code.
- Need explicit mapping for each annotation type.

Recommendation:

- Use this for the first #27 implementation.

### Option B — Fabric.js

Reference links:

- https://github.com/fabricjs/fabric.js
- https://fabricjs.com/docs/

Approach:

- Represent source image and annotations as Fabric objects.
- Use Fabric `toSVG()` for export.

Pros:

- Strong object model.
- Native SVG export.
- Useful if Canvas Mode later needs mature object selection/layers.

Cons:

- Requires migration or parallel object model.
- React synchronization risk.
- Security risk if untrusted Fabric JSON enters `toSVG()`.
- Reported SVG export XSS class: https://advisories.gitlab.com/npm/fabric/CVE-2026-27013/

Recommendation:

- Reference only for #27 first pass.
- Consider scoped adoption only after current model hits a hard limit.

### Option C — canvas2svg

Reference:

- https://github.com/gliffy/canvas2svg

Approach:

- Replay draw commands into an SVG-generating Canvas 2D context.

Pros:

- Small and conceptually close to canvas drawing.

Cons:

- Older and narrower.
- Does not understand ima2 annotation state.
- Harder to make memo/text export semantically clean.

Recommendation:

- Reference only.

## Preferred Diff Plan

### ADD `ui/src/lib/canvas/svgExport.ts`

Responsibilities:

- `exportCanvasAnnotationsToSvg(options)`
- convert normalized annotation coordinates to SVG pixel units;
- escape text;
- assign deterministic element ids;
- return `{ svg, width, height }`.

### MODIFY Canvas toolbar/action wiring

Candidate files:

- `ui/src/components/canvas-mode/CanvasToolbar.tsx`
- `ui/src/components/canvas-mode/CanvasModeWorkspace.tsx`

Add a visible export action:

- `Export SVG`
- disabled when no image is loaded;
- does not require saving a canvas version first.

### ADD tests

Candidate file:

- `tests/canvas-svg-export-contract.test.js`

Contracts:

- SVG uses natural image dimensions.
- Source image is embedded as `<image>`.
- Box annotation maps to `<rect>`.
- Pen/freehand maps to `<path>`.
- Memo text is escaped.
- Export does not mutate canvas state.
- No local filesystem paths are exposed.

## Out Of Scope

- Raster image vector tracing.
- Potrace-style conversion.
- Importing SVG back into Canvas Mode.
- Server-side write APIs.
- Full Fabric.js migration.

## Notes

True raster vectorization should remain a separate issue because generated images
do not convert cleanly into editable vector art without a dedicated tracing UX.
