// Generates the landing-page illustrations as plain SVG, drawn in an ink-and-gouache style: wobbly ink outlines, hatched shading,
// stone courses and a paper grain. Original work built from simple shapes by this script; no third-party artwork was used or traced.
// Run: node scripts/gen-art.mjs   (writes web/src/art/*.svg)
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../web/src/art/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const save = (name, svg) => writeFileSync(new URL(name, OUT), svg);

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(23);
const pick = (a) => a[Math.floor(r() * a.length)];
const f = (n) => Number(n.toFixed(1));

const C = {
  ink: "#3b2a3d", stone: "#d6954d", stoneLt: "#e6b06a", clay: "#b6532f", clayDk: "#8e3b25", olive: "#8a9246", oliveDk: "#5f6a34",
  teal: "#3a8a82", tealDk: "#27625d", indigo: "#35346b", indigoDk: "#24234f", cream: "#f5e6c0", creamDk: "#e6d09c", gold: "#f2b01e",
  magenta: "#b83d6e", red: "#b3261e", lav: "#d3c8e2", lavDk: "#bcaed3", water: "#5fa6a0", sand: "#e9c98d",
};

const defs = `<defs>
<filter id="wob" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2"/></filter>
<filter id="paper" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 .23  0 0 0 0 .16  0 0 0 0 .24  0 0 0 -2.2 1.25" result="spec"/><feComposite in="spec" in2="SourceAlpha" operator="in" result="s2"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="s2"/></feMerge></filter>
<filter id="paperSoft" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 .5  0 0 0 0 .42  0 0 0 0 .3  0 0 0 -3.4 1.35" result="spec"/><feComposite in="spec" in2="SourceAlpha" operator="in" result="s2"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="s2"/></feMerge></filter>
<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" y1="0" x2="0" y2="7" stroke="${C.ink}" stroke-width="1.3" opacity=".42"/></pattern>
<pattern id="hatch2" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)"><line x1="0" y1="0" x2="0" y2="5" stroke="${C.ink}" stroke-width="1" opacity=".3"/></pattern>
</defs>`;

const ST = `stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;
let s = "";
const add = (x) => (s += x + "\n");

// ---------- building blocks ----------
function block(x, y, w, h, fill, o = {}) {
  add(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}" ${ST}/>`);
  const step = o.courses ?? 0;
  if (step) for (let yy = y + step; yy < y + h - 2; yy += step) add(`<path d="M${f(x + 2)} ${f(yy + r() * 1.4)}H${f(x + w - 2)}" stroke="${C.ink}" stroke-width="1" opacity=".2" fill="none"/>`);
  if (o.bricks) for (let i = 0; i < o.bricks; i++) { const bx = x + 4 + r() * (w - 8), by = y + 4 + r() * (h - 8); add(`<path d="M${f(bx)} ${f(by)}h${f(5 + r() * 5)}" stroke="${C.ink}" stroke-width="1.2" opacity=".28"/>`); }
  if (o.shade !== false) add(`<rect x="${f(x + w * 0.74)}" y="${f(y + 1)}" width="${f(w * 0.26 - 1)}" height="${f(h - 2)}" fill="url(#hatch)"/>`);
  if (o.lightEdge) add(`<path d="M${f(x + 3)} ${f(y + 3)}V${f(y + h - 3)}" stroke="#fff" stroke-width="2" opacity=".28"/>`);
}
function arch(cx, base, w, h, fill = C.indigoDk, o = {}) {
  const x0 = cx - w / 2, rr = w / 2;
  add(`<path d="M${f(x0)} ${f(base)}V${f(base - h + rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(w)} 0V${f(base)}z" fill="${fill}" ${ST}/>`);
  if (o.rim) add(`<path d="M${f(x0 - 5)} ${f(base)}V${f(base - h + rr)}a${f(rr + 5)} ${f(rr + 5)} 0 0 1 ${f(w + 10)} 0V${f(base)}" fill="none" stroke="${C.ink}" stroke-width="2" opacity=".7"/>`);
  if (o.lit) add(`<path d="M${f(cx - rr * 0.45)} ${f(base - 6)}V${f(base - h * 0.45)}a${f(rr * 0.45)} ${f(rr * 0.45)} 0 0 1 ${f(rr * 0.9)} 0V${f(base - 6)}z" fill="${C.gold}" opacity=".85"/>`);
  if (o.keystone) add(`<path d="M${f(cx - 4)} ${f(base - h - 3)}h8l2 10h-12z" fill="${C.stoneLt}" ${ST}/>`);
}
function win(x, y, w, h, lit = r() > 0.5) {
  add(`<path d="M${f(x)} ${f(y + h)}V${f(y + w / 2)}a${f(w / 2)} ${f(w / 2)} 0 0 1 ${f(w)} 0V${f(y + h)}z" fill="${lit ? C.gold : C.indigoDk}" stroke="${C.ink}" stroke-width="1.6" ${lit ? 'opacity=".95"' : ""}/>`);
  add(`<path d="M${f(x + w / 2)} ${f(y + 2)}V${f(y + h)}M${f(x)} ${f(y + h * 0.55)}H${f(x + w)}" stroke="${C.ink}" stroke-width="1" opacity=".55"/>`);
}
let domeId = 0;
function dome(cx, base, rr, fill, o = {}) {
  const h = rr * (o.tall ?? 0.9);
  const d = `M${f(cx - rr)} ${f(base)}C${f(cx - rr)} ${f(base - h * 1.25)} ${f(cx - rr * 0.35)} ${f(base - h * 1.5)} ${f(cx)} ${f(base - h * 1.7)}C${f(cx + rr * 0.35)} ${f(base - h * 1.5)} ${f(cx + rr)} ${f(base - h * 1.25)} ${f(cx + rr)} ${f(base)}z`;
  const id = `dm${domeId++}`;
  add(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  add(`<path d="${d}" fill="${fill}" ${ST}/>`);
  for (const k of [-0.5, 0, 0.5]) add(`<path d="M${f(cx + k * rr)} ${f(base)}C${f(cx + k * rr * 1.1)} ${f(base - h * 0.9)} ${f(cx + k * rr * 0.5)} ${f(base - h * 1.4)} ${f(cx)} ${f(base - h * 1.68)}" fill="none" stroke="${C.ink}" stroke-width="1.2" opacity=".45" clip-path="url(#${id})"/>`);
  add(`<rect x="${f(cx + rr * 0.35)}" y="${f(base - h * 1.75)}" width="${f(rr * 0.7)}" height="${f(h * 1.76)}" fill="url(#hatch)" opacity=".8" clip-path="url(#${id})"/>`);
  add(`<path d="M${f(cx)} ${f(base - h * 1.7)}v${f(-rr * 0.5)}" stroke="${C.ink}" stroke-width="2.4"/><circle cx="${f(cx)}" cy="${f(base - h * 1.7 - rr * 0.55)}" r="${f(Math.max(3, rr * 0.12))}" fill="${C.gold}" ${ST}/>`);
}
function palm(x, base, h, lean = 0) {
  const tx = x + lean, ty = base - h;
  add(`<path d="M${f(x - 5)} ${f(base)}Q${f(x + lean * 0.2)} ${f(base - h * 0.5)} ${f(tx - 3)} ${f(ty)}L${f(tx + 3)} ${f(ty)}Q${f(x + lean * 0.2 + 8)} ${f(base - h * 0.5)} ${f(x + 5)} ${f(base)}z" fill="${C.clayDk}" ${ST}/>`);
  for (let i = 1; i < 9; i++) { const yy = base - (h * i) / 9, xx = x + lean * (i / 9) * (i / 9) * 1.2; add(`<path d="M${f(xx - 4)} ${f(yy)}l8 -2" stroke="${C.ink}" stroke-width="1" opacity=".5"/>`); }
  const fr = [[-62, -18], [-48, -42], [-22, -58], [0, -62], [24, -56], [50, -40], [64, -14]];
  for (const [dx, dy] of fr) {
    const ex = tx + dx, ey = ty + dy + 14;
    add(`<path d="M${f(tx)} ${f(ty)}Q${f(tx + dx * 0.5)} ${f(ty + dy - 14)} ${f(ex)} ${f(ey)}Q${f(tx + dx * 0.55)} ${f(ty + dy * 0.2 + 4)} ${f(tx)} ${f(ty + 5)}z" fill="${pick([C.olive, C.oliveDk, C.teal])}" ${ST}/>`);
    add(`<path d="M${f(tx)} ${f(ty + 2)}Q${f(tx + dx * 0.5)} ${f(ty + dy * 0.6)} ${f(ex - dx * 0.1)} ${f(ey - 2)}" stroke="${C.ink}" stroke-width="1" opacity=".5" fill="none"/>`);
  }
  add(`<circle cx="${f(tx - 4)}" cy="${f(ty + 8)}" r="4.5" fill="${C.clay}" ${ST}/><circle cx="${f(tx + 5)}" cy="${f(ty + 9)}" r="4.5" fill="${C.clay}" ${ST}/>`);
}
function tree(x, base, h, col = C.olive) {
  add(`<path d="M${f(x - 4)} ${f(base)}l2 ${f(-h * 0.5)}h4l2 ${f(h * 0.5)}z" fill="${C.clayDk}" ${ST}/>`);
  const blobs = [[0, -h * 0.72, h * 0.36], [-h * 0.24, -h * 0.55, h * 0.26], [h * 0.24, -h * 0.55, h * 0.27], [-h * 0.1, -h * 0.9, h * 0.24], [h * 0.14, -h * 0.84, h * 0.22]];
  for (const [dx, dy, rr] of blobs) add(`<circle cx="${f(x + dx)}" cy="${f(base + dy)}" r="${f(rr)}" fill="${col}" ${ST}/>`);
  for (let i = 0; i < 9; i++) add(`<path d="M${f(x + (r() - 0.5) * h * 0.6)} ${f(base - h * (0.45 + r() * 0.45))}q3 -3 7 0" stroke="${C.ink}" stroke-width="1.1" opacity=".4" fill="none"/>`);
  add(`<ellipse cx="${f(x + h * 0.2)}" cy="${f(base - h * 0.62)}" rx="${f(h * 0.14)}" ry="${f(h * 0.26)}" fill="url(#hatch2)"/>`);
}
function bush(x, base, w, col = C.oliveDk) {
  add(`<path d="M${f(x - w / 2)} ${f(base)}q${f(-w * 0.1)} ${f(-w * 0.55)} ${f(w * 0.25)} ${f(-w * 0.55)}q${f(w * 0.2)} ${f(-w * 0.35)} ${f(w * 0.5)} ${f(-w * 0.1)}q${f(w * 0.3)} ${f(w * 0.05)} ${f(w * 0.25)} ${f(w * 0.65)}z" fill="${col}" ${ST}/>`);
  for (let i = 0; i < 4; i++) add(`<circle cx="${f(x - w * 0.3 + r() * w * 0.6)}" cy="${f(base - w * (0.15 + r() * 0.3))}" r="2.4" fill="${pick([C.gold, C.red, C.magenta])}"/>`);
}
function lamp(x, base) {
  add(`<path d="M${f(x)} ${f(base)}V${f(base - 62)}" stroke="${C.ink}" stroke-width="3" fill="none"/><path d="M${f(x - 7)} ${f(base - 62)}h14l-3 -10h-8z" fill="${C.gold}" ${ST}/>`);
}

// ---------- the skyline cluster (1000 x 500) ----------
const W = 1000, H = 500, G = 440;
const sky = () => {
  // far pale towers
  add(`<g opacity=".95">`);
  for (let x = -10; x < W; ) { const w = 22 + r() * 36, h = 60 + r() * 150; add(`<rect x="${f(x)}" y="${f(G - h)}" width="${f(w)}" height="${f(h)}" fill="${C.lav}" stroke="${C.lavDk}" stroke-width="2"/>`); for (let yy = G - h + 14; yy < G - 12; yy += 16) for (let xx = x + 6; xx < x + w - 6; xx += 11) if (r() > 0.55) add(`<rect x="${f(xx)}" y="${f(yy)}" width="4" height="7" fill="${C.lavDk}"/>`); x += w + 3 + r() * 8; }
  add(`</g>`);

  // sea-link bridge, behind the hotel
  add(`<g>`);
  add(`<rect x="700" y="${G - 38}" width="330" height="9" fill="${C.indigo}" ${ST}/>`);
  add(`<path d="M700 ${G - 29}H1030" stroke="${C.ink}" stroke-width="1" opacity=".5"/>`);
  for (let x = 880; x < 1000; x += 40) add(`<path d="M${x} ${G - 29}v26" stroke="${C.ink}" stroke-width="3"/>`);
  add(`<path d="M885 ${G - 38}L898 70L911 ${G - 38}" fill="${C.magenta}" ${ST}/><path d="M898 70V${G - 38}" stroke="${C.ink}" stroke-width="2"/><path d="M890 150h16M888 210h20" stroke="${C.ink}" stroke-width="3"/>`);
  for (let i = 0; i < 8; i++) { add(`<path d="M898 ${96 + i * 15}L${790 - i * 14 + (i % 2) * 6} ${G - 38}" stroke="${C.ink}" stroke-width="1.5" fill="none"/><path d="M898 ${96 + i * 15}L${1022 - (i % 2) * 6} ${G - 38}" stroke="${C.ink}" stroke-width="1.5" fill="none"/>`); }
  add(`</g>`);

  // grand hotel (right)
  add(`<g>`);
  block(690, 300, 150, G - 300, C.cream, { courses: 16, bricks: 14 });
  block(676, 278, 36, G - 278, C.cream, { courses: 16 });
  block(818, 278, 36, G - 278, C.cream, { courses: 16 });
  dome(694, 278, 20, C.clay); dome(836, 278, 20, C.clay);
  dome(765, 300, 40, C.clay, { tall: 1.05 });
  for (let i = 0; i < 6; i++) arch(702 + i * 24, G, 16, 52, C.indigoDk, { lit: i % 3 === 0 });
  for (let i = 0; i < 6; i++) win(704 + i * 24, 322, 12, 28, i % 2 === 0);
  for (let i = 0; i < 6; i++) win(704 + i * 24, 362, 12, 28, i % 3 === 1);
  add(`<path d="M690 300h150" stroke="${C.ink}" stroke-width="3"/>`);
  add(`</g>`);

  // clock tower (left)
  add(`<g>`);
  block(118, 340, 200, G - 340, C.stone, { courses: 18, bricks: 20 });
  for (let i = 0; i < 7; i++) arch(140 + i * 26, G, 18, 56, C.indigoDk, { lit: i === 3 });
  block(190, 130, 56, 212, C.stone, { courses: 14, bricks: 22, lightEdge: true });
  block(184, 126, 68, 10, C.clay, { shade: false });
  block(194, 80, 48, 50, C.stoneLt, { courses: 12 });
  add(`<circle cx="218" cy="105" r="16" fill="${C.cream}" ${ST}/><circle cx="218" cy="105" r="12" fill="none" stroke="${C.ink}" stroke-width="1" opacity=".5"/><path d="M218 105v-10M218 105l8 4" stroke="${C.ink}" stroke-width="2.4"/>`);
  for (let i = 0; i < 4; i++) { win(198 + (i % 2) * 24, 148 + Math.floor(i / 2) * 50, 12, 28, i === 1); }
  add(`<path d="M190 80L218 18L246 80z" fill="${C.teal}" ${ST}/><path d="M218 18L233 80L246 80z" fill="url(#hatch)"/><path d="M218 18v-12" stroke="${C.ink}" stroke-width="2.4"/><circle cx="218" cy="5" r="4.5" fill="${C.gold}" ${ST}/>`);
  for (const x of [118, 292]) { block(x, 300, 26, 42, C.stone, { courses: 14 }); dome(x + 13, 300, 13, C.teal); }
  add(`</g>`);

  // the great gateway (centre)
  add(`<g>`);
  block(345, 255, 310, G - 255, C.stone, { courses: 17, bricks: 40, lightEdge: true });
  block(335, 244, 330, 14, C.clay, { shade: false });
  for (let x = 345; x < 650; x += 12) add(`<path d="M${x} 244v-6h8v6" fill="${C.clay}" ${ST}/>`);
  // turrets
  for (const x of [348, 602]) { block(x, 196, 50, 60, C.stoneLt, { courses: 13, bricks: 8 }); dome(x + 25, 196, 25, C.teal); for (let i = 0; i < 2; i++) win(x + 11 + i * 20, 214, 12, 26, i === 0); }
  // central parapet with lattice windows
  block(410, 214, 180, 32, C.stoneLt, { courses: 11 });
  for (let i = 0; i < 9; i++) { const wx = 418 + i * 19; add(`<path d="M${wx} 242V226a6 6 0 0 1 12 0V242z" fill="${C.indigoDk}" ${ST}/><path d="M${wx + 6} 222V242M${wx} 234H${wx + 12}" stroke="${C.gold}" stroke-width="1.2" opacity=".8"/>`); }
  dome(500, 214, 46, C.teal, { tall: 1.1 });
  add(`<path d="M500 128V92" stroke="${C.ink}" stroke-width="2.4"/><path d="M500 92l30 8l-30 8z" fill="${C.red}" ${ST}/>`);
  // great arch
  arch(500, G, 128, 168, C.indigoDk, { rim: true, keystone: true, lit: true });
  add(`<path d="M460 ${G}V330M540 ${G}V330" stroke="${C.gold}" stroke-width="1" opacity=".4"/>`);
  for (const cx of [410, 590]) arch(cx, G, 44, 96, C.indigoDk, { rim: true, lit: false });
  for (const cx of [376, 624]) { win(cx - 6, 292, 12, 30, true); win(cx - 6, 340, 12, 30, false); }
  add(`</g>`);

  // sea beyond the hotel, a boat on it, and a green headland where the sea link lands
  add(`<path d="M858 ${G - 26}Q900 ${G - 31} 940 ${G - 26}T1000 ${G - 26}V${G}H858z" fill="${C.water}" ${ST} opacity=".95"/>`);
  for (let i = 0; i < 6; i++) add(`<path d="M${868 + i * 20} ${G - 12 + (i % 3) * 4}q6 -5 12 0" stroke="#fff" stroke-width="1.6" opacity=".65" fill="none"/>`);
  add(`<g><path d="M902 ${G - 14}h56l-9 13h-38z" fill="${C.clay}" ${ST}/><path d="M930 ${G - 14}V${G - 60}" stroke="${C.ink}" stroke-width="2.4"/><path d="M930 ${G - 58}Q954 ${G - 36} 954 ${G - 17}H932z" fill="${C.cream}" ${ST}/><path d="M934 ${G - 50}Q946 ${G - 34} 947 ${G - 22}" stroke="${C.ink}" stroke-width="1" opacity=".4" fill="none"/></g>`);
  add(`<path d="M988 ${G + 6}Q996 ${G - 58} 1040 ${G - 66}Q1096 ${G - 70} 1130 ${G + 6}z" fill="${C.olive}" ${ST}/>`);
  for (let i = 0; i < 14; i++) add(`<path d="M${f(1000 + r() * 110)} ${f(G - 52 + r() * 50)}l2 -7M${f(1003 + r() * 110)} ${f(G - 52 + r() * 50)}l-1 -6" stroke="${C.ink}" stroke-width="1.1" opacity=".38"/>`);

  // trees and plants in front
  palm(70, G + 4, 215, -26); palm(676, G + 4, 190, -18); palm(1040, G - 56, 150, 14);
  tree(34, G + 8, 70, C.oliveDk);
  bush(150, G + 10, 54); bush(268, G + 10, 46, C.olive); bush(450, G + 12, 60); bush(560, G + 12, 56, C.olive); bush(730, G + 12, 50); bush(900, G + 12, 56, C.olive);
};

// ground and hills (drawn in front of everything else)
const ground = () => {
  // the ground runs far past both edges of the drawing so it meets the screen edges at any width; the page clips it
  const X0 = -1800, X1 = 2800;
  add(`<path d="M${X0} ${G + 8}Q-600 ${G - 6} -100 ${G + 6}Q140 ${G - 6} 300 ${G + 6}T620 ${G + 4}T1010 ${G + 2}Q1500 ${G - 6} 2000 ${G + 6}T${X1} ${G + 4}V${H + 10}H${X0}z" fill="${C.olive}" ${ST}/>`);
  add(`<path d="M${X0} ${G + 30}Q-600 ${G + 14} 420 ${G + 28}T1010 ${G + 22}T${X1} ${G + 24}V${H + 10}H${X0}z" fill="${C.oliveDk}" ${ST}/>`);
  for (let i = 0; i < 700; i++) { const x = X0 + r() * (X1 - X0), y = G + 14 + r() * 40; add(`<path d="M${f(x)} ${f(y)}l2 -7M${f(x + 3)} ${f(y)}l-1 -6" stroke="${C.ink}" stroke-width="1.1" opacity=".38"/>`); }
  for (let i = 0; i < 260; i++) add(`<circle cx="${f(X0 + r() * (X1 - X0))}" cy="${f(G + 16 + r() * 36)}" r="3" fill="${pick([C.gold, C.gold, C.magenta, C.clay])}" stroke="${C.ink}" stroke-width="1"/>`);
  for (let x = X0; x < X1; x += 130 + r() * 90) if (x < -60 || x > 1060) bush(x, G + 12, 44 + r() * 26, pick([C.olive, C.oliveDk]));
};

add(`<g filter="url(#paper)"><g filter="url(#wob)">`);
sky();
ground();
add(`</g></g>`);
save("skyline.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" overflow="visible" role="img" aria-label="Ink illustration of a Mumbai waterfront: a clock tower, a great stone gateway, a domed hotel, a cable-stayed sea link, palms and a fishing boat">${defs}\n${s}</svg>\n`);

// ---------- filler tile: far skyline that repeats sideways ----------
s = "";
const TW = 600, TH = 300;
{
  add(`<g filter="url(#paperSoft)">`);
  for (let x = 6; x < TW - 40; ) {
    const w = 24 + r() * 44, h = 50 + r() * 190;
    if (x + w > TW - 14) break;
    add(`<rect x="${f(x)}" y="${f(TH - h)}" width="${f(w)}" height="${f(h)}" fill="${pick([C.lav, C.lav, C.lavDk])}" stroke="${C.lavDk}" stroke-width="2"/>`);
    if (r() > 0.6) add(`<path d="M${f(x)} ${f(TH - h)}l${f(w / 2)} -14l${f(w / 2)} 14z" fill="${C.lavDk}" stroke="${C.lavDk}" stroke-width="2"/>`);
    for (let yy = TH - h + 12; yy < TH - 10; yy += 15) for (let xx = x + 6; xx < x + w - 6; xx += 10) if (r() > 0.5) add(`<rect x="${f(xx)}" y="${f(yy)}" width="4" height="7" fill="${C.lavDk}"/>`);
    x += w + 4 + r() * 10;
  }
  add(`</g>`);
}
save("filler.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TW} ${TH}" width="${TW}" height="${TH}" preserveAspectRatio="xMinYMax slice" aria-hidden="true">${defs}\n${s}</svg>\n`);

// ---------- local train ----------
s = "";
const TRW = 700, TRH = 84;
{
  add(`<g filter="url(#paper)"><g filter="url(#wob)">`);
  for (let i = 0; i < 4; i++) {
    const x = 6 + i * 172, stripe = i % 2 === 0 ? C.clay : C.teal;
    add(`<rect x="${x}" y="14" width="166" height="50" rx="8" fill="${C.cream}" ${ST}/>`);
    add(`<rect x="${x}" y="46" width="166" height="18" fill="${stripe}" ${ST}/>`);
    add(`<rect x="${x + 2}" y="16" width="162" height="6" rx="3" fill="${C.creamDk}" stroke="${C.ink}" stroke-width="1.2"/>`);
    for (let w = 0; w < 5; w++) {
      const wx = x + 12 + w * 30;
      add(`<rect x="${wx}" y="26" width="22" height="18" rx="3" fill="${C.indigoDk}" ${ST}/>`);
      if (r() > 0.35) add(`<circle cx="${wx + 6 + r() * 10}" cy="34" r="3.4" fill="${pick([C.gold, C.cream, C.magenta])}"/><path d="M${wx + 4} 44q6 -8 14 0" fill="${pick([C.gold, C.cream, C.magenta])}" opacity=".9"/>`);
    }
    add(`<path d="M${x + 80} 16V62" stroke="${C.ink}" stroke-width="1.6"/>`);
    add(`<rect x="${x + 70}" y="6" width="26" height="8" rx="2" fill="${C.ink}" opacity=".85"/>`);
    add(`<g fill="${C.ink}"><circle cx="${x + 30}" cy="68" r="8"/><circle cx="${x + 136}" cy="68" r="8"/></g><g fill="${C.creamDk}"><circle cx="${x + 30}" cy="68" r="3"/><circle cx="${x + 136}" cy="68" r="3"/></g>`);
    add(`<rect x="${x + 166}" y="36" width="6" height="12" fill="${C.ink}"/>`);
  }
  add(`<circle cx="${TRW - 8}" cy="40" r="4.4" fill="${C.gold}" ${ST}/>`);
  add(`</g></g>`);
}
save("train.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TRW} ${TRH}" preserveAspectRatio="xMinYMax meet" aria-hidden="true">${defs}\n${s}</svg>\n`);

// ---------- clouds ----------
// Overlapping circles clipped to a flat base: each is stroked, then all are filled over the stroke, so only the outer outline remains.
function cloud(seed, w) {
  const q = rng(seed);
  s = "";
  const n = 6;
  const circles = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = 18 + Math.sin(t * Math.PI) * 30 * (0.7 + q() * 0.5) + q() * 6;
    circles.push([f(14 + t * (w - 28)), f(62 - rr * 0.62), f(rr)]);
  }
  const id = `cl${seed}`;
  add(`<clipPath id="${id}"><rect x="-10" y="-80" width="${w + 20}" height="142"/></clipPath>`);
  add(`<g filter="url(#paperSoft)" clip-path="url(#${id})">`);
  for (const [cx, cy, rr] of circles) add(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#fcf6e6" stroke="#c4b48c" stroke-width="5"/>`);
  for (const [cx, cy, rr] of circles) add(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#fcf6e6"/>`);
  add(`<path d="M0 62H${w}" stroke="#c4b48c" stroke-width="4"/>`);
  for (let i = 0; i < 8; i++) { const [cx, cy, rr] = pick(circles); add(`<path d="M${f(cx - rr * 0.5)} ${f(cy + rr * (0.1 + q() * 0.4))}q${f(rr * 0.4)} ${f(-rr * 0.35)} ${f(rr * 0.8)} 0" stroke="#c4b48c" stroke-width="1.8" fill="none" opacity=".85"/>`); }
  for (let i = 0; i < 5; i++) add(`<path d="M${f(10 + q() * (w - 60))} ${f(52 + q() * 6)}h${f(16 + q() * 22)}" stroke="#c4b48c" stroke-width="1.5" opacity=".6"/>`);
  add(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -40 ${w + 12} 112" aria-hidden="true">${defs}\n${s}</svg>\n`;
}
save("cloud-a.svg", cloud(3, 300));
save("cloud-b.svg", cloud(8, 240));
save("cloud-c.svg", cloud(14, 340));

// ---------- sun with rays ----------
s = "";
{
  const cx = 150, cy = 150;
  add(`<g class="rays">`);
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; add(`<path d="M${f(cx + Math.cos(a) * 78)} ${f(cy + Math.sin(a) * 78)}L${f(cx + Math.cos(a + 0.05) * (i % 2 ? 116 : 134))} ${f(cy + Math.sin(a + 0.05) * (i % 2 ? 116 : 134))}" stroke="#d99a1c" stroke-width="3.2" stroke-linecap="round" opacity=".8"/>`); }
  add(`</g>`);
  add(`<g filter="url(#paperSoft)">`);
  add(`<circle cx="${cx}" cy="${cy}" r="66" fill="#f6c445" stroke="#c98b12" stroke-width="3"/>`);
  add(`<circle cx="${cx}" cy="${cy}" r="48" fill="none" stroke="#c98b12" stroke-width="1.4" opacity=".55"/>`);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(`<path d="M${f(cx + Math.cos(a) * 20)} ${f(cy + Math.sin(a) * 20)}L${f(cx + Math.cos(a) * 44)} ${f(cy + Math.sin(a) * 44)}" stroke="#c98b12" stroke-width="1.3" opacity=".5"/>`); }
  add(`</g>`);
}
save("sun.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" aria-hidden="true">${defs}\n${s}</svg>\n`);

// ---------- birds ----------
s = "";
for (const [x, y, k] of [[10, 30, 1], [54, 12, 0.8], [96, 40, 0.9], [140, 20, 0.7]]) add(`<path class="bird" style="animation-delay:${(-x / 40).toFixed(1)}s" d="M${x} ${y}q${8 * k} ${-10 * k} ${16 * k} 0q${8 * k} ${-10 * k} ${16 * k} 0" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>`);
save("birds.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 60" aria-hidden="true">${s}</svg>\n`);

// ---------- garland with swaying lanterns ----------
s = "";
const GW = 1200, GH = 170;
const swag = (x0, x1, sag) => {
  const mx = (x0 + x1) / 2;
  const pt = (t) => ({ x: x0 + (x1 - x0) * t, y: 10 + 4 * sag * t * (1 - t) });
  s += `<path d="M${x0} 10Q${mx} ${10 + sag * 2} ${x1} 10" fill="none" stroke="${C.tealDk}" stroke-width="2.6"/>\n`;
  const n = Math.floor((x1 - x0) / 15);
  for (let i = 1; i < n; i++) {
    const p = pt(i / n), col = i % 3 === 0 ? C.gold : i % 3 === 1 ? "#e8791b" : "#f6c445";
    s += `<circle cx="${f(p.x)}" cy="${f(p.y + 5)}" r="${f(7 + (i % 2))}" fill="${col}" stroke="${C.ink}" stroke-width="1.3"/>`;
    if (i % 4 === 0) s += `<circle cx="${f(p.x)}" cy="${f(p.y + 5)}" r="2.6" fill="${C.clay}"/>`;
    if (i % 5 === 2) s += `<path d="M${f(p.x)} ${f(p.y + 12)}q-5 8 0 15q5 -7 0 -15" fill="${C.olive}" stroke="${C.ink}" stroke-width="1"/>`;
  }
};
// the tile starts and ends at the same height, so copies placed side by side join into one continuous garland
swag(0, 400, 34); swag(400, 800, 34); swag(800, 1200, 34);
const swags = s;
s = "";
let li = 0;
for (const [x, len, col, y0] of [[400, 70, C.red, 10], [800, 70, C.red, 10], [150, 46, C.magenta, 30], [1060, 46, C.magenta, 30], [600, 42, C.teal, 30], [270, 38, C.gold, 34], [930, 38, C.gold, 34]]) {
  s += `<g class="sway" style="transform-origin:${x}px ${y0}px;animation-delay:${(-li++ * 0.9).toFixed(1)}s"><path d="M${x} ${y0}V${y0 + 16}" stroke="${C.ink}" stroke-width="2"/>
<rect x="${x - 8}" y="${y0 + 16}" width="16" height="6" rx="2" fill="${C.gold}" stroke="${C.ink}" stroke-width="1.4"/>
<path d="M${x - 13} ${y0 + 22}q-5 ${len / 2} 3 ${len - 8}h20q8 -${len / 2 - 8} 3 -${len - 8}z" fill="${col}" stroke="${C.ink}" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M${x} ${y0 + 22}v${len - 8}M${x - 7} ${y0 + 24}q-2 ${len / 2 - 4} 2 ${len - 10}M${x + 7} ${y0 + 24}q2 ${len / 2 - 4} -2 ${len - 10}" stroke="${C.gold}" stroke-width="1.3" opacity=".7" fill="none"/>
<rect x="${x - 9}" y="${y0 + len + 12}" width="18" height="6" rx="2" fill="${C.gold}" stroke="${C.ink}" stroke-width="1.4"/>
<path d="M${x} ${y0 + len + 18}v12" stroke="${C.gold}" stroke-width="2.2"/><circle cx="${x}" cy="${y0 + len + 33}" r="3.4" fill="${C.gold}" stroke="${C.ink}" stroke-width="1"/></g>\n`;
}
save("garland.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="xMidYMin meet" aria-hidden="true">${defs}\n<g filter="url(#paper)">${swags}</g>\n${s}</svg>\n`);


// ---------- spot illustrations for the app pages (200 x 150) ----------
function spot(name, label, body) {
  s = "";
  add(`<g filter="url(#paper)"><g filter="url(#wob)">`);
  body();
  add(`</g></g>`);
  save(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" role="img" aria-label="${label}">${defs}\n${s}</svg>\n`);
}
const book = (x, y, w, h) => {
  // open bahi-khata: red cloth cover, two cream pages with ruled lines, a marigold ribbon
  add(`<path d="M${x - 6} ${y + 8}L${x + w / 2} ${y + 14}L${x + w + 6} ${y + 8}V${y + h + 8}L${x + w / 2} ${y + h + 14}L${x - 6} ${y + h + 8}z" fill="${C.red}" ${ST}/>`);
  add(`<path d="M${x} ${y}Q${x + w / 4} ${y - 6} ${x + w / 2} ${y + 6}V${y + h}Q${x + w / 4} ${y + h - 6} ${x} ${y + h}z" fill="${C.cream}" ${ST}/>`);
  add(`<path d="M${x + w} ${y}Q${x + (w * 3) / 4} ${y - 6} ${x + w / 2} ${y + 6}V${y + h}Q${x + (w * 3) / 4} ${y + h - 6} ${x + w} ${y + h}z" fill="${C.cream}" ${ST}/>`);
  for (let i = 0; i < 6; i++) { const yy = y + 16 + i * ((h - 22) / 6); add(`<path d="M${x + 8} ${f(yy)}H${x + w / 2 - 8}M${x + w / 2 + 8} ${f(yy)}H${x + w - 8}" stroke="${C.ink}" stroke-width="1.2" opacity=".4"/>`); }
  add(`<path d="M${x + w / 2} ${y + 6}V${y + h + 22}l-5 -7l-5 7V${y + h}" fill="${C.gold}" ${ST}/>`);
  add(`<rect x="${x + w / 2 + 10}" y="${y + 6}" width="${w / 2 - 6}" height="${h - 12}" fill="url(#hatch)" opacity=".6"/>`);
};
spot("spot-supplier.svg", "Drawing of an open red ledger book with a marigold ribbon, an ink pot and a pen", () => {
  book(34, 36, 120, 76);
  add(`<path d="M160 100h22v22a8 8 0 0 1 -8 8h-6a8 8 0 0 1 -8 -8z" fill="${C.indigo}" ${ST}/><path d="M166 100v-6h10v6" fill="${C.creamDk}" ${ST}/>`);
  add(`<path d="M172 92L188 40l6 4l-10 50z" fill="${C.cream}" ${ST}/><path d="M188 40l6 4l4 -10z" fill="${C.clay}" ${ST}/>`);
  add(`<circle cx="26" cy="46" r="7" fill="${C.gold}" ${ST}/><circle cx="26" cy="46" r="2.6" fill="${C.clay}"/><path d="M26 53v12" stroke="${C.oliveDk}" stroke-width="2.4"/>`);
});
spot("spot-investor.svg", "Drawing of stacked coins with a green sprout growing beside them", () => {
  const coin = (cx, cy, rr) => { add(`<ellipse cx="${cx}" cy="${cy + 8}" rx="${rr}" ry="${rr * 0.4}" fill="${C.clay}" ${ST}/><rect x="${cx - rr}" y="${cy}" width="${rr * 2}" height="8" fill="${C.clay}" stroke="none"/><path d="M${cx - rr} ${cy}v8M${cx + rr} ${cy}v8" stroke="${C.ink}" stroke-width="2.2"/><ellipse cx="${cx}" cy="${cy}" rx="${rr}" ry="${rr * 0.4}" fill="${C.gold}" ${ST}/><ellipse cx="${cx}" cy="${cy}" rx="${rr * 0.62}" ry="${rr * 0.24}" fill="none" stroke="${C.ink}" stroke-width="1.2" opacity=".55"/>`); };
  for (let i = 0; i < 5; i++) coin(70, 112 - i * 11, 34);
  for (let i = 0; i < 3; i++) coin(128, 112 - i * 11, 28);
  add(`<ellipse cx="116" cy="40" rx="16" ry="6" fill="${C.gold}" ${ST} transform="rotate(-18 116 40)"/>`);
  add(`<path d="M164 122V70" stroke="${C.oliveDk}" stroke-width="3.4" fill="none"/>`);
  add(`<path d="M164 90q-26 -4 -30 -26q22 -2 30 26z" fill="${C.olive}" ${ST}/><path d="M164 76q24 -2 30 -26q-24 -2 -30 26z" fill="${C.teal}" ${ST}/>`);
  add(`<path d="M150 124h30l-4 14h-22z" fill="${C.stone}" ${ST}/>`);
});
spot("spot-debtor.svg", "Drawing of a small shop with a striped awning, a door and a hanging sign", () => {
  add(`<rect x="38" y="62" width="124" height="70" fill="${C.cream}" ${ST}/><rect x="124" y="63" width="37" height="68" fill="url(#hatch)" opacity=".7"/>`);
  for (let i = 0; i < 8; i++) add(`<path d="M${38 + i * 15.5} 40h15.5l4 24h-23.5z" fill="${i % 2 ? C.cream : C.red}" ${ST}/>`);
  add(`<path d="M34 40h132" stroke="${C.ink}" stroke-width="3"/>`);
  add(`<path d="M46 132V92a14 14 0 0 1 28 0V132z" fill="${C.indigoDk}" ${ST}/><circle cx="68" cy="112" r="2.4" fill="${C.gold}"/>`);
  add(`<rect x="90" y="84" width="58" height="34" fill="${C.indigo}" ${ST}/><path d="M119 84V118M90 101H148" stroke="${C.gold}" stroke-width="1.6" opacity=".8"/>`);
  add(`<path d="M44 132H156" stroke="${C.ink}" stroke-width="3"/>`);
  add(`<path d="M150 26V40" stroke="${C.ink}" stroke-width="2"/><rect x="138" y="14" width="28" height="14" rx="2" fill="${C.gold}" ${ST}/><path d="M143 21h18" stroke="${C.ink}" stroke-width="1.6"/>`);
  for (const [x, c] of [[22, C.olive], [178, C.oliveDk]]) add(`<path d="M${x - 10} 132q-2 -26 10 -34q12 8 10 34z" fill="${c}" ${ST}/>`);
});
spot("spot-attester.svg", "Drawing of a rolled parchment with a red wax seal and a ribbon", () => {
  add(`<path d="M44 36h112q8 0 8 8v62q0 10 -10 10H54q-10 0 -10 -10z" fill="${C.cream}" ${ST}/>`);
  add(`<rect x="44" y="26" width="120" height="12" rx="6" fill="${C.stoneLt}" ${ST}/><rect x="44" y="108" width="120" height="12" rx="6" fill="${C.stoneLt}" ${ST}/>`);
  for (let i = 0; i < 4; i++) add(`<path d="M62 ${54 + i * 11}H${i === 3 ? 100 : 146}" stroke="${C.ink}" stroke-width="1.6" opacity=".45"/>`);
  add(`<g transform="translate(130 100)"><path d="M-14 8l-8 28l12 -8l6 12l6 -28z" fill="${C.magenta}" ${ST}/><path d="M6 8l8 28l-12 -8l-6 12l-6 -28z" fill="${C.gold}" ${ST}/><circle r="22" fill="${C.red}" ${ST}/><circle r="15" fill="none" stroke="${C.ink}" stroke-width="1.6" opacity=".6"/><path d="M0 -9l3 7h8l-6 5l2 8l-7 -4l-7 4l2 -8l-6 -5h8z" fill="${C.gold}" stroke="${C.ink}" stroke-width="1"/></g>`);
  add(`<path d="M40 128q-8 10 6 14M164 128q8 10 -6 14" fill="none" stroke="${C.oliveDk}" stroke-width="2.4"/>`);
});
spot("spot-empty.svg", "Drawing of an empty ledger page with a small lamp beside it", () => {
  add(`<rect x="34" y="30" width="92" height="94" rx="4" fill="${C.cream}" ${ST}/><path d="M34 30v94" stroke="${C.red}" stroke-width="9"/>`);
  for (let i = 0; i < 6; i++) add(`<path d="M52 ${50 + i * 12}H114" stroke="${C.ink}" stroke-width="1.4" stroke-dasharray="3 5" opacity=".5"/>`);
  add(`<rect x="82" y="88" width="46" height="38" fill="url(#hatch2)" opacity=".5"/>`);
  add(`<path d="M150 64h26l-5 44h-16z" fill="${C.gold}" ${ST}/><path d="M156 64q7 -22 14 0" fill="none" stroke="${C.ink}" stroke-width="2"/><rect x="146" y="108" width="34" height="9" rx="3" fill="${C.clay}" ${ST}/><path d="M163 72q-5 12 0 24q5 -12 0 -24z" fill="${C.cream}" opacity=".9"/>`);
  add(`<circle cx="163" cy="40" r="3" fill="${C.gold}"/><path d="M163 46v-6M150 46l-4 -4M176 46l4 -4" stroke="${C.gold}" stroke-width="2" stroke-linecap="round"/>`);
});

console.log("wrote art to web/src/art/");
