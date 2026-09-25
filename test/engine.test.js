import { test } from "node:test";
import assert from "node:assert/strict";
import {
  moveBlock, resizeEnd, resizeStart, shiftAll, placeBlock, removeBlock, findSpot, gaps,
  isValid, sanitizeBlocks, blockAt, totalLen, mod24, wrapDelta, SNAP,
} from "../src/engine.js";

const B = (id, start, len, type = "work") => ({ id, type, start, len });
const byId = (blocks, id) => blocks.find((b) => b.id === id);

// deterministic PRNG so failures reproduce
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("wrap helpers", () => {
  assert.equal(mod24(-1), 23);
  assert.equal(mod24(25), 1);
  assert.equal(wrapDelta(23), -1);
  assert.equal(wrapDelta(-23), 1);
  assert.equal(wrapDelta(12), 12);
});

test("blockAt is half-open and sees blocks that cross midnight", () => {
  const day = [B("a", 9, 2), B("b", 11, 1), B("s", 23, 8, "sleep")];
  assert.equal(blockAt(day, 10.9), 0);
  assert.equal(blockAt(day, 11), 1);       // the seam belongs to the later block
  assert.equal(blockAt(day, 2), 2);        // 02:00 is inside 23:00→07:00
  assert.equal(blockAt(day, 7), -1);
});

test("moving into a neighbour pushes it, retreating lets it spring back", () => {
  const snap = [B("a", 9, 2), B("b", 12, 1)];
  const pushed = moveBlock(snap, "a", 10.5);          // a: 10:30-12:30 overlaps b
  assert.equal(byId(pushed, "a").start, 10.5);
  assert.equal(byId(pushed, "b").start, 12.5);
  const back = moveBlock(snap, "a", 9.5);             // from the same snapshot
  assert.equal(byId(back, "b").start, 12);
});

test("moving earlier pushes the block behind", () => {
  const snap = [B("a", 8, 1), B("b", 9, 2)];
  const out = moveBlock(snap, "b", 8.5);
  assert.equal(byId(out, "b").start, 8.5);
  assert.equal(byId(out, "a").start, 7.5);
});

test("a block may cross midnight and push around the ring", () => {
  const snap = [B("s", 22, 8, "sleep"), B("m", 6.5, 1)];
  const out = moveBlock(snap, "s", 23);                // sleep 23:00 → 07:00
  assert.equal(byId(out, "s").start, 23);
  assert.equal(byId(out, "m").start, 7);
  assert.ok(isValid(out));
});

test("snaps to the quarter hour", () => {
  const out = moveBlock([B("a", 9, 1)], "a", 10.12);
  assert.equal(byId(out, "a").start, 10);
});

test("resizeEnd grows into neighbours and caps at the free day", () => {
  const snap = [B("a", 9, 2), B("b", 11, 1), B("c", 20, 2)];
  const out = resizeEnd(snap, "a", 12);
  assert.equal(byId(out, "a").len, 3);
  assert.equal(byId(out, "b").start, 12);
  const huge = resizeEnd(snap, "a", 9 + 40);
  assert.equal(byId(huge, "a").len, 21);              // 24 - 1 - 2
  assert.ok(isValid(huge));
});

test("resizeStart keeps the end fixed", () => {
  const snap = [B("a", 8, 1), B("b", 10, 2)];
  const out = resizeStart(snap, "b", 8.5);
  assert.equal(byId(out, "b").start, 8.5);
  assert.equal(byId(out, "b").len, 3.5);
  assert.equal(byId(out, "a").start, 7.5);
  const tiny = resizeStart(snap, "b", 13);
  assert.equal(byId(tiny, "b").len, SNAP);
  assert.equal(byId(tiny, "b").start + byId(tiny, "b").len, 12);
});

test("shiftAll rotates the whole day", () => {
  const out = shiftAll([B("a", 23, 2), B("b", 3, 1)], 1.5);
  assert.deepEqual(out.map((b) => [b.id, b.start]), [["a", 0.5], ["b", 4.5]]);
});

test("placing in the first half of a block slides it later, second half nudges it earlier", () => {
  const day = [B("w", 9, 4)];
  const early = placeBlock(day, B("n", 0, 1, "eat"), 9.5);
  assert.equal(byId(early, "n").start, 9.5);
  assert.equal(byId(early, "w").start, 10.5);
  const late = placeBlock(day, B("n", 0, 1, "eat"), 12);
  assert.equal(byId(late, "n").start, 12);
  assert.equal(byId(late, "w").start, 8);
});

test("placing inside a block moves the day as little as possible", () => {
  // a packed morning behind the hit block, open evening ahead: yield forward even from the second half
  // (forward moves w by 3h; backward would move w, m2 and m1 by 1.5h each = 4.5h)
  const day = [B("m1", 6, 2), B("m2", 8, 2), B("w", 10, 4), B("x", 20, 1)];
  const out = placeBlock(day, B("n", 0, 0.5, "eat"), 12.5);
  assert.equal(byId(out, "n").start, 12.5);
  assert.equal(byId(out, "w").start, 13);
  assert.equal(byId(out, "m1").start, 6);                  // the morning stays put
  // open morning behind, packed evening ahead: yield backward even from the first half
  const day2 = [B("w", 10, 4), B("e1", 14, 3), B("e2", 17, 3)];
  const out2 = placeBlock(day2, B("n", 0, 1, "eat"), 10.5);
  assert.equal(byId(out2, "w").start, 6.5);
  assert.equal(byId(out2, "e1").start, 14);
});

test("placing shrinks to the free time and refuses a full day", () => {
  const nearlyFull = [B("a", 0, 23.5)];
  const out = placeBlock(nearlyFull, B("n", 0, 2), 5);
  assert.equal(byId(out, "n").len, 0.5);
  assert.ok(isValid(out));
  assert.equal(placeBlock([B("a", 0, 24)], B("n", 0, 1), 5), null);
});

test("gaps and findSpot", () => {
  const day = [B("a", 9, 3), B("s", 23, 8, "sleep")];
  assert.deepEqual(gaps(day), [{ start: 7, len: 2 }, { start: 12, len: 11 }]);
  assert.deepEqual(findSpot(day, 1, 10), { start: 12, len: 1 });   // inside a block → next gap
  assert.deepEqual(findSpot(day, 1, 13.1), { start: 13.25, len: 1 }); // inside a gap → right here
  assert.deepEqual(findSpot(day, 3, 5), { start: 12, len: 3 });     // 7-9 too small
  assert.deepEqual(findSpot([B("a", 0, 23.5)], 2, 1), { start: 23.5, len: 0.5 });
  assert.equal(findSpot([B("a", 0, 24)], 1, 1), null);
});

test("sanitize heals junk and overlaps", () => {
  const out = sanitizeBlocks([
    { id: "a", type: "work", start: 9, len: 2 },
    { id: "a", type: "work", start: 10, len: 2 },     // dup id + overlap
    { type: "nope", start: 1, len: 1 },
    { type: "eat", start: "x", len: 1 },
    null, 7,
    { type: "sleep", start: 25, len: 8 },             // wraps to 01:00
  ], ["work", "eat", "sleep"]);
  assert.ok(isValid(out));
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map((b) => b.id)).size, 3);
  assert.equal(sanitizeBlocks("junk"), null);
  const tooMuch = sanitizeBlocks([{ type: "work", start: 0, len: 20 }, { type: "work", start: 20, len: 10 }], ["work"]);
  assert.ok(totalLen(tooMuch) <= 24);
});

test("property: any sequence of edits keeps the day valid and conserves lengths", () => {
  const rand = rng(20260925);
  for (let trial = 0; trial < 400; trial++) {
    // random valid day
    let day = [];
    let cursor = rand() * 24;
    const n = 1 + Math.floor(rand() * 9);
    for (let k = 0; k < n; k++) {
      const len = SNAP * (1 + Math.floor(rand() * 16));
      if (totalLen(day) + len > 24) break;
      day.push(B("b" + k, mod24(Math.round(cursor * 4) / 4), len));
      cursor += len + SNAP * Math.floor(rand() * 8);
    }
    day = sanitizeBlocks(day);
    assert.ok(isValid(day), "seed day valid");
    for (let step = 0; step < 25; step++) {
      const before = day;
      const target = day[Math.floor(rand() * day.length)];
      const op = Math.floor(rand() * 6);
      if (op === 0) day = moveBlock(day, target.id, target.start + (rand() - 0.5) * 60);
      else if (op === 1) day = resizeEnd(day, target.id, target.start + rand() * 30);
      else if (op === 2) day = resizeStart(day, target.id, target.start + target.len - rand() * 30);
      else if (op === 3) day = shiftAll(day, (rand() - 0.5) * 48);
      else if (op === 4) { const p = placeBlock(day, B("n" + trial + "_" + step, 0, SNAP * (1 + Math.floor(rand() * 12))), rand() * 24); if (p) day = p; }
      else if (day.length > 1) day = removeBlock(day, target.id);
      assert.ok(isValid(day), `trial ${trial} step ${step} op ${op}: ${JSON.stringify(before)} → ${JSON.stringify(day)}`);
      if (op === 0 || op === 3) assert.ok(Math.abs(totalLen(day) - totalLen(before)) < 1e-9, "move/shift conserve length");
      if (op === 0 || op === 3) {
        // ring order is preserved: blocks never pass through each other
        const order = (d) => { const s = [...d].sort((a, b) => a.start - b.start).map((b) => b.id);
          const i = s.indexOf(target.id); return s.slice(i).concat(s.slice(0, i)).join(); };
        assert.equal(order(day), order(before));
      }
    }
  }
});

test("a start that rounds up to midnight lands on 0, never 24", () => {
  const out = sanitizeBlocks([{ type: "work", start: 23.99999, len: 1 }], ["work"]);
  assert.equal(out[0].start, 0);
  assert.ok(isValid(out));
});

test("findSpot keeps to the absolute quarter-hour grid in off-grid gaps", () => {
  const day = [B("a", 6.4, 1), B("b", 8.4, 2)];          // free 7.4 → 8.4
  assert.deepEqual(findSpot(day, 0.75, 7.5), { start: 7.5, len: 0.75 });
});
