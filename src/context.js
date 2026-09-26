/* What the screen says. Given the hour, the shaped day and the sun, pick the
   one sentence that matters now — the mood board's cards ("Focus · Until
   12:30 PM", "Time to wind down") are simply what a shaped day sounds like
   while you are living it. Pure. */

import { blockAt, mod24, endOf, freeHours, totalLen } from "./engine.js";
import { typeOf } from "./types.js";
import { fmtTime, fmtDur, fmtDate } from "./time.js";
import { phaseAt } from "./sky.js";
import { dayLength } from "./solar.js";

const WIND_DOWN = 1.5; // hours before sleep that the evening turns inward

export function nextBlock(blocks, t, skip) {
  let best = null, bestIn = Infinity;
  for (const b of blocks) {
    if (b === skip) continue;
    const dt = mod24(b.start - t);
    if (dt > 1e-6 && dt < bestIn) { best = b; bestIn = dt; }
  }
  return best ? { block: best, in: bestIn } : null;
}

function greeting(t) {
  if (t >= 5 && t < 12) return "Good morning";
  if (t >= 12 && t < 17) return "Good afternoon";
  if (t >= 17 && t < 21.5) return "Good evening";
  return "Good night";
}

/**
 * @returns {{title, subtitle, caption, phase, current, next, sleeping}}
 *   current: {block, left} | null   next: {block, in} | null
 */
const partOfDay = (t) => (t >= 5 && t < 12 ? "morning" : t >= 12 && t < 17 ? "afternoon" : t >= 17 && t < 21.5 ? "evening" : "night");
const degrees = (wx) => wx.temp + "°";

/** A block's own name if you gave it one, else its clay's. */
export const blockName = (b) => b.name || typeOf(b.type).name;

export function describe({ t, date, blocks, sun, hour12, wx = null }) {
  const phase = phaseAt(t, sun);
  const i = blockAt(blocks, t);
  const cur = i >= 0 ? blocks[i] : null;
  const current = cur ? { block: cur, left: mod24(cur.start + cur.len - t) || cur.len } : null;
  const next = nextBlock(blocks, t, cur);
  const at = (h) => fmtTime(h, hour12);
  let title, subtitle, caption = "";

  if (cur) {
    const ty = typeOf(cur.type);
    caption = fmtDur(current.left) + " left";
    if (cur.type === "sleep") {
      const night = phase === "night" || phase === "predawn";
      title = night ? "Good night" : "Resting";
      subtitle = night ? "Rest well and recharge." : "Up at " + at(endOf(cur)) + ".";
    } else {
      title = cur.name || ty.mood;
      subtitle = "Until " + at(endOf(cur));
    }
  } else if (next && next.block.type === "sleep" && next.in <= WIND_DOWN) {
    title = "Time to wind down";
    subtitle = "Your bedtime is " + at(next.block.start) + ".";
    caption = fmtDur(next.in) + " to bed";
  } else {
    if (next && next.in <= 2) caption = blockName(next.block) + " in " + fmtDur(next.in);
    if (wx && wx.word && wx.wet && phase !== "predawn") {
      // the mood board's "Rainy afternoon": weather outranks the light when it is falling
      title = wx.word + " " + partOfDay(t);
      subtitle = wx.label + " · " + degrees(wx);
    } else if (phase === "predawn") {
      title = "Almost there";
      subtitle = "Dawn is " + fmtDur(mod24(sun.sunrise - t)) + " away.";
    } else if (phase === "dawn") {
      title = "First light";
      subtitle = mod24(sun.sunrise - t) < 1 ? "Sunrise at " + at(sun.sunrise) + "." : "The day is waking.";
    } else if (phase === "golden") {
      title = "Golden hour";
      subtitle = "The light is soft and warm.";
    } else if (phase === "dusk") {
      title = "Dusk";
      subtitle = "The sky is settling in.";
    } else {
      title = greeting(t);
      subtitle = title === "Good night" ? "Rest well and recharge." : fmtDate(date);
      if (wx) subtitle += " · " + degrees(wx) + " " + wx.label.toLowerCase();
    }
  }

  return { title, subtitle, caption, phase, current, next, sleeping: cur?.type === "sleep" };
}

/** The four quiet readings under the dial (the mood board's weather row). */
export function readings({ t, blocks, sun, hour12, next, wx = null }) {
  const at = (h) => fmtTime(h, hour12);
  const out = [];
  out.push(next
    ? { icon: typeOf(next.block.type).icon, label: blockName(next.block), value: at(next.block.start) }
    : { icon: "free", label: "Next", value: "—" });
  out.push({ icon: "free", label: "Free", value: fmtDur(freeHours(blocks)) });
  if (sun.polar) {
    out.push({ icon: sun.polar === "day" ? "sun" : "moon", label: sun.polar === "day" ? "Midnight sun" : "Polar night", value: "all day" });
  } else {
    const toRise = mod24(sun.sunrise - t), toSet = mod24(sun.sunset - t);
    out.push(toSet < toRise
      ? { icon: "sunset", label: "Sunset", value: at(sun.sunset) }
      : { icon: "sunrise", label: "Sunrise", value: at(sun.sunrise) });
  }
  out.push(wx
    ? { icon: wx.icon, label: wx.label, value: degrees(wx) }
    : { icon: "daylight", label: "Daylight", value: fmtDur(dayLength(sun)) });
  return out;
}

/** Where you are, as geography rather than an address. */
export function geography(loc, elevation = null, place = null) {
  const lat = Number(loc?.lat), lon = Number(loc?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { line: "Your location", detail: "Location unavailable" };
  const coords = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
  const parts = [place?.name ? (place.relation === "near" ? "Near " + place.name : place.name) : "Your location"];
  if (Number.isFinite(elevation)) {
    const metres = Math.round(Math.abs(elevation)).toLocaleString("en") + " m";
    parts.push(elevation < -1 ? metres + " below sea level" : elevation <= 1 ? "at sea level" : metres + " above sea level");
  }
  return { line: parts.join(" · "), detail: coords };
}

export const shapedSummary = (blocks) =>
  fmtDur(totalLen(blocks)) + " shaped · " + fmtDur(freeHours(blocks)) + " free";
