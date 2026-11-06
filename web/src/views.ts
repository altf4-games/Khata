// Role views: wallet bar, note cards with the actions that apply, and the attester's credential desk.
import { hexToSignature, keccak256, toHex, type Address } from "viem";
import {
  addressUrl, attesterDomain, attestersAbi, attestersAddress, factoryAbi, factoryAddress, noteAbi, publicClient, txUrl,
  usdtAbi, usdtAddress, usdtPermitDomain, abi as registryAbi, registryAddress,
} from "./chain";
import { el, put, short, type Child } from "./ui";
import { activeWallet, holdKey, refresh, refreshArkiv, rerender, run, store, type Msg } from "./store";
import { explainTransfer, nowChain, parseUsdt, quote, span, usdt, when, type NoteInfo } from "./notes";
import { nameOf, walletsFor, type DemoWallet, type Role } from "./wallets";
import { send } from "./tx";
import { closeListing, listingControl } from "./arkivViews";
import { arkivWalletFor } from "./arkivApp";
import { ELIGIBILITY_TYPES, REVOCATION_TYPES, SELLER_BINDING_TYPES } from "./eip712";
import { publishCredential, publishRevocation } from "./arkiv";

// ---------- shared bits ----------
export function msgBanner(key: string): Child {
  const m: Msg | undefined = store.msgs[key];
  if (!m) return null;
  if (m.kind === "busy") return el("div", { class: "banner info", role: "status" }, el("span", { class: "spinner" }), el("div", {}, el("strong", {}, m.title), el("p", {}, "Waiting for the network to confirm. Whitechain blocks take a few seconds.")));
  const link = m.hash ? [" ", el("a", { href: txUrl(m.hash), target: "_blank", rel: "noopener" }, "View the transaction")] : [];
  return el("div", { class: `banner ${m.kind}`, role: m.kind === "bad" ? "alert" : "status" }, el("span", { class: "ic" }, m.kind === "ok" ? "✓" : "✕"),
    el("div", {}, el("strong", {}, m.title), m.detail || link.length ? el("p", {}, m.detail ?? "", ...link) : null));
}
export const busy = (key: string) => store.msgs[key]?.kind === "busy";

export function field(label: string, key: string, def: string, opts: { type?: string; hint?: string; options?: [string, string][] } = {}): HTMLElement {
  const id = `f-${key}`;
  const value = store.form[key] ?? def;
  const input = opts.options
    ? el("select", { id, onchange: (e: Event) => (store.form[key] = (e.target as HTMLSelectElement).value) }, ...opts.options.map(([v, t]) => el("option", { value: v, selected: v === value }, t)))
    : el("input", { id, type: opts.type ?? "text", value, inputmode: opts.type === "number" ? "decimal" : undefined, autocomplete: "off", spellcheck: "false", oninput: (e: Event) => (store.form[key] = (e.target as HTMLInputElement).value) });
  return el("div", { class: "field" }, el("label", { for: id }, label), input, opts.hint ? el("small", {}, opts.hint) : null);
}
const val = (key: string, def: string) => (store.form[key] ?? def).trim();

export function nowEst(): number {
  return store.chainNow + Math.floor((Date.now() - store.refreshedAt) / 1000);
}
export function until(ts: number): HTMLElement {
  const s = el("span", { "data-until": String(ts) });
  s.textContent = ts > nowEst() ? `in ${span(ts - nowEst())}` : `${span(nowEst() - ts)} ago`;
  return s;
}

// ---------- wallet bar ----------
export function walletBar(role: Role): HTMLElement {
  const list = walletsFor(role);
  const w = activeWallet(role);
  if (!w) {
    return el("div", { class: "card notice" }, el("span", { class: "kicker" }, "Read only"), el("h2", {}, "No demo wallet loaded"),
      el("p", { class: "muted" }, "The demo signer has no wallet for this role, so the page can show the chain but not send."));
  }
  const k = w.address.toLowerCase();
  const b = store.bal[k];
  const e = store.elig[k];
  const picker = list.length > 1
    ? el("div", { class: "pick", role: "group", "aria-label": "Choose a wallet" }, ...list.map((x, i) =>
        el("button", { class: "btn", "aria-pressed": String((store.pick[role] ?? 0) === i), onclick: () => { store.pick[role] = i; rerender(); void refresh(); } }, x.label)))
    : null;
  const credChip = e
    ? e.reason === "Eligible"
      ? el("span", { class: "badge real" }, `Credential valid · tier ${e.tier} · ${when(e.validUntil)}`)
      : el("span", { class: "badge bad" }, e.reason === "NoCredential" ? "No credential" : `Credential ${e.reason === "AttesterRemoved" ? "attester removed" : e.reason.toLowerCase()}`)
    : null;
  return el("section", { class: "card wallet", "aria-label": "Active wallet" },
    el("span", { class: "kicker" }, "Acting as"),
    el("h2", {}, w.label),
    picker,
    el("p", { class: "mono" }, el("a", { href: addressUrl(w.address), target: "_blank", rel: "noopener" }, w.address)),
    el("div", { class: "chiprow" },
      b ? el("span", { class: "badge info" }, `${usdt(b.usdt)} USDT`) : null,
      b ? el("span", { class: "badge info" }, `${(Number(b.wbt) / 1e18).toFixed(3)} WBT for fees`) : null,
      role === "investor" || role === "debtor" ? credChip : null),
    el("p", { class: "foot" }, "Demo wallet on the Whitechain testnet. A server signer holds its key, never this page, so the whole story runs in one tab. It holds no real value."),
  );
}

// ---------- note card ----------
function phaseBadge(n: NoteInfo): HTMLElement {
  if (n.phase === "Settled") return el("span", { class: "badge real" }, "Settled");
  if (n.phase === "Defaulted") return el("span", { class: "badge bad" }, "Defaulted");
  if (n.fundingClosed) return el("span", { class: "badge info" }, "Funding closed");
  if (nowEst() < n.fundableAt) return el("span", { class: "badge" }, "Cool-off");
  return el("span", { class: "badge info" }, "Open for funding");
}

export function noteCard(n: NoteInfo, role: Role): HTMLElement {
  const w = activeWallet(role);
  const mine = w ? store.hold[holdKey(n.address, w.address)] ?? 0n : 0n;
  const now = nowEst();
  const pct = n.faceValue === 0n ? 0 : Number((n.fundedFace * 1000n) / n.faceValue) / 10;
  const pay = 10000 - n.discountBps;
  const key = `note:${n.address}`;
  const card = el("article", { class: "card note", "aria-label": n.name },
    el("div", { class: "note-head" }, el("h3", {}, n.name), phaseBadge(n)),
    el("p", { class: "big" }, `${usdt(n.faceValue)} USDT`, el("small", {}, " face value")),
    el("div", { class: "meter", role: "img", "aria-label": `${pct}% funded` }, el("span", { style: `width:${Math.min(pct, 100)}%` })),
    el("p", { class: "foot" }, `${usdt(n.fundedFace)} of ${usdt(n.faceValue)} funded · ${usdt(n.available)} still for sale · investors pay ${pay / 100}% of face`),
    el("dl", { class: "facts compact" },
      el("dt", {}, "Seller"), el("dd", {}, nameOf(n.seller) ?? "", " ", el("a", { class: "mono", href: addressUrl(n.seller), target: "_blank", rel: "noopener" }, short(n.seller, 6, 4))),
      el("dt", {}, "Funding opens"), el("dd", {}, when(n.fundableAt), " (", until(n.fundableAt), ")"),
      el("dt", {}, "Due date"), el("dd", {}, when(n.dueDate), " (", until(n.dueDate), ")"),
      el("dt", {}, "Default possible"), el("dd", {}, when(n.dueDate + n.graceSeconds + 1)),
      el("dt", {}, "Minimum tier"), el("dd", {}, String(n.minTier)),
      w ? el("dt", {}, "You hold") : null, w ? el("dd", {}, el("strong", {}, `${usdt(mine)} notes`)) : null,
    ),
    el("p", { class: "mono foot" }, "Note contract ", el("a", { href: addressUrl(n.address), target: "_blank", rel: "noopener" }, n.address)),
  );
  if (!w) return card;

  // actions that apply to this role and this note's state
  const acts = el("div", { class: "acts" });
  if (role === "investor") {
    if (n.phase === "Funding" && !n.fundingClosed && n.available > 0n && now <= n.fundingDeadline) acts.append(fundPanel(n, w, key));
    if (mine > 0n && n.phase === "Funding") acts.append(transferPanel(n, w, key));
    if (mine > 0n && n.phase === "Settled") {
      acts.append(el("button", { class: "btn primary", disabled: busy(key), onclick: () => run(key, "Redeeming…", () => send(w, n.address, noteAbi, "redeem", []), `Redeemed ${usdt(mine)} USDT`) }, `Redeem ${usdt(mine)} USDT`));
    }
  }
  if (role === "debtor" && n.phase === "Funding") acts.append(settlePanel(n, w, key));
  if (role === "debtor" && n.phase === "Settled" && mine > 0n) {
    acts.append(el("button", { class: "btn", disabled: busy(key), onclick: () => run(key, "Redeeming…", () => send(w, n.address, noteAbi, "redeem", []), "Redeemed") }, `Redeem ${usdt(mine)} USDT`));
  }
  if (role === "supplier" && n.phase === "Funding" && !n.fundingClosed && n.seller.toLowerCase() === w.address.toLowerCase()) {
    acts.append(el("button", { class: "btn", disabled: busy(key), onclick: () => run(key, "Closing funding…", async () => {
      const sent = await send(w, n.address, noteAbi, "closeFunding", []);
      try { await closeListing(n, w); } catch { /* the listing is only discovery; the chain already closed funding */ }
      return sent;
    }, "Funding closed. Unsold notes were burned; you keep that share when the debtor pays.") }, "Close funding now"));
  }
  // the listing's state is shown whatever phase the note is in (it matters most after funding closes)
  if (role === "supplier") put(acts, listingControl(n, w));
  if (n.phase === "Funding" && now > n.dueDate + n.graceSeconds) {
    acts.append(el("button", { class: "btn ghost", disabled: busy(key), onclick: () => run(key, "Marking default…", () => send(w, n.address, noteAbi, "markDefault", []), "Marked as defaulted") }, "Mark as defaulted"));
  }
  if (acts.childNodes.length) card.append(acts);
  put(card, msgBanner(key));
  return card;
}

function amountField(n: NoteInfo, key: string, def: string): HTMLElement {
  return field("Amount of notes", `${key}:amt`, def, { type: "number", hint: "1 note = 1 USDT of face value" });
}

function fundPanel(n: NoteInfo, w: DemoWallet, key: string): HTMLElement {
  const wrap = el("div", { class: "panel" }, el("h4", {}, "Buy notes"));
  const open = nowEst() >= n.fundableAt;
  const max = n.available < 1_000_000n ? n.available : 1_000_000n;
  wrap.append(amountField(n, key, usdt(max).replace(/\.00$/, "")));
  const price = el("p", { class: "foot", id: `quote-${n.address}` });
  const upd = async () => {
    const a = parseUsdt(val(`${key}:amt`, ""));
    if (!a || a === 0n) { price.textContent = "Enter an amount to see the price."; return; }
    try { price.textContent = `You pay ${usdt(await quote(n.address, a))} USDT now; the seller receives it directly.`; } catch { price.textContent = ""; }
  };
  void upd();
  wrap.querySelector("input")!.addEventListener("input", () => void upd());
  const amt = () => parseUsdt(val(`${key}:amt`, ""));
  const guard = (f: (a: bigint) => Promise<unknown>) => () => {
    const a = amt();
    if (!a) { store.msgs[key] = { kind: "bad", title: "Enter an amount", detail: "Use a number such as 1 or 0.5." }; return rerender(); }
    void f(a);
  };
  const permit = guard((a) => run(key, "Signing and funding…", async () => {
    const price = await quote(n.address, a);
    const nonce = (await publicClient.readContract({ address: usdtAddress, abi: usdtAbi, functionName: "nonces", args: [w.address] })) as bigint;
    const deadline = BigInt((await nowChain()) + 900);
    const sig = await w.client.signTypedData({
      account: w.client.account!, domain: usdtPermitDomain,
      types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Permit", message: { owner: w.address, spender: n.address, value: price, nonce, deadline },
    });
    const { v, r, s } = hexToSignature(sig);
    return send(w, n.address, noteAbi, "fundWithPermit", [a, deadline, Number(v), r, s]);
  }, "Funded in one transaction", "The USDT went straight to the seller and the notes to you."));
  const approve = guard((a) => run(key, "Approving and funding…", async () => {
    const price = await quote(n.address, a);
    const have = (await publicClient.readContract({ address: usdtAddress, abi: usdtAbi, functionName: "allowance", args: [w.address, n.address] })) as bigint;
    if (have < price) await send(w, usdtAddress, usdtAbi as never, "approve", [n.address, price]);
    return send(w, n.address, noteAbi, "fund", [a]);
  }, "Funded", "The USDT went straight to the seller and the notes to you."));
  put(wrap, price,
    el("div", { class: "row", style: "margin-top:0" },
      el("button", { class: "btn primary grow", disabled: busy(key), onclick: permit }, "Buy with one signature"),
      el("button", { class: "btn grow", disabled: busy(key), onclick: approve }, "Approve, then buy")),
    open ? null : el("p", { class: "foot" }, "Funding is in its cool-off. Opens ", until(n.fundableAt), "."),
  );
  return wrap;
}

function settlePanel(n: NoteInfo, w: DemoWallet, key: string): HTMLElement {
  const due = nowEst() >= n.dueDate;
  const wrap = el("div", { class: "panel" }, el("h4", {}, "Pay the invoice"),
    el("p", { class: "foot" }, due ? `Pay ${usdt(n.faceValue)} USDT. Holders then redeem their share; the seller gets the unsold part.` : "Payment opens at the due date, ", due ? null : until(n.dueDate)));
  wrap.append(el("button", {
    class: "btn primary", disabled: busy(key) || !due,
    onclick: () => run(key, "Paying…", async () => {
      const have = (await publicClient.readContract({ address: usdtAddress, abi: usdtAbi, functionName: "allowance", args: [w.address, n.address] })) as bigint;
      if (have < n.faceValue) await send(w, usdtAddress, usdtAbi as never, "approve", [n.address, n.faceValue]);
      return send(w, n.address, noteAbi, "settle", []);
    }, "Invoice paid and settled"),
  }, `Pay ${usdt(n.faceValue)} USDT`));
  return wrap;
}

function transferPanel(n: NoteInfo, w: DemoWallet, key: string): HTMLElement {
  const others = [...walletsFor("investor"), ...walletsFor("debtor"), ...walletsFor("supplier"), ...walletsFor("attester")].filter((x) => x.address !== w.address);
  const k = `${key}:to`;
  const opts = others.map((x): [string, string] => {
    const e = store.elig[x.address.toLowerCase()];
    return [x.address, `${x.label}${e && e.reason === "Eligible" ? "" : " (no valid credential)"}`];
  });
  const wrap = el("details", { class: "panel" }, el("summary", {}, "Send notes to another wallet"));
  wrap.append(
    field("Send to", k, others[0]?.address ?? "", { options: opts }),
    field("Amount of notes", `${key}:tamt`, "0.1", { type: "number" }),
    el("div", { class: "row", style: "margin-top:0" },
      el("button", { class: "btn grow", onclick: async () => {
        const a = parseUsdt(val(`${key}:tamt`, "0.1")) ?? 0n;
        const to = val(k, others[0]?.address ?? "") as Address;
        try {
          const r = await explainTransfer(n.address, w.address, to, a);
          store.msgs[`${key}:check`] = r.ok ? { kind: "ok", title: "This transfer would be allowed", detail: r.why } : { kind: "bad", title: "This transfer would be blocked", detail: r.why };
        } catch { store.msgs[`${key}:check`] = { kind: "bad", title: "Could not check", detail: "The network did not answer. Try again." }; }
        rerender();
      } }, "Check the rules"),
      el("button", { class: "btn dark grow", disabled: busy(key), onclick: () => {
        const a = parseUsdt(val(`${key}:tamt`, "0.1"));
        const to = val(k, others[0]?.address ?? "") as Address;
        if (!a) return;
        void run(key, "Sending…", () => send(w, n.address, noteAbi, "transfer", [to, a]), "Notes sent");
      } }, "Send"),
    ),
  );
  put(wrap, msgBanner(`${key}:check`));
  if (store.msgs[`${key}:check`] || store.msgs[key]?.kind === "bad") wrap.setAttribute("open", "");
  return wrap;
}

// ---------- lists ----------
export function notesList(role: Role, only?: (n: NoteInfo) => boolean, emptyText = "No notes yet."): HTMLElement {
  const list = store.notes.filter(only ?? (() => true));
  if (store.loadError) return el("div", { class: "banner bad", role: "alert" }, el("span", { class: "ic" }, "✕"), el("div", {}, el("strong", {}, "Could not read the chain"), el("p", {}, "The RPC did not answer. Try again in a moment."), el("button", { class: "btn", onclick: () => void refresh() }, "Retry")));
  if (!store.loaded) return el("div", { class: "banner info", role: "status" }, el("span", { class: "spinner" }), el("div", {}, el("strong", {}, "Reading notes from Whitechain…")));
  if (!list.length) {
    const e = el("div", { class: "empty" }, el("h3", {}, "Nothing here yet"), el("p", {}, emptyText));
    return e;
  }
  const LIMIT = 4;
  const shown = store.showAll ? list : list.slice(0, LIMIT);
  return el("div", {}, el("div", { class: "notes" }, ...shown.map((n) => noteCard(n, role))),
    list.length > LIMIT ? el("div", { class: "row" }, el("button", { class: "btn ghost", onclick: () => { store.showAll = !store.showAll; rerender(); void refresh(); } }, store.showAll ? "Show only the newest notes" : `Show ${list.length - LIMIT} older notes`)) : null);
}

// ---------- supplier: create a note for a bound invoice ----------
export function createNotePanel(nullifier: `0x${string}`): HTMLElement {
  const w = activeWallet("supplier");
  const key = `create:${nullifier}`;
  const wrap = el("section", { class: "card", "aria-labelledby": "h-create" }, el("span", { class: "kicker" }, "Step 3"), el("h2", { id: "h-create" }, "Turn it into a note"));
  const existing = store.notes.find((n) => n.nullifier === nullifier);
  if (existing) {
    wrap.append(el("p", { class: "muted" }, "This invoice already has its note."), noteCard(existing, "supplier"));
    return wrap;
  }
  if (!w) return wrap.appendChild(el("p", { class: "muted" }, "No demo wallet loaded.")) && wrap;
  const unit = () => Number(val("c:unit", "60"));
  wrap.append(
    el("p", { class: "muted" }, "Set the terms investors will see. The note's face value comes from the signed invoice, never from this form."),
    el("div", { class: "grid2" },
      field("Due in", "c:due", "10", { type: "number" }),
      field("Unit", "c:unit", "60", { options: [["60", "minutes"], ["3600", "hours"], ["86400", "days"]] }),
      field("Investor discount (%)", "c:disc", "5", { type: "number", hint: "Investors pay (100 − discount)% of face value" }),
      field("Grace after due date (minutes)", "c:grace", "10", { type: "number" }),
      field("Minimum credential tier", "c:tier", "1", { type: "number" }),
    ),
    el("div", { class: "row" }, el("button", {
      class: "btn primary grow", disabled: busy(key),
      onclick: () => {
        const due = Math.round(Number(val("c:due", "10")) * unit());
        const disc = Math.round(Number(val("c:disc", "5")) * 100);
        const grace = Math.round(Number(val("c:grace", "10")) * 60);
        const tier = Number(val("c:tier", "1"));
        if (![due, disc, grace, tier].every(Number.isFinite) || due <= 0 || disc < 0) {
          store.msgs[key] = { kind: "bad", title: "Check the terms", detail: "Use positive numbers for the due time, and zero or more for the discount." };
          return rerender();
        }
        void run(key, "Creating the note…", async () => {
          // the due date is measured from the chain's own clock, read right now
          const dueDate = BigInt((await nowChain()) + due);
          return send(w, factoryAddress, factoryAbi, "createNote", [nullifier, { dueDate, fundingDeadline: dueDate, graceSeconds: BigInt(grace), discountBps: disc, minTier: tier }]);
        }, "Note created", "Investors can fund it once the cool-off ends.");
      },
    }, "Create the note")),
  );
  put(wrap, msgBanner(key));
  return wrap;
}

// ---------- attester desk ----------
async function sign(w: DemoWallet, types: any, primaryType: string, message: any) {
  return w.client.signTypedData({ account: w.client.account!, domain: attesterDomain, types, primaryType, message } as any);
}

export function attesterDesk(): HTMLElement[] {
  const w = activeWallet("attester");
  if (!w) return [];
  const investors = [...walletsFor("investor"), ...walletsFor("debtor"), ...walletsFor("supplier")];
  const issueKey = "att:issue";
  const issueNow = (mode: "arkiv" | "direct") => {
    const subject = val("a:subject", investors[0]?.address ?? "") as Address;
    const secs = Math.round(Number(val("a:len", "5")) * Number(val("a:unit", "60")));
    const tier = Number(val("a:tier", "2"));
    if (!Number.isFinite(secs) || secs <= 0 || !Number.isFinite(tier)) { store.msgs[issueKey] = { kind: "bad", title: "Check the values", detail: "Use a positive validity and a tier number." }; return rerender(); }
    const signIt = async () => {
      const credId = keccak256(toHex(`${subject}:${Date.now()}`));
      const validUntil = (await nowChain()) + secs; // the chain's clock, not this page's estimate
      const message = { subject, tier, jurisdiction: 356, validUntil: BigInt(validUntil), credId };
      const signature = await sign(w, ELIGIBILITY_TYPES, "Eligibility", message);
      return { credId, validUntil, message, signature };
    };
    if (mode === "direct") {
      void run(issueKey, "Signing and registering on Whitechain…", async () => {
        const s = await signIt();
        return send(w, attestersAddress, attestersAbi, "register", [s.message, s.signature]);
      }, "Credential registered directly on Whitechain", "This skipped Arkiv, so nobody else can discover it.");
      return;
    }
    void run(issueKey, "Signing and publishing to Arkiv…", async () => {
      const s = await signIt();
      const r = await publishCredential(arkivWalletFor(w), { subject, attester: w.address, tier, jurisdiction: 356, validUntil: s.validUntil, credId: s.credId, signature: s.signature });
      void refreshArkiv();
      return { hash: r.txHash as `0x${string}`, gasUsed: 0n };
    }, "Credential published on Arkiv", "The investor finds it there and activates it on Whitechain, paying their own fee. Nothing is enforced until then.");
  };
  const issue = el("section", { class: "card", "aria-labelledby": "h-issue" }, el("span", { class: "kicker" }, "Credentials"), el("h2", { id: "h-issue" }, "Issue an investor credential"),
    el("p", { class: "muted" }, "You sign an expiring credential for a wallet and publish it on Arkiv, owned by your wallet. The investor finds it there and registers it on Whitechain. The note contract checks your signature, the expiry and revocation itself."),
    el("div", { class: "grid2" },
      field("Wallet", "a:subject", investors[0]?.address ?? "", { options: investors.map((x): [string, string] => [x.address, x.label]) }),
      field("Tier", "a:tier", "2", { type: "number" }),
      field("Valid for", "a:len", "5", { type: "number" }),
      field("Unit", "a:unit", "60", { options: [["60", "minutes"], ["3600", "hours"], ["86400", "days"]] }),
    ),
    el("div", { class: "row" },
      el("button", { class: "btn primary grow", disabled: busy(issueKey), onclick: () => issueNow("arkiv") }, "Sign and publish to Arkiv"),
      el("button", { class: "btn ghost grow", disabled: busy(issueKey), onclick: () => issueNow("direct") }, "Register directly on Whitechain (skip Arkiv)")),
  );
  put(issue, msgBanner(issueKey));

  const list = el("section", { class: "card", "aria-labelledby": "h-cred" }, el("span", { class: "kicker" }, "Ledger"), el("h2", { id: "h-cred" }, "Credentials issued"));
  if (!store.issued.length) list.append(el("p", { class: "muted" }, "No credentials found yet."));
  const latest = new Map<string, (typeof store.issued)[number]>();
  for (const c of store.issued) if (!latest.has(c.subject.toLowerCase())) latest.set(c.subject.toLowerCase(), c);
  for (const c of latest.values()) {
    const e = store.elig[c.subject.toLowerCase()];
    const rk = `att:rev:${c.credId}`;
    list.append(el("div", { class: "cred" },
      el("div", {}, el("strong", {}, nameOf(c.subject) ?? short(c.subject, 8, 6)), " ", e ? el("span", { class: e.reason === "Eligible" ? "badge real" : "badge bad" }, e.reason === "Eligible" ? "Valid" : e.reason) : null),
      el("p", { class: "foot" }, `Expires ${when(c.validUntil)} · `, el("a", { href: txUrl(c.tx), target: "_blank", rel: "noopener" }, "registered here")),
      e && e.reason === "Eligible" && e.credId === c.credId ? el("button", {
        class: "btn", disabled: busy(rk),
        onclick: () => void run(rk, "Signing the revocation, publishing it on Arkiv and applying it…", async () => {
          const sig = await sign(w, REVOCATION_TYPES, "Revocation", { credId: c.credId });
          let note = "";
          try {
            await publishRevocation(arkivWalletFor(w), { attester: w.address, credId: c.credId, signature: sig }, c.validUntil);
            void refreshArkiv();
          } catch { note = " Arkiv could not be reached, so only Whitechain was updated."; }
          const sent = await send(w, attestersAddress, attestersAbi, "revoke", [{ credId: c.credId }, sig]);
          store.msgs[rk] = { kind: "ok", title: "Credential revoked", detail: "Published on Arkiv and applied on Whitechain. The wallet can no longer receive notes, but can still redeem what it holds." + note, hash: sent.hash };
          return undefined;
        }, "Credential revoked"),
      }, "Revoke") : null,
      msgBanner(rk)));
  }

  const sellerKey = "att:seller";
  const sellers = walletsFor("supplier");
  const bind = el("section", { class: "card", "aria-labelledby": "h-sbind" }, el("span", { class: "kicker" }, "Anti-squatting"), el("h2", { id: "h-sbind" }, "Authorise a seller wallet"),
    el("p", { class: "muted" }, "Only the wallet you bind to a seller's GSTIN can register that seller's invoices. Someone who merely holds the QR is refused."),
    el("div", { class: "grid2" },
      field("Seller GSTIN", "s:gstin", "27DEMOS1234A1Z5"),
      field("Wallet", "s:wallet", sellers[0]?.address ?? "", { options: sellers.map((x): [string, string] => [x.address, x.label]) }),
    ),
    el("div", { class: "row" }, el("button", {
      class: "btn dark grow", disabled: busy(sellerKey),
      onclick: () => void run(sellerKey, "Signing and registering…", async () => {
        const gstin = val("s:gstin", "27DEMOS1234A1Z5").toUpperCase();
        const gstinHash = keccak256(toHex(gstin));
        const cur = (await publicClient.readContract({ address: registryAddress, abi: registryAbi, functionName: "sellers", args: [gstinHash] })) as readonly [Address, bigint, bigint];
        const message = { gstinHash, wallet: val("s:wallet", sellers[0]?.address ?? "") as Address, validUntil: BigInt((await nowChain()) + 7 * 86400), version: cur[2] + 1n };
        const sig = await sign(w, SELLER_BINDING_TYPES, "SellerBinding", message);
        return send(w, registryAddress, registryAbi, "registerSeller", [message, sig]);
      }, "Seller wallet authorised", "Valid for 7 days. A newer binding replaces an older one."),
    }, "Sign and register")),
    msgBanner(sellerKey),
  );
  return [issue, list, bind];
}
