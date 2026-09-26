import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchGeography } from "../src/geography.js";

const feature = (name, shape, coordinates, bbox) => [name, "test", shape, bbox, coordinates];

test("physical polygons respect boundaries, holes, and the antimeridian", () => {
  const data = { features: [
    feature("Ring", "P", [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]], [0, 0, 1, 1]),
    feature("Dateline range", "P", [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]], [-179, 10, 179, 12]),
  ] };
  assert.equal(matchGeography(data, { lat: 0.1, lon: 0.1 }).relation, "inside");
  assert.equal(matchGeography(data, { lat: 0.5, lon: 0.5 }), null, "a hole is not part of the region");
  assert.equal(matchGeography(data, { lat: 11, lon: 180 }).name, "Dateline range");
});

test("nearby rivers use their segments and stop at 30 km", () => {
  const data = { features: [feature("Test River", "L", [[[0, 0], [1, 0]]], [0, 0, 1, 0])] };
  const near = matchGeography(data, { lat: 0.1, lon: 0.5 });
  assert.equal(near.relation, "near");
  assert.ok(near.distanceKm > 10 && near.distanceKm < 12);
  assert.equal(matchGeography(data, { lat: 1, lon: 0.5 }), null);
  assert.equal(matchGeography(data, { lat: 91, lon: 0 }), null);
});

test("the bundled data recognizes local physical examples", () => {
  const data = JSON.parse(readFileSync(new URL("../data/geography.json", import.meta.url)));
  assert.equal(matchGeography(data, { lat: 43.6532, lon: -79.3832 }).name, "Lake Ontario");
  assert.equal(matchGeography(data, { lat: 33.4, lon: 75.8 }).name, "Kashmir Valley");
  assert.equal(matchGeography(data, { lat: 25, lon: 0 }).name, "Sahara");
  assert.equal(matchGeography(data, { lat: 46.8, lon: 8.2 }).name, "Alps");
  const nile = matchGeography(data, { lat: 23.988, lon: 32.879 });
  assert.equal(nile.name, "Nile");
  assert.equal(nile.relation, "near");
});
