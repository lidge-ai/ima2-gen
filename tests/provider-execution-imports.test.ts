import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";
import {
  EXECUTION_CALLERS, collectCallArguments, collectReturnedFields, collectRuntimeEdges, forbiddenExecutionEdges, inspectExecutionCaller,
} from "./_executionImportEdges.mjs";

const caller = "lib/generatePipeline.ts";
const owner = "./responsesImageAdapter.js";
const seam = 'import { prepareImageExecution as prepare } from "./providers/execution/index.js";';

test("exactly four production callers prepare and execute through the public seam", () => {
  assert.deepEqual(EXECUTION_CALLERS, [
    "lib/generatePipeline.ts", "lib/nodeGeneration.ts", "lib/multimodePipeline.ts", "routes/edit.ts",
  ]);
  for (const file of EXECUTION_CALLERS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const result = inspectExecutionCaller(source, file);
    assert.deepEqual(result.forbiddenEdges, [], `${file}: concrete runtime edge`);
    assert.ok(result.prepareCalls > 0, `${file}: missing actual public prepare call`);
    assert.ok(result.executeCalls > 0, `${file}: missing execute on prepared result`);
  }
});

test("all runtime import and reexport forms are detected, including aliases and mixed types", () => {
  for (const statement of [
    `import { generateViaResponses as renamed } from "${owner}";`,
    `import * as adapter from "${owner}";`, `import adapter from "${owner}";`,
    `import "${owner}";`, `import {} from "${owner}";`,
    `import { type Options, generateViaResponses as run } from "${owner}";`,
    `import adapter, { type Options } from "${owner}";`,
    `const adapter = await import("${owner}");`,
    `const adapter = await import(\`${owner}\`);`,
    `export { generateViaResponses as renamed } from "${owner}";`,
    `export { type Options, generateViaResponses } from "${owner}";`,
    `export * from "${owner}";`, `export * as adapter from "${owner}";`,
    `export {} from "${owner}";`, `import adapter = require("${owner}");`,
  ]) {
    assert.equal(forbiddenExecutionEdges(statement, caller).length, 1, statement);
  }
});

test("every concrete owner and private legacy module is forbidden for every caller", () => {
  const owners = [
    "responsesImageAdapter", "grokImageAdapter", "grokMultimodeAdapter", "grokImageCore",
    "agyImageAdapter", "geminiApiImageAdapter", "atlasCloudImageAdapter",
    "minimaxImageAdapter", "naiImageAdapter", "comfyImageAdapter", "api88/imageTransport",
    "providers/execution/legacy", "providers/execution/legacyClassic",
    "providers/execution/legacyNode", "providers/execution/legacyEdit", "providers/execution/legacyMultimode",
    "providers/adapters/openaiExecution", "providers/adapters/openaiOperations", "responsesTransport",
    "providers/adapters/grokExecution", "providers/adapters/grokOperations", "providers/adapters/grokMultimodeOperations",
    "grokImagePlanner", "grokImageDownload", "grokImageDownloadPolicy",
    "providers/adapters/googleExecution", "providers/adapters/agyOperations", "providers/adapters/geminiOperations",
    "agyProcess", "agyArtifact",
    "providers/adapters/nai", "providers/adapters/minimax", "providers/adapters/atlascloud", "providers/adapters/88api", "providers/adapters/comfy",
  ];
  for (const file of EXECUTION_CALLERS) for (const name of owners) for (const ext of ["js", "ts"]) {
    const prefix = file.startsWith("routes/") ? "../lib/" : "./";
    const source = `import { run as alias } from "${prefix}unused/../${name}.${ext}";`;
    assert.equal(forbiddenExecutionEdges(source, file).length, 1, `${file}: ${source}`);
  }
});

test("genuine type-only edges, policy helpers and internal execution imports are permitted", () => {
  for (const source of [
    `import type { Options } from "${owner}";`, `import type * as T from "${owner}";`,
    `import type Options from "${owner}";`, `import type T = require("${owner}");`,
    `import { type Options as T } from "${owner}";`,
    `export type * from "${owner}";`, `export type { Options } from "${owner}";`,
    `export { type Options } from "${owner}";`,
    `type T = import("${owner}").Options;`, `type T = typeof import("${owner}");`,
  ]) assert.deepEqual(collectRuntimeEdges(source, caller), [], source);
  for (const name of ["providers/derive", "naiOptions", "refs", "generationErrors", "inflight", "providers/execution/index", "providers/execution/admission"]) {
    assert.deepEqual(forbiddenExecutionEdges(`import * as helper from "./${name}.js";`, caller), []);
  }
  const internal = 'import { generateViaGrok } from "./grokOperations.js";';
  assert.equal(collectRuntimeEdges(internal, "lib/providers/adapters/grokExecution.ts").length, 1);
  assert.deepEqual(forbiddenExecutionEdges(internal, "lib/providers/adapters/grokExecution.ts"), []);
});

const legacyOwners = ["legacy", "legacyClassic", "legacyNode", "legacyEdit", "legacyMultimode"]
  .map((name) => `lib/providers/execution/${name}.ts`);
const openaiOwners = [
  "lib/providers/adapters/openaiExecution.ts", "lib/providers/adapters/openaiOperations.ts",
  "lib/responsesTransport.ts",
];
const grokOwners = [
  "lib/providers/adapters/grokExecution.ts", "lib/providers/adapters/grokOperations.ts",
  "lib/providers/adapters/grokMultimodeOperations.ts", "lib/grokImagePlanner.ts",
  "lib/grokImageCore.ts", "lib/grokImageDownload.ts", "lib/grokImageDownloadPolicy.ts",
];
const googleOwners = [
  "lib/providers/adapters/googleExecution.ts", "lib/providers/adapters/agyOperations.ts",
  "lib/providers/adapters/geminiOperations.ts", "lib/agyProcess.ts", "lib/agyArtifact.ts",
];

const adapterExecutionOwners = [
  "lib/providers/adapters/nai.ts", "lib/providers/adapters/minimax.ts",
  "lib/providers/adapters/atlascloud.ts", "lib/providers/adapters/88api.ts", "lib/providers/adapters/comfy.ts",
];

test("actual internal family, adapter and legacy owners contain no forbidden runtime edges", () => {
  for (const file of [...legacyOwners, ...openaiOwners, ...grokOwners, ...googleOwners, ...adapterExecutionOwners]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.deepEqual(forbiddenExecutionEdges(source, file), [], file);
  }
});

test("Google owner policy rejects facade cycles, cross-family access and upward runtime edges", () => {
  for (const file of [...legacyOwners, ...openaiOwners, ...grokOwners, ...googleOwners]) {
    const targets = ["lib/agyImageAdapter", "lib/geminiApiImageAdapter"];
    if (!googleOwners.includes(file)) targets.push(...googleOwners.map((path) => path.replace(/\.ts$/, "")));
    else targets.push("lib/providers/execution/index", "lib/providers/execution/legacyNode", "routes/edit",
      "lib/providers/adapters/openaiOperations", "lib/providers/adapters/grokOperations");
    if (file === "lib/agyProcess.ts") targets.push("lib/agyArtifact", "lib/providers/adapters/agyOperations");
    if (file === "lib/agyArtifact.ts") targets.push("lib/providers/adapters/agyOperations");
    if (file === "lib/providers/adapters/geminiOperations.ts") targets.push("lib/providers/adapters/googleExecution", "lib/agyProcess");
    for (const target of targets) for (const ext of ["js", "ts", "mjs", "mts"]) {
      const specifier = `./${posix.relative(posix.dirname(file), `${target}.${ext}`)}`;
      for (const statement of [
        `import { run as alias } from "${specifier}";`, `export * from "${specifier}";`,
        `const run = await import("${specifier}");`, `const run = await import(\`${specifier}\`);`,
        `import { type Options, run } from "${specifier}";`,
      ]) assert.equal(forbiddenExecutionEdges(statement, file).length, 1, `${file}: ${statement}`);
      assert.deepEqual(forbiddenExecutionEdges(`import type { Options } from "${specifier}";`, file), []);
    }
  }
});

test("Grok owner policy rejects facade cycles, legacy access and upward edges in every runtime form", () => {
  for (const file of [...legacyOwners, ...grokOwners, ...openaiOwners]) {
    const targets = ["lib/grokImageAdapter", "lib/grokMultimodeAdapter"];
    if (legacyOwners.includes(file)) targets.push(...grokOwners.map((path) => path.replace(/\.ts$/, "")));
    if (grokOwners.includes(file)) targets.push("lib/providers/execution/index", "routes/edit");
    if (file === "lib/grokImageDownload.ts") targets.push("lib/grokImageCore", "lib/grokImagePlanner");
    if (file === "lib/grokImagePlanner.ts") targets.push("lib/providers/adapters/grokOperations");
    for (const target of targets) for (const ext of ["js", "ts", "mjs", "mts"]) {
      const specifier = `./${posix.relative(posix.dirname(file), `${target}.${ext}`)}`;
      for (const statement of [
        `import { run as alias } from "${specifier}";`, `export * from "${specifier}";`,
        `const run = await import("${specifier}");`, `const run = await import(\`${specifier}\`);`,
        `import { type Options, run } from "${specifier}";`,
      ]) {
        const edges = forbiddenExecutionEdges(statement, file);
        assert.equal(edges.length, 1, `${file}: ${statement}`);
        assert.equal(edges[0].target, target);
      }
      assert.deepEqual(forbiddenExecutionEdges(`import type { Options } from "${specifier}";`, file), []);
    }
  }
});

test("internal forbidden edges reject aliases, reexports and literal dynamic imports", () => {
  for (const file of [...legacyOwners, ...openaiOwners]) {
    const targets = ["lib/responsesImageAdapter", ...(legacyOwners.includes(file)
      ? openaiOwners.map((owner) => owner.replace(/\.ts$/, "")) : [])];
    if (file === "lib/responsesTransport.ts") targets.push(
      "lib/providers/execution/index", "lib/providers/adapters/openaiExecution",
      "lib/providers/adapters/openaiOperations", "routes/edit", "routes/generate",
    );
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const target of targets) for (const ext of ["js", "ts", "mjs", "mts"]) {
      const specifier = `${file === "lib/responsesTransport.ts" ? "../" : "../../../"}unused/../${target}.${ext}`;
      for (const statement of [
        `import { run as alias } from "${specifier}";`,
        `export * from "${specifier}";`, `const run = await import("${specifier}");`,
        `const run = await import(\`${specifier}\`);`,
        `import { type Options, run } from "${specifier}";`,
      ]) {
        const edges = forbiddenExecutionEdges(`${source}\n${statement}`, file);
        assert.equal(edges.length, 1, `${file}: ${statement}`);
        assert.equal(edges[0].target, target);
      }
      assert.deepEqual(forbiddenExecutionEdges(`import type { Options } from "${specifier}";`, file), []);
    }
  }
});

test("the actual public-family-operation-transport and compatibility edges remain allowed", () => {
  for (const [file, target] of [
    ["lib/providers/execution/index.ts", "lib/providers/adapters/openaiExecution"],
    ["lib/providers/adapters/openaiExecution.ts", "lib/providers/adapters/openaiOperations"],
    ["lib/providers/adapters/openaiOperations.ts", "lib/responsesTransport"],
    ["lib/responsesImageAdapter.ts", "lib/providers/adapters/openaiOperations"],
    ["lib/providers/execution/index.ts", "lib/providers/adapters/grokExecution"],
    ["lib/providers/adapters/grokExecution.ts", "lib/providers/adapters/grokOperations"],
    ["lib/providers/adapters/grokExecution.ts", "lib/providers/adapters/grokMultimodeOperations"],
    ["lib/providers/adapters/grokExecution.ts", "lib/grokImagePlanner"],
    ["lib/providers/adapters/grokOperations.ts", "lib/grokImagePlanner"],
    ["lib/providers/adapters/grokOperations.ts", "lib/grokImageCore"],
    ["lib/providers/adapters/grokMultimodeOperations.ts", "lib/grokImagePlanner"],
    ["lib/providers/adapters/grokMultimodeOperations.ts", "lib/grokImageCore"],
    ["lib/grokImagePlanner.ts", "lib/grokImageCore"],
    ["lib/grokImagePlanner.ts", "lib/grokUpstreamRetry"],
    ["lib/grokImageCore.ts", "lib/grokImageDownload"],
    ["lib/grokImageDownload.ts", "lib/grokImageDownloadPolicy"],
    ["lib/grokImageDownload.ts", "lib/grokUpstreamRetry"],
    ["lib/grokImageAdapter.ts", "lib/grokImagePlanner"],
    ["lib/grokImageAdapter.ts", "lib/providers/adapters/grokOperations"],
    ["lib/grokMultimodeAdapter.ts", "lib/providers/adapters/grokMultimodeOperations"],
    ["lib/providers/execution/index.ts", "lib/providers/adapters/googleExecution"],
    ["lib/providers/adapters/googleExecution.ts", "lib/providers/adapters/agyOperations"],
    ["lib/providers/adapters/googleExecution.ts", "lib/providers/adapters/geminiOperations"],
    ["lib/providers/adapters/agyOperations.ts", "lib/agyProcess"],
    ["lib/providers/adapters/agyOperations.ts", "lib/agyArtifact"],
    ["lib/agyArtifact.ts", "lib/agyProcess"],
    ["lib/agyImageAdapter.ts", "lib/providers/adapters/agyOperations"],
    ["lib/agyImageAdapter.ts", "lib/agyArtifact"],
    ["lib/geminiApiImageAdapter.ts", "lib/providers/adapters/geminiOperations"],
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const edges = collectRuntimeEdges(source, file).filter((edge) => edge.target === target);
    assert.equal(edges.length, 1, `${file}: missing actual edge to ${target}`);
    assert.deepEqual(forbiddenExecutionEdges(source, file), [], file);
  }
});

test("function-scoped calls select the unique helper and include nested callbacks only within it", () => {
  const source = `
    function classic() { return () => run("classic", { signal }); }
    async function node() {
      // run("comment"); function classic() {}
      const example = 'run("string"); function classic() {}';
      return run("node", { onFinalImage: async () => run("callback") });
    }
    run("outside");`;
  assert.deepEqual(collectCallArguments(source, caller, "run", "classic"), [['"classic"', "{ signal }"]]);
  const nodeCalls = collectCallArguments(source, caller, "run", "node");
  assert.equal(nodeCalls.length, 2);
  assert.equal(nodeCalls[0][0], '"node"');
  assert.deepEqual(nodeCalls[1], ['"callback"']);
  assert.equal(collectCallArguments(source, caller, "run").length, 4);
  assert.deepEqual(collectCallArguments(source, caller, "absent", "classic"), []);
});

test("missing, duplicate or bodyless function scopes cannot silently pass", () => {
  for (const source of [
    'function other() { run("outside"); }',
    'const wanted = () => run("arrow");',
    'function wanted() {} function outer() { function wanted() { run("nested"); } }',
    'declare function wanted(): void;',
    'function wanted(): void; function wanted() { run("implementation"); }',
    '// function wanted() {}\nconst text = "function wanted() {}";',
  ]) assert.throws(() => collectCallArguments(source, caller, "run", "wanted"), /expected exactly one function body for wanted/);
});

test("returned-field oracle reads executable return properties, not comments or unrelated values", () => {
  const source = 'function input(r) { const fake = { prompt: "unused" }; /* return { prompt: "comment" } */ return { prompt: r.prompt }; }';
  assert.deepEqual(collectReturnedFields(source, caller, "input", "prompt"), ["r.prompt"]);
  assert.deepEqual(collectReturnedFields(source, caller, "input", "absent"), []);
  assert.throws(() => collectReturnedFields(source, caller, "missing", "prompt"), /exactly one function body/);
  assert.deepEqual(collectReturnedFields(source.replace('return { prompt: r.prompt }', 'return { prompt: r.rawPrompt }'), caller, "input", "prompt"), ["r.rawPrompt"]);
});

test("returned-field oracle excludes nested function scopes and exposes shorthand expressions", () => {
  for (const nested of [
    'function unrelated() { return { prompt: r.prompt }; }',
    'const unrelated = () => { return { prompt: r.prompt }; };',
    'const unrelated = { method() { return { prompt: r.prompt }; } };',
    'class Unrelated { method() { return { prompt: r.prompt }; } }',
  ]) {
    const source = `function input(r) { ${nested} const prompt = r.rawPrompt; return { prompt }; }`;
    assert.deepEqual(collectReturnedFields(source, caller, "input", "prompt"), ["prompt"]);
    assert.notDeepEqual(collectReturnedFields(source, caller, "input", "prompt"), ["r.prompt"]);
  }
});

test("comments and strings cannot fake edges or execution activation", () => {
  const source = `${seam}
    // prepare(ctx, request); execution.execute(); import "${owner}";
    const example = 'prepare(ctx, request); execution.execute(); import "${owner}";';`;
  assert.deepEqual(inspectExecutionCaller(source, caller), { forbiddenEdges: [], prepareCalls: 0, executeCalls: 0 });
  assert.deepEqual(collectCallArguments(source, caller, "prepare"), []);
  assert.deepEqual(collectCallArguments('run(prompt, { /* references: bad */ model, ...options });', caller, "run"), [
    ["prompt", "{ model, ...options }"],
  ]);
});

test("prepare and execute must be linked to the real import and prepared binding", () => {
  for (const body of [
    "const execution = await prepare(ctx, request); await execution.execute();",
    "await (await prepare(ctx, request)).execute();",
    'const execution = await prepare(ctx, request); await execution["execute"]();',
  ]) {
    const result = inspectExecutionCaller(`${seam} async function run() { ${body} }`, caller);
    assert.equal(result.prepareCalls, 1, body);
    assert.equal(result.executeCalls, 1, body);
  }
  const namespace = 'import * as seam from "./providers/execution/index.ts"; await (await seam.prepareImageExecution(ctx, request)).execute();';
  assert.equal(inspectExecutionCaller(namespace, caller).executeCalls, 1);
  for (const body of [
    "const execution = await prepare(ctx, request); await unrelated.execute();",
    "const execution = await prepare(ctx, request); function shadow(execution) { execution.execute(); }",
    "function shadow(prepare) { const execution = prepare(ctx, request); execution.execute(); }",
    "const execution = await prepare(ctx, request); void execution.execute;",
  ]) assert.equal(inspectExecutionCaller(`${seam} ${body}`, caller).executeCalls, 0, body);
  assert.equal(inspectExecutionCaller("function prepareImageExecution() {} prepareImageExecution(ctx, request);", caller).prepareCalls, 0);
});

test("in-memory caller mutations cannot pass by retaining imports or comments", () => {
  for (const file of EXECUTION_CALLERS) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const prefix = file.startsWith("routes/") ? "../lib/" : "./";
    const bypass = `${source}\nexport { generateViaResponses as hidden } from "${prefix}responsesImageAdapter.ts";`;
    assert.equal(inspectExecutionCaller(bypass, file).forbiddenEdges.length, 1, file);
    const withoutExecute = source.replace(/\.execute\s*\(/g, ".notExecute(");
    assert.notEqual(withoutExecute, source, `${file}: mutation must activate`);
    const result = inspectExecutionCaller(`${withoutExecute}\n// execution.execute()`, file);
    assert.ok(result.prepareCalls > 0, `${file}: preserve the real prepare call`);
    assert.equal(result.executeCalls, 0, `${file}: import/prepare alone must not pass`);
    const withoutPublicBinding = source.replace(/\bprepareImageExecution\b/g, "unrelatedPrepare");
    assert.notEqual(withoutPublicBinding, source, `${file}: prepare mutation must activate`);
    assert.equal(inspectExecutionCaller(withoutPublicBinding, file).prepareCalls, 0, file);
  }
});

test("adapter execution owners reject upward, legacy and cross-family runtime edges", () => {
  for (const file of adapterExecutionOwners) {
    for (const target of [
      "lib/providers/execution/index", "routes/edit", "lib/responsesImageAdapter",
      ...legacyOwners.map((path) => path.replace(/\.ts$/, "")),
      ...openaiOwners.map((path) => path.replace(/\.ts$/, "")),
      ...grokOwners.map((path) => path.replace(/\.ts$/, "")),
      ...googleOwners.map((path) => path.replace(/\.ts$/, "")),
    ]) {
      const specifier = `./${posix.relative(posix.dirname(file), `${target}.js`)}`;
      for (const source of [
        `import { run as alias } from "${specifier}";`,
        `export * from "${specifier}";`, `const run = await import("${specifier}");`,
      ]) {
        const edges = forbiddenExecutionEdges(source, file);
        assert.equal(edges.length, 1, `${file}: ${source}`);
        assert.equal(edges[0].target, target);
      }
      assert.deepEqual(forbiddenExecutionEdges(`import type { Options } from "${specifier}";`, file), []);
    }
  }
});

test("callers cannot bypass the execution seam through lane adapters", () => {
  for (const file of EXECUTION_CALLERS) for (const target of adapterExecutionOwners) {
    const specifier = `./${posix.relative(posix.dirname(file), target.replace(/\.ts$/, ".js"))}`;
    const source = `import { createNaiAdapter as bypass } from "${specifier}";`;
    const edges = forbiddenExecutionEdges(source, file);
    assert.equal(edges.length, 1, `${file}: ${source}`);
    assert.equal(edges[0].target, target.replace(/\.ts$/, ""));
  }
});
