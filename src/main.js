/* Dayshaper — wiring. State lives here; everything it draws comes from pure
   modules (engine, sky, context) and two renderers (scene, dial). */

import {
  moveBlock, resizeEnd, resizeStart, shiftAll, placeBlock, removeBlock, findSpot, blockAt,
  cloneBlocks, uid, mod24, wrapDelta, freeHours, SNAP, endOf,
} from "./engine.js";
import { TYPES, typeOf, sampleDay } from "./types.js";
import { skyAt } from "./sky.js";
import { sunForDate, guessLocation } from "./solar.js";
import { describe, readings, shapedSummary, geography, blockName } from "./context.js";
import { matchGeography } from "./geography.js";
import { hourOf, detectHour12, clockParts, fmtTime, fmtNow, fmtRange, fmtDur } from "./time.js";
import { loadBlocks, saveBlocks, loadPrefs, savePrefs, createHistory, encodeDay, decodeDay, storageWorks, cleanName } from "./store.js";
import { moonPhase } from "./moon.js";
import { weatherView, weatherize, fetchWeather, weatherFromParam } from "./weather.js";
import { installSprite, icon } from "./icons.js";
import { mixDeep, lighten, luminance } from "./color.js";
import { createScene } from "./scene.js";
import { createDial, R } from "./dial.js";
import "./install.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const PREVIEW = params.has("preview");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* ---------------- state ---------------- */
const prefs = PREVIEW ? { hour12: null, nowOnTop: false, loc: null, shapedOnce: true } : loadPrefs();
let blocks = PREVIEW ? (decodeDay(params.get("day")) || sampleDay(uid)) : loadBlocks();
const history = createHistory();
let hour12 = prefs.hour12 ?? detectHour12();
let loc = prefs.loc || guessLocation();
let mode = params.get("shape") ? "shape" : "live";
let m = mode === "shape" ? 1 : 0;           // live → shape morph
let rot = 12;                                // dial rotation in hours (12 = noon on top)
let selectedId = null;
let drag = null;                             // the hand on the dial
let stone = null;                            // a stone in the hand
let play = null;                             // {from, t0, dur}
const lifts = new Map();                     // id → {x, v, target}
let orbMix = { amt: 0, type: null };         // how much the orb has become the current block
const leaving = [];                          // blocks being drawn into the orb: {b, t0, fromOp}
let lastFrame = performance.now(), animTime = 0;

const fixedAt = (() => {
  const v = params.get("at");
  const mm = v && /^(\d{1,2}):(\d{2})$/.exec(v);
  return mm ? Math.min(23, +mm[1]) + Math.min(59, +mm[2]) / 60 : null;
})();

/* ---------------- time & sun ---------------- */
/** The wall-clock moment `h` hours after the start of `day` (h may exceed 24). */
function wallClock(day, h) {
  const d = new Date(day);
  d.setDate(d.getDate() + Math.floor(h / 24));
  const hh = ((h % 24) + 24) % 24, secs = Math.round((hh % 1) * 3600);
  d.setHours(Math.floor(hh), Math.floor(secs / 60), secs % 60, 0);
  return d;
}
function clockDate() {
  if (play) return wallClock(play.day, play.from + Math.min(1, (performance.now() - play.t0) / play.dur) * 24);
  if (fixedAt != null) return wallClock(Date.now(), fixedAt);
  return new Date();
}
let sun, sunKey = "";
function refreshSun(date) {
  const key = date.toDateString() + "|" + date.getTimezoneOffset() + "|" + loc.lat + "," + loc.lon;
  if (key === sunKey) return;
  sunKey = key;
  sun = PREVIEW ? { sunrise: 6.1, sunset: 18.35, noon: 12.2, polar: null } : sunForDate(date, loc);
}
refreshSun(clockDate());
if (prefs.nowOnTop) rot = -hourOf(clockDate()); // open already turned; only a toggle animates

/* ---------------- weather (only where you really are) ---------------- */
const WX_KEY = "dayshaper.weather.v1";
const forcedWx = weatherFromParam(params.get("wx"), params.get("temp"));
let wxRaw = forcedWx || (() => {
  if (PREVIEW || !prefs.loc) return null;
  try {
    const c = JSON.parse(localStorage.getItem(WX_KEY) || "null");
    const near = c && Math.abs(c.lat - prefs.loc.lat) < 0.1 && Math.abs(c.lon - prefs.loc.lon) < 0.1;
    return near && Date.now() - c.at < 3 * 3600e3 ? c : null; // older than that, it would be a guess
  } catch { return null; }
})();
let wx = weatherView(wxRaw);
let locating = false, weatherLoading = false, weatherFailed = false;
let weatherRequest = 0;
let geographyData = null;
let geographyLoading = null;
let place = null;
async function refreshWeather(force = false) {
  if (forcedWx || PREVIEW || !prefs.loc) return;
  if (navigator.onLine === false) { request(); return; }
  if (!force && (weatherLoading || (wx && Date.now() - wxRaw.at < 30 * 60e3))) return;
  const id = ++weatherRequest;
  const at = { ...prefs.loc };
  weatherLoading = true;
  weatherFailed = false;
  request();
  try {
    const w = await fetchWeather(at);
    if (id !== weatherRequest) return;
    wxRaw = w; wx = weatherView(w);
    try { localStorage.setItem(WX_KEY, JSON.stringify(w)); } catch { /* full */ }
  } catch { if (id === weatherRequest) weatherFailed = true; }
  finally {
    if (id === weatherRequest) { weatherLoading = false; request(); }
  }
}

function renderWeather() {
  // Conditions stay in the same place in live, shaping, and playback modes.
  let label, glyph = "pin";
  if (wx) { label = `${wx.temp}°C · ${wx.label}`; glyph = wx.icon; }
  else if (locating) label = "Finding you…";
  else if (!prefs.loc) label = "Where are you?";
  else if (weatherLoading) label = "Checking the weather…";
  else if (navigator.onLine === false) label = "Weather offline";
  else label = "Weather unavailable · Retry";
  const button = $("weatherBtn");
  const busy = locating || weatherLoading;
  button.setAttribute("aria-busy", String(busy));
  button.title = !prefs.loc ? "Share your location for the weather and the local sun"
    : wx && (weatherFailed || navigator.onLine === false) ? "Last known weather · tap to retry"
    : "Update your location and weather";
  const node = $("weatherIcon");
  if (node.dataset.icon !== glyph) { node.innerHTML = icon(glyph); node.dataset.icon = glyph; }
  setText($("weatherText"), label);
}

async function refreshGeography() {
  if (PREVIEW || !prefs.loc) return;
  try {
    if (!geographyData) {
      geographyLoading ||= (async () => {
        // The map is precached with the installed shell. No coordinates enter
        // this request. Concurrent location updates share this one load.
        const url = new URL("data/geography.json", location.href).href;
        let response;
        try { response = await fetch(url); } catch { /* offline cache below */ }
        if (!response?.ok && "caches" in window) response = await caches.match(url);
        return response?.ok ? response.json() : null;
      })().finally(() => { geographyLoading = null; });
      geographyData = await geographyLoading;
      if (!geographyData) return;
    }
    place = matchGeography(geographyData, prefs.loc);
    if (menu.open) syncMenu();
  } catch { /* first visit without a cached map: coordinates still work */ }
}

/* ---------------- DOM ---------------- */
installSprite();
const scene = createScene($("scene"));
const dial = createDial($("dial"));
const titleEl = $("title"), subEl = $("subtitle"), dialEl = $("dial");

$("menuBtn").innerHTML = icon("more");
$("doneBtn").innerHTML = icon("check") + "<span>Done</span>";
$("shapeBtn").innerHTML = icon("up") + "<span>Shape your day</span>";
$("stopPlay").innerHTML = icon("pause");
$("nowTopBtn").innerHTML = icon("top");
document.querySelectorAll("[data-i]").forEach((n) => { n.innerHTML = icon(n.dataset.i); });
if (!prefs.shapedOnce) $("shapeBtn").classList.add("invite");

const tray = $("tray");
for (const [i, ty] of TYPES.entries()) {
  const b = document.createElement("button");
  b.style.setProperty("--i", i);
  b.type = "button";
  b.className = "stone";
  b.dataset.type = ty.id;
  b.style.setProperty("--c0", ty.c0);
  b.style.setProperty("--c1", ty.c1);
  b.setAttribute("aria-label", `Add ${ty.name}`);
  b.innerHTML = `<span class="ball">${icon(ty.icon)}</span><span class="nm">${ty.name}</span>`;
  tray.appendChild(b);
}

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const announce = (msg) => { const a = $("announce"); a.textContent = ""; requestAnimationFrame(() => { a.textContent = msg; }); };
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** How a block is spoken of in toasts: its own name, or its clay's in lower case. */
const said = (b) => b.name || typeOf(b.type).name.toLowerCase();

/* Haptics. Android vibrates; iOS Safari has no vibrate, but toggling a native
   switch gives the system tick (iOS 18+). Only on touch screens, only in a gesture. */
const coarse = matchMedia("(pointer: coarse)");
const switchTick = (() => {
  if (typeof navigator.vibrate === "function") return null;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;left:-99px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox"; input.setAttribute("switch", ""); input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
})();
const haptic = (p = 8) => {
  try {
    if (!switchTick) { navigator.vibrate(p); return; }
    if (!coarse.matches) return;
    const had = document.activeElement;
    switchTick.click();
    if (had && document.activeElement !== had) had.focus?.({ preventScroll: true });
  } catch { /* not allowed */ }
};

/* ---------------- persistence + history ---------------- */
function persist() { if (!PREVIEW) saveBlocks(blocks); }
function persistPrefs() { if (!PREVIEW) savePrefs({ ...prefs, hour12: prefs.hour12 }); }

let coalesce = null; // {key, until}
function commit(next, label, { coalesceKey = null, quiet = false } = {}) {
  const same = coalesceKey && coalesce && coalesce.key === coalesceKey && performance.now() < coalesce.until;
  if (!same) history.push(blocks, label);
  coalesce = coalesceKey ? { key: coalesceKey, until: performance.now() + 1500 } : null;
  blocks = next;
  if (selectedId && !blocks.some((b) => b.id === selectedId)) selectedId = null;
  persist();
  if (!quiet) toast(label, true);
  if (mode === "shape") setHint();
  request();
}
function undo() {
  const prev = history.pop();
  if (!prev) { toast("Nothing to undo", false); return; }
  blocks = prev.blocks;
  coalesce = null;
  if (selectedId && !blocks.some((b) => b.id === selectedId)) selectedId = null;
  persist();
  toast("Undone · " + prev.label.charAt(0).toLowerCase() + prev.label.slice(1), history.size > 0);
  announce("Undone: " + prev.label);
  for (const b of blocks) kick(b.id, 2);
  if (mode === "shape") setHint();
  request();
}

let toastTimer = 0;
function toast(text, withUndo) {
  const t = $("toast");
  setText($("toastText"), text);
  $("toastUndo").hidden = !withUndo;
  t.classList.remove("off");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("off"), withUndo ? 5200 : 2400);
}
$("toastUndo").addEventListener("click", undo);

/* ---------------- springs ---------------- */
const spring = (id) => { let s = lifts.get(id); if (!s) { s = { x: 0, v: 0, target: 0 }; lifts.set(id, s); } return s; };
const lift = (id, target) => { spring(id).target = target; request(); };
const kick = (id, v) => { spring(id).v += v; request(); };
function stepSprings(dt) {
  let busy = false;
  const out = new Map();
  for (const [id, s] of lifts) {
    const k = 170, c = 15;
    s.v += (-k * (s.x - s.target) - c * s.v) * dt;
    s.x += s.v * dt;
    if (Math.abs(s.v) < 0.002 && Math.abs(s.x - s.target) < 0.002) { s.x = s.target; s.v = 0; } else busy = true;
    if (!blocks.some((b) => b.id === id) && !(drag && drag.result?.some((b) => b.id === id)) && !stone) { lifts.delete(id); continue; }
    out.set(id, Math.max(-0.4, s.x));
  }
  return { busy, values: out };
}

/* ---------------- frame loop ---------------- */
let raf = 0;
function request() { if (!raf) raf = requestAnimationFrame(frame); }

function frame(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  animTime += dt;
  let busy = false;

  const target = mode === "shape" ? 1 : 0;
  if (m !== target) {
    const step = reduceMotion.matches ? 1 : dt / 0.46;
    m = target > m ? Math.min(target, m + step) : Math.max(target, m - step);
    busy = true;
  }
  const date = clockDate();
  const t = hourOf(date);
  refreshSun(date);

  const rotGoal = prefs.nowOnTop ? -t : 12; // now on top, or noon on top
  const dr = wrapDelta(rotGoal - rot);
  if (Math.abs(dr) > 0.001) { rot += reduceMotion.matches || play ? dr : dr * Math.min(1, dt * 7); busy = busy || Math.abs(dr) > 0.01; }
  else rot = rotGoal;

  const springs = stepSprings(dt);
  busy = busy || springs.busy || !!drag || !!stone;

  if (play) {
    busy = true;
    if (performance.now() - play.t0 >= play.dur) stopPlay();
  }

  for (let i = leaving.length - 1; i >= 0; i--) if (animTime - leaving[i].t0 > 0.45) leaving.splice(i, 1);
  if (draw(date, t, springs.values) || leaving.length) busy = true;

  clearTimeout(breathTimer);
  if (busy) request();
  else if (breathing()) breathTimer = setTimeout(breathe, 66);
}
/* Idle life: while you are inside a block the orb is clay, and clay breathes.
   Only the orb is redrawn (~15 fps); the minute tick redraws everything else. */
let breathTimer = 0;
const breathing = () => !reduceMotion.matches && document.visibilityState === "visible" && mode === "live" && !play && orbMix.amt > 0.01;
function breathe() {
  if (raf || !breathing()) return;
  const now = performance.now();
  animTime += Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  dial.breathe(animTime);
  breathTimer = setTimeout(breathe, 66);
}

/* ---------------- drawing ---------------- */
let lastWords = "", swapTimer = 0;
function draw(date, t, liftValues) {
  renderWeather();
  const sky = weatherize(skyAt(t, sun), wx);
  scene.paint(sky, t, sun, { moon: moonPhase(date), wx, south: loc.lat < 0 });
  const view = drag?.result || stone?.result || blocks;
  const ctx = describe({ t, date, blocks: view, sun, hour12, wx });

  // header words
  let title, sub;
  if (play) { title = ctx.title; sub = ctx.subtitle; }
  else if (mode === "shape") { title = "Shape your day"; sub = shapedSummary(view); }
  else { title = ctx.title; sub = ctx.subtitle; }
  const words = title + "|" + sub;
  if (words !== lastWords) {
    const first = !lastWords;
    lastWords = words;
    clearTimeout(swapTimer);
    if (first || drag || stone || mode === "shape") { $("dialWrap").classList.remove("swap"); setText(titleEl, title); setText(subEl, sub); }
    else {
      $("dialWrap").classList.add("swap");
      swapTimer = setTimeout(() => { setText(titleEl, title); setText(subEl, sub); $("dialWrap").classList.remove("swap"); }, 180);
    }
  }

  // readings (live) and status
  if (m < 1) renderReadings(t, view, ctx);
  const st = $("status");
  const sleeping = ctx.sleeping && mode === "live" && !play;
  st.hidden = !sleeping;
  if (sleeping) { const html = icon("bed") + "<span>Sleep mode on</span>"; if (st.dataset.v !== "sleep") { st.innerHTML = html; st.dataset.v = "sleep"; } }

  // the orb becomes the block you are in (life only)
  const want = mode === "live" && ctx.current ? ctx.current.block.type : null;
  if (want) orbMix.type = want;
  const goal = want ? 1 : 0;
  orbMix.amt += (goal - orbMix.amt) * (reduceMotion.matches ? 1 : 0.06);
  if (Math.abs(goal - orbMix.amt) > 0.002) request(); else orbMix.amt = goal;

  const orb = orbView(t, sky, ctx, view);
  if (play) setText($("playTime"), fmtNow(t, hour12) + " · " + ctx.title);

  const carried = drag?.carry && drag.result?.some((b) => b.id === drag.id);
  const busy = dial.render({
    t, rot, m, sky, sun, hour12,
    blocks: view,
    origin: drag?.origin || stone?.origin || null,
    activeId: drag?.moved && !drag.carry ? drag.id : null,
    activeEdge: drag?.moved ? drag.edge : null,
    selectedId: mode === "shape" ? selectedId : null,
    previewId: stone?.result ? stone.id : carried ? drag.id : null,
    leaving: leaving.map((x) => ({ b: { ...x.b, fromOp: x.fromOp }, u: (animTime - x.t0) / 0.42 })),
    armDelete: !!drag?.armDelete,
    lifts: liftValues,
    orb,
    time: animTime,
    reduced: reduceMotion.matches,
    interactive: mode === "shape",
    labelFor: (b) => `${blockName(b)}, ${fmtRange(b.start, b.start + b.len, hour12)}, ${fmtDur(b.len)}`,
  });
  const role = mode === "shape" ? "group" : "img";
  const solarSummary = sun.polar ? (sun.polar === "day" ? "Midnight sun." : "Polar night.")
    : `Sunrise ${fmtTime(sun.sunrise, hour12)}. Sunset ${fmtTime(sun.sunset, hour12)}.`;
  const label = (mode === "shape" ? "Your day. Tab to a block, then use the arrow keys to move it." : daySentence(view, t)) + " " + solarSummary;
  if (dialEl.getAttribute("role") !== role) dialEl.setAttribute("role", role);
  if (dialEl.getAttribute("aria-label") !== label) dialEl.setAttribute("aria-label", label);
  return busy;
}

const TYPE_ORB = Object.fromEntries(TYPES.map((ty) => [ty.id, {
  hi: ty.orb.hi, mid: ty.orb.mid, lo: ty.orb.lo, ink: ty.orb.ink,
  rim: lighten(ty.orb.hi, 0.5), rimA: 0.4, glow: ty.orb.mid, glowA: 0.3,
}]));
const DANGER_ORB = { hi: "#f7c4b8", mid: "#e5846f", lo: "#c4604e", ink: "#ffffff", rim: "#ffe2da", rimA: 0.5, glow: "#e5846f", glowA: 0.4 };

function orbView(t, sky, ctx, view) {
  let material = sky.orb;
  if (orbMix.type && orbMix.amt > 0.001) {
    material = mixDeep(sky.orb, TYPE_ORB[orbMix.type], orbMix.amt);
    material.ink = orbMix.amt > 0.5 ? TYPE_ORB[orbMix.type].ink : sky.orb.ink;
  }
  const clk = clockParts(t, hour12, true, true);
  const base = { material, blob: orbMix.amt, satellites: 1 - orbMix.amt * 0.6, ink: material.ink, tone: "normal" };
  if (mode === "live" || m < 0.5) {
    return { ...base, label: "", big: clk.h + ":" + clk.m, suffix: clk.suffix, small: play ? "" : ctx.caption };
  }
  const readout = shapeReadout(t, view);
  if (readout.tone === "danger") { base.material = DANGER_ORB; base.ink = DANGER_ORB.ink; }
  else if (readout.type) {
    base.material = mixDeep(sky.orb, TYPE_ORB[readout.type], 0.55);
    base.ink = base.material.ink = contrastInk(base.material);
  }
  return { ...base, ...readout, blob: 0 };
}
/* light orb → deep ink, deep orb → pale ink (whichever clears the orb better) */
const contrastInk = (mat) => (luminance(mat.mid) > 0.3 ? "#34466b" : "#f6f7fc");

function shapeReadout(t, view) {
  const at = (h) => { const p = clockParts(h, hour12); return { big: p.h + ":" + p.m, suffix: p.suffix }; };
  if (drag?.moved && drag.kind === "spin") {
    const d = Math.round(wrapDelta(drag.cursor - drag.cursor0) / SNAP) * SNAP;
    return { label: "WHOLE DAY", big: (d > 0 ? "+" : d < 0 ? "−" : "") + fmtDur(Math.abs(d)), suffix: "", small: "turning together" };
  }
  if (drag?.moved && drag.armDelete) {
    const b = drag.snapshot.find((x) => x.id === drag.id);
    return { label: "", big: "Remove", suffix: "", small: "Let " + said(b) + " go", tone: "danger" };
  }
  if (drag?.carry && !drag.result?.some((x) => x.id === drag.id)) {
    const b = drag.snapshot.find((x) => x.id === drag.id);
    return { label: blockName(b).toUpperCase().slice(0, 14), big: fmtDur(b.len), suffix: "", small: "carry it anywhere", type: b.type };
  }
  const focusId = (drag?.moved && drag.id) || (stone?.result && stone.id) || selectedId;
  const b = focusId && view.find((x) => x.id === focusId);
  if (b) {
    const full = blockName(b).toUpperCase(), label = full.length > 14 ? full.slice(0, 13).trimEnd() + "…" : full;
    if (stone?.result) return { type: b.type, label, ...at(b.start), small: fmtDur(b.len) + " · let go to place" };
    if (drag?.moved && drag.kind === "move") return { type: b.type, label, ...at(b.start), small: drag.carry ? "let go to place" : "until " + fmtTime(endOf(b), hour12) };
    return { type: b.type, label, big: fmtDur(b.len), suffix: "", small: fmtRange(b.start, b.start + b.len, hour12) };
  }
  const clk = clockParts(t, hour12, true, true);
  return { label: "", big: clk.h + ":" + clk.m, suffix: clk.suffix, small: fmtDur(freeHours(view)) + " free", inlineSuffix: true };
}

let lastReadings = "";
function renderReadings(t, view, ctx) {
  const list = readings({ t, blocks: view, sun, hour12, next: ctx.next });
  const key = JSON.stringify(list);
  if (key === lastReadings) return;
  lastReadings = key;
  // updated in place, so only a value that changed settles in, not the whole row
  const ul = $("readings");
  while (ul.children.length < list.length) { const li = document.createElement("li"); li.style.setProperty("--i", ul.children.length); ul.appendChild(li); }
  while (ul.children.length > list.length) ul.lastChild.remove();
  list.forEach((r, i) => {
    const li = ul.children[i];
    const html = `${icon(r.icon)}<span class="l">${esc(r.label)}</span><span class="v">${esc(r.value)}</span>`;
    if (li.dataset.h === html) return;
    const had = !!li.dataset.h;
    li.innerHTML = html; li.dataset.h = html;
    if (had && !reduceMotion.matches) { li.classList.remove("fresh"); void li.offsetWidth; li.classList.add("fresh"); }
  });
}

function daySentence(view, t) {
  if (!view.length) return "Your day is empty. Now " + fmtNow(t, hour12) + ".";
  const parts = view.map((b) => `${blockName(b)} ${fmtRange(b.start, b.start + b.len, hour12)}`);
  return "Your day: " + parts.join("; ") + ". Now " + fmtNow(t, hour12) + ".";
}

/* ---------------- modes ---------------- */
function setPanels() {
  const show = (id, on) => { const n = $(id); n.classList.toggle("off", !on); n.inert = !on; };
  show("livePanel", mode === "live" && !play);
  show("shapePanel", mode === "shape" && !play);
  show("playPanel", !!play);
  $("menuBtn").hidden = mode === "shape";
  $("doneBtn").hidden = mode !== "shape";
}
function enterShape() {
  if (mode === "shape" || play) return;
  mode = "shape";
  hintIndex = prefs.shapedOnce ? hintIndex + 1 : 0;
  if (!prefs.shapedOnce) { prefs.shapedOnce = true; persistPrefs(); $("shapeBtn").classList.remove("invite"); }
  const fromPanel = $("livePanel").contains(document.activeElement);
  setPanels();
  setHint();
  if (fromPanel) $("doneBtn").focus({ preventScroll: true }); // the button that was focused just went inert
  announce("Shaping your day. Tap a stone to add it, or use the arrow keys on a block.");
  haptic(6);
  request();
}
function exitShape() {
  if (mode === "live") return;
  haptic(5);
  const hadFocus = [$("doneBtn"), dialEl, $("shapePanel")].some((n) => n.contains(document.activeElement));
  mode = "live";
  selectedId = null;
  setPanels();
  if (hadFocus) $("shapeBtn").focus({ preventScroll: true });
  request();
}
$("shapeBtn").addEventListener("click", enterShape);
$("doneBtn").addEventListener("click", exitShape);

/* One quiet hint at a time; each visit to shaping teaches the next gesture. */
const HINTS = [
  "Tap a stone to add it · or drag it onto the ring",
  "Drag a block into the orb to let it go",
  "Pull a block off the ring to carry it anywhere",
  "Turn the orb to shift the whole day",
  "Pull a block's end to stretch it",
  "Tap outside the ring when you're done",
];
let hintIndex = 0;
function setHint(text) {
  const chosen = mode === "shape" && selectedId && blocks.some((b) => b.id === selectedId);
  setText($("trayHint"), text || (!blocks.length ? "Your day is open. Tap a stone to begin."
    : chosen ? "Tap the orb to name it · pull it off the ring to carry it" : HINTS[hintIndex % HINTS.length]));
}

/* ---------------- the hand on the dial ---------------- */
const MOVE_SLOP = 6;

dialEl.addEventListener("pointerdown", (e) => {
  if (e.button > 0 || drag || stone || play) return;
  const p = dial.locate(e.clientX, e.clientY);
  if (mode === "live") {
    drag = { kind: "tap", x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
    try { dialEl.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    return;
  }
  const g = dial.geometry(1);
  let d = null;
  if (p.r < g.orbR) {
    d = { kind: "spin" };
  } else if (p.r > g.r0 - 18 && p.r < g.r1 + 24) {
    const i = blockAt(blocks, p.hour);
    if (i < 0) { selectedId = null; setHint(); request(); return; }
    const b = blocks[i];
    const pxPerHour = (Math.PI * 2 * R) / 24;
    const dS = Math.abs(wrapDelta(p.hour - b.start)) * pxPerHour;
    const dE = Math.abs(wrapDelta(p.hour - (b.start + b.len))) * pxPerHour;
    const grab = Math.min(18, b.len * pxPerHour * 0.28);
    const edge = dS < grab && dS <= dE ? "start" : dE < grab ? "end" : null;
    d = { kind: edge ? "resize" : "move", edge, id: b.id };
  } else {
    // beyond the ring: a tap here means "done"
    drag = { kind: "outside", x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
    try { dialEl.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    return;
  }
  e.preventDefault();
  try { dialEl.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  drag = {
    ...d, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
    snapshot: cloneBlocks(blocks), origin: new Map(blocks.map((b) => [b.id, b.start])),
    cursor0: p.hour, cursor: p.hour, last: p.hour, result: null, sig: "", armDelete: false,
  };
});

dialEl.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId || drag.kind === "tap" || drag.kind === "outside") return;
  const p = dial.locate(e.clientX, e.clientY);
  drag.cursor += wrapDelta(p.hour - drag.last);
  drag.last = p.hour;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < MOVE_SLOP) return;
    drag.moved = true;
    if (drag.id) { selectedId = drag.id; lift(drag.id, 1); }
    haptic(8);
    setHint(drag.kind === "spin" ? "Turning the whole day" : drag.kind === "move" ? "Drag into the orb to remove it" : "Stretch or shrink it along the ring");
  }
  const delta = drag.cursor - drag.cursor0;
  const snap = drag.snapshot, b = snap.find((x) => x.id === drag.id);
  let next;
  if (drag.kind === "spin") next = shiftAll(snap, delta);
  else if (drag.kind === "move") {
    const g1 = dial.geometry(1);
    if (!drag.carry && p.r > g1.r1 + 44) startCarry(b);
    if (drag.carry) {
      // off the ring, the block is a stone again: drop it anywhere, even past its neighbours
      moveGhost(e.clientX, e.clientY);
      const without = removeBlock(snap, drag.id);
      drag.armDelete = p.r < g1.orbR * 0.92;
      const over = !drag.armDelete && p.r < g1.r1 + 40;
      ghost.classList.toggle("over", over);
      next = over ? placeBlock(without, b, p.hour) || without : without;
    } else {
      drag.armDelete = p.r < g1.orbR * 0.92;
      next = drag.armDelete ? snap : moveBlock(snap, drag.id, b.start + delta);
    }
  } else if (drag.edge === "end") next = resizeEnd(snap, drag.id, b.start + b.len + delta);
  else next = resizeStart(snap, drag.id, b.start + delta);
  const sig = next.map((x) => x.id + x.start + ":" + x.len).join() + drag.armDelete;
  if (sig !== drag.sig) {
    if (drag.sig) haptic(drag.armDelete ? [10, 30, 10] : 3);
    drag.sig = sig;
    drag.result = next;
    for (const x of next) {
      if (x.id === drag.id) continue;
      const moved = Math.abs(wrapDelta(x.start - drag.origin.get(x.id))) > 0.01;
      lift(x.id, moved ? 0.45 : 0);
    }
  }
  request();
});

function startCarry(b) {
  drag.carry = true;
  const ty = typeOf(b.type);
  ghost.style.setProperty("--c0", ty.c0); ghost.style.setProperty("--c1", ty.c1);
  ghost.innerHTML = icon(ty.icon) + (b.name ? `<span class="gname"></span>` : "");
  if (b.name) ghost.querySelector(".gname").textContent = b.name;
  ghost.classList.add("on", "carry");
  lift(b.id, 0.8);
  haptic(12);
  setHint("Drop it anywhere on the ring · outside puts it back");
}
function moveGhost(x, y) { ghost.style.left = x + "px"; ghost.style.top = y + "px"; }
const dropGhost = () => ghost.classList.remove("on", "over", "carry");

function endDrag(e, cancelled) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;
  for (const [, s] of lifts) s.target = 0;
  if (d.kind === "tap" || d.kind === "outside") {
    if (!cancelled && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 12) (d.kind === "tap" ? enterShape : exitShape)();
    return;
  }
  if (d.carry) dropGhost();
  if (!d.moved) {
    if (cancelled) { setHint(); request(); return; }
    // a tap: select (or let go of) a block; a tap on the orb names the chosen one
    if (d.id) { selectedId = selectedId === d.id ? null : d.id; kick(d.id, 3); haptic(5); announceBlock(d.id); }
    else if (d.kind === "spin") { if (selectedId) openName(selectedId); else exitShape(); }
    else selectedId = null;
    setHint();
    request();
    return;
  }
  setHint();
  if (cancelled) { request(); return; }
  const b = d.snapshot.find((x) => x.id === d.id);
  if (d.kind === "move" && d.armDelete) {
    commit(removeBlock(blocks, d.id), "Removed " + said(b));
    letGoOf(b, 0.35);
    selectedId = null;
    setHint();
    haptic([12, 30, 12]);
    announce(blockName(b) + " removed.");
    return;
  }
  if (d.carry && !d.result?.some((x) => x.id === d.id)) { haptic(4); request(); return; } // put back
  if (!d.result || d.result.every((x) => { const o = d.snapshot.find((y) => y.id === x.id); return o && o.start === x.start && o.len === x.len; })) { request(); return; }
  const label = d.kind === "spin" ? "Turned the day" : (d.carry ? "Carried " : d.kind === "move" ? "Moved " : "Resized ") + said(b);
  commit(d.result, label);
  if (d.carry) haptic(10);
  if (d.id) { kick(d.id, d.carry ? 5 : -4); announceBlock(d.id); }
}
/** Draw a removed block into the orb. */
function letGoOf(b, fromOp) {
  if (!reduceMotion.matches) { leaving.push({ b: { ...b }, t0: animTime, fromOp }); request(); }
}
dialEl.addEventListener("pointerup", (e) => endDrag(e, false));
dialEl.addEventListener("pointercancel", (e) => endDrag(e, true));
dialEl.addEventListener("lostpointercapture", (e) => { if (drag && drag.pointerId === e.pointerId) endDrag(e, drag.kind === "tap"); });

function announceBlock(id) {
  const b = blocks.find((x) => x.id === id);
  if (b) announce(`${blockName(b)}, ${fmtRange(b.start, b.start + b.len, hour12)}, ${fmtDur(b.len)}.`);
}

/* ---------------- stones ---------------- */
const ghost = $("ghost");
tray.addEventListener("pointerdown", (e) => {
  const node = e.target.closest(".stone");
  if (!node || e.button > 0 || drag || stone || play) return;
  e.preventDefault();
  try { node.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  const ty = typeOf(node.dataset.type);
  stone = { type: ty.id, id: uid(), node, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, result: null, origin: null };
  node.classList.add("lifting");
});
tray.addEventListener("pointermove", (e) => {
  if (!stone || e.pointerId !== stone.pointerId) return;
  if (!stone.moved) {
    if (Math.hypot(e.clientX - stone.x0, e.clientY - stone.y0) < 8) return;
    stone.moved = true;
    const ty = typeOf(stone.type);
    ghost.style.setProperty("--c0", ty.c0); ghost.style.setProperty("--c1", ty.c1);
    ghost.innerHTML = icon(ty.icon);
    ghost.classList.add("on");
    haptic(6);
  }
  ghost.style.left = e.clientX + "px";
  ghost.style.top = e.clientY + "px";
  const p = dial.locate(e.clientX, e.clientY);
  const g = dial.geometry(1);
  const over = p.r > g.orbR * 0.9 && p.r < g.r1 + 46;
  ghost.classList.toggle("over", over);
  if (over) {
    const ty = typeOf(stone.type);
    const res = placeBlock(blocks, { id: stone.id, type: ty.id, len: ty.len }, p.hour);
    if (res) {
      const sig = res.map((x) => x.id + x.start + ":" + x.len).join();
      if (sig !== stone.sig) { if (stone.sig) haptic(3); stone.sig = sig; }
      stone.result = res;
      stone.origin = new Map(blocks.map((b) => [b.id, b.start]));
      for (const x of res) if (x.id !== stone.id) lift(x.id, Math.abs(wrapDelta(x.start - stone.origin.get(x.id))) > 0.01 ? 0.45 : 0);
      lift(stone.id, 0.8);
      setHint();
    } else { stone.result = null; setHint("The day is full — let something go first"); }
  } else { stone.result = null; stone.origin = null; for (const [, s] of lifts) s.target = 0; setHint(); }
  request();
});
function endStone(e, cancelled) {
  if (!stone || e.pointerId !== stone.pointerId) return;
  const s = stone;
  stone = null;
  s.node.classList.remove("lifting");
  ghost.classList.remove("on", "over");
  for (const [, sp] of lifts) sp.target = 0;
  if (cancelled || !s.moved) { request(); return; } // a plain tap arrives as a click
  suppressClick = performance.now() + 500;
  if (s.result) {
    commit(s.result, "Added " + typeOf(s.type).name.toLowerCase());
    selectedId = s.id;
    setHint();
    kick(s.id, 5);
    haptic(10);
    announceBlock(s.id);
  }
  setHint();
  request();
}
tray.addEventListener("pointerup", (e) => endStone(e, false));
tray.addEventListener("pointercancel", (e) => endStone(e, true));
tray.addEventListener("lostpointercapture", (e) => endStone(e, false));
let suppressClick = 0;
tray.addEventListener("click", (e) => {
  const node = e.target.closest(".stone");
  if (!node || performance.now() < suppressClick || play) return;
  quickAdd(node.dataset.type);
});

function quickAdd(type) {
  const ty = typeOf(type);
  const spot = findSpot(blocks, ty.len, hourOf(clockDate()));
  if (!spot) { toast("The day is full — let something go first", false); haptic([12, 30, 12]); return; }
  const id = uid();
  const res = placeBlock(blocks, { id, type, len: spot.len }, spot.start);
  if (!res) return;
  commit(res, "Added " + ty.name.toLowerCase());
  selectedId = id;
  kick(id, 5);
  haptic(10);
  announceBlock(id);
  setHint();
  const node = tray.querySelector(`[data-type="${type}"]`);
  if (node) { node.classList.remove("pop"); void node.offsetWidth; node.classList.add("pop"); }
}

/* ---------------- keyboard ---------------- */
dial.onBlockFocus((id) => { if (mode === "shape" && selectedId !== id) { selectedId = id; request(); } });
dial.onBlockKey((e, id) => {
  if (mode !== "shape") return;
  const b = blocks.find((x) => x.id === id);
  if (!b) return;
  const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
  const name = said(b);
  if (dir) {
    e.preventDefault();
    let next, label;
    if (e.shiftKey) { next = resizeEnd(blocks, id, b.start + b.len + dir * SNAP); label = "Resized " + name; }
    else if (e.altKey) { next = resizeStart(blocks, id, b.start + dir * SNAP); label = "Resized " + name; }
    else { next = moveBlock(blocks, id, b.start + dir * SNAP); label = "Moved " + name; }
    commit(next, label, { coalesceKey: label + id, quiet: true });
    selectedId = id;
    announceBlock(id);
    requestAnimationFrame(() => dial.focusBlock(id));
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    const i = blocks.findIndex((x) => x.id === id);
    commit(removeBlock(blocks, id), "Removed " + name);
    letGoOf(b, 1);
    announce(blockName(b) + " removed.");
    const next = blocks.length ? blocks[i % blocks.length] : null;
    requestAnimationFrame(() => { if (next) { selectedId = next.id; dial.focusBlock(next.id); } else tray.querySelector(".stone").focus(); request(); });
  } else if (e.key === "Enter" || e.key === "F2") {
    e.preventDefault();
    openName(id);
  } else if (e.key === " ") {
    e.preventDefault();
    announceBlock(id);
  }
});
function letGo() {
  if (drag && drag.kind !== "tap") { const id = drag.pointerId; if (drag.carry) dropGhost(); drag = null; try { dialEl.releasePointerCapture(id); } catch { /* gone */ } }
  if (stone) {
    const s = stone; stone = null;
    suppressClick = performance.now() + 1500; // releasing over the same stone must not add it after all
    s.node.classList.remove("lifting");
    ghost.classList.remove("on", "over");
    try { s.node.releasePointerCapture(s.pointerId); } catch { /* gone */ }
  }
  for (const [, sp] of lifts) sp.target = 0;
  setHint();
  request();
}
const handBusy = () => (drag && drag.kind !== "tap" && drag.kind !== "outside") || stone;
addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); if (!handBusy()) undo(); return; }
  if (e.key === "Escape" && !$("menu").open && !$("nameDlg").open) {
    if (handBusy()) letGo();
    else if (play) stopPlay();
    else if (selectedId && mode === "shape") { selectedId = null; setHint(); request(); }
    else if (mode === "shape") exitShape();
  }
});

/* ---------------- play the day ---------------- */
function startPlay() {
  exitShape();
  play = { from: hourOf(clockDate()), day: clockDate().getTime(), t0: performance.now(), dur: reduceMotion.matches ? 12000 : 24000 };
  document.documentElement.classList.add("playing");
  setPanels();
  $("stopPlay").focus({ preventScroll: true });
  request();
}
function stopPlay() {
  if (!play) return;
  play = null;
  document.documentElement.classList.remove("playing");
  setPanels();
  $("shapeBtn").focus({ preventScroll: true });
  request();
}
$("stopPlay").addEventListener("click", stopPlay);

/* ---------------- now on top ---------------- */
const nowTopBtn = $("nowTopBtn");
function syncNowTop() {
  nowTopBtn.setAttribute("aria-pressed", String(prefs.nowOnTop));
  nowTopBtn.title = prefs.nowOnTop ? "Now is on top · tap for noon on top" : "Turn the dial so now is on top";
}
nowTopBtn.addEventListener("click", () => {
  prefs.nowOnTop = !prefs.nowOnTop;
  persistPrefs();
  syncNowTop();
  haptic(8);
  toast(prefs.nowOnTop ? "Now on top" : "Noon on top", false);
  request();
});
syncNowTop();

/* ---------------- names ---------------- */
const nameDlg = $("nameDlg"), nameInput = $("nameInput");
const IDEAS = {
  sleep: ["Nap", "Sleep in", "Siesta"],
  work: ["Study", "Deep work", "Meetings", "Writing", "Emails"],
  eat: ["Breakfast", "Lunch", "Dinner", "Coffee"],
  move: ["Walk", "Run", "Gym", "Yoga", "Commute"],
  rest: ["Read", "Family", "Friends", "Music", "Nothing"],
};
let naming = null;
function openName(id) {
  const b = blocks.find((x) => x.id === id);
  if (!b || nameDlg.open) return;
  naming = { id, focusBack: dialEl.contains(document.activeElement) };
  const ty = typeOf(b.type);
  setText($("nameSub"), ty.name + " clay · " + fmtRange(b.start, b.start + b.len, hour12));
  nameInput.value = b.name || "";
  nameInput.placeholder = ty.name;
  $("nameIdeas").innerHTML = IDEAS[ty.id].map((n) => `<button type="button">${esc(n)}</button>`).join("");
  $("nameClear").hidden = !b.name;
  nameDlg.returnValue = "";
  nameDlg.showModal();
  haptic(6);
  setTimeout(() => nameInput.focus(), 80);
}
function applyName(value) {
  const id = naming?.id, b = blocks.find((x) => x.id === id);
  if (!b) return;
  const name = cleanName(value);
  if ((b.name || "") === name) return;
  const next = blocks.map((x) => { if (x.id !== id) return x; const y = { ...x }; if (name) y.name = name; else delete y.name; return y; });
  commit(next, name ? `Named it “${name}”` : "Gave back the clay's name");
  kick(id, 4);
  announceBlock(id);
}
$("nameIdeas").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  nameInput.value = btn.textContent;
  nameDlg.close("save");
});
$("nameClear").addEventListener("click", () => { nameInput.value = ""; nameDlg.close("save"); });
nameDlg.addEventListener("click", (e) => { if (e.target === nameDlg) nameDlg.close(""); });
nameDlg.addEventListener("close", () => {
  if (nameDlg.returnValue === "save") applyName(nameInput.value);
  const back = naming;
  naming = null;
  if (back?.focusBack) requestAnimationFrame(() => dial.focusBlock(back.id));
  setHint();
});

/* a tap on the open sky around the dial finishes shaping */
$("app").addEventListener("click", (e) => {
  if (mode !== "shape" || play || e.target.closest("button, a, input, #dial, #tray, #toast, .stone")) return;
  exitShape();
});

/* ---------------- menu ---------------- */
const menu = $("menu");
function syncMenu() {
  menu.querySelector('[data-act="hour12"]').setAttribute("aria-checked", String(!hour12));
  const geo = geography(loc, wxRaw && prefs.loc ? wxRaw.elevation ?? null : null, place);
  setText($("whereLine"), prefs.loc ? geo.line : "Where you are");
  setText($("locNote"), prefs.loc ? geo.detail : "Guessed from your time zone · tap for the true sun and the weather");
  setText($("menuSub"), shapedSummary(blocks) + " · sunrise " + fmtTime(sun.sunrise, hour12) + ", sunset " + fmtTime(sun.sunset, hour12));
}
$("menuBtn").addEventListener("click", () => { syncMenu(); menu.showModal(); });
$("weatherBtn").addEventListener("click", () => {
  if (locating || weatherLoading) return;
  // Retry failed weather at the saved location; offline GPS can still update the sun.
  if (navigator.onLine !== false && prefs.loc && (!wx || weatherFailed)) refreshWeather(true);
  else locate(true);
});
menu.addEventListener("click", (e) => {
  if (e.target === menu) { menu.close(); return; } // tap on the backdrop
  const item = e.target.closest("[data-act]");
  if (!item) return;
  const act = item.dataset.act;
  if (act === "hour12") { hour12 = !hour12; prefs.hour12 = hour12; persistPrefs(); syncMenu(); lastReadings = ""; request(); }
  else if (act === "locate") locate(true);
  else if (act === "play") { menu.close(); startPlay(); }
  else if (act === "share") share();
  else if (act === "sample") { menu.close(); commit(sampleDay(uid), "Sample day"); }
  else if (act === "clear") { menu.close(); if (blocks.length) commit([], "Cleared the day"); }
});

function locate(ask) {
  if (locating) return;
  if (!navigator.geolocation) { if (ask) toast("Location isn't available here", false); return; }
  locating = true;
  request();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating = false;
      loc = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) };
      if (!forcedWx && (!prefs.loc || Math.abs(loc.lat - prefs.loc.lat) >= 0.1 || Math.abs(loc.lon - prefs.loc.lon) >= 0.1)) {
        // A response for the previous location must never repaint the new one.
        weatherRequest++; weatherLoading = false; wxRaw = null; wx = null;
        try { localStorage.removeItem(WX_KEY); } catch { /* blocked */ }
      }
      prefs.loc = loc; persistPrefs();
      place = geographyData ? matchGeography(geographyData, loc) : null;
      sunKey = ""; refreshSun(clockDate());
      refreshWeather(true).then(() => { if (menu.open) syncMenu(); });
      refreshGeography(); // same-origin data only; no location is included in its URL
      if (ask) { syncMenu(); toast("Sunrise " + fmtTime(sun.sunrise, hour12) + " · sunset " + fmtTime(sun.sunset, hour12), false); }
      request();
    },
    () => {
      locating = false;
      if (ask) toast(prefs.loc ? "Couldn't update your location — keeping the last one" : "Location wasn't shared — allow it in your browser and try again", false);
      request();
    },
    { timeout: 8000, maximumAge: 6 * 3600e3 },
  );
}

async function share() {
  const url = location.origin + location.pathname + "?day=" + encodeURIComponent(encodeDay(blocks));
  try {
    if (navigator.share) { await navigator.share({ title: "My day, shaped", text: shapedSummary(blocks), url }); return; }
    await navigator.clipboard.writeText(url);
    toast("Link copied", false);
  } catch (err) {
    if (err?.name !== "AbortError") toast("Couldn't share — try again", false);
  }
}

/* ---------------- boot ---------------- */
function openShared() {
  const code = params.get("day");
  if (!code) return;
  const day = decodeDay(code);
  if (day) {
    history.push(blocks, "Opened a shared day");
    blocks = day.map((b) => ({ ...b, id: uid() }));
    persist();
    setTimeout(() => toast(day.length ? "Opened a shared day" : "Opened an empty day", true), 400);
  } else {
    setTimeout(() => toast("That link didn't hold a whole day — yours is untouched", false), 400);
  }
  params.delete("day");
  const q = params.toString();
  window.history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
}
if (!PREVIEW) openShared();

// minute tick, aligned to the clock
function tick() {
  request();
  refreshWeather();
  const now = new Date();
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 30);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { lastFrame = performance.now(); refreshWeather(); request(); } });
addEventListener("online", () => { refreshWeather(); request(); });
addEventListener("offline", request);
addEventListener("resize", request);
reduceMotion.addEventListener?.("change", request);
addEventListener("storage", (e) => {
  if (e.key !== "dayshaper.blocks.v3" || handBusy()) return;
  blocks = loadBlocks();
  if (selectedId && !blocks.some((b) => b.id === selectedId)) selectedId = null;
  request();
});

setPanels();
setHint();
if (mode === "shape") setPanels();
if (!PREVIEW && prefs.loc) { refreshGeography(); locate(false); }
else if (!PREVIEW && navigator.permissions?.query) {
  navigator.permissions.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") locate(false); }).catch(() => {});
}
persist(); // heal whatever was loaded
if (!PREVIEW && !storageWorks()) setTimeout(() => toast("This browser won't keep your day after you leave", false), 1200);
tick();
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("instant")));

if ("serviceWorker" in navigator && !PREVIEW && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// test hook: lets the e2e suite read state without poking at internals
Object.defineProperty(window, "__dayshaper", { value: {
  get blocks() { return blocks; }, get mode() { return mode; }, get selectedId() { return selectedId; },
  get nowOnTop() { return prefs.nowOnTop; }, get weather() { return wx; },
} });
