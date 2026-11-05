// Tiny DOM helpers shared by every view.
export type Child = Node | string | null | undefined | false;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c) n.append(c);
  return n;
}
export const short = (s: string, a = 8, b = 6) => (s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

/** Appends only the children that exist. */
export function put(parent: Node & ParentNode, ...kids: Child[]) {
  for (const k of kids) if (k) parent.append(k);
}
