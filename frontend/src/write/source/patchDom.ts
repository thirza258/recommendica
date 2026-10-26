/**
 * Updates the preview by replacing only the top-level blocks that changed.
 *
 * Re-assigning innerHTML on every keystroke would rebuild every equation and
 * re-decode every image, and reset text selection in the preview. Instead the
 * new HTML is parsed once, matched against the current children from both
 * ends, and only the differing middle is swapped. Line numbers and generated
 * ids are ignored when comparing (they shift whenever a line is added above)
 * and copied onto the blocks that are kept.
 */

const keys = new WeakMap<Node, string>();

const VOLATILE = / (?:data-line|id)="[^"]*"/g;

function keyOf(node: Node): string {
  const cached = keys.get(node);
  if (cached !== undefined) return cached;
  const key = node instanceof Element ? node.outerHTML.replace(VOLATILE, "") : `#${node.nodeType}:${node.textContent ?? ""}`;
  keys.set(node, key);
  return key;
}

function copyVolatile(target: Node, source: Node): void {
  if (!(target instanceof Element) || !(source instanceof Element)) return;
  const sync = (to: Element, from: Element) => {
    for (const name of ["data-line", "id"]) {
      const value = from.getAttribute(name);
      if (value === null) to.removeAttribute(name);
      else if (to.getAttribute(name) !== value) to.setAttribute(name, value);
    }
  };
  sync(target, source);
  const targets = target.querySelectorAll("[data-line], [id]");
  const sources = source.querySelectorAll("[data-line], [id]");
  if (targets.length !== sources.length) return;
  targets.forEach((element, index) => sync(element, sources[index]));
}

/** Returns how many top-level blocks were replaced (useful for tests and tuning). */
export function patchChildren(container: HTMLElement, html: string): number {
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = Array.from(template.content.childNodes);
  const current = Array.from(container.childNodes);
  const nextKeys = next.map(keyOf);

  let start = 0;
  while (start < current.length && start < next.length && keyOf(current[start]) === nextKeys[start]) {
    copyVolatile(current[start], next[start]);
    start++;
  }
  let endCurrent = current.length - 1;
  let endNext = next.length - 1;
  while (endCurrent >= start && endNext >= start && keyOf(current[endCurrent]) === nextKeys[endNext]) {
    copyVolatile(current[endCurrent], next[endNext]);
    endCurrent--;
    endNext--;
  }

  const anchor = current[endCurrent + 1] ?? null;
  for (let i = start; i <= endCurrent; i++) container.removeChild(current[i]);
  for (let i = start; i <= endNext; i++) {
    keys.set(next[i], nextKeys[i]);
    container.insertBefore(next[i], anchor);
  }
  return endNext - start + 1;
}
