/* Sunrise and sunset from the NOAA solar calculator (accurate to about a
   minute away from the poles). Pure: the caller passes the calendar date and
   the UTC offset, so it can be tested without the machine's timezone. */

const rad = Math.PI / 180, deg = 180 / Math.PI;

function julianDay(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/**
 * @param {{y:number,m:number,d:number}} day  calendar date (m is 1-12)
 * @param {number} lat  degrees north
 * @param {number} lon  degrees east
 * @param {number} tz   hours east of UTC (e.g. +5.5, -4)
 * @returns {{sunrise:number, sunset:number, noon:number, polar:null|"day"|"night"}} local clock hours
 */
export function sunTimes({ y, m, d }, lat, lon, tz) {
  const jd = julianDay(y, m, d) + 0.5 - tz / 24; // local noon
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(obliq * rad) * Math.sin(appLong * rad));
  const vy = Math.tan((obliq / 2) * rad) ** 2;
  const eot = 4 * deg * (vy * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad)
    + 4 * e * vy * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * vy * vy * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const noon = (720 - 4 * lon - eot + tz * 60) / 60;
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const wrap = (h) => ((h % 24) + 24) % 24;
  if (cosH > 1) return { sunrise: wrap(noon), sunset: wrap(noon), noon: wrap(noon), polar: "night" };
  if (cosH < -1) return { sunrise: wrap(noon - 12), sunset: wrap(noon + 12), noon: wrap(noon), polar: "day" };
  const H = (Math.acos(cosH) * deg) / 15;
  return { sunrise: wrap(noon - H), sunset: wrap(noon + H), noon: wrap(noon), polar: null };
}

export const dayLength = (sun) =>
  sun.polar === "day" ? 24 : sun.polar === "night" ? 0 : ((sun.sunset - sun.sunrise) % 24 + 24) % 24;

/* Without a location we still want sane light. Longitude follows from the
   clock's own UTC offset; latitude from a small table of common zones,
   otherwise a temperate guess for the hemisphere. */
const ZONE_LAT = {
  "Asia/Kolkata": 22.6, "Asia/Calcutta": 22.6, "Asia/Dubai": 25.2, "Asia/Karachi": 24.9, "Asia/Dhaka": 23.8,
  "Asia/Singapore": 1.35, "Asia/Tokyo": 35.7, "Asia/Shanghai": 31.2, "Asia/Hong_Kong": 22.3, "Asia/Seoul": 37.6,
  "Asia/Jakarta": -6.2, "Asia/Manila": 14.6, "Asia/Bangkok": 13.8, "Asia/Riyadh": 24.7, "Asia/Qatar": 25.3,
  "Europe/London": 51.5, "Europe/Paris": 48.9, "Europe/Berlin": 52.5, "Europe/Madrid": 40.4, "Europe/Rome": 41.9,
  "Europe/Amsterdam": 52.4, "Europe/Stockholm": 59.3, "Europe/Oslo": 59.9, "Europe/Helsinki": 60.2, "Europe/Moscow": 55.8,
  "Europe/Istanbul": 41.0, "Africa/Cairo": 30.0, "Africa/Lagos": 6.5, "Africa/Nairobi": -1.3, "Africa/Johannesburg": -26.2,
  "America/New_York": 40.7, "America/Toronto": 43.7, "America/Chicago": 41.9, "America/Denver": 39.7,
  "America/Los_Angeles": 34.1, "America/Vancouver": 49.3, "America/Mexico_City": 19.4, "America/Sao_Paulo": -23.5,
  "America/Buenos_Aires": -34.6, "America/Bogota": 4.7, "America/Lima": -12.0, "America/Halifax": 44.6,
  "Australia/Sydney": -33.9, "Australia/Melbourne": -37.8, "Australia/Perth": -31.9, "Australia/Brisbane": -27.5,
  "Pacific/Auckland": -36.8, "Pacific/Honolulu": 21.3,
};

export function guessLocation(date = new Date()) {
  // standard (non-summer) offset: summer time would put the sun an hour early all season
  const y = date.getFullYear();
  const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
  const lon = (-std / 60) * 15 || 0; // "|| 0": Greenwich gives -0
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* no Intl */ }
  if (zone in ZONE_LAT) return { lat: ZONE_LAT[zone], lon, approx: true };
  const south = /^(Australia|Antarctica|Pacific\/Auckland)|America\/(Argentina|Santiago|Sao_Paulo|Montevideo)|Africa\/(Johannesburg|Maputo|Harare)/.test(zone);
  return { lat: south ? -32 : 38, lon, approx: true };
}

/** Convenience for the app: sun times for a Date in the browser's timezone. */
export function sunForDate(date, loc) {
  return sunTimes(
    { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() },
    loc.lat, loc.lon, -date.getTimezoneOffset() / 60,
  );
}
