/* Time reading and writing. Hours are floats in [0, 24). */
import { mod24 } from "./engine.js";

const pad = (n) => String(n).padStart(2, "0");

export function detectHour12() {
  try {
    const o = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    if (typeof o.hour12 === "boolean") return o.hour12;
    return o.hourCycle === "h12" || o.hourCycle === "h11";
  } catch {
    return false;
  }
}

export const hourOf = (d) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

/** {h, m, suffix} for a clock face. `padHour` zero-pads 12h hours (orb style: 07:42).
    `live` floors instead of rounding: a clock reads 9:41 until 9:42 has actually begun. */
export function clockParts(t, hour12, padHour = false, live = false) {
  const mins = (live ? Math.floor(mod24(t) * 60 + 1e-7) : Math.round(mod24(t) * 60)) % 1440;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!hour12) return { h: pad(h), m: pad(m), suffix: "" };
  const h12 = h % 12 || 12;
  return { h: padHour ? pad(h12) : String(h12), m: pad(m), suffix: h < 12 ? "AM" : "PM" };
}

/** "9:00 AM" or "09:00" */
export function fmtTime(t, hour12) {
  const p = clockParts(t, hour12);
  return p.h + ":" + p.m + (p.suffix ? " " + p.suffix : "");
}

/** The current time, as a clock shows it (floored). */
export function fmtNow(t, hour12) {
  const p = clockParts(t, hour12, false, true);
  return p.h + ":" + p.m + (p.suffix ? " " + p.suffix : "");
}

/** "9:00 – 12:30 PM", "11:00 AM – 1:00 PM", "09:00 – 12:30" */
export function fmtRange(t0, t1, hour12) {
  const a = clockParts(t0, hour12), b = clockParts(t1, hour12);
  const left = a.h + ":" + a.m + (a.suffix && a.suffix !== b.suffix ? " " + a.suffix : "");
  return left + " – " + b.h + ":" + b.m + (b.suffix ? " " + b.suffix : "");
}

/** "2h 15m", "45m", "8h" */
export function fmtDur(hours) {
  const mins = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return h + "h " + m + "m";
  if (h) return h + "h";
  return m + "m";
}

/** Short hour marker for the dial: "6 AM" / "12 PM" or "06:00" */
export function fmtHourMark(h, hour12) {
  if (!hour12) return pad(h % 24) + ":00";
  const h12 = h % 12 || 12;
  return h12 + (h % 24 < 12 ? " AM" : " PM");
}

export function fmtDate(d) {
  try {
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return d.toDateString();
  }
}
