import { expect, test, type Page, type Request } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const file = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });
const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
const unique = (label: string) => label + " " + Date.now().toString(36);
const card = (page: Page, name: string) => page.getByRole("region", { name: "Elements", exact: true }).getByRole("article", { name });
const inputs = (body: Record<string, unknown>) => body.inputs as { role: string; filename?: string; ref?: string }[];

async function addElement(page: Page, name: string, kind: string) {
  await page.goto("/#/assets/elements");
  const form = page.getByRole("form", { name: "New element" });
  await form.getByLabel("Image", { exact: true }).setInputFiles(file("ref.png"));
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: kind, exact: true }).click();
  await form.getByRole("button", { name: "Save element" }).click();
  await expect(card(page, name)).toBeVisible();
}

test("elements: add one from an image, filter by kind, rename and re-kind it, and delete it after confirming", async ({ page }) => {
  const mug = unique("Red mug"), pier = unique("Pier");
  await page.goto("/#/assets/elements");
  await expect(page.getByRole("link", { name: "Elements" })).toHaveAttribute("aria-current", "page");
  const form = page.getByRole("form", { name: "New element" });
  await expect(form.getByRole("button", { name: "Save element" })).toBeDisabled();
  await form.getByLabel("Image", { exact: true }).setInputFiles(file("mug.png"));
  await expect(form.getByText("Give it a name.")).toBeVisible();
  await addElement(page, mug, "Product");
  await addElement(page, pier, "Scene");
  await expect(card(page, mug)).toContainText("Product");
  // The image is the server's saved copy, and it loads.
  const src = await card(page, mug).locator("img").getAttribute("src");
  expect(src).toMatch(/^\/generated\/elements\//);
  expect((await page.request.get(src!)).status()).toBe(200);

  const kinds = page.getByRole("group", { name: "Element kinds" });
  await kinds.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(card(page, pier)).toBeVisible();
  await expect(card(page, mug)).toHaveCount(0);
  await kinds.getByRole("button", { name: "All", exact: true }).click();

  await card(page, mug).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit " + mug });
  await edit.getByLabel("Name").fill(mug + " v2");
  await edit.getByRole("button", { name: "Style", exact: true }).click();
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card(page, mug + " v2")).toContainText("Style");

  await card(page, pier).getByRole("button", { name: "Delete", exact: true }).click();
  await card(page, pier).getByRole("button", { name: "Keep it" }).click();
  await expect(card(page, pier)).toBeVisible();
  await card(page, pier).getByRole("button", { name: "Delete", exact: true }).click();
  await card(page, pier).getByRole("button", { name: "Delete it" }).click();
  await expect(card(page, pier)).toHaveCount(0);
  await page.reload();
  await expect(card(page, mug + " v2")).toBeVisible();
  await expect(card(page, pier)).toHaveCount(0);
});

test("elements: a saved element goes into an image edit and a video as references, sent by its saved path", async ({ page }) => {
  const name = unique("Hero");
  await addElement(page, name, "Character");
  await page.goto("/#/image?mode=edit");
  const images = page.getByRole("group", { name: "Images", exact: true });
  await images.getByRole("button", { name: "From elements" }).click();
  const picker = page.getByRole("dialog", { name: "Choose an element" });
  await picker.getByRole("button", { name: "Use " + name }).click();
  await expect(picker).toBeHidden();
  await expect(images.getByRole("img", { name })).toBeVisible();
  await page.getByLabel("Prompt").fill("in a rain coat");
  let request = submitted(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  let body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.task).toBe("image-to-image");
  expect(inputs(body)).toHaveLength(1);
  expect(inputs(body)[0]!.role).toBe("source-image");
  expect(inputs(body)[0]!.filename).toMatch(/^elements\//);
  expect(inputs(body)[0]).not.toHaveProperty("ref");

  await page.goto("/#/video?model=bytedance%2Fseedance-2.5");
  await page.getByRole("button", { name: "References", exact: true }).click();
  await page.getByRole("button", { name: "From elements" }).click();
  await page.getByRole("dialog", { name: "Choose an element" }).getByRole("button", { name: "Use " + name }).click();
  await expect(page.getByRole("button", { name: /^Remove Reference 1/ })).toBeVisible();
  // The video form says the images become references; choosing the same element again adds nothing and says why.
  await page.getByRole("button", { name: "From elements" }).click();
  await expect(page.getByRole("dialog", { name: "Choose an element" }).getByText("Its images are added as references.")).toBeVisible();
  await page.getByRole("dialog", { name: "Choose an element" }).getByRole("button", { name: "Use " + name }).click();
  await expect(page.getByRole("status").filter({ hasText: "This element's images are already here." })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove Reference 2/ })).toHaveCount(0);
  await page.getByLabel("Prompt").fill("she walks along the pier");
  request = submitted(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.task).toBe("reference-to-video");
  expect(inputs(body).map((input) => [input.role, /^elements\//.test(input.filename ?? "")])).toEqual([["reference-image", true]]);
});

test("elements: when an element has more images than the form has room for, the form says how many went in", async ({ page }) => {
  const refs: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const upload = (await (await page.request.post("/api/media/inputs", { data: PNG, headers: { "content-type": "image/png" } })).json()) as { ref: string };
    const made = (await (await page.request.post("/api/assets/promote-element", { data: { inputRef: upload.ref, name: "part " + i } })).json()) as { asset: { id: string; metadata: { refs: string[] } } };
    refs.push(made.asset.metadata.refs[0]!);
  }
  const name = unique("Trio");
  expect((await page.request.post("/api/assets", { data: { kind: "element", name, metadata: { elementKind: "product", name, refs } } })).status()).toBe(201);

  await page.goto("/#/image?mode=edit");
  const images = page.getByRole("group", { name: "Images", exact: true });
  await images.getByLabel("Image file").setInputFiles([file("one.png"), file("two.png")]);
  await expect(images.getByText("2 of 4")).toBeVisible();
  await images.getByRole("button", { name: "From elements" }).click();
  const picker = page.getByRole("dialog", { name: "Choose an element" });
  await expect(picker.getByText("Its images go into this form's image list.")).toBeVisible();
  await picker.getByRole("button", { name: "Use " + name }).click();
  await expect(images.getByText("4 of 4")).toBeVisible();
  await expect(images.getByRole("status").filter({ hasText: "Added 2 of the element's 3 images; there was room for 2." })).toBeVisible();
  await expect(images.getByRole("button", { name: "From elements" })).toBeDisabled();
});

test("elements: an image result is saved as an element from its lightbox; with none saved the picker says where to make one; Korean names the tab", async ({ page }) => {
  await page.goto("/#/image?mode=edit");
  await page.route("**/api/assets?*", async (route) => { await route.fulfill({ json: { assets: [], nextCursor: null } }); });
  await page.getByRole("group", { name: "Images", exact: true }).getByRole("button", { name: "From elements" }).click();
  const picker = page.getByRole("dialog", { name: "Choose an element" });
  await expect(picker.getByText("No elements yet.")).toBeVisible();
  // Making one opens in a new tab, so the form keeps what is in it.
  const make = picker.getByRole("link", { name: "Make an element in Assets" });
  await expect(make).toHaveAttribute("href", "#/assets/elements");
  await expect(make).toHaveAttribute("target", "_blank");
  await picker.getByRole("button", { name: "Close" }).click();
  await page.unroute("**/api/assets?*");

  const prompt = unique("A lighthouse keeper");
  await page.goto("/#/image");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("article", { name: new RegExp(prompt) }).getByRole("img", { name: prompt })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole("button", { name: "Open " + prompt }).click();
  const dialog = page.getByRole("dialog", { name: "Result" });
  await dialog.getByRole("button", { name: "Save as element" }).click();
  const save = dialog.getByRole("form", { name: "Save as element" });
  const name = unique("Keeper");
  await save.getByLabel("Name").fill(name);
  // No kind is chosen for the person.
  await expect(save.getByRole("button", { name: "Save element" })).toBeDisabled();
  await expect(save.getByText("Choose a kind.")).toBeVisible();
  await save.getByRole("button", { name: "Scene", exact: true }).click();
  await save.getByRole("button", { name: "Save element" }).click();
  await expect(dialog.getByText("Saved to elements.")).toBeVisible();
  await dialog.getByRole("link", { name: "See elements" }).click();
  await expect(card(page, name)).toContainText("Scene");
  // This element points at the result itself, not at a copy.
  expect(await card(page, name).locator("img").getAttribute("src")).not.toMatch(/\/elements\//);

  await page.getByRole("button", { name: /Language/ }).click();
  await expect(page.getByRole("link", { name: "요소" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("form", { name: "새 요소" })).toBeVisible();
  await expect(page.getByRole("group", { name: "요소 종류" }).getByRole("button", { name: "인물", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});
