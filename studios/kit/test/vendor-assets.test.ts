import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const expectedIds = [
  'bytedance', 'alibaba', 'tencent', 'kling', 'minimax', 'vidu', 'google',
  'openai', 'xai', 'meta', 'black-forest-labs', 'ideogram', 'recraft',
  'pixverse', 'heygen', 'sand-ai', 'veed', 'meigen', 'sync', 'topaz-labs',
  'mirelo', 'elevenlabs', 'cartesia', 'stability-ai', 'ace-step', 'tripo',
  'meshy', 'higgsfield', 'byteplus', 'fal', 'replicate', 'atlascloud', 'sume',
];
const assets = join(dirname(fileURLToPath(import.meta.url)), '../assets/vendors');
type Asset = { file: string; variant: string; format: string };
type Vendor = { id: string; files: Asset[]; missing?: string };
const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8')) as {
  vendors: Vendor[];
};

// Node has no built-in XML parser. This test uses Python's standard library.
const checkSvg = `
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
assert root.tag in ('svg', '{http://www.w3.org/2000/svg}svg'), 'root is not svg'
assert root.get('viewBox') or (root.get('width') and root.get('height')), 'missing dimensions'
for el in root.iter():
    assert el.tag.split('}')[-1].lower() != 'script', 'script element'
    for key, value in el.attrib.items():
        if key.split('}')[-1].lower() == 'href':
            assert not value.strip().lower().startswith(('http:', 'https:', '//')), 'external href'
`;

test('vendor manifest covers the supplier and route lists exactly once', () => {
  assert.deepEqual(manifest.vendors.map((vendor) => vendor.id).sort(), [...expectedIds].sort());
});

test('vendor files exist and SVG files are safe, well-formed documents', () => {
  const seen = new Set<string>();
  for (const vendor of manifest.vendors) {
    assert.ok(vendor.files.length || vendor.missing?.trim(), `${vendor.id} needs a missing reason`);
    for (const file of vendor.files) {
      assert.match(file.file, new RegExp(`^${vendor.id}(?:-(?:dark|light|mark))?\\.(?:svg|png)$`));
      assert.ok(!seen.has(file.file), `duplicate file ${file.file}`);
      seen.add(file.file);
      assert.ok(['primary', 'dark', 'light', 'mark'].includes(file.variant));
      assert.ok(file.file.endsWith(`.${file.format}`));
      const path = join(assets, file.file);
      assert.ok(statSync(path).size > 0, `${file.file} is empty`);
      if (file.format === 'svg') execFileSync('python3', ['-c', checkSvg, path], { stdio: 'pipe' });
      else assert.equal(file.format, 'png');
    }
  }
});
