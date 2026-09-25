import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSourceTree } from "./_readTree.mjs";


function readSource(path) {
  return readSourceTree(path);
}

describe("in-flight prompt tooltip contract", () => {
  it("keeps compact prompt rows while exposing the full prompt", () => {
    const source = readSource("ui/src/components/InFlightList.tsx");

    assert.match(source, /const fullPrompt = f\.prompt\.trim\(\)\.replace\(/);
    assert.match(source, /const promptLabel = fullPrompt \|\| t\("inflight\.noPrompt"\)/);
    assert.match(source, /title=\{promptLabel\}/);
    assert.match(source, /aria-label=\{`\$\{phaseLabel\}: \$\{promptLabel\}`\}/);
    assert.match(source, /\{truncate\(f\.prompt\)\}/);
  });

  it("exposes cancel controls backed by the real inflight cancel action", () => {
    const source = readSource("ui/src/components/InFlightList.tsx");
    const api = readSource("ui/src/lib/api.ts");
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(source, /cancelInFlightJob/);
    assert.match(source, /className="in-flight-cancel"/);
    assert.match(source, /t\("inflight\.cancelAria"/);
    assert.match(api, /export function cancelInflight/);
    assert.match(store, /cancelInFlightJob:/);
    assert.match(store, /cancelInflight\(requestId\)/);
  });

  it("merges noPrompt into the existing locale inflight objects", () => {
    const en = JSON.parse(readSource("ui/src/i18n/en.json"));
    const ko = JSON.parse(readSource("ui/src/i18n/ko.json"));

    assert.equal(en.inflight.queued, "Queued");
    assert.equal(en.inflight.streaming, "Generating");
    assert.equal(en.inflight.decoding, "Finalizing");
    assert.equal(en.inflight.canceling, "Canceling");
    assert.equal(en.inflight.noPrompt, "No prompt");
    assert.equal(en.inflight.cancelAria, "Cancel generation: {prompt}");
    assert.equal(ko.inflight.queued, "대기 중");
    assert.equal(ko.inflight.streaming, "생성 중");
    assert.equal(ko.inflight.decoding, "마무리 중");
    assert.equal(ko.inflight.canceling, "취소 중");
    assert.equal(ko.inflight.noPrompt, "프롬프트 없음");
    assert.equal(ko.inflight.cancelAria, "생성 취소: {prompt}");
  });
});
