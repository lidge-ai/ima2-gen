# Source accounting

Pinned contributor delta: `5f33e44a7886580330ee03ea58a71a4d842014e5..e3a731cbd2ba4600e8cf06951126486860ff5fa2`.
All 83 changed paths are assigned below. Shared files are integrated hunk-by-hunk;
this ledger does not claim they have already shipped. Each delivery updates its
rows with PR/equivalent/rejected disposition. Non-runtime format churn and unsafe
raw error prose may be explicitly rejected; functional scope cannot disappear.

| Source path | Owning slice | Extraction boundary | Delivery |
|---|---|---|---|
| `.gitignore` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `bin/commands/session.ts` | WP1 | Flat CLI/ordered parent graph; later marker filtering only WP7 | pending |
| `docs/API.md` | All applicable slices | Reconstruct per slice from current dev, retain model/signing records | pending |
| `docs/migration/runtime-test-inventory.md` | All applicable slices | Reconstruct per slice from current dev, retain model/signing records | pending |
| `lib/db.ts` | WP5, WP7, WP8 | node_refs; wf_runs; warnings separately | pending |
| `lib/generationErrors.ts` | WP3 | Structured diagnostics only; raw upstream sentences rejected | pending |
| `lib/mediaMerge.ts` | WP6 | Bounded process/file boundary | pending |
| `lib/moTaTrangPhuc.ts` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `lib/nodeGeneration.ts` | WP1, WP3 | Extra refs and structured diagnostics separately; preserve API model | pending |
| `lib/nodeHelpers.ts` | WP1 | Flat CLI/ordered parent graph; later marker filtering only WP7 | pending |
| `lib/nodeRefStore.ts` | WP5 | Durable refs; migration and write-order repairs | pending |
| `lib/nodeTemplateFile.ts` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `lib/nodeTemplateSeeds.ts` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `lib/nodeTemplateThoiTrang.ts` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `lib/responsesErrors.ts` | WP3 | Structured diagnostics only; raw upstream sentences rejected | pending |
| `lib/responsesParse.ts` | WP3 | Structured diagnostics only; raw upstream sentences rejected | pending |
| `lib/sessionStore.ts` | WP1 | Flat CLI/ordered parent graph; later marker filtering only WP7 | pending |
| `lib/wfChain.ts` | WP7, WP8 | Generic runtime; isolate fashion cases and modules | pending |
| `lib/wfEngine.ts` | WP7, WP8 | Generic runtime; isolate fashion cases and modules | pending |
| `lib/wfEvents.ts` | WP7 | Workflow execution consumer/runtime | pending |
| `lib/wfRunStore.ts` | WP7, WP8 | Generic runtime; isolate fashion cases and modules | pending |
| `routes/index.ts` | WP5, WP6, WP7 | Register each route with its own slice | pending |
| `routes/mediaMerge.ts` | WP6 | Bounded process/file boundary | pending |
| `routes/nodeRefs.ts` | WP5 | Durable refs; migration and write-order repairs | pending |
| `routes/nodeTemplates.ts` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `routes/workflow.ts` | WP7, WP8 | Generic runtime; isolate fashion cases and modules | pending |
| `scripts/wf-chup-thoi-trang.md` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `scripts/wf-doi-do.mjs` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `structure/01-file-function-map.md` | All applicable slices | Reconstruct per slice from current dev, retain model/signing records | pending |
| `tests/fashion-template-library.test.ts` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `tests/fixtures/contracts/radius-scale.manifest.json` | WP2, WP4, WP7, WP8 | Recompute only observed UI deltas; never weaken unrelated guards | pending |
| `tests/i18n-dictionary-contract.test.ts` | WP2 | Fix existing animate key and remove only resolved missing-key exceptions | pending |
| `tests/node-batch-contract.test.js` | WP7 | Workflow-aware run batching | pending |
| `tests/node-child-refs-payload.test.js` | WP1, WP5, WP8 | Payload/source guards rebuilt with behavioral regressions | pending |
| `tests/node-footer-compact-contract.test.js` | WP1, WP2, WP7 | Cardinality/controls assertions by slice | pending |
| `tests/node-parent-source-contract.test.ts` | WP1 | Flat CLI/ordered parent graph; later marker filtering only WP7 | pending |
| `tests/node-studio-ui-contract.test.js` | WP1, WP2, WP7 | Cardinality/controls assertions by slice | pending |
| `tests/node-template-portable.test.ts` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `tests/node-workflow-run-contract.test.ts` | WP7, WP8 | Generic runtime; isolate fashion cases and modules | pending |
| `tests/responses-parse-diagnostics.test.ts` | WP3 | Structured diagnostics only; raw upstream sentences rejected | pending |
| `tests/ui-gradient-manifest-contract.test.ts` | WP2, WP4, WP7, WP8 | Recompute only observed UI deltas; never weaken unrelated guards | pending |
| `tests/ui-radius-scale-contract.test.ts` | WP2, WP4, WP7, WP8 | Recompute only observed UI deltas; never weaken unrelated guards | pending |
| `tests/video-single-reference-mode-contract.test.ts` | WP7, WP8 | Role/video behavior with workflow; fashion consumer later | pending |
| `tests/workflow-api-contract.test.ts` | WP7, WP8 | Generic runtime; isolate fashion cases and modules | pending |
| `ui/src/components/ImageNode.tsx` | WP2, WP7, WP8 | Preview/header; generic role/runtime; fashion separately | pending |
| `ui/src/components/NodeBatchBar.tsx` | WP7, WP8 | Role/video behavior with workflow; fashion consumer later | pending |
| `ui/src/components/NodeCanvas.tsx` | WP1, WP7 | Base/ref labels first; marker/toolbar later | pending |
| `ui/src/components/node-canvas/NodeApiPanel.tsx` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/components/node-canvas/NodeElementTray.tsx` | WP7, WP8 | Role/video behavior with workflow; fashion consumer later | pending |
| `ui/src/components/node-canvas/NodeStudioOverlays.tsx` | WP4, WP7 | Template props first; Runner/toolbar later | pending |
| `ui/src/components/node-canvas/NodeTemplatePicker.tsx` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `ui/src/components/node-canvas/NodeVideoSettings.tsx` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/components/node-canvas/WfRunnerPanel.tsx` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/components/node-canvas/useNodeStudioController.ts` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `ui/src/components/node-canvas/useNodeTemplateController.ts` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `ui/src/i18n/en.json` | WP1, WP2, WP4, WP7, WP8 | Scoped key additions, preserve dev keys and omit formatting churn | pending |
| `ui/src/i18n/ko.json` | WP1, WP2, WP4, WP7, WP8 | Scoped key additions, preserve dev keys and omit formatting churn | pending |
| `ui/src/i18n/zh-Hans.json` | WP1, WP2, WP4, WP7, WP8 | Scoped key additions, preserve dev keys and omit formatting churn | pending |
| `ui/src/i18n/zh-Hant.json` | WP1, WP2, WP4, WP7, WP8 | Scoped key additions, preserve dev keys and omit formatting churn | pending |
| `ui/src/index.css` | WP7, WP8 | Workflow and specialization action/style registration | pending |
| `ui/src/lib/api-node-templates.ts` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `ui/src/lib/canhAnh.ts` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/lib/chayWorkflow.ts` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/lib/eventChannel.ts` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/lib/gopMedia.ts` | WP6 | Bounded process/file boundary | pending |
| `ui/src/lib/moTaTrangPhuc.ts` | WP8 | Fashion specialization; profile ignores reviewed separately | pending |
| `ui/src/lib/nodeGraph.ts` | WP1, WP7, WP8 | Ordered parents first; marker/fashion extensions later | pending |
| `ui/src/lib/nodePortCatalog.ts` | WP1 | Flat CLI/ordered parent graph; later marker filtering only WP7 | pending |
| `ui/src/lib/nodeRefStorage.ts` | WP5 | Durable refs; migration and write-order repairs | pending |
| `ui/src/lib/vaiTroNode.ts` | WP7, WP8 | Generic role contract in kernel; fashion extension last | pending |
| `ui/src/lib/wfApi.ts` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/store/storeGraphNodeImpl.ts` | WP1, WP7, WP8 | Ordered parents first; marker/fashion extensions later | pending |
| `ui/src/store/storeGraphSave.ts` | WP5 | Durable refs; migration and write-order repairs | pending |
| `ui/src/store/storeNodeGenImpl.ts` | WP1, WP7, WP8 | Ordered parent input; generic role/run state; fashion state | pending |
| `ui/src/store/storeNodeRefImpl.ts` | WP5, WP8 | Persistence first; derived-ref replacement in fashion | pending |
| `ui/src/store/storeSessionImpl.ts` | WP5, WP7 | Ref reload first; running-workflow recovery later | pending |
| `ui/src/store/storeTypes.ts` | WP1, WP7, WP8 | Ordered parent input; generic role/run state; fashion state | pending |
| `ui/src/store/storeVideoImpl.ts` | WP7, WP8 | Role/video behavior with workflow; fashion consumer later | pending |
| `ui/src/store/storeWorkflowImpl.ts` | WP7 | Workflow execution consumer/runtime | pending |
| `ui/src/store/useAppStore.ts` | WP7, WP8 | Workflow and specialization action/style registration | pending |
| `ui/src/styles/node-canvas-extras.css` | WP4 | Portable envelope/UI; strict boundary corrections | pending |
| `ui/src/styles/node-workspace.css` | WP2, WP7, WP8 | Preview/header; generic role/runtime; fashion separately | pending |
| `ui/src/styles/wf-runner.css` | WP7 | Workflow execution consumer/runtime | pending |
