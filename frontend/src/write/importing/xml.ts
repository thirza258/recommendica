/**
 * A small XML reader for the parts of Office documents.
 *
 * Office XML is machine-written and well-formed, so this reads elements,
 * attributes, text and CDATA, and nothing else: no DTDs and only the five
 * predefined entities plus numeric references, which also rules out
 * entity-expansion attacks. DOM-free, so the converters run in tests and
 * workers alike.
 */

export interface XmlElement {
  /** The qualified name as written (`w:p`). */
  name: string;
  /** The name without its prefix (`p`). */
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity] ?? match;
  });
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Parses an XML document and returns its root element. Throws on input that is not XML. */
export function parseXml(source: string): XmlElement {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const root: XmlElement = { name: "#document", local: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let index = 0;
  const length = text.length;
  while (index < length) {
    const open = text.indexOf("<", index);
    const end = open === -1 ? length : open;
    if (end > index) {
      const raw = text.slice(index, end);
      if (stack.length > 1) stack[stack.length - 1].children.push(decodeEntities(raw));
    }
    if (open === -1) break;
    index = open;
    if (text.startsWith("<!--", index)) {
      const close = text.indexOf("-->", index + 4);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", index)) {
      const close = text.indexOf("]]>", index + 9);
      const data = text.slice(index + 9, close === -1 ? length : close);
      if (stack.length > 1) stack[stack.length - 1].children.push(data);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (text.startsWith("<?", index)) {
      const close = text.indexOf("?>", index + 2);
      index = close === -1 ? length : close + 2;
      continue;
    }
    if (text.startsWith("<!", index)) {
      // DOCTYPE and other declarations: skipped, never interpreted.
      const close = text.indexOf(">", index + 2);
      index = close === -1 ? length : close + 1;
      continue;
    }
    if (text[index + 1] === "/") {
      const close = text.indexOf(">", index + 2);
      const name = text.slice(index + 2, close === -1 ? length : close).trim();
      // Close up to the matching element; a stray end tag is ignored.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
      index = close === -1 ? length : close + 1;
      continue;
    }
    // Start tag: name, attributes, optional self-closing slash.
    let cursor = index + 1;
    while (cursor < length && !/[\s/>]/.test(text[cursor])) cursor++;
    const name = text.slice(index + 1, cursor);
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (cursor < length) {
      const ch = text[cursor];
      if (ch === ">") {
        cursor++;
        break;
      }
      if (ch === "/" && text[cursor + 1] === ">") {
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (/\s/.test(ch)) {
        cursor++;
        continue;
      }
      const nameStart = cursor;
      while (cursor < length && !/[\s=/>]/.test(text[cursor])) cursor++;
      const attrName = text.slice(nameStart, cursor);
      while (cursor < length && /\s/.test(text[cursor])) cursor++;
      if (text[cursor] !== "=") {
        if (attrName) attrs[attrName] = "";
        continue;
      }
      cursor++;
      while (cursor < length && /\s/.test(text[cursor])) cursor++;
      const quote = text[cursor];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, cursor + 1);
        attrs[attrName] = decodeEntities(text.slice(cursor + 1, close === -1 ? length : close));
        cursor = close === -1 ? length : close + 1;
      } else {
        const valueStart = cursor;
        while (cursor < length && !/[\s>]/.test(text[cursor])) cursor++;
        attrs[attrName] = decodeEntities(text.slice(valueStart, cursor));
      }
    }
    if (!name) throw new Error("This file is not valid XML.");
    const element: XmlElement = { name, local: localName(name), attrs, children: [] };
    stack[stack.length - 1].children.push(element);
    if (!selfClosing) stack.push(element);
    index = cursor;
  }
  const first = root.children.find((child): child is XmlElement => typeof child !== "string");
  if (!first) throw new Error("This file is not valid XML.");
  return first;
}

export function isElement(node: XmlNode | undefined): node is XmlElement {
  return typeof node === "object" && node !== null;
}

/** Child elements, optionally only those with this local name. */
export function elements(element: XmlElement | null | undefined, local?: string): XmlElement[] {
  if (!element) return [];
  const found: XmlElement[] = [];
  for (const child of element.children) {
    if (isElement(child) && (local === undefined || child.local === local)) found.push(child);
  }
  return found;
}

/** The first child element with this local name. */
export function child(element: XmlElement | null | undefined, local: string): XmlElement | null {
  if (!element) return null;
  for (const node of element.children) {
    if (isElement(node) && node.local === local) return node;
  }
  return null;
}

/** The first element with this local name at any depth. */
export function descendant(element: XmlElement | null | undefined, local: string): XmlElement | null {
  if (!element) return null;
  for (const node of element.children) {
    if (!isElement(node)) continue;
    if (node.local === local) return node;
    const found = descendant(node, local);
    if (found) return found;
  }
  return null;
}

/** Every element with this local name at any depth, in document order. */
export function descendants(element: XmlElement | null | undefined, local: string, out: XmlElement[] = []): XmlElement[] {
  if (!element) return out;
  for (const node of element.children) {
    if (!isElement(node)) continue;
    if (node.local === local) out.push(node);
    descendants(node, local, out);
  }
  return out;
}

/** An attribute by its local name (`w:val` and `val` both match `val`). */
export function attr(element: XmlElement | null | undefined, local: string): string | null {
  if (!element) return null;
  if (local in element.attrs) return element.attrs[local];
  for (const [name, value] of Object.entries(element.attrs)) {
    if (localName(name) === local) return value;
  }
  return null;
}

/** All text inside an element. */
export function textOf(element: XmlElement | null | undefined): string {
  if (!element) return "";
  let out = "";
  for (const node of element.children) out += typeof node === "string" ? node : textOf(node);
  return out;
}
