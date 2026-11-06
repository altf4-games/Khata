// The Privacy page: what the private route is doing right now, a button that asks an outside service what it sees as your
// address (directly and through the route), and a log of every request the app made with where it went.
import { el } from "./ui";
import { chipText, state, traffic, viaRoute } from "./anon";
import { verdictOf, whatTheRpcSaw, type Seen } from "./selftest";

const ECHO = "https://api.ipify.org?format=text";
let seen: Seen | undefined;
let running = false;
let redraw: () => void = () => {};

async function runComparison() {
  running = true; redraw();
  seen = await whatTheRpcSaw(async () => (await (await fetch(ECHO)).text()).trim(), async () => (await viaRoute(ECHO)).trim());
  running = false; redraw();
}

const hhmmss = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour12: false });
const ROUTE_LABEL = { anon: "Anon-RPC", direct: "Direct", broadcast: "Direct (signed transaction)", bootstrap: "Direct (worker specifier)" } as const;

function logTable(): HTMLElement {
  const rows = [...traffic.log()].reverse().slice(0, 50);
  if (!rows.length) return el("p", { class: "muted" }, "Nothing has been read yet.");
  return el("div", { class: "ev-scroll" }, el("table", { class: "ev-table", "aria-label": "Requests the app made" },
    el("thead", {}, el("tr", {}, el("th", {}, "Time"), el("th", {}, "Went through"), el("th", {}, "Calls"), el("th", {}, "Took"), el("th", {}, "Result"))),
    el("tbody", {}, ...rows.map((r) => el("tr", { "data-route": r.route },
      el("td", {}, hhmmss(r.at)), el("td", {}, ROUTE_LABEL[r.route]), el("td", {}, r.methods.join(", ") || "-"), el("td", {}, `${r.ms} ms`), el("td", {}, r.ok ? "ok" : "failed"))))));
}

export function privacyPage(rerender: () => void): HTMLElement {
  redraw = rerender;
  const c = chipText();
  const s = traffic.snapshot();
  const direct = traffic.directReads().length;
  const v = seen ? verdictOf(seen) : undefined;
  const ready = state.kind === "ready";
  return el("div", { class: "app ev", "data-testid": "privacy-page" },
    el("div", { class: "wrap" },
      el("p", {}, el("a", { class: "btn small", href: "#" }, "← Back to Khata")),
      el("h1", {}, "Privacy: what the route is doing"),
      el("p", { class: "muted" }, "Khata reads the chain through Anon-RPC by default, so the RPC provider sees a Tor or Nym exit and not your address. Signed transactions are broadcast directly because a transaction names its sender by nature. This page shows the evidence instead of asking you to take it on trust."),
      el("section", { class: "card" }, el("h2", {}, "Right now"),
        el("p", { "data-testid": "privacy-status" }, c.text),
        el("p", { class: "muted" }, `${s.anon} reads through Anon-RPC, ${direct} direct reads, ${s.broadcast} signed transactions broadcast directly, ${s.failed} reads that failed.`),
        direct === 0 && s.anon > 0 ? el("p", { "data-testid": "privacy-audit" }, "Audit: every read this page load made went through Anon-RPC.") : null,
      ),
      el("section", { class: "card" }, el("h2", {}, "What an outside service sees"),
        el("p", { class: "muted" }, "Asks an address-echo service (api.ipify.org) twice: once straight from this browser and once through the private route. That service learns that something asked it, which is the point of the test. It is not a chain read and is not counted above."),
        el("div", { class: "row" }, el("button", { class: "btn dark", "data-testid": "privacy-compare", disabled: running || !ready, onclick: () => void runComparison() }, running ? "Asking…" : "Compare the two")),
        !ready ? el("p", { class: "muted" }, "The private route is not ready, so there is nothing to compare yet.") : null,
        v ? el("p", { role: "status", class: v.ok ? "" : "warn", "data-testid": "privacy-verdict" }, v.text) : null,
      ),
      el("section", { class: "card" }, el("h2", {}, "Every request, newest first"), logTable()),
    ),
  );
}
