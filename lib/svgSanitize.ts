/**
 * Sanitize SVG text before ima2 stores or previews it.
 *
 * OpenAI says SVG output is static vector content with no scripts, external resources
 * or embedded rasters. ima2 still treats it as untrusted markup: a saved .svg opened
 * directly in the browser would run script on the studio origin. This removes active
 * content and external references. It is one layer; /generated also serves .svg with
 * `Content-Security-Policy: default-src 'none'` and the UI renders it through <img>.
 */

export const MAX_SVG_BYTES = 10 * 1024 * 1024;

/** Elements that execute, embed foreign content, or animate attributes (e.g. href). */
const ACTIVE_ELEMENTS = [
  "script", "foreignObject", "iframe", "object", "embed", "audio", "video", "canvas",
  "animate", "animateMotion", "animateTransform", "set", "discard", "handler", "listener", "link", "meta",
];
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
/** A start tag whose quoted attribute values may contain ">". */
const START_TAG = /<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g;
const ATTRIBUTE = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>/=]+)/g;

export interface SvgSanitizeResult {
  svg: string;
  removedElements: number;
  removedAttributes: number;
}

export class SvgRejectedError extends Error {
  code = "SVG_OUTPUT_INVALID";
  status = 422;
}

function unquote(value: string): string {
  const first = value[0];
  return (first === '"' || first === "'") ? value.slice(1, -1) : value;
}

function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none");
}

function cleanAttributes(tag: string, counter: { attributes: number }): string {
  return tag.replace(ATTRIBUTE, (whole, rawName: string, rawValue: string) => {
    const name = rawName.toLowerCase();
    const value = unquote(rawValue).trim();
    if (name.startsWith("on") || name === "src" || name === "formaction") {
      counter.attributes += 1;
      return "";
    }
    if (name === "href" || name === "xlink:href") {
      if (value.startsWith("#") || SAFE_DATA_IMAGE.test(value)) return whole;
      counter.attributes += 1;
      return "";
    }
    if (name === "style") return ` style="${cleanCss(value).replace(/"/g, "'")}"`;
    return whole;
  });
}

export function sanitizeSvg(input: string): SvgSanitizeResult {
  if (Buffer.byteLength(input, "utf8") > MAX_SVG_BYTES) throw new SvgRejectedError("SVG output is larger than 10 MB");
  let svg = input.replace(/^\uFEFF/, "");
  // Entity declarations enable expansion attacks; ima2 never needs a DOCTYPE.
  svg = svg.replace(/<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>/gi, "");
  svg = svg.replace(/<\?(?!xml\s)[\s\S]*?\?>/gi, "");
  if (/<!ENTITY/i.test(svg) || !/<svg[\s>]/i.test(svg) || !/<\/svg\s*>\s*$/i.test(svg.trim())) {
    throw new SvgRejectedError("SVG output is not a standalone <svg> document");
  }
  const counter = { elements: 0, attributes: 0 };
  for (const name of ACTIVE_ELEMENTS) {
    const paired = new RegExp(`<${name}\\b[^>]*?(?<!/)>[\\s\\S]*?</${name}\\s*>`, "gi");
    const single = new RegExp(`</?${name}\\b[^>]*>`, "gi");
    svg = svg.replace(paired, () => { counter.elements += 1; return ""; });
    svg = svg.replace(single, () => { counter.elements += 1; return ""; });
  }
  svg = svg.replace(/<image\b[^>]*>/gi, (tag) => {
    const href = /\s(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(tag);
    if (href && SAFE_DATA_IMAGE.test(unquote(href[1]!).trim())) return tag;
    counter.elements += 1;
    return "";
  });
  svg = svg.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_whole, open: string, css: string, close: string) =>
    `${open}${cleanCss(css)}${close}`);
  svg = svg.replace(START_TAG, (tag) => cleanAttributes(tag, counter));
  return { svg, removedElements: counter.elements, removedAttributes: counter.attributes };
}
