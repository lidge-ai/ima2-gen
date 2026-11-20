# WP1 image model reader sweep

Audited the requested `rg` expression in `lib routes bin ui/src integrations`, excluding generated JavaScript and tests. Each match is listed, including declarations and display-only matches, so counts include non-reader hits. Line numbers refer to the resulting tree. Classification: **a** migrated before validation; **b** no legacy OpenAI validation at this match; **c** needed migration and is fixed here.

Additional path tracing: startup and provider memory use `ui/src/store/coreSelectionPersistence.ts:40` and `ui/src/lib/coreSelection.ts:141`; image metadata use-settings uses `ui/src/store/storeReferenceImpl.ts:195`. History selection restores only prompt fields (`ui/src/store/storePersistence.ts:94`); graph nodes retain model data (`ui/src/store/storeGraphNodeImpl.ts:96`, `ui/src/store/storeGraphSave.ts:69`), with generation passing through `lib/nodeGeneration.ts:92` / `lib/generatePipeline.ts:174` and `lib/providerOptions.ts:153`; session graph restore follows the same node-generation boundary. No separate session-import model validator was found in the searched source. Preset IDs are dropped on restore in `ui/src/store/storePersistence.ts` (generation-defaults loader); MCP media uses its own provider catalog in `routes/mcpMedia.ts`, while core image requests reach provider normalization. Comfy bridge forwards its chosen model (`integrations/comfyui/ima2_gen_bridge/nodes.py:214`) to the server; agent image requests use `lib/agentImageVideoGen.ts:93`, and agent settings migrate by lane in `lib/agentSettings.ts:8`. These paths do not add another match of the requested catalog expression.

Matches: a=6, b=77, c=2. Both c findings were fixed.

| Path:line | Class | Reason |
|---|---|---|
| `ui/src/store/storeReferenceImpl.ts:6` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/store/storeReferenceImpl.ts:52` | c | Embedded metadata reached validation before migration; fixed by lane-aware migration; both lanes tested. |
| `routes/models.ts:308` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `routes/models.ts:311` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/defaults.ts:125` | a | OpenAI default is migrated before membership validation. |
| `bin/commands/defaults.ts:126` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/defaults.ts:137` | a | OpenAI default is migrated before membership validation. |
| `bin/commands/defaults.ts:139` | a | OpenAI default is migrated before membership validation. |
| `bin/commands/defaults.ts:144` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/defaults.ts:145` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/edit.ts:17` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/edit.ts:54` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/edit.ts:85` | c | CLI model was validated before migration; fixed for OpenAI or auto lane; both lanes tested. |
| `bin/commands/edit.ts:86` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/multimode.ts:18` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `bin/commands/multimode.ts:61` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:2` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:7` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:8` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:36` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:50` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:56` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:58` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:93` | a | OpenAI validation uses selected set after model and default migration (lines 90–103). |
| `lib/imageModels.ts:124` | b | Validation is exclusively for a non-OpenAI provider; retain its IDs unchanged. |
| `lib/imageModels.ts:126` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:152` | b | Validation is exclusively for a non-OpenAI provider; retain its IDs unchanged. |
| `lib/imageModels.ts:154` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:166` | b | Validation is exclusively for a non-OpenAI provider; retain its IDs unchanged. |
| `lib/imageModels.ts:168` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/imageModels.ts:180` | b | Validation is exclusively for a non-OpenAI provider; retain its IDs unchanged. |
| `lib/imageModels.ts:182` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/store/storePersistence.ts:18` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/store/storePersistence.ts:177` | b | loadImageModel has no callers; active startup reads raw storage and reconciles lane-aware in coreSelectionPersistence.ts:40–48. |
| `lib/providers/deriveCore.ts:21` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ProviderReadinessPopup.tsx:2` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ProviderReadinessPopup.tsx:42` | b | Label lookup on already reconciled state, not a restoration or validation boundary. |
| `lib/capabilities.ts:125` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/capabilities.ts:208` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:5` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:37` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:212` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:233` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:237` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:254` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/ImageModelSelect.tsx:261` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/providers/derive.ts:15` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/providers/derive.ts:65` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `lib/providers/derive.ts:69` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/GrokModelPicker.tsx:4` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/GrokModelPicker.tsx:17` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/settings/NaiControlsPanel.tsx:18` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/components/settings/NaiControlsPanel.tsx:51` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/coreSelection.ts:2` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/coreSelection.ts:29` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/coreSelection.ts:56` | b | Shared membership predicate; callers audited individually. |
| `ui/src/lib/coreSelection.ts:68` | b | Provider inference checks non-OpenAI lanes only; legacy GPT falls through to OAuth before migration. |
| `ui/src/lib/coreSelection.ts:91` | a | OpenAI value is migrated by migrateCoreImageModel before staticImage validation. |
| `ui/src/lib/coreSelection.ts:100` | b | Called with current typed picker selection; persisted values go through reconcileCoreSelection. |
| `ui/src/lib/coreSelection.ts:155` | a | OpenAI value is migrated by migrateCoreImageModel before staticImage validation. |
| `ui/src/lib/imageModels.ts:66` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:106` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:112` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:113` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:117` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:119` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:123` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:128` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:133` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:138` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:148` | b | Shared membership predicate; its readers are classified individually. |
| `ui/src/lib/imageModels.ts:149` | b | Shared membership predicate; its readers are classified individually. |
| `ui/src/lib/imageModels.ts:173` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:180` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:184` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:185` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:186` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:192` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:193` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/lib/imageModels.ts:205` | b | Label lookup; unknown values are displayed unchanged. |
| `ui/src/lib/imageModels.ts:207` | b | Label lookup; unknown values are displayed unchanged. |
| `ui/src/generated/providers.ts:113` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/generated/providers.ts:134` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/generated/providers.ts:135` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
| `ui/src/generated/providers.ts:136` | b | Catalog declaration, display, import, type, or help text; does not validate persisted input. |
