import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapSizeToGrokImageParams } from "../lib/grokSizeMapper.js";

describe("Grok size mapper", () => {
  it("maps ima2 presets to xAI aspect_ratio and resolution", () => {
    const cases: Array<[string, string, string]> = [
      ["1024x1024", "1:1", "1k"],
      ["1536x1024", "3:2", "1k"],
      ["1024x1536", "2:3", "1k"],
      ["1360x1024", "4:3", "1k"],
      ["1024x1360", "3:4", "1k"],
      ["1824x1024", "16:9", "1k"],
      ["1024x1824", "9:16", "1k"],
      ["2048x2048", "1:1", "2k"],
      ["2048x1152", "16:9", "2k"],
      ["1152x2048", "9:16", "2k"],
      ["3840x2160", "16:9", "2k"],
      ["2160x3840", "9:16", "2k"],
    ];

    for (const [size, aspect_ratio, resolution] of cases) {
      assert.deepEqual(mapSizeToGrokImageParams(size), { aspect_ratio, resolution });
    }
  });

  it("maps auto to xAI auto aspect without forcing resolution", () => {
    assert.deepEqual(mapSizeToGrokImageParams("auto"), { aspect_ratio: "auto" });
  });

  it("maps custom dimensions to the closest supported xAI aspect", () => {
    assert.deepEqual(mapSizeToGrokImageParams("2400x1024"), { aspect_ratio: "21:9", resolution: "2k" });
    assert.deepEqual(mapSizeToGrokImageParams("2560x1024"), { aspect_ratio: "5:2", resolution: "2k" });
    assert.deepEqual(mapSizeToGrokImageParams("900x1800"), { aspect_ratio: "1:2", resolution: "1k" });
    assert.deepEqual(mapSizeToGrokImageParams("1950x900"), { aspect_ratio: "19.5:9", resolution: "1k" });
  });

  it("passes through every valid xAI aspect in the picker's native format", () => {
    assert.deepEqual(mapSizeToGrokImageParams("grok:21:9:2k"), { aspect_ratio: "21:9", resolution: "2k" });
    assert.deepEqual(mapSizeToGrokImageParams("grok:5:2:1k"), { aspect_ratio: "5:2", resolution: "1k" });
  });
});
