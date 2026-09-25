import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.cwd();

function readSource(path) {
  const content = readFileSync(join(root, path), "utf8");
  const dir = dirname(path);
  let combined = content;
  const re = /(?:export|import)\s+[\s\S]*?from\s*["']\.\/([\w.\/-]+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    for (const ext of ["", ".ts", ".tsx", ".js"]) {
      try { combined += "\n" + readFileSync(join(root, dir, m[1] + ext), "utf8"); break; } catch {}
    }
  }
  const cssRe = /@import\s+["']\.\/([\w.\/-]+)["']/g;
  while ((m = cssRe.exec(content)) !== null) {
    try { combined += "\n" + readFileSync(join(root, dir, m[1]), "utf8"); } catch {}
  }
  return combined;
}

describe("ComfyUI export UI contract", () => {
  it("sends filename only and preserves the stable response contract", () => {
    const api = readSource("ui/src/lib/api.ts");
    const start = api.indexOf("export function exportImageToComfy");
    const end = api.indexOf("export type ImageMetadataReadResponse");
    const comfyApi = api.slice(start, end);
    assert.match(api, /export type ComfyExportResponse/);
    assert.match(api, /uploadedFilename:\s*string/);
    assert.doesNotMatch(api, /comfyUrl:\s*string/);
    assert.match(comfyApi, /export function exportImageToComfy\(input:\s*\{\s*filename:\s*string\s*\}/);
    assert.match(comfyApi, /"\/api\/comfy\/export-image"/);
    assert.match(comfyApi, /body:\s*JSON\.stringify\(\{\s*filename:\s*input\.filename\s*\}\)/);
    assert.doesNotMatch(comfyApi, /subfolder|overwrite|workflow|prompt|client_id|extra_data/);
  });

  it("uses actionImage for More menu targeting and ComfyUI export", () => {
    const actions = readSource("ui/src/components/ResultActions.tsx");
    assert.match(actions, /const actionImage = imageOverride \?\? currentImage/);
    assert.match(actions, /if \(!actionImage\) return null/);
    assert.doesNotMatch(actions, /if \(!currentImage\) return null/);
    assert.match(actions, /const canExportToComfy = Boolean\(actionImage\.filename\)/);
    assert.match(actions, /\{actionImage\.filename && \(/);
    assert.match(actions, /trashHistoryItem\(actionImage\)/);
    assert.match(actions, /permanentlyDeleteHistoryItemByClick\(actionImage\)/);
    assert.match(actions, /exportImageToComfy\(\{\s*filename:\s*actionImage\.filename\s*\}\)/);
    assert.match(actions, /comfyExporting/);
    assert.match(actions, /disabled=\{comfyExporting\}/);
  });

  it("maps ComfyUI error codes and i18n keys", () => {
    const actions = readSource("ui/src/components/ResultActions.tsx");
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    for (const key of [
      "result.sendToComfyUI",
      "result.sendToComfyUITitle",
      "toast.comfyExported",
      "toast.comfyExportInvalidUrl",
      "toast.comfyExportInvalidImage",
      "toast.comfyExportImageNotFound",
      "toast.comfyExportFailed",
    ]) {
      const [, leaf] = key.split(".");
      assert.match(en, new RegExp(`"${leaf}"`));
      assert.match(ko, new RegExp(`"${leaf}"`));
    }

    assert.match(actions, /COMFY_URL_NOT_LOCAL/);
    assert.match(actions, /COMFY_IMAGE_INVALID/);
    assert.match(actions, /COMFY_IMAGE_NOT_FOUND/);
    assert.match(actions, /toast\.comfyExported/);
    assert.match(actions, /uploadedFilename/);
  });
});
