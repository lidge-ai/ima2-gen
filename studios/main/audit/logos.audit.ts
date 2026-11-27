import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dir, record } from "./lib.ts";

// Vendor logo audit: every manifest vendor in every logo slot (logo sheet), and the Models page
// filtered to each maker. Captured at device scale 2 so 14-20 px marks can be judged.

const manifest = JSON.parse(readFileSync(new URL("../../kit/assets/vendors/manifest.json", import.meta.url), "utf8")) as {
  vendors: { id: string }[];
};

test.use({ deviceScaleFactor: 2 });

test("logo sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/audit/logos.html");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(700);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(dir(), "logos__sheet__1440__en.png"), fullPage: true });
  const slots = await page.evaluate(() =>
    [...document.querySelectorAll("tr[data-vendor] td")].map((td) => {
      const vendor = td.parentElement!.getAttribute("data-vendor");
      const slot = td.getAttribute("data-slot");
      const box = td.querySelector(".vendor-logo-box, .vendor-logo-plate");
      const img = td.querySelector("img");
      const logo = td.querySelector(".vendor-logo");
      const cell = td.getBoundingClientRect();
      const r = img?.getBoundingClientRect();
      const b = box?.getBoundingClientRect();
      return {
        vendor,
        slot,
        kind: logo?.className.match(/is-(monogram|text)|plate-\w+/g)?.join(" ") ?? "none",
        file: img?.getAttribute("src")?.split("/").pop() ?? null,
        img: r ? [Math.round(r.width), Math.round(r.height)] : null,
        box: b ? [Math.round(b.width), Math.round(b.height)] : null,
        escapesBox: !!(r && b && (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1)),
        escapesCell: !!(r && (r.left < cell.left - 1 || r.right > cell.right + 1 || r.top < cell.top - 1 || r.bottom > cell.bottom + 1)),
      };
    }),
  );
  for (const s of slots) record({ cell: "logos__sheet", ...s });
});

test("models page per maker", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const { id } of manifest.vendors) {
    await page.goto("/#/models/" + id);
    await page.waitForTimeout(500);
    const cards = await page.getByRole("article").count();
    record({ cell: "models__maker", vendor: id, cards });
    if (cards === 0) continue;
    await page.screenshot({ path: join(dir(), "models__maker-" + id + "__1440__en.jpg"), type: "jpeg", quality: 80 });
  }
});

test("logo slots in context", async ({ page }) => {
  for (const [name, hash, act] of [
    ["picker-video", "/video", "Model"],
    ["picker-image", "/image", "Model"],
    ["keys", "/keys", ""],
    ["home-makers", "/", ""],
  ] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#" + hash);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(700);
    if (act) await page.getByRole("button", { name: /^Model:/ }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir(), "logos__" + name + "__1440__en.jpg"), type: "jpeg", quality: 80, fullPage: !act });
  }
});

