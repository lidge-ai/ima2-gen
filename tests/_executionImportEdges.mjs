import ts from "typescript";
import { posix } from "node:path";

export const EXECUTION_CALLERS = Object.freeze([
  "lib/generatePipeline.ts", "lib/nodeGeneration.ts",
  "lib/multimodePipeline.ts", "routes/edit.ts",
]);
const concreteOwners = new Set([
  "responsesImageAdapter", "grokImageAdapter", "grokMultimodeAdapter", "grokImageCore",
  "agyImageAdapter", "geminiApiImageAdapter", "atlasCloudImageAdapter",
  "minimaxImageAdapter", "naiImageAdapter", "comfyImageAdapter", "api88/imageTransport",
].map((name) => `lib/${name}`));
const publicOwner = "lib/providers/execution/index";
const facadeOwner = "lib/responsesImageAdapter";
const openaiOwners = new Set([
  "lib/providers/adapters/openaiExecution", "lib/providers/adapters/openaiOperations",
  "lib/responsesTransport",
]);
const grokFacades = new Set(["lib/grokImageAdapter", "lib/grokMultimodeAdapter"]);
const grokEdges = new Map([
  ["lib/providers/adapters/grokExecution", ["lib/providers/adapters/grokOperations", "lib/providers/adapters/grokMultimodeOperations", "lib/grokImagePlanner", "lib/grokImageCore"]],
  ["lib/providers/adapters/grokOperations", ["lib/grokImagePlanner", "lib/grokImageCore", "lib/grokImageDownload"]],
  ["lib/providers/adapters/grokMultimodeOperations", ["lib/grokImagePlanner", "lib/grokImageCore", "lib/grokImageDownload"]],
  ["lib/grokImagePlanner", ["lib/grokImageCore", "lib/grokUpstreamRetry"]],
  ["lib/grokImageCore", ["lib/grokImageDownload"]],
  ["lib/grokImageDownload", ["lib/grokImageDownloadPolicy", "lib/grokUpstreamRetry"]],
  ["lib/grokImageDownloadPolicy", []],
]);
const grokOwners = new Set(grokEdges.keys());
const googleFacades = new Set(["lib/agyImageAdapter", "lib/geminiApiImageAdapter"]);
const googleEdges = new Map([
  ["lib/providers/adapters/googleExecution", ["lib/providers/adapters/agyOperations", "lib/providers/adapters/geminiOperations"]],
  ["lib/providers/adapters/agyOperations", ["lib/agyProcess", "lib/agyArtifact"]],
  ["lib/providers/adapters/geminiOperations", []],
  ["lib/agyArtifact", ["lib/agyProcess"]],
  ["lib/agyProcess", []],
]);
const googleOwners = new Set(googleEdges.keys());
const adapterExecutionOwners = new Set([
  "lib/providers/adapters/nai", "lib/providers/adapters/minimax",
  "lib/providers/adapters/atlascloud", "lib/providers/adapters/88api", "lib/providers/adapters/comfy",
]);
const isLegacyOwner = (target) => /^lib\/providers\/execution\/legacy[^/]*$/.test(target);

export function normalizeModulePath(file, specifier) {
  const target = specifier.startsWith(".")
    ? posix.join(posix.dirname(file.replaceAll("\\", "/")), specifier)
    : specifier;
  return posix.normalize(target).replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

function parse(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (tree.parseDiagnostics.length) throw new Error(`Invalid TypeScript fixture: ${file}`);
  return tree;
}

function walkRuntime(node, visit) {
  if (ts.isTypeNode(node)) return;
  visit(node);
  ts.forEachChild(node, (child) => walkRuntime(child, visit));
}

function hasRuntimeImport(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.length === 0
    || clause.namedBindings.elements.some((item) => !item.isTypeOnly);
}

function hasRuntimeExport(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return true;
  return node.exportClause.elements.length === 0
    || node.exportClause.elements.some((item) => !item.isTypeOnly);
}

function runtimeEdges(tree, file) {
  const edges = [];
  const add = (literal, kind) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    edges.push({ kind, specifier: literal.text, target: normalizeModulePath(file, literal.text) });
  };
  walkRuntime(tree, (node) => {
    if (ts.isImportDeclaration(node) && hasRuntimeImport(node)) add(node.moduleSpecifier, "import");
    if (ts.isExportDeclaration(node) && hasRuntimeExport(node)) add(node.moduleSpecifier, "export");
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0], "dynamic-import");
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression, "import-equals");
  });
  return edges;
}

export function collectRuntimeEdges(source, file) {
  return runtimeEdges(parse(source, file), file);
}

function functionScope(tree, file, scopeName) {
  if (scopeName === undefined) return tree;
  const declarations = [];
  walkRuntime(tree, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === scopeName) declarations.push(node);
  });
  if (declarations.length !== 1 || !declarations[0].body) {
    throw new Error(`${file}: expected exactly one function body for ${scopeName}; found ${declarations.length} declarations`);
  }
  return declarations[0].body;
}

// Location-migration oracles inspect real calls, never comments or import names.
/** @param {string} [scopeName] */
export function collectCallArguments(source, file, name, scopeName) {
  const tree = parse(source, file);
  const scope = functionScope(tree, file, scopeName);
  const printer = ts.createPrinter({ removeComments: true });
  const calls = [];
  walkRuntime(scope, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      calls.push(node.arguments.map((arg) => printer.printNode(ts.EmitHint.Expression, arg, tree)));
    }
  });
  return calls;
}

export function collectReturnedFields(source, file, scopeName, field) {
  const tree = parse(source, file);
  const scope = functionScope(tree, file, scopeName);
  const printer = ts.createPrinter({ removeComments: true });
  const values = [];
  function visit(node) {
    if (ts.isTypeNode(node) || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      for (const property of node.expression.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
        if ((ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === field) {
          const expression = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
          values.push(printer.printNode(ts.EmitHint.Expression, expression, tree));
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(scope);
  return values;
}

export function forbiddenExecutionEdges(source, file) {
  // E7 source gate: computed imports and arbitrary external barrels remain outside this policy.
  const owner = normalizeModulePath(file, file);
  return collectRuntimeEdges(source, file).filter(({ target }) => {
    if (EXECUTION_CALLERS.includes(file)) {
      return concreteOwners.has(target) || openaiOwners.has(target) || grokOwners.has(target)
        || googleOwners.has(target) || isLegacyOwner(target) || adapterExecutionOwners.has(target);
    }
    if (adapterExecutionOwners.has(owner)) {
      return target === facadeOwner || target === publicOwner || isLegacyOwner(target)
        || openaiOwners.has(target) || grokOwners.has(target) || googleOwners.has(target)
        || target.startsWith("routes/");
    }
    if (isLegacyOwner(owner)) return target === facadeOwner || openaiOwners.has(target)
      || grokFacades.has(target) || grokOwners.has(target) || googleFacades.has(target) || googleOwners.has(target);
    if (googleOwners.has(owner)) {
      return concreteOwners.has(target) || openaiOwners.has(target) || grokOwners.has(target)
        || target === publicOwner || isLegacyOwner(target) || target.startsWith("routes/")
        || (googleOwners.has(target) && !googleEdges.get(owner).includes(target));
    }
    if (grokOwners.has(owner)) {
      return target === facadeOwner || grokFacades.has(target) || target === publicOwner
        || isLegacyOwner(target) || openaiOwners.has(target) || googleFacades.has(target)
        || googleOwners.has(target) || target.startsWith("routes/")
        || (grokOwners.has(target) && !grokEdges.get(owner).includes(target));
    }
    if (owner === "lib/responsesTransport") {
      return target === publicOwner || openaiOwners.has(target) || target.startsWith("routes/")
        || target === facadeOwner || grokFacades.has(target) || googleFacades.has(target) || googleOwners.has(target);
    }
    return openaiOwners.has(owner) && (target === facadeOwner || grokFacades.has(target)
      || googleFacades.has(target) || googleOwners.has(target));
  });
}

// Bind only this source, without resolving dependencies or loading production code.
// Symbols distinguish a genuine import/result from same-name shadowed locals.
function localChecker(tree, file) {
  const host = {
    getSourceFile: (name) => name === file ? tree : undefined,
    getDefaultLibFileName: () => "", writeFile: () => {}, getCurrentDirectory: () => "",
    getDirectories: () => [], fileExists: (name) => name === file,
    readFile: (name) => name === file ? tree.text : undefined,
    getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  return ts.createProgram([file], { noResolve: true, noLib: true }, host).getTypeChecker();
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)
    || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) {
    node = node.expression;
  }
  return node;
}

function member(node, name) {
  if (ts.isPropertyAccessExpression(node) && node.name.text === name) return node.expression;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
    && node.argumentExpression.text === name) return node.expression;
  return undefined;
}

function prepareBindings(tree, file, checker) {
  const named = new Set();
  const namespaces = new Set();
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)
      || normalizeModulePath(file, node.moduleSpecifier.text) !== publicOwner
      || !hasRuntimeImport(node)) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(checker.getSymbolAtLocation(bindings.name));
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (!item.isTypeOnly && (item.propertyName ?? item.name).text === "prepareImageExecution") {
          named.add(checker.getSymbolAtLocation(item.name));
        }
      }
    }
  }
  return { named, namespaces };
}

export function inspectExecutionCaller(source, file) {
  const tree = parse(source, file);
  const checker = localChecker(tree, file);
  const { named, namespaces } = prepareBindings(tree, file, checker);
  const isPrepare = (node) => {
    node = unwrap(node);
    if (!node || !ts.isCallExpression(node) || node.arguments.length < 2) return false;
    const callee = unwrap(node.expression);
    if (ts.isIdentifier(callee)) return named.has(checker.getSymbolAtLocation(callee));
    const receiver = member(callee, "prepareImageExecution");
    return !!receiver && namespaces.has(checker.getSymbolAtLocation(receiver));
  };
  const prepared = new Set();
  let prepareCalls = 0;
  walkRuntime(tree, (node) => {
    if (ts.isCallExpression(node) && isPrepare(node)) prepareCalls++;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isPrepare(node.initializer)) {
      prepared.add(checker.getSymbolAtLocation(node.name));
    }
  });
  let executeCalls = 0;
  walkRuntime(tree, (node) => {
    if (!ts.isCallExpression(node)) return;
    const receiver = member(unwrap(node.expression), "execute");
    if (!receiver) return;
    const value = unwrap(receiver);
    if (isPrepare(value) || (ts.isIdentifier(value) && prepared.has(checker.getSymbolAtLocation(value)))) executeCalls++;
  });
  return { forbiddenEdges: forbiddenExecutionEdges(source, file), prepareCalls, executeCalls };
}
