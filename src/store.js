/* Persistence and history. Storage can be missing, full, or full of junk;
   none of that may reach the renderer. */

import { sanitizeBlocks, uid, cloneBlocks } from "./engine.js";
import { TYPE_IDS, sampleDay } from "./types.js";

const K = {
  blocks: "dayshaper.blocks.v3",
  legacyBlocks: "dayshaper.clay.blocks.v2", // linear-day format from the first version; still valid input
  legacyNowTop: "dayshaper.clay.nowtop.v2",
  prefs: "dayshaper.prefs.v1",
};

function read(key) {
  try { const raw = localStorage.getItem(key); return raw == null ? undefined : JSON.parse(raw); } catch { return undefined; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadBlocks() {
  const v3 = sanitizeBlocks(read(K.blocks), TYPE_IDS);
  if (v3) return v3;
  const v2 = sanitizeBlocks(read(K.legacyBlocks), TYPE_IDS);
  if (v2) return v2;
  return sampleDay(uid);
}

export function saveBlocks(blocks) {
  return write(K.blocks, blocks.map(({ id, type, start, len, name }) => (name ? { id, type, start, len, name } : { id, type, start, len })));
}

export const ORIENTATIONS = ["noon", "sun", "now"];

export const DEFAULT_PREFS = { hour12: null, orientation: "noon", nowOnTop: false, loc: null, shapedOnce: false };

export function loadPrefs() {
  const p = read(K.prefs);
  const prefs = { ...DEFAULT_PREFS };
  if (p && typeof p === "object") {
    if (typeof p.hour12 === "boolean") prefs.hour12 = p.hour12;
    if (ORIENTATIONS.includes(p.orientation)) {
      prefs.orientation = p.orientation;
    } else if (typeof p.nowOnTop === "boolean") {
      prefs.orientation = p.nowOnTop ? "now" : "noon";
    }
    if (typeof p.shapedOnce === "boolean") prefs.shapedOnce = p.shapedOnce;
    const lat = Number(p.loc?.lat), lon = Number(p.loc?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) prefs.loc = { lat, lon };
  } else if (read(K.legacyNowTop) === true) {
    prefs.orientation = "now";
  }
  prefs.nowOnTop = prefs.orientation === "now";
  return prefs;
}

export const savePrefs = (prefs) => {
  const out = { ...prefs };
  out.nowOnTop = out.orientation === "now";
  return write(K.prefs, out);
};

/** Undo history of whole-day snapshots. */
export function createHistory(limit = 60) {
  const past = [];
  return {
    push(blocks, label) { past.push({ blocks: cloneBlocks(blocks), label }); if (past.length > limit) past.shift(); },
    pop() { return past.pop() || null; },
    peek() { return past[past.length - 1] || null; },
    get size() { return past.length; },
  };
}

/* A day fits in a link: type initial + start + length in quarter hours.
   "s94.30w36.14" → sleep at 23:30 for 7h30, work at 09:00 for 3h30. */
const CODE = { sleep: "s", work: "w", eat: "e", move: "m", rest: "r" };
const DECODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));

const EMPTY = "0"; // a day cleared on purpose, as opposed to a missing or broken code
const TOKEN = "([swemr])(\\d{1,2})\\.(\\d{1,2})(?:~([^~]{1,24})~)?";

export function encodeDay(blocks) {
  if (!blocks.length) return EMPTY;
  return blocks.map((b) => CODE[b.type] + Math.round(b.start * 4) + "." + Math.round(b.len * 4)
    + (b.name ? "~" + cleanName(b.name).replace(/~/g, "") + "~" : "")).join("");
}
/** A whole code or nothing: a truncated or garbled link must never replace a day with part of one. */
export function decodeDay(str) {
  if (typeof str !== "string" || !str || str.length > 1200) return null;
  if (str === EMPTY) return [];
  if (!new RegExp(`^(?:${TOKEN})+$`).test(str)) return null;
  const out = [];
  const re = new RegExp(TOKEN, "g");
  let m;
  while ((m = re.exec(str))) out.push({ type: DECODE[m[1]], start: +m[2] / 4, len: +m[3] / 4, name: m[4] });
  const day = sanitizeBlocks(out, TYPE_IDS);
  return day && day.length === out.length ? day : null;
}

/** Names are a word or two you gave a block ("Study", "School run"). */
export function cleanName(v) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24) : "";
}

/** False in private modes and locked-down browsers where nothing will persist. */
export function storageWorks() {
  try { localStorage.setItem("dayshaper.probe", "1"); localStorage.removeItem("dayshaper.probe"); return true; } catch { return false; }
}
