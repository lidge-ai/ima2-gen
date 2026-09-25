#!/usr/bin/env node
/**
 * generate-release-notes.mjs — categorize conventional commits into release notes
 *
 * Usage:
 *   node scripts/generate-release-notes.mjs                  # auto-detect prev tag
 *   node scripts/generate-release-notes.mjs v2.0.2..v2.0.3   # explicit range
 *   node scripts/generate-release-notes.mjs --json            # output JSON
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const rangeArg = args.find((a) => !a.startsWith("--"));

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf-8" }).trim();
}

function detectRange() {
  if (rangeArg && rangeArg.includes("..")) return rangeArg;
  const tags = git("tag --sort=-v:refname")
    .split("\n")
    .filter((t) => /^v\d/.test(t));
  if (tags.length < 2) return tags[0] ? `${tags[0]}..HEAD` : "HEAD~20..HEAD";
  return `${tags[1]}..${tags[0]}`;
}

const range = detectRange();
const [prevTag] = range.split("..");
const rawCommits = git(`log ${range} --pretty=format:"%s" --no-merges`)
  .split("\n")
  .filter(Boolean);

const categories = {
  feat: { title: "Features", icon: "✨", items: [] },
  fix: { title: "Fixes", icon: "🐛", items: [] },
  perf: { title: "Performance", icon: "⚡", items: [] },
  docs: { title: "Docs", icon: "📝", items: [] },
  ci: { title: "CI / DevOps", icon: "🔧", items: [] },
  refactor: { title: "Refactoring", icon: "♻️", items: [] },
  test: { title: "Tests", icon: "🧪", items: [] },
  chore: { title: "Chore", icon: "🏗️", items: [] },
  other: { title: "Other", icon: "📦", items: [] },
};

const conventionalRe = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const seen = new Set();

for (const msg of rawCommits) {
  const match = msg.match(conventionalRe);
  let type, scope, description;
  if (match) {
    type = match[1];
    scope = match[2] || null;
    description = match[4];
  } else {
    type = "other";
    scope = null;
    description = msg;
  }

  const key = type in categories ? type : "other";
  const dedup = `${key}:${description.toLowerCase().replace(/\s+/g, " ")}`;
  if (seen.has(dedup)) continue;
  seen.add(dedup);

  const prefix = scope ? `**${scope}**: ` : "";
  categories[key].items.push(`${prefix}${description}`);
}

if (jsonMode) {
  const result = {};
  for (const [key, cat] of Object.entries(categories)) {
    if (cat.items.length > 0) result[key] = cat.items;
  }
  console.log(JSON.stringify({ range, prevTag, commitCount: rawCommits.length, categories: result }, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`## What's Changed\n`);

for (const cat of Object.values(categories)) {
  if (cat.items.length === 0) continue;
  lines.push(`### ${cat.title}`);
  for (const item of cat.items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

lines.push(
  `**Full Changelog**: https://github.com/lidge-ai/ima2-gen/compare/${prevTag}...${range.split("..")[1] || "HEAD"}`,
);

console.log(lines.join("\n"));
