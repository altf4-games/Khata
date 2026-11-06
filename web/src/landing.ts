// The public front page. Its prompt-style box is the real input: it hands the invoice text to the app, which checks it on-chain.
import skylineSvg from "./art/skyline.svg?raw";
import garlandSvg from "./art/garland.svg?raw";
import trainSvg from "./art/train.svg?raw";
import sunSvg from "./art/sun.svg?raw";
import birdsSvg from "./art/birds.svg?raw";
import cloudA from "./art/cloud-a.svg?raw";
import cloudB from "./art/cloud-b.svg?raw";
import cloudC from "./art/cloud-c.svg?raw";
import fillerUrl from "./art/filler.svg?url";
import { el } from "./ui";

export const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="4" width="32" height="40" rx="4" fill="#7d1816"/><rect x="10" y="4" width="28" height="40" rx="3" fill="#a3211f"/><rect x="8" y="19" width="32" height="8" fill="#f5b301"/><circle cx="24" cy="23" r="2.2" fill="#a3211f"/><path d="M15 10h18M15 14h18M15 33h18M15 37h12" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const ICON = {
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7 10l5-5 5 5M5 19h14"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>`,
};

export type LandingHandlers = {
  getToken(): string;
  setText(t: string): void;
  /** Open the app on the supplier page and check this text. */
  open(token?: string): void;
  openRole(role: "supplier" | "investor" | "debtor" | "attester"): void;
  scan(): void;
  onFile(ev: Event): void;
  nicSample(): string;
  demoInvoice(): void;
  demoBusy(): boolean;
  tamper(): void;
};

function svgBox(cls: string, markup: string) {
  const d = el("div", { class: cls });
  d.innerHTML = markup;
  return d;
}

export function landing(h: LandingHandlers): HTMLElement {
  const ta = el("textarea", {
    id: "land-token", rows: 2, spellcheck: "false", autocomplete: "off", autocapitalize: "off",
    placeholder: "Paste the text of a GST e-invoice QR here (it starts with eyJ…), or scan it.",
    "aria-label": "E-invoice QR text",
  });
  ta.value = h.getToken();
  ta.addEventListener("input", () => h.setText(ta.value));
  const file = el("input", { type: "file", accept: "image/*", class: "sr-only", id: "land-file", onchange: h.onFile });

  const chip = (icon: string, label: string, fn: () => void, disabled = false, extra = "") => {
    const b = el("button", { class: `example ${extra}`.trim(), type: "button", onclick: fn, disabled });
    b.innerHTML = icon;
    b.append(label);
    return b;
  };
  const iconBtn = (icon: string, label: string, fn: () => void) => {
    const b = el("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, onclick: fn });
    b.innerHTML = icon;
    return b;
  };
  const uploadLabel = el("label", { class: "icon-btn", for: "land-file", tabindex: "0", title: "Upload a photo of the QR", "aria-label": "Upload a photo of the QR",
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } } });
  uploadLabel.innerHTML = ICON.upload;

  const go = el("button", { class: "btn primary", type: "button", onclick: () => h.open(ta.value.trim() || undefined) }, "Check this invoice");

  const hero = el("section", { class: "hero" },
    // drifting clouds, a bird flock and a turning sun: decoration only, and still when the visitor prefers reduced motion
    el("div", { class: "clouds", "aria-hidden": "true" },
      svgBox("cloud a", cloudA), svgBox("cloud b", cloudB), svgBox("cloud c", cloudC), svgBox("cloud d", cloudA), svgBox("flock", birdsSvg)),
    (() => { const g = el("div", { class: "garland", "aria-hidden": "true" }); const row = el("div", { class: "garland-row" }); for (let i = 0; i < 4; i++) row.append(svgBox("tile", garlandSvg)); g.append(row); return g; })(),
    el("div", { class: "wrap" },
      el("span", { class: "eyebrow" }, "Invoice financing, checked against the government signature"),
      (() => { const t = el("h1", {}); t.innerHTML = `Finance the invoice, not the <em>fraud.</em>`; return t; })(),
      el("p", { class: "sub" }, "A smart contract checks the tax network's own signature on a GST e-invoice QR, and refuses to finance the same invoice twice. Settled in real USDT."),
      el("div", { class: "prompt" }, ta, file,
        el("div", { class: "tools" },
          el("div", { class: "left" }, iconBtn(ICON.camera, "Scan with the camera", h.scan), uploadLabel),
          go)),
      el("div", { class: "examples", "aria-label": "Try an example" },
        chip(ICON.doc, "NIC sample QR", () => h.open(h.nicSample())),
        chip(ICON.flag, h.demoBusy() ? "Finding one…" : "Demo invoice (DEMO IRP key)", h.demoInvoice, h.demoBusy(), "extra"),
        chip(ICON.edit, "Change one byte, watch it fail", h.tamper)),
    ),
    el("div", { class: "skyline", role: "img", "aria-label": "Ink illustration of a Mumbai waterfront with a clock tower, a stone gateway, a domed hotel, a sea bridge and a local train passing" },
      el("div", { class: "sky-fill", style: `background-image:url(${fillerUrl})` }),
      (() => { const art = el("div", { class: "sky-art" }); art.append(svgBox("sun", sunSvg)); art.insertAdjacentHTML("beforeend", skylineSvg); return el("div", { class: "sky-cluster" }, art); })(),
      el("div", { class: "rail" }, svgBox("train", trainSvg))),
  );

  const trust = el("div", { class: "trust" }, el("ul", {},
    el("li", {}, "RS256 checked on-chain"), el("li", {}, "One IRN, one note"), el("li", {}, "Reads over Tor"), el("li", {}, "Real USDT settlement")));

  const mockVerified = el("div", { class: "mock" }, el("span", { class: "cap" }, "What you see"),
    el("div", { class: "stamp-row" }, el("span", { class: "stamp ok" }, "Verified"), el("p", { class: "verdict" }, "The contract checked the RS256 signature itself. No server vouches for it.")));
  mockVerified.insertAdjacentHTML("beforeend", `<dl class="facts"><dd class="g">Signature</dd><dt>Signing key (kid)</dt><dd><span class="mono">4DE1544AE695BDC84EC7BC12F2F57F813F44E301</span> <span class="badge real">NIC key</span></dd><dt>RS256 signature</dt><dd><span class="check">✓ matches</span></dd><dd class="g">Invoice</dd><dt>IRN</dt><dd><span class="mono">d9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17</span></dd></dl><p class="foot">This is the tax network's own published sample invoice, a real signed e-invoice.</p>`);

  const mockRefused = el("div", { class: "mock" }, el("span", { class: "cap" }, "What you see"),
    el("div", { class: "stamp-row", role: "presentation" }, el("span", { class: "stamp bad" }, "Refused"), el("p", { class: "verdict" }, "That wallet has no valid credential, so it cannot hold these notes.")));
  mockRefused.insertAdjacentHTML("beforeend", `<div class="banner info"><span class="ic">i</span><div><strong>Credentials come from Arkiv</strong><p>A trusted attester signs a short-lived credential. The note contract checks it on Whitechain on every transfer.</p></div></div>`);

  const mockReads = el("div", { class: "mock" }, el("span", { class: "cap" }, "What you see"));
  mockReads.insertAdjacentHTML("beforeend", `<div class="chips" style="justify-content:flex-start"><span class="chip"><span class="dot on"></span>Whitechain Sepolia testnet</span><span class="chip reads ok"><span class="dot"></span>Reads: Anon-RPC</span></div><div class="banner info"><span class="spinner"></span><div><strong>Starting Anon-RPC</strong><p>Opening a private route over Tor so the RPC providers cannot link your address to the invoices you look at.</p></div></div><p class="foot">Writes are not anonymous. The reads chip counts every request, so you can see what share goes through Tor.</p>`);

  const band = (flip: boolean, alt: boolean, label: string, title: string, text: string, ticks: string[], mock: HTMLElement, id?: string) =>
    el("section", { class: `band${flip ? " flip" : ""}${alt ? " alt" : ""}`, id },
      el("div", { class: "wrap" },
        el("div", { class: "copy" }, el("span", { class: "label" }, label), el("h2", {}, title), el("p", {}, text),
          el("ul", { class: "ticks" }, ...ticks.map((t) => el("li", {}, t)))),
        mock));

  const how = el("section", { class: "band", id: "how" }, el("div", { class: "wrap", style: "display:block" },
    el("div", { class: "section-title" }, el("span", { class: "label" }, "How it works"), el("h2", {}, "From a paper invoice to cash in three steps.")),
    el("div", { class: "how" },
      el("div", { class: "step" }, el("b", {}, "01"), el("h3", {}, "Scan the QR"), el("p", {}, "The supplier scans the e-invoice QR. The contract verifies the government's signature and records the invoice's IRN once.")),
      el("div", { class: "step" }, el("b", {}, "02"), el("h3", {}, "Sell a slice, at a discount"), el("p", {}, "The supplier mints notes against the invoice. Investors with a valid credential buy them and the USDT goes straight to the supplier.")),
      el("div", { class: "step" }, el("b", {}, "03"), el("h3", {}, "The buyer pays on the due date"), el("p", {}, "The debtor pays the face value in USDT. Holders redeem their share, and the note contract enforces every rule on each transfer.")))));

  const cta = el("section", { class: "cta" }, el("div", { class: "wrap", style: "display:block" },
    el("h2", {}, "Try all four roles in one tab."),
    el("p", {}, "Supplier, investor, debtor and attester share this page, each with its own demo wallet. It runs on Whitechain Sepolia, so nothing here has real value."),
    el("button", { class: "btn primary", type: "button", onclick: () => h.open() }, "Open the app")));

  const head = el("header", { class: "land-head" }, el("div", { class: "wrap" },
    (() => { const b = el("a", { class: "brand", href: "#" }); b.innerHTML = LOGO; b.append("Khata"); return b; })(),
    el("div", { class: "land-links" }, el("a", { class: "link", href: "#how" }, "How it works"),
      el("button", { class: "btn dark", type: "button", onclick: () => h.open() }, "Open app"))));

  return el("div", { class: "land" }, head, hero, trust,
    band(false, false, "Verified, not vouched", "The signature is checked by the contract, not a server.",
      "India's tax network signs every B2B e-invoice QR. Khata verifies that RS256 signature inside the smart contract, so there is no oracle or API to trust.",
      ["The government's key, registered on-chain", "A changed byte fails the check", "One financing per IRN, ever"], mockVerified),
    band(true, true, "Rules that hold", "Notes only move between wallets with a valid credential.",
      "Each invoice becomes its own ERC-20 note. Transfers are enforced in the contract: the receiver needs a short-lived credential signed by a registered attester.",
      ["Credentials expire and can be revoked", "Credentials and listings live on Arkiv", "Refusals read as plain messages, not revert strings"], mockRefused),
    band(false, false, "Private reads", "Look at invoices without telling the RPC who you are.",
      "Every chain read goes through Anon-RPC by default. If Tor cannot start you get a clear choice, never a silent fallback to a direct connection.",
      ["Reads routed over Tor in your browser", "A live counter of how much goes through it", "Writes are not anonymous, and the app says so"], mockReads),
    how, cta);
}
