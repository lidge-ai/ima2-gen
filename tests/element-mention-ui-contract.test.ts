import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findMentionAtCaret } from "../ui/src/lib/elementMention.ts";
import { selectMissingElementIds } from "../ui/src/lib/elementCatalog.ts";
import { buildElementMentionChipModels } from "../ui/src/components/composer/ElementMentionChips.tsx";
import {
  addTrayElementImpl,
  syncElementCatalogImpl,
} from "../ui/src/lib/elementCatalog.ts";
import { removeTrayElementImpl } from "../ui/src/lib/elementCatalog.ts";

const read = (path) => readFileSync(path, "utf8");
const composer = read("ui/src/components/PromptComposer.tsx");
const menu = read("ui/src/components/ElementMentionMenu.tsx");
const chip = read("ui/src/components/ElementMentionChip.tsx");
const chipRow = read("ui/src/components/composer/ElementMentionChips.tsx");
const referenceStore = read("ui/src/store/storeReferenceImpl.ts");
const elementCatalog = read("ui/src/lib/elementCatalog.ts");
const generateButton = read("ui/src/components/GenerateButton.tsx");
const generateEntry = read("ui/src/store/storeGenerateEntryImpl.ts");
const css = read("ui/src/styles/element-mention.css");
const assetsStore = read("lib/assetsStore.ts");

function elementAsset(overrides: any = {}) {
  return {
    id: "el_hero",
    kind: "element",
    name: "Hero",
    filePath: null,
    folderId: null,
    notes: null,
    metadata: { elementKind: "character", refs: ["hero.png"] },
    tags: ["lead"],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createReferenceStoreHarness(overrides: any = {}) {
  let state = {
    assets: [],
    elementCatalog: null,
    missingElementIds: [],
    trayItems: [],
    nextAttachmentOrdinal: 1,
    retiredTags: {},
    referenceImages: [],
    selectedElementIds: [],
    activeReferenceLimit: () => 12,
    insertedPrompts: [],
    ...overrides,
  };
  const get = () => state;
  const set = (update) => {
    const patch = typeof update === "function" ? update(state) : update;
    state = { ...state, ...patch };
  };
  return { get, set };
}

test("EM-01 @ trigger opens the recent element order", () => {
  assert.deepEqual(findMentionAtCaret("@", 1), { start: 0, end: 1, query: "" });
  for (const value of [" @", "(@", "[@"]) {
    assert.deepEqual(findMentionAtCaret(value, value.length)?.query, "");
  }
  assert.match(menu, /if \(!normalized\) return elements/);
  assert.match(assetsStore, /ORDER BY created_at DESC, id DESC LIMIT \?/);
});

test("EM-02 query range filters localized names and tags with an empty state", () => {
  assert.deepEqual(findMentionAtCaret("make @ca now", 8), {
    start: 5,
    end: 8,
    query: "ca",
  });
  assert.match(menu, /query\.trim\(\)\.toLocaleLowerCase\(\)/);
  assert.match(menu, /\[element\.name, \.\.\.\(element\.tags \?\? \[\]\)\]/);
  assert.match(menu, /value\.toLocaleLowerCase\(\)\.includes\(normalized\)/);
  assert.match(menu, /ariaLabel/);
  assert.match(menu, /emptyLabel/);
  assert.match(menu, /kindLabel\(element\.kind\)/);
  assert.match(menu, /element-mention-menu__empty[\s\S]*\{emptyLabel\}/);
  assert.match(composer, /ariaLabel=\{t\("common\.elementSuggestions"\)\}/);
  assert.match(composer, /emptyLabel=\{t\("common\.noMatchingElements"\)\}/);
});

test("EM-03 email and non-boundary @ characters do not trigger", () => {
  assert.equal(findMentionAtCaret("user@example.com", 12), null);
  assert.equal(findMentionAtCaret("foo@ca", 6), null);
  assert.equal(findMentionAtCaret("foo,@ca", 7), null);
  assert.equal(findMentionAtCaret("foo/@ca", 7), null);
});

test("EM-04 international mention characters stay on their current line", () => {
  assert.deepEqual(findMentionAtCaret("@한글_2-test", 10), {
    start: 0,
    end: 10,
    query: "한글_2-test",
  });
  assert.equal(findMentionAtCaret("@old\nplain", 10), null);
  assert.deepEqual(findMentionAtCaret("@old\n@한글_2-test", 15), {
    start: 5,
    end: 15,
    query: "한글_2-test",
  });
});

test("EM-05 IME updates only committed mentions and text mutation clears Escape suppression", () => {
  assert.match(composer, /const composingRef = useRef\(false\)/);
  assert.match(composer, /if \(composingRef\.current\) return/);
  assert.match(composer, /onCompositionStart=\{\(\) => \{[\s\S]*composingRef\.current = true[\s\S]*setMentionQuery\(null\)/);
  assert.match(composer, /onCompositionEnd=\{\(e\) => \{[\s\S]*composingRef\.current = false[\s\S]*updateMentionAtCaret\(e\.currentTarget\.value, e\.currentTarget\.selectionStart\)/);
  assert.match(composer, /compositionCommitRef\.current === e\.target\.value\) return/);
  const clear = composer.indexOf("dismissedMentionKeyRef.current = null", composer.indexOf("onChange="));
  const update = composer.indexOf("updateMentionAtCaret(e.target.value", clear);
  assert.ok(clear >= 0 && update > clear, "text mutation must clear sticky suppression before mention update");
});

test("EM-06 keyboard selection writes a full snapshot and only replaces the active range", () => {
  assert.match(menu, /ArrowDown[\s\S]*ArrowUp[\s\S]*% Math\.max/);
  assert.match(menu, /Home"\) \{ event\.preventDefault\(\); setActive\(0\)/);
  assert.match(menu, /End"\)[\s\S]*visibleElements\.length - 1/);
  assert.match(menu, /Enter"\)[\s\S]*selectActive\(\)/);
  assert.match(menu, /Tab" && visibleElements\.length\) \{ selectActive\(\)/);
  assert.match(menu, /Escape"\)[^\n]*onClose\("escape"\)/);
  assert.match(composer, /onClose=\{\(reason\) => \{\s*if \(reason === "escape" && mentionQuery\) dismissedMentionKeyRef\.current = mentionKey\(mentionQuery\)/);
  assert.match(composer, /const asset = elements\.find\(\(candidate\) => candidate\.id === id\)/);
  assert.match(composer, /addElementFromMention\(asset\)/);
  assert.match(composer, /currentPrompt\.slice\(0, mention\.start\)[\s\S]*currentPrompt\.slice\(mention\.end\)/);

  const hero = elementAsset();
  const store = createReferenceStoreHarness();
  const item = addTrayElementImpl(hero.id, store.set, store.get, hero);
  assert.equal((item as any)?.source.elementId, hero.id);
  assert.deepEqual(store.get().selectedElementIds, [hero.id]);
  assert.equal(store.get().elementCatalog.find((asset) => asset.id === hero.id)?.name, "Hero");
  const models = buildElementMentionChipModels(
    store.get().trayItems,
    store.get().elementCatalog,
    store.get().missingElementIds,
  );
  assert.equal(models.length, 1);
  assert.equal(models[0].elementId, hero.id);
  assert.equal(models[0].missing, false);

  for (const invalid of [
    elementAsset({ id: "wrong" }),
    elementAsset({ kind: "image" }),
  ]) {
    const rejected = createReferenceStoreHarness();
    assert.equal(addTrayElementImpl(hero.id, rejected.set, rejected.get, invalid), null);
    assert.deepEqual(rejected.get().trayItems, []);
    assert.equal(rejected.get().elementCatalog, null);
  }
});

test("EM-07 Escape sticky-closes the same mention until text changes", () => {
  assert.match(composer, /dismissedMentionKeyRef = useRef<string \| null>\(null\)/);
  assert.match(composer, /mentionKey\(next\) !== dismissedMentionKeyRef\.current \? next : null/);
  assert.match(composer, /e\.key === "Escape" && mentionQuery[\s\S]*dismissedMentionKeyRef\.current = mentionKey\(mentionQuery\)[\s\S]*setMentionQuery\(null\)/);
  assert.match(composer, /onClick=\{\(e\) => updateMentionAtCaret/);
});

test("EM-08 mobile mention menu is a safe-area bottom sheet", () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.element-mention-menu\.is-mobile[\s\S]*right: 0;[\s\S]*bottom: 0;[\s\S]*left: 0/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(menu, /style=\{mobile \? undefined : \{/);
});

test("EM-09 missing elements remain visible and block composer generation", () => {
  const hero = elementAsset();
  const store = createReferenceStoreHarness();
  addTrayElementImpl(hero.id, store.set, store.get, hero);
  syncElementCatalogImpl([], store.set, store.get);
  assert.deepEqual(store.get().selectedElementIds, [hero.id]);
  assert.deepEqual(store.get().missingElementIds, [hero.id]);
  assert.deepEqual(selectMissingElementIds(store.get().trayItems, null), []);
  assert.deepEqual(selectMissingElementIds(store.get().trayItems, []), [hero.id]);
  assert.deepEqual(buildElementMentionChipModels(
    store.get().trayItems,
    store.get().elementCatalog,
    store.get().missingElementIds,
  )[0], {
    elementId: hero.id,
    name: "Hero",
    kind: "character",
    thumbnail: undefined,
    missing: true,
  });
  assert.match(chipRow, /name: asset\?\.name \?\? item\.source\.nameAtInsertion/);
  assert.match(chip, /is-missing/);
  assert.match(chip, /aria-label=\{unavailableLabel\}/);
  assert.match(composer, /unavailableLabel=\{t\("common\.elementUnavailable"\)\}/);
  assert.match(chip, /element-mention-chip__thumbnail/);
  assert.match(chip, /element-mention-chip__name/);
  assert.match(composer, /if \(missingElementIds\.length > 0\) return;[\s\S]*void generate\(\)/);
});

test("EM-10 duplicate selection keeps one ordered chip and focuses it", () => {
  const hero = elementAsset();
  const store = createReferenceStoreHarness();
  assert.ok(addTrayElementImpl(hero.id, store.set, store.get, hero));
  assert.equal(addTrayElementImpl(hero.id, store.set, store.get, hero), null);
  assert.deepEqual(store.get().selectedElementIds, [hero.id]);
  assert.equal(store.get().trayItems.length, 1);
  assert.equal(store.get().elementCatalog.length, 1);
  assert.equal(buildElementMentionChipModels(
    store.get().trayItems,
    store.get().elementCatalog,
    store.get().missingElementIds,
  ).length, 1);
  assert.match(elementCatalog, /state\.trayItems\.some\(\(item\) => item\.kind === "element"/);
  assert.match(composer, /\[data-element-id=[\s\S]*element-mention-chip__body[\s\S]*\?\.focus\(\)/);
});

test("EM-11 each chip removes only its stable element ID", () => {
  const hero = elementAsset();
  const store = createReferenceStoreHarness();
  addTrayElementImpl(hero.id, store.set, store.get, hero);
  assert.match(chipRow, /onRemove=\{props\.onRemove\}/);
  assert.match(composer, /onRemove=\{\(elementId\) => elementSelection\.removeElementId\?\.\(elementId\)\}/);
  assert.match(elementCatalog, /export function removeTrayElementImpl[\s\S]*retireTrayTags\(state\.retiredTags, \[removed\]\)/);
  assert.match(referenceStore, /export \{ removeTrayElementImpl \} from "\.\.\/lib\/elementCatalog"/);
  assert.match(chip, /element-mention-chip__remove[\s\S]*aria-label=\{removeLabel\}/);
  assert.match(composer, /removeLabel=\{\(name\) => t\("element\.removeAria", \{ name \}\)\}/);
  // Executable: simulate missing, then actually remove the element and assert
  // the missing marker clears (Euler false-confidence fix).
  syncElementCatalogImpl([], store.set, store.get);
  assert.deepEqual(store.get().missingElementIds, [hero.id]);
  removeTrayElementImpl(hero.id, store.set, store.get);
  assert.deepEqual(store.get().selectedElementIds, []);
  assert.deepEqual(store.get().missingElementIds, []);
});

test("EM-11b restoring the catalog clears the missing marker", () => {
  const hero = elementAsset();
  const store = createReferenceStoreHarness();
  addTrayElementImpl(hero.id, store.set, store.get, hero);
  syncElementCatalogImpl([], store.set, store.get);
  assert.deepEqual(store.get().missingElementIds, [hero.id]);
  syncElementCatalogImpl([hero], store.set, store.get);
  assert.deepEqual(store.get().missingElementIds, []);
});

test("EM-12 caret positioning, portal, and listbox ARIA clean up together", () => {
  assert.match(menu, /textarea\.value\.slice\(0, caret\)/);
  assert.match(menu, /marker\.getBoundingClientRect\(\)/);
  assert.match(menu, /const MIN_BOTTOM_SPACE = 240/);
  assert.match(menu, /const VIEWPORT_PADDING = 12/);
  assert.match(menu, /requestAnimationFrame\(update\)/);
  assert.match(menu, /addEventListener\("resize"[\s\S]*addEventListener\("scroll"/);
  assert.match(menu, /removeEventListener\("resize"[\s\S]*removeEventListener\("scroll"/);
  assert.match(menu, /createPortal\(content, document\.body\)/);
  assert.match(menu, /role="listbox"/);
  assert.match(menu, /role="option" aria-selected=/);
  for (const attribute of ["aria-controls", "aria-expanded", "aria-activedescendant"]) {
    assert.match(menu, new RegExp(`setAttribute\\(\"${attribute}\"`));
    assert.match(menu, new RegExp(`removeAttribute\\(\"${attribute}\"`));
  }
});

test("EM-09b missing elements block generation at the button and the entry gate", () => {
  // GenerateButton: native disabled + explanatory title when missing ids exist.
  assert.match(generateButton, /missingElementIds \?\? \[\]/);
  assert.match(generateButton, /disabled=\{missingBlocked\}/);
  assert.match(generateButton, /title=\{missingBlocked \? t\("toast\.missingElements"\) : undefined\}/);
  // generateImpl: programmatic early-return before any provider dispatch.
  assert.match(generateEntry, /missingElementIds \?\? \[\]\)\.length > 0/);
  assert.match(generateEntry, /showToast\(t\("toast\.missingElements"\), true\)/);
  // generateImpl: the block call precedes provider dispatch inside the entry.
  const entryBody = generateEntry.slice(generateEntry.indexOf("export async function generateImpl"));
  assert.ok(entryBody.indexOf("missingElementsBlock(get)") < entryBody.indexOf("runVideoGenerate"), "missing gate must run before provider dispatch");
  // Custom-size approval and animate also recheck (post-modal state can change).
  const confirmBody = generateEntry.slice(generateEntry.indexOf("export async function confirmCustomSizeAdjustmentImpl"));
  assert.ok(confirmBody.indexOf("missingElementsBlock(get)") > -1 && confirmBody.indexOf("missingElementsBlock(get)") < confirmBody.indexOf("runGenerate(adjustedSize)"), "custom-size approval must recheck before dispatch");
  // The guard whitelists classic/multimode explicitly — all three node
  // continuation kinds (node, node-in-place, node-variation) stay outside.
  assert.match(confirmBody, /kind === "classic" \|\| pending\.continuation\.kind === "multimode"\) && missingElementsBlock/, "guard must whitelist classic/multimode only");
  for (const nodeKind of ['"node"', '"node-in-place"', '"node-variation"']) {
    assert.ok(confirmBody.includes(nodeKind), `continuation kind ${nodeKind} must exist in the dispatch matrix`);
  }
  const videoImpl = read("ui/src/store/storeVideoImpl.ts");
  assert.match(videoImpl, /missingElementsBlock } from "\.\/storeGenerateEntryImpl"/);
  const animateBody = videoImpl.slice(videoImpl.indexOf("export async function animateImageImpl"));
  assert.ok(animateBody.indexOf("missingElementsBlock(get)") > -1 && animateBody.indexOf("missingElementsBlock(get)") < animateBody.indexOf("compilePresets"), "animate must block before payload assembly");
  assert.match(animateBody, /return false;/);
  // Callers toast success only when the job actually started (no error+success pair).
  const resultActions = read("ui/src/components/ResultActions.tsx");
  const chaining = read("ui/src/lib/resultChaining.ts");
  assert.match(resultActions, /if \(started\) showToast\(t\("toast\.animateDone"\)\)/);
  assert.match(chaining, /if \(started\) store\.showToast\(t\("toast\.animateDone"\)\)/);
  // Store contract: catalog state and actions are formally bound.
  const storeTypes = read("ui/src/store/storeTypes.ts");
  const appStore = read("ui/src/store/useAppStore.ts");
  assert.match(storeTypes, /elementCatalog: AssetItem\[\] \| null/);
  assert.match(storeTypes, /missingElementIds: string\[\]/);
  assert.match(storeTypes, /addElementFromMention: \(asset: AssetItem\) => TrayItem \| null/);
  assert.match(appStore, /elementCatalog: null/);
  assert.match(appStore, /missingElementIds: \[\]/);
  assert.match(appStore, /addElementFromMention: \(asset\) => addTrayElementImpl\(asset\.id, set, get, asset\)/);
  assert.match(appStore, /syncElementCatalog: \(records\) => syncElementCatalogImpl\(records, set, get\)/);
});
