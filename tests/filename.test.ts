import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  slugifyPrompt,
  sanitizeComponent,
  deriveAspect,
  buildFilename,
  writeFileUnique,
} from "../lib/filename.ts";

describe("slugifyPrompt", () => {
  it("returns the prompt trimmed and slugified", () => {
    assert.equal(slugifyPrompt("sunset over the mountains"), "sunset-over-the-moun");
  });

  it("truncates to 20 characters", () => {
    assert.equal(slugifyPrompt("a cute cat sitting on a windowsill"), "a-cute-cat-sitting-o");
  });

  it("preserves CJK characters as-is", () => {
    assert.equal(slugifyPrompt("美丽的日落景色"), "美丽的日落景色");
  });

  it("returns 'untitled' for empty string", () => {
    assert.equal(slugifyPrompt(""), "untitled");
  });

  it("returns 'untitled' for whitespace-only string", () => {
    assert.equal(slugifyPrompt("   "), "untitled");
  });

  it("returns 'untitled' for control-chars-only string", () => {
    assert.equal(slugifyPrompt("\t\n\r"), "untitled");
  });

  it("returns 'untitled' for NUL-only input", () => {
    assert.equal(slugifyPrompt("\u0000\u0001"), "untitled");
  });

  it("strips embedded NUL and control chars", () => {
    assert.equal(slugifyPrompt("he\u0000llo\u0002world"), "helloworld");
  });

  it("strips filesystem-unsafe chars", () => {
    assert.equal(slugifyPrompt("hello/world:test?world"), "helloworldtestworld");
  });

  it("collapses consecutive hyphens", () => {
    assert.equal(slugifyPrompt("hello   world"), "hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    assert.equal(slugifyPrompt("  hello  "), "hello");
  });

  it("handles CJK mixed with ASCII", () => {
    assert.equal(slugifyPrompt("美丽的 sunset"), "美丽的-sunset");
  });

  it("truncates CJK at 20 chars", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十";
    assert.ok(slugifyPrompt(long).length <= 20);
  });
});

describe("sanitizeComponent", () => {
  it("dashes slash-bearing catalog model names", () => {
    assert.equal(
      sanitizeComponent("openai/gpt-image-2/text-to-image"),
      "openai-gpt-image-2-text-to-image",
    );
  });

  it("removes control characters", () => {
    assert.equal(sanitizeComponent("mod\u0000el"), "model");
  });

  it("collapses repeats and trims edge hyphens", () => {
    assert.equal(sanitizeComponent("/a//b/"), "a-b");
  });

  it("returns fallback for empty result", () => {
    assert.equal(sanitizeComponent("///"), "unknown");
    assert.equal(sanitizeComponent("", "fallback"), "fallback");
  });
});

describe("deriveAspect", () => {
  it("reduces 2368x1728 to 37x27 (GCD=64)", () => {
    assert.equal(deriveAspect("2368x1728"), "37x27");
  });

  it("reduces 1024x1024 to 1x1", () => {
    assert.equal(deriveAspect("1024x1024"), "1x1");
  });

  it("reduces 1920x1080 to 16x9", () => {
    assert.equal(deriveAspect("1920x1080"), "16x9");
  });

  it("reduces 1024x1024 with star separator to 1x1", () => {
    assert.equal(deriveAspect("1024*1024"), "1x1");
  });

  it("returns 1x1 for empty string", () => {
    assert.equal(deriveAspect(""), "1x1");
  });

  it("returns 1x1 for unparseable string", () => {
    assert.equal(deriveAspect("auto"), "1x1");
  });

  it("returns 667x375 for 1334x750 (GCD=2)", () => {
    assert.equal(deriveAspect("1334x750"), "667x375");
  });

  it("falls back to 1x1 for absurdly large dimensions", () => {
    assert.equal(deriveAspect(`${"9".repeat(400)}x1`), "1x1");
    assert.equal(deriveAspect("1000000000000000000000000x1"), "1x1");
    assert.equal(deriveAspect("1000001x1000"), "1x1");
  });

  it("falls back to 1x1 for zero dimensions", () => {
    assert.equal(deriveAspect("0x1024"), "1x1");
    assert.equal(deriveAspect("1024x0"), "1x1");
  });
});

describe("buildFilename", () => {
  const base = {
    model: "wanx2.1-t2i-turbo",
    size: "1024x1024",
    createdAt: Date.UTC(2026, 6, 24, 12, 0, 0),
    prompt: "a cute cat sitting on a windowsill",
    ext: "png",
  };

  it("builds the full structured pattern with index", () => {
    assert.equal(
      buildFilename({ ...base, index: 0 }),
      "wanx2.1-t2i-turbo_1x1_20260724_a-cute-cat-sitting-o_0.png",
    );
  });

  it("omits the index suffix when undefined", () => {
    assert.equal(
      buildFilename(base),
      "wanx2.1-t2i-turbo_1x1_20260724_a-cute-cat-sitting-o.png",
    );
  });

  it("uses the UTC date from createdAt", () => {
    assert.match(buildFilename(base), /_20260724_/);
  });

  it("sanitizes slash-bearing model names", () => {
    assert.equal(
      buildFilename({ ...base, model: "openai/gpt-image-2/text-to-image" }),
      "openai-gpt-image-2-text-to-image_1x1_20260724_a-cute-cat-sitting-o.png",
    );
  });

  it("byte-caps absurdly long model names with a stable hash", () => {
    const name = buildFilename({ ...base, model: `openai/${"m".repeat(300)}` });
    assert.ok(Buffer.byteLength(name, "utf8") < 255, `length ${Buffer.byteLength(name, "utf8")}`);
    assert.match(name, /^openai-m+-[0-9a-f]{6}_1x1_20260724_a-cute-cat-sitting-o\.png$/);
    // deterministic: same input, same hash
    assert.equal(name, buildFilename({ ...base, model: `openai/${"m".repeat(300)}` }));
  });

  it("falls back to 'unknown' for empty model", () => {
    assert.ok(buildFilename({ ...base, model: "" }).startsWith("unknown_"));
  });

  it("never splits a surrogate pair at the slug boundary", () => {
    const slug = slugifyPrompt("abcdefghijklmnopqrst😀");
    for (let i = 0; i < slug.length; i += 1) {
      const code = slug.charCodeAt(i);
      assert.ok(code < 0xd800 || code > 0xdfff, `lone surrogate at ${i} in ${JSON.stringify(slug)}`);
    }
    // 20 ASCII letters + emoji = 21 code points; truncation drops the emoji whole.
    assert.equal(slug, "abcdefghijklmnopqrst");
  });
});

describe("writeFileUnique", () => {
  async function withTmpDir(fn: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "ima2-filename-"));
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  it("writes the base name when free", async () => {
    await withTmpDir(async (dir) => {
      const name = await writeFileUnique(dir, "a_b_20260725_slug.png", Buffer.from("x"));
      assert.equal(name, "a_b_20260725_slug.png");
      assert.equal((await readFile(join(dir, name))).toString(), "x");
    });
  });

  it("appends _2 when the base exists, _3 when _2 exists", async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, "m_1x1_20260725_s.png"), "0");
      const second = await writeFileUnique(dir, "m_1x1_20260725_s.png", Buffer.from("2"));
      assert.equal(second, "m_1x1_20260725_s_2.png");
      const third = await writeFileUnique(dir, "m_1x1_20260725_s.png", Buffer.from("3"));
      assert.equal(third, "m_1x1_20260725_s_3.png");
      assert.equal((await readFile(join(dir, second))).toString(), "2");
      assert.equal((await readFile(join(dir, third))).toString(), "3");
    });
  });

  it("resolves distinct names under concurrent identical writes", async () => {
    await withTmpDir(async (dir) => {
      const [a, b] = await Promise.all([
        writeFileUnique(dir, "m_1x1_20260725_s.png", Buffer.from("a")),
        writeFileUnique(dir, "m_1x1_20260725_s.png", Buffer.from("b")),
      ]);
      assert.notEqual(a, b);
      const names = (await readdir(dir)).sort();
      assert.deepEqual(names, [a, b].sort());
      const bytes = await Promise.all([readFile(join(dir, a)), readFile(join(dir, b))]);
      assert.deepEqual(bytes.map((buf) => buf.toString()).sort(), ["a", "b"]);
    });
  });

  it("propagates non-EEXIST errors", async () => {
    const missing = join(tmpdir(), "ima2-filename-no-such-dir");
    await assert.rejects(
      writeFileUnique(missing, "m_1x1_20260725_s.png", Buffer.from("x")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  });

  it("falls back to a high-entropy suffix when the sequential space is exhausted", async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, "m_1x1_20260725_s.png"), "0");
      for (let n = 2; n <= 100; n += 1) {
        await writeFile(join(dir, `m_1x1_20260725_s_${n}.png`), String(n));
      }
      const name = await writeFileUnique(dir, "m_1x1_20260725_s.png", Buffer.from("x"));
      assert.match(name, /^m_1x1_20260725_s_[0-9a-f]{6}\.png$/);
    });
  });

  it("round-trips an emoji slug: returned name equals the on-disk name", async () => {
    await withTmpDir(async (dir) => {
      const base = buildFilename({
        model: "m",
        size: "1024x1024",
        createdAt: Date.UTC(2026, 6, 25),
        prompt: "banner 😀 time",
        ext: "png",
      });
      const name = await writeFileUnique(dir, base, Buffer.from("x"));
      assert.equal(name, base);
      const onDisk = await readdir(dir);
      assert.deepEqual(onDisk, [name]);
    });
  });
});
