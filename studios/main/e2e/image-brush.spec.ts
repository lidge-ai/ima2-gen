import { expect, test, type Page, type Request } from "@playwright/test";
import { deflateSync } from "node:zlib";

const W = 96, H = 64;

/** A plain W x H PNG, so the mask's size can be checked against a known image size. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (data: Buffer) => { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x66)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
const photo = { name: "door.png", mimeType: "image/png", buffer: png(W, H) };
const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
/** Keeps the bytes of every PNG the page uploads, since a request's binary body cannot be read back from outside the page. */
async function keepUploads(page: Page) {
  await page.addInitScript(() => {
    const kept: string[] = [];
    (window as unknown as { uploads: string[] }).uploads = kept;
    const send = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const body = init?.body;
      if (String(input instanceof Request ? input.url : input).includes("/api/media/inputs") && (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
        const bytes = new Uint8Array(body instanceof Blob ? await body.arrayBuffer() : body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
        kept.push(btoa(String.fromCharCode(...bytes)));
      }
      return send(input, init);
    };
  });
}
const generate = (page: Page) => page.getByRole("button", { name: /Generate/ });
const images = (page: Page) => page.getByRole("group", { name: "Images", exact: true });
const roles = (body: Record<string, unknown>) => (body.inputs as { role: string }[]).map((input) => input.role);

/** Paints a stroke across the left half of the image in the brush dialog. */
async function paintLeft(page: Page) {
  const canvas = page.getByRole("dialog", { name: "Paint the area to change" }).locator("canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
}

test("image brush: the painted area is sent as a mask the size of the image, white where painted, with the repaint-white convention", async ({ page }) => {
  await keepUploads(page);
  await page.goto("/#/image?mode=edit");
  await expect(page.getByRole("button", { name: "Paint the area to change" })).toHaveCount(0);
  await page.getByLabel("Image file").setInputFiles(photo);
  await page.getByLabel("Prompt").fill("a red door");
  await images(page).getByRole("button", { name: "Paint the area to change" }).click();
  const dialog = page.getByRole("dialog", { name: "Paint the area to change" });
  await expect(dialog.getByRole("button", { name: "Use this area" })).toBeDisabled();
  await paintLeft(page);
  await dialog.getByRole("button", { name: "Use this area" }).click();
  await expect(dialog).toBeHidden();
  // The second upload is the mask: same pixel size as the image, white on the stroke, black away from it.
  const sent = await page.evaluate(() => (window as unknown as { uploads: string[] }).uploads);
  expect(sent).toHaveLength(2);
  const bytes = Buffer.from(sent[1]!, "base64");
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([W, H]);
  const pixels = await page.evaluate(async (base64) => {
    const blob = await (await fetch("data:image/png;base64," + base64)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    return { stroke: at(Math.round(bitmap.width * 0.25), Math.round(bitmap.height * 0.5)), corner: at(bitmap.width - 2, 1) };
  }, sent[1]!);
  expect(pixels.stroke).toEqual([255, 255, 255, 255]);
  expect(pixels.corner).toEqual([0, 0, 0, 255]);

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Only the painted area of the first image changes.")).toBeVisible();
  await expect(images(page).getByRole("button", { name: "Paint the area again" })).toHaveAttribute("aria-pressed", "true");
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "image-to-image", adapter: "openai", prompt: "a red door", maskConvention: "repaint-white" });
  expect(roles(body)).toEqual(["source-image", "mask"]);
  await expect(page.getByRole("article").filter({ hasText: "GPT Image 2.6" }).first().getByText("Done")).toBeVisible({ timeout: 15_000 });
});

test("image brush: a route without a brush sends no mask and says the whole image is edited; removing the area or its image drops it", async ({ page }) => {
  await page.goto("/#/image?mode=edit");
  await page.getByLabel("Image file").setInputFiles(photo);
  await page.getByLabel("Prompt").fill("a red door");
  await images(page).getByRole("button", { name: "Paint the area to change" }).click();
  await paintLeft(page);
  await page.getByRole("dialog", { name: "Paint the area to change" }).getByRole("button", { name: "Use this area" }).click();
  await expect(page.getByText("Only the painted area of the first image changes.")).toBeVisible();

  // fal's route for the same model takes no mask.
  await page.getByRole("button", { name: /^Run through/ }).click();
  await page.getByRole("group", { name: "Run through" }).getByRole("button", { name: /^fal/ }).click();
  await expect(page.getByText("This route has no brush, so the whole image is edited.")).toBeVisible();
  await expect(images(page).getByRole("button", { name: /^Paint the area/ })).toHaveCount(0);
  let request = submitted(page);
  await generate(page).click();
  let body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.adapter).toBe("fal");
  expect(roles(body)).toEqual(["source-image"]);
  expect(body).not.toHaveProperty("maskConvention");
  expect(body).toHaveProperty("aspectRatio");

  // Back on the direct route the area is still there; removing it sends a plain edit.
  await page.getByRole("button", { name: /^Run through/ }).click();
  await page.getByRole("group", { name: "Run through" }).getByRole("button", { name: /OpenAI API/ }).click();
  await expect(page.getByText("Only the painted area of the first image changes.")).toBeVisible();
  await images(page).getByRole("button", { name: "Remove the painted area" }).click();
  await expect(page.getByText("Only the painted area of the first image changes.")).toHaveCount(0);
  request = submitted(page);
  await generate(page).click();
  body = (await request).postDataJSON() as Record<string, unknown>;
  expect(roles(body)).toEqual(["source-image"]);
  expect(body).not.toHaveProperty("maskConvention");
});

test("image brush: cancel keeps nothing, Clear empties the canvas, and Korean names the dialog", async ({ page }) => {
  await page.goto("/#/image?mode=edit");
  await page.getByLabel("Image file").setInputFiles(photo);
  await images(page).getByRole("button", { name: "Paint the area to change" }).click();
  const dialog = page.getByRole("dialog", { name: "Paint the area to change" });
  await paintLeft(page);
  await expect(dialog.getByRole("button", { name: "Use this area" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Clear" }).click();
  await expect(dialog.getByRole("button", { name: "Use this area" })).toBeDisabled();
  await paintLeft(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(images(page).getByRole("button", { name: "Paint the area to change" })).toHaveAttribute("aria-pressed", "false");
  // The painted area belongs to its image: with the image gone there is nothing to paint.
  await images(page).getByRole("button", { name: "Remove door.png" }).click();
  await expect(images(page).getByRole("button", { name: /^Paint the area/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Language/ }).click();
  await page.getByLabel("이미지 파일").setInputFiles(photo);
  await page.getByRole("group", { name: "이미지", exact: true }).getByRole("button", { name: "바꿀 부분 칠하기" }).click();
  await expect(page.getByRole("dialog", { name: "바꿀 부분 칠하기" }).getByRole("button", { name: "이 부분 사용" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});
