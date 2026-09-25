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
export function describe({ t, date, blocks, sun, hour12 }) {
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
      title = ty.mood;
      subtitle = "Until " + at(endOf(cur));
    }
  } else if (next && next.block.type === "sleep" && next.in <= WIND_DOWN) {
    title = "Time to wind down";
    subtitle = "Your bedtime is " + at(next.block.start) + ".";
    caption = fmtDur(next.in) + " to bed";
  } else {
    if (next && next.in <= 2) caption = typeOf(next.block.type).name + " in " + fmtDur(next.in);
    if (phase === "predawn") {
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
    }
  }

  return { title, subtitle, caption, phase, current, next, sleeping: cur?.type === "sleep" };
}

/** The four quiet readings under the dial (the mood board's weather row). */
export function readings({ t, blocks, sun, hour12, next }) {
  const at = (h) => fmtTime(h, hour12);
  const out = [];
  out.push(next
    ? { icon: typeOf(next.block.type).icon, label: typeOf(next.block.type).name, value: at(next.block.start) }
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
  out.push({ icon: "daylight", label: "Daylight", value: fmtDur(dayLength(sun)) });
  return out;
}

export const shapedSummary = (blocks) =>
  fmtDur(totalLen(blocks)) + " shaped · " + fmtDur(freeHours(blocks)) + " free";
