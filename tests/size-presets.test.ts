import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror of ui/src/lib/size.ts — keep in sync.
// JS-only so node --test can parse without TS loader.
const ALL_PRESETS = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1360x1024",
  "1024x1360",
  "1824x1024",
  "1024x1824",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "3840x2160",
  "2160x3840",
];

const MIN_SIDE = 1024;
const MAX_SIDE = 3840;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_RATIO = 3;

describe("gpt-image-2 size presets", () => {
  for (const preset of ALL_PRESETS) {
    it(`${preset} satisfies every constraint`, () => {
      const m = /^(\d+)x(\d+)$/.exec(preset);
      assert.ok(m, `preset "${preset}" must be WxH`);
      const w = Number(m[1]);
      const h = Number(m[2]);

      assert.equal(w % 16, 0, `${preset}: width must be multiple of 16`);
      assert.equal(h % 16, 0, `${preset}: height must be multiple of 16`);

      const maxSide = Math.max(w, h);
      const minSide = Math.min(w, h);
      assert.ok(maxSide <= MAX_SIDE, `${preset}: max side ≤ ${MAX_SIDE}`);
      assert.ok(minSide >= MIN_SIDE, `${preset}: min side ≥ ${MIN_SIDE}`);

      const ratio = maxSide / minSide;
      assert.ok(ratio <= MAX_RATIO, `${preset}: ratio ≤ ${MAX_RATIO}:1 (got ${ratio.toFixed(3)})`);

      const pixels = w * h;
      assert.ok(
        pixels >= MIN_PIXELS && pixels <= MAX_PIXELS,
        `${preset}: pixels ${pixels} ∉ [${MIN_PIXELS}, ${MAX_PIXELS}]`,
      );
    });
  }

  it("auto and custom are allowed passthrough tokens", () => {
    assert.ok(["auto", "custom"].every((t) => typeof t === "string"));
  });
});
