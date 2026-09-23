import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Dictionary = Record<string, unknown>;
type CollectedTranslations = {
  keys: Set<string>;
  templateNamespaces: Set<string>;
  dynamicSignatures: Set<string>;
  unresolved: string[];
};

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI_SOURCE_ROOT = resolve(PROJECT_ROOT, "ui/src");
const en = readDictionary("ui/src/i18n/en.json");
const ko = readDictionary("ui/src/i18n/ko.json");
const zhHant = readDictionary("ui/src/i18n/zh-Hant.json");
const zhHans = readDictionary("ui/src/i18n/zh-Hans.json");
const dictionaries = [
  ["en", en],
  ["ko", ko],
  ["zh-Hant", zhHant],
  ["zh-Hans", zhHans],
] as const;

const LEGACY_DOTTED_ROOTS = ["assets.clearAll", "assets.clearConfirm"] as const;
const REQUIRED_KEYS = [
  "nav.home",
  "assets.clearAll",
  "assets.clearConfirm",
  "assets.testSheetsUnavailable",
  "assets.detailAria",
] as const;

// Registry keys intentionally freeze both the source file and argument text. Candidate keys
// come from the named literal source; a new dynamic t(expr) fails until explicitly reviewed.
// No files are excluded: local non-i18n variables named `t` in InFlightList.tsx and canvas/lib
// math helpers are never CallExpression callees; every current t(...) call is translation-bound.
const DYNAMIC_T_IDENTIFIERS = new Map<string, readonly string[]>([
  // Finite return paths in lib/comfyDisplay.ts; exact call sites stay audited.
  ["ui/src/components/GenProviderModelSelect.tsx :: comfyDisplayMessageKey(comfyDisplay, laneSnapshot)", comfyDisplayKeys()],
  ["ui/src/components/ProviderReadinessPopup.tsx :: comfyDisplayMessageKey(comfyDisplay, laneCatalog)", comfyDisplayKeys()],
  ["ui/src/components/settings/ComfyGenerationControls.tsx :: comfyDisplayMessageKey(display, snapshot)", comfyDisplayKeys()],
  ["ui/src/components/settings/ProviderStatusSelect.tsx :: comfyDisplayMessageKey(comfyDisplay, snapshot)", comfyDisplayKeys()],
  ["ui/src/hooks/useProviderAvailability.ts :: comfyDisplayMessageKey(comfyDisplay, laneCatalog)", comfyDisplayKeys()],
  // reasonKey() returns these literals in CustomSizeConfirmModal.tsx.
  ["ui/src/components/CustomSizeConfirmModal.tsx :: reasonKey(pending.reasons)", [
    "sizeConfirm.reasonRatio", "sizeConfirm.reasonPixels", "sizeConfirm.reasonMinPixels",
    "sizeConfirm.reasonMin", "sizeConfirm.reasonMax", "sizeConfirm.reasonSnap",
  ]],
  // CHAINING_ACTIONS labelKey literals in ui/src/lib/resultChaining.ts.
  ["ui/src/components/GalleryImageTile.tsx :: action.labelKey", [
    "chain.animate", "chain.edit", "chain.useAsRef", "chain.rebake",
    "chain.saveToAssets", "chain.saveAsElement",
  ]],
  // NodeCommandPalette commandText/portTypeLabel computed keys (higgsfield 120).
  // Falls back to the descriptor's own text when the key is absent.
  ["ui/src/components/node-canvas/NodeCommandPalette.tsx :: key", [
    "nodeStudio.commands.image-generate.label", "nodeStudio.commands.image-generate.description",
    "nodeStudio.portTypes.prompt", "nodeStudio.portTypes.image", "nodeStudio.portTypes.images",
    "nodeStudio.portTypes.video", "nodeStudio.portTypes.mask", "nodeStudio.portTypes.element-refs",
    "nodeStudio.portTypes.element-notes", "nodeStudio.portTypes.settings", "nodeStudio.portTypes.any-media",
  ]],
  // NodeCommandPalette CATEGORY_LABEL_KEYS literals (line-level const map).
  ["ui/src/components/node-canvas/NodeCommandPalette.tsx :: CATEGORY_LABEL_KEYS[category]", [
    "nodeStudio.palette.categories.input", "nodeStudio.palette.categories.generate",
    "nodeStudio.palette.categories.transform", "nodeStudio.palette.categories.reference",
    "nodeStudio.palette.categories.output",
  ]],
  // useNodeStudioController COMPATIBILITY_REASON_KEYS literals (line-level const map).
  ["ui/src/components/node-canvas/useNodeStudioController.ts :: COMPATIBILITY_REASON_KEYS[reason]", [
    "nodeStudio.compatibility.sameDirection", "nodeStudio.compatibility.typeMismatch",
    "nodeStudio.compatibility.cardinality", "nodeStudio.compatibility.selfEdge",
    "nodeStudio.compatibility.duplicateEdge", "nodeStudio.compatibility.unknownPort",
  ]],
  // IMAGE_MODEL_OPTIONS, UNSUPPORTED_IMAGE_MODELS, VIDEO_MODEL_OPTIONS in imageModels.ts,
  // plus REASONING_EFFORT_OPTIONS in reasoning.ts.
  ["ui/src/components/ImageModelSelect.tsx :: option.fullLabelKey", [
    "settings.imageModel.gpt54Mini", "settings.imageModel.gpt54", "settings.imageModel.gpt55",
    "settings.imageModel.gpt56Sol", "settings.imageModel.gpt56Terra", "settings.imageModel.gpt56Luna",
    "settings.imageModel.gpt6Astra",
    "settings.imageModel.grokImagineQuality", "settings.imageModel.grokImagine",
    "settings.imageModel.nanoBanana2", "settings.imageModel.nanoBanana2Api",
    "settings.imageModel.nanoBananaPro", "settings.imageModel.gpt53CodexSpark",
    "settings.imageModel.minimaxImage01", "settings.imageModel.minimaxImage01Live",
    "settings.imageModel.naiDiffusion5Full", "settings.imageModel.naiDiffusion5Curated",
    "settings.imageModel.naiDiffusion45Full", "settings.imageModel.naiDiffusion45Curated",
    "settings.videoModel.grokImagine", "settings.videoModel.grokImagine15",
    "settings.reasoning.none", "settings.reasoning.low", "settings.reasoning.medium",
    "settings.reasoning.high", "settings.reasoning.xhigh", "settings.reasoning.max",
  ]],
  // RAIL_ITEMS labelKey literals in NavRail.tsx.
  ["ui/src/components/NavRail.tsx :: item.labelKey", [
    "nav.home", "nav.create", "nav.node", "nav.agent", "nav.assets", "nav.assetGen", "nav.settings",
  ]],
  // IMAGE_MODEL_OPTIONS fullLabelKey literals in ui/src/lib/imageModels.ts.
  ["ui/src/components/ProviderReadinessPopup.tsx :: imageModelOption.fullLabelKey", [
    "settings.imageModel.gpt54Mini", "settings.imageModel.gpt54", "settings.imageModel.gpt55",
    "settings.imageModel.gpt56Sol", "settings.imageModel.gpt56Terra", "settings.imageModel.gpt56Luna",
    "settings.imageModel.gpt6Astra",
    "settings.imageModel.grokImagineQuality", "settings.imageModel.grokImagine",
    "settings.imageModel.nanoBanana2", "settings.imageModel.nanoBanana2Api",
    "settings.imageModel.nanoBananaPro",
    "settings.imageModel.minimaxImage01", "settings.imageModel.minimaxImage01Live",
    "settings.imageModel.naiDiffusion5Full", "settings.imageModel.naiDiffusion5Curated",
    "settings.imageModel.naiDiffusion45Full", "settings.imageModel.naiDiffusion45Curated",
  ]],
  ["ui/src/components/McpReadinessDetails.tsx :: messageKey", [
    "readiness.mcp.loading", "readiness.mcp.error", "readiness.mcp.missing", "readiness.mcp.disabled",
    "readiness.mcp.disconnected", "readiness.mcp.locked", "readiness.mcp.default",
    "readiness.mcp.model-missing", "readiness.mcp.model-locked", "readiness.mcp.ready",
  ]],
  // REASONING_EFFORT_OPTIONS fullLabelKey literals in ui/src/lib/reasoning.ts.
  ["ui/src/components/ReasoningEffortSelect.tsx :: option.fullLabelKey", reasoningKeys()],
  // The local code-to-key conditional chain in ResultActions.tsx.
  ["ui/src/components/ResultActions.tsx :: key", [
    "toast.comfyExportInvalidUrl", "toast.comfyExportInvalidImage",
    "toast.comfyExportImageNotFound", "toast.comfyExportFailed",
  ]],
  // REASONING_EFFORT_OPTIONS fullLabelKey literals in ui/src/lib/reasoning.ts.
  ["ui/src/components/agent/AgentModelSelector.tsx :: option.fullLabelKey", reasoningKeys()],
  // The local status-to-key conditional chain in AgentRunStatusBar.tsx.
  ["ui/src/components/agent/AgentRunStatusBar.tsx :: stageKey", [
    "agent.progressQueued", "agent.progressDownloading", "agent.progressGenerating",
    "agent.progressFailed", "agent.progressPlanning",
  ]],
  // SLASH_COMMANDS descriptionKey literals in agent/slashCommands.ts.
  ["ui/src/components/agent/SlashCommandMenu.tsx :: cmd.descriptionKey", [
    "agent.slashDesc_question", "agent.slashDesc_variants", "agent.slashDesc_generate",
    "agent.slashDesc_parallelism", "agent.slashDesc_help",
  ]],
  // CHOICES labelKey literals in AssetGenModelPicker.tsx.
  ["ui/src/components/assetgen/AssetGenModelPicker.tsx :: c.labelKey", [
    "assetGen.modelGpt", "assetGen.modelGrok",
  ]],
  // PRESETS labelKey literals in BackgroundPresetPicker.tsx.
  ["ui/src/components/assetgen/BackgroundPresetPicker.tsx :: p.labelKey", [
    "assetGen.bgChroma", "assetGen.bgWhite", "assetGen.bgBlack",
  ]],
  // emptyTitle's local conditional literals in AssetsWorkspace.tsx.
  ["ui/src/components/assets/AssetsWorkspace.tsx :: emptyTitle", [
    "assets.emptyElementsTitle", "assets.emptyFolderTitle", "assets.emptySearchTitle", "assets.emptyTitle",
  ]],
  // emptyBody's local conditional literals in AssetsWorkspace.tsx.
  ["ui/src/components/assets/AssetsWorkspace.tsx :: emptyBody", [
    "assets.emptyElementsBody", "assets.emptyFolderBody", "assets.emptySearchBody", "assets.emptyBody",
  ]],
  // role literals in lib/cardNewsRoleTemplateStore.ts feed CardNewsCard.role.
  ["ui/src/components/card-news/CardDeckRail.tsx :: key", [
    "cardNews.roles.hook", "cardNews.roles.core", "cardNews.roles.cta", "cardNews.roles.cover",
    "cardNews.roles.problem", "cardNews.roles.insight", "cardNews.roles.example", "cardNews.roles.data",
    "cardNews.roles.tip1", "cardNews.roles.tip2", "cardNews.roles.summary",
  ]],
  // CardNewsTextPlacement literals in ui/src/lib/cardNewsApi.ts.
  ["ui/src/components/card-news/PlacementBadge.tsx :: key", [
    "cardNews.placements.top-left", "cardNews.placements.top-center", "cardNews.placements.top-right",
    "cardNews.placements.center-left", "cardNews.placements.center", "cardNews.placements.center-right",
    "cardNews.placements.bottom-left", "cardNews.placements.bottom-center",
    "cardNews.placements.bottom-right", "cardNews.placements.free",
  ]],
  // TEXT_KINDS, RENDER_MODES, and HIERARCHIES literals in TextFieldCard.tsx.
  ["ui/src/components/card-news/TextFieldCard.tsx :: key", [
    "cardNews.textKinds.headline", "cardNews.textKinds.body", "cardNews.textKinds.caption",
    "cardNews.textKinds.cta", "cardNews.textKinds.badge", "cardNews.textKinds.number",
    "cardNews.renderModes.in-image", "cardNews.renderModes.ui-only",
    "cardNews.hierarchy.primary", "cardNews.hierarchy.secondary", "cardNews.hierarchy.supporting",
  ]],
  // labelKey's two local literals in InFlightBadge.tsx.
  ["ui/src/components/composer/InFlightBadge.tsx :: labelKey", [
    "inflight.badgeClose", "inflight.badgeOpen",
  ]],
  // noticeKey's local conditional literals in GalleryStorageBar.tsx.
  ["ui/src/components/gallery/GalleryStorageBar.tsx :: noticeKey", [
    "gallery.storageNoticeRecoverable", "gallery.storageNoticeNotFound", "gallery.storageNoticeUnknown",
  ]],
  // PROFILES labelKey literals in WorkspaceProfileSettings.tsx.
  ["ui/src/components/settings/WorkspaceProfileSettings.tsx :: item.labelKey", [
    "workspace.defaultLabel", "workspace.promptStudioLabel",
  ]],
  // toastKey literals in ui/src/lib/errorCodes.ts.
  ["ui/src/lib/errorHandler.ts :: spec.toastKey", [
    "toast.refTooLarge", "toast.refNotBase64", "toast.refEmpty",
    "toast.refLimitExceeded", "toast.generateFailed",
    "toast.minimaxModelRequiresReference",
    "toast.naiRefUnsupported", "toast.naiEditUnsupported",
    "toast.naiRateLimited", "toast.naiBadRequest", "toast.naiMaskUnsupported",
    "toast.errorClass.rateLimited", "toast.errorClass.providerTimeout",
    "toast.errorClass.networkFailure", "toast.errorClass.contentRejected",
    "toast.errorClass.capabilityUnsupported", "toast.errorClass.modelUnavailable",
    "toast.errorClass.internalState",
  ]],
  ["ui/src/lib/agentQueueError.ts :: resolved.spec.toastKey", [
    "toast.refTooLarge", "toast.refNotBase64", "toast.refEmpty",
    "toast.refLimitExceeded", "toast.generateFailed",
    "toast.minimaxModelRequiresReference",
    "toast.naiRefUnsupported", "toast.naiEditUnsupported",
    "toast.naiRateLimited", "toast.naiBadRequest", "toast.naiMaskUnsupported",
    "toast.errorClass.rateLimited", "toast.errorClass.providerTimeout",
    "toast.errorClass.networkFailure", "toast.errorClass.contentRejected",
    "toast.errorClass.capabilityUnsupported", "toast.errorClass.modelUnavailable",
    "toast.errorClass.internalState",
  ]],
  // toastKey's local complete/partial literals in storeGenImpl.ts.
  ["ui/src/store/storeGenImpl.ts :: toastKey", ["multimode.complete", "multimode.partial"]],
  // agentToolLabelKey() in ui/src/lib/agentToolFormatting.ts returns exactly these
  // literals (TOOL_LABEL_KEYS) or null, and null short-circuits to the raw tool name.
  ["ui/src/components/agent/AgentToolCallRow.tsx :: labelKey", [
    "agent.toolLabel.getImageContext", "agent.toolLabel.webSearch",
    "agent.toolLabel.generateImage", "agent.toolLabel.generateVideo",
    "agent.toolLabel.getGenerationErrors",
  ]],
  // Same resolver, mapped over the group's distinct tool names.
  ["ui/src/components/agent/AgentToolGroup.tsx :: key", [
    "agent.toolLabel.getImageContext", "agent.toolLabel.webSearch",
    "agent.toolLabel.generateImage", "agent.toolLabel.generateVideo",
    "agent.toolLabel.getGenerationErrors",
  ]],
]);

const ERROR_CARD_ROOTS = [
  "errorCard.unknown", "errorCard.moderationRefused", "errorCard.emptyResponse",
  "errorCard.streamParseFailed", "errorCard.imageToolNotCalled", "errorCard.webSearchOnlyResponse",
  "errorCard.imageToolFailed", "errorCard.imageToolNoResult", "errorCard.oauthImageCapabilityUnavailable",
  "errorCard.responsesStreamError", "errorCard.upstream5xx", "errorCard.authChatgptExpired",
  "errorCard.authApiKeyInvalid", "errorCard.networkFailed", "errorCard.oauthUnavailable",
  "errorCard.invalidRequest", "errorCard.apikeyDisabled", "errorCard.agyGenerationFailed",
  "errorCard.agyTimeout", "errorCard.agyProcessError", "errorCard.agyQuotaExhausted",
  "errorCard.authClass", "errorCard.billingRequired",
  "errorCard.naiApiKeyMissing", "errorCard.naiAuthFailed", "errorCard.naiSubscriptionRequired",
  "errorCard.naiUsageExhausted",
  "errorCard.naiZipInvalid", "errorCard.naiResponseNotZip", "errorCard.naiImageInvalid",
  "errorCard.naiUpstreamError",
] as const;

// Toast.tsx has no static template head because cardKey precedes the literal suffix. Its finite
// roots come from errorCodes.ts; keeping these exact signatures prevents a broad template escape.
const DYNAMIC_T_TEMPLATES = new Map<string, readonly string[]>([
  ["ui/src/components/Toast.tsx :: `${cardKey}.title`",
    ERROR_CARD_ROOTS.map((root) => `${root}.title`)],
  ["ui/src/components/Toast.tsx :: `${cardKey}.body`",
    ERROR_CARD_ROOTS.map((root) => `${root}.body`)],
  ["ui/src/components/Toast.tsx :: `${row.cardKey ?? \"errorCard.unknown\"}.cta`",
    ["errorCard.moderationRefused.cta", "errorCard.emptyResponse.cta", "errorCard.streamParseFailed.cta", "errorCard.imageToolNotCalled.cta", "errorCard.webSearchOnlyResponse.cta", "errorCard.imageToolFailed.cta", "errorCard.imageToolNoResult.cta", "errorCard.oauthImageCapabilityUnavailable.cta", "errorCard.responsesStreamError.cta", "errorCard.upstream5xx.cta", "errorCard.authChatgptExpired.cta", "errorCard.authApiKeyInvalid.cta", "errorCard.networkFailed.cta", "errorCard.oauthUnavailable.cta", "errorCard.invalidRequest.cta", "errorCard.apikeyDisabled.cta", "errorCard.agyGenerationFailed.cta", "errorCard.agyTimeout.cta", "errorCard.agyProcessError.cta", "errorCard.agyQuotaExhausted.cta", "errorCard.authClass.cta", "errorCard.naiApiKeyMissing.cta", "errorCard.naiAuthFailed.cta", "errorCard.naiSubscriptionRequired.cta", "errorCard.naiZipInvalid.cta", "errorCard.naiResponseNotZip.cta", "errorCard.naiImageInvalid.cta", "errorCard.naiUpstreamError.cta"]],
  ["ui/src/lib/agentQueueError.ts :: `${resolved.spec.cardKey}.title`",
    ERROR_CARD_ROOTS.map((root) => `${root}.title`)],
]);

// These are genuine current source references without dictionary leaves. They remain visible and
// exact: adding the leaves makes this test fail until the entry is removed instead of hiding debt.
const KNOWN_MISSING = new Set<string>([
  // lib/cardNewsRoleTemplateStore.ts emits these roles, but cardNews.roles omits them.
  "cardNews.roles.core",
  "cardNews.roles.tip1",
  "cardNews.roles.tip2",
  // CHAINING_ACTIONS exposes saveAsElement without a matching dictionary leaf.
  "chain.saveAsElement",
  // CardNewsWorkspace.tsx references these mobile banner literals directly.
  "mobile.cardNewsBanner",
  "mobile.dismiss",
  // ReferenceTray.tsx references this provider-limit copy directly.
  "prompt.refOverProviderLimit",
  // resultChaining.ts uses this missing fork-failure toast literal.
  "toast.forkFailed",
]);

function reasoningKeys(): readonly string[] {
  return [
    "settings.reasoning.none", "settings.reasoning.low", "settings.reasoning.medium",
    "settings.reasoning.high", "settings.reasoning.xhigh", "settings.reasoning.max",
  ];
}

function comfyDisplayKeys(): readonly string[] {
  return [
    "comfy.display.loading", "comfy.display.refreshing", "comfy.display.loadFailed",
    "comfy.display.appAccessRequired", "comfy.display.unavailable", "comfy.display.empty",
    "comfy.statusOffline", "comfy.display.chooseWorkflow", "comfy.display.selectedMissing",
    "comfy.display.selectedOffline", "comfy.display.selectedLocked", "comfy.display.available",
  ];
}

function readDictionary(path: string): Dictionary {
  return JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), "utf8")) as Dictionary;
}

function isDictionary(value: unknown): value is Dictionary {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(dictionary: Dictionary, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (!isDictionary(value)) return undefined;
    return value[part];
  }, dictionary);
}

function flattenLeafPaths(dictionary: Dictionary, prefix = "", leaves = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isDictionary(value)) flattenLeafPaths(value, path, leaves);
    else leaves.add(path);
  }
  return leaves;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function sourceRelativePath(path: string): string {
  return relative(PROJECT_ROOT, path).split(sep).join("/");
}

function expressionSignature(file: string, expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return `${file} :: ${expression.getText(sourceFile)}`;
}

function templateNamespace(head: string): string | null {
  const trimmed = head.endsWith(".") ? head.slice(0, -1) : head;
  if (!trimmed) return null;
  const lastDot = trimmed.lastIndexOf(".");
  return head.endsWith(".") || lastDot < 0 ? trimmed : trimmed.slice(0, lastDot);
}

function resolveTranslationExpression(
  expression: ts.Expression,
  file: string,
  sourceFile: ts.SourceFile,
  result: CollectedTranslations,
): void {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    result.keys.add(expression.text);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    resolveTranslationExpression(expression.whenTrue, file, sourceFile, result);
    resolveTranslationExpression(expression.whenFalse, file, sourceFile, result);
    return;
  }
  const signature = expressionSignature(file, expression, sourceFile);
  if (ts.isTemplateExpression(expression)) {
    const namespace = templateNamespace(expression.head.text);
    if (namespace) result.templateNamespaces.add(namespace);
    else addRegisteredKeys(signature, DYNAMIC_T_TEMPLATES, result, sourceFile, expression);
    return;
  }
  result.dynamicSignatures.add(signature);
  addRegisteredKeys(signature, DYNAMIC_T_IDENTIFIERS, result, sourceFile, expression);
}

function addRegisteredKeys(
  signature: string,
  registry: ReadonlyMap<string, readonly string[]>,
  result: CollectedTranslations,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): void {
  const candidates = registry.get(signature);
  if (candidates) {
    for (const key of candidates) result.keys.add(key);
    return;
  }
  const line = sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile)).line + 1;
  result.unresolved.push(`${sourceRelativePath(sourceFile.fileName)}:${line} t(${expression.getText(sourceFile)})`);
}

function collectTranslationCalls(): CollectedTranslations {
  const result: CollectedTranslations = {
    keys: new Set(), templateNamespaces: new Set(), dynamicSignatures: new Set(), unresolved: [],
  };
  for (const filePath of sourceFiles(UI_SOURCE_ROOT)) {
    const text = readFileSync(filePath, "utf8");
    const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, kind);
    const file = sourceRelativePath(filePath);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
        const argument = node.arguments[0];
        if (argument) resolveTranslationExpression(argument, file, sourceFile, result);
        else result.unresolved.push(`${file}: t() has no key argument`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return result;
}

test("all locale dictionaries have identical leaf paths", () => {
  const expected = [...flattenLeafPaths(en)].sort();
  for (const [locale, dictionary] of dictionaries) {
    assert.deepEqual([...flattenLeafPaths(dictionary)].sort(), expected, `${locale} leaf paths`);
  }
});

test("root dotted keys are exactly the frozen legacy set", () => {
  for (const [locale, dictionary] of dictionaries) {
    const dotted = Object.keys(dictionary).filter((key) => key.includes(".")).sort();
    assert.deepEqual(dotted, [...LEGACY_DOTTED_ROOTS].sort(), `${locale} dotted roots`);
  }
});

test("legacy dotted roots are shadowed by nested keys", () => {
  for (const key of LEGACY_DOTTED_ROOTS) {
    for (const [locale, dictionary] of dictionaries) {
      assert.equal(typeof getPath(dictionary, key), "string", `nested ${key} must resolve in ${locale}`);
    }
  }
});

test("new navigation and asset keys are non-empty strings", () => {
  for (const key of REQUIRED_KEYS) {
    for (const [locale, dictionary] of dictionaries) {
      const value = getPath(dictionary, key);
      assert.ok(typeof value === "string" && value.trim().length > 0, `${locale} missing ${key}`);
    }
  }
});

test("every t() reference resolves or is an explicit known missing key", () => {
  const collected = collectTranslationCalls();
  assert.deepEqual(collected.unresolved, [], "every dynamic t(expr) needs an explicit finite resolver");
  assert.deepEqual([...collected.dynamicSignatures].sort(), [...DYNAMIC_T_IDENTIFIERS.keys()].sort());
  for (const namespace of collected.templateNamespaces) {
    assert.ok(isDictionary(getPath(en, namespace)), `en template namespace must be an object: ${namespace}`);
  }
  for (const [locale, dictionary] of dictionaries) {
    const missing = [...collected.keys].filter((key) => typeof getPath(dictionary, key) !== "string").sort();
    assert.deepEqual(missing, [...KNOWN_MISSING].sort(), `${locale}: unexpected or stale KNOWN_MISSING keys`);
  }
});

test("sprite remains a top-level object whose tab label participates in parity", () => {
  for (const [locale, dictionary] of dictionaries) {
    assert.ok(isDictionary(dictionary.sprite), `${locale}.sprite must be an object`);
    assert.equal(typeof getPath(dictionary, "sprite.tabs.label"), "string", `${locale} sprite label`);
    assert.ok(flattenLeafPaths(dictionary).has("sprite.tabs.label"), `${locale} sprite parity`);
  }
});
