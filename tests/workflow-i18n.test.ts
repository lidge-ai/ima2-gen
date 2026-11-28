// Workflow text in Korean (L6 with L7): one dictionary, sent as i18n.ko by GET /api/workflows.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type { MediaModelSpec } from "../lib/providers/media/contract.js";
import { WORKFLOWS, describeWorkflow, prepareWorkflow, summarizeSteps } from "../lib/workflows/index.js";
import { englishStrings } from "../lib/workflows/i18n/index.js";
import { KO } from "../lib/workflows/i18n/ko.js";
import { fakeGateway, fakeLocal, spec, tempDir, writeFixture } from "./_workflowFakes.js";

test("every English string a workflow sends has a Korean entry", () => {
  const missing = WORKFLOWS.flatMap((w) => englishStrings(w).filter((s) => !(s in KO)).map((s) => w.id + ": " + s));
  assert.deepEqual(missing, []);
});

test("describeWorkflow sends i18n.ko keyed like the wire: fields by name, options by value, slots by name", () => {
  const d = describeWorkflow(WORKFLOWS.find((w) => w.id === "remix-motion-transfer")!);
  assert.equal(d.i18n.ko.label, "리믹스: 모션 전이");
  assert.equal(d.i18n.ko.fields?.images?.help, "움직임을 따라 할 인물이나 대상 이미지 1~8장, 순서대로.");
  assert.deepEqual(d.i18n.ko.fields?.tier?.options, { standard: "표준", lite: "라이트 (더 빠르고 저렴한 모델)" });
  assert.equal(d.i18n.ko.fields?.resolution?.options, undefined, "resolution values read the same in every language");
  assert.equal(d.i18n.ko.fields?.resolution?.label, "해상도");
  assert.deepEqual(d.i18n.ko.slots, { render: "영상 편집" });
  assert.equal(d.label, "Remix: motion transfer", "English stays in the original fields");
});

test("presets and combos carry their text, losses aligned by index", () => {
  const sub = describeWorkflow(WORKFLOWS.find((w) => w.id === "remix-restyle-subscription")!);
  assert.equal(sub.i18n.ko.preset?.label, "구독만 사용");
  assert.equal(sub.i18n.ko.preset?.losses?.length, sub.preset?.losses.length);
  assert.equal(sub.i18n.ko.preset?.requires?.["xai-oauth"], "영상용 Grok 구독 (Grok OAuth)");
  const open = describeWorkflow(WORKFLOWS.find((w) => w.id === "remix-restyle-open")!);
  assert.equal(open.i18n.ko.slots?.subject, "첫 프레임 리스타일");
  assert.equal(open.i18n.ko.combos?.byteplus?.label, "BytePlus만");
});

test("a definition's own i18n.ko overrides the dictionary", () => {
  const base = WORKFLOWS.find((w) => w.id === "director-cast")!;
  const d = describeWorkflow({ ...base, i18n: { ko: { label: "캐릭터 시트" } } });
  assert.equal(d.i18n.ko.label, "캐릭터 시트");
  assert.equal(d.i18n.ko.description, "일관된 캐릭터 레퍼런스 시트를 만듭니다.");
});

/** Every string in a value, depth first. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("each slot has a one-sentence description for people, with sources and notes kept out of it", () => {
  for (const w of WORKFLOWS) {
    for (const slot of describeWorkflow(w).slots) {
      const where = w.id + "/" + slot.name;
      assert.ok(slot.description, where + " has a description");
      assert.ok(slot.description!.length <= 120, where + " description is one short sentence");
      assert.equal((slot.description!.match(/[.!?](\s|$)/g) ?? []).length, 1, where + " description is one sentence");
      assert.doesNotMatch(slot.description!, /https?:|\bMIT\b|Apache|licen[cs]e|read 20\d\d|lib\//, where + " description carries no source, licence or code reference");
    }
  }
});

test("sources are a separate list on the slots that borrow a design, not text", () => {
  const open = describeWorkflow(WORKFLOWS.find((w) => w.id === "remix-motion-transfer-open")!);
  const credits = open.slots.find((s) => s.name === "render")?.credits;
  assert.deepEqual(credits?.map((c) => [c.name, c.license]), [["D3voz/openjutsu", "MIT"], ["SydFloyd/openjutsu", "Apache-2.0"], ["alisson-anjos/Henge", "MIT"]]);
  assert.ok(credits?.every((c) => c.url?.startsWith("https://github.com/")));
});

test("the Korean block has every slot description and no English paragraphs anywhere", () => {
  for (const w of WORKFLOWS) {
    const d = describeWorkflow(w);
    for (const slot of d.slots) assert.ok(d.i18n.ko.slotDescriptions?.[slot.name], w.id + "/" + slot.name + " has a Korean description");
    // Model and product names may stay in Latin script; a run of five or more English words is untranslated prose.
    const prose = strings(d.i18n.ko).filter((s) => /[A-Za-z][A-Za-z'-]*(?:[ ,]+[A-Za-z][A-Za-z'-]*){4,}/.test(s));
    assert.deepEqual(prose, [], w.id + " Korean text has no English prose");
  }
});

test("GET /api/workflows names no other product: no competitor names in any field, English or Korean", () => {
  // Credits keep open-source project names and licences (attribution); those names are not products.
  const banned = /sume|higgs|genjutsu|parity/i;
  for (const w of WORKFLOWS) {
    const d = describeWorkflow(w);
    const hits = strings(d).filter((s) => banned.test(s));
    assert.deepEqual(hits, [], w.id);
    assert.equal("equivalents" in d, false, w.id + " sends no equivalents");
  }
});

test("slot rationale is a reviewer note kept in code: GET /api/workflows sends none, with or without a gateway", () => {
  const gateway = { catalog: () => undefined, canRun: () => true };
  for (const w of WORKFLOWS) {
    assert.ok(w.slots.every((s) => s.rationale.length > 0), w.id + " definitions keep their notes");
    for (const d of [describeWorkflow(w), describeWorkflow(w, gateway)]) {
      for (const slot of d.slots) assert.equal("rationale" in slot, false, w.id + "/" + slot.name + " sends no rationale");
      assert.doesNotMatch(JSON.stringify(d), /"rationale"/, w.id);
    }
  }
});

test("open-source project names appear only in credits", () => {
  const names = [...new Set(WORKFLOWS.flatMap((w) => w.slots.flatMap((s) => s.credits ?? []))
    .flatMap((c) => c.name.toLowerCase().split("/")))];
  assert.ok(names.includes("openjutsu") && names.includes("henge"), "credits name the open projects");
  for (const w of WORKFLOWS) {
    const withoutCredits: unknown = JSON.parse(JSON.stringify(describeWorkflow(w), (key, value: unknown) => (key === "credits" ? undefined : value)));
    const hits = strings(withoutCredits).filter((s) => names.some((n) => s.toLowerCase().includes(n)));
    assert.deepEqual(hits, [], w.id);
  }
});

// Step labels: estimates and runs list every planned step (steps[].label) with steps[].i18n.ko.label.
const stepRoot = tempDir("ima2-wf-i18n-");
after(() => rmSync(stepRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const clip = writeFixture(stepRoot, "clip.mp4", "clip");
const longClip = writeFixture(stepRoot, "long.mp4", "long");
const still = writeFixture(stepRoot, "still.png", "still");
const stepLocal = fakeLocal({
  "clip.mp4": { durationSec: 6, width: 1280, height: 720, hasAudio: true },
  "long.mp4": { durationSec: 12, width: 1280, height: 720, hasAudio: true },
}, { "clip.mp4": [], "long.mp4": [] });
const IMAGE_TASKS = new Set(["text-to-image", "image-to-image", "image-segment"]);
/** Every model a slot names, with the tasks its slots use and room for any references. */
function permissiveSpecs(): Record<string, MediaModelSpec> {
  const tasks = new Map<string, Set<string>>();
  for (const w of WORKFLOWS) for (const s of w.slots) {
    for (const m of [s.defaultModel, ...s.alternatives, ...Object.values(s.tierModels ?? {})]) tasks.set(m, (tasks.get(m) ?? new Set()).add(s.task));
  }
  return Object.fromEntries([...tasks].map(([id, t]) => {
    const list = [...t, ...(t.has("reference-to-video") ? ["text-to-video"] : [])] as MediaModelSpec["tasks"][number][];
    const kind = list.every((x) => IMAGE_TASKS.has(x)) ? "image" : list.includes("video-to-audio") ? "audio" : "video";
    return [id, spec(id, { kind, tasks: list, params: { maxReferenceImages: 30, maxReferenceVideos: 10, nativeAudio: id !== "google/gemini-omni-flash-1.2" } })];
  }));
}

test("every planned step of every workflow carries a Korean label, with no English left in it", async () => {
  const gateway = fakeGateway({}, permissiveSpecs(), () => ({}), () => true);
  const video = (path = clip) => [{ path, mimeType: "video/mp4" }];
  const images = [{ path: still, mimeType: "image/png" }];
  const shots = [{ prompt: "wide", durationSec: 5 }, { prompt: "close", durationSec: 5 }];
  const cases: [string, Record<string, unknown>, unknown?][] = [
    ["remix-motion-transfer", { video: video(), images }],
    ["remix-object-swap", { video: video(), images, target: "the boat" }],
    ["remix-restyle", { video: video(), style: "watercolor" }],
    ["remix-motion-transfer-subscription", { video: video(), images }],
    ["remix-object-swap-subscription", { video: video(), images, target: "the boat" }],
    ["remix-restyle-subscription", { video: video(longClip), style: "watercolor" }],
    ["remix-motion-transfer-open", { video: video(), images }],
    ["remix-motion-transfer-open", { video: video(), images, anchors: 2 }, { combo: "subscription" }],
    ["remix-object-swap-open", { video: video(), images, target: "the boat" }],
    ["remix-restyle-open", { video: video(), style: "watercolor" }],
    ["remix-restyle-open", { video: video(), style: "watercolor" }, { combo: "subscription" }],
    ["director-studio", { prompt: "a lake at dawn" }],
    ["director-studio", { prompt: "a lake at dawn", duration: 30 }, { models: { render: "bytedance/seedance-2" } }],
    ["director-studio", { shots }, { models: { render: "google/gemini-omni-flash-1.2" } }],
    ["director-cast", { prompt: "a hero" }],
    ["director-locations", { prompt: "a harbour" }],
    ["director-cinema", { prompt: "a still" }],
  ];
  const seen = new Map<string, string>();
  for (const [id, values, selection] of cases) {
    const p = await prepareWorkflow(WORKFLOWS.find((w) => w.id === id)!, { values, ...(selection ? { selection } : {}) },
      { gateway, local: stepLocal, allowedRoots: [stepRoot] }, new AbortController().signal);
    for (const step of summarizeSteps(p.plan)) {
      const ko = step.i18n?.ko.label;
      assert.ok(ko, id + "/" + step.id + " (" + step.label + ") has a Korean label");
      assert.doesNotMatch(ko, /[A-Za-z][A-Za-z'-]*(?:[ ,]+[A-Za-z][A-Za-z'-]*){2,}/, id + "/" + step.id + " Korean label has no English phrase");
      seen.set(step.id, ko);
    }
  }
  // The cases reached every kind of numbered or framed step.
  for (const id of ["plan-shots", "shot-2", "shot-1-last", "join", "sound", "mix", "render", "frame-key-1", "swap-key-1", "subject-key-1", "subject-first", "cut-2", "edit-2", "segment", "caption", "scenes"]) {
    assert.ok(seen.has(id), id + " was planned");
  }
  assert.equal(seen.get("shot-1-last"), "샷 1의 마지막 프레임 가져오기");
  assert.equal(seen.get("frame-key-1"), "키 프레임 1 가져오기");
  assert.equal(seen.get("shot-2"), "샷 2");
});
