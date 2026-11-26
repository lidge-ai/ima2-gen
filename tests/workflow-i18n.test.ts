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
