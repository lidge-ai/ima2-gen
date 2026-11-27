import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { localName, parseXml, walk } from "./xml.ts";

const expectedIds = [
  "bytedance",
  "alibaba",
  "tencent",
  "kling",
  "minimax",
  "vidu",
  "google",
  "openai",
  "xai",
  "meta",
  "black-forest-labs",
  "ideogram",
  "recraft",
  "pixverse",
  "heygen",
  "sand-ai",
  "veed",
  "meigen",
  "sync",
  "topaz-labs",
  "mirelo",
  "elevenlabs",
  "cartesia",
  "stability-ai",
  "ace-step",
  "tripo",
  "meshy",
  "higgsfield",
  "byteplus",
  "fal",
  "replicate",
  "atlascloud",
  "sume",
  "openrouter",
];
const assets = join(dirname(fileURLToPath(import.meta.url)), "../assets/vendors");
type Asset = { file: string; variant: string; format: string };
type Vendor = { id: string; files: Asset[]; missing?: string };
const manifest = JSON.parse(readFileSync(join(assets, "manifest.json"), "utf8")) as {
  vendors: Vendor[];
};

/** Throws unless the text is a well-formed SVG document with a size, no script and no external link. */
function checkSvg(text: string, file: string): void {
  const root = parseXml(text);
  assert.equal(localName(root.name), "svg", file + ": root is not svg");
  assert.ok(root.attrs.viewBox || (root.attrs.width && root.attrs.height), file + ": missing dimensions");
  for (const element of walk(root)) {
    assert.notEqual(localName(element.name).toLowerCase(), "script", file + ": script element");
    for (const [key, value] of Object.entries(element.attrs)) {
      if (localName(key).toLowerCase() !== "href") continue;
      assert.ok(!/^(?:https?:|\/\/)/i.test(value.trim()), file + ": external href " + value);
    }
  }
}

test("vendor manifest covers the supplier and route lists exactly once", () => {
  assert.deepEqual(manifest.vendors.map((vendor) => vendor.id).sort(), [...expectedIds].sort());
});

test("vendor files exist and SVG files are safe, well-formed documents", () => {
  const seen = new Set<string>();
  for (const vendor of manifest.vendors) {
    assert.ok(vendor.files.length || vendor.missing?.trim(), `${vendor.id} needs a missing reason`);
    for (const file of vendor.files) {
      assert.match(file.file, new RegExp(`^${vendor.id}(?:-(?:dark|light|mark))?\\.(?:svg|png|jpg|webp)$`));
      assert.ok(!seen.has(file.file), `duplicate file ${file.file}`);
      seen.add(file.file);
      assert.ok(["primary", "dark", "light", "mark"].includes(file.variant));
      assert.ok(file.file.endsWith(`.${file.format}`));
      const path = join(assets, file.file);
      assert.ok(statSync(path).size > 0, `${file.file} is empty`);
      if (file.format === "svg") checkSvg(readFileSync(path, "utf8"), file.file);
      else assert.ok(["png", "jpg", "webp"].includes(file.format), "raster format " + file.format);
    }
  }
});

test("the SVG check refuses broken, scripted and externally linked documents", () => {
  const ok = '<?xml version="1.0"?><!-- logo --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><path d="M0 0h1"/></g><![CDATA[ x < y ]]></svg>';
  assert.doesNotThrow(() => checkSvg(ok, "ok"));
  const bad: Record<string, string> = {
    unclosed: '<svg viewBox="0 0 1 1"><g></svg>',
    crossed: '<svg viewBox="0 0 1 1"><g><path></g></path></svg>',
    unquoted: "<svg viewBox=0></svg>",
    repeated: '<svg viewBox="0 0 1 1" viewBox="0 0 2 2"></svg>',
    entity: '<svg viewBox="0 0 1 1">&nbsp;</svg>',
    stray: '<svg viewBox="0 0 1 1">a < b</svg>',
    twoRoots: '<svg viewBox="0 0 1 1"/><svg viewBox="0 0 1 1"/>',
    notSvg: '<html viewBox="0 0 1 1"/>',
    noSize: "<svg/>",
    script: '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    externalHref: '<svg viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://example.com/a.svg#x"/></svg>',
    protocolRelative: '<svg viewBox="0 0 1 1"><image href="//example.com/a.png"/></svg>',
  };
  for (const [name, text] of Object.entries(bad)) assert.throws(() => checkSvg(text, name), Error, name);
});
