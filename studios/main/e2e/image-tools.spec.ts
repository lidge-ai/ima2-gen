import { expect, test, type Page, type Request } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const file = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });
const submitted = (page: Page) => page.waitForRequest((r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/media");
const generate = (page: Page) => page.getByRole("button", { name: /Generate/ });
const tool = (page: Page, name: string) => page.getByRole("group", { name: "Tool" }).getByRole("button", { name, exact: true });
const images = (page: Page) => page.getByRole("group", { name: "Images", exact: true });
const roles = (body: Record<string, unknown>) => (body.inputs as { role: string }[]).map((input) => input.role);

test("image tools: Edit sends one image to edit and the rest as references on the direct route, with only its fields", async ({ page }) => {
  await page.goto("/#/image");
  for (const name of ["Create", "Edit", "Upscale", "Vectorize", "Separate"]) await expect(tool(page, name)).toBeVisible();
  await tool(page, "Edit").click();
  await expect(page).toHaveURL(/#\/image\?.*mode=edit/);
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("GPT Image 2.6");
  await expect(page.getByText("Add an image.")).toBeVisible();
  await expect(generate(page)).toBeDisabled();
  await page.getByLabel("Image file").setInputFiles([file("door.png"), file("paint.png"), file("frame.png")]);
  await expect(images(page).getByRole("img")).toHaveCount(3);
  await expect(images(page)).toContainText("3 of 4");
  await expect(page.getByText("Write what to do.")).toBeVisible();
  await page.getByLabel("Prompt").fill("paint the door red");
  // The keyed direct route: a size and a count, no ratio.
  await expect(page.getByRole("button", { name: /^Size: / })).toBeVisible();
  await expect(page.getByRole("group", { name: "Number of images" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Aspect ratio: / })).toHaveCount(0);
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "image-to-image", adapter: "openai", prompt: "paint the door red", count: 1 });
  expect(roles(body)).toEqual(["source-image", "reference-image", "reference-image"]);
  expect(body).toHaveProperty("resolution");
  for (const name of ["aspectRatio", "quality", "seed", "negativePrompt", "maskConvention"]) expect(body, name).not.toHaveProperty(name);
  await expect(page.getByRole("article").filter({ hasText: "GPT Image 2.6" }).first().getByText("Done")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Image file").setInputFiles([file("d.png")]);
  await expect(images(page)).toContainText("4 of 4");
  await expect(page.getByRole("button", { name: "Add an image", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove d.png" }).click();
  await expect(images(page)).toContainText("3 of 4");
});

test("image tools: another route for the same model takes the images as a list and has its own settings", async ({ page }) => {
  await page.goto("/#/image?mode=edit");
  await page.getByLabel("Image file").setInputFiles([file("a.png"), file("b.png")]);
  await page.getByLabel("Prompt").fill("combine them");
  await page.getByRole("button", { name: /^Route: / }).click();
  await page.getByRole("group", { name: "Route", exact: true }).getByRole("button", { name: /^fal/ }).click();
  await expect(page.getByRole("button", { name: /^Aspect ratio: / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Size: / })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Number of images" })).toHaveCount(0);
  await expect(images(page)).toContainText("2 of 4");
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "image-to-image", adapter: "fal" });
  expect(roles(body)).toEqual(["source-image", "source-image"]);
  expect(body).toHaveProperty("aspectRatio");
  for (const name of ["resolution", "count"]) expect(body, name).not.toHaveProperty(name);
});

test("image tools: upscale, vectorize and separate send the image alone, and the images follow from tool to tool", async ({ page }) => {
  await page.goto("/#/image?mode=upscale");
  await expect(tool(page, "Upscale")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Topaz Image Upscale");
  await expect(page.getByLabel("Prompt")).toHaveCount(0);
  for (const name of [/^Size: /, /^Aspect ratio: /]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  await page.getByLabel("Image file").setInputFiles(file("photo.png"));
  await expect(images(page)).toContainText("1 of 1");
  await expect(page.getByRole("button", { name: "Add an image", exact: true })).toBeDisabled();
  let request = submitted(page);
  await generate(page).click();
  let body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "image-upscale", adapter: "fal" });
  expect(roles(body)).toEqual(["source-image"]);
  for (const name of ["prompt", "aspectRatio", "resolution", "count", "seed"]) expect(body, name).not.toHaveProperty(name);

  // Separate takes an optional prompt; the image is still there.
  await tool(page, "Separate").click();
  await expect(images(page).getByRole("img", { name: "photo.png" })).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeVisible();
  request = submitted(page);
  await generate(page).click();
  body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ task: "image-segment", adapter: "fal" });
  expect(body).not.toHaveProperty("prompt");

  // Vectorize runs on a route without a key here: the form asks for it instead of sending.
  await tool(page, "Vectorize").click();
  await expect(page.getByRole("region", { name: "Add a key to run this model" })).toContainText("Recraft");
  await expect(generate(page)).toBeDisabled();
});

test("image tools: adding an image on Create opens Edit with it; a model no route can edit is named; Korean names the tools", async ({ page }) => {
  await page.goto("/#/image");
  await page.getByLabel("Prompt").fill("a lighthouse");
  await page.getByLabel("Image to edit", { exact: true }).setInputFiles(file("start.png"));
  await expect(tool(page, "Edit")).toHaveAttribute("aria-pressed", "true");
  await expect(images(page).getByRole("img", { name: "start.png" })).toBeVisible();
  // Create still makes an image from the prompt alone.
  await tool(page, "Create").click();
  await expect(page.getByLabel("Prompt")).toHaveValue("a lighthouse");
  const request = submitted(page);
  await generate(page).click();
  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body.task).toBe("text-to-image");
  expect(body.inputs).toEqual([]);
  await tool(page, "Edit").click();
  await expect(images(page).getByRole("img", { name: "start.png" })).toBeVisible();

  await page.goto("about:blank");
  await page.goto("/#/image?mode=edit&model=black-forest-labs%2Fflux-2-pro");
  await expect(page.getByRole("status").filter({ hasText: "FLUX.2 Pro has no route this tool can run yet" })).toBeVisible();
  await page.getByRole("button", { name: /Language/ }).click();
  const tools = page.getByRole("group", { name: "도구" });
  for (const name of ["만들기", "편집", "업스케일", "벡터화", "분리"]) await expect(tools.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByText("이미지를 추가해 주세요.")).toBeVisible();
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});
