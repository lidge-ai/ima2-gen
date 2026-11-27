import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => label + " " + Date.now().toString(36);

async function pickKlein(page: Page) {
  await page.goto("/#/image");
  await page.getByRole("button", { name: /^Model: / }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const local = picker.getByRole("list", { name: "On this computer (ComfyUI)" });
  await expect(local.getByRole("button", { name: /FLUX\.2 klein/ })).toContainText("No charge");
  // It is not offered as something a key unlocks.
  await expect(picker.getByRole("list", { name: "Ready with your keys" }).getByRole("button", { name: /FLUX\.2 klein/ })).toHaveCount(0);
  await local.getByRole("button", { name: /FLUX\.2 klein/ }).click();
}

test("a ComfyUI workflow shows run time and no charge instead of a missing price", async ({ page }) => {
  await pickKlein(page);
  await page.getByLabel("Prompt").fill("a fox in snow");
  const generate = page.getByRole("button", { name: /Generate/ });
  await expect(generate).toContainText("No charge · about 42 s");
  await expect(generate).not.toContainText("Price not published");
  await expect(page.getByText("Add a key to run this model")).toHaveCount(0);
  await expect(generate).toBeEnabled();
  // Its sizes come as WIDTHxHEIGHT and read as sizes.
  await page.getByRole("button", { name: /^Resolution: / }).click();
  await expect(page.getByRole("group", { name: "Resolution" }).getByRole("button")).toHaveText([
    "1024 × 1024",
    "1536 × 1024",
    "1024 × 1536",
  ]);
});

test("a workflow with paid nodes says a charge may come, not 'no charge'", async ({ page }) => {
  await page.route("**/api/media/estimate", (route) =>
    route.fulfill({
      json: { model: "comfy/klein", adapter: "comfy-local", route: "local", usd: null, quote: { state: "local" }, local: { expectedSec: null, basis: "no runs yet", mayBill: true } },
    }),
  );
  await pickKlein(page);
  const generate = page.getByRole("button", { name: /Generate/ });
  await expect(generate).toContainText("A paid node may charge");
  await expect(generate).not.toContainText("No charge");
});

test("when ComfyUI is not running, the job says so and offers to try again, not to add a key", async ({ page }) => {
  await pickKlein(page);
  const prompt = unique("[fail:comfy-offline] a fox");
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: /Generate/ }).click();
  const card = page.getByRole("article", { name: /Failed: .*a fox/ });
  await expect(card.getByRole("alert")).toContainText("could not reach ComfyUI on this computer. Start ComfyUI, then try again.");
  await expect(card.getByRole("alert")).toContainText("Lost contact with ComfyUI");
  await expect(card.getByRole("alert")).toContainText("COMFY_OFFLINE");
  await expect(card.getByRole("link", { name: "Check the key" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("in Korean, a local workflow reads 요금 없음 with its run time", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.goto("/#/image?model=comfy%2Fklein");
  await page.getByLabel("프롬프트").fill("눈 속의 여우");
  await expect(page.getByRole("button", { name: /생성/ })).toContainText("요금 없음 · 약 42초");
});

test("the audio screen reads a local ComfyUI workflow the same way: run time, no price, no key", async ({ page }) => {
  // The fake catalog has no local audio workflow; add one the way the server lists it.
  await page.route("**/api/media/catalog*", async (route) => {
    const body = await (await route.fetch()).json();
    body.models.push({
      id: "comfy/sfx", label: "Foley loop", vendor: "comfy", kind: "audio", tasks: ["text-to-audio"],
      routes: [{ adapter: "comfy-local", route: "local", label: "ComfyUI (your server)", upstreamId: "sfx", tasks: ["text-to-audio"],
        params: {}, pricing: [], docsUrl: "", hasKey: true, keyless: true }],
      defaultRoute: "comfy-local",
    });
    await route.fulfill({ json: body });
  });
  await page.route("**/api/media/estimate", (route) =>
    route.fulfill({ json: { model: "comfy/sfx", adapter: "comfy-local", route: "local", usd: 0, quote: { state: "local" }, local: { expectedSec: 12, basis: "median of 2 earlier runs", mayBill: false } } }),
  );
  await page.goto("/#/audio?tool=sound&model=comfy%2Fsfx");
  await expect(page.getByRole("button", { name: /^Model: / })).toContainText("Foley loop");
  await expect(page.getByRole("button", { name: /^Generate/ })).toContainText("No charge · about 12 s");
  await expect(page.getByRole("button", { name: /^Generate/ })).not.toContainText("Price not published");
  await expect(page.getByText("Add a key to run this model")).toHaveCount(0);
});

test("in Korean, the ComfyUI route reads as your own server, not the server's English name", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  await page.goto("/#/models");
  await expect(page.getByText("ComfyUI (내 서버)").first()).toBeVisible();
  await expect(page.getByText("ComfyUI (your server)")).toHaveCount(0);
});
