/* Day Shaper — wiring. State lives here; everything it draws comes from pure
   modules (engine, sky, context) and two renderers (scene, dial). */

import {
  moveBlock, resizeEnd, resizeStart, shiftAll, placeBlock, removeBlock, findSpot, blockAt,
  cloneBlocks, uid, mod24, wrapDelta, freeHours, SNAP, endOf,
} from "./engine.js";
import { TYPES, typeOf, sampleDay } from "./types.js";
import { skyAt } from "./sky.js";
import { sunForDate, guessLocation } from "./solar.js";
import { describe, readings, shapedSummary } from "./context.js";
import { hourOf, detectHour12, clockParts, fmtTime, fmtRange, fmtDur } from "./time.js";
import { loadBlocks, saveBlocks, loadPrefs, savePrefs, createHistory, encodeDay, decodeDay } from "./store.js";
import { installSprite, icon } from "./icons.js";
import { mixDeep, lighten, luminance } from "./color.js";
import { createScene } from "./scene.js";
import { createDial, R } from "./dial.js";

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
let lastFrame = performance.now(), animTime = 0;

const fixedAt = (() => {
  const v = params.get("at");
  const mm = v && /^(\d{1,2}):(\d{2})$/.exec(v);
  return mm ? Math.min(23, +mm[1]) + Math.min(59, +mm[2]) / 60 : null;
})();

/* ---------------- time & sun ---------------- */
function clockDate() {
  if (play) {
    const k = Math.min(1, (performance.now() - play.t0) / play.dur);
    const base = new Date(play.day); base.setHours(0, 0, 0, 0);
    return new Date(base.getTime() + (play.from + k * 24) * 3600e3);
  }
  if (fixedAt != null) { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() + fixedAt * 3600e3); }
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

/* ---------------- DOM ---------------- */
installSprite();
const scene = createScene($("scene"));
const dial = createDial($("dial"));
const titleEl = $("title"), subEl = $("subtitle"), dialEl = $("dial");

$("menuBtn").innerHTML = icon("more");
$("doneBtn").innerHTML = icon("check") + "<span>Done</span>";
$("shapeBtn").innerHTML = icon("up") + "<span>Shape your day</span>";
$("stopPlay").innerHTML = icon("pause");
document.querySelectorAll("[data-i]").forEach((n) => { n.innerHTML = icon(n.dataset.i); });
if (!prefs.shapedOnce) $("shapeBtn").classList.add("invite");

const tray = $("tray");
for (const ty of TYPES) {
  const b = document.createElement("button");
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
const haptic = (p = 8) => { try { navigator.vibrate?.(p); } catch { /* not allowed */ } };

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
  request();
}
function undo() {
  const prev = history.pop();
  if (!prev) { toast("Nothing to undo", false); return; }
  blocks = prev.blocks;
  coalesce = null;
  if (selectedId && !blocks.some((b) => b.id === selectedId)) selectedId = null;
  persist();
  toast("Undone · " + prev.label.toLowerCase(), history.size > 0);
  announce("Undone: " + prev.label);
  for (const b of blocks) kick(b.id, 2);
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

  draw(date, t, springs.values);

  // idle life: while you are inside a block the orb is clay, and clay breathes (slowly, ~12 fps)
  const breathing = !reduceMotion.matches && document.visibilityState === "visible" && mode === "live" && orbMix.amt > 0.01;
  if (busy) request();
  else if (breathing) { clearTimeout(idleTimer); idleTimer = setTimeout(request, 80); }
}
let idleTimer = 0;

/* ---------------- drawing ---------------- */
let lastWords = "";
function draw(date, t, liftValues) {
  const sky = skyAt(t, sun);
  scene.paint(sky, t, sun);
  const view = drag?.result || stone?.result || blocks;
  const ctx = describe({ t, date, blocks: view, sun, hour12 });

  // header words
  let title, sub;
  if (play) { title = ctx.title; sub = ctx.subtitle; }
  else if (mode === "shape") { title = "Shape your day"; sub = shapedSummary(view); }
  else { title = ctx.title; sub = ctx.subtitle; }
  const words = title + "|" + sub;
  if (words !== lastWords) {
    const first = !lastWords;
    lastWords = words;
    if (first || drag || stone || mode === "shape") { setText(titleEl, title); setText(subEl, sub); }
    else {
      $("top").classList.add("swap");
      setTimeout(() => { setText(titleEl, title); setText(subEl, sub); $("top").classList.remove("swap"); }, 180);
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
  if (play) setText($("playTime"), fmtTime(t, hour12) + " · " + ctx.title);

  dial.render({
    t, rot, m, sky, sun, hour12,
    blocks: view,
    origin: drag?.origin || stone?.origin || null,
    activeId: drag?.moved ? drag.id : null,
    activeEdge: drag?.moved ? drag.edge : null,
    selectedId: mode === "shape" ? selectedId : null,
    previewId: stone?.result ? stone.id : null,
    armDelete: !!drag?.armDelete,
    lifts: liftValues,
    orb,
    time: animTime,
    reduced: reduceMotion.matches,
    interactive: mode === "shape",
    labelFor: (b) => `${typeOf(b.type).name}, ${fmtRange(b.start, b.start + b.len, hour12)}, ${fmtDur(b.len)}`,
  });
  const role = mode === "shape" ? "group" : "img";
  const label = mode === "shape" ? "Your day. Tab to a block, then use the arrow keys to move it." : daySentence(view, t);
  if (dialEl.getAttribute("role") !== role) dialEl.setAttribute("role", role);
  if (dialEl.getAttribute("aria-label") !== label) dialEl.setAttribute("aria-label", label);
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
  const clk = clockParts(t, hour12, true);
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
    return { label: "", big: "Remove", suffix: "", small: "Let " + typeOf(b.type).name.toLowerCase() + " go", tone: "danger" };
  }
  const focusId = (drag?.moved && drag.id) || (stone?.result && stone.id) || selectedId;
  const b = focusId && view.find((x) => x.id === focusId);
  if (b) {
    const ty = typeOf(b.type), label = ty.name.toUpperCase();
    if (stone?.result) return { type: b.type, label, ...at(b.start), small: fmtDur(b.len) + " · let go to place" };
    if (drag?.moved && drag.kind === "move") return { type: b.type, label, ...at(b.start), small: "until " + fmtTime(endOf(b), hour12) };
    return { type: b.type, label, big: fmtDur(b.len), suffix: "", small: fmtRange(b.start, b.start + b.len, hour12) };
  }
  const clk = clockParts(t, hour12, true);
  return { label: "", big: clk.h + ":" + clk.m, suffix: clk.suffix, small: fmtDur(freeHours(view)) + " free", inlineSuffix: true };
}

let lastReadings = "";
function renderReadings(t, view, ctx) {
  const list = readings({ t, blocks: view, sun, hour12, next: ctx.next });
  const key = JSON.stringify(list);
  if (key === lastReadings) return;
  lastReadings = key;
  $("readings").innerHTML = list.map((r) =>
    `<li>${icon(r.icon)}<span class="l">${r.label}</span><span class="v">${r.value}</span></li>`).join("");
}

function daySentence(view, t) {
  if (!view.length) return "Your day is empty. Now " + fmtTime(t, hour12) + ".";
  const parts = view.map((b) => `${typeOf(b.type).name} ${fmtRange(b.start, b.start + b.len, hour12)}`);
  return "Your day: " + parts.join("; ") + ". Now " + fmtTime(t, hour12) + ".";
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
  setPanels();
  setHint();
  announce("Shaping your day. Tap a stone to add it, or use the arrow keys on a block.");
  haptic(6);
  request();
}
function exitShape() {
  if (mode === "live") return;
  mode = "live";
  selectedId = null;
  setPanels();
  request();
}
$("shapeBtn").addEventListener("click", enterShape);
$("doneBtn").addEventListener("click", () => { exitShape(); $("shapeBtn").focus({ preventScroll: true }); });

/* One quiet hint at a time; each visit to shaping teaches the next gesture. */
const HINTS = [
  "Tap a stone to add it · or drag it onto the ring",
  "Drag a block into the orb to let it go",
  "Turn the orb to shift the whole day",
  "Pull a block's end to stretch it",
];
let hintIndex = 0;
function setHint(text) {
  setText($("trayHint"), text || (blocks.length ? HINTS[hintIndex % HINTS.length] : "Your day is open. Tap a stone to begin."));
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
    if (i < 0) { selectedId = null; request(); return; }
    const b = blocks[i];
    const pxPerHour = (Math.PI * 2 * R) / 24;
    const dS = Math.abs(wrapDelta(p.hour - b.start)) * pxPerHour;
    const dE = Math.abs(wrapDelta(p.hour - (b.start + b.len))) * pxPerHour;
    const grab = Math.min(18, b.len * pxPerHour * 0.28);
    const edge = dS < grab && dS <= dE ? "start" : dE < grab ? "end" : null;
    d = { kind: edge ? "resize" : "move", edge, id: b.id };
  } else {
    selectedId = null; request(); return;
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
  if (!drag || e.pointerId !== drag.pointerId || drag.kind === "tap") return;
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
    drag.armDelete = p.r < dial.geometry(1).orbR * 0.92;
    next = drag.armDelete ? snap : moveBlock(snap, drag.id, b.start + delta);
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

function endDrag(e, cancelled) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;
  for (const [, s] of lifts) s.target = 0;
  if (d.kind === "tap") {
    if (!cancelled && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 12) enterShape();
    return;
  }
  setHint();
  if (!d.moved) {
    // a tap: select (or let go of) a block
    if (d.id) { selectedId = selectedId === d.id ? null : d.id; kick(d.id, 3); haptic(5); announceBlock(d.id); }
    else selectedId = null;
    request();
    return;
  }
  if (cancelled) { request(); return; }
  const b = d.snapshot.find((x) => x.id === d.id);
  if (d.kind === "move" && d.armDelete) {
    commit(removeBlock(blocks, d.id), "Removed " + typeOf(b.type).name.toLowerCase());
    selectedId = null;
    haptic([12, 30, 12]);
    announce(typeOf(b.type).name + " removed.");
    return;
  }
  if (!d.result || d.result.every((x) => { const o = d.snapshot.find((y) => y.id === x.id); return o && o.start === x.start && o.len === x.len; })) { request(); return; }
  const label = d.kind === "spin" ? "Turned the day" : (d.kind === "move" ? "Moved " : "Resized ") + typeOf(b.type).name.toLowerCase();
  commit(d.result, label);
  if (d.id) { kick(d.id, -4); announceBlock(d.id); }
}
dialEl.addEventListener("pointerup", (e) => endDrag(e, false));
dialEl.addEventListener("pointercancel", (e) => endDrag(e, true));
dialEl.addEventListener("lostpointercapture", (e) => { if (drag && drag.pointerId === e.pointerId) endDrag(e, drag.kind === "tap"); });

function announceBlock(id) {
  const b = blocks.find((x) => x.id === id);
  if (b) announce(`${typeOf(b.type).name}, ${fmtRange(b.start, b.start + b.len, hour12)}, ${fmtDur(b.len)}.`);
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
  if (cancelled) { request(); return; }
  if (!s.moved) { quickAdd(s.type); return; }
  if (s.result) {
    commit(s.result, "Added " + typeOf(s.type).name.toLowerCase());
    selectedId = s.id;
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
tray.addEventListener("keydown", (e) => {
  const node = e.target.closest(".stone");
  if (node && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); quickAdd(node.dataset.type); }
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
}

/* ---------------- keyboard ---------------- */
dial.onBlockFocus((id) => { if (mode === "shape" && selectedId !== id) { selectedId = id; request(); } });
dial.onBlockKey((e, id) => {
  if (mode !== "shape") return;
  const b = blocks.find((x) => x.id === id);
  if (!b) return;
  const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
  const name = typeOf(b.type).name.toLowerCase();
  if (dir) {
    e.preventDefault();
    let next, label;
    if (e.shiftKey) { next = resizeEnd(blocks, id, b.start + b.len + dir * SNAP); label = "Resized " + name; }
    else if (e.altKey) { next = resizeStart(blocks, id, b.start - dir * SNAP); label = "Resized " + name; }
    else { next = moveBlock(blocks, id, b.start + dir * SNAP); label = "Moved " + name; }
    commit(next, label, { coalesceKey: label + id, quiet: true });
    selectedId = id;
    announceBlock(id);
    requestAnimationFrame(() => dial.focusBlock(id));
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    commit(removeBlock(blocks, id), "Removed " + name);
    announce(typeOf(b.type).name + " removed.");
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    announceBlock(id);
  }
});
addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (e.key === "Escape" && !$("menu").open) {
    if (play) stopPlay();
    else if (selectedId && mode === "shape") { selectedId = null; request(); }
    else if (mode === "shape") exitShape();
  }
});

/* ---------------- play the day ---------------- */
function startPlay() {
  exitShape();
  play = { from: hourOf(new Date()), day: clockDate().getTime(), t0: performance.now(), dur: reduceMotion.matches ? 12000 : 24000 };
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

/* ---------------- menu ---------------- */
const menu = $("menu");
function syncMenu() {
  menu.querySelector('[data-act="nowtop"]').setAttribute("aria-checked", String(prefs.nowOnTop));
  menu.querySelector('[data-act="hour12"]').setAttribute("aria-checked", String(!hour12));
  setText($("locNote"), prefs.loc ? "Following your location" : "Estimated from your time zone · tap to use your location");
  setText($("menuSub"), shapedSummary(blocks) + " · sunrise " + fmtTime(sun.sunrise, hour12) + ", sunset " + fmtTime(sun.sunset, hour12));
}
$("menuBtn").addEventListener("click", () => { syncMenu(); menu.showModal(); });
menu.addEventListener("click", (e) => {
  if (e.target === menu) { menu.close(); return; } // tap on the backdrop
  const item = e.target.closest("[data-act]");
  if (!item) return;
  const act = item.dataset.act;
  if (act === "nowtop") { prefs.nowOnTop = !prefs.nowOnTop; persistPrefs(); syncMenu(); request(); }
  else if (act === "hour12") { hour12 = !hour12; prefs.hour12 = hour12; persistPrefs(); syncMenu(); lastReadings = ""; request(); }
  else if (act === "locate") locate(true);
  else if (act === "play") { menu.close(); startPlay(); }
  else if (act === "share") share();
  else if (act === "sample") { menu.close(); commit(sampleDay(uid), "Sample day"); }
  else if (act === "clear") { menu.close(); if (blocks.length) commit([], "Cleared the day"); }
});

function locate(ask) {
  if (!navigator.geolocation) { if (ask) toast("Location isn't available here", false); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      loc = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) };
      prefs.loc = loc; persistPrefs();
      sunKey = ""; refreshSun(clockDate());
      if (ask) { syncMenu(); toast("Sunrise " + fmtTime(sun.sunrise, hour12) + " · sunset " + fmtTime(sun.sunset, hour12), false); }
      request();
    },
    () => { if (ask) toast("Couldn't get your location — using your time zone", false); },
    { timeout: 8000, maximumAge: 6 * 3600e3 },
  );
}

async function share() {
  const url = location.origin + location.pathname + "?day=" + encodeDay(blocks);
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
    setTimeout(() => toast("Opened a shared day", true), 400);
  }
  params.delete("day");
  const q = params.toString();
  window.history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
}
if (!PREVIEW) openShared();

// minute tick, aligned to the clock
function tick() {
  request();
  const now = new Date();
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 30);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { lastFrame = performance.now(); request(); } });
addEventListener("resize", request);
reduceMotion.addEventListener?.("change", request);
addEventListener("storage", (e) => { if (e.key && e.key.startsWith("dayshaper.") && !drag) { blocks = loadBlocks(); request(); } });

setPanels();
setHint();
if (mode === "shape") setPanels();
if (!PREVIEW && prefs.loc) locate(false);
else if (!PREVIEW && navigator.permissions?.query) {
  navigator.permissions.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") locate(false); }).catch(() => {});
}
persist(); // heal whatever was loaded
tick();
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("instant")));

if ("serviceWorker" in navigator && !PREVIEW && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// test hook: lets the e2e suite read state without poking at internals
Object.defineProperty(window, "__dayshaper", { value: { get blocks() { return blocks; }, get mode() { return mode; }, get selectedId() { return selectedId; } } });
