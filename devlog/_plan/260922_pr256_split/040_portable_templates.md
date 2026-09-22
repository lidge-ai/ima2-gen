# WP4: portable template files

Class C4 file input/export boundary. Depends on graph foundation, not workflow.
Exact source: 6a596ea0 template-only hunks; omit lib/wfChain.ts change.

## Change map
NEW lib/nodeTemplateFile.ts from source with English existing-style names.
MODIFY routes/nodeTemplates.ts; ui/src/lib/api-node-templates.ts;
ui/src/components/node-canvas/{NodeTemplatePicker,useNodeTemplateController,
useNodeStudioController,NodeStudioOverlays}.tsx/ts as their current extensions.
Only add onExport/onImport props to overlays; do not import Runner/toolbar changes.
MODIFY ui/src/styles/node-canvas-extras.css and four locale template keys.
NEW tests/node-template-portable.test.ts adapted from pinned source.
Complete extraction: `git show 6a596ea0 -- <listed template paths>`.

## Required parser/export corrections
```diff
- typeof version === "number" && version <= 1
+ version === 1
- JSON.stringify(body).length
+ Buffer.byteLength(JSON.stringify(body), "utf8")
- (name + suffix).slice(0, 80)
+ name.slice(0, 80 - suffix.length) + suffix
- export raw stored graph
+ export portable graph with runtime identity/media removed
```
Use existing store validation, additionally reject duplicate IDs/edge IDs,
dangling edges, cycles and malformed/oversized nested shape at portable ingress.
Bound name/description/tags and graph node/edge count/depth. Client checks file
size before file.text; server independently enforces actual bytes.
Portable sanitation must remove runtime image/video URLs, source refs, server
node IDs, request/pending/recovery IDs and secret-looking fields at all graph
levels while preserving prompts/providers/layout/edge order. Do not silently
change legacy template store contracts; sanitation belongs to portable boundary.
Source sourceId is informational; imported templates get new IDs and never run.

Field chain: versioned envelope constructed at export, JSON download, JSON
upload/parse, strict portable validator, existing store.create, fresh-ID
instantiate, UI summary. Unknown version fails rather than partial import.

## Tests and delivery
Sol executor owns backend parser/routes/tests; separate UI executor owns
picker/client/controller/E2E. Main owns documents and final integration.
Roundtrip seed/user, fresh IDs, graph ordering, duplicate 80-char name,
wrong kind/version (0, negative, fractional, future), Unicode byte overflow,
malformed JSON, cycles/dangling/duplicates, nested secrets/runtime media and no
automatic execution. NEW hosted template portability E2E downloads/imports and
checks visible result/error and focus.
Run focused tests, typechecks, inventory, full tests/UI build and hosted E2E.
Update docs/API.md and structure/03/04/05; regenerate line counts and inventory.
Boundary: server file parser, UI file guard only usability; direct HTTP bypass
covered with route tests. Reject raw payload leaks in error messages.
