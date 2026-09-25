/* The sky: ten moments lifted from the mood board, pinned to the real sun.
   Each moment is a whole atmosphere — gradient, ridges, haze, stars, clouds,
   ink, and the orb's material — and the sky at any minute is an OKLab blend of
   the two moments either side of it. One screen is always one moment. */

import { mixDeep, contrast } from "./color.js";
import { mod24, wrapDelta } from "./engine.js";

/* orb: hi/mid/lo = sphere shading, rim = edge light, glow = halo, ink = text on the orb.
   dark: 0 light sky … 1 night sky (drives surfaces). inkLow: text over the ridges. */
export const MOMENTS = {
  midnight: {
    top: "#0a1230", mid: "#101a42", bot: "#1a2656", ridge: ["#1d2856", "#151e47", "#0f1738"], haze: "#2b3871",
    stars: 1, clouds: 0, moon: 1, ink: "#eef1fb", inkLow: "#e3e8f7", dark: 1,
    orb: { hi: "#34428a", mid: "#1f2a66", lo: "#111944", rim: "#8b9eee", rimA: 0.38, glow: "#4c5fc4", glowA: 0.22, ink: "#e8ecfa" },
  },
  predawn: {
    top: "#222460", mid: "#2e2d6b", bot: "#423b7b", ridge: ["#37336f", "#2b2963", "#211f52"], haze: "#4d4789",
    stars: 0.7, clouds: 0, moon: 0.5, ink: "#eeeefb", inkLow: "#e8e6f8", dark: 1,
    orb: { hi: "#4f4d9b", mid: "#34327a", lo: "#201e56", rim: "#aaa2f2", rimA: 0.32, glow: "#6d64c8", glowA: 0.2, ink: "#ecebfb" },
  },
  dawn: {
    top: "#6c72ad", mid: "#b19ab9", bot: "#efb99f", ridge: ["#a78db2", "#8b75a1", "#6e5c8d"], haze: "#e6b4a8",
    stars: 0.1, clouds: 0.15, moon: 0, ink: "#fdfaf9", inkLow: "#fff8f4", dark: 0.6,
    orb: { hi: "#fff4ee", mid: "#f3d0c3", lo: "#d3a2a8", rim: "#ffffff", rimA: 0.45, glow: "#ffc7a8", glowA: 0.35, ink: "#5b4a6a" },
  },
  sunrise: {
    top: "#a4bedf", mid: "#e1d7e0", bot: "#f7dcc3", ridge: ["#dcc7cd", "#ccb3bc", "#b89eae"], haze: "#f6e1d0",
    stars: 0, clouds: 0.55, moon: 0, ink: "#3e5580", inkLow: "#495980", dark: 0.08,
    orb: { hi: "#ffffff", mid: "#fbf2eb", lo: "#e2d2c9", rim: "#ffffff", rimA: 0.65, glow: "#ffe2c8", glowA: 0.35, ink: "#3d5580" },
  },
  morning: {
    top: "#b3cce8", mid: "#d6e2ee", bot: "#f3ebe1", ridge: ["#e3e9f0", "#d8e0ea", "#ccd7e4"], haze: "#f5efe7",
    stars: 0, clouds: 0.95, moon: 0, ink: "#3b5783", inkLow: "#3f5a84", dark: 0,
    orb: { hi: "#ffffff", mid: "#f6f3ef", lo: "#dbd5cf", rim: "#ffffff", rimA: 0.75, glow: "#ffffff", glowA: 0.3, ink: "#3b5783" },
  },
  noon: {
    top: "#9dc1ea", mid: "#cddff3", bot: "#eef4f9", ridge: ["#d7e3ef", "#c9d9e9", "#bacde2"], haze: "#eff5fa",
    stars: 0, clouds: 0.8, moon: 0, ink: "#35547f", inkLow: "#3a5780", dark: 0,
    orb: { hi: "#ffffff", mid: "#eff5fb", lo: "#cad8e8", rim: "#ffffff", rimA: 0.75, glow: "#ffffff", glowA: 0.3, ink: "#35547f" },
  },
  afternoon: {
    top: "#a9c0e1", mid: "#d4dbeb", bot: "#f1e7de", ridge: ["#ddd7e1", "#cfc7d7", "#bdb3c9"], haze: "#f3e9e2",
    stars: 0, clouds: 0.6, moon: 0, ink: "#415a83", inkLow: "#465b80", dark: 0,
    orb: { hi: "#ffffff", mid: "#f8f2ed", lo: "#ddd2cb", rim: "#ffffff", rimA: 0.65, glow: "#fff0e0", glowA: 0.3, ink: "#415a83" },
  },
  golden: {
    top: "#ebdce6", mid: "#f4c9ae", bot: "#f2a781", ridge: ["#efb694", "#e6a189", "#d98e85"], haze: "#f8c8a7",
    stars: 0, clouds: 0.2, moon: 0, ink: "#52475c", inkLow: "#553a44", dark: 0.15,
    orb: { hi: "#fdd9ae", mid: "#f8bb88", lo: "#ef9c6d", rim: "#ffe6c6", rimA: 0.5, glow: "#ffbe86", glowA: 0.55, ink: "#7a4436" },
  },
  dusk: {
    top: "#8a82b8", mid: "#c19ab4", bot: "#e8a995", ridge: ["#8f7dac", "#78699f", "#5e5391"], haze: "#d9a0a7",
    stars: 0.08, clouds: 0.1, moon: 0, ink: "#fdf8fa", inkLow: "#fbf4f8", dark: 0.55,
    orb: { hi: "#d9c5e4", mid: "#9a83b8", lo: "#6f5e98", rim: "#fff0f5", rimA: 0.42, glow: "#f3b9c0", glowA: 0.3, ink: "#ffffff" },
  },
  bluehour: {
    top: "#1e3163", mid: "#28407b", bot: "#395692", ridge: ["#2d437b", "#23386c", "#1b2d5d"], haze: "#45619d",
    stars: 0.45, clouds: 0, moon: 0.6, ink: "#eef2fb", inkLow: "#e6ecfa", dark: 0.95,
    orb: { hi: "#6184c7", mid: "#3d5e9d", lo: "#25407a", rim: "#adc5f3", rimA: 0.36, glow: "#5b80c0", glowA: 0.3, ink: "#f0f4fc" },
  },
};

/* Where each moment sits, relative to the sun. Offsets shrink on short days or
   short nights so the order never tangles (Oslo in June, Delhi in December). */
function anchors(sun) {
  const { sunrise: sr, sunset: ss, noon } = sun;
  const midnight = mod24(noon + 12);
  if (sun.polar === "day") {
    return [["noon", noon], ["afternoon", noon + 5], ["golden", noon + 10], ["dusk", noon + 12],
      ["golden", noon + 14], ["sunrise", noon - 7], ["morning", noon - 4]];
  }
  if (sun.polar === "night") {
    return [["midnight", midnight], ["predawn", noon - 4], ["bluehour", noon], ["predawn", noon + 4]];
  }
  const D = mod24(ss - sr), N = 24 - D;
  const kd = Math.min(1, (0.45 * D) / 2.6), kn = Math.min(1, (0.45 * N) / 1.4);
  return [
    ["midnight", midnight],
    ["predawn", sr - 1.4 * kn],
    ["dawn", sr - 0.25 * kn],
    ["sunrise", sr + 0.6 * kd],
    ["morning", sr + 2.4 * kd],
    ["noon", noon],
    ["afternoon", ss - 2.6 * kd],
    ["golden", ss - 0.9 * kd],
    ["dusk", ss + 0.15 * kn],
    ["bluehour", ss + 1.0 * kn],
  ];
}

const smooth = (u) => u * u * (3 - 2 * u);

/** The full atmosphere at hour t. */
export function skyAt(t, sun) {
  const list = anchors(sun).map(([key, h]) => ({ key, h: mod24(h) })).sort((a, b) => a.h - b.h);
  t = mod24(t);
  let i = list.length - 1;
  for (let k = 0; k < list.length; k++) if (list[k].h <= t) i = k;
  const a = list[i], b = list[(i + 1) % list.length];
  const span = mod24(b.h - a.h) || 24;
  const u = smooth(Math.min(1, mod24(t - a.h) / span));
  const A = MOMENTS[a.key], B = MOMENTS[b.key];
  const sky = mixDeep(A, B, u);
  /* Ink is chosen, never blended: white fading toward slate passes through a
     grey that vanishes on a mid-tone dawn. Take whichever end reads better
     on the colour actually behind it. */
  const pick = (x, y, bg) => (contrast(x, bg) >= contrast(y, bg) ? x : y);
  sky.ink = pick(A.ink, B.ink, sky.top);
  sky.inkLow = pick(A.inkLow, B.inkLow, sky.ridge[1]);
  sky.orb.ink = pick(A.orb.ink, B.orb.ink, sky.orb.mid);
  sky.from = a.key; sky.to = b.key; sky.u = u;
  return sky;
}

/** Named phase for words, not colours. */
export function phaseAt(t, sun) {
  if (sun.polar === "day") return "day";
  if (sun.polar === "night") return "night";
  const dSr = wrapDelta(t - sun.sunrise), dSs = wrapDelta(t - sun.sunset);
  if (dSs >= -0.1 && dSs < 0.75) return "dusk";
  if (dSs >= -1.25 && dSs < -0.1) return "golden";
  if (dSr >= -0.4 && dSr < 0.75) return "dawn";
  if (dSr >= -2.5 && dSr < -0.4) return "predawn";
  return mod24(t - sun.sunrise) < mod24(sun.sunset - sun.sunrise) ? "day" : "night";
}

/** 0 at the horizon, 1 at solar noon; negative below the horizon. Rough, for placing the sun. */
export function sunHeight(t, sun) {
  if (sun.polar === "day") return 0.6 + 0.4 * Math.cos((wrapDelta(t - sun.noon) / 12) * Math.PI);
  if (sun.polar === "night") return -1;
  const D = mod24(sun.sunset - sun.sunrise);
  const into = mod24(t - sun.sunrise);
  if (into <= D) return Math.sin((into / D) * Math.PI);
  const N = 24 - D;
  return -Math.sin(((into - D) / N) * Math.PI);
}
