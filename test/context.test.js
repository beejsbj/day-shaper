import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, readings } from "../src/context.js";
import { sampleDay } from "../src/types.js";
import { fmtTime, fmtRange, fmtDur, clockParts } from "../src/time.js";
import { encodeDay, decodeDay } from "../src/store.js";

let n = 0;
const day = sampleDay(() => "id" + n++);
const sun = { sunrise: 6.1, sunset: 18.2, noon: 12.15, polar: null };
const date = new Date(2026, 8, 25);
const say = (t) => describe({ t, date, blocks: day, sun, hour12: true });

test("inside a block the screen names it and says until when", () => {
  const s = say(10);
  assert.equal(s.title, "Focus");
  assert.equal(s.subtitle, "Until 12:30 PM");
  assert.equal(s.caption, "2h 30m left");
});

test("sleep at night is a good night", () => {
  const s = say(2);
  assert.equal(s.title, "Good night");
  assert.ok(s.sleeping);
});

test("an hour before bed it is time to wind down", () => {
  const s = say(22.5);
  assert.equal(s.title, "Time to wind down");
  assert.equal(s.subtitle, "Your bedtime is 11:30 PM.");
});

test("free time reads the sky", () => {
  const empty = (t) => describe({ t, date, blocks: [], sun, hour12: true });
  assert.equal(empty(17.6).title, "Golden hour");
  assert.equal(empty(18.4).title, "Dusk");
  assert.equal(empty(4).title, "Almost there");
  assert.match(empty(4).subtitle, /^Dawn is 2h 6m away\.$/);
  assert.equal(empty(10).title, "Good morning");
});

test("readings show next, free, sun and daylight", () => {
  const s = say(10);
  const r = readings({ t: 10, blocks: day, sun, hour12: true, next: s.next });
  assert.deepEqual(r.map((x) => x.label), ["Eat", "Free", "Sunset", "Daylight"]);
  assert.equal(r[0].value, "12:45 PM");
});

test("time formatting", () => {
  assert.equal(fmtTime(0, true), "12:00 AM");
  assert.equal(fmtTime(12.5, true), "12:30 PM");
  assert.equal(fmtTime(23.999, false), "00:00");
  assert.equal(fmtRange(9, 12.5, true), "9:00 AM – 12:30 PM");
  assert.equal(fmtRange(13, 14.5, true), "1:00 – 2:30 PM");
  assert.equal(fmtRange(9, 12.5, false), "09:00 – 12:30");
  assert.equal(fmtDur(2.25), "2h 15m");
  assert.equal(fmtDur(0.75), "45m");
  assert.deepEqual(clockParts(7.7, true, true), { h: "07", m: "42", suffix: "AM" });
});

test("a day survives a round trip through a link", () => {
  const code = encodeDay(day);
  const back = decodeDay(code);
  assert.deepEqual(back.map((b) => [b.type, b.start, b.len]), day.map((b) => [b.type, b.start, b.len]).sort((a, b) => a[1] - b[1]));
  assert.equal(decodeDay("garbage"), null);
});
