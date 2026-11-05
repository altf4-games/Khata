import "./styles.css";
import heroSvg from "./hero.svg?raw";
import nicSample from "../../contracts/test/fixtures/nic-sample.token?raw";
import demoInvoice from "../../contracts/test/fixtures/demo-irp/demo-02.token?raw";
import {
  addressUrl, connectWallet, DUMMY_SENDER, inspect, publicClient, registryAddress, revertInfo, simulateBind, txUrl,
  type Inspection,
} from "./chain";
import { refusalFor } from "./errors";
import { classify, formatRupees } from "./verdict";
import { decodeImageFile, startCamera, type CameraScan } from "./scan";
import { abi } from "./chain";
import type { Address } from "viem";

// ---------- tiny DOM helper ----------
type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
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
const short = (s: string, a = 8, b = 6) => (s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

// ---------- state ----------
type View =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; r: Inspection }
  | { kind: "refused"; title: string; detail: string };

type Action =
  | { kind: "none" }
  | { kind: "simulating" }
  | { kind: "needWallet" }
  | { kind: "sending" }
  | { kind: "done"; hash: string; gas: bigint }
  | { kind: "refused"; title: string; detail: string };

const state = {
  role: "supplier" as "supplier" | "investor" | "debtor" | "attester",
  token: "",
  checkedToken: "", // the exact text the panel currently describes
  cameraStarting: false,
  view: { kind: "idle" } as View,
  action: { kind: "none" } as Action,
  wallet: undefined as undefined | { account: Address; walletClient: any },
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
  state.action = { kind: "simulating" };
  render();
  const sender = state.wallet?.account ?? DUMMY_SENDER;
  try {
    await simulateBind(token, sender);
  } catch (e) {
    if (state.checkedToken !== token) return;
    const info = revertInfo(e);
    state.action = { kind: "refused", ...refusalFor(info.name, info.args, info.message) };
    return render();
  }
  if (state.checkedToken !== token) return;
  if (!state.wallet) {
    state.action = { kind: "needWallet" };
    return render();
  }
  state.action = { kind: "sending" };
  render();
  try {
    const hash = await state.wallet.walletClient.writeContract({
      address: registryAddress, abi, functionName: "bindInvoice", args: [token], account: state.wallet.account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");
    if (state.checkedToken !== token) return; // the user moved on to another invoice; do not claim it here
    state.action = { kind: "done", hash, gas: receipt.gasUsed };
    await refreshAfterBind(token);
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

async function onConnect() {
  try {
    state.wallet = await connectWallet();
    if (state.action.kind === "needWallet") return finance();
  } catch (e: any) {
    state.action =
      e?.message === "no-wallet"
        ? { kind: "refused", title: "No wallet found in this browser", detail: "Install a browser wallet such as MetaMask, or open this page in a browser that has one. Checking an invoice works without a wallet." }
        : { kind: "refused", title: "Wallet not connected", detail: "The wallet request was cancelled or failed. Nothing was sent." };
  }
  render();
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
  state.camera = await startCamera(
    video,
    (text) => {
      state.camera = undefined;
      state.cameraNote = "";
      setToken(text);
    },
    (err) => {
      state.camera = undefined;
      state.cameraNote =
        err.name === "NotAllowedError"
          ? "Camera permission was denied. Upload a photo of the QR, or paste its text."
          : "No camera could be started here. Upload a photo of the QR, or paste its text.";
      render();
    },
  );
  state.cameraStarting = false;
  if (state.camera) {
    state.cameraNote = "Point the camera at the QR code.";
    render();
  }
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
const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="4" width="32" height="40" rx="4" fill="#7d1816"/><rect x="10" y="4" width="28" height="40" rx="3" fill="#a3211f"/><rect x="8" y="19" width="32" height="8" fill="#f5b301"/><circle cx="24" cy="23" r="2.2" fill="#a3211f"/><path d="M15 10h18M15 14h18M15 33h18M15 37h12" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const ROLES: { id: typeof state.role; label: string; note: string }[] = [
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
  const brand = el("div", { class: "brand" });
  brand.innerHTML = LOGO;
  brand.append("Khata");
  return el("div", { class: "bar" }, el("div", { class: "wrap" }, brand,
    el("div", { class: "chips" },
      el("span", { class: "chip" }, el("span", { class: "dot on" }), "Whitechain Sepolia testnet"),
      el("span", { class: "chip hide-sm", title: "Reads go straight to the public RPC. Anon-RPC is not built yet." }, el("span", { class: "dot" }), "Reads: direct RPC"),
    )));
}

function hero() {
  const art = el("div", { class: "hero-art" });
  art.innerHTML = heroSvg;
  return el("section", { class: "hero" }, el("div", { class: "wrap" },
    el("div", { class: "hero-copy" },
      el("span", { class: "eyebrow" }, "invoice financing for small suppliers"),
      (() => { const h = el("h1", {}); h.innerHTML = `Finance the invoice,<br />not the <span class="scrawl">fraud.<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12 C30 4 55 17 85 9 S140 15 170 8 S192 11 197 7" fill="none" stroke="#b3261e" stroke-width="4" stroke-linecap="round"/></svg></span>`; return h; })(),
      el("p", { class: "sub" }, "A smart contract checks the government's own signature on a GST e-invoice QR, and refuses to finance the same invoice twice."),
      el("ul", { class: "hero-points" },
        el("li", {}, "Signature verified on-chain"), el("li", {}, "One financing per invoice"), el("li", {}, "Testnet demo")),
    ),
    art,
  ));
}

function roleSwitch() {
  const roles = el("ul", { class: "roles", role: "tablist", "aria-label": "Choose a role" });
  for (const r of ROLES) {
    roles.append(el("li", {}, el("button", {
      class: "role-btn", role: "tab", "aria-selected": String(state.role === r.id),
      onclick: () => { state.role = r.id; render(); },
    }, r.label, el("small", {}, r.note))));
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
      el("button", { class: "btn grow", onclick: () => setToken(demoInvoice.trim()) }, "DEMO IRP invoice"),
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
    const e = el("div", { class: "empty" });
    e.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="6" width="42" height="52" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 8v48" stroke="currentColor" stroke-width="6"/><path d="M24 20h22M24 30h22M24 40h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
    e.append(el("h3", {}, "The ledger page is blank"), el("p", {}, "Scan a QR, paste its text, or use a sample. The contract will show who signed it and whether the signature holds."));
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
    state.wallet ? el("span", { class: "foot", style: "align-self:center" }, "Wallet ", el("span", { class: "mono" }, short(state.wallet.account, 6, 4))) : null,
  ));
  if (a.kind === "needWallet") {
    wrap.append(
      el("div", { class: "banner info" }, el("span", { class: "ic" }, "i"), el("div", {}, el("strong", {}, "The contract would accept this"), el("p", {}, "To send the transaction, connect a wallet funded with testnet WBT."))),
      el("div", { class: "row", style: "margin-top:0" }, el("button", { class: "btn grow", onclick: onConnect }, "Connect wallet")),
    );
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

function otherRole() {
  const r = ROLES.find((x) => x.id === state.role)!;
  return el("div", { class: "card notice" },
    el("span", { class: "kicker" }, "Not built yet"),
    el("h2", {}, `${r.label} view`),
    el("p", { class: "muted" }, "This role's screen is not built yet. The supplier view works today and checks a real NIC signature on-chain."),
    el("div", { class: "row", style: "justify-content:center" }, el("button", { class: "btn dark", onclick: () => { state.role = "supplier"; render(); } }, "Back to the supplier view")),
  );
}

function footer() {
  return el("footer", { class: "footer" }, el("div", { class: "wrap" },
    el("p", { style: "margin:0" }, el("span", { class: "tag" }, "TESTNET DEMO"), " Built solo for ETHGlobal Mumbai 2026. Funds here have no value."),
    el("p", { style: "margin:0" }, "Registry contract: ", el("a", { class: "chip-link", href: addressUrl(registryAddress), target: "_blank", rel: "noopener" }, short(registryAddress, 8, 6))),
    el("p", { style: "margin:0" }, "The NIC sample QR is real. Invoices marked DEMO IRP use a demo key, not a government key."),
  ));
}

function render() {
  const app = document.getElementById("app")!;
  const hadFocus = document.activeElement?.id;
  const sel = (document.activeElement as HTMLTextAreaElement | null)?.selectionStart;
  app.replaceChildren(roughDefs(), topbar(), hero(), roleSwitch());
  const main = el("main", { id: "main" });
  if (state.role === "supplier") {
    main.append(el("div", { class: "wrap" }, steps()));
    main.append(el("div", { class: "wrap two" }, inputCard(), resultCard()));
  } else {
    main.append(el("div", { class: "wrap" }, otherRole()));
  }
  app.append(main, footer());
  if (hadFocus === "token") {
    const ta = document.getElementById("token") as HTMLTextAreaElement | null;
    ta?.focus();
    if (ta && sel !== undefined) ta.setSelectionRange(sel, sel);
  }
}

render();
