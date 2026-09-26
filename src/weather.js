/* Weather, only from where you actually are. Open-Meteo (free, no key) gives
   the current conditions; this module turns them into what the sky, the words
   and the readings need. Everything but fetchWeather is pure. */

import { mix } from "./color.js";
import { inkUp } from "./sky.js";

const KINDS = {
  clear:  { icon: "sun",    word: null,     cover: 0 },
  partly: { icon: "partly", word: null,     cover: 0.45 },
  cloudy: { icon: "cloud",  word: "Grey",   cover: 0.9 },
  fog:    { icon: "fog",    word: "Misty",  cover: 0.8, fog: 1 },
  drizzle:{ icon: "rain",   word: "Drizzly",cover: 0.85, rain: 0.35 },
  rain:   { icon: "rain",   word: "Rainy",  cover: 0.95, rain: 0.75 },
  snow:   { icon: "snow",   word: "Snowy",  cover: 0.9, snow: 0.8 },
  storm:  { icon: "storm",  word: "Stormy", cover: 1, rain: 1 },
};

/** WMO weather code → the app's notion of it. */
export function describeCode(code) {
  const c = Number(code);
  const is = (kind, label) => ({ kind, label });
  if (c === 0) return is("clear", "Clear");
  if (c === 1) return is("clear", "Mostly clear");
  if (c === 2) return is("partly", "Partly cloudy");
  if (c === 3) return is("cloudy", "Overcast");
  if (c === 45 || c === 48) return is("fog", "Fog");
  if (c >= 51 && c <= 57) return is("drizzle", c >= 56 ? "Freezing drizzle" : "Drizzle");
  if (c === 61 || c === 80) return is("rain", c === 80 ? "Showers" : "Light rain");
  if (c === 63 || c === 81) return is("rain", c === 81 ? "Showers" : "Rain");
  if (c === 65 || c === 82) return is("rain", "Heavy rain");
  if (c === 66 || c === 67) return is("rain", "Freezing rain");
  if (c === 71) return is("snow", "Light snow");
  if (c === 73 || c === 77) return is("snow", "Snow");
  if (c === 75) return is("snow", "Heavy snow");
  if (c === 85 || c === 86) return is("snow", "Snow showers");
  if (c >= 95 && c <= 99) return is("storm", c === 95 ? "Thunderstorm" : "Storm with hail");
  return is("partly", "Changeable");
}

/**
 * The weather the rest of the app reads.
 * @param {{temp:number, code:number, cover?:number, unit?:string, elevation?:number}} raw
 */
export function weatherView(raw) {
  if (!raw || !Number.isFinite(Number(raw.temp))) return null;
  const { kind, label } = describeCode(raw.code);
  const k = KINDS[kind];
  const cover = Number.isFinite(raw.cover) ? Math.max(k.cover, raw.cover / 100) : k.cover;
  return {
    kind, label, icon: k.icon, word: k.word,
    temp: Math.round(raw.temp), unit: raw.unit === "fahrenheit" ? "F" : "C",
    cover: Math.min(1, cover), rain: k.rain || 0, snow: k.snow || 0, fog: k.fog || 0,
    wet: !!(k.rain || k.snow),
    elevation: Number.isFinite(raw.elevation) ? raw.elevation : null,
  };
}

/** Grey the sky under cloud, then re-choose the inks so words still read. */
export function weatherize(sky, wx) {
  if (!wx || wx.cover < 0.5) return sky;
  const k = (wx.cover - 0.5) * 2 * (0.42 + (wx.rain || wx.snow ? 0.12 : 0)); // 0 … ~0.54
  const grey = sky.dark > 0.5 ? "#1e2433" : "#a9b1bd";
  const g = (c, amt = k) => mix(c, grey, amt);
  sky.top = g(sky.top); sky.mid = g(sky.mid); sky.bot = g(sky.bot, k * 0.8);
  sky.ridge = sky.ridge.map((c) => g(c, k * 0.7));
  sky.haze = g(sky.haze, k * 0.6);
  sky.clouds = Math.max(sky.clouds, Math.min(1, wx.cover) * (sky.dark > 0.5 ? 0.35 : 1));
  sky.stars *= 1 - Math.min(1, wx.cover);
  sky.moon *= 1 - Math.min(1, wx.cover) * 0.97;
  sky.orb = { ...sky.orb, glowA: sky.orb.glowA * (1 - k * 0.6) };
  return inkUp(sky);
}

/** Fahrenheit where people read it. */
export function tempUnit(locale = (typeof navigator !== "undefined" && navigator.language) || "en") {
  let region = "";
  try { region = new Intl.Locale(locale).maximize().region || ""; } catch { region = (locale.split("-")[1] || "").toUpperCase(); }
  return ["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"].includes(region) ? "fahrenheit" : "celsius";
}

/** Current conditions at loc. Rejects on any failure; the caller keeps whatever it had. */
export async function fetchWeather(loc, unit, fetchImpl = fetch) {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.search = new URLSearchParams({
    latitude: loc.lat.toFixed(2), longitude: loc.lon.toFixed(2), // ~1 km: enough for weather, no more
    current: "temperature_2m,weather_code,cloud_cover", temperature_unit: unit, timezone: "auto",
  });
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchImpl(u, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) throw new Error("weather " + res.status);
    const j = await res.json();
    const c = j.current || {};
    return { temp: c.temperature_2m, code: c.weather_code, cover: c.cloud_cover, unit, elevation: j.elevation, at: Date.now(), lat: loc.lat, lon: loc.lon };
  } finally { if (timer) clearTimeout(timer); }
}

/** A forced weather for previews and tests: ?wx=rain&temp=12 */
export function weatherFromParam(kind, temp) {
  const codes = { clear: 0, partly: 2, cloudy: 3, fog: 45, drizzle: 53, rain: 63, snow: 73, storm: 95 };
  if (!(kind in codes)) return null;
  return { temp: Number.isFinite(+temp) && temp !== null ? +temp : 14, code: codes[kind], unit: "celsius", elevation: 30 };
}
