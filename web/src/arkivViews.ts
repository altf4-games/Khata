// Views that read from Arkiv: the credential panel, the marketplace, and the supplier's listing button.
import { emptyBox } from "./spots";
import type { Hex } from "viem";
import { attestersAbi, attestersAddress, addressUrl } from "./chain";
import { el, put, short } from "./ui";
import { refreshArkiv, run, store } from "./store";
import { busy, field, msgBanner, noteCard, nowEst, until } from "./views";
import { arkivWalletFor } from "./arkivApp";
import { extendListing, pickActivatable, publishListing, setListingStatus } from "./arkiv";
import { usdt, when, type NoteInfo } from "./notes";
import { nameOf, type DemoWallet, type Role } from "./wallets";
import { send } from "./tx";

function arkivDown(): HTMLElement | null {
  return store.arkivError
    ? el("div", { class: "banner warn", role: "alert" }, el("span", { class: "ic" }, "!"), el("div", {}, el("strong", {}, "Arkiv is not answering"), el("p", {}, store.arkivError, " What Whitechain already knows is unaffected."), el("button", { class: "btn", onclick: () => void refreshArkiv() }, "Retry")))
    : null;
}

// ---------- the wallet's credential, found on Arkiv and activated on Whitechain ----------
export function credentialPanel(w: DemoWallet): HTMLElement {
  const key = `cred:${w.address}`;
  const k = w.address.toLowerCase();
  const e = store.elig[k];
  const panel = el("section", { class: "card", "aria-labelledby": "h-mycred" }, el("span", { class: "kicker" }, "Arkiv → Whitechain"), el("h2", { id: "h-mycred" }, "Your credential"));
  put(panel, arkivDown());
  if (!store.arkiv) {
    if (!store.arkivError) panel.append(el("div", { class: "banner info", role: "status" }, el("span", { class: "spinner" }), el("div", {}, el("strong", {}, "Looking for your credential on Arkiv…"))));
    return panel;
  }
  const mine = store.arkiv.credentials.filter((c) => c.rec.subject.toLowerCase() === k);
  const good = pickActivatable(mine, store.arkiv.revocations);
  const bad = mine.filter((c) => !c.ok);
  const active = e && e.reason === "Eligible";

  if (active) {
    panel.append(el("div", { class: "banner ok" }, el("span", { class: "ic" }, "✓"), el("div", {}, el("strong", {}, "Active on Whitechain"),
      el("p", {}, `Tier ${e.tier}. Expires ${when(e.validUntil)} (`, until(e.validUntil), "). The note contract checks this itself on every transfer."))));
  } else {
    panel.append(el("p", { class: "muted" }, e ? `Whitechain says this wallet is not eligible (${e.reason}).` : "Whitechain has no credential for this wallet."));
  }
  if (good && (!active || e!.credId?.toLowerCase() !== good.rec.credId.toLowerCase())) {
    const c = good.rec;
    panel.append(
      el("div", { class: "banner info" }, el("span", { class: "ic" }, "i"), el("div", {}, el("strong", {}, "Found on Arkiv"), el("p", {}, `A credential from ${nameOf(c.attester) ?? short(c.attester)} is published for this wallet (tier ${c.tier}, expires ${when(c.validUntil)}). Its signature checks out. It only counts once it is registered on Whitechain, which you pay for, not the attester.`))),
      el("div", { class: "row" }, el("button", {
        class: "btn primary grow", disabled: busy(key),
        onclick: () => void run(key, "Registering on Whitechain…", () => send(w, attestersAddress, attestersAbi, "register", [
          { subject: c.subject, tier: c.tier, jurisdiction: c.jurisdiction, validUntil: BigInt(c.validUntil), credId: c.credId }, c.signature,
        ], 300_000n), "Credential activated", "The wallet can now receive notes until it expires."),
      }, "Activate on Whitechain")),
    );
  } else if (!good && !active) {
    panel.append(emptyBox("No credential on Arkiv", "Ask an attester to publish one for this wallet. Switch to the attester role to do that."));
  }
  // a verified revocation that Whitechain has not seen yet
  if (active && e?.credId) {
    const rev = store.arkiv.revocations.find((r) => r.ok && r.rec.credId.toLowerCase() === e.credId!.toLowerCase());
    if (rev) {
      const rk = `rev:${rev.rec.credId}`;
      panel.append(
        el("div", { class: "banner bad", role: "alert" }, el("span", { class: "ic" }, "✕"), el("div", {}, el("strong", {}, "The attester revoked this credential"), el("p", {}, "The revocation is published on Arkiv, but Whitechain only enforces it once someone submits it. Anyone can."))),
        el("div", { class: "row" }, el("button", {
          class: "btn dark grow", disabled: busy(rk),
          onclick: () => void run(rk, "Submitting the revocation…", () => send(w, attestersAddress, attestersAbi, "revoke", [{ credId: rev.rec.credId }, rev.rec.signature], 300_000n), "Revocation applied on Whitechain"),
        }, "Apply the revocation on Whitechain")),
      );
      put(panel, msgBanner(rk));
    }
  }
  if (bad.length) {
    panel.append(el("details", { class: "panel" }, el("summary", {}, `${bad.length} credential${bad.length > 1 ? "s" : ""} on Arkiv for this wallet ignored`),
      ...bad.map((c) => el("p", { class: "foot" }, `${short(c.rec.credId, 10, 6)}: ${c.reason}`))));
  }
  put(panel, msgBanner(key));
  return panel;
}

// ---------- marketplace ----------
export function marketplace(role: Role): HTMLElement {
  const wrap = el("section", { class: "card", "aria-labelledby": "h-market" }, el("span", { class: "kicker" }, "Read from Arkiv"), el("h2", { id: "h-market" }, "Marketplace"),
    el("p", { class: "muted" }, "Sellers publish listings on Arkiv. Each one is checked against Whitechain before it is shown here: the factory must have made that note for that invoice, and the seller must own both."),
    el("div", { class: "grid2" },
      field("Status", "m:status", "open", { options: [["open", "Open"], ["closed", "Closed"], ["", "All"]] }),
      field("Minimum discount (%)", "m:disc", "0", { type: "number", hint: "Filtered by the Arkiv query itself" }),
      field("Due within", "m:due", "0", { options: [["0", "Any time"], ["3600", "1 hour"], ["86400", "1 day"], ["604800", "7 days"]] }),
      field("Sort by", "m:sort", "due", { options: [["due", "Due date, soonest first"], ["discount", "Highest discount first"]] }),
    ),
    el("div", { class: "row", style: "margin-top:0" }, el("button", { class: "btn", onclick: () => void refreshArkiv() }, "Apply filters")));
  put(wrap, arkivDown());
  if (!store.arkiv) {
    if (!store.arkivError) wrap.append(el("div", { class: "banner info", role: "status" }, el("span", { class: "spinner" }), el("div", {}, el("strong", {}, "Reading listings from Arkiv…"))));
    return wrap;
  }
  // A seller can forget to update a listing, so for "open" the chain has the last word: a note that has settled,
  // defaulted or stopped taking funding is not shown as open even if its listing still says so.
  const wantsOpen = (store.form["m:status"] ?? "open") === "open";
  const stale = (addr: string) => {
    const n = store.notes.find((x) => x.address.toLowerCase() === addr.toLowerCase());
    return !!n && (n.phase !== "Funding" || n.fundingClosed);
  };
  const good = store.arkiv.listings.filter((l) => l.ok && !(wantsOpen && stale(l.rec.note)));
  const ignored = store.arkiv.listings.filter((l) => !l.ok);
  if (!good.length) wrap.append(emptyBox("No listings match", "Sellers publish a listing after creating a note. Widen the filters, or switch to the supplier role to create one."));
  const cards = el("div", { class: "notes one" }); // one column: this card already sits in half the page width
  for (const l of good) {
    const n = store.notes.find((x) => x.address.toLowerCase() === l.rec.note.toLowerCase());
    cards.append(el("div", {}, el("p", { class: "foot" }, el("span", { class: "badge real" }, "Listed on Arkiv"), " ", l.rec.title, " · yield ", `${(l.rec.discountBps / 100).toFixed(2)}% discount`),
      n ? noteCard(n, role) : el("p", { class: "muted" }, "Open the note: ", el("a", { href: addressUrl(l.rec.note) }, short(l.rec.note)))));
  }
  wrap.append(cards);
  if (ignored.length) {
    wrap.append(el("details", { class: "panel" }, el("summary", {}, `${ignored.length} listing${ignored.length > 1 ? "s" : ""} ignored`),
      ...ignored.map((l) => el("p", { class: "foot" }, `${short(l.rec.entityKey, 10, 6)} by ${nameOf(l.rec.owner) ?? short(l.rec.owner)}: ${l.reason}`))));
  }
  return wrap;
}

// ---------- supplier: publish the listing ----------
export function listingControl(n: NoteInfo, w: DemoWallet): HTMLElement | null {
  if (n.seller.toLowerCase() !== w.address.toLowerCase()) return null;
  const key = `list:${n.address}`;
  const existing = store.arkiv?.ownListings.find((l) => l.rec.note.toLowerCase() === n.address.toLowerCase() && l.rec.owner.toLowerCase() === w.address.toLowerCase());
  if (existing) {
    const inGrace = nowEst() > n.dueDate && n.phase === "Funding";
    const xk = `extend:${n.address}`;
    return el("div", {}, el("p", { class: "foot" }, el("span", { class: "badge real" }, existing.rec.status === "open" ? "Listed on Arkiv" : `Listing ${existing.rec.status}`)),
      inGrace ? el("div", { class: "row" }, el("button", {
        class: "btn", disabled: busy(xk),
        onclick: () => void run(xk, "Extending the listing…", async () => {
          const r = await extendListing(arkivWalletFor(w), existing.rec.entityKey, 3600);
          void refreshArkiv();
          return { hash: r.txHash as Hex, gasUsed: 0n };
        }, "Listing extended by an hour", "It stays visible while the debtor is in the grace period."),
      }, "Extend the listing")) : null,
      inGrace ? msgBanner(xk) : null);
  }
  if (!store.arkiv) return null;
  return el("div", { class: "panel" }, el("h4", {}, "Marketplace"),
    el("p", { class: "foot" }, "Publish a listing on Arkiv so investors can find this note. Needs a little Arkiv testnet gas (tGLM) on this wallet."),
    el("button", {
      class: "btn primary", disabled: busy(key),
      onclick: () => void run(key, "Publishing the listing on Arkiv…", async () => {
        const rec = { note: n.address, seller: n.seller, nullifier: n.nullifier as Hex, faceValue: n.faceValue, discountBps: n.discountBps, dueDate: n.dueDate, minTier: n.minTier, status: "open", title: `${usdt(n.faceValue)} USDT invoice note due ${when(n.dueDate)}` };
        const r = await publishListing(arkivWalletFor(w), rec, n.graceSeconds);
        void refreshArkiv();
        return { hash: r.txHash as Hex, gasUsed: 0n };
      }, "Listed on Arkiv", "Investors can now find it in the marketplace."),
    }, "List on the marketplace"),
    msgBanner(key));
}

export async function closeListing(n: NoteInfo, w: DemoWallet) {
  const l = store.arkiv?.ownListings.find((x) => x.rec.note.toLowerCase() === n.address.toLowerCase() && x.rec.owner.toLowerCase() === w.address.toLowerCase());
  if (l && l.rec.status === "open") await setListingStatus(arkivWalletFor(w), l.rec.entityKey, "closed");
}
