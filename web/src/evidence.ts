// A static page: the transactions the live suite sent to Whitechain Sepolia (read from deployments/evidence.json, which the suite
// writes), and a plain statement of what Anon-RPC covers. It reads nothing from the chain, so every row is a claim anyone can
// open on the explorer and check.
import evidence from "../../deployments/evidence.json";
import { el } from "./ui";
import { explorerUrl } from "./chain";

const txUrl = (h: string) => `${explorerUrl}/tx/${h}`;
const clean = (label: string) => label.replace(/\s*\(refused\)\s*$/, "");

function row(e: { label: string; hash: string; status: string }): HTMLElement {
  const refused = e.status === "reverted";
  return el("li", { class: `ev-row ${refused ? "refused" : "ok"}`, ...(refused ? { "data-refusal": "" } : { "data-success": "" }) },
    el("span", { class: "ev-mark", "aria-hidden": "true" }, refused ? "✕" : "✓"),
    el("span", { class: "ev-label" }, clean(e.label), refused ? el("em", {}, " was refused") : null),
    el("a", { class: "btn small", href: txUrl(e.hash), target: "_blank", rel: "noopener", "aria-label": `Open the transaction for: ${e.label}` }, "Transaction"),
  );
}

function covers(): HTMLElement {
  const rows: [string, string, string][] = [
    ["Reads", "Sent through Anon-RPC over Tor by default. The RPC provider sees a Tor exit, not you.", "Which contracts and invoices the app reads, as the provider sees them, once they leave the Tor exit."],
    ["Signed transactions", "Broadcast directly to the chain. A transaction names its sender by nature.", "Your wallet address, what it did and when. Public on any chain."],
    ["Demo wallet signing", "Done by the server signer for the labelled demo wallets.", "The signer sees what a demo wallet is asked to sign. These wallets hold testnet tokens only."],
    ["Your IP address", "Hidden from the RPC providers while reads go through Anon-RPC.", "Visible to this website's host and to the chain on any direct broadcast."],
    ["Anon-RPC gateway", "A demo gateway run by the Ethereum Foundation.", "It is a demo service that may be down. When it is, the app says so and offers a direct read, which is not anonymous."],
  ];
  const t = el("table", { class: "ev-table", "aria-label": "What Anon-RPC covers" },
    el("thead", {}, el("tr", {}, el("th", {}, "Part"), el("th", {}, "What is private"), el("th", {}, "What stays visible"))),
    el("tbody", {}, ...rows.map(([a, b, c]) => el("tr", {}, el("th", { scope: "row" }, a), el("td", {}, b), el("td", {}, c)))),
  );
  return el("div", { class: "ev-scroll" }, t);
}

export function evidencePage(): HTMLElement {
  const refused = evidence.entries.filter((e) => e.status === "reverted");
  const done = evidence.entries.filter((e) => e.status !== "reverted");
  return el("div", { class: "app ev" },
    el("div", { class: "wrap" },
      el("p", {}, el("a", { class: "btn small", href: "#" }, "← Back to Khata")),
      el("h1", {}, "What the contract refused"),
      el("p", { class: "muted" }, `Every row is a transaction the live test suite sent to the Khata contracts on Whitechain Sepolia (chain ${evidence.chainId}), with the real prize USDT. Refusals are real on-chain reverts: the contract said no and the transaction is on the explorer. Open any of them.`),
      el("section", { class: "card" }, el("h2", {}, `${refused.length} refusals`), el("ul", { class: "ev-list" }, ...refused.map(row))),
      el("section", { class: "card" }, el("h2", {}, `${done.length} steps that went through`), el("ul", { class: "ev-list" }, ...done.map(row))),
      el("section", { class: "card" },
        el("h2", {}, "What Anon-RPC covers, and what it does not"),
        el("p", { class: "muted" }, "Reads go through Anon-RPC by default. Writes are not anonymous. The app shows how many of its reads went through it, live, in the top bar."),
        covers(),
      ),
      el("p", { class: "muted" }, "Registry ", el("code", {}, evidence.KhataRegistry), ". Regenerate with ", el("code", {}, "npm run live:stage2"), "."),
    ),
  );
}
