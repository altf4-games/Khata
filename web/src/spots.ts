// Small ink illustrations for the app pages: one per role, and one for empty states.
import supplier from "./art/spot-supplier.svg?raw";
import investor from "./art/spot-investor.svg?raw";
import debtor from "./art/spot-debtor.svg?raw";
import attester from "./art/spot-attester.svg?raw";
import empty from "./art/spot-empty.svg?raw";
import { el } from "./ui";

export const SPOTS = { supplier, investor, debtor, attester } as const;

export function spot(markup: string, cls = "spot"): HTMLElement {
  const d = el("div", { class: cls, "aria-hidden": "true" });
  d.innerHTML = markup;
  return d;
}

/** A designed empty state: a drawing, a title and one line saying what to do next. */
export function emptyBox(title: string, text: string): HTMLElement {
  return el("div", { class: "empty" }, spot(empty, "spot"), el("h3", {}, title), el("p", {}, text));
}
