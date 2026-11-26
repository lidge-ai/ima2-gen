// Vendor logos live in one folder (studios/kit/assets/vendors) and are served as-is to every UI.
// A file drawn in white ink is for dark backgrounds: labelled otherwise, studios put it on a light
// plate where it disappears. SVGs must also carry xmlns, or browsers will not render them as images.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "studios/kit/assets/vendors";
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
  vendors: { id: string; files: { file: string; variant: string }[] }[];
};
const WHITE = new Set(["#fff", "#ffffff", "white", "#fefefe", "#fffffe", "#fafafa", "rgb(255,255,255)", "rgba(255,255,255,1)"]);

function inkColors(svg: string): string[] {
  return [...svg.matchAll(/(?:fill|stroke|stop-color)\s*[=:]\s*"?\s*(#[0-9a-fA-F]{3,8}|white|black|rgba?\([^)]*\))/g)].map((m) => m[1]!.toLowerCase().replace(/\s+/g, ""));
}

test("every manifest file exists under a name the server serves", () => {
  for (const v of manifest.vendors) {
    for (const f of v.files) {
      assert.match(f.file, /^[a-z0-9][a-z0-9._-]*\.(svg|png|webp|jpe?g)$/i, f.file);
      assert.ok(existsSync(join(DIR, f.file)), `${f.file} is missing`);
    }
  }
});

test("white-ink SVG logos are labelled for dark backgrounds, and every SVG declares xmlns", () => {
  for (const v of manifest.vendors) {
    for (const f of v.files.filter((x) => x.file.endsWith(".svg"))) {
      const svg = readFileSync(join(DIR, f.file), "utf8");
      assert.match(svg, /<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${f.file} lacks xmlns`);
      const ink = inkColors(svg);
      if (ink.length > 0 && ink.every((c) => WHITE.has(c))) {
        assert.equal(f.variant, "dark", `${f.file} is white ink but labelled ${f.variant}`);
      }
    }
  }
});
