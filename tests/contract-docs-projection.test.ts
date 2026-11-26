// WP7 (070): docs projection determinism + staleness gate.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { buildMediaToolDescriptors } from "../lib/providers/media/toolSchema.js";
import { WORKFLOWS } from "../lib/workflows/index.js";

const run = promisify(execFile);

test("generated section exists, is current, and regeneration is deterministic", async () => {
  const before = readFileSync("skills/ima2/SKILL.md", "utf8");
  assert.ok(before.includes("<!-- mcp-tools:generated:start -->"));
  await run("node", ["--import", "tsx", "scripts/generate-contract-docs.mjs", "--check"], { timeout: 60_000 });
  await run("node", ["--import", "tsx", "scripts/generate-contract-docs.mjs"], { timeout: 60_000 });
  const after = readFileSync("skills/ima2/SKILL.md", "utf8");
  assert.equal(after, before, "regeneration must be byte-identical for the same catalog");
});

test("media MCP table projects all descriptors", () => {
  const content = readFileSync("skills/ima2/SKILL.md", "utf8");
  const start = "<!-- ima2-mcp-server:generated:start -->";
  const end = "<!-- ima2-mcp-server:generated:end -->";
  assert.equal(content.split(start).length, 2);
  assert.equal(content.split(end).length, 2);
  assert.ok(content.indexOf(start) < content.indexOf(end));
  const section = content.slice(content.indexOf(start) + start.length, content.indexOf(end));
  const rows = section.split("\n").filter((line) => line.startsWith("| `"));
  const descriptors = buildMediaToolDescriptors(WORKFLOWS);
  assert.equal(descriptors.length, 14);
  assert.equal(rows.length, descriptors.length);
  for (const descriptor of descriptors) {
    const row = rows.find((line) => line.startsWith(`| \`${descriptor.name}\` |`));
    assert.ok(row, `missing ${descriptor.name}`);
    const cells = row.split("|").map((cell) => cell.trim());
    assert.equal(cells[2], descriptor.billed ? "yes" : "no");
    assert.equal(cells[4], (descriptor.inputSchema.required ?? []).map((arg) => `\`${arg}\``).join(", ") || "—");
  }
});

test("non-generated skill content is preserved around the markers", () => {
  const content = readFileSync("skills/ima2/SKILL.md", "utf8");
  assert.ok(content.indexOf("<!-- mcp-tools:generated:start -->") > content.indexOf("# "), "markers live inside the doc");
  assert.ok(content.includes("ima2 tools list --json"), "generated section points agents at the live CLI");
});
