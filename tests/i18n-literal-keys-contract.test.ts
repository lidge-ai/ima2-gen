import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/.test(path) ? [path] : [];
  });
}

function literalKeys(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const keys: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t"
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.push(node.arguments[0].text);
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "labelKey"
      && ts.isStringLiteral(node.initializer)) {
      // Agent progress labels are relative to the agent namespace at their call site.
      const prefix = path.endsWith("components/agent/agentRunProgress.ts") ? "agent." : "";
      keys.push(prefix + node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return keys;
}

test("literal translation keys exist in every locale", () => {
  const keys = new Set(sourceFiles("ui/src").flatMap(literalKeys));
  assert.ok(keys.size > 0);
  const missing: string[] = [];
  for (const locale of ["en", "ko", "zh-Hans", "zh-Hant"]) {
    const dictionary: unknown = JSON.parse(readFileSync(`ui/src/i18n/${locale}.json`, "utf8"));
    for (const key of keys) {
      const value = key.split(".").reduce<unknown>((current, part) =>
        current !== null && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined,
      dictionary);
      if (typeof value !== "string") missing.push(`${locale}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
