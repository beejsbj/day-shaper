import { test } from "node:test";
import assert from "node:assert/strict";
import { moonPhase, moonUp, moonPath } from "../src/moon.js";

// the mean synodic month drifts up to about 14 h from the true moon: a day's slack (0.034) is plenty for a sky
test("moon phases match published dates", () => {
  // full moon 26 Sep 2026 16:49 UTC; new moon 11 Sep 2026 03:27 UTC; first quarter 18 Sep 2026 20:44 UTC
  const full = moonPhase(new Date(Date.UTC(2026, 8, 26, 16, 49)));
  assert.ok(Math.abs(full.phase - 0.5) < 0.034, "full " + full.phase);
  assert.ok(full.illum > 0.99);
  assert.equal(full.name, "Full moon");
  const nw = moonPhase(new Date(Date.UTC(2026, 8, 11, 3, 27)));
  assert.ok(nw.phase < 0.034 || nw.phase > 0.966, "new " + nw.phase);
  assert.ok(nw.illum < 0.01);
  const fq = moonPhase(new Date(Date.UTC(2026, 8, 18, 20, 44)));
  assert.ok(Math.abs(fq.phase - 0.25) < 0.034, "first quarter " + fq.phase);
  assert.equal(fq.name, "First quarter");
});

test("a full moon is up at midnight and down at noon; a new moon the other way round", () => {
  assert.equal(moonUp(0, 0.5, 12), 1);
  assert.equal(moonUp(12, 0.5, 12), 0);
  assert.equal(moonUp(12, 0, 12), 1);
  assert.equal(moonUp(0, 0, 12), 0);
});

test("the lit shape is a closed path that mirrors in the south", () => {
  const d = moonPath(0.2, 10, 20, 20);
  assert.match(d, /^M20 10A10 10 0 0 1 20 30A[\d.]+ 10 0 0 0 20 10Z$/);
  assert.match(moonPath(0.2, 10, 20, 20, true), /^M20 10A10 10 0 0 0 20 30A[\d.]+ 10 0 0 1 20 10Z$/);
  // full: both halves are lit, the "terminator" is the far limb
  assert.equal(moonPath(0.5, 10, 20, 20), "M20 10A10 10 0 0 0 20 30A10 10 0 0 0 20 10Z");
});
