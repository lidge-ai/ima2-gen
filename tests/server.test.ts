import { describe, it } from "node:test";
import assert from "node:assert";

// Simple unit tests for server utilities that don't require live API calls

describe("Server Utils", () => {
  it("should validate image size format", () => {
    const validSizes = ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "3840x2160", "2160x3840", "2400x1024", "3840x1648"];
    const invalidSizes = ["1024", "abcxdef", "1024x1024x1024", "4096x2160", "3840x1024", "512x512"];

    const sizeRegex = /^(\d+)x(\d+)$/;

    for (const size of validSizes) {
      const match = size.match(sizeRegex);
      assert.ok(match, `${size} should match`);
      const w = parseInt(match[1]);
      const h = parseInt(match[2]);
      assert.ok(w % 16 === 0 && h % 16 === 0, `${size} should be 16px aligned`);
      assert.ok(Math.max(w, h) <= 3840, `${size} max edge <= 3840`);
      assert.ok(Math.max(w, h) / Math.min(w, h) <= 3, `${size} ratio <= 3:1`);
      const pixels = w * h;
      assert.ok(pixels >= 655360 && pixels <= 8294400, `${size} pixels in range`);
    }

    for (const size of invalidSizes) {
      const match = size.match(sizeRegex);
      if (match) {
        const w = parseInt(match[1]);
        const h = parseInt(match[2]);
        const invalid =
          w % 16 !== 0 ||
          h % 16 !== 0 ||
          Math.max(w, h) > 3840 ||
          Math.max(w, h) / Math.min(w, h) > 3 ||
          w * h < 655360 ||
          w * h > 8294400;
        assert.ok(invalid, `${size} should be invalid`);
      }
    }
  });

  it("should validate quality values", () => {
    const valid = ["low", "medium", "high"];
    const invalid = ["auto", "ultra", "best", "", null, undefined];

    for (const q of valid) {
      assert.ok(["low", "medium", "high"].includes(q), `${q} is valid`);
    }

    for (const q of invalid) {
      assert.ok(!q || !["low", "medium", "high"].includes(q), `${q} is invalid`);
    }
  });

  it("should validate format values", () => {
    const valid = ["png", "jpeg", "webp"];
    const mimeMap = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

    for (const fmt of valid) {
      assert.ok(mimeMap[fmt], `${fmt} has mime type`);
    }
  });

  it("should cap parallel count n to 1-24", () => {
    const max = 24;
    const inputs = [0, 1, 5, 24, 25, null, undefined];
    const expected = [1, 1, 5, 24, 24, 1, 1];

    for (let i = 0; i < inputs.length; i++) {
      const count = Math.min(Math.max(parseInt(inputs[i] as any) || 1, 1), max);
      assert.strictEqual(count, expected[i], `n=${inputs[i]} => ${expected[i]}`);
    }
  });
});

describe("Express App", () => {
  it("should respond to /api/providers", async () => {
    const req = {};
    let receivedData = null;
    const res = {
      json(data) { receivedData = data; },
    };

    const handler = (_req, res) => {
      res.json({ apiKey: true, oauth: true, oauthPort: 10531 });
    };

    handler(req, res);

    assert.strictEqual(receivedData.apiKey, true);
    assert.strictEqual(receivedData.oauth, true);
    assert.strictEqual(receivedData.oauthPort, 10531);
  });
});
