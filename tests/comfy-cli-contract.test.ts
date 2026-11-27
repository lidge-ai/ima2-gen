import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("comfy CLI surface", () => {
  const source = read("bin/commands/comfy.ts");

  it("registers every workflow action the docs promise", () => {
    const docs = read("docs/CLI.md");
    for (const action of ["ls", "inspect", "add", "rm"]) {
      assert.match(source, new RegExp(`\\b${action}: workflow`, "i"), `workflow ${action} must be wired`);
      assert.match(docs, new RegExp(`ima2 comfy workflow ${action}`), `workflow ${action} must be documented`);
    }
  });

  it("detects the workflow file format from bytes, not the extension", () => {
    // Someone who saved a ComfyUI PNG as .json should still get a working
    // registration, and a .png that is really JSON must not be mishandled.
    assert.match(source, /89504e470d0a1a0a/, "PNG signature check");
    assert.match(source, /subarray\(0, 8\)\.toString\("hex"\)/);
  });

  it("never resolves an ambiguous binding by guessing, even with --yes", () => {
    // Two CLIPTextEncode nodes is the ordinary shape and nothing in the graph
    // separates positive from negative. A wrong guess swaps the prompts
    // silently and reads later as "the model ignores my prompt".
    const addFn = source.slice(source.indexOf("async function workflowAdd"));
    assert.match(addFn, /unresolved\.length > 0/, "ambiguity must be checked");
    assert.match(addFn, /ambiguous bindings/, "refusal names the fields");
    assert.match(addFn, /workflow inspect/, "refusal points at the inspect command");

    // --yes may only accept candidates that were ALREADY unambiguous: it must
    // not appear in the branch that decides whether unresolved fields block.
    const guard = addFn.slice(addFn.indexOf("const unresolved"), addFn.indexOf("if (!bind.prompt"));
    assert.doesNotMatch(guard, /args\.yes/, "--yes must not bypass ambiguity");
  });

  it("requires an id and a prompt/output binding before it will register", () => {
    assert.match(source, /--id is required/);
    assert.match(source, /a prompt binding and an output node are required/);
  });

  it("supports media kind and points every workflow at the media route that runs it", () => {
    assert.match(source, /--kind image\|video\|audio/);
    assert.match(source, /mediaKind/);
    // A video or audio workflow used to be registered with "not supported yet"; it now runs as comfy/<id>.
    assert.match(source, /run it with: ima2 media run --model \$\{resp\.media\.model\} --task \$\{resp\.media\.task\}/);
    assert.doesNotMatch(source, /catalog-only/);
  });

  it("prints workflow labels and model-level lock status", () => {
    const models = read("bin/commands/models.ts");
    assert.match(models, /label: "label"/);
    assert.match(models, /label: "model-status"/);
    assert.match(models, /item\.executable \? "ready" : "locked"/);
  });
});

describe("comfy CLI docs parity", () => {
  it("lists comfy as a fail-closed lane for gen, and NOT on the legacy surface", () => {
    const docs = read("docs/CLI.md");

    // ima2 gen resolves through the live /api/models catalog, so a registered
    // workflow is selectable there.
    assert.match(docs, /oauth\|api\|grok\|grok-api\|agy\|gemini-api\|atlascloud\|minimax\|nai\|comfy\|runway\|higgsfield/);

    // edit/multimode/node deliberately refuse comfy with
    // COMFY_SURFACE_UNSUPPORTED until wp7, so documenting it on that legacy
    // list would advertise a capability the code rejects.
    const legacy = docs.match(/--provider <auto\|[^>]+>/g) ?? [];
    assert.ok(legacy.length > 0, "the legacy provider list must still be documented");
    for (const entry of legacy) {
      assert.doesNotMatch(entry, /comfy/, "comfy must not appear on a surface that refuses it");
    }
  });

  it("documents every comfy config key the runtime reads", () => {
    const docs = read("docs/CLI.md");
    const config = read("config.ts");
    const block = config.slice(config.indexOf("  comfy: {"), config.indexOf("  dev: {"));
    const keys = [...block.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]);
    assert.ok(keys.length >= 7, `expected the comfy config block, found ${keys.length} keys`);
    for (const key of keys) {
      assert.match(docs, new RegExp(`comfy\\.\\{[^}]*\\b${key}\\b`), `comfy.${key} must be documented`);
    }
  });
});
