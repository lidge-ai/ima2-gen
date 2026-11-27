import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

// The figure on Generate is the server's estimate (POST /api/media/estimate). These two rows are written the way
// the providers write them; a studio-side row matcher found no price for either.
const CLIP = fileURLToPath(new URL("../public/samples/orbit.mp4", import.meta.url));
const generate = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /Generate/ });

test("PixVerse extend is priced from its 'audio off' row: 720p, 5 s, the source's own sound", async ({ page }) => {
  const asked: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/media/estimate") asked.push(r.postDataJSON() as Record<string, unknown>);
  });
  await page.goto("/#/video?mode=edit&model=pixverse%2Fpixverse-v6");
  await expect(page.getByRole("group", { name: "Tool" }).getByRole("button", { name: "Extend", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Video to extend").setInputFiles(CLIP);
  await page.getByLabel(/^Prompt/).fill("keep walking into the fog");
  // 9 credits a second at 225 credits a dollar, for the 5 s added: $0.20.
  await expect(generate(page)).toContainText("Estimated $0.20 · 5 s");
  const last = asked.at(-1)!;
  expect(last).toMatchObject({ model: "pixverse/pixverse-v6", task: "video-extend", adapter: "pixverse", durationSec: 5, resolution: "720p" });
  // The estimate carries no prompt and no sound flag: extend keeps the source's sound.
  expect(last).not.toHaveProperty("prompt");
  expect(last).not.toHaveProperty("audio");
});

test("H3 Regeneration upscale is priced from its '768P to 2K' row, for the source clip's length", async ({ page }) => {
  await page.goto("/#/video?mode=edit&model=minimax%2Fhailuo-h3-regen");
  await expect(page.getByRole("group", { name: "Tool" }).getByRole("button", { name: "Upscale", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(generate(page)).toContainText("Add the video to see the price");
  await page.getByLabel("Video to upscale").setInputFiles(CLIP);
  await expect(generate(page)).toContainText(/Estimated \$\d+\.\d+ · \d+ s/);
  const [, usd, secs] = /\$(\d+\.\d+) · (\d+) s/.exec((await generate(page).textContent()) ?? "")!;
  expect(Number(usd)).toBeCloseTo(Number(secs) * 0.05, 5);
});

test("in Korean the server's figure reads 예상, and a pending answer says it is being worked out", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ima2.locale", "ko"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/media/estimate", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/#/video");
  await expect(page.getByRole("button", { name: /생성/ })).toContainText("계산 중…");
  release();
  await expect(page.getByRole("button", { name: /생성/ })).toContainText("예상 $0.30");
});
