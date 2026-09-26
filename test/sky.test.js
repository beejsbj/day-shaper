import { test } from "node:test";
import assert from "node:assert/strict";
import { sunTimes, dayLength } from "../src/solar.js";
import { skyAt, phaseAt, MOMENTS } from "../src/sky.js";
import { contrast, mix } from "../src/color.js";

const near = (actual, expected, tolMin, msg) =>
  assert.ok(Math.abs(actual - expected) * 60 <= tolMin, `${msg}: got ${actual.toFixed(3)}h, want ${expected.toFixed(3)}h`);

test("NOAA sun times match published values within 3 minutes", () => {
  // London, 21 June 2026, BST: sunrise 04:43, sunset 21:21
  const lon = sunTimes({ y: 2026, m: 6, d: 21 }, 51.5074, -0.1278, 1);
  near(lon.sunrise, 4 + 43 / 60, 3, "London sunrise");
  near(lon.sunset, 21 + 21 / 60, 3, "London sunset");
  // New York, 21 Dec 2026, EST: sunrise 07:17, sunset 16:32
  const ny = sunTimes({ y: 2026, m: 12, d: 21 }, 40.7128, -74.006, -5);
  near(ny.sunrise, 7 + 17 / 60, 3, "NYC sunrise");
  near(ny.sunset, 16 + 32 / 60, 3, "NYC sunset");
  // Delhi, 25 Sep 2026, IST: sunrise ~06:09, sunset ~18:14
  const del = sunTimes({ y: 2026, m: 9, d: 25 }, 28.6139, 77.209, 5.5);
  near(del.sunrise, 6 + 9 / 60, 4, "Delhi sunrise");
  near(del.sunset, 18 + 14 / 60, 4, "Delhi sunset");
});

test("polar day and night are reported", () => {
  assert.equal(sunTimes({ y: 2026, m: 6, d: 21 }, 78.2, 15.6, 2).polar, "day");     // Longyearbyen
  assert.equal(sunTimes({ y: 2026, m: 12, d: 21 }, 78.2, 15.6, 1).polar, "night");
  assert.equal(dayLength({ polar: "day" }), 24);
});

const SUNS = [
  { name: "equinox", sun: { sunrise: 6.1, sunset: 18.2, noon: 12.15, polar: null } },
  { name: "oslo-june", sun: sunTimes({ y: 2026, m: 6, d: 21 }, 59.9, 10.75, 2) },
  { name: "oslo-dec", sun: sunTimes({ y: 2026, m: 12, d: 21 }, 59.9, 10.75, 1) },
  { name: "polar-day", sun: sunTimes({ y: 2026, m: 6, d: 21 }, 78.2, 15.6, 2) },
  { name: "polar-night", sun: sunTimes({ y: 2026, m: 12, d: 21 }, 78.2, 15.6, 1) },
];

test("the sky is defined and continuous at every minute, everywhere", () => {
  const hex = /^#[0-9a-f]{6}$/;
  for (const { name, sun } of SUNS) {
    let prev = null;
    for (let m = 0; m <= 1440; m++) {
      const s = skyAt(m / 60, sun);
      for (const k of ["top", "mid", "bot", "ink", "inkLow", "haze"]) assert.match(s[k], hex, `${name} ${m} ${k}`);
      assert.ok(s.orb.hi.match(hex) && Number.isFinite(s.dark) && Number.isFinite(s.stars), `${name} ${m}`);
      if (prev) {
        // one minute never jumps the sky by more than a small step
        const jump = contrast(prev.mid, s.mid);
        assert.ok(jump < 1.12, `${name} minute ${m}: sky jumped (${jump.toFixed(3)})`);
      }
      prev = s;
    }
  }
});

test("text stays readable on its sky in every moment", () => {
  for (const [key, m] of Object.entries(MOMENTS)) {
    assert.ok(contrast(m.ink, m.top) >= 3, `${key}: ink on top ${contrast(m.ink, m.top).toFixed(2)}`);
    assert.ok(contrast(m.orb.ink, m.orb.mid) >= 3, `${key}: orb ink ${contrast(m.orb.ink, m.orb.mid).toFixed(2)}`);
    assert.ok(contrast(m.inkLow, m.ridge[1]) >= 3, `${key}: low ink over ridges ${contrast(m.inkLow, m.ridge[1]).toFixed(2)}`);
  }
});

test("the sky mixes stay readable between moments too", () => {
  const sun = SUNS[0].sun;
  for (let m = 0; m < 1440; m += 5) {
    const s = skyAt(m / 60, sun);
    assert.ok(contrast(s.ink, s.top) >= 2.6, `${m}: ink ${s.ink} on ${s.top} = ${contrast(s.ink, s.top).toFixed(2)}`);
    assert.ok(contrast(s.orb.ink, s.orb.mid) >= 2.6, `${m}: orb ink ${s.orb.ink} on ${s.orb.mid} = ${contrast(s.orb.ink, s.orb.mid).toFixed(2)}`);
  }
});

test("phases fall where the words expect", () => {
  const sun = SUNS[0].sun;
  assert.equal(phaseAt(4.5, sun), "predawn");
  assert.equal(phaseAt(6.2, sun), "dawn");
  assert.equal(phaseAt(12, sun), "day");
  assert.equal(phaseAt(17.5, sun), "golden");
  assert.equal(phaseAt(18.5, sun), "dusk");
  assert.equal(phaseAt(22, sun), "night");
});

test("every block orb carries readable ink", async () => {
  const { TYPES } = await import("../src/types.js");
  for (const ty of TYPES) assert.ok(contrast(ty.orb.ink, ty.orb.mid) >= 3, `${ty.id} ${contrast(ty.orb.ink, ty.orb.mid).toFixed(2)}`);
});

test("oklab mix endpoints", () => {
  assert.equal(mix("#102030", "#ffffff", 0), "#102030");
  assert.equal(mix("#102030", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#000000", "#000000", 0.5), "#000000");
});
