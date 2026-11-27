// A mask can mean opposite things to two providers. A request may say "repaint-white" (a PNG the size of
// the source, white = repaint, black = keep) and the adapter converts it to the provider's own rule; the
// default "vendor" passes the bytes through untouched. These tests read the pixels that leave.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { MediaAdapterContext, MediaModelSpec, MediaProviderAdapter, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
import { BUILTIN_MEDIA_ADAPTERS } from "../lib/providers/media/adapters.ts";
import { REPAINT_THRESHOLD, assertMaskConvention, vendorMask } from "../lib/providers/media/maskConvention.ts";
import { parseMediaJobBody, validateAgainstSpec } from "../lib/providers/media/validate.ts";

const W = 8, H = 4;
/** Left half white (repaint), right half black (keep), with one soft column on each side of the edge. */
const LUMA = (x: number) => (x < 3 ? 255 : x === 3 ? REPAINT_THRESHOLD : x === 4 ? REPAINT_THRESHOLD - 1 : 0);
async function brushMask(width = W, height = H): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) raw.fill(LUMA(x), (y * width + x) * 3, (y * width + x) * 3 + 3);
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
}
const solid = async (width: number, height: number) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#336699" } }).png().toBuffer());
const pixels = async (bytes: Uint8Array) => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

async function editRequest(model: string, convention?: "vendor" | "repaint-white", mask?: Uint8Array): Promise<MediaSubmitRequest> {
  return {
    model, task: "image-to-image", prompt: "a red door",
    inputs: [
      { role: "source-image", bytes: await solid(W, H), mimeType: "image/png" },
      { role: "mask", bytes: mask ?? (await brushMask()), mimeType: "image/png" },
    ],
    ...(convention ? { maskConvention: convention } : {}),
  };
}

test("repaint-white becomes OpenAI's rule: transparent where the brush is at least half white, opaque elsewhere", async () => {
  const out = await vendorMask(await editRequest("openai/gpt-image-2.6", "repaint-white"), "transparent-repaints");
  const mask = out.inputs.find((input) => input.role === "mask")!;
  assert.equal(mask.mimeType, "image/png");
  const { data, info } = await pixels(mask.bytes!);
  assert.deepEqual([info.width, info.height, info.channels], [W, H, 4]);
  for (let x = 0; x < W; x += 1) assert.equal(data[x * 4 + 3], LUMA(x) >= REPAINT_THRESHOLD ? 0 : 255, "alpha at column " + x);
  // The source image is not touched.
  assert.deepEqual(out.inputs[0], (await editRequest("openai/gpt-image-2.6")).inputs[0]);
});

test("repaint-white becomes Ideogram's rule: black where the brush is at least half white, white elsewhere", async () => {
  const out = await vendorMask(await editRequest("ideogram/ideogram-v3", "repaint-white"), "black-repaints");
  const { data, info } = await pixels(out.inputs.find((input) => input.role === "mask")!.bytes!);
  assert.deepEqual([info.width, info.height], [W, H]);
  for (let x = 0; x < W; x += 1) {
    const want = LUMA(x) >= REPAINT_THRESHOLD ? 0 : 255;
    assert.deepEqual([data[x * 4], data[x * 4 + 1], data[x * 4 + 2], data[x * 4 + 3]], [want, want, want, 255], "column " + x);
  }
});

test("a transparent pixel in a repaint-white mask is kept, not repainted", async () => {
  const raw = Buffer.alloc(W * H * 4, 255);
  for (let i = 0; i < W * H; i += 1) raw[i * 4 + 3] = i % W < 2 ? 0 : 255; // white everywhere, first two columns transparent
  const mask = new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
  const out = await vendorMask(await editRequest("openai/gpt-image-2.6", "repaint-white", mask), "transparent-repaints");
  const { data } = await pixels(out.inputs[1]!.bytes!);
  assert.deepEqual([data[3], data[7], data[11]], [255, 255, 0]);
});

test("the default and an explicit vendor convention pass the mask bytes through untouched", async () => {
  const mask = await brushMask();
  for (const convention of [undefined, "vendor"] as const) {
    const out = await vendorMask(await editRequest("openai/gpt-image-2.6", convention, mask), "transparent-repaints");
    assert.deepEqual(out.inputs[1]!.bytes, mask);
  }
});

test("a repaint-white mask that is not a PNG, or not the size of the image, is refused in a plain sentence", async () => {
  const jpeg = new Uint8Array(await sharp({ create: { width: W, height: H, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  await assert.rejects(vendorMask(await editRequest("openai/gpt-image-2.6", "repaint-white", jpeg), "transparent-repaints"), /The mask must be a PNG file\./);
  await assert.rejects(
    vendorMask(await editRequest("openai/gpt-image-2.6", "repaint-white", await brushMask(16, 4)), "transparent-repaints"),
    /The mask is 16x4 but the image is 8x4\. They must be the same size\./,
  );
  const noSource = { ...(await editRequest("openai/gpt-image-2.6", "repaint-white")), inputs: [{ role: "mask" as const, bytes: await brushMask(), mimeType: "image/png" }] };
  await assert.rejects(vendorMask(noSource, "transparent-repaints"), /needs the image it belongs to/);
});

const find = (adapterId: string, modelId: string): { adapter: MediaProviderAdapter; spec: MediaModelSpec } => {
  const adapter = BUILTIN_MEDIA_ADAPTERS.find((a) => a.id === adapterId)!;
  return { adapter, spec: adapter.listModels().find((m) => m.id === modelId)! };
};

test("only routes that say so take repaint-white; any other route refuses it before a provider call", async () => {
  const conventions = (adapterId: string, modelId: string) =>
    find(adapterId, modelId).spec.params.inputs?.find((need) => need.role === "mask")?.conventions;
  assert.deepEqual(conventions("openai", "openai/gpt-image-2.6"), ["vendor", "repaint-white"]);
  assert.deepEqual(conventions("ideogram", "ideogram/ideogram-v3"), ["vendor", "repaint-white"]);
  // Declared without a convention list: the provider's own rule only (its page for this endpoint was not found).
  assert.equal(conventions("ideogram", "ideogram/ideogram-v4.5"), undefined);
  assert.throws(() => assertMaskConvention(find("ideogram", "ideogram/ideogram-v4.5").spec, { task: "image-to-image", maskConvention: "repaint-white" }), /does not take a repaint-white mask/);
  // Every other route that declares a mask at all declares the provider's own rule only.
  for (const adapter of BUILTIN_MEDIA_ADAPTERS) for (const spec of adapter.listModels()) {
    const mask = spec.params.inputs?.find((need) => need.role === "mask");
    if (!mask || adapter.id === "openai" || spec.id === "ideogram/ideogram-v3") continue;
    assert.deepEqual(mask.conventions ?? ["vendor"], ["vendor"], adapter.id + " " + spec.id);
  }
  const bfl = find("bfl", "black-forest-labs/flux-kontext-pro");
  const request = { ...(await editRequest(bfl.spec.id, "repaint-white")) };
  assert.throws(() => assertMaskConvention(bfl.spec, request), /does not take a repaint-white mask/);
  assert.doesNotThrow(() => assertMaskConvention(bfl.spec, { ...request, maskConvention: "vendor" }));
  const openaiRequest = await editRequest("openai/gpt-image-2.6", "repaint-white");
  assert.doesNotThrow(() => assertMaskConvention(find("openai", "openai/gpt-image-2.6").spec, openaiRequest));
  // The same refusal on the request path every client goes through.
  const body = parseMediaJobBody({ model: bfl.spec.id, task: "image-to-image", prompt: "x", maskConvention: "repaint-white", inputs: [{ role: "source-image", ref: "a" }, { role: "mask", ref: "b" }] });
  assert.equal(body.maskConvention, "repaint-white");
  assert.throws(() => validateAgainstSpec(bfl.spec, body), /does not take a repaint-white mask/);
  assert.throws(() => parseMediaJobBody({ model: "x", task: "image-to-image", maskConvention: "white" }), /maskConvention must be "vendor" or "repaint-white"/);
});

/** Runs the adapter against a transport that records the multipart form it sends. */
async function sentMask(adapterId: string, request: MediaSubmitRequest): Promise<{ bytes: Uint8Array; path: string }> {
  const { adapter } = find(adapterId, request.model);
  let form: FormData | undefined, path = "";
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body instanceof FormData) { form = init.body; path = new URL(String(input)).pathname; }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const ctx: MediaAdapterContext = { apiKey: "test-key-0123456789", extra: {}, fetch: fetchImpl };
  await adapter.submit(ctx, request).catch(() => undefined);
  assert.ok(form, adapterId + " sent no form");
  const mask = form.get("mask");
  assert.ok(mask instanceof Blob, adapterId + " sent no mask");
  return { bytes: new Uint8Array(await mask.arrayBuffer()), path };
}

test("OpenAI receives an alpha mask for repaint-white, and the caller's own bytes for vendor", async () => {
  const sent = await sentMask("openai", await editRequest("openai/gpt-image-2.6", "repaint-white"));
  assert.equal(sent.path, "/v1/images/edits");
  const { data, info } = await pixels(sent.bytes);
  assert.equal(info.channels, 4);
  assert.deepEqual([data[3], data[W * 4 - 1]], [0, 255], "left is repainted (transparent), right is kept (opaque)");
  const own = await brushMask();
  assert.deepEqual((await sentMask("openai", await editRequest("openai/gpt-image-2.6", "vendor", own))).bytes, own);
  assert.deepEqual((await sentMask("openai", await editRequest("openai/gpt-image-2.6", undefined, own))).bytes, own);
});

test("Ideogram receives a black-repaints mask for repaint-white, and the caller's own bytes for vendor", async () => {
  const sent = await sentMask("ideogram", await editRequest("ideogram/ideogram-v3", "repaint-white"));
  assert.match(sent.path, /inpaint/);
  const { data } = await pixels(sent.bytes);
  assert.deepEqual([data[0], data[(W - 1) * 4]], [0, 255], "left is repainted (black), right is kept (white)");
  const own = await brushMask();
  assert.deepEqual((await sentMask("ideogram", await editRequest("ideogram/ideogram-v3", undefined, own))).bytes, own);
});
