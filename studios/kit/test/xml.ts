/**
 * A small XML reader for the vendor-logo test. Node has no XML parser, and the test must run on
 * hosts without Python (Windows CI). It accepts well-formed XML 1.0 documents (prolog, DOCTYPE
 * without entity definitions, comments, CDATA, processing instructions) and throws on anything
 * else: unclosed or crossed tags, a second root, unquoted or repeated attributes, a stray "<" or
 * an unknown "&" entity.
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

const NAME = /^[A-Za-z_:][\w.:-]*/;
const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/y;

function checkText(text: string, where: number): void {
  if (text.includes("<")) throw new Error("stray '<' at " + where);
  for (let at = text.indexOf("&"); at !== -1; at = text.indexOf("&", at + 1)) {
    ENTITY.lastIndex = at;
    if (!ENTITY.test(text)) throw new Error("unknown entity at " + (where + at));
  }
}

class Reader {
  i = 0;
  readonly s: string;
  constructor(text: string) {
    // A plain field: Node runs this file by stripping types, which has no parameter properties.
    this.s = text;
  }
  fail(what: string): never {
    throw new Error(what + " at " + this.i);
  }
  skipTo(end: string): void {
    const at = this.s.indexOf(end, this.i);
    if (at === -1) this.fail("unterminated, expected " + JSON.stringify(end));
    this.i = at + end.length;
  }
  space(): void {
    while (/\s/.test(this.s[this.i] ?? "")) this.i++;
  }
  name(): string {
    const m = NAME.exec(this.s.slice(this.i));
    if (!m) this.fail("expected a name");
    this.i += m[0].length;
    return m[0];
  }
  /** Comment, processing instruction or DOCTYPE; false when the next markup is something else. */
  misc(): boolean {
    const s = this.s;
    if (s.startsWith("<!--", this.i)) {
      this.skipTo("-->");
      return true;
    }
    if (s.startsWith("<?", this.i)) {
      this.skipTo("?>");
      return true;
    }
    if (s.startsWith("<!DOCTYPE", this.i)) {
      const close = s.indexOf(">", this.i);
      const open = s.indexOf("[", this.i);
      if (open !== -1 && open < close) {
        if (s.slice(open, s.indexOf("]", open)).includes("<!ENTITY")) this.fail("entity definitions are not supported");
        this.i = open;
        this.skipTo("]");
      }
      this.skipTo(">");
      return true;
    }
    return false;
  }
  attrs(): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (;;) {
      const before = this.i;
      this.space();
      const c = this.s[this.i];
      if (c === ">" || c === "/") return attrs;
      if (this.i === before) this.fail("expected space before an attribute");
      const key = this.name();
      this.space();
      if (this.s[this.i++] !== "=") this.fail("expected '='");
      this.space();
      const quote = this.s[this.i++];
      if (quote !== '"' && quote !== "'") this.fail("attribute value must be quoted");
      const end = this.s.indexOf(quote, this.i);
      if (end === -1) this.fail("unterminated attribute value");
      const value = this.s.slice(this.i, end);
      checkText(value, this.i);
      if (key in attrs) this.fail("repeated attribute " + key);
      attrs[key] = value;
      this.i = end + 1;
    }
  }
  element(): XmlElement {
    if (this.s[this.i++] !== "<") this.fail("expected '<'");
    const element: XmlElement = { name: this.name(), attrs: this.attrs(), children: [] };
    if (this.s.startsWith("/>", this.i)) {
      this.i += 2;
      return element;
    }
    if (this.s[this.i++] !== ">") this.fail("expected '>'");
    for (;;) {
      const next = this.s.indexOf("<", this.i);
      if (next === -1) this.fail("unclosed <" + element.name + ">");
      checkText(this.s.slice(this.i, next), this.i);
      this.i = next;
      if (this.s.startsWith("</", this.i)) {
        this.i += 2;
        const name = this.name();
        this.space();
        if (name !== element.name) this.fail("</" + name + "> closes <" + element.name + ">");
        if (this.s[this.i++] !== ">") this.fail("expected '>'");
        return element;
      }
      if (this.s.startsWith("<![CDATA[", this.i)) this.skipTo("]]>");
      else if (!this.misc()) element.children.push(this.element());
    }
  }
}

/** Parses a whole document and returns its single root element. */
export function parseXml(text: string): XmlElement {
  const r = new Reader(text.replace(/^\uFEFF/, ""));
  const prolog = () => {
    for (;;) {
      r.space();
      if (r.i >= r.s.length || !r.misc()) return;
    }
  };
  prolog();
  if (r.s[r.i] !== "<") r.fail("expected the root element");
  const root = r.element();
  prolog();
  if (r.i < r.s.length) r.fail("content after the root element");
  return root;
}

/** Every element, root first. */
export function* walk(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) yield* walk(child);
}

/** "svg:svg" and "xlink:href" read as "svg" and "href". */
export const localName = (name: string) => name.slice(name.lastIndexOf(":") + 1);
