import { test } from "node:test";
import assert from "node:assert/strict";
import { rotFor, sunTimes } from "../src/solar.js";
import { loadPrefs, savePrefs, DEFAULT_PREFS, ORIENTATIONS } from "../src/store.js";

const TAU = Math.PI * 2;

test("rotFor computes dial rotation for noon, now, and sun orientations", () => {
  const sun = { sunrise: 6.2, sunset: 18.4, noon: 12.3, polar: null };

  assert.equal(rotFor("noon", 15, sun), 12, "noon orientation puts 12 on top");
  assert.equal(rotFor("now", 15, sun), -15, "now orientation puts current hour on top");
  assert.equal(rotFor("sun", 15, sun), 24 - 12.3, "sun orientation puts solar noon on top");
  assert.equal(rotFor("sun", 15, null), 12, "sun orientation falls back to 12 if sun is absent");
});

test("sun orientation levels the sunrise and sunset horizon axis across latitudes and seasons", () => {
  const dates = [
    { y: 2026, m: 3, d: 21 },
    { y: 2026, m: 6, d: 21 },
    { y: 2026, m: 12, d: 21 },
  ];
  const locations = [
    { lat: 43.7, lon: -79.4, tz: -4 },
    { lat: 51.5, lon: -0.1, tz: 1 },
    { lat: 35.7, lon: 139.7, tz: 9 },
    { lat: -33.9, lon: 151.2, tz: 10 },
    { lat: 64.1, lon: -21.9, tz: 0 },
  ];

  for (const date of dates) {
    for (const loc of locations) {
      const sun = sunTimes(date, loc.lat, loc.lon, loc.tz);
      if (sun.polar) continue;

      const rot = rotFor("sun", 12, sun);
      const ang = (t) => ((t + rot) / 24) * TAU;

      const aRise = ang(sun.sunrise);
      const aSet = ang(sun.sunset);
      const aNoon = ang(sun.noon);

      const xRise = Math.sin(aRise);
      const yRise = -Math.cos(aRise);
      const xSet = Math.sin(aSet);
      const ySet = -Math.cos(aSet);
      const xNoon = Math.sin(aNoon);
      const yNoon = -Math.cos(aNoon);

      assert.ok(Math.abs(yRise - ySet) < 1e-6, "sunrise and sunset have equal y");
      assert.ok(xRise < -0.1, "sunrise is on the left");
      assert.ok(xSet > 0.1, "sunset is on the right");
      assert.ok(Math.abs(xNoon) < 1e-6, "solar noon is centered horizontally");
      assert.ok(Math.abs(yNoon - (-1)) < 1e-6, "solar noon is at the top");
    }
  }
});

test("loadPrefs preserves and migrates orientation", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  assert.equal(DEFAULT_PREFS.orientation, "noon");
  assert.equal(DEFAULT_PREFS.nowOnTop, false);

  storage.clear();
  assert.equal(loadPrefs().orientation, "noon");
  assert.equal(loadPrefs().nowOnTop, false);

  storage.set("dayshaper.prefs.v1", JSON.stringify({ orientation: "sun" }));
  const sunPrefs = loadPrefs();
  assert.equal(sunPrefs.orientation, "sun");
  assert.equal(sunPrefs.nowOnTop, false);

  storage.set("dayshaper.prefs.v1", JSON.stringify({ nowOnTop: true }));
  const nowPrefs = loadPrefs();
  assert.equal(nowPrefs.orientation, "now");
  assert.equal(nowPrefs.nowOnTop, true);

  storage.clear();
  storage.set("dayshaper.clay.nowtop.v2", JSON.stringify(true));
  const legacyPrefs = loadPrefs();
  assert.equal(legacyPrefs.orientation, "now");
  assert.equal(legacyPrefs.nowOnTop, true);

  savePrefs({ orientation: "now" });
  const saved = JSON.parse(storage.get("dayshaper.prefs.v1"));
  assert.equal(saved.orientation, "now");
  assert.equal(saved.nowOnTop, true);

  savePrefs({ orientation: "sun" });
  const savedSun = JSON.parse(storage.get("dayshaper.prefs.v1"));
  assert.equal(savedSun.orientation, "sun");
  assert.equal(savedSun.nowOnTop, false);
});
