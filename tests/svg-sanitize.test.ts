import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeSvg } from "../lib/svgSanitize.ts";

const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${body}</svg>`;

describe("sanitizeSvg", () => {
  it("keeps ordinary static vector content byte-for-byte", () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/>')}`;
    const result = sanitizeSvg(svg);
    assert.equal(result.svg, svg);
    assert.equal(result.removedElements + result.removedAttributes, 0);
  });

  it("removes script, foreignObject, animation and embedding elements", () => {
    const result = sanitizeSvg(wrap(
      '<script>alert(1)</script><script x="a>b">alert(2)</script><foreignObject><div>x</div></foreignObject>'
      + '<set attributeName="href" to="javascript:alert(3)"/><animate attributeName="href" values="javascript:alert(4)"/>'
      + '<iframe src="https://example.com"></iframe><circle r="2"/>',
    ));
    assert.doesNotMatch(result.svg, /script|foreignObject|<set|<animate|iframe|alert/i);
    assert.match(result.svg, /<circle r="2"\/>/);
    assert.ok(result.removedElements >= 6);
  });

  it("strips event handlers and external or script references, including entity-encoded ones", () => {
    const result = sanitizeSvg(wrap(
      '<rect onload="alert(1)" ONCLICK=\'x()\' width="1"/><a href="javascript:alert(1)"><text>t</text></a>'
      + '<a xlink:href="&#106;avascript:alert(1)"><text>u</text></a><use href="https://evil.example/s.svg#x"/>'
      + '<path d="M0 0" data-x="a>b" onmouseover="steal()"/>',
    ));
    assert.doesNotMatch(result.svg, /onload|onclick|onmouseover|javascript|&#106;|evil\.example|steal/i);
    assert.match(result.svg, /<rect width="1"\/>/);
    assert.match(result.svg, /data-x="a>b"/);
  });

  it("keeps only raster data: images and neutralizes CSS url() and @import", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = sanitizeSvg(wrap(
      `<image href="${png}" width="1" height="1"/><image href="https://evil.example/p.png"/><image href="data:image/svg+xml;base64,PHN2Zz4="/>`
      + '<style>@import url(https://evil.example/a.css); .a { fill: url(https://evil.example/f) } .b { fill: url(#ok) }</style>'
      + '<rect style="fill: url(https://evil.example/x); stroke: red" width="1"/>',
    ));
    assert.equal((result.svg.match(/<image/g) ?? []).length, 1);
    assert.match(result.svg, new RegExp(png.replace(/[+/=.]/g, "\\$&")));
    assert.doesNotMatch(result.svg, /evil\.example|@import/);
    assert.match(result.svg, /url\(#ok\)/);
  });

  it("drops DOCTYPE internal subsets and rejects entity declarations or non-SVG documents", () => {
    const cleaned = sanitizeSvg(`<!DOCTYPE svg [ <!ELEMENT svg ANY> ]>${wrap("<g/>")}`);
    assert.doesNotMatch(cleaned.svg, /DOCTYPE|ELEMENT/);
    assert.throws(() => sanitizeSvg(`${wrap("<g/>")}<!ENTITY x "y">`), { code: "SVG_OUTPUT_INVALID" });
    assert.throws(() => sanitizeSvg("<html><body>not svg</body></html>"), { code: "SVG_OUTPUT_INVALID" });
  });
});
