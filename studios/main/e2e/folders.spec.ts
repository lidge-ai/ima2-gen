import { expect, test, type APIRequestContext } from "@playwright/test";

async function made(request: APIRequestContext, data: Record<string, unknown>) {
  expect((await request.post("/api/media", { data: { inputs: [], ...data } })).ok()).toBeTruthy();
  await expect.poll(async () => ((await (await request.get("/api/history?q=" + encodeURIComponent(String(data.prompt)))).json()) as { matched: number }).matched, { timeout: 20_000 }).toBe(1);
}

test("folders: a result is put in a new folder from its lightbox, shown by folder, taken out, and survives the folder's deletion", async ({ page, request }) => {
  const mark = "fd" + Date.now().toString(36);
  const fox = mark + " fox", whale = mark + " whale", folder = "Foxes " + mark;
  await made(request, { model: "openai/gpt-image-2", task: "text-to-image", prompt: fox });
  await made(request, { model: "bytedance/seedance-2.5", task: "text-to-video", prompt: whale });

  await page.goto("/#/assets/all?q=" + mark);
  const results = page.getByRole("region", { name: "Assets results" });
  const lightbox = page.getByRole("dialog", { name: "Result" });
  const tools = page.getByRole("group", { name: "Search, filter and sort" });
  await results.getByRole("button", { name: "Open " + fox }).click();
  await lightbox.getByRole("button", { name: "Folder: None", exact: true }).click();
  // The menu opens inside the result's dialog; Escape closes the menu and leaves the result open.
  await expect(page.getByRole("button", { name: "New folder…", exact: true })).toBeVisible();
  // It sits right under its chip, where the person is looking.
  const chip = (await lightbox.getByRole("button", { name: "Folder: None", exact: true }).boundingBox())!;
  const menu = (await page.getByRole("dialog", { name: "Folder", exact: true }).boundingBox())!;
  expect({ dx: Math.round(Math.abs(menu.x - chip.x)), dy: Math.round(menu.y - (chip.y + chip.height)) }).toEqual({ dx: 0, dy: 6 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "New folder…", exact: true })).toHaveCount(0);
  await expect(lightbox).toBeVisible();
  await lightbox.getByRole("button", { name: "Folder: None", exact: true }).click();
  await page.getByRole("button", { name: "New folder…", exact: true }).click();
  await lightbox.getByLabel("New folder name").fill(folder);
  await lightbox.getByRole("button", { name: "Create and move here" }).click();
  await expect(lightbox.getByRole("status").filter({ hasText: "Moved to " + folder + "." })).toBeVisible();
  await expect(lightbox.getByRole("button", { name: "Folder: " + folder, exact: true })).toBeVisible();
  // Delete is still the last action.
  expect((await lightbox.locator(".lightbox-actions > .btn").allTextContents()).at(-1)?.trim()).toBe("Delete");
  await lightbox.getByRole("button", { name: "Close" }).click();

  // The folder filter asks the server for that folder, and the address keeps it.
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/history" && !!new URL(r.url()).searchParams.get("folderId"));
  await tools.getByRole("button", { name: "Folder: All results", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: folder, exact: true }).click();
  await asked;
  await expect(page).toHaveURL(/folder=af_/);
  await expect(results.getByRole("button", { name: "Open " + fox })).toBeVisible();
  await expect(results.getByRole("button", { name: "Open " + whale })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "1 result" })).toBeVisible();
  await page.reload();
  await expect(tools.getByRole("button", { name: "Folder: " + folder, exact: true })).toBeVisible();

  // Taken out: the folder is now empty and says how results get there.
  await tools.getByRole("searchbox").fill("");
  await results.getByRole("button", { name: "Open " + fox }).click();
  await lightbox.getByRole("button", { name: "Folder: " + folder, exact: true }).click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This folder is empty." })).toBeVisible();
  await page.getByRole("button", { name: "See all results" }).click();
  await expect(tools.getByRole("button", { name: "Folder: All results", exact: true })).toBeVisible();

  // Back in, renamed, then the folder is deleted: the result stays.
  await tools.getByRole("searchbox").fill(mark);
  await results.getByRole("button", { name: "Open " + fox }).click();
  await lightbox.getByRole("button", { name: "Folder: None", exact: true }).click();
  await page.getByRole("button", { name: folder, exact: true }).click();
  await expect(lightbox.getByRole("status").filter({ hasText: "Moved to " + folder + "." })).toBeVisible();
  await lightbox.getByRole("button", { name: "Close" }).click();
  await tools.getByRole("button", { name: "Edit folders" }).click();
  const list = page.getByRole("dialog", { name: "Folders" });
  const row = list.getByRole("listitem").filter({ hasText: folder });
  await row.getByRole("button", { name: "Rename" }).click();
  await list.getByRole("form", { name: "Rename " + folder }).getByLabel("Folder name").fill(folder + " 2");
  await list.getByRole("button", { name: "Save", exact: true }).click();
  const renamed = list.getByRole("listitem").filter({ hasText: folder + " 2" });
  await renamed.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(renamed).toContainText("Its results stay in Assets.");
  await renamed.getByRole("button", { name: "Keep it" }).click();
  await renamed.getByRole("button", { name: "Delete", exact: true }).click();
  await renamed.getByRole("button", { name: "Delete folder" }).click();
  await expect(list.getByRole("listitem").filter({ hasText: folder })).toHaveCount(0);
  await list.getByRole("button", { name: "Close" }).click();
  await expect(results.getByRole("button", { name: "Open " + fox })).toBeVisible();
  await results.getByRole("button", { name: "Open " + fox }).click();
  await expect(lightbox.getByRole("button", { name: "Folder: None", exact: true })).toBeVisible();
  await lightbox.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Language/ }).click();
  await expect(page.getByRole("button", { name: "폴더: 모든 결과", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "폴더 편집" })).toBeVisible();
  await page.getByRole("button", { name: /언어|Language/ }).first().click();
});

test("folders: a folder is made in the folder list, an empty name is not accepted, and a folder that is gone from the address shows every result", async ({ page }) => {
  const name = "Shelf " + Date.now().toString(36);
  await page.goto("/#/assets/all?folder=af_gone");
  const tools = page.getByRole("group", { name: "Search, filter and sort" });
  await expect(tools.getByRole("button", { name: "Folder: All results", exact: true })).toBeVisible();
  await tools.getByRole("button", { name: "Edit folders" }).click();
  const list = page.getByRole("dialog", { name: "Folders" });
  await expect(list.getByRole("button", { name: "Create folder" })).toBeDisabled();
  await list.getByLabel("New folder name").fill("   ");
  await expect(list.getByRole("button", { name: "Create folder" })).toBeDisabled();
  await list.getByLabel("New folder name").fill(name);
  await list.getByRole("button", { name: "Create folder" }).click();
  await expect(list.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await expect(list.getByLabel("New folder name")).toHaveValue("");
  await list.getByRole("button", { name: "Close" }).click();
  // The new folder is offered by the filter at once.
  await tools.getByRole("button", { name: "Folder: All results", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name, exact: true })).toBeVisible();
});
