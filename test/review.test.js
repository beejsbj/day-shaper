/* Regressions from the Codex review of PR #4. Each one failed before its fix. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSpot } from "../src/engine.js";
import { encodeDay, decodeDay } from "../src/store.js";
import { skyAt, phaseAt, sunSide } from "../src/sky.js";
import { sunTimes } from "../src/solar.js";
import { contrast, mix } from "../src/color.js";

const B = (id, start, len, type = "work") => ({ id, type, start, len });

test("findSpot never hands out more than was asked for", () => {
  // the only gap wraps from 13:00 round to 12:00; from 11:00 the rest of it is too short,
  // but the same gap has room after the block
  const day = [B("a", 12, 1, "eat")];
  assert.deepEqual(findSpot(day, 8, 11), { start: 13, len: 8 });
  // when nothing fits whole, the block shrinks to the biggest gap, but never grows
  assert.deepEqual(findSpot([B("a", 0, 23)], 2, 5), { start: 23, len: 1 });
  for (let from = 0; from < 24; from += 0.25) {
    const s = findSpot(day, 2, from);
    assert.ok(s && s.len <= 2, `from ${from}: ${JSON.stringify(s)}`);
  }
});

test("a share code is read whole or not at all", () => {
  assert.equal(decodeDay("w36.8BROKENe51.3"), null);
  assert.equal(decodeDay("w36.8 e51.3"), null);
  assert.equal(decodeDay("s94.30w36"), null);
  assert.ok(decodeDay("s94.30w36.14"));
});

test("an empty day survives a share link, and is not the same as a broken one", () => {
  const code = encodeDay([]);
  assert.ok(code.length > 0, "an empty day still has a code");
  assert.deepEqual(decodeDay(code), []);
  assert.equal(decodeDay(""), null);
});

test("the low sun stays on the sunrise side just before dawn", () => {
  const sun = { sunrise: 6.1, sunset: 18.2, noon: 12.15, polar: null };
  assert.equal(sunSide(6.0, sun), "rise");
  assert.equal(sunSide(6.3, sun), "rise");
  assert.equal(sunSide(18.0, sun), "set");
  assert.equal(sunSide(18.4, sun), "set");
});

const SUNS = [
  { sunrise: 6.1, sunset: 18.2, noon: 12.15, polar: null },
  sunTimes({ y: 2026, m: 6, d: 21 }, 59.9, 10.75, 2),
  sunTimes({ y: 2026, m: 12, d: 21 }, 59.9, 10.75, 1),
  sunTimes({ y: 2026, m: 11, d: 26 }, 69.65, 18.96, 1),
  sunTimes({ y: 2026, m: 6, d: 21 }, 78.2, 15.6, 2),
  sunTimes({ y: 2026, m: 12, d: 21 }, 78.2, 15.6, 1),
];

test("text clears 3:1 between moments, not only at them", () => {
  for (const sun of SUNS) {
    for (let m = 0; m < 1440; m++) {
      const s = skyAt(m / 60, sun);
      const at = `${sun.sunrise.toFixed(2)} min ${m}`;
      assert.ok(contrast(s.ink, s.top) >= 3, `${at}: ink ${contrast(s.ink, s.top).toFixed(2)}`);
      // the words sit in the top third of the gradient
      const low = mix(s.top, s.mid, 0.35);
      assert.ok(contrast(s.ink, low) >= 3, `${at}: ink under the header ${contrast(s.ink, low).toFixed(2)}`);
      assert.ok(contrast(s.inkLow, s.ridge[1]) >= 3, `${at}: low ink ${contrast(s.inkLow, s.ridge[1]).toFixed(2)}`);
      assert.ok(contrast(s.orb.ink, s.orb.mid) >= 3, `${at}: orb ink ${contrast(s.orb.ink, s.orb.mid).toFixed(2)}`);
    }
  }
});

test("on a short winter day, sunrise is first light, not golden hour", () => {
  const sun = sunTimes({ y: 2026, m: 11, d: 26 }, 69.65, 18.96, 1); // Tromsø
  assert.equal(phaseAt(sun.sunrise, sun), "dawn");
  assert.equal(phaseAt(sun.sunset, sun), "dusk");
});
