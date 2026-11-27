// Workflow text in Korean (L6 with L7): one dictionary, sent as i18n.ko by GET /api/workflows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKFLOWS, describeWorkflow } from "../lib/workflows/index.js";
import { englishStrings } from "../lib/workflows/i18n/index.js";
import { KO } from "../lib/workflows/i18n/ko.js";

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
