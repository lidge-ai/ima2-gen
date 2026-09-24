#!/usr/bin/env node
// Link check for the five READMEs: every relative markdown link or img src must point
// at an existing file, and a #fragment into a local markdown file must match one of its
// headings (GitHub slug rules). Absolute URLs are not fetched.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const files = ["README.md", "docs/README.ko.md", "docs/README.ja.md", "docs/README.zh-CN.md", "docs/README.zh-TW.md"];
const slugCache = new Map();

function slug(text) {
  return text.trim().toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function headingSlugs(path) {
  if (slugCache.has(path)) return slugCache.get(path);
  const seen = new Map();
  const slugs = new Set();
  let fenced = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  slugCache.set(path, slugs);
  return slugs;
}

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  const targets = [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), ...text.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  for (const raw of targets) {
    if (/^[a-z]+:/i.test(raw) || raw.startsWith("//")) continue;
    const [pathPart, fragment] = raw.split("#");
    const target = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart)) : resolve(file);
    if (!existsSync(target)) { problems.push(`${file}: missing ${raw}`); continue; }
    if (fragment && target.endsWith(".md") && !headingSlugs(target).has(decodeURIComponent(fragment).toLowerCase())) {
      problems.push(`${file}: no heading for #${fragment} in ${pathPart || file}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${files.length} READMEs, all relative links and fragments resolve`);
