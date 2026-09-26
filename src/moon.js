/* The moon as it really is tonight: its phase from the synodic month, and a
   rough window when it is above the horizon (it transits about 50 minutes
   later each day: at noon when new, at midnight when full). Pure. */

import { wrapDelta } from "./engine.js";

const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 864e5; // a known new moon, in days since 1970

const NAMES = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];

/** phase: 0 new → 0.5 full → 1 new. illum: lit fraction of the disc. */
export function moonPhase(date) {
  const days = date.getTime() / 864e5 - NEW_MOON;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = age / SYNODIC;
  const illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  return { phase, age, illum, name: NAMES[Math.round(phase * 8) % 8] };
}

/** 0…1: how far above the horizon the moon roughly is at local hour t, given the sun's noon. */
export function moonUp(t, phase, noon = 12) {
  const transit = noon + phase * 24;
  const ha = Math.abs(wrapDelta(t - transit)); // hours from its highest point
  return ha >= 6.2 ? 0 : Math.min(1, (6.2 - ha) / 0.8);
}

/**
 * SVG path of the lit part of a moon of radius r centred on (cx, cy).
 * Waxing moons are lit on the right as seen from the north; `south` mirrors it.
 */
export function moonPath(phase, r, cx = 0, cy = 0, south = false) {
  const waxing = phase < 0.5;
  const rx = Math.abs(Math.cos(phase * 2 * Math.PI)) * r;
  let outer = waxing ? 1 : 0;                                   // top → bottom round the lit limb
  let term = waxing ? (phase < 0.25 ? 0 : 1) : (phase > 0.75 ? 1 : 0); // bottom → top along the terminator
  if (south) { outer = 1 - outer; term = 1 - term; }
  const f = (n) => Math.round(n * 100) / 100;
  return `M${f(cx)} ${f(cy - r)}A${f(r)} ${f(r)} 0 0 ${outer} ${f(cx)} ${f(cy + r)}A${f(rx)} ${f(r)} 0 0 ${term} ${f(cx)} ${f(cy - r)}Z`;
}
