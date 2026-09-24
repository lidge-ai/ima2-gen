import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { createRequire } from "node:module";

// wp2 (devlog/_plan/260831_ui_polish_round/010_wp2_radius_scale.md): every
// border-radius in ui/src resolves through one of eight scale tokens defined in
// exactly one place. A name-only check would pass a wrong token on a right
// selector, so the oracle is a frozen per-declaration manifest instead.
//
// postcss lives in ui/node_modules, not the root tree. Several contracts here
// already read the ui tree directly (typescript, @types/react), so this follows
// that precedent rather than adding a root dependency for one test.
const require = createRequire(import.meta.url);
type PostcssNode = {
  type: string;
  name?: string;
  params?: string;
  selector?: string;
  parent?: PostcssNode;
};
type PostcssDecl = PostcssNode & {
  prop: string;
  value: string;
  important?: boolean;
  source?: { start?: { line: number } };
};
type PostcssRoot = {
  walkDecls(cb: (decl: PostcssDecl) => void): void;
  walkAtRules(name: string, cb: (rule: { params: string }) => void): void;
};
const postcss = require("../ui/node_modules/postcss") as {
  parse(css: string, opts?: { from?: string }): PostcssRoot;
};

type RadiusRow = {
  file: string;
  atRule: string | null;
  selector: string;
  expected: string;
  important: boolean;
};

const MANIFEST: RadiusRow[] = JSON.parse(
  readFileSync("tests/fixtures/contracts/radius-scale.manifest.json", "utf8"),
);

const SCALE = {
  "--r-xs": "4px",
  "--r-sm": "6px",
  "--r-md": "8px",
  "--r-lg": "10px",
  "--r-xl": "12px",
  "--r-2xl": "16px",
  "--r-3xl": "20px",
  "--r-pill": "999px",
} as const;

const RADIUS_LONGHANDS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-start-start-radius",
  "border-start-end-radius",
  "border-end-start-radius",
  "border-end-end-radius",
];

function cssFiles(dir = "ui/src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(path));
    else if (entry.name.endsWith(".css")) out.push(path);
  }
  return out.sort();
}

function tsFiles(dir = "ui/src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out.sort();
}

function normalize(path: string): string {
  return path.split(sep).join("/");
}

type Decl = {
  file: string;
  line: number;
  prop: string;
  value: string;
  important: boolean;
  atRule: string | null;
  selector: string;
};

function radiusDecls(): Decl[] {
  const found: Decl[] = [];
  for (const file of cssFiles()) {
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    root.walkDecls((decl) => {
      if (!/radius/i.test(decl.prop)) return;
      let atRule: string | null = null;
      let parent: PostcssNode | undefined = decl.parent;
      while (parent) {
        if (parent.type === "atrule") {
          atRule = String(parent.name) + " " + String(parent.params);
          break;
        }
        parent = parent.parent;
      }
      found.push({
        file: normalize(file),
        line: decl.source?.start?.line ?? 0,
        prop: decl.prop.toLowerCase(),
        value: decl.value.trim(),
        important: Boolean(decl.important),
        atRule,
        selector: decl.parent?.selector ?? "",
      });
    });
  }
  return found;
}

function keyOf(row: { file: string; atRule: string | null; selector: string }): string {
  return [row.file, row.atRule ?? "", row.selector].join("||");
}

test("the frozen manifest covers every border-radius declaration exactly once", () => {
  const decls = radiusDecls().filter((d) => d.prop === "border-radius");
  // WP12s adds exactly three inspected sign-in panel/input/button declarations.
  assert.equal(MANIFEST.length, 482, "the manifest is frozen at 482 rows");
  assert.equal(decls.length, MANIFEST.length, "declaration count drifted from the manifest");

  const manifestKeys = new Set(MANIFEST.map(keyOf));
  assert.equal(manifestKeys.size, MANIFEST.length, "manifest keys must be unique");

  const seen = new Set<string>();
  for (const decl of decls) {
    const key = keyOf(decl);
    assert.ok(!seen.has(key), "duplicate declaration key: " + key);
    seen.add(key);
    assert.ok(manifestKeys.has(key), "border-radius not in the frozen manifest: " + decl.file + ":" + decl.line);
  }
  for (const row of MANIFEST) {
    assert.ok(seen.has(keyOf(row)), "manifest row no longer present in CSS: " + keyOf(row));
  }
});

test("each declaration carries exactly the mapped token and !important flag", () => {
  const byKey = new Map(radiusDecls().filter((d) => d.prop === "border-radius").map((d) => [keyOf(d), d]));
  for (const row of MANIFEST) {
    const decl = byKey.get(keyOf(row));
    assert.ok(decl, "missing declaration for " + keyOf(row));
    // Character-exact: a valid-but-wrong scale token on the right selector is the
    // failure mode a name-only check cannot see.
    assert.equal(decl!.value, row.expected, "wrong radius value at " + decl!.file + ":" + decl!.line);
    // postcss keeps !important out of decl.value, so comparing values alone would
    // let a deleted !important pass.
    assert.equal(decl!.important, row.important, "!important drifted at " + decl!.file + ":" + decl!.line);
  }
});

test("the eight scale tokens hold their values and are defined exactly once", () => {
  const definitions = new Map<string, { file: string; line: number; value: string; selector: string }[]>();
  for (const file of cssFiles()) {
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    root.walkDecls((decl) => {
      const prop = decl.prop.trim();
      if (!(prop in SCALE)) return;
      const list = definitions.get(prop) ?? [];
      list.push({
        file: normalize(file),
        line: decl.source?.start?.line ?? 0,
        value: decl.value.trim(),
        selector: (decl.parent as any)?.selector ?? "",
      });
      definitions.set(prop, list);
    });
  }
  for (const [token, expected] of Object.entries(SCALE)) {
    const list = definitions.get(token) ?? [];
    // Value-only assertions are bypassable by a scoped redefinition such as
    // .modal { --r-lg: 999px }, which leaves both :root and the manifest intact.
    assert.equal(list.length, 1, token + " must be defined exactly once, found " + list.length);
    assert.equal(list[0].file, "ui/src/index.css", token + " must live in ui/src/index.css");
    assert.equal(list[0].selector, ":root", token + " must be defined on the plain :root block");
    assert.equal(list[0].value, expected, token + " must stay " + expected);
  }
});

test("no radius longhand, vendor prefix, or @property registration exists", () => {
  // A prefixed longhand such as -webkit-border-top-left-radius overrides the
  // standard shorthand in Chrome (reproduced: border-radius 6px followed by
  // -webkit-border-top-left-radius 999px computes to 999px), and it appears in
  // neither the standard-longhand nor the prefixed-shorthand list. Strip the
  // prefix first, then compare against the standard names, so any current or
  // future vendor spelling of a radius longhand is refused.
  for (const decl of radiusDecls()) {
    const bare = decl.prop.replace(/^-(webkit|moz|ms|o)-/, "");
    assert.ok(
      !RADIUS_LONGHANDS.includes(bare),
      "radius longhand overrides the shorthand: " + decl.file + ":" + decl.line + " " + decl.prop,
    );
    assert.ok(
      bare === decl.prop,
      "prefixed radius overrides the shorthand: " + decl.file + ":" + decl.line + " " + decl.prop,
    );
  }
  for (const file of cssFiles()) {
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    root.walkAtRules("property", (rule) => {
      // @property initial-value can change the computed value while :root still
      // reads correct.
      assert.ok(
        !/^--r-/.test(rule.params.trim()),
        "@property must not register a radius token: " + normalize(file) + " " + rule.params,
      );
    });
  }
});

test("stylesheet imports stay inside the audited ui/src tree", () => {
  // The manifest only covers ui/src/**/*.css. An @import pointing at a URL or at
  // a path outside that tree would ship radius the contract never parsed.
  for (const file of cssFiles()) {
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    root.walkAtRules("import", (rule) => {
      const target = rule.params.trim().replace(/^(url\()?["']?/, "").replace(/["']?\)?$/, "");
      if (target === "tailwindcss") return; // package entry, resolved by the bundler
      assert.ok(
        target.startsWith("./") || target.startsWith("styles/"),
        "@import must stay inside ui/src: " + normalize(file) + " -> " + target,
      );
      assert.ok(
        !target.includes(".."),
        "@import must not escape ui/src: " + normalize(file) + " -> " + target,
      );
    });
  }
});

test("the HTML shell carries no radius of its own", () => {
  // index.html sits outside ui/src, so a <style> block or a style attribute there
  // would never reach the manifest.
  const html = readFileSync("ui/index.html", "utf8");
  const withoutFavicon = html.replace(/href="data:image\/svg\+xml[^"]*"/g, "");
  assert.ok(!/<style[\s>]/i.test(withoutFavicon), "index.html must not carry a <style> block");
  assert.ok(!/\sstyle=/i.test(withoutFavicon), "index.html must not carry inline style attributes");
  assert.ok(
    !/border[a-z-]*radius/i.test(withoutFavicon),
    "index.html must not declare radius outside the audited tree",
  );
  // A stylesheet link here would load CSS the manifest never parsed (audit
  // wp2c2-F3). The shell links fonts and an icon, never a stylesheet.
  assert.ok(
    !/rel\s*=\s*["\']stylesheet["\']/i.test(withoutFavicon),
    "index.html must not link a stylesheet outside the audited tree",
  );
});

test("the retired radius tokens and calc pattern are gone", () => {
  for (const file of cssFiles()) {
    const css = readFileSync(file, "utf8");
    const rel = normalize(file);
    assert.ok(!/--radius\b/.test(css), "--radius must not return: " + rel);
    assert.ok(!/--radius-(md|lg)\b/.test(css), "undefined --radius-* refs must not return: " + rel);
    assert.ok(!/--agent-r-(sm|md|lg)\b/.test(css), "agent-local radius scale must not return: " + rel);
    assert.ok(!/calc\(\s*var\(--r/.test(css), "calc offsets off the scale must not return: " + rel);
  }
});

test("every radius token reference resolves to a defined scale token", () => {
  const defined = new Set(Object.keys(SCALE));
  for (const decl of radiusDecls()) {
    for (const ref of decl.value.match(/--[a-zA-Z0-9-]+/g) ?? []) {
      assert.ok(defined.has(ref), "undefined radius token " + ref + " at " + decl.file + ":" + decl.line);
    }
  }
});

test("TS and TSX carry exactly one allowlisted radius property", () => {
  // The earlier regex only matched double-quoted values, so borderRadius: '999px',
  // borderRadius: 999, a template literal, and WebkitBorderRadius all slipped past
  // (audit wp2c1-F1). Walk the TypeScript AST and key on the property NAME, which
  // makes the check independent of how the value is spelled.
  const ts = require("../ui/node_modules/typescript") as typeof import("typescript");
  const ALLOWED = new Map([["ui/src/components/settings/QuotaCard.tsx", 'borderRadius: "var(--r-sm)"']]);
  // CSSOM injection assembles a stylesheet the postcss walk never sees. The one
  // permitted write is pinned by exact text, not by file: exempting the whole file
  // would let that same caret-measurement mirror add radius later (audit wp2c3-F1).
  // It copies font and box metrics and declares no radius.
  const CSS_WRITES_ALLOWED = new Map([[
    "ui/src/components/ElementMentionMenu.tsx",
    ['mirror.style.cssText += ";position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;top:0;left:-9999px;"'],
  ]]);
  const CSS_INJECTION_APIS = new Set(["insertRule", "addRule", "replaceSync"]);
  const cssWrites: { file: string; text: string }[] = [];
  // Third-party stylesheets the round does not own. @xyflow/react ships its own
  // radius (border-radius: 1px on the resize handle) and is not ours to restyle;
  // it is out of the manifest scope rather than a bypass of it.
  const VENDOR_CSS_ALLOWED = new Set(["@xyflow/react/dist/style.css"]);
  const hits: { file: string; text: string }[] = [];

  const isRadiusName = (name: string) =>
    /^([A-Za-z]*[Bb]order[A-Za-z]*Radius)$/.test(name) || /^--r-/.test(name);

  for (const file of tsFiles()) {
    const source = readFileSync(file, "utf8");
    const rel = normalize(file);
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    // Names this file declares as a stylesheet or style element. Reading the
    // annotation beats guessing from the identifier, which both misses aliases and
    // flags ordinary strings that happen to be named styleName (audit wp2c4-F1).
    const cssomNames = new Set<string>();
    const collectTypes = (node: import("typescript").Node): void => {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
        const typeText = node.type ? node.type.getText(sourceFile) : "";
        if (/CSSStyleSheet|HTMLStyleElement|StyleSheetList/.test(typeText) && ts.isIdentifier(node.name)) {
          cssomNames.add(node.name.text);
        }
      }
      // const x = document.styleSheets[0] carries no annotation, so the initializer
      // is what identifies it.
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        if (/styleSheets|CSSStyleSheet|adoptedStyleSheets|createElement\(\s*["']style["']\s*\)/.test(node.initializer.getText(sourceFile))) {
          cssomNames.add(node.name.text);
        }
      }
      ts.forEachChild(node, collectTypes);
    };
    collectTypes(sourceFile);
    const isCssomReceiver = (receiver: string) =>
      cssomNames.has(receiver) || /styleSheets|CSSStyleSheet|adoptedStyleSheets/.test(receiver);

    const visit = (node: import("typescript").Node): void => {
      if (ts.isPropertyAssignment(node)) {
        let name = "";
        if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) name = node.name.text;
        // { ["borderRadius"]: "999px" } carries the same meaning through a
        // computed key (audit wp2c2-F1).
        else if (ts.isComputedPropertyName(node.name)) {
          const key = node.name.expression;
          if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) name = key.text;
        }
        if (isRadiusName(name)) hits.push({ file: rel, text: name + ": " + node.initializer.getText(sourceFile) });
      }
      // const borderRadius = "999px"; { borderRadius } is the shorthand form of the
      // same assignment and reaches the DOM identically.
      if (ts.isShorthandPropertyAssignment(node) && isRadiusName(node.name.text)) {
        hits.push({ file: rel, text: node.name.text + ": (shorthand)" });
      }
      // Any CSSOM entry point, regardless of where the CSS string was built. The
      // earlier text-proximity check missed a rule hoisted into a variable first
      // (audit wp2c2-F2), and a file-wide exemption let the allowlisted file inject
      // anything at all (audit wp2c3-F1), so the allowlist pins the exact text of
      // the one permitted write.
      //
      // insertRule, addRule, and replaceSync exist only on stylesheets, so they are
      // refused outright: a receiver-name heuristic is bypassed by any alias such as
      // const x = document.styleSheets[0] (audit wp2c4-F1). replace and textContent
      // collide with String.prototype.replace and ordinary element text, so those
      // two consult the declared CSSOM types collected above rather than guessing
      // from the receiver's name.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = node.expression.expression.getText(sourceFile);
        if (CSS_INJECTION_APIS.has(method)) {
          cssWrites.push({ file: rel, text: node.getText(sourceFile).replace(/\s+/g, " ") });
        } else if (method === "replace" && isCssomReceiver(receiver)) {
          cssWrites.push({ file: rel, text: node.getText(sourceFile).replace(/\s+/g, " ") });
        }
        // A style element is the other way to install CSS, and naming it anything
        // defeats a receiver test, so the creation itself is what gets refused.
        if (
          method === "createElement" &&
          node.arguments.length > 0 &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          node.arguments[0].text.toLowerCase() === "style"
        ) {
          cssWrites.push({ file: rel, text: node.getText(sourceFile).replace(/\s+/g, " ") });
        }
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "CSSStyleSheet") {
        cssWrites.push({ file: rel, text: "new CSSStyleSheet()" });
      }
      // cssText always installs CSS. textContent and innerHTML are only a CSS sink
      // on a style element, which the declared-type set identifies.
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isPropertyAccessExpression(node.left)
      ) {
        const sink = node.left.name.text;
        const receiver = node.left.expression.getText(sourceFile);
        if (sink === "cssText" || ((sink === "textContent" || sink === "innerHTML") && isCssomReceiver(receiver))) {
          cssWrites.push({ file: rel, text: node.getText(sourceFile).replace(/\s+/g, " ") });
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === "adoptedStyleSheets") {
        cssWrites.push({ file: rel, text: node.getText(sourceFile).replace(/\s+/g, " ") });
      }
      // Stylesheets outside ui/src never reach the manifest. A bare specifier is a
      // package path, so joining it onto the importer's directory made
      // "evil-package/style.css" resolve inside ui/src and pass (audit wp2c4-F2).
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = node.moduleSpecifier.text;
        if (target.endsWith(".css")) {
          if (target.startsWith("./") || target.startsWith("../")) {
            const resolved = normalize(join(dirname(file), target));
            assert.ok(
              resolved.startsWith("ui/src/"),
              "CSS imports must stay inside ui/src: " + rel + " -> " + target,
            );
          } else {
            assert.ok(
              VENDOR_CSS_ALLOWED.has(target),
              "package CSS must be allowlisted: " + rel + " -> " + target,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    assert.ok(
      !/setProperty\(\s*["'`](--r-|border[a-zA-Z-]*radius)/i.test(source),
      "radius must not be set from script: " + rel,
    );
  }

  const allowedWrites = [...CSS_WRITES_ALLOWED.values()].reduce((n, list) => n + list.length, 0);
  assert.equal(
    cssWrites.length,
    allowedWrites,
    "unexpected CSS injection in TS/TSX: " + JSON.stringify(cssWrites),
  );
  for (const write of cssWrites) {
    const permitted = CSS_WRITES_ALLOWED.get(write.file) ?? [];
    assert.ok(
      permitted.includes(write.text),
      "CSS injection not allowlisted in " + write.file + ": " + write.text,
    );
  }
  assert.equal(hits.length, ALLOWED.size, "unexpected radius properties in TS/TSX: " + JSON.stringify(hits));
  for (const hit of hits) {
    assert.equal(ALLOWED.get(hit.file), hit.text, "radius property not allowlisted in " + hit.file);
  }
});

test("no Tailwind rounded utility generates radius outside the manifest", () => {
  // index.css pulls in Tailwind, so a rounded-* class would emit radius CSS the
  // source manifest never parsed (audit wp2c2-F3). Scanning raw source text also
  // failed on the word "rounded" in a comment or a sentence (audit wp2c3-F3), so
  // this reads className/class values out of the AST instead. None exist today.
  const ts = require("../ui/node_modules/typescript") as typeof import("typescript");
  const ROUNDED = /(^|\s)rounded(-(none|full|sm|md|lg|xl|2xl|3xl|[trbl][a-z]*(-[a-z0-9]+)?))?(\s|$)/;

  for (const file of tsFiles()) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const rel = normalize(file);
    const check = (value: string, where: string) => {
      assert.ok(
        !ROUNDED.test(value),
        "use the radius scale instead of a Tailwind rounded utility: " + rel + " (" + where + ")",
      );
    };
    const visit = (node: import("typescript").Node): void => {
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && /^class(Name)?$/.test(node.name.text)) {
        const initializer = node.initializer;
        if (initializer && ts.isStringLiteral(initializer)) check(initializer.text, "className");
        else if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
          // Covers template literals and conditional class assembly.
          for (const literal of initializer.expression.getText(sourceFile).match(/["'`]([^"'`]*)["'`]/g) ?? []) {
            check(literal.slice(1, -1), "className expression");
          }
        }
      }
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        /^class(Name)?$/.test(node.name.text) &&
        ts.isStringLiteralLike(node.initializer)
      ) {
        check(node.initializer.text, "class property");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
});

test("no raw px or bare-number radius survives in CSS", () => {
  for (const decl of radiusDecls()) {
    if (decl.prop !== "border-radius") continue;
    const allowed = /^(0|inherit|[\d.]+%|(\d+(\.\d+)?% ?)+|0 0 0 0)$/.test(decl.value) || decl.value.includes("var(--r-");
    assert.ok(allowed, "off-scale radius value at " + decl.file + ":" + decl.line + ": " + decl.value);
    assert.ok(
      !/(^|\s)\d+(\.\d+)?px/.test(decl.value),
      "raw px radius at " + decl.file + ":" + decl.line + ": " + decl.value,
    );
  }
});
