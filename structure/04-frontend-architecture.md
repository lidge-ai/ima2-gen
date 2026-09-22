---
created: 2026-04-23
tags: [ima2-gen, React, frontend, Zustand]
aliases: [ima2 frontend, ima2 React UI, image_gen frontend]
---

# Frontend Architecture

API image model is a distinct optional `imageToolModel` in generation defaults.
`GenerationControlsPanel` uses the shared Select; default/upstream stays unselected.
Classic, edit, multimode and node requests forward it only for the API lane. Provider
switches clear it; leaving 2.5 selection resets xhigh/max quality to medium. Four
locales share the labels, and 2.5 pricing shows estimate unavailable until measured.

LAN startup is owned by `ui/src/lib/lanSession.ts` and `main.tsx`: remove URL tokens
before async work, confirm a session cookie, then import App. `LanSignIn.tsx` uses
pure locale helpers and dictionaries, not the store-dependent i18n barrel. Expiry
replaces private UI with sign-in. The existing API core observes first-party LAN401;
auth epochs prevent old unsent retries/waiters from replaying after login. SSE pauses
its transport but keeps accepted subscriptions/cursor/deadlines; inflight polling
stops and authenticated mount reconciles. Tokens never enter browser storage.

Composer pane geometry lives in `ui/src/styles/composer-panes.css`; sidebar,
classic dock and mobile sheet styles allocate host space. NAI paired inputs keep
content-aware scrolling: sidebar dual floors72px, bottom86–148px, mobile160px,
Home168px/144px at<=480px. Both grids collapse at719px query-container width;
non-NAI wrappers remain `display: contents`. Enabled placeholders and identifying
pane/Home-input borders use the existing `--text-muted` role. Classic pane borders
share the same `--r-md` radius as their clipping shape.
The mobile navigation background is opaque `--bg` so scrolling content cannot
bleed through its labels; fixed positioning and safe-area allocation are unchanged.
The mobile rail scrolls horizontally inside its own boundary, keeps nonshrinking
44px targets and reveals its active or keyboard-focused destination without scrolling the document.
In short NAI bottom docks, the empty disabled reference tray is hidden to preserve
editing space; retained references and other providers keep their tray.

Classic and Home retain separate submit policies. Their positive and negative
fields suppress Ctrl/Cmd+Enter during composition using local refs, native
`isComposing` and the229 compatibility signal; compositionend never submits.
Leaving NAI clears the hidden negative field's composition ref, not its stored draft.
The CSS-hidden desktop RightPanel is not mounted on mobile, preventing an invisible
legacy backdrop/focus trap from covering Node and mobile composer controls.
Node HUD toolbar, selection actions and element tray use separate vertical rows
on mobile and desktop; duplicate Add-root buttons are suppressed where the same
Add image action is already present. Graph data and generation behavior are unchanged.
The native mention menu selects on ordinary Enter and lets modified Enter reach
Classic once. Native Escape carries dismissal intent to the parent before query
clearing, keeping the same query closed until text changes. Negative `@text`
remains literal; no store schema or generation payload changed.

WP08 checks these contracts with hosted actual React component callbacks and
non-generating full-app geometry, plus exact-source CSS contracts. The synthetic
J6 preflight/routing is a bounded test facility, not an OS sandbox or proof of live
provider behavior. Exact-run evidence, visual review and production release
remain separately gated in the production-readiness devlog.

Core composer reference eligibility comes from generated
`PROVIDER_SURFACE_SUPPORT[provider].generate.references`, sourced from
`lib/providers/surfaceSupport.ts`. This is separate from numeric reference caps:
OAuth's absent lane-specific cap permits the server default, while NovelAI's
generation-only policy disables attachment controls. MCP/video priority and
per-workflow Comfy binding validation remain in their existing owners. The
`provider-surface-affordance.spec.ts` journey covers NAI-to-OAuth switching and
a synthetic attachment without generating an image.

Core selection is reconciled by `ui/src/lib/coreSelection.ts`: an explicit valid
provider wins over conflicting model metadata, so `grok-api`, `api`, and
`gemini-api` keep their authentication lane. `storeCoreSelectionImpl.ts` owns the
interactive transitions; `coreSelectionPersistence.ts` owns legacy active-key
reads/writes and bounded `ima2.coreSelectionMemory.v1` per-lane memory. Hydration
and cross-tab storage events use one reconciled selection patch, without copying
another tab's draft or clearing MCP/history. Legacy keys remain authoritative;
reads do not repair storage and unknown future memory versions are not overwritten.

Comfy image/video workflow IDs live in `comfyWorkflow`/`comfyVideoWorkflow`, not in
the static `ImageModel` union. Leaving Comfy clears active carriers while remembering
its choices; explicit null actions remove only the named remembered slot. Missing
catalog IDs remain visible and new Comfy selections never auto-pick a workflow.
`coreImageRequestModel` projects the image workflow into the existing wire `model`
field, omitting it when absent. `generateImpl` sends active Comfy video to video
generation and keeps unsupported Comfy/NAI multimode preferences inactive.
`coreGenerationMode.ts` now owns that decision for both dispatch and the core
composer's badge, placeholder, class and accessible label. Stored multimode remains
unchanged; the MCP-specific renderer keeps its existing preference semantics.
Generation selector labels wrap within their controls instead of losing identity
to ellipsis. The mobile workspace header places the same selector in a full-width
row beneath brand/actions; its existing bottom navigation and sheet focus owner
remain separate and unchanged.

Comfy catalog observations now have one non-persisted owner, `lib/laneCatalog.ts`,
consumed through `useLaneCatalog`. `api-comfy.parseLaneCatalog` validates consumed
fields at the JSON boundary. Subscribers share the initial read and manual/focus
refresh; last unsubscribe aborts work and removes the focus listener. Obsolete
responses cannot replace a newer observation. Loading and failed refresh retain
selection identity as stale, never as available. This is not a live-health promise.

`lib/comfyDisplay.ts` distinguishes lane availability from the selected image/video
workflow's availability. Provider controls identify Comfy as Local HTTP and show the
last catalog observation; `ComfyGenerationControls` exposes registered workflows,
not GPT scalar settings. Selection callbacks recheck current provider and catalog
before applying a workflow. Missing/offline/locked choices remain named but disabled.
Manager create/delete success refreshes both its list and this shared observation;
catalog failure does not turn a successful write into a failed mutation. The new
core-Comfy readiness branch remains separate from MCP observations.

`McpReadinessDetails` reads the selected MCP provider/model/kind only while the
popup is mounted. `mcpReadiness.ts` validates consumed fields and distinguishes
default model, missing/locked models, disconnected providers and failed reads.
Observation-only GETs do not mutate the legacy provider cache. Selection changes,
refresh and unmount abort obsolete reads; the popup does not connect or generate.

Hosted UI fixtures use owned temporary homes and emitted runtime projections.
`build:fixture` binds source/options/output hashes to the current SHA; ordinary
builds are unchanged. The isolation project precedes UI journeys. Guards deny
unowned file/process/network access; fixed libc probes remain denied but are
separately observed. This is a regression fixture, not an OS security sandbox.
WP09 startup-only diagnostic results do not replace full CI or visual acceptance.

`ui/e2e/j5-restart-recovery.spec.ts` owns integrated local generation, held-job
cancellation and same-home restart. It correlates the request ID, persisted
filename and loaded image, waits for pipeline cancellation cleanup, and checks
that restarting does not resubmit upstream work. It reuses `app.guard.assertClean`
and the existing build/source identity; there is no second fixture harness.
Desktop/mobile `wp12-*` PNG and JSON evidence ships in the journey CI artifact.
Test definitions or emitted attachments alone are not visual acceptance: the
candidate's actual test result and opened screenshots must be reviewed.

The current `ima2-gen` web UI is the React app under `ui/src/`. The server serves the built bundle under `ui/dist/`. The old single-file HTML UI remains as `public/index.html.legacy`, but it is not the active entrypoint.

This matters because README and older devlog entries still contain traces of the vanilla HTML UI. Actual UI work should target React components, the Zustand store, `ui/src/lib/api.ts` / `ui/src/lib/nodeApi.ts`, and `ui/src/index.css`. Fixing the legacy HTML file will not change the active app.

Start UI work at `App.tsx` to understand how classic canvas and node canvas diverge. General server calls are in `ui/src/lib/api.ts`; node generation JSON/SSE calls are in `ui/src/lib/nodeApi.ts` and re-exported through `api.ts`. State is centralized in `ui/src/store/useAppStore.ts`. For screen-level structure, start with `Sidebar`, `Canvas`, `NodeCanvas`, `RightPanel`, and `GalleryModal`.

Snapshot note, 2026-04-30: mobile UI has dedicated components (`MobileAppBar`, `MobileComposeSheet`, `MobileSettingsToggle`) and hooks (`useIsMobile`, `useVisualViewportInset`). Canvas Mode UI has been split out of a single component (`refactor(ui): split canvas mode workspace`, commit 11bc214) into `ui/src/components/canvas-mode/` (~3300 lines across 23 files), with `CanvasModeWorkspace.tsx` (498) as the shell, `CanvasToolbar.tsx` (468) for tools, and `useCanvasBackgroundCleanup.ts` (454) for the dual-mask cleanup flow. Background cleanup preview work has stale-render cancellation/debounce guards while final apply/export paths preserve natural image dimensions. Multimode sequence preview (`MultimodeSequencePreview`), web-search/reasoning-effort controls (`WebSearchToggle`, `ReasoningEffortSelect`), trash undo (`TrashUndoToast`), and history strip (`HistoryStrip` + layout toggle) are all part of the active component surface. There is no separate `ui/src/lib/imageMetadataClient.ts`; metadata restore calls live in `ui/src/lib/api.ts`.

Snapshot note, 2026-05-06: gallery now defaults to the current session with an "All Images" toggle (#42, commit bbf9b08). The store exposes `galleryScope: "current-session" | "all"`, `galleryDefaultScope`, and matching setters; opening the gallery resets `galleryScope` to `galleryDefaultScope` so the default is sticky across sessions. All `ima2.*` localStorage key names — including `ima2.galleryScope` and `ima2.galleryDefaultScope` — are now centralized in `ui/src/store/persistenceRegistry.ts` (#43, commit 246696d), preventing drift between hydration helpers and setters; settings/canvas persistence hardening (commit 5e3aed3) consumes the same registry. Error toasts now stack at the bottom-right with per-toast dismissal instead of replacing each other (commit 78cb6d4 + `tests/toast-stack-contract.test.js`); `Toast.tsx` is the renderer and the store keeps an array of error entries. Mobile compose/settings flows received UX polish (commits ad78853 / c812598) with an explicit mobile generate entry (`tests/mobile-generate-entry-contract.test.js`). Reasoning-effort controls are disabled for image-only models (commit 18b9123). `useAppStore.ts` grew to 3715 lines.

Snapshot note, 2026-05-30: **Agent Mode** shipped a dedicated React workspace under `ui/src/components/agent/` (`ui/src/lib/agentApi.ts`, `ui/src/hooks/useAgentWorkspaceLayout.ts`, `ui/src/lib/agentLayout.ts`, and `ui/src/styles/agent-workspace*.css`). It adds a session list, a turn/conversation view, a durable queue panel with cancel/retry, right-sidebar model/quality/form controls, per-session run state, and slash-command / `/question` handling, talking to the always-on `/api/agent/*` routes. Agent Mode has no CLI surface; it is web-UI only. Active run progress is derived from `queueBySession`/`runSummaryBySession` and displayed in a compact composer-adjacent status bar instead of a synthetic assistant chat bubble, so refreshes and session switches recover the spinner from durable queue state.

Snapshot note, 2026-07-20: **Agent Mode filmstrip relayout** (devlog unit `260720_agent-filmstrip-relayout`). Desktop layouts (`desktop-three-pane`, `desktop-rail`) now render a 64px session thumbnail rail (`AgentSessionRail`, 40px thumbs, white inset active ring, aria-labels with title+image count) as the only persistent session UI; the expanded `AgentSessionSidebar` was deleted and session management (search/rename/delete) lives exclusively in the drawer. The desktop right column is `AgentStagePane` (`ui/src/components/agent/AgentStagePane.tsx`, `ui/src/styles/agent-stage.css`): hero image/video viewport, filename+prompt caption, and a horizontal filmstrip with keyboard nav. The 6-tab tools column (`AgentRightSidebar`, refactored to a typed `SidebarBody` + wrappers) opens as an overlay dialog (`.agent-dialog--tools`) from the stage header or the chat model chip; tablet keeps the persistent tools column. The top bar is keyed purely on layoutMode (`tablet-stacked`/`mobile-chat-image-sheet`), fixing the 801-959px dead zone. The agent pane preference (`ima2.agentPanePreference`) is retired (key retained as a historical registry member), and `SidebarChrome`/`ImageModelSelect` lost their agent-mode branch (chat header owns the model selector).

Snapshot note, 2026-06-27 (v2.0.4): store facade `useAppStore.ts` is now ~507 lines after splitting state into `store*Impl.ts` modules (`storeGenerationImpl`, `storeGalleryImpl`, `storeInflightImpl`, etc.). Global styles live in `ui/src/index.css` (~105 lines) after CSS modularization into feature-scoped files. New/updated UI surfaces include `GenerationRequestLogPanel` (dev log tab for `GET /api/generation-requests`), `ResultMetadataModal` (per-result metadata inspector), `settings/QuotaCard` (Grok billing bar + Switch Account), storyboard mode toggle in the composer, and video frame copy (First/Mid/Last). Node default `searchMode` is `"on"` when web search is enabled.

Snapshot note, 2026-06-29: Grok Video 1.5 uses canonical `grok-imagine-video-1.5` in UI state; persisted `grok-imagine-video-1.5-preview` values are migrated on load. `VideoControlsPanel` exposes `1080p` for 1.5 prompt-only text-to-video and image-to-video with one active image/frame source, auto-selects the 1.5 model when 1080p is clicked, and clamps unsupported Ref2V/multi-reference 1080p selections back to 720p. Prompt-only 1.5 T2V relies on the server-side white-canvas I2V shim, so the UI does not require a visible reference image for 1080p.

Snapshot note, 2026-07-13: Phase 050 adds an `"assets"` `UIMode`, entered from the `NavRail` `#assets` route. It is a workspace-only mode: `AssetsWorkspace` replaces the center workspace while the generation `Sidebar`, `RightPanel`, and `HistoryStrip` are hidden. The workspace is implemented under `ui/src/components/assets/` with `AssetsFolderTree` for hierarchy and `AssetsGrid` for the filtered, cursor-paged catalog.

---

## Render Flow

```mermaid
graph TD
    MAIN["main.tsx"] --> APP["App.tsx"]
    APP --> STORE["useAppStore"]
    APP --> SIDEBAR["Sidebar"]
    APP --> SETTINGS["SettingsWorkspace"]
    APP --> CLASSIC["Canvas"]
    APP --> NODE["NodeCanvas"]
    APP --> ASSETS["AssetsWorkspace"]
    APP --> RIGHT["RightPanel"]
    APP --> MODAL["GalleryModal"]
    STORE --> API["ui/src/lib/api.ts"]
    API --> NODEAPI["ui/src/lib/nodeApi.ts"]
    API --> SERVER["server.ts /api"]
    NODEAPI --> SERVER
```

`App.tsx` hydrates history, loads sessions, reconciles inflight jobs, starts polling on mount, and syncs theme preference. If settings are open, it renders `SettingsWorkspace` in the center slot. Otherwise, it selects the workspace from `UIMode`: `classic` renders `Canvas`, enabled `node` renders `NodeCanvas`, and `assets` lazily renders `AssetsWorkspace`. `NavRail` maps the assets mode to `#assets`. Assets is workspace-only, so shell styling hides `Sidebar`, and `App.tsx` omits `RightPanel` and `HistoryStrip`. Node mode is enabled in packaged builds by default and can be hidden only by building with `VITE_IMA2_NODE_MODE=0`. Before unload or visibility changes, it flushes the graph save beacon.

Settings are a workspace replacement, not a modal overlay. `SettingsButton` lives next to the `ima2-gen` title in the sidebar. The compact image model selector also lives in this header as a fast switcher, while Settings shows the same choice with full model names. `SettingsWorkspace` keeps the outer shell fixed so the header and `X` close button do not scroll away; only the section index and content pane scroll. Selecting an item jumps the center document to that section instead of replacing the content panel. `SettingsWorkspace` closes with `X` or Escape and returns to the previous canvas path without mutating generation state.

## Major Areas

| Area | Main files | Responsibility |
|---|---|---|
| App shell | `ui/src/App.tsx` | Initialization, storage sync, beforeunload save, canvas/settings switch |
| Left panel | `Sidebar.tsx`, `PromptComposer.tsx`, `SettingsButton.tsx` | Focused generation entry plus settings access |
| Center workspace | `Canvas.tsx`, `NodeCanvas.tsx`, `SettingsWorkspace.tsx`, `ImageNode.tsx`, `card-news/CardNewsWorkspace.tsx` | Classic image display, graph canvas, settings, or dev-only card-news workspace |
| Agent workspace | `components/agent/*`, `lib/agentApi.ts`, `hooks/useAgentWorkspaceLayout.ts` | Agent Mode conversational image workspace: sessions, turns, durable composer run status, durable queue panel, right-sidebar controls (`/api/agent/*`, no CLI) |
| Assets workspace | `components/assets/AssetsWorkspace.tsx`, `AssetsFolderTree.tsx`, `AssetsGrid.tsx` | Workspace-only asset catalog with folder navigation, kind/tag/search filters, virtualized grid, and cursor paging |
| Raster-to-vector UI | `assetgen/VectorizePanel.tsx`, `canvas-mode/CanvasExportMenu.tsx`, `canvas-mode/useCanvasModeSession.ts`, `ui/src/lib/api-assets.ts` | Assets/AssetGen trace stored rasters directly. Canvas renders its composition to PNG, persists a hidden Canvas version, then opens the same preset/tuning modal. “SVG (embedded raster)” remains distinct from “Trace to SVG (vector)”. |
| Right panel | `RightPanel.tsx`, `SizePicker.tsx`, `CostEstimate.tsx`, `GenerationRequestLogPanel.tsx` | Quality, size, format, moderation, count; dev log tab for `GET /api/generation-requests` (#95) |
| Prompt Builder | `RightPanel.tsx`, `components/prompt-builder/*`, `settings/PromptBuilderSettings.tsx`, `promptBuilderStore.ts` | Conversational prompt refinement with persisted backend/model, backend-scoped model catalogs, deterministic Auto order, explicit-backend errors, and a badge sourced from the successful response's answering backend. |
| History | `HistoryStrip.tsx`, `GalleryModal.tsx`, `ResultActions.tsx`, `ResultMetadataModal.tsx` | Saved image browsing, favorite, restore, drag-out, metadata-restore, and per-result metadata inspector (#108) |
| Status | `InFlightList.tsx`, `Toast.tsx`, `BillingBar.tsx`, `AccountSettings.tsx`, `settings/QuotaCard.tsx` | Pending jobs, notifications, billing/provider status, Grok quota bar + Switch Account |
| Error UX | `ErrorCard.tsx`, `ui/src/lib/errorCodes.ts`, `errorHandler.ts` | Code-based localized error cards and toast routing. The 16 `NAI_*` codes carry NovelAI-specific copy; `NAI_API_KEY_MISSING`, `NAI_AUTH_FAILED`, `NAI_SUBSCRIPTION_REQUIRED` and `NAI_USAGE_EXHAUSTED` opt out of the generic auth/billing class card through `SELF_DESCRIBING_AUTH_CODES`, because that card says "sign in again" and this lane authenticates with a pasted token. |
| Provider selection | `GenProviderModelSelect.tsx`, `settings/ProviderStatusSelect.tsx`, `ProviderReadinessPopup.tsx`, `ApiKeyInput.tsx`, `ui/src/lib/imageModels.ts`, `coreSelection.ts`, `referenceLimits.ts` | Shared lane/model/workflow reconciliation preserves explicit credential lanes. `PROVIDER_READINESS_LABELS` is exhaustive; generated surface support gates reference attachment independently of readiness and numeric caps. |
| NovelAI controls | `settings/NaiControlsPanel.tsx`, `NegativePromptField.tsx`, `PromptComposer.tsx`, `home/HomePromptComposer.tsx`, `MobileComposeSheet.tsx`, `ui/src/lib/naiOptions.ts`, `naiPayload.ts` | Provider-gated Positive prompt and Undesired content panes across desktop, home, and mobile plus sparse native overrides. The panes sit side by side and stack below a 719px container. Non-NAI providers keep one prompt; saved negative state is retained but omitted from their payloads. |
| Custom size | `SizePicker.tsx`, `CustomSizeConfirmModal.tsx`, `ui/src/lib/size.ts`, `customSizeSlots.ts` | Keyboard-safe custom size drafts, slot persistence, and generation-time adjustment confirmation |
| Prompt library | `PromptLibraryPanel.tsx`, `PromptLibraryRow.tsx`, `PromptDetailModal.tsx`, `SavePromptPopover.tsx`, `PromptImportDialog.tsx`, `PromptImportFolderSection.tsx`, `PromptImportDiscoverySection.tsx` | Right-panel/overlay prompt library for browsing, searching, favoriting, inserting, saving, preview-first imports, PR2 curated source search, PR3 GitHub folder file selection, and PR4 reviewed-source discovery |
| Image metadata restore | `MetadataRestoreDialog.tsx`, `ui/src/lib/api.ts` (`postMetadataRead`) | Drop a previously generated PNG into the composer to restore prompt and parameters from embedded XMP |
| Card-news (dev-only) | `ui/src/components/card-news/*`, `ui/src/store/cardNewsStore.ts`, `ui/src/lib/cardNewsApi.ts` | Topic→draft→template→generate→export flow, gated by `VITE_IMA2_CARD_NEWS=1` or `VITE_IMA2_DEV=1` |
| i18n | `ui/src/i18n/index.ts`, `ko.json`, `en.json` | Locale load/save and translation lookup |

## State Model

| State group | Location | Description |
|---|---|---|
| Generation options | `useAppStore.ts` | Provider, quality, size, format, moderation, image model, count |
| Prompt/reference | `useAppStore.ts` | Prompt, reference images, add/remove/clear helpers |
| Classic history | `useAppStore.ts` plus `/api/history` | Current image, history, gallery scope (`current-session` / `all`), gallery default scope, favorite toggle |
| Inflight | `useAppStore.ts` plus `/api/inflight` | localStorage-backed pending jobs and polling |
| Node graph | `useAppStore.ts` plus sessions API | Nodes, edges, graphVersion, session actions, style sheet |
| Prompt library | `useAppStore.ts` plus `/api/prompts/*` | Open/close, current folder, search query, favorite filter, in-flight loading |
| Assets library | `storeAssetsImpl.ts` plus `ui/src/lib/api-assets.ts` | Assets, folders, tags, filters, cursor/loading state, catalog CRUD, and save-generated-result action |
| Metadata restore | `useAppStore.ts` plus `/api/metadata/read` | Pending dropped image, parsed metadata, restore confirmation flow |
| Card-news (dev-only) | `ui/src/store/cardNewsStore.ts` plus `/api/cardnews/*` | Topic/draft/template selection, manifest, jobs, regenerate/export state |
| Settings workspace | `useAppStore.ts` | `settingsOpen` and active settings section |
| UI preferences | `localStorage` via `ui/src/store/persistenceRegistry.ts` | Right panel state, UI mode, selected filename, locale, theme, custom-size slots, dev mode flag, gallery scope/default scope, settings persistence — all key names live in `persistenceRegistry.ts` (#43) |
| Error surface | `useAppStore.ts` plus `ErrorCard.tsx`, `Toast.tsx` | `errorCard` state for actionable errors; toasts are stacked at the bottom-right with per-toast dismissal (commit 78cb6d4) |

The image model preference is stored in `localStorage` as `ima2.imageModel`. Sidebar compact labels (`5.4m`, `5.4`, `5.5`) and Settings full labels (`GPT-5.4 Mini`, `GPT-5.4`, `GPT-5.5`) both read/write the same store field, so the next classic or node request sends the selected `model` instead of falling back to the default. The sidebar selector is intentionally tiny: the closed state shows only the compact label, opens a custom menu on click, and closes on outside click or Escape. The open menu renders through a `document.body` portal (fixed position, z-index 160) so the sidebar's `overflow:hidden` cannot clip it, with a `max-height`/scroll fallback and close-on-scroll/resize so the fixed menu never detaches from the trigger (#79).

Visible metadata should carry the selected model too. Current result metadata, hydrated history items, and ready node status labels use the server-returned or sidecar-restored `model` so UI debugging matches backend logs. The visible metadata uses compact aliases to preserve elapsed time: model aliases are `5.4m`/`5.4`/`5.5`, and quality aliases are `l`/`m`/`h`. Reasoning effort renders as `R:l`/`R:m`/`R:h`/`R:x` (none hidden) via `formatReasoningLabel` in `ui/src/lib/reasoning.ts`; the `R:` prefix avoids colliding with quality `m`. Per-image `elapsed` and `reasoningEffort` persist across history reload and session restore (#79).

`useAppStore.ts` is now a **507-line facade** over focused impl modules (`storeGenImpl.ts`, `storeNodeGenImpl.ts`, `storeVideoImpl.ts`, `storeInflightImpl.ts`, etc.). Cross-cutting state (classic, node, history, gallery scope, prompt library, metadata restore, multimode sequence, canvas annotations/versions, web-search and reasoning-effort settings, settings, stacked toasts) lives in those slices. The card-news store remains separated in `cardNewsStore.ts` (416 lines).

## API Client

| Function | Endpoint | Used by |
|---|---|---|
| `postGenerate` | `POST /api/generate` | Classic generation |
| `postEdit` | `POST /api/edit` | Edit flow |
| `getHistory` | `GET /api/history` | History strip and gallery |
| `getHistoryGrouped` | `GET /api/history?groupBy=session` | Session-grouped history |
| `deleteHistoryItem` | `DELETE /api/history/:filename` | Asset delete |
| `restoreHistoryItem` | `POST /api/history/:filename/restore` | Undo/restore |
| `setHistoryFavorite` | `POST /api/history/favorite` | Gallery favorite toggle |
| `getStorageStatus` | `GET /api/storage/status` | Gallery storage recovery notice |
| `openGeneratedDir` | `POST /api/storage/open-generated-dir` | Gallery "Open folder" action |
| `getInflight` | `GET /api/inflight` | Pending reconciliation |
| `postMetadataRead` | `POST /api/metadata/read` | Drag-and-drop metadata restore dialog |
| Prompt library helpers | `/api/prompts*` | List, create, update, delete, favorite, import, export, folders, prompt import preview/commit, curated sources/search/refresh, GitHub folder list/preview |
| Assets library helpers | `/api/assets*` via `api-assets.ts` | List/create/update/delete assets and folders, list tags, and cursor-paged filtering |
| Session style sheet helpers | `/api/sessions/:id/style-sheet*` | Get/save/enable/extract style sheet from a reference history image |
| `getGenerationRequestLog` | `GET /api/generation-requests` | Dev log panel (`ui/src/lib/api-log.ts`) |
| Card-news helpers | `/api/cardnews/*` (dev-only via `cardNewsApi.ts`) | Templates, role templates, sets, draft, generate, jobs, regenerate, export |
| `postNodeGenerate` | `POST /api/node/generate` | Node-mode generation, implemented in `nodeApi.ts` |
| `postNodeGenerateStream` | `POST /api/node/generate` with `Accept: text/event-stream` | Node-mode partial preview/error streaming, implemented in `nodeApi.ts` |
| Session helpers | `/api/sessions/*` | Graph session list/load/save |
| `getOAuthStatus` | `GET /api/oauth/status` | Provider readiness |
| `getBilling` | `GET /api/billing` | Billing bar and API status |

## Classic UI And Node UI

| Mode | Condition | Main component | State flow |
|---|---|---|---|
| Classic | Default UI | `Canvas.tsx` | Sends prompt to `/api/generate`, then updates current image/history |
| Node | Product feature enabled | `NodeCanvas.tsx` | Calls `/api/node/generate` per node, renders partial previews when streamed, and saves the graph to the session |
| Card-news | Dev-only, gated by `VITE_IMA2_CARD_NEWS=1` or `VITE_IMA2_DEV=1` | `card-news/CardNewsWorkspace.tsx` | Drives the dev-only topic→draft→template→generate→export flow against `/api/cardnews/*` and `cardNewsStore` |
| Assets | `UIMode === "assets"` / `#assets` | `assets/AssetsWorkspace.tsx` | Replaces the generation shell with folder tree and catalog grid; hides Sidebar, RightPanel, and HistoryStrip |

Generated results can be cataloged without leaving their current surface. `resultChaining.ts` defines the shared `saveToAssets` action, `GalleryImageTile` executes it from gallery tiles, and `ResultActions` exposes it in the current-result action row. All three route through the store's `saveToAssets` action in `storeAssetsImpl.ts`, which creates an `image` or `video` catalog record using the generated filename; it does not move or copy the underlying file.

Node mode uses `@xyflow/react`. Empty canvas creates a root node. Dragging an edge from an existing node can create a child node. Session loading displays a canvas overlay.

### SSE Multiplexing (Event Channel)

The web UI uses a singleton `EventSource` connection (`ui/src/lib/eventChannel.ts`) to `GET /api/events` for all generation progress. On `App.tsx` mount, `ensureConnected()` opens the channel. Generation flows (multimode, node, video) subscribe a handler by `requestId` before the POST, then send `{ async: true, requestId }` to receive an immediate `202`. Progress events (`phase`, `partial`, `done`, `error`) arrive on the shared channel and are routed to the matching handler.

Key modules:
- `ui/src/lib/eventChannel.ts` — singleton EventSource, exponential backoff reconnect, `subscribe()` / `armStreamTimeout()` / `ensureConnected()`, connection state callbacks
- `ui/src/lib/sseStreamError.ts` — `parseSseErrorPayload()` normalizes SSE error events into structured `{ code, message, status }` objects
- `ui/src/lib/api-generation.ts` — `postMultimodeGenerateStream()` and `postNodeGenerateStream()` use subscribe-before-fetch pattern
- `ui/src/store/storeNodeGenImpl.ts` — node generation state using async POST + eventChannel
- `ui/src/store/storeVideoImpl.ts` — video generation state with cancel-aware cleanup
- `ui/src/store/storeInflightImpl.ts` — shared inflight actions and polling
- `ui/src/store/inflightReconciliation.ts` — request-local scope/revision/identity merge

Reconcile and polling preserve concurrent additions, replacements, removals and
scope changes across both inflight and history awaits. Reconcile alone reads aged
stored IDs for terminal matching; failed inflight fetch cannot authorize TTL pruning.
Backend and local timestamps are not compared for identity. Application SSE `error`
MessageEvents do not close the connection; only transport errors reconnect. Stale
source callbacks are inert, and `replay-gap` is a resync control, never a job error.

`JOB_TRACKING_TIMEOUT` is a fixed four-locale completion-unknown warning with no
Retry CTA. Parser/resolver canonicalize recognized wrappers before raw-message
consumers; video, AssetGen, MCP and live Sprite paths use the localized result.
Video admission/success/cancel/ordinary failure clear stale errorInfo, and busy
graph Undo preserves live error fields. Animation returns success only on success.
Extension's tracking-expired advisory disables the same-source submit button;
changing source resets the advisory without submitting automatically. Sprite recipe
reload and the nonwatching UI-upscale path have separate presentation state; this
tracking change does not add a persisted warning system for them or Agent queue.

The monolithic `useAppStore` was split into focused `store*Impl.ts` modules to keep each under 500 lines. The main `useAppStore.ts` re-exports composed slices.

Node generation uses `postNodeGenerateStream()` which subscribes to the event channel, sends `{ async: true }`, and receives progress through the shared `GET /api/events` SSE. Partial images are stored only in transient `ImageNodeData.partialImageUrl`; they are deleted from the graph save payload. The final `done` payload replaces the preview with the canonical saved file URL. CLI clients that send `Accept: text/event-stream` instead of `async: true` still receive per-request SSE for backward compatibility. SSE `error` payloads preserve `status` so upstream validation failures can route to the same UI surface as JSON failures.

Node selection batch actions live on the canvas, not in Settings. `NodeCanvas` exposes a compact selection bar inside the React Flow area. Selection mode treats a normal node click as selecting the whole undirected connected component. Cmd/Ctrl modifies that selection: another component is added/removed, while a node inside the selected component can be toggled as an exception. Batch regeneration is sequential and in-place for selected nodes only; it does not use the single-node ready-state sibling branch.

Ready node actions are split in `ImageNode`: `Regenerate` replaces the current node in place, while `New variant` creates and generates into a sibling node. The store preserves this action choice through custom-size confirmation so a confirmed in-place regeneration cannot accidentally take the sibling path. Node layout helpers place new roots/children using actual existing node positions instead of raw edge counts, avoiding overlap after a middle child is deleted.

Node-local image references are allowed on child/edit nodes. The child composer sends references together with the parent image instead of blocking attachment. Reference drafts remain node-local and are stripped from saved session graph payloads, but they are persisted separately in browser `localStorage` under `ima2.nodeRefs.v1` by `ui/src/lib/nodeRefStorage.ts`. This avoids base64 bloat in SQLite while keeping node chips available across normal reloads on the same browser profile.

Node edges are the source of truth for parentage. `ui/src/lib/nodeGraph.ts` derives `parentServerNodeId` from the incoming visual edge and the source node's current `serverNodeId` whenever nodes or edges are loaded, changed, connected, disconnected, or saved. `ImageNode` exposes four-direction source and target handles, and `NodeCanvas` forwards React Flow `sourceHandle`/`targetHandle` values into the store so edges reload on the same directional anchors. The handle ids are persisted in session edge `data`; parent derivation still uses only `edge.source` and `edge.target`. Node edge removal is routed explicitly instead of relying on raw React Flow edge changes. When an edge is removed, `useAppStore.disconnectEdges()` removes the visual edge and clears or recomputes the target node's `parentServerNodeId`. Selection mode disables Delete/Backspace deletion so graph selection cannot accidentally remove edges or nodes.

Node generation sends an explicit context/search policy. The default request is `contextMode: "parent-plus-refs"` and `searchMode: "on"`, so a child edit uses the immediate parent image plus the node's explicit reference chips with web search enabled by default. Full ancestry is not silently inferred. If edit search becomes a product option, the UI must turn `searchMode` on intentionally.

Error handling is centralized. API helpers preserve `err.code` where the server sends `{ error: { code, message } }`; node helpers also preserve `err.status` from JSON or SSE error payloads. `handleError()` maps stable codes to either a toast or persistent `ErrorCard`. The card is reserved for actionable failures such as invalid request parameters, OAuth expiry, API-key authentication problems, moderation refusal, upstream 5xx, and network/proxy failure.

## Style And Layout

| File | Current signal | Caution |
|---|---|---|
| `ui/src/index.css` | ~105 lines (global tokens/imports; feature CSS colocated) | Large structural changes can easily create CSS drift across classic, node, canvas-mode, prompt-library, prompt-import dialog, gallery, mobile shell, and card-news surfaces |
| `ui/src/components/*.tsx` | ~17200 lines (excluding `card-news/` subtree) | Component class names and CSS are tightly coupled |
| `ui/src/store/useAppStore.ts` | ~507 lines (facade over `store*Impl.ts`) | Store shape changes must stay in sync with impl modules and localStorage migration paths |
| `ui/src/components/card-news/*.tsx` | Dev-only subtree | Do not touch from non-card-news work; gated behind `VITE_IMA2_CARD_NEWS=1` / `VITE_IMA2_DEV=1` |
| `ui/dist/` | Build output | Do not edit directly |
| `public/index.html.legacy` | Legacy artifact | Do not use it as the source for new active UI behavior |

## Change Checklist

- [ ] If a new API call is added, update `ui/src/lib/api.ts` or `ui/src/lib/nodeApi.ts` and `[[03-server-api]]`.
- [ ] If store shape changes, check classic, node, and localStorage migration paths.
- [ ] If node-mode UI changes, update `[[05-node-mode]]`.
- [ ] Record major CSS changes alongside component ownership.
- [ ] If a change references legacy HTML, re-check it against the active UI.

## Change Log

- 2026-04-23: Documented the active React UI architecture.
- 2026-04-23: Translated this document from Korean to English.
- 2026-04-24: Documented node SSE partial preview rendering and JSON fallback.
- 2026-04-24: Documented shared sidebar/settings image model selection.
- 2026-04-25: Documented error-card UX, custom-size confirmation, and storage gallery helpers.
- 2026-04-25: Documented node selection batch generation and canvas-level batch actions.
- 2026-04-25: Documented explicit node edge disconnect routing and parent metadata cleanup.
- 2026-04-25: Documented ready-node regenerate/new-variant split, position-based child layout, and child/edit node references.
- 2026-04-25: Documented graph-edge-derived node parentage, node ref local persistence, and explicit node context/search request policy.
- 2026-04-26: Removed dev-only workspace details from the evergreen frontend architecture reference.
- 2026-04-26: Confirmed node selection batch, edge disconnect, single-node regen/variation, and child node references are implemented and archived under `_fin/260426_*`.
- 2026-04-27: Documented four-direction node handles and edge handle-id persistence after 0.09.34.
- 2026-04-28: Added prompt library overlay, image-metadata restore dialog, session style-sheet helpers, dev-only card-news workspace and store, history favorite, and refreshed line counts (`useAppStore` 2739, `index.css` 4497, components 4046) for ima2-gen 1.1.5.
- 2026-04-28: Documented prompt import preview/commit API, dialog-first import UX, local/GitHub `.md`/`.markdown`/`.txt` support, and refreshed line counts (`useAppStore` 3374, `index.css` 5250, components 5263).
- 2026-04-28: Documented PR2 curated source search inside `PromptImportDialog`, including indexed search/refresh helpers and commit-compatible candidate flow.
- 2026-04-28: Documented PR3 GitHub folder browse through `PromptImportFolderSection`, selected-file preview, and folder list/preview API helpers.
- 2026-04-28: Documented PR4 GitHub discovery through `PromptImportDiscoverySection`; discovery candidates stay separate from prompt candidates and cannot be committed directly.
- 2026-04-30: Documented the Canvas Mode workspace split (`refactor(ui): split canvas mode workspace`, #11bc214) into `ui/src/components/canvas-mode/` (~3300 lines, 23 files), refreshed `useAppStore.ts` to 3555 and `index.css` to 5780, and called out multimode preview, web-search/reasoning-effort controls, trash undo, and the history strip as active surfaces.
- 2026-05-06: Added gallery scope state (#42 — `current-session` default with All Images toggle, sticky default), the `persistenceRegistry.ts` single source of truth for `ima2.*` localStorage keys (#43), error-toast stacking with per-toast dismissal (commit 78cb6d4), mobile compose/settings polish (commits ad78853 / c812598) plus the mobile generate entry contract, and the reasoning-effort disable for image-only models (commit 18b9123). Bumped `useAppStore.ts` to 3715.
- 2026-05-29: Added the `R:l`/`R:m`/`R:h`/`R:x` reasoning label (`formatReasoningLabel`, none hidden) to Classic/Canvas/Node result metadata, persisted `elapsed`/`reasoningEffort` across reload + session restore, and portaled the sidebar model dropdown to `document.body` (fixed, z-index 160, scroll-close, `max-height`) so it no longer clips (#79).
- 2026-05-30: Documented the Agent Mode workspace (`ui/src/components/agent/*`, `lib/agentApi.ts`, `hooks/useAgentWorkspaceLayout.ts`, `styles/agent-workspace*.css`) — session list, turn view, durable queue panel, right-sidebar controls, slash commands / `/question` — talking to the always-on `/api/agent/*` routes (no CLI). Re-grounding pass for ima2-gen 1.1.14.
- 2026-06-01: Recorded the Grok video UI contract: Classic "Continue here", gallery/history video drag, and Node parent-video generation attach the previous video's last frame and carry `videoContinuity` lineage; the video controls panel shows pending continuity context while Canvas shows selected-result lineage metadata.
- 2026-06-27: v2.0.4 snapshot — refreshed line counts (`useAppStore` ~507 facade, `index.css` ~105, components ~17200), documented `GenerationRequestLogPanel`, `ResultMetadataModal`, `QuotaCard`, storyboard mode, and video frame copy.
- 2026-06-29: Added the Grok Video 1.5 `1080p` UI contract: canonical model migration, conditional `VideoControlsPanel` enablement, 720p auto-clamp for unsupported states, and expanded active-source detection for provider URL and parent-video frame anchors.
- 2026-07-13: Phase 050 — documented the `assets` UIMode and `#assets` navigation, workspace-only shell, assets component subtree, Zustand/API slice, and shared `saveToAssets` result-chaining action.

Previous document: `[[03-server-api]]`

Next document: `[[05-node-mode]]`


Snapshot note, 2026-07-20: **Agent Mode component polish** (devlog unit `260720_agent-component-polish`). Shared chrome grammar: agent radius scale (`--agent-r-lg/md/sm`), 56px pane headers, monochrome model pill (blue removed inside agent, classic keeps blue), status chip, streaming gradient replaced with flat tint. Chat de-boxing: agent turns render borderless (user turns keep filled bubble), tool-run toggle solidified (dashed border removed, green hover removed — green stays exclusive to run state), composer `!important` eliminated and Send rewritten at proper specificity. Stage/rail polish: filmstrip radius unified, placeholder thumbs dimmed (opacity 0.45), rail menu/create buttons scoped hover+focus, overlay header joins 56px contract with complete close-button states, drawer action buttons fade to 0.4 at rest. Focus rings unified to `--accent` across agent thumbs and image preview (cyan stays in classic mode).

Snapshot note, 2026-08-23: **ComfyUI workflow manager** (devlog unit `260823_comfy_provider_lane`). `ui/src/components/settings/ComfyWorkflowManager.tsx` mounts in `SettingsWorkspace` beside `McpProviderConnections` and reuses that grammar (`article.settings-row`, section titles) rather than inventing one — this is a D8 expert surface where the user reads node ids and origins, so looking different from its neighbours would be the defect. Registration is inspect-then-confirm: the file is identified by magic bytes (a ComfyUI PNG carries the API graph), and a binding matched by several nodes stays unselected and blocks submit, because preselecting a guess lets someone click through with positive and negative swapped. Origin reachability goes through `POST /api/comfy/probe`, never a browser fetch of a typed string, and distinguishes a malformed address from an unreachable one. Status is never colour-only. `ui/src/lib/api-comfy.ts` is the typed client; `getComfyLaneModels` reads the comfy lane out of `GET /api/models` because a workflow list cannot come from the generated static types. Two default branches had to be closed for correctness: `getImageModelOptionsForProvider` returns `[]` for comfy instead of falling through to the OpenAI list, and `setProviderImpl` clears the selection on switch (no auto-pick — registration order carries no meaning). Selection lives in its own `comfyWorkflow` store field since `ImageModel` is a generated literal union. Offline workflows stay listed but disabled: removing them reads as "my workflow disappeared", leaving them enabled starts a doomed generation.

Snapshot note, 2026-08-24: **MiniMax H3 pruned NVFP4 catalog visibility**
(`260824_minimax_h3_pruned_nvfp4`). The Comfy client now reads separate image/video
arrays. `MiniMax H3 FL2VA pruned NVFP4` appears in the Video models group with a short
localized `Catalog only` second line, full server lock reason in the option title, and
`aria-disabled=true`; pointer/Enter cannot select it. The opt-in stacked Select row lets
the exact model name wrap at desktop and mobile widths without widening every portal.
Workflow manager registration carries media kind in all four locales. This surface does
not imply video dispatch: server and CLI locks remain authoritative.

Snapshot note, 2026-08-25: **Comfy video becomes selectable and dispatchable**
(`260825_comfy_video_provider_ux`). The catalog-only lock is gone, so a video row is
selectable whenever its origin answers; `MiniMax H3 FL2VA pruned NVFP4` still reads
disabled, but now because it is offline rather than because video execution is refused.
Clicking a video row was previously discarded four times over: `onModelChange` returned
early on the `comfy-video:` prefix, the rows were rendered permanently disabled,
`selectVideoModelImpl` rewrote any non-Grok id to `grok-imagine-video-1.5` and dragged
the provider back to grok, and both payload builders cast the provider to grok. The
selection now lives in its own `comfyVideoWorkflow` field rather than in
`videoModelSelected`, whose values pass through a normalizer that recognizes only Grok
ids. Video rows stay stacked whether or not they carry a reason line: that flag is what
enables `white-space: normal`, and user-named workflows routinely outrun the 300px
portal — a truncation this unit reintroduced and caught only by reading the render.

Snapshot note, 2026-08-25b: **provider lane state becomes catalog-derived**
(`260825_comfy_video_provider_ux` wp2). `GenProviderModelSelect` no longer decides
which lanes exist, what state they are in, or which do video — `getLaneCatalog` reads
all of it from `/api/models`, which had been publishing a status and a human-readable
reason per lane all along. `CORE_PROVIDER_OPTIONS` is now only a short-label map, so a
lane the server grows still appears. Three deliberate narrowings: MCP lanes
(runway/higgsfield) are excluded from the core group because they select through the
`mcp:` path and would otherwise render twice with two meanings; the Grok video rows stay
gated to the Grok lanes because they normalize through `normalizeVideoModelValue` and
would switch the provider under any other lane; and a lane with no label renders
disabled, since `Provider` is a generated union enforced again by `storePersistence`.
Badges name only the exception (`mcp.lane.*`), ready lanes stay unlabelled, and
`triggerSub=""` keeps the closed control showing the selection rather than the reason.
Follow-up debt: `ProviderStatusSelect.tsx` still hardcodes nine core entries and omits
comfy, so the two provider dropdowns disagree about which lanes exist.

Snapshot note, 2026-09-04: **model-select value is lane-gated**
(`260904_model_select_empty_label`). The selected value the model `Select` shows is
computed by `resolveCoreModelValue` in `ui/src/lib/imageModels.ts`, not inline in the
component. The previous inline expression preferred `comfyVideoWorkflow`, then
`videoModelSelected`, then `imageModel` regardless of provider — and `Select` renders an
EMPTY trigger label when its value matches none of the option rows it drew. So a comfy
video workflow surviving a lane switch made the control read "GPT" with no model beside
it, which looks like a rendering fault rather than stale state. The resolver returns only
what the current lane also lists (`comfy-video:` under comfy, `video:` under the Grok
lanes, `imageModel` otherwise), and `COMFY_VIDEO_VALUE_PREFIX`/`VIDEO_VALUE_PREFIX` live
beside it so an option row cannot drift off the value that selects it.

The state half is in `setProviderImpl`: LEAVING comfy now clears `comfyWorkflow` and
`comfyVideoWorkflow` and, when the current `imageModel` is not a member of the
`ImageModel` union, converges it to `DEFAULT_IMAGE_MODEL`. A comfy "model" is a
registered workflow id — legal in that lane because the server reads it as the workflow
to run (`lib/providerOptions.ts`, `lib/comfyImageAdapter.ts`) — so it used to ride out of
the lane and go on to become the `model` of the next GPT request. Union membership is the
test rather than another per-provider predicate, because the enumerated fallback below it
is exactly what failed to catch a workflow id. Only the OUTBOUND transition clears:
re-selecting comfy preserves the workflow (260823), and hydration never calls this
function at all, since `useAppStore` projects stored values straight into initial state.
