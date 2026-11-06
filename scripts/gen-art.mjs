// Generates the landing-page art as plain SVG files: a Mumbai skyline with a local train, and a marigold garland with lanterns.
// Original work, drawn from simple shapes by this script. No third-party artwork was used or traced.
// Run: node scripts/gen-art.mjs   (writes web/src/skyline.svg and web/src/garland.svg)
import { writeFileSync } from "node:fs";

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(11);
const pick = (a) => a[Math.floor(r() * a.length)];
const W = 1200, H = 400, GROUND = 372;

const C = { far: "#d8cce6", far2: "#c9b9d9", ochre: "#d28b3c", clay: "#b5472f", teal: "#2a8c82", tealDark: "#1d6a63", indigo: "#2d2a63", indigoDark: "#1e1c47", gold: "#f2b01e", magenta: "#b83d6e", cream: "#f6e7c1", red: "#b3261e", rail: "#3b3350" };

let s = "";
const add = (x) => (s += x + "\n");

// far skyline: pale towers
add(`<g fill="${C.far}">`);
for (let x = -10; x < W; x += 0) { const w = 24 + r() * 40, h = 70 + r() * 130; add(`<rect x="${x.toFixed(0)}" y="${GROUND - h}" width="${w.toFixed(0)}" height="${h}"/>`); x += w + 4 + r() * 10; }
add(`</g>`);
add(`<g fill="${C.far2}">`);
for (let x = 10; x < W; x += 0) { const w = 18 + r() * 30, h = 40 + r() * 90; add(`<rect x="${x.toFixed(0)}" y="${GROUND - h}" width="${w.toFixed(0)}" height="${h}"/>`); x += w + 10 + r() * 24; }
add(`</g>`);

// clock tower (left)
add(`<g>
<rect x="250" y="150" width="56" height="${GROUND - 150}" fill="${C.ochre}"/>
<rect x="244" y="146" width="68" height="10" fill="${C.clay}"/>
<rect x="256" y="104" width="44" height="44" fill="${C.ochre}"/>
<circle cx="278" cy="126" r="14" fill="${C.cream}" stroke="${C.indigoDark}" stroke-width="3"/>
<path d="M278 126v-9M278 126l7 3" stroke="${C.indigoDark}" stroke-width="2.5" stroke-linecap="round"/>
<path d="M254 104 l24 -44 l24 44z" fill="${C.teal}"/>
<circle cx="278" cy="56" r="4" fill="${C.gold}"/>
<g fill="${C.indigoDark}"><rect x="262" y="176" width="10" height="26" rx="5"/><rect x="284" y="176" width="10" height="26" rx="5"/><rect x="262" y="230" width="10" height="26" rx="5"/><rect x="284" y="230" width="10" height="26" rx="5"/></g>
</g>`);

// arched gateway (centre): a basalt gateway with a great arch, domes and lit windows
add(`<g>
<rect x="470" y="210" width="260" height="${GROUND - 210}" fill="${C.ochre}"/>
<rect x="470" y="204" width="260" height="10" fill="${C.clay}"/>
<rect x="500" y="170" width="50" height="40" fill="${C.ochre}"/><rect x="650" y="170" width="50" height="40" fill="${C.ochre}"/>
<path d="M496 170 q29 -46 58 0z" fill="${C.teal}"/><path d="M646 170 q29 -46 58 0z" fill="${C.teal}"/>
<path d="M600 130 m-36 74 a36 36 0 0 1 72 0z" fill="${C.teal}"/>
<rect x="592" y="96" width="16" height="30" fill="${C.tealDark}"/><circle cx="600" cy="92" r="6" fill="${C.gold}"/>
<path d="M538 ${GROUND} V292 a62 62 0 0 1 124 0 V${GROUND}z" fill="${C.indigoDark}"/>
<path d="M552 ${GROUND} V294 a48 48 0 0 1 96 0 V${GROUND}z" fill="${C.indigo}"/>
<g fill="${C.gold}"><circle cx="600" cy="330" r="5"/><circle cx="578" cy="344" r="3"/><circle cx="622" cy="344" r="3"/></g>
<g fill="${C.clay}"><rect x="486" y="240" width="22" height="34" rx="11"/><rect x="692" y="240" width="22" height="34" rx="11"/><rect x="486" y="300" width="22" height="34" rx="11"/><rect x="692" y="300" width="22" height="34" rx="11"/></g>
<g fill="${C.gold}"><rect x="491" y="248" width="12" height="20" rx="6"/><rect x="697" y="248" width="12" height="20" rx="6"/></g>
</g>`);

// sea-link style cable tower (right of centre)
add(`<g>
<path d="M856 ${GROUND} V120 L874 ${GROUND}z" fill="${C.clay}"/><path d="M892 ${GROUND} V120 L874 ${GROUND}z" fill="${C.magenta}"/>
<path d="M874 120 L874 ${GROUND}" stroke="${C.indigoDark}" stroke-width="2"/>
<g stroke="${C.magenta}" stroke-width="2" fill="none"><path d="M874 130 L760 ${GROUND - 40}"/><path d="M874 150 L790 ${GROUND - 30}"/><path d="M874 170 L820 ${GROUND - 24}"/><path d="M874 130 L1010 ${GROUND - 30}"/><path d="M874 150 L980 ${GROUND - 24}"/><path d="M874 170 L940 ${GROUND - 20}"/></g>
<rect x="740" y="${GROUND - 38}" width="300" height="7" fill="${C.indigoDark}"/>
</g>`);

// domed building with minarets (right)
add(`<g>
<rect x="1040" y="236" width="130" height="${GROUND - 236}" fill="${C.cream}"/>
<path d="M1050 236 a55 55 0 0 1 110 0z" fill="${C.magenta}"/>
<circle cx="1105" cy="176" r="6" fill="${C.gold}"/>
<rect x="1020" y="200" width="16" height="${GROUND - 200}" fill="${C.cream}"/><path d="M1018 200 q10 -26 20 0z" fill="${C.teal}"/>
<rect x="1174" y="200" width="16" height="${GROUND - 200}" fill="${C.cream}"/><path d="M1172 200 q10 -26 20 0z" fill="${C.teal}"/>
<g fill="${C.indigo}"><path d="M1062 ${GROUND} V300 a14 14 0 0 1 28 0 V${GROUND}z"/><path d="M1118 ${GROUND} V300 a14 14 0 0 1 28 0 V${GROUND}z"/></g>
</g>`);

// near buildings with lit windows, filling gaps
const gaps = [[0, 230], [316, 466], [740, 850], [900, 1016]];
for (const [a, b] of gaps) {
  let x = a;
  while (x < b - 30) {
    const w = Math.min(34 + r() * 40, b - x), h = 90 + r() * 120, y = GROUND - h;
    add(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${pick([C.indigo, C.indigoDark, C.tealDark])}"/>`);
    for (let wy = y + 12; wy < GROUND - 16; wy += 22) for (let wx = x + 8; wx < x + w - 10; wx += 16) if (r() > 0.45) add(`<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="7" height="11" rx="1.5" fill="${C.gold}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`);
    x += w + 6;
  }
}

// ground, rails and a local train
add(`<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="${C.indigoDark}"/>`);
add(`<rect x="0" y="${GROUND + 14}" width="${W}" height="4" fill="${C.rail}"/><rect x="0" y="${GROUND + 24}" width="${W}" height="3" fill="${C.rail}"/>`);
for (let x = 6; x < W; x += 26) add(`<rect x="${x}" y="${GROUND + 16}" width="10" height="9" fill="${C.rail}"/>`);
let tx = 120;
for (let i = 0; i < 4; i++) {
  add(`<g>
<rect x="${tx}" y="${GROUND - 42}" width="148" height="46" rx="6" fill="${C.cream}"/>
<rect x="${tx}" y="${GROUND - 14}" width="148" height="18" fill="${i === 0 ? C.red : C.teal}"/>
<rect x="${tx}" y="${GROUND - 44}" width="148" height="5" rx="2" fill="${C.indigoDark}"/>
<g fill="${C.indigo}"><rect x="${tx + 10}" y="${GROUND - 34}" width="22" height="16" rx="2"/><rect x="${tx + 40}" y="${GROUND - 34}" width="22" height="16" rx="2"/><rect x="${tx + 86}" y="${GROUND - 34}" width="22" height="16" rx="2"/><rect x="${tx + 116}" y="${GROUND - 34}" width="22" height="16" rx="2"/></g>
<g fill="${C.gold}" opacity=".85"><rect x="${tx + 12}" y="${GROUND - 31}" width="8" height="8"/><rect x="${tx + 88}" y="${GROUND - 31}" width="8" height="8"/></g>
<g fill="${C.indigoDark}"><circle cx="${tx + 30}" cy="${GROUND + 8}" r="6"/><circle cx="${tx + 118}" cy="${GROUND + 8}" r="6"/></g>
</g>`);
  tx += 152;
}
add(`<rect x="${tx - 2}" y="${GROUND - 38}" width="10" height="26" fill="${C.cream}"/><circle cx="${tx + 4}" cy="${GROUND - 24}" r="5" fill="${C.gold}"/>`);

writeFileSync(new URL("../web/src/skyline.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Illustration: a Mumbai skyline at dusk with a clock tower, a great arched gateway, a cable-stayed bridge, a domed hall and a local train">\n${s}</svg>\n`);

// garland with lanterns
const GW = 1200, GH = 150;
let g = "";
const swag = (x0, x1, sag) => {
  const mx = (x0 + x1) / 2;
  const pt = (t) => { const x = x0 + (x1 - x0) * t; const y = 10 + 4 * sag * t * (1 - t); return [x, y]; };
  g += `<path d="M${x0} 10 Q${mx} ${10 + sag * 2} ${x1} 10" fill="none" stroke="${C.tealDark}" stroke-width="2.5"/>`;
  const n = Math.floor((x1 - x0) / 16);
  for (let i = 1; i < n; i++) {
    const [x, y] = pt(i / n);
    const col = i % 3 === 0 ? C.gold : i % 3 === 1 ? "#e8791b" : "#f6c445";
    g += `<circle cx="${x.toFixed(1)}" cy="${(y + 5).toFixed(1)}" r="${(6.5 + (i % 2)).toFixed(1)}" fill="${col}"/>`;
    if (i % 4 === 0) g += `<circle cx="${x.toFixed(1)}" cy="${(y + 5).toFixed(1)}" r="2.4" fill="${C.clay}"/>`;
  }
};
swag(-10, 400, 34); swag(400, 800, 34); swag(800, 1210, 34);
for (const [x, len, col] of [[400, 62, C.red], [800, 62, C.red], [150, 40, C.magenta], [1060, 40, C.magenta], [600, 34, C.teal]]) {
  const y = 10 + (x === 400 || x === 800 ? 0 : 20);
  g += `<path d="M${x} ${y}V${y + 14}" stroke="${C.indigoDark}" stroke-width="2"/>
<rect x="${x - 7}" y="${y + 14}" width="14" height="5" rx="2" fill="${C.gold}"/>
<path d="M${x - 11} ${y + 19}q-4 ${len / 2} 3 ${len - 8}h16q7 -${len / 2 - 8} 3 -${len - 8}z" fill="${col}"/>
<path d="M${x} ${y + 19}v${len - 8}" stroke="${C.gold}" stroke-width="1.6" opacity=".6"/>
<rect x="${x - 8}" y="${y + len + 8}" width="16" height="5" rx="2" fill="${C.gold}"/>
<path d="M${x} ${y + len + 13}v10" stroke="${C.gold}" stroke-width="2"/><circle cx="${x}" cy="${y + len + 26}" r="3" fill="${C.gold}"/>`;
}
writeFileSync(new URL("../web/src/garland.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="xMidYMin slice" aria-hidden="true">\n${g}\n</svg>\n`);
console.log("wrote skyline.svg and garland.svg");
