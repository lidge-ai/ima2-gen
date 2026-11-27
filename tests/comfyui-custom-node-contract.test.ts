import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LEGACY_OPENAI_IMAGE_MODELS } from "../lib/openaiLegacyModels.ts";

const root = process.cwd();
const bridgeDir = "integrations/comfyui/ima2_gen_bridge";

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("ComfyUI custom node contract", () => {
  it("accepts saved legacy models and sends their migrated tiers", () => {
    const script = `
import json, runpy, sys, types
for name in ("numpy", "torch", "PIL"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["PIL"].Image = object()
node = runpy.run_path(sys.argv[1])
models = json.loads(sys.argv[2])
options = node["Ima2Generate"].INPUT_TYPES()["optional"]["model"][0]
assert options == ["", "gpt-6-luna", "gpt-6.1-terra", "gpt-6.2-sol", "gpt-6.2-astra", *models], options
sent = []
generate = node["Ima2Generate"].generate
generate.__globals__["_post_generate"] = lambda url, payload, timeout: sent.append(payload) or {}
generate.__globals__["_decode_data_url_to_tensor"] = lambda image: None
for legacy, expected in models.items():
    node["Ima2Generate"]().generate("draw", server_url="http://127.0.0.1:3333", model=legacy)
    assert sent[-1]["model"] == expected, (legacy, sent[-1])
`;
    const python = process.platform === "win32" ? "python" : "python3";
    const result = spawnSync(python, ["-B", "-c", script, join(root, bridgeDir, "nodes.py"), JSON.stringify(LEGACY_OPENAI_IMAGE_MODELS)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });

  it("ships a loadable ComfyUI node pack", () => {
    assert.ok(existsSync(join(root, bridgeDir, "__init__.py")));
    assert.ok(existsSync(join(root, bridgeDir, "nodes.py")));
    assert.ok(existsSync(join(root, bridgeDir, "README.md")));

    const init = readSource(`${bridgeDir}/__init__.py`);
    assert.match(init, /NODE_CLASS_MAPPINGS/);
    assert.match(init, /NODE_DISPLAY_NAME_MAPPINGS/);
  });

  it("defines the Ima2 Generate node with expected ComfyUI shape", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.match(source, /class Ima2Generate/);
    assert.match(source, /CATEGORY = "ima2-gen"/);
    assert.match(source, /RETURN_TYPES = \("IMAGE", "STRING", "STRING"\)/);
    assert.match(source, /RETURN_NAMES = \("image", "filename", "metadata"\)/);
    assert.match(source, /FUNCTION = "generate"/);
    assert.match(source, /def INPUT_TYPES\(cls\):/);
    assert.match(source, /NODE_CLASS_MAPPINGS = \{/);
    assert.match(source, /"Ima2Generate": Ima2Generate/);
    assert.match(source, /NODE_DISPLAY_NAME_MAPPINGS = \{/);
  });

  it("keeps optional ComfyUI inputs executable without connected links", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.match(source, /server_url=""/);
    assert.match(source, /quality="medium"/);
    assert.match(source, /size="1024x1024"/);
    assert.match(source, /moderation="low"/);
    assert.match(source, /timeout=180/);
    assert.match(source, /model=""/);
    assert.match(source, /mode="auto"/);
    assert.match(source, /web_search=True/);
  });

  it("matches current ima2 image model support", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.match(source, /gpt-6-luna/);
    assert.match(source, /gpt-6\.1-terra/);
    assert.match(source, /gpt-6\.2-sol/);
    assert.match(source, /gpt-6\.2-astra/);
    assert.doesNotMatch(source, /gpt-5\.3-codex-spark/);
  });

  it("calls the existing /api/generate contract safely", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.match(source, /\/api\/generate/);
    assert.match(source, /"X-ima2-client": IMA2_CLIENT_HEADER/);
    assert.match(source, /IMA2_CLIENT_HEADER = "comfyui\/bridge"/);
    assert.match(source, /"n": 1/);
    assert.match(source, /"format": "png"/);
    assert.match(source, /"webSearchEnabled": bool\(web_search\)/);
    assert.doesNotMatch(source, /payload\[[\"']web_search[\"']\]/);
    assert.doesNotMatch(source, /[\"']web_search[\"']:\s*web_search/);
    assert.doesNotMatch(source, /provider['"]?\s*:\s*["']api/);
    assert.match(source, /response\.get\("image"\)/);
    assert.match(source, /response\.get\("filename"\)/);
  });

  it("keeps the node away from credentials and subprocess execution", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.doesNotMatch(source, /subprocess/);
    assert.doesNotMatch(source, /shell=True/);
    assert.doesNotMatch(source, /api_key/i);
    assert.doesNotMatch(source, /OPENAI_API_KEY/);
    assert.doesNotMatch(source, /keychain/i);
    assert.doesNotMatch(source, /token/i);
    assert.doesNotMatch(source, /oauth/i);
  });

  it("validates loopback origins before calling ima2", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.match(source, /ALLOWED_LOOPBACK_HOSTS = \{"127\.0\.0\.1", "localhost", "::1"\}/);
    assert.match(source, /parsed\.scheme != "http"/);
    assert.match(source, /parsed\.username or parsed\.password/);
    assert.match(source, /parsed\.path not in \("", "\/"\)/);
    assert.match(source, /parsed\.query/);
    assert.match(source, /parsed\.fragment/);
    assert.match(source, /hostname not in ALLOWED_LOOPBACK_HOSTS/);
    assert.match(source, /port is None/);
  });

  it("decodes ima2 data URLs to ComfyUI IMAGE tensors", () => {
    const source = readSource(`${bridgeDir}/nodes.py`);
    assert.match(source, /def _decode_data_url_to_tensor/);
    assert.match(source, /base64\.b64decode\(encoded, validate=True\)/);
    assert.match(source, /Image\.open\(BytesIO\(raw\)\)\.convert\("RGB"\)/);
    assert.match(source, /np\.asarray\(image\)\.astype\(np\.float32\) \/ 255\.0/);
    assert.match(source, /torch\.from_numpy\(array\)\[None,\]/);
  });

  it("documents install, prerequisite, security, and scope", () => {
    const readme = readSource(`${bridgeDir}/README.md`);
    assert.match(readme, /ComfyUI\/custom_nodes/);
    assert.match(readme, /ima2 serve/);
    assert.match(readme, /Ima2 Generate/);
    assert.match(readme, /webSearchEnabled/);
    assert.match(readme, /Only loopback HTTP origins are accepted/);
    assert.match(readme, /text-to-image only/i);
  });

  it("keeps the integration included in npm package metadata", () => {
    const pkg = JSON.parse(readSource("package.json"));
    assert.ok(pkg.files.includes("integrations/comfyui/ima2_gen_bridge/__init__.py"));
    assert.ok(pkg.files.includes("integrations/comfyui/ima2_gen_bridge/nodes.py"));
    assert.ok(pkg.files.includes("integrations/comfyui/ima2_gen_bridge/README.md"));
    for (const name of ["media_nodes.py", "ima2_client.py", "ima2_job.py", "pyproject.toml", "LICENSE"]) {
      assert.ok(pkg.files.includes(`integrations/comfyui/ima2_gen_bridge/${name}`), name);
    }
    assert.doesNotMatch(pkg.scripts["lint:pkg"], /'integrations\/'/);
    assert.match(pkg.scripts["lint:pkg"], /integrations\/comfyui\/ima2_gen_bridge\/nodes\.py/);
  });

  it("runs a media job end to end against a stand-in ima2: budget check, upload, wait, cancel", () => {
    const python = process.platform === "win32" ? "python" : "python3";
    const result = spawnSync(python, ["-B", join(root, bridgeDir, "tests", "test_ima2_job.py")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stderr, /Ran \d+ tests[^]*\nOK/);
  });

  it("media nodes take no key, token or server address, and never act as a Comfy partner node", () => {
    const source = readSource(`${bridgeDir}/media_nodes.py`);
    const inputs = [...source.matchAll(/io\.\w+\.Input\("([a-z_]+)"/g)].map((match) => match[1]);
    assert.ok(inputs.includes("model") && inputs.includes("max_usd"));
    // server_url exists only on the original node, kept so saved workflows load; it is loopback-checked there.
    assert.deepEqual(inputs.filter((name) => /key|token|secret|password|server|url|host/.test(name)), ["server_url"]);
    // is_api_node would make ComfyUI hand this pack the user's Comfy account token.
    assert.doesNotMatch(source, /is_api_node/);
    assert.match(source, /hidden=\[io\.Hidden\.unique_id\]/);
    for (const file of ["media_nodes.py", "ima2_client.py", "ima2_job.py", "__init__.py"]) {
      const code = readSource(`${bridgeDir}/${file}`);
      // Comfy Registry standards: no eval or exec, no installing packages at run time, no shelling out.
      assert.doesNotMatch(code, /\beval\(|\bexec\(|subprocess|os\.system|pip install|shell=True/, file);
    }
  });

  it("loads through the V3 entry point when ComfyUI has it and falls back to the original node when it does not", () => {
    const init = readSource(`${bridgeDir}/__init__.py`);
    assert.match(init, /from \.media_nodes import comfy_entrypoint/);
    assert.match(init, /except ImportError:/);
    const media = readSource(`${bridgeDir}/media_nodes.py`);
    assert.match(media, /node_id="Ima2Generate"/, "the original node keeps its id under the V3 entry point");
    for (const id of ["Ima2MediaImage", "Ima2MediaVideo", "Ima2MediaAudio"]) assert.match(media, new RegExp(`node_id="${id}"|"${id}", "ima2`));
  });

  it("is packaged for the Comfy Registry under the agreed names", () => {
    const toml = readSource(`${bridgeDir}/pyproject.toml`);
    assert.match(toml, /^name = "comfyui-ima2"$/m);
    assert.match(toml, /^version = "\d+\.\d+\.\d+"$/m);
    assert.match(toml, /^license = \{ file = "LICENSE" \}$/m);
    assert.match(toml, /^Repository = "https:\/\/github\.com\/lidge-ai\/ima2-gen\/tree\/main\/integrations\/comfyui\/ima2_gen_bridge"$/m);
    assert.match(toml, /^PublisherId = "lidge-ai"$/m);
    assert.match(toml, /^DisplayName = "ima2 for ComfyUI"$/m);
    assert.match(toml, /^dependencies = \[\]$/m);
    assert.equal(readSource(`${bridgeDir}/LICENSE`), readSource("LICENSE"));
  });
});
