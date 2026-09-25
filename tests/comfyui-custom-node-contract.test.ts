import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const bridgeDir = "integrations/comfyui/ima2_gen_bridge";

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("ComfyUI custom node contract", () => {
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
    assert.match(source, /gpt-5\.5/);
    assert.match(source, /gpt-5\.4/);
    assert.match(source, /gpt-5\.4-mini/);
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
    assert.doesNotMatch(pkg.scripts["lint:pkg"], /'integrations\/'/);
    assert.match(pkg.scripts["lint:pkg"], /integrations\/comfyui\/ima2_gen_bridge\/nodes\.py/);
  });
});
