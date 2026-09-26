/* The dial. One SVG, two states that morph into each other with `m`:
   m = 0  live  — a slim ring of the day around a large orb holding the time
   m = 1  shape — the ring swells into clay, the orb settles into a hub
   Noon sits at the top by default, so the day arcs overhead like the sun. */

import { TYPES, typeOf } from "./types.js";
import { lighten, rgba } from "./color.js";
import { mod24, wrapDelta } from "./engine.js";
import { fmtHourMark, fmtTime } from "./time.js";

const NS = "http://www.w3.org/2000/svg";
export const C = 200, R = 148;
export const LIVE = { w: 6, orb: 104 }, SHAPE = { w: 34, orb: 80 };
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const f = (n) => Math.round(n * 100) / 100;

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const set = (e, attrs) => { for (const k in attrs) e.setAttribute(k, attrs[k]); };
const clear = (g) => { while (g.firstChild) g.removeChild(g.firstChild); };

export function createDial(svg) {
  let rot = 12;
  const ang = (t) => ((t + rot) / 24) * TAU;
  const at = (a, r) => [C + r * Math.sin(a), C - r * Math.cos(a)];
  const P = (a, r) => { const [x, y] = at(a, r); return f(x) + " " + f(y); };

  /** Annular sector from hour t0 to t1 with softly rounded corners. */
  function sector(t0, t1, r0, r1, corner) {
    const span = ((t1 - t0) / 24) * TAU;
    if (span >= TAU - 1e-3) {
      return `M${C} ${C - r1}A${r1} ${r1} 0 1 1 ${C} ${C + r1}A${r1} ${r1} 0 1 1 ${C} ${C - r1}Z`
        + `M${C} ${C - r0}A${r0} ${r0} 0 1 0 ${C} ${C + r0}A${r0} ${r0} 0 1 0 ${C} ${C - r0}Z`;
    }
    const c = Math.max(0, Math.min(corner, (r1 - r0) / 2, (span * r0) / 2 - 0.05));
    const a0 = ang(t0), a1 = a0 + span, dO = c / r1, dI = c / r0;
    const lO = span - 2 * dO > Math.PI ? 1 : 0, lI = span - 2 * dI > Math.PI ? 1 : 0;
    return `M${P(a0 + dO, r1)}A${r1} ${r1} 0 ${lO} 1 ${P(a1 - dO, r1)}Q${P(a1, r1)} ${P(a1, r1 - c)}`
      + `L${P(a1, r0 + c)}Q${P(a1, r0)} ${P(a1 - dI, r0)}A${r0} ${r0} 0 ${lI} 0 ${P(a0 + dI, r0)}`
      + `Q${P(a0, r0)} ${P(a0, r0 + c)}L${P(a0, r1 - c)}Q${P(a0, r1)} ${P(a0 + dO, r1)}Z`;
  }

  /** Open arc along radius r, split into short pieces so dashes stay regular. */
  function arc(t0, t1, r) {
    const span = t1 - t0, n = Math.max(1, Math.ceil(span / 4));
    let d = "M" + P(ang(t0), r);
    for (let k = 1; k <= n; k++) d += `A${r} ${r} 0 0 1 ${P(ang(t0 + (span * k) / n), r)}`;
    return d;
  }

  function blob(r, amt, time) {
    const N = 40, pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const k = 1 + amt * (0.05 * Math.sin(2 * a + time * 0.5) + 0.035 * Math.sin(3 * a - time * 0.37 + 1.3)
        + 0.02 * Math.sin(5 * a + time * 0.61 + 0.4));
      pts.push([C + r * k * Math.cos(a), C + r * k * Math.sin(a)]);
    }
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < N; i++) {
      const p0 = pts[(i + N - 1) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} `
        + `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d + "Z";
  }

  /* ---------- static structure ---------- */
  svg.setAttribute("viewBox", "0 0 400 400");
  const defs = el("defs", null, svg);
  const radial = (id, attrs, stops) => {
    const g = el("radialGradient", { id, ...attrs }, defs);
    return stops.map((o) => el("stop", { offset: o }, g));
  };
  const orbStops = radial("orbGrad", { cx: "38%", cy: "30%", r: "78%", fx: "34%", fy: "24%" }, [0, 0.55, 1]);
  const glowStops = radial("orbGlow", {}, [0, 0.62, 1]);
  const satStops = radial("satGrad", { cx: "35%", cy: "28%", r: "80%" }, [0, 0.6, 1]);
  const sat2Stops = radial("satGrad2", { cx: "35%", cy: "28%", r: "80%" }, [0, 0.6, 1]);
  const clayR = R + SHAPE.w / 2 + 10;
  for (const ty of TYPES) {
    const s = radial("clay-" + ty.id, { gradientUnits: "userSpaceOnUse", cx: C, cy: C, r: clayR }, [0.72, 0.84, 0.97]);
    set(s[0], { "stop-color": ty.c1 }); set(s[1], { "stop-color": ty.c0 }); set(s[2], { "stop-color": lighten(ty.c0, 0.3) });
  }

  const layer = (id) => el("g", { id }, svg);
  const gGlow = layer("dGlow"), gTrack = layer("dTrack"), gMarks = layer("dMarks"), gGhost = layer("dGhost");
  const gClay = layer("dClay"), gLeave = layer("dLeave"), gVeil = layer("dVeil"), gHandles = layer("dHandles");
  const gSolar = layer("dSolar"), gNow = layer("dNow");
  const gOrb = layer("dOrb"), gText = layer("dText");
  gSolar.setAttribute("aria-hidden", "true"); // the dial's accessible summary includes these times

  const solarMarks = ["sunrise", "sunset"].map((kind) => {
    const g = el("g", { class: "solar-marker", "data-event": kind }, gSolar);
    const line = el("path", { class: "solar-leader" }, g);
    const pin = el("circle", { r: 1.5, class: "solar-pin" }, g);
    const badge = el("circle", { r: 8, class: "solar-badge" }, g);
    const glyph = el("use", { href: "#i-" + kind, width: 13, height: 13, class: "solar-icon" }, g);
    const path = el("path", { id: "solar-label-" + kind }, defs);
    const text = el("text", { class: "solar-label", "text-anchor": "middle" }, g);
    const label = el("textPath", { href: "#solar-label-" + kind, startOffset: "50%" }, text);
    return { kind, g, line, pin, badge, glyph, path, label };
  });
  const polarLabel = el("text", { class: "solar-polar", x: C, y: 24, "text-anchor": "middle" }, gSolar);

  const glow = el("circle", { cx: C, cy: C, fill: "url(#orbGlow)" }, gGlow);
  const band = el("circle", { cx: C, cy: C, fill: "none", class: "track" }, gTrack);
  const dayBand = el("path", { fill: "none", class: "track-day" }, gTrack);
  const quarterDots = el("path", { fill: "none", class: "dots", "stroke-linecap": "round" }, gTrack);
  const pastDots = el("path", { fill: "none", class: "dots past", "stroke-linecap": "round" }, gTrack);
  const hourDots = el("circle", { cx: C, cy: C, r: R, fill: "none", class: "dots hour", "stroke-linecap": "round" }, gTrack);
  const veil = el("path", { fill: "none", class: "veil", "stroke-linecap": "butt" }, gVeil);

  const markText = [0, 6, 12, 18].map(() => el("text", { class: "mark", "text-anchor": "middle", "dominant-baseline": "central" }, gMarks));

  const orbBody = el("path", { fill: "url(#orbGrad)", class: "orb" }, gOrb);
  const orbRim = el("path", { fill: "none", class: "orb-rim" }, gOrb);
  const sat1 = el("circle", { fill: "url(#satGrad)", class: "sat" }, gOrb);   // small, warm
  const sat2 = el("circle", { fill: "url(#satGrad2)", class: "sat" }, gOrb);  // larger, porcelain

  const tLabel = el("text", { class: "o-label", "text-anchor": "middle", "dominant-baseline": "central" }, gText);
  const tBig = el("text", { class: "o-big", "text-anchor": "middle", "dominant-baseline": "central" }, gText);
  const tBigMain = el("tspan", null, tBig), tBigSuffix = el("tspan", { class: "o-suffix-inline" }, tBig);
  const tSuffix = el("text", { class: "o-suffix", "text-anchor": "middle", "dominant-baseline": "central" }, gText);
  const tSmall = el("text", { class: "o-small", "text-anchor": "middle", "dominant-baseline": "central" }, gText);

  const nowHand = el("path", { class: "now-hand", fill: "none" }, gNow);
  const nowPulse = el("circle", { class: "now-pulse" }, gNow);
  const nowHalo = el("circle", { class: "now-halo" }, gNow);
  const nowDot = el("circle", { class: "now-dot" }, gNow);

  /* ---------- blocks: keyed, so focus survives re-render ---------- */
  const blockEls = new Map();
  let focusHandler = null, keyHandler = null;
  function blockEl(b) {
    let e = blockEls.get(b.id);
    if (!e) {
      const g = el("g", { class: "blk", "data-id": b.id });
      const body = el("path", null, g);
      const hi = el("path", { class: "blk-hi" }, g);
      const ic = el("use", { width: 17, height: 17, class: "blk-icon" }, g);
      const name = el("text", { class: "blk-name", "text-anchor": "middle", "dominant-baseline": "central" }, g);
      const dot = el("circle", { r: 2, class: "blk-dot" }, g);
      g.addEventListener("focus", () => focusHandler && focusHandler(b.id));
      g.addEventListener("keydown", (ev) => keyHandler && keyHandler(ev, g.dataset.id));
      e = { g, body, hi, ic, name, dot, type: null, born: ready ? bornAt : -Infinity };
      blockEls.set(b.id, e);
      gClay.appendChild(g);
    }
    return e;
  }

  /* ---------- render ---------- */
  let ready = false, bornAt = 0; // blocks that appear after the first paint grow in
  const GROW = 0.38;
  /** Returns true while something is still animating inside the dial. */
  function render(vm) {
    rot = vm.rot;
    bornAt = vm.time;
    let busy = false;
    const m = vm.m, me = ease(m);
    const w = lerp(LIVE.w, SHAPE.w, me);
    const r0 = R - w / 2, r1 = R + w / 2;
    const orbR = lerp(LIVE.orb, SHAPE.orb, me);
    const sky = vm.sky;
    svg.classList.toggle("shaping", m > 0.5);

    // track: dotted in life, a soft band while shaping
    set(band, { r: R, "stroke-width": w, opacity: f(me) });
    if (vm.sun.polar) set(dayBand, { d: vm.sun.polar === "day" ? arc(0, 24, R) : "", "stroke-width": w, opacity: f(me) });
    else set(dayBand, { d: arc(vm.sun.sunrise, vm.sun.sunrise + mod24(vm.sun.sunset - vm.sun.sunrise), R), "stroke-width": w, opacity: f(me) });
    const circ = TAU * R, q = circ / 96;
    const tq = Math.ceil(vm.t * 4) / 4;
    set(quarterDots, { d: tq < 24 ? arc(tq, 24, R) : "", "stroke-dasharray": `0 ${f(q)}`, opacity: f(1 - me) });
    set(pastDots, { d: tq > 0 ? arc(0, Math.max(0, tq - 0.25) + 0.0001, R) : "", "stroke-dasharray": `0 ${f(q)}`, opacity: f(1 - me) });
    set(hourDots, { "stroke-dasharray": `0 ${f(circ / 24)}`, transform: `rotate(${f((rot / 24) * 360)} ${C} ${C})`, opacity: f(lerp(0.9, 0.45, me)) });

    // The pins stay at the true solar hours. On very short days/nights only
    // the captions spread apart, with leaders back to their exact positions.
    const delta = wrapDelta(vm.sun.sunset - vm.sun.sunrise);
    const spread = Math.max(0, (3.2 - Math.abs(delta)) / 2) * (Math.sign(delta) || 1);
    const labelHours = [vm.sun.sunrise - spread, vm.sun.sunset + spread];
    solarMarks.forEach((mark, i) => {
      mark.g.style.display = vm.sun.polar ? "none" : "";
      if (vm.sun.polar) return;
      const hour = vm.sun[mark.kind], labelHour = labelHours[i];
      // Nearly coincident events retain their exact pins; stagger the symbols
      // across the ring so both arrows can still be seen.
      const symbolR = Math.abs(delta) < 0.5 ? R + (i ? 9 : -9) : R;
      const [px, py] = at(ang(hour), R), [x, y] = at(ang(hour), symbolR);
      set(mark.pin, { cx: f(px), cy: f(py) });
      set(mark.badge, { cx: f(x), cy: f(y) });
      set(mark.glyph, { x: f(x - 6.5), y: f(y - 6.5) });
      const [lx, ly] = at(ang(labelHour), r1 + 13);
      set(mark.line, { d: `M${P(ang(hour), Math.min(R, symbolR))}L${f(lx)} ${f(ly)}` });
      // Text follows the rim, so both captions fit even on narrow phones.
      // Reverse the lower half's path to keep its lettering upright.
      const reverse = Math.cos(ang(labelHour)) < 0;
      const from = labelHour + (reverse ? 2 : -2), to = labelHour + (reverse ? -2 : 2);
      const radius = r1 + (reverse ? 29 : 20);
      set(mark.path, { d: `M${P(ang(from), radius)}A${radius} ${radius} 0 0 ${reverse ? 0 : 1} ${P(ang(to), radius)}` });
      mark.label.textContent = `${i ? "Sunset" : "Sunrise"} · ${fmtTime(hour, vm.hour12)}`;
    });
    polarLabel.style.display = vm.sun.polar ? "" : "none";
    polarLabel.textContent = vm.sun.polar === "day" ? "Midnight sun" : "Polar night";

    // Solar captions take priority where an hour number would crowd them.
    const markR = r1 + 15;
    [0, 6, 12, 18].forEach((h, i) => {
      const [x, y] = at(ang(h), markR);
      set(markText[i], { x: f(x), y: f(y) });
      markText[i].textContent = fmtHourMark(h, vm.hour12);
      const crowded = vm.sun.polar
        ? Math.abs(wrapDelta(h + rot)) < 1.3
        : labelHours.some((labelHour) => Math.abs(wrapDelta(h - labelHour)) < 1.6);
      markText[i].style.display = crowded ? "none" : "";
    });

    // ghosts: where displaced blocks came from
    clear(gGhost);
    if (vm.origin && m > 0.5) {
      for (const b of vm.blocks) {
        const o = vm.origin.get(b.id);
        if (o === undefined || b.id === vm.activeId) continue;
        const d = wrapDelta(b.start - o);
        if (Math.abs(d) < 0.01) continue;
        el("path", { d: sector(o, o + b.len, r0 + 1, r1 - 1, 9), class: "ghost" }, gGhost);
        if (b.len < 0.6) continue; // short blocks keep their outline; their label would crowd a neighbour's
        const [x, y] = at(ang(o + b.len / 2), r1 + 13);
        const lab = el("text", { x: f(x), y: f(y), class: "ghost-label", "text-anchor": "middle", "dominant-baseline": "central" }, gGhost);
        const mins = Math.round(d * 60);
        lab.textContent = (mins > 0 ? "+" : "−") + fmtShort(Math.abs(mins));
      }
    }

    // clay
    const seen = new Set();
    const order = [...vm.blocks].sort((a, b) => (vm.lifts.get(a.id) || 0) - (vm.lifts.get(b.id) || 0));
    const gapA = 1.4 / R * 24 / TAU; // ~1.4 units of air between neighbours, in hours
    for (const b of order) {
      seen.add(b.id);
      const e = blockEl(b), ty = typeOf(b.type);
      const lift = vm.lifts.get(b.id) || 0;
      const isActive = b.id === vm.activeId, isSel = b.id === vm.selectedId;
      const out = r1 + lift * 7 * me, inn = r0 - Math.max(0, lift) * 1.5 * me;
      // a new block grows out from its middle
      const grown = vm.reduced ? 1 : ease(Math.min(1, Math.max(0, (vm.time - e.born) / GROW)));
      if (grown < 1) busy = true;
      const half = (b.len / 2 - gapA) * (0.2 + 0.8 * grown), midT = b.start + b.len / 2;
      const t0 = midT - half, t1 = midT + half;
      if (e.type !== b.type) { e.ic.setAttribute("href", "#i-" + ty.icon); e.type = b.type; }
      set(e.body, { d: sector(t0, t1, inn, out, lerp(3, 10, me)), fill: `url(#clay-${b.type})` });
      set(e.hi, { d: sector(t0, t1, out - lerp(1.2, 3.4, me), out - 0.6, lerp(0.6, 3, me)), opacity: f(0.1 + me * 0.3) });
      let op = grown < 1 ? 0.3 + 0.7 * grown : 1;
      if (vm.previewId === b.id) op = 0.82;
      if (isActive && vm.armDelete) op = 0.35;
      e.g.setAttribute("opacity", op);
      e.g.classList.toggle("lifted", lift > 0.05);
      e.g.classList.toggle("selected", isSel);

      // label: icon, and a name on long blocks; fades in with the swell
      const mid = b.start + b.len / 2, [lx, ly] = at(ang(mid), (inn + out) / 2);
      const showIcon = b.len >= 0.7, showName = b.len >= 1.75;
      set(e.ic, { x: f(lx - 8.5), y: f(ly - 8.5 - (showName ? 5 : 0)), opacity: showIcon ? f(me) : 0 });
      set(e.name, { x: f(lx), y: f(ly + 9), opacity: showName ? f(me * 0.95) : 0 });
      e.name.textContent = showName ? fitName(b.name || ty.name, b.len) : "";
      set(e.dot, { cx: f(lx), cy: f(ly), opacity: !showIcon ? f(me * 0.8) : 0 });

      // a slider whose value is the start time: screen readers pass the arrow keys straight through
      if (vm.interactive) {
        set(e.g, { tabindex: "0", role: "slider", "aria-label": b.name || ty.name, "aria-valuemin": "0", "aria-valuemax": "1439",
          "aria-valuenow": String(Math.round(b.start * 60) % 1440), "aria-valuetext": vm.labelFor(b) });
      } else {
        for (const a of ["tabindex", "role", "aria-label", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) e.g.removeAttribute(a);
      }
    }
    for (const [id, e] of blockEls) if (!seen.has(id)) { e.g.remove(); blockEls.delete(id); }
    ready = true;

    // blocks being let go: drawn into the orb, thinning as they go
    clear(gLeave);
    let gulp = 0;
    for (const { b, u } of vm.leaving || []) {
      const k = ease(Math.min(1, u));
      const rMid = lerp(R, orbR * 0.55, k), th = lerp(w, 2, k);
      const half = (b.len / 2) * (1 - 0.8 * k), midT = b.start + b.len / 2;
      el("path", { d: sector(midT - half, midT + half, rMid - th / 2, rMid + th / 2, lerp(10, 1, k) * me + 2),
        fill: `url(#clay-${b.type})`, opacity: f((1 - k) * (b.fromOp ?? 1)), class: "leaving" }, gLeave);
      gulp = Math.max(gulp, Math.sin(Math.min(1, u) * Math.PI));
      if (u < 1) busy = true;
    }
    // paint order: lifted on top. Only touch the DOM when it actually changed (moving a node drops focus).
    const want = order.map((b) => blockEls.get(b.id).g);
    const have = [...gClay.children];
    if (want.some((g, i) => have[i] !== g)) want.forEach((g) => gClay.appendChild(g));

    // the lived part of the day, veiled (life only)
    set(veil, { d: vm.t > 0.02 ? arc(0, vm.t, R) : "", "stroke-width": w + 3, opacity: f(0.42 * (1 - me)) });

    // handles on the selected block
    clear(gHandles);
    const hb = vm.blocks.find((b) => b.id === (vm.activeId || vm.selectedId));
    if (hb && m > 0.6 && !vm.armDelete && vm.previewId !== hb.id) {
      const lift = vm.lifts.get(hb.id) || 0, out = r1 + lift * 7;
      const inset = (7 / R) * (24 / TAU);
      for (const [edge, h] of [["start", hb.start + inset], ["end", hb.start + hb.len - inset]]) {
        if (hb.len < 0.6) break;
        const a = ang(h);
        el("path", { d: `M${P(a, r0 + 8)}L${P(a, out - 8)}`, class: "handle" + (vm.activeEdge === edge ? " on" : "") }, gHandles);
      }
    }

    // now: a sun-gold bead on the ring with a slow pulse and a dotted hand to the orb (life);
    // a small bead outside the clay while shaping
    const nr = lerp(R, r1 + 9, me);
    const [nx, ny] = at(ang(vm.t), nr);
    set(nowDot, { cx: f(nx), cy: f(ny), r: f(lerp(6.2, 3.4, me)) });
    set(nowHalo, { cx: f(nx), cy: f(ny), r: f(lerp(12, 6, me)) });
    set(nowPulse, { cx: f(nx), cy: f(ny), r: 7, opacity: vm.reduced ? 0 : f(1 - me) });
    set(nowHand, { d: `M${P(ang(vm.t), orbR + 9)}L${P(ang(vm.t), R - 10)}`, opacity: f(0.42 * (1 - me)) });

    // orb
    const o = vm.orb, mat = o.material;
    set(orbStops[0], { "stop-color": mat.hi }); set(orbStops[1], { "stop-color": mat.mid }); set(orbStops[2], { "stop-color": mat.lo });
    set(glowStops[0], { "stop-color": mat.glow, "stop-opacity": f(mat.glowA) });
    set(glowStops[1], { "stop-color": mat.glow, "stop-opacity": f(mat.glowA * 0.35) });
    set(glowStops[2], { "stop-color": mat.glow, "stop-opacity": 0 });
    const orbDraw = orbR * (1 + 0.05 * gulp); // the orb swallows what you let go
    set(glow, { r: f(orbDraw * 1.42) });
    last = { orbR: orbDraw, blob: o.blob, satOp: (1 - me) * o.satellites, reduced: vm.reduced };
    const d = blob(orbDraw, o.blob, vm.time);
    set(orbBody, { d });
    set(orbRim, { d, stroke: mat.rim, "stroke-opacity": f(mat.rimA), "stroke-width": 1.2 });
    // companions: a small warm one on the left, a larger porcelain one low on the right (navy by night)
    const satA = sky.orb, night = sky.dark > 0.5;
    const warm = night ? [lighten(satA.hi, 0.1), satA.mid, satA.lo] : ["#ffe2c0", "#f7c292", "#e9a06d"];
    warm.forEach((c, i) => set(satStops[i], { "stop-color": c }));
    [lighten(satA.hi, 0.25), satA.mid, satA.lo].forEach((c, i) => set(sat2Stops[i], { "stop-color": c }));
    placeSatellites(vm.time);

    // orb text
    gText.style.color = o.ink;
    const big = orbR * lerp(0.56, 0.44, me);
    const hasLabel = !!o.label;
    tLabel.textContent = o.label || "";
    tBigMain.textContent = o.big;
    const inline = me > 0.5 || o.inlineSuffix;
    tBigSuffix.textContent = inline && o.suffix ? " " + o.suffix : "";
    tSuffix.textContent = !inline && o.suffix ? o.suffix : "";
    tSmall.textContent = o.small || "";
    const bigSize = o.big.length > 7 ? big * 0.72 : big;
    set(tBig, { x: C, y: f(C + (hasLabel ? orbR * 0.02 : o.suffix && !inline ? -orbR * 0.06 : 0)), "font-size": f(bigSize) });
    set(tBigSuffix, { "font-size": f(bigSize * 0.34) });
    set(tLabel, { x: C, y: f(C - orbR * 0.4), "font-size": f(lerp(10, 9.5, me)) });
    set(tSuffix, { x: C, y: f(C + orbR * 0.33), "font-size": f(orbR * 0.13) });
    set(tSmall, { x: C, y: f(C + orbR * (hasLabel || inline ? 0.38 : o.suffix ? 0.56 : 0.4)), "font-size": f(lerp(12, 10.5, me)) });
    gText.classList.toggle("danger", o.tone === "danger");
    return busy;
  }

  /** A name, upper-cased and shortened to what the block's arc can hold. */
  function fitName(name, len) {
    const room = Math.max(3, Math.floor((len * ((TAU * R) / 24) * 0.78) / 6.2));
    const up = name.toUpperCase();
    return up.length <= room ? up : up.slice(0, room - 1).trimEnd() + "…";
  }

  /* satellites drift a little around the orb */
  let last = null;
  function placeSatellites(time) {
    const drift = last.reduced ? 0 : Math.sin(time * 0.13) * 0.05;
    const [s1x, s1y] = at((252 / 360) * TAU + drift, last.orbR + 7), [s2x, s2y] = at((132 / 360) * TAU - drift * 0.7, last.orbR - 3);
    const op = f(last.satOp);
    set(sat1, { cx: f(s1x), cy: f(s1y), r: 13, opacity: op });
    set(sat2, { cx: f(s2x), cy: f(s2y), r: 23, opacity: op });
  }

  /** Idle breath: move only the orb's outline and its companions, nothing else. */
  function breathe(time) {
    if (!last) return;
    const d = blob(last.orbR, last.blob, time);
    orbBody.setAttribute("d", d);
    orbRim.setAttribute("d", d);
    placeSatellites(time);
  }

  const fmtShort = (mins) => { const h = Math.floor(mins / 60), mm = mins % 60; return h ? (mm ? `${h}h${mm}` : `${h}h`) : `${mm}m`; };

  /** Screen point → dial coordinates, radius from centre and the hour under it. */
  function locate(clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: C, y: C, r: 0, hour: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const dx = p.x - C, dy = p.y - C;
    let a = Math.atan2(dx, -dy); if (a < 0) a += TAU;
    return { x: p.x, y: p.y, r: Math.hypot(dx, dy), hour: mod24((a / TAU) * 24 - rot) };
  }

  /** Screen position of the dial centre and scale (px per unit) — the sky pivots on it. */
  function screenCenter() {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(C, C).matrixTransform(ctm);
    return { x: p.x, y: p.y, scale: ctm.a };
  }

  return {
    render, breathe, locate, screenCenter,
    onBlockFocus(fn) { focusHandler = fn; },
    onBlockKey(fn) { keyHandler = fn; },
    focusBlock(id) { const e = blockEls.get(id); if (e) e.g.focus({ preventScroll: true }); },
    geometry: (m) => { const me = ease(m), w = lerp(LIVE.w, SHAPE.w, me); return { r0: R - w / 2, r1: R + w / 2, orbR: lerp(LIVE.orb, SHAPE.orb, me) }; },
  };
}

export { rgba };
