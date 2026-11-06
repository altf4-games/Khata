import "./styles.css";
import { landing, LOGO } from "./landing";
import { SPOTS, emptyBox, spot } from "./spots";
import garlandSvg from "./art/garland.svg?raw";
import nicSample from "../../contracts/test/fixtures/nic-sample.token?raw";
import demoInvoices from "./demo-invoices.json";
import {
  abi, addressUrl, DUMMY_SENDER, factoryAbi, factoryAddress, inspect, publicClient, registryAddress, revertInfo, simulateBind, txUrl,
  type Inspection,
} from "./chain";
import { el, short } from "./ui";
import { activeWallet, refresh, rerender, run, setRender, store } from "./store";
import { attesterDesk, createNotePanel, msgBanner, notesList, nowEst, walletBar } from "./views";
import { send } from "./tx";
import { walletsFor, type Role } from "./wallets";
import { credentialPanel, marketplace } from "./arkivViews";
import { chipText, chooseDirect, useAnon, slowAfterMs, onState, onTraffic, retryAnon, startAnon, state as anonState } from "./anon";
import { startWatching } from "./arkivApp";
import { refreshArkiv } from "./store";
import { refusalFor } from "./errors";
import { evidencePage } from "./evidence";
import { classify, formatRupees } from "./verdict";
import { decodeImageFile, startCamera, type CameraScan } from "./scan";

// ---------- state ----------
type View =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; r: Inspection }
  | { kind: "refused"; title: string; detail: string };

type Action =
  | { kind: "none" }
  | { kind: "simulating" }
  | { kind: "readOnly" }
  | { kind: "sending" }
  | { kind: "done"; hash: string; gas: bigint }
  | { kind: "refused"; title: string; detail: string };

const state = {
  token: "",
  checkedToken: "", // the exact text the panel currently describes
  cameraStarting: false,
  view: { kind: "idle" } as View,
  action: { kind: "none" } as Action,
  camera: undefined as CameraScan | undefined,
  cameraNote: "",
};

// One persistent element, so re-rendering the page does not detach the live camera stream.
const camVideo = el("video", { id: "cam", muted: true, playsinline: true, "aria-label": "Camera preview" });

let checkSeq = 0;
async function check() {
  const token = state.token.trim();
  const seq = ++checkSeq;
  state.action = { kind: "none" };
  state.checkedToken = "";
  if (!token) {
    state.view = { kind: "idle" };
    return render();
  }
  state.view = { kind: "checking" };
  render();
  try {
    const r = await inspect(token);
    if (seq !== checkSeq) return;
    state.checkedToken = token;
    state.view = { kind: "result", r };
  } catch (e) {
    if (seq !== checkSeq) return;
    state.checkedToken = "";
    const info = revertInfo(e);
    state.view = { kind: "refused", ...refusalFor(info.name, info.args, info.message) };
  }
  render();
}

async function finance() {
  // Only ever act on the exact text the panel has verified, never on whatever is in the box right now.
  const token = state.checkedToken;
  if (!token || state.token.trim() !== token) return;
  const w = activeWallet("supplier");
  state.action = { kind: "simulating" };
  render();
  try {
    await simulateBind(token, w?.address ?? DUMMY_SENDER);
  } catch (e) {
    if (state.checkedToken !== token) return;
    const info = revertInfo(e);
    state.action = { kind: "refused", ...refusalFor(info.name, info.args, info.message) };
    return render();
  }
  if (state.checkedToken !== token) return;
  if (!w) {
    state.action = { kind: "readOnly" };
    return render();
  }
  state.action = { kind: "sending" };
  render();
  try {
    // bindInvoice verifies the RSA signature and parses the payload before it can refuse, so give it a fixed gas budget.
    const sent = await send(w, registryAddress, abi, "bindInvoice", [token], 1_500_000n);
    if (state.checkedToken !== token) return; // the user moved on to another invoice; do not claim it here
    state.action = { kind: "done", hash: sent.hash, gas: sent.gasUsed };
    await refreshAfterBind(token);
    void refresh();
  } catch (e) {
    if (state.checkedToken !== token) return;
    const info = revertInfo(e);
    state.action = { kind: "refused", ...refusalFor(info.name, info.args, info.message) };
  }
  render();
}
async function refreshAfterBind(token: string) {
  // refresh the panel so it shows "already financed" after our own transaction
  try {
    const r = await inspect(token);
    if (state.checkedToken === token) state.view = { kind: "result", r };
  } catch {}
}

let demoBusy = false;
async function useDemoInvoice() {
  demoBusy = true;
  render();
  try {
    for (const d of demoInvoices) {
      const r = await inspect(d.token).catch(() => undefined);
      if (r && !r.alreadyBound) return setToken(d.token);
    }
    state.view = { kind: "refused", title: "All prepared demo invoices are used", detail: "Run npm run gen:demo-invoices to sign a fresh batch." };
  } finally {
    demoBusy = false;
    render();
  }
}

function flipOneByte() {
  const t = state.token;
  const i = t.indexOf(".") + 40;
  if (i < 40 || i >= t.length) return;
  state.token = t.slice(0, i) + (t[i] === "A" ? "B" : "A") + t.slice(i + 1);
  void check();
}

function setToken(t: string) {
  state.token = t;
  void check();
}

async function toggleCamera() {
  if (state.cameraStarting) return;
  if (state.camera) {
    state.camera.stop();
    state.camera = undefined;
    state.cameraNote = "";
    return render();
  }
  state.cameraNote = "Starting the camera…";
  state.cameraStarting = true;
  render();
  const video = camVideo;
  state.camera = await startCamera(video, {
    onText: (text) => {
      state.camera = undefined;
      state.cameraNote = "QR code found. Checking the signature…";
      setToken(text);
    },
    onStatus: (note) => { state.cameraNote = note; if (state.camera || state.cameraStarting) render(); },
    onError: (err) => {
      state.camera = undefined;
      state.cameraNote =
        err.name === "NotAllowedError"
          ? "Camera permission was denied. Upload a photo of the QR, or paste its text."
          : "No camera could be started here. Upload a photo of the QR, or paste its text.";
      render();
    },
  });
  state.cameraStarting = false;
  if (state.camera) render();
}

async function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await decodeImageFile(file);
    if (text) setToken(text);
    else {
      state.view = { kind: "refused", title: "No QR code found in that picture", detail: "Try a sharper photo with the whole QR in frame, or paste the QR text." };
      render();
    }
  } catch {
    state.view = { kind: "refused", title: "That file could not be read as an image", detail: "Choose a PNG or JPG photo of the QR code." };
    render();
  }
  input.value = "";
}

// ---------- views ----------
const ROLES: { id: Role; label: string; note: string }[] = [
  { id: "supplier", label: "Supplier", note: "issues the invoice" },
  { id: "investor", label: "Investor", note: "funds the note" },
  { id: "debtor", label: "Debtor", note: "pays on due date" },
  { id: "attester", label: "Attester", note: "signs credentials" },
];

function roughDefs() {
  const d = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  d.setAttribute("width", "0");
  d.setAttribute("height", "0");
  d.setAttribute("aria-hidden", "true");
  d.style.position = "absolute";
  d.innerHTML = `<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter>`;
  return d;
}

function topbar() {
  const brand = el("a", { class: "brand", href: "#", "aria-label": "Khata home" });
  brand.innerHTML = LOGO;
  brand.append("Khata");
  return el("div", { class: "bar" }, el("div", { class: "wrap" }, brand,
    el("div", { class: "chips" },
      el("span", { class: "chip hide-sm" }, el("span", { class: "dot on" }), "Whitechain Sepolia testnet"),
      readsChip(),
      readsToggle(),
    )));
}

function readsChip() {
  const c = chipText();
  const chip = el("span", { class: `chip reads ${c.tone}`, title: c.title, "data-testid": "reads-chip" }, el("span", { class: "dot" }), c.text);
  return chip;
}
/** One tap between private reads and direct reads, so a visitor who only wants to get in is never stuck waiting for Tor. */
function readsToggle() {
  const direct = anonState.kind === "direct";
  return el("button", {
    class: "chip-btn", "data-testid": "reads-toggle", type: "button",
    title: direct ? "Read through Anon-RPC again: slower to start, hides your IP address from the RPC providers." : "Skip the private route and read straight from the RPC providers. Faster to start, but they see your IP address.",
    onclick: direct ? useAnon : chooseDirect,
  }, direct ? "Use Anon-RPC" : "Read directly (not anonymous)");
}
/** Updates the chip in place when only the counters changed, so a read does not re-render the whole page. */
function refreshChip() {
  const old = document.querySelector('[data-testid="reads-chip"]');
  if (old) old.replaceWith(readsChip());
}

/** What Anon-RPC is doing: a warm-up panel while Tor starts, and a plain failure message with a choice, never a silent fallback. */
function anonBanner(): HTMLElement | null {
  const s = anonState;
  if (s.kind === "starting") {
    return el("div", { class: "wrap" }, el("div", { class: "banner info", role: "status" }, el("span", { class: "spinner" }),
      el("div", {}, el("strong", {}, "Starting Anon-RPC"),
        el("p", {}, "Opening a private route over " + s.network + " so the RPC providers cannot link your address to the invoices you look at. It takes about 15 seconds the first time. Reads are queued and run privately as soon as it is ready (", el("span", { "data-anon-elapsed": String(s.since) }, "0 s"), ")."),
        s.lines.length ? el("p", { class: "foot mono" }, s.lines[s.lines.length - 1]) : null,
        // Tor sometimes cannot reach a guard and backs off for minutes, so a slow start is offered a choice, never an automatic fallback
        el("div", { "data-anon-slow": String(s.since), hidden: true },
          el("p", {}, "This is taking longer than usual: Tor is retrying a connection. You can keep waiting, start over, or read directly (not anonymous)."),
          el("div", { class: "row" },
            el("button", { class: "btn", onclick: retryAnon }, "Start over"),
            el("button", { class: "btn ghost", onclick: chooseDirect }, "Read directly (not anonymous)"))))));
  }
  if (s.kind === "failed") {
    return el("div", { class: "wrap" }, el("div", { class: "banner bad", role: "alert" }, el("span", { class: "ic" }, "✕"),
      el("div", {}, el("strong", {}, "Anonymous reads are unavailable"),
        el("p", {}, "Anon-RPC could not start (", s.why, "). Nothing is being read in the meantime. You can try again, or read directly: that works, but the RPC providers will see your IP address."),
        el("div", { class: "row" },
          el("button", { class: "btn dark", onclick: retryAnon }, "Retry anonymous reads"),
          el("button", { class: "btn ghost", onclick: chooseDirect }, "Read directly (not anonymous)")))));
  }
  return null;
}

const ROLE_ICONS: Record<Role, string> = {
  supplier: `<path d="M5 20V9l7-5 7 5v11M9 20v-6h6v6"/>`,
  investor: `<path d="M4 18l5-5 3 3 7-8M15 8h4v4"/>`,
  debtor: `<path d="M4 7h16v11H4zM4 11h16M8 15h3"/>`,
  attester: `<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4"/>`,
};
function roleIcon(r: Role): Node {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ROLE_ICONS[r];
  return s;
}

function roleSwitch() {
  const roles = el("ul", { class: "roles", role: "tablist", "aria-label": "Choose a role" });
  for (const r of ROLES) {
    roles.append(el("li", {}, el("button", {
      class: "role-btn", role: "tab", "aria-selected": String(store.role === r.id),
      onclick: () => { store.role = r.id; render(); void refresh(); },
    }, roleIcon(r.id), r.label, el("small", {}, r.note))));
  }
  return el("nav", { class: "switch", "aria-label": "Role switcher" }, el("div", { class: "wrap" }, roles));
}

function steps() {
  const v = state.view;
  const verified = v.kind === "result" && v.r.signatureValid;
  const bound = state.action.kind === "done" || (v.kind === "result" && v.r.alreadyBound);
  const cur = bound ? 3 : verified ? 3 : v.kind === "idle" ? 1 : 2;
  const item = (n: number, label: string) => {
    const done = n === 1 ? v.kind !== "idle" : n === 2 ? verified : bound;
    return el("li", { class: done && n !== cur ? "done" : "", "aria-current": n === cur ? "step" : undefined }, el("b", {}, done && n !== cur ? "✓" : String(n)), label);
  };
  return el("ol", { class: "steps", "aria-label": "Progress" }, item(1, "Scan"), item(2, "Verify"), item(3, "Finance"));
}

function inputCard() {
  const ta = el("textarea", {
    id: "token", rows: 5, spellcheck: "false", autocomplete: "off", autocapitalize: "off",
    placeholder: "Paste the text of the e-invoice QR here (it starts with eyJ…)",
    "aria-label": "E-invoice QR text",
    oninput: (e: Event) => { state.token = (e.target as HTMLTextAreaElement).value; debounceCheck(); },
  });
  ta.value = state.token;
  camVideo.style.display = state.camera || state.cameraNote.startsWith("Starting") ? "" : "none";
  const file = el("input", { type: "file", accept: "image/*", class: "sr-only", id: "file", onchange: onFile });
  return el("section", { class: "card", "aria-labelledby": "h-scan" },
    el("span", { class: "kicker" }, "Step 1"),
    el("h2", { id: "h-scan" }, "Scan the invoice QR"),
    el("p", { class: "muted" }, "India's tax network (NIC) signs every B2B e-invoice QR. Scan it, upload a photo, or paste its text."),
    ta, camVideo,
    state.cameraNote ? el("p", { class: "foot", role: "status" }, state.cameraNote) : null,
    file,
    el("div", { class: "row" },
      el("button", { class: "btn dark grow", onclick: toggleCamera }, state.camera ? "Stop camera" : "Scan with camera"),
      el("label", { class: "btn grow", for: "file", tabindex: "0", onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("file")?.click(); } } }, "Upload QR photo"),
    ),
    el("p", { class: "sample-label" }, "No QR to hand? Try one:"),
    el("div", { class: "row", style: "margin-top:.5rem" },
      el("button", { class: "btn grow", onclick: () => setToken(nicSample.trim()) }, "NIC sample QR"),
      el("button", { class: "btn grow", onclick: useDemoInvoice, disabled: demoBusy }, demoBusy ? "Finding one…" : "DEMO IRP invoice"),
      el("button", { class: "btn grow ghost", onclick: flipOneByte, disabled: !state.token }, "Change one byte"),
    ),
  );
}

let timer: number | undefined;
function debounceCheck() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void check(), 400);
}

function signerBadge(isDemo: boolean) {
  return isDemo
    ? el("span", { class: "badge" }, "DEMO IRP (not government)")
    : el("span", { class: "badge real" }, "NIC key");
}

function stampRow(kind: "ok" | "bad" | "warn", word: string, line: string) {
  return el("div", { class: "stamp-row", role: kind === "bad" ? "alert" : "status" },
    el("span", { class: `stamp ${kind}` }, word), el("p", { class: "verdict" }, line));
}

function resultCard() {
  const v = state.view;
  const card = el("section", { class: "card page", "aria-labelledby": "h-ver", "aria-live": "polite" },
    el("span", { class: "kicker" }, "Step 2"), el("h2", { id: "h-ver" }, "What the contract found"));

  if (v.kind === "idle") {
    const e = emptyBox("The ledger page is blank", "Scan a QR, paste its text, or use a sample. The contract will show who signed it and whether the signature holds.");
    card.append(e);
    return card;
  }
  if (v.kind === "checking") {
    card.append(el("div", { class: "banner info" }, el("span", { class: "spinner" }), el("div", {}, el("strong", {}, "Asking the contract…"), el("p", {}, "The RSA signature is being checked on Whitechain."))));
    return card;
  }
  if (v.kind === "refused") {
    card.append(stampRow("bad", "Refused", v.title), el("p", { class: "muted" }, v.detail));
    return card;
  }

  const r = v.r;
  const verdict = classify(r);
  if (verdict === "unknownKey" || verdict === "keyRetired") {
    const m = refusalFor(verdict === "unknownKey" ? "UnknownKey" : "KeyIsRetired", [r.kid]);
    card.append(stampRow("bad", "Refused", m.title), el("p", { class: "muted" }, m.detail));
    return card;
  }
  if (verdict === "badSignature") {
    const m = refusalFor("InvalidSignature", []);
    card.append(
      stampRow("bad", "Refused", m.title), el("p", { class: "muted" }, m.detail),
      el("dl", { class: "facts" },
        el("dd", { class: "g" }, "Signature"),
        el("dt", {}, "Signing key (kid)"), el("dd", {}, el("span", { class: "mono" }, r.kid), " ", signerBadge(r.keyIsDemo)),
        el("dt", {}, "Key registered"), el("dd", {}, el("span", { class: "check" }, "✓ yes")),
        el("dt", {}, "Signature"), el("dd", {}, el("span", { class: "cross" }, "✕ does not match")),
      ),
    );
    return card;
  }

  const inv = r.invoice;
  card.append(
    r.alreadyBound
      ? stampRow("warn", "Already financed", "The signature is genuine, but this invoice's IRN is already bound. It cannot be financed again.")
      : stampRow("ok", "Verified", "The contract checked NIC's RS256 signature itself. No server vouches for it."),
    el("dl", { class: "facts" },
      el("dd", { class: "g" }, "Signature"),
      el("dt", {}, "Signing key (kid)"), el("dd", {}, el("span", { class: "mono" }, r.kid), " ", signerBadge(r.keyIsDemo)),
      el("dt", {}, "Key registered"), el("dd", {}, el("span", { class: "check" }, "✓ yes"), r.keyActive ? " and active" : " but retired"),
      el("dt", {}, "RS256 signature"), el("dd", {}, el("span", { class: "check" }, "✓ matches")),
      el("dd", { class: "g" }, "Invoice"),
      el("dt", {}, "Value"), el("dd", { class: "big" }, formatRupees(inv.valuePaise)),
      el("dt", {}, "Document"), el("dd", {}, inv.docNo, " · ", inv.docDt),
      el("dt", {}, "Seller GSTIN"), el("dd", {}, el("span", { class: "mono" }, inv.sellerGstin)),
      el("dt", {}, "Buyer GSTIN"), el("dd", {}, el("span", { class: "mono" }, inv.buyerGstin)),
      el("dt", {}, "IRN"), el("dd", {}, el("span", { class: "mono" }, inv.irn.slice(2))),
      el("dd", { class: "g" }, "Status"),
      el("dt", {}, "Financing"), el("dd", {}, r.alreadyBound ? el("span", { class: "cross" }, "Already financed") : el("span", { class: "check" }, "Not financed yet")),
    ),
  );
  card.append(actions(r));
  return card;
}

function actions(r: Inspection) {
  const a = state.action;
  const wrap = el("div", { style: "margin-top:1.25rem" });
  const label = r.alreadyBound ? "Try to finance it again" : "Finance this invoice";
  const busy = a.kind === "simulating" || a.kind === "sending";
  wrap.append(el("div", { class: "row", style: "margin-top:0" },
    el("button", { class: "btn primary grow", onclick: finance, disabled: busy || state.token.trim() !== state.checkedToken }, busy ? el("span", { class: "spinner" }) : null, a.kind === "sending" ? "Waiting for the network…" : label),
    activeWallet("supplier") ? el("span", { class: "foot", style: "align-self:center" }, "Sending as ", el("span", { class: "mono" }, short(activeWallet("supplier")!.address, 6, 4))) : null,
  ));
  if (a.kind === "readOnly") {
    wrap.append(el("div", { class: "banner info" }, el("span", { class: "ic" }, "i"), el("div", {}, el("strong", {}, "The contract would accept this"), el("p", {}, "There is no demo wallet for this role, so the transaction was not sent."))));
  }
  if (a.kind === "refused") {
    wrap.append(el("div", { class: "banner bad", role: "alert" }, el("span", { class: "ic" }, "✕"), el("div", {}, el("strong", {}, a.title), el("p", {}, a.detail))));
  }
  if (a.kind === "done") {
    wrap.append(el("div", { class: "banner ok" }, el("span", { class: "ic" }, "✓"), el("div", {},
      el("strong", {}, "Invoice bound on-chain"),
      el("p", {}, `Used ${a.gas.toLocaleString("en-IN")} gas. `, el("a", { href: txUrl(a.hash), target: "_blank", rel: "noopener" }, "View the transaction")))));
  }
  return wrap;
}

function footer() {
  return el("footer", { class: "footer" }, el("div", { class: "wrap" },
    el("p", { style: "margin:0" }, el("span", { class: "tag" }, "TESTNET DEMO"), " Built solo for ETHGlobal Mumbai 2026. Funds here have no value."),
    el("p", { style: "margin:0" }, "Registry contract: ", el("a", { class: "chip-link", href: addressUrl(registryAddress), target: "_blank", rel: "noopener" }, short(registryAddress, 8, 6))),
    el("p", { style: "margin:0" }, el("a", { class: "chip-link", href: "#evidence" }, "Evidence: what the contract refused")),
    el("p", { style: "margin:0" }, "The NIC sample QR is real. Invoices marked DEMO IRP use a demo key, not a government key."),
  ));
}

const PAGE: Record<Role, { title: string; text: string }> = {
  supplier: { title: "Supplier", text: "Scan a GST e-invoice QR. The contract verifies the government's signature, records the invoice once, and lets you sell notes against it." },
  investor: { title: "Investor", text: "Buy a slice of an invoice at a discount. The USDT goes straight to the supplier in the same transaction as the notes. Only wallets with a valid credential can hold them." },
  debtor: { title: "Debtor", text: "You are the buyer on the invoice. On the due date you pay the face value in USDT; holders then redeem." },
  attester: { title: "Attester", text: "You are the trusted signer. You vouch that a wallet may hold notes, and that a seller wallet really belongs to a GSTIN. Both are checked on-chain from your signature." },
};
function pageHead(role: Role): HTMLElement {
  return el("div", { class: "wrap page-head" }, el("div", { class: "page-head-text" }, el("h1", {}, PAGE[role].title), el("p", {}, PAGE[role].text)), spot(SPOTS[role], "spot head-spot"));
}

/** A thin marigold garland under the top bar, repeated to any width. */
function appGarland(): HTMLElement {
  const row = el("div", { class: "garland-row" });
  for (let i = 0; i < 8; i++) { const t = el("div", { class: "tile" }); t.innerHTML = garlandSvg; row.append(t); }
  return el("div", { class: "garland mini", "aria-hidden": "true" }, row);
}

const inApp = () => location.hash === "#app";
/** Open the app on a role, optionally with an invoice to check. */
function openApp(role: Role = "supplier", token?: string) {
  store.role = role;
  if (token) state.token = token;
  if (location.hash !== "#app") location.hash = "#app";
  else { render(); void refresh(); }
  if (token) void check();
}

function render() {
  const app = document.getElementById("app")!;
  if (location.hash === "#evidence") { app.replaceChildren(roughDefs(), evidencePage(), footer()); return; }
  if (!inApp()) {
    app.replaceChildren(roughDefs(), landing({
      getToken: () => state.token,
      setText: (t) => { state.token = t; },
      open: (t) => openApp("supplier", t),
      openRole: (r) => openApp(r),
      scan: () => { openApp("supplier"); void toggleCamera(); },
      onFile: (ev) => { openApp("supplier"); void onFile(ev); },
      nicSample: () => nicSample.trim(),
      demoInvoice: () => { openApp("supplier"); void useDemoInvoice(); },
      demoBusy: () => demoBusy,
      tamper: () => { openApp("supplier", nicSample.trim()); void check().then(flipOneByte); },
    }), footer());
    return;
  }
  const hadFocus = document.activeElement?.id;
  const sel = (document.activeElement as HTMLTextAreaElement | null)?.selectionStart;
  const shell = el("div", { class: "app" });
  const main = el("main", { id: "main" });
  const role = store.role;
  main.append(pageHead(role));
  if (role === "supplier") {
    main.append(el("div", { class: "wrap" }, steps()));
    main.append(el("div", { class: "wrap two" }, inputCard(), resultCard()));
    const nl = nullifierToCreate();
    if (nl) main.append(el("div", { class: "wrap" }, createNotePanel(nl)));
    main.append(el("div", { class: "wrap" }, walletBar("supplier"), el("h2", { class: "section" }, "Your notes"),
      notesList("supplier", (n) => n.seller.toLowerCase() === activeWallet("supplier")?.address.toLowerCase(), "Register an invoice above, then create its note.")));
  } else if (role === "attester") {
    main.append(el("div", { class: "wrap" }, walletBar(role)), ...attesterDesk().map((c) => el("div", { class: "wrap" }, c)));
  } else {
    const w = activeWallet(role);
    main.append(el("div", { class: "wrap" }, walletBar(role)));
    if (role === "investor" && w) main.append(el("div", { class: "wrap two" }, credentialPanel(w), marketplace(role)));
    main.append(el("div", { class: "wrap" }, el("h2", { class: "section" }, role === "investor" ? "All notes on Whitechain" : "Notes"),
      notesList(role, undefined, "No notes exist yet. Switch to the supplier role to register an invoice and create one.")));
  }
  shell.append(topbar(), appGarland(), ...[anonBanner()].filter((x): x is HTMLElement => !!x), roleSwitch(), main, footer());
  document.getElementById("app")!.replaceChildren(roughDefs(), shell);
  if (hadFocus === "token") {
    const ta = document.getElementById("token") as HTMLTextAreaElement | null;
    ta?.focus();
    if (ta && sel !== undefined) ta.setSelectionRange(sel, sel);
  }
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

/** The nullifier of the invoice on screen, once it is registered by this supplier wallet. */
function nullifierToCreate(): `0x${string}` | undefined {
  const v = state.view;
  if (v.kind !== "result" || !v.r.alreadyBound || state.token.trim() !== state.checkedToken) return undefined;
  return v.r.nullifier;
}

// Countdowns update in place; when one reaches zero, state is re-read once.
document.addEventListener("visibilitychange", () => {});
const reached = new Set<string>();
setInterval(() => {
  document.querySelectorAll<HTMLElement>("[data-anon-elapsed]").forEach((n) => (n.textContent = `${Math.round((Date.now() - Number(n.dataset.anonElapsed)) / 1000)} s`));
  document.querySelectorAll<HTMLElement>("[data-anon-slow]").forEach((n) => { n.hidden = Date.now() - Number(n.dataset.anonSlow) < slowAfterMs; });
  const now = nowEst();
  document.querySelectorAll<HTMLElement>("[data-until]").forEach((n) => {
    const ts = Number(n.dataset.until);
    const d = ts - now;
    n.textContent = d > 0 ? `in ${spanText(d)}` : `${spanText(-d)} ago`;
    if (d <= 0 && !reached.has(String(ts))) {
      reached.add(String(ts));
      if (!store.loading && !(document.activeElement instanceof HTMLInputElement)) void refresh();
    }
  });
}, 1000);
setInterval(() => {
  if (inApp() && !store.loading && !(document.activeElement instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) void refresh();
}, 30000); // each refresh is several round trips over Tor, so poll less often
function spanText(s: number) {
  s = Math.round(s);
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 86400)} days`;
}

setRender(render);
render();
onState(render);
onTraffic(refreshChip);
startAnon();

// The front page reads nothing from the chain: reads, the Arkiv watcher and the poll start only when the app is opened.
let stopWatching: (() => void) | undefined;
function syncRoute() {
  if (inApp()) {
    if (!store.loaded && !store.loading) void refresh();
    // new, changed or expired Arkiv entities refresh the Arkiv panels straight away instead of waiting for the poll
    stopWatching ??= startWatching(() => void refreshArkiv());
  } else {
    stopWatching?.();
    stopWatching = undefined;
  }
}
window.addEventListener("hashchange", syncRoute);
syncRoute();
