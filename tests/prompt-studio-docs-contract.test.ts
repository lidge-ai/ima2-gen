import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

function lineCount(path) {
  return readSource(path).split("\n").length;
}

describe("prompt studio public docs contract", () => {
  it("publishes focused English and Korean Prompt Studio manuals", () => {
    const en = readSource("docs/PROMPT_STUDIO.md");
    const ko = readSource("docs/PROMPT_STUDIO.ko.md");

    for (const source of [en, ko]) {
      assert.match(source, /Feature Map|기능 지도/);
      assert.match(source, /Multimode|멀티모드/);
      assert.match(source, /1:1 Direct/);
      assert.match(source, /Reasoning|추론 강도/);
      assert.match(source, /Gallery|갤러리/);
      assert.match(source, /Issue #75/);
      assert.match(source, /Do not share|공유하지 마세요/);
    }

    assert.match(en, /Each slot is a candidate output, not a collage panel/);
    assert.match(ko, /각 슬롯은 후보 이미지입니다/);
    assert.match(en, /Passive image selection is view-only/);
    assert.match(ko, /단순 이미지 선택은 보기 전용/);
    assert.ok(lineCount("docs/PROMPT_STUDIO.md") < 500);
    assert.ok(lineCount("docs/PROMPT_STUDIO.ko.md") < 500);
  });

  it("links the manual from README and FAQ support surfaces", () => {
    const readme = readSource("README.md");
    const readmeKo = readSource("docs/README.ko.md");
    const faq = readSource("docs/FAQ.md");
    const faqKo = readSource("docs/FAQ.ko.md");

    assert.match(readme, /\[Prompt Studio manual\]\(docs\/PROMPT_STUDIO\.md\)/);
    assert.match(readmeKo, /\[Prompt Studio 사용 설명서\]\(PROMPT_STUDIO\.ko\.md\)/);
    assert.match(faq, /\[Prompt Studio manual\]\(PROMPT_STUDIO\.md\)/);
    assert.match(faqKo, /\[Prompt Studio 사용 설명서\]\(PROMPT_STUDIO\.ko\.md\)/);
  });

  it("keeps issue 75 user-facing behavior documented", () => {
    const faq = readSource("docs/FAQ.md");
    const faqKo = readSource("docs/FAQ.ko.md");
    const manual = readSource("docs/PROMPT_STUDIO.md");

    assert.match(faq, /keyboard movement now follows the visible recent history domain/);
    assert.match(faq, /passive image selection does not refill the composer/);
    assert.match(faqKo, /키보드 이동은\s*\n?보이는 최근 생성 범위를 따르고/);
    assert.match(faqKo, /단순 이미지 선택은\s*\n?작성창을 자동으로 채우지 않습니다/);
    assert.match(manual, /gallery favorite toggles and tab changes preserve the browsing viewport/);
  });
});
