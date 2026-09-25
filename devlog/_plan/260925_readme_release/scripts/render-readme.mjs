// Render README.md through GitHub's GFM API and screenshot it with GitHub's CSS.
// Usage (from ui/): node ../devlog/_plan/260925_readme_release/scripts/render-readme.mjs <README path> <out prefix>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [mdPath = "../README.md", outPrefix = "/tmp/ima2-readme-render"] = process.argv.slice(2);
const md = resolve(mdPath);
const html = execFileSync("gh", ["api", "markdown", "-f", "mode=gfm", "-f", "context=lidge-ai/ima2-gen", "-F", `text=@${md}`], { encoding: "utf8", maxBuffer: 1 << 26 });
const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright");
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(dirname(md)).href}/">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-${theme}.min.css">
<style>body{margin:0;background:${theme === "dark" ? "#0d1117" : "#fff"}}.markdown-body{box-sizing:border-box;max-width:1012px;margin:0 auto;padding:32px 45px}</style>
</head><body><article class="markdown-body">${html}</article></body></html>`;
  const file = `${outPrefix}-${theme}.html`;
  writeFileSync(file, doc);
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${outPrefix}-${theme}-top.png` });
  await page.screenshot({ path: `${outPrefix}-${theme}-full.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log("rendered", outPrefix);
