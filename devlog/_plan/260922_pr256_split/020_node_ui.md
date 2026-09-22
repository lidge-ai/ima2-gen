# WP2: inspect node images and identify nodes

Class C3; dependency WP1. Ordinary PR on current dev.
Keep established Node Studio styling, shared lightbox and four dictionaries.

## Exact extraction
MODIFY ui/src/components/ImageNode.tsx and ui/src/styles/node-workspace.css:
7b32f495 lightbox plus 65dcdae0 portal and film icon.
First extract only copy-ID/header introduction and base styling from 450aa45b
(ImageNode.tsx, node-workspace.css, node.copyId in four locale dictionaries),
excluding its fashion/placeholder/video changes. Then apply header drag/icon
hunks from 0ebf2389 and truncation CSS from 253ce44c.
MODIFY four locale dictionaries: node.zoomImage and copy-ID labels only.
Use `git show <commit> -- <path>` as full pinned before/after appendix.
No role selector, fashion prompt enforcement, inherited video semantics or Runner.

ImageNode is already near the repository limit. NEW focused component
ui/src/components/node-canvas/NodeImagePreview.tsx owns preview/zoom/portal;
NEW NodeIdentityHeader.tsx only if header extraction is needed to stay below 500.
Search existing preview/header owners first; reuse AssetMediaLightbox.
```diff
- <img src={d.imageUrl} ... />
+ <NodeImagePreview imageUrl={d.imageUrl} prompt={d.prompt} ... />
- glyph implying video playback
+ existing-style film SVG with localized Generate video accessible name
+ copy-ID button independent of draggable header text
```
Transient preview-open state stays local, never serialized.
Role/video/runtime fields are N/A: not introduced in this slice.
Retain public generate action semantics and title translations.

## Proof
Sol executor owns these UI files and dedicated E2E; main owns docs/integration.
NEW ui/e2e/node-image-preview.spec.ts: synthetic ready image, zoom opens viewport
dialog outside scaled node, Escape closes and restores focus, copied ID correct,
drag label remains draggable and copy control does not drag. Use hosted fixture.
Keyboard and touch/focus make zoom reachable without hover.
Run UI build, affected root contracts, full suite, hosted E2E; inspect screenshot
at 1280x720 and narrow viewport. Update structure/04 and 05, regenerate 01.
Failure to open/close/focus or visible clipping blocks merge.
