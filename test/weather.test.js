import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCode, weatherView, weatherize, fetchWeather, weatherFromParam } from "../src/weather.js";
import { describe, readings, geography } from "../src/context.js";
import { skyAt } from "../src/sky.js";
import { contrast, mix } from "../src/color.js";
import { encodeDay, decodeDay } from "../src/store.js";

const sun = { sunrise: 6.1, sunset: 18.2, noon: 12.15, polar: null };
const date = new Date(2026, 8, 26, 15, 10);

test("WMO codes read as plain words", () => {
  assert.deepEqual(describeCode(0), { kind: "clear", label: "Clear" });
  assert.deepEqual(describeCode(63), { kind: "rain", label: "Rain" });
  assert.equal(describeCode(95).kind, "storm");
  assert.equal(describeCode(1234).kind, "partly");
});

test("rain names the afternoon, like the mood board's card", () => {
  const wx = weatherView({ temp: 12.4, code: 63 });
  const ctx = describe({ t: 15.2, date, blocks: [], sun, hour12: true, wx });
  assert.equal(ctx.title, "Rainy afternoon");
  assert.equal(ctx.subtitle, "Saturday, September 26");
  // Weather leaves the greeting subtitle clear for the date.
  const clear = describe({ t: 9, date, blocks: [], sun, hour12: true, wx: weatherView({ temp: 18, code: 0 }) });
  assert.equal(clear.title, "Good morning");
  assert.equal(clear.subtitle, "Saturday, September 26");
  // being inside a block still wins
  const busy = describe({ t: 15.2, date, blocks: [{ id: "a", type: "work", start: 14, len: 2 }], sun, hour12: true, wx });
  assert.equal(busy.title, "Focus");
});

test("weather leaves the daylight reading in place", () => {
  const wx = weatherView({ temp: 21, code: 2 });
  const r = readings({ t: 10, blocks: [], sun, hour12: true, next: null, wx });
  assert.equal(r[3].label, "Daylight");
  assert.equal(readings({ t: 10, blocks: [], sun, hour12: true, next: null })[3].label, "Daylight");
});

test("a grey sky keeps its words readable", () => {
  for (const kind of ["cloudy", "rain", "storm", "snow", "fog"]) {
    const wx = weatherView(weatherFromParam(kind, 10));
    for (let m = 0; m < 1440; m += 3) {
      const s = weatherize(skyAt(m / 60, sun), wx);
      assert.ok(contrast(s.ink, s.top) >= 3, `${kind} ${m}: ${contrast(s.ink, s.top).toFixed(2)}`);
      assert.ok(contrast(s.ink, mix(s.top, s.mid, 0.35)) >= 3, `${kind} ${m} header`);
      assert.ok(contrast(s.inkLow, s.ridge[1]) >= 3, `${kind} ${m}: low`);
    }
  }
});

test("weatherView always presents Celsius, converting cached Fahrenheit", () => {
  assert.deepEqual([weatherView({ temp: 68, code: 0, unit: "fahrenheit" }).temp, weatherView({ temp: 68, code: 0, unit: "fahrenheit" }).unit], [20, "C"]);
  assert.equal(weatherView({ temp: 32, code: 0, unit: "fahrenheit" }).temp, 0);
  assert.equal(weatherView({ temp: -4, code: 0, unit: "fahrenheit" }).temp, -20);
  assert.equal(weatherView({ temp: 20.4, code: 0, unit: "celsius" }).temp, 20);
  for (const temp of [null, "", " ", false, NaN, Infinity]) assert.equal(weatherView({ temp, code: 0 }), null);
});

test("fetchWeather asks Open-Meteo for the right place and reads the answer", async () => {
  let asked;
  const fake = async (url) => { asked = String(url); return { ok: true, json: async () => ({ elevation: 27, current: { temperature_2m: 14.6, weather_code: 51, cloud_cover: 100 } }) }; };
  const w = await fetchWeather({ lat: 40.7128, lon: -74.006 }, fake);
  assert.match(asked, /latitude=40\.71&longitude=-74\.01/);
  assert.equal(w.temp, 14.6);
  assert.equal(w.unit, "celsius");
  assert.match(asked, /temperature_unit=celsius/);
  assert.equal(weatherView(w).label, "Drizzle");
  await assert.rejects(fetchWeather({ lat: 0, lon: 0 }, async () => ({ ok: false, status: 500 })));
  await assert.rejects(fetchWeather({ lat: 0, lon: 0 }, async () => ({ ok: true, json: async () => ({ current: { temperature_2m: null, weather_code: 0 } }) })), /invalid weather response/);
});

test("location reads as geography", () => {
  const g = geography({ lat: 40.713, lon: -74.006 }, 27, { name: "Hudson River", relation: "near" });
  assert.equal(g.line, "Near Hudson River · 27 m above sea level");
  assert.equal(g.detail, "40.71° N, 74.01° W");
  assert.equal(geography({ lat: -33.87, lon: 151.21 }).line, "Your location");
  assert.equal(geography({ lat: 78.2, lon: 15.6 }, -12).line, "Your location · 12 m below sea level");
});

test("a named block is called by its name, in words and in links", () => {
  const blocks = [{ id: "a", type: "work", start: 14, len: 2, name: "Study" }];
  assert.equal(describe({ t: 15, date, blocks, sun, hour12: true }).title, "Study");
  assert.equal(readings({ t: 13, blocks, sun, hour12: true, next: { block: blocks[0], in: 1 } })[0].label, "Study");
  const back = decodeDay(encodeDay([...blocks, { id: "b", type: "rest", start: 20, len: 1, name: "Kids' bath ~ time" }]));
  assert.deepEqual(back.map((b) => b.name), ["Study", "Kids' bath time"]);
});
