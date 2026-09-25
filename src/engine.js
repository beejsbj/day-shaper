/* Day Shaper — the cascade engine.
   The day is a ring of 24 hours. Blocks sit on it without overlapping and may
   cross midnight (sleep 23:30 → 07:00 is one block). Every edit is a pure
   function of a snapshot: the block being handled is pinned where the hand
   wants it, and every other block keeps its order around the ring and lands
   as close to where it was as the pinned block allows — gaps are eaten first,
   neighbours are pushed only on contact, and they spring back if the hand
   retreats. Nothing here touches the DOM. */

export const DAY = 24;
export const SNAP = 0.25;            // 15-minute grid
export const MIN_LEN = SNAP;
const EPS = 1e-6;

export const mod24 = (t) => ((t % DAY) + DAY) % DAY;
/** signed shortest distance on the ring, in (-12, 12] */
export const wrapDelta = (d) => { d = mod24(d); return d > DAY / 2 ? d - DAY : d; };
export const snap = (t) => Math.round(t / SNAP) * SNAP;
export const snapDown = (t) => Math.floor(t / SNAP + EPS) * SNAP;
export const snapUp = (t) => Math.ceil(t / SNAP - EPS) * SNAP;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** round to the second so repeated edits never accumulate float drift */
const tidy = (t) => Math.round(t * 3600) / 3600;

export const totalLen = (blocks) => blocks.reduce((s, b) => s + b.len, 0);
export const freeHours = (blocks) => Math.max(0, DAY - totalLen(blocks));
export const endOf = (b) => mod24(b.start + b.len);
export const sortBlocks = (blocks) => [...blocks].sort((a, b) => a.start - b.start);
export const cloneBlocks = (blocks) => blocks.map((b) => ({ ...b }));

/** index of the block covering hour t (half-open: a seam belongs to the later block) */
export function blockAt(blocks, t) {
  t = mod24(t);
  for (let i = 0; i < blocks.length; i++) {
    if (mod24(t - blocks[i].start) < blocks[i].len - EPS) return i;
  }
  return -1;
}

/** hours from t until block b starts, going forward around the ring, in [0, 24) */
export const hoursUntil = (b, t) => mod24(b.start - t);

/* Fit an ordered chain of blocks into the free arc [lo, hi] (unwrapped hours,
   hi - lo >= sum of lens). Forward pass: each block sits at its target or is
   shoved along by the one before it. Backward pass: anything that now pokes
   past hi is pulled back, dragging its predecessors with it. */
function fitChain(chain, lo, hi) {
  const pos = new Array(chain.length);
  let cursor = lo;
  for (let k = 0; k < chain.length; k++) {
    pos[k] = Math.max(chain[k].target, cursor);
    cursor = pos[k] + chain[k].len;
  }
  let limit = hi;
  for (let k = chain.length - 1; k >= 0; k--) {
    pos[k] = Math.min(pos[k], limit - chain[k].len);
    limit = pos[k];
  }
  return pos;
}

/* The others, in ring order starting at `pivot`, each with its position
   unwrapped into [pivot, pivot + 24). */
function chainFrom(blocks, skipId, pivot) {
  return blocks
    .filter((b) => b.id !== skipId)
    .map((b) => ({ b, target: pivot + mod24(b.start - pivot) }))
    .sort((x, y) => x.target - y.target);
}

/* Pin `pinned` at [start, start+len) and let the chain yield around it. */
function settle(pinned, start, len, chain) {
  const pos = fitChain(chain.map((c) => ({ len: c.b.len, target: c.target })), start + len, start + DAY);
  const out = [{ ...pinned, start: tidy(mod24(start)), len: tidy(len) }];
  chain.forEach((c, k) => out.push({ ...c.b, start: tidy(mod24(pos[k])) }));
  return sortBlocks(out);
}

const find = (blocks, id) => blocks.find((b) => b.id === id);

/** Move block `id` so it starts at `desired` (any real hour; unwrapped is fine). */
export function moveBlock(snapshot, id, desired) {
  const b = find(snapshot, id);
  if (!b) return snapshot;
  const start = snap(desired);
  return settle(b, start, b.len, chainFrom(snapshot, id, b.start));
}

/** Largest length block `id` may take without the day overflowing. */
export function maxLenFor(blocks, id) {
  return DAY - blocks.reduce((s, b) => (b.id === id ? s : s + b.len), 0);
}

/** Drag the end edge: `desiredEnd` is unwrapped relative to the block's start. */
export function resizeEnd(snapshot, id, desiredEnd) {
  const b = find(snapshot, id);
  if (!b) return snapshot;
  const len = clamp(snap(desiredEnd - b.start), MIN_LEN, snapDown(maxLenFor(snapshot, id)));
  return settle(b, b.start, len, chainFrom(snapshot, id, b.start));
}

/** Drag the start edge: the end stays put, `desiredStart` is unwrapped. */
export function resizeStart(snapshot, id, desiredStart) {
  const b = find(snapshot, id);
  if (!b) return snapshot;
  const end = b.start + b.len;
  const len = clamp(snap(end - desiredStart), MIN_LEN, snapDown(maxLenFor(snapshot, id)));
  return settle(b, end - len, len, chainFrom(snapshot, id, b.start));
}

/** Rotate the whole day by `delta` hours (snapped). */
export function shiftAll(snapshot, delta) {
  const d = snap(delta);
  return sortBlocks(snapshot.map((b) => ({ ...b, start: tidy(mod24(b.start + d)) })));
}

export function removeBlock(blocks, id) {
  return blocks.filter((b) => b.id !== id);
}

/** Drop a new block at `start`. Landing in the first half of an existing block
    slides that block later; landing in its second half nudges it earlier.
    Returns null when the day has no room. */
export function placeBlock(blocks, block, start) {
  const len = Math.min(block.len, snapDown(freeHours(blocks)));
  if (len < MIN_LEN - EPS) return null;
  const s = snap(start);
  let pivot = s;
  const hit = blockAt(blocks, s);
  if (hit >= 0) {
    const h = blocks[hit];
    if (mod24(s - h.start) < h.len / 2) pivot = s - mod24(s - h.start); // h leads the chain
  }
  return settle({ ...block, len }, s, len, chainFrom(blocks, block.id, pivot));
}

/** Free stretches of the ring, in ring order: [{start, len}] with start in [0,24). */
export function gaps(blocks) {
  if (!blocks.length) return [{ start: 0, len: DAY }];
  const sorted = sortBlocks(blocks), out = [];
  for (let k = 0; k < sorted.length; k++) {
    const cur = sorted[k], next = sorted[(k + 1) % sorted.length];
    const endU = cur.start + cur.len;
    const nextU = k + 1 < sorted.length ? next.start : next.start + DAY;
    const len = nextU - endU;
    if (len > EPS) out.push({ start: mod24(endU), len: tidy(len) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Where a new block of `len` would sit most naturally, looking forward from
    hour `from`. Falls back to the biggest gap (shrinking the block) when
    nothing fits whole. Returns {start, len} or null when the day is full. */
export function findSpot(blocks, len, from) {
  if (!blocks.length) return { start: mod24(snapUp(from)), len };
  let best = null;
  for (const g of gaps(blocks)) {
    const rel = mod24(from - g.start);
    let s = g.start, avail = g.len;
    if (rel < g.len) {
      const skip = snapUp(rel);
      s = g.start + skip; avail = g.len - skip;
    } else {
      const aligned = snapUp(g.start);
      avail = g.len - (aligned - g.start); s = aligned;
    }
    if (avail + EPS >= len) {
      const dist = mod24(s - from);
      if (!best || dist < best.dist) best = { start: mod24(s), len, dist };
    }
  }
  if (best) return { start: best.start, len: best.len };
  const big = gaps(blocks).sort((a, b) => b.len - a.len)[0];
  if (!big) return null;
  const s = snapUp(big.start), l = snapDown(big.len - (s - big.start));
  return l >= MIN_LEN - EPS ? { start: mod24(s), len: l } : null;
}

/** True when blocks are sorted, in range, fit the day, and never overlap. */
export function isValid(blocks) {
  if (totalLen(blocks) > DAY + EPS) return false;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (!(b.start >= 0 && b.start < DAY) || !(b.len >= MIN_LEN - EPS) || b.len > DAY + EPS) return false;
    if (k > 0 && blocks[k - 1].start > b.start) return false;
    if (blocks.length > 1) {
      const next = blocks[(k + 1) % blocks.length];
      const nextU = k + 1 < blocks.length ? next.start : next.start + DAY;
      if (b.start + b.len > nextU + EPS) return false;
    }
  }
  return true;
}

let seq = 0;
export const uid = () => Date.now().toString(36).slice(-4) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

/** Coerce anything read from storage or a link into a valid day. */
export function sanitizeBlocks(list, validTypes) {
  if (!Array.isArray(list)) return null;
  const ids = new Set();
  let out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const start = Number(raw.start), len = Number(raw.len);
    if (!Number.isFinite(start) || !Number.isFinite(len)) continue;
    if (len < MIN_LEN - EPS || len > DAY) continue;
    if (validTypes && !validTypes.includes(raw.type)) continue;
    const id = typeof raw.id === "string" && raw.id && !ids.has(raw.id) ? raw.id : uid();
    ids.add(id);
    out.push({ id, type: raw.type, start: tidy(mod24(start)), len: tidy(len) });
  }
  out = sortBlocks(out);
  while (out.length && totalLen(out) > DAY + EPS) out.pop();
  if (out.length > 1 && !isValid(out)) {
    const first = out[0];
    out = settle(first, first.start, first.len, chainFrom(out, first.id, first.start));
  }
  return out;
}
