import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("video frame accepts a local file (#171)", () => {
  it("uploads bytes when the argument is a real file on disk", () => {
    const src = read("bin/commands/video.ts");
    // The server confines the GET form to its generated directory, so a clip
    // saved elsewhere with -o can only be reached by sending the bytes.
    assert.match(src, /const info = await stat\(file\);/);
    assert.match(src, /if \(info\.isFile\(\)\) localBytes = await readFile\(file\);/);
    assert.match(src, /video: localBytes\.toString\("base64"\)/);
  });

  it("still resolves a generated filename through the query form", () => {
    const src = read("bin/commands/video.ts");
    assert.match(src, /api\/video\/frame\?file=\$\{encodeURIComponent\(file\)\}/);
  });

  it("names both accepted forms when neither matches", () => {
    const src = read("bin/commands/video.ts");
    assert.match(src, /neither a file on disk nor a generated filename/);
    assert.match(src, /ima2 ls --json/);
  });

  it("validates the uploaded container from its header, not its name", () => {
    const route = read("routes/videoExtended.ts");
    assert.match(route, /app\.post\("\/api\/video\/frame"/);
    assert.match(route, /await assertLocalMp4\(tmpIn\);/);
    // Temp input and output are both removed even when ffmpeg throws.
    assert.match(route, /await unlink\(tmpIn\)\.catch/);
  });

  it("documents that a local path is accepted", () => {
    const src = read("bin/commands/video.ts");
    assert.match(src, /ima2 video frame <local-file\|generated-file>/);
  });
});
