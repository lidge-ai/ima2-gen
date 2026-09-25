import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\}`).exec(source)?.[0] ?? "";
}

describe("issue #77 long prompt preview layout contract", () => {
  it("renders generated prompts through a shared clamped summary component", () => {
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const canvasModeDetails = readSource("ui/src/components/canvas-mode/CanvasModeResultDetails.tsx");
    const summary = readSource("ui/src/components/ResultPromptSummary.tsx");

    assert.match(canvas, /ResultPromptSummary/);
    assert.match(canvas, /className=\{`result-preview-frame canvas-annotation-frame/);
    assert.doesNotMatch(canvas, /<div className="result-prompt" onClick=\{copyPrompt\}>/);
    assert.match(canvasModeDetails, /ResultPromptSummary/);
    assert.doesNotMatch(canvasModeDetails, /<div className="result-prompt" onClick=\{onCopyPrompt\}>/);
    assert.match(summary, /className="result-prompt"/);
    assert.match(summary, /className="result-prompt__text"/);
    assert.match(summary, /role="button"/);
    assert.match(summary, /tabIndex=\{0\}/);
    assert.match(summary, /event\.key === "Enter" \|\| event\.key === " "/);
  });

  it("bounds prompt metadata so it cannot determine preview height", () => {
    const main = readSource("ui/src/main.tsx");
    const css = readSource("ui/src/styles/result-preview.css");
    const workflowCss = readSource("ui/src/styles/viewer-workflow.css");
    const classicCss = readSource("ui/src/styles/classic-workspace.css");

    const container = cssBlock(css, ".result-container");
    const visible = cssBlock(css, ".result-container.visible");
    const frame = cssBlock(css, ".result-preview-frame");
    const image = cssBlock(css, ".result-preview-frame .result-img");
    const prompt = cssBlock(css, ".result-prompt");
    const promptText = cssBlock(css, ".result-prompt__text");

    assert.match(main, /import "\.\/styles\/result-preview\.css"/);
    assert.match(container, /min-height:\s*0/);
    assert.match(container, /overflow:\s*hidden/);
    assert.match(visible, /height:\s*min\(100%, calc\(100dvh - 48px\)\)/);
    assert.match(frame, /flex:\s*1 1 auto/);
    assert.match(frame, /min-height:\s*min\(54dvh, 420px\)/);
    assert.match(frame, /overflow:\s*hidden/);
    assert.doesNotMatch(css, /^\.result-img\s*\{/m);
    assert.match(image, /max-height:\s*100%/);
    assert.match(image, /object-fit:\s*contain/);
    assert.match(prompt, /max-height:\s*clamp\(64px, 12dvh, 132px\)/);
    assert.match(prompt, /overflow-y:\s*auto/);
    assert.match(prompt, /flex:\s*0 0 auto/);
    assert.match(promptText, /overflow-wrap:\s*anywhere/);
    assert.match(workflowCss, /\.result-container > \.result-preview-frame/);
    assert.match(classicCss, /\.classic-workspace__stage \.result-preview-frame/);
    assert.match(classicCss, /\.classic-workspace__stage \.result-prompt\s*\{[\s\S]*?display:\s*none/);
  });
});
