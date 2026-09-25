/* End-to-end smoke test: drives the real app in Chromium with a pointer and
   a keyboard. Run with `npm run test:e2e` (needs Playwright; uses a global
   install if the project has none). Starts its own static server. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
async function check(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    await fn(page);
    assert.deepEqual(errors, [], "console errors");
    results.push(["ok", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n").slice(0, 6).join("\n")]);
  } finally { await ctx.close(); }
}

const state = (page) => page.evaluate(() => ({ blocks: window.__dayshaper.blocks.map((b) => ({ ...b })), mode: window.__dayshaper.mode, selectedId: window.__dayshaper.selectedId }));
/** screen point for an hour at radius r on the dial (noon on top) */
const pt = (page, hour, r) => page.evaluate(([h, r]) => {
  const svg = document.getElementById("dial"), ctm = svg.getScreenCTM(), a = ((h + 12) / 24) * Math.PI * 2;
  const p = new DOMPoint(200 + r * Math.sin(a), 200 - r * Math.cos(a)).matrixTransform(ctm);
  return { x: p.x, y: p.y };
}, [hour, r]);
async function dragPath(page, points, steps = 6) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) await page.mouse.move(points[i].x, points[i].y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
async function arcDrag(page, h0, h1, r) {
  const pts = [];
  for (let k = 0; k <= 8; k++) pts.push(await pt(page, h0 + ((h1 - h0) * k) / 8, r));
  await dragPath(page, pts, 3);
}
const openShape = async (page) => {
  await page.click("#shapeBtn");
  await page.waitForTimeout(600);
  assert.equal((await state(page)).mode, "shape");
};
const at = (list, type, start) => list.find((b) => b.type === type && Math.abs(b.start - start) < 1e-6);

await check("loads calm and tells the moment", async (page) => {
  await page.goto(BASE + "?preview&at=22:30");
  await page.waitForTimeout(500);
  assert.equal(await page.textContent("#title"), "Time to wind down");
  assert.match(await page.textContent("#subtitle"), /11:30/);
  assert.equal((await page.$$("#readings li")).length, 4);
});

await check("tap the dial to start shaping, Done to return", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  const c = await pt(page, 0, 0);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(600);
  assert.equal((await state(page)).mode, "shape");
  assert.equal(await page.textContent("#title"), "Shape your day");
  await page.click("#doneBtn");
  await page.waitForTimeout(500);
  assert.equal((await state(page)).mode, "live");
});

await check("a press that wanders off the dial never leaves it stuck", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  const c = await pt(page, 0, 0);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(20, 20, { steps: 5 });   // off into the header
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.equal((await state(page)).mode, "live", "a drag-away is not a tap");
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(600);
  assert.equal((await state(page)).mode, "shape", "the dial still answers");
});

await check("move a block: neighbours are pushed, undo restores", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const before = (await state(page)).blocks;
  // work 09:00–12:30; grab its middle and drag an hour later → pushes lunch (12:45)
  await arcDrag(page, 10.75, 11.75, 148);
  const after = (await state(page)).blocks;
  assert.ok(at(after, "work", 10), "work moved to 10:00");
  assert.ok(at(after, "eat", 13.5), "lunch pushed to 13:30");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  assert.deepEqual((await state(page)).blocks.map((b) => b.start), before.map((b) => b.start));
});

await check("stretch a block by its end", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  // rest 20:30–22:00; grab its end edge and pull to 23:00 → pushes sleep? no: 22–23:30 is free
  await arcDrag(page, 21.93, 23, 148);
  const rest = (await state(page)).blocks.find((b) => b.type === "rest");
  assert.equal(rest.start, 20.5);
  assert.equal(rest.len, 2.5);
});

await check("drag a block into the orb to remove it", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const n = (await state(page)).blocks.length;
  const from = await pt(page, 18, 148), mid = await pt(page, 18, 110), orb = await pt(page, 18, 10);
  await dragPath(page, [from, mid, orb], 8);
  const after = (await state(page)).blocks;
  assert.equal(after.length, n - 1);
  assert.ok(!after.some((b) => b.type === "move" && b.start === 17.5));
});

await check("turn the orb to shift the whole day", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const before = (await state(page)).blocks;
  await arcDrag(page, 12, 13, 50);
  const after = (await state(page)).blocks;
  const shift = (x) => (((x + 1) % 24) + 24) % 24;
  assert.deepEqual(after.map((b) => b.start).sort((a, b) => a - b), before.map((b) => shift(b.start)).sort((a, b) => a - b));
});

await check("drop a stone on the ring", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const n = (await state(page)).blocks.length;
  const s = await page.$('.stone[data-type="rest"]');
  const box = await s.boundingBox();
  const target = await pt(page, 15.5, 148);   // inside afternoon work (14–17), second half
  await dragPath(page, [{ x: box.x + box.width / 2, y: box.y + 20 }, { x: box.x, y: box.y - 120 }, target], 10);
  const after = (await state(page)).blocks;
  assert.equal(after.length, n + 1);
  assert.ok(at(after, "rest", 15.5), "rest placed at 15:30");
});

await check("tap a stone to add it in the next free gap", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const n = (await state(page)).blocks.length;
  await page.click('.stone[data-type="move"]');
  await page.waitForTimeout(100);
  const s = await state(page);
  assert.equal(s.blocks.length, n + 1, "one tap, one block");
  const added = s.blocks.find((b) => b.id === s.selectedId);
  assert.equal(added.type, "move");
  assert.equal(added.start, 22); // every gap before 10 PM is under an hour; 22:00–23:30 is the first that fits
});

await check("keyboard: arrows move, shift-arrows stretch, delete removes", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const work = (await state(page)).blocks.find((b) => b.type === "work" && b.start === 14);
  await page.focus(`#dial .blk[data-id="${work.id}"]`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  let w = (await state(page)).blocks.find((b) => b.id === work.id);
  assert.equal(w.start, 14.5);
  await page.keyboard.press("Shift+ArrowLeft");
  w = (await state(page)).blocks.find((b) => b.id === work.id);
  assert.equal(w.len, 2.75);
  await page.keyboard.press("Delete");
  assert.ok(!(await state(page)).blocks.some((b) => b.id === work.id));
  await page.keyboard.press("Control+z");
  assert.ok((await state(page)).blocks.some((b) => b.id === work.id));
});

await check("assistive activation: stones answer click(), focus follows the mode", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await page.focus("#shapeBtn");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.activeElement.id), "doneBtn", "focus moved off the panel that went inert");
  const n = (await state(page)).blocks.length;
  await page.evaluate(() => document.querySelector('.stone[data-type="eat"]').click()); // what VoiceOver / switch access send
  assert.equal((await state(page)).blocks.length, n + 1);
  const roles = await page.$$eval("#dial .blk", (g) => g.map((x) => x.getAttribute("role")));
  assert.ok(roles.every((r) => r === "slider"));
  await page.keyboard.press("Escape"); // deselect
  await page.keyboard.press("Escape"); // leave shaping
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.activeElement.id), "shapeBtn");
});

await check("Escape mid-drag lets go without changing the day; undo waits for the hand", async (page) => {
  await page.goto(BASE + "?preview&at=10:00");
  await openShape(page);
  const before = (await state(page)).blocks.map((b) => b.start);
  const p0 = await pt(page, 10.75, 148);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) { const q = await pt(page, 10.75 + k * 0.25, 148); await page.mouse.move(q.x, q.y); }
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(100);
  const s = await state(page);
  assert.equal(s.mode, "shape");
  assert.deepEqual(s.blocks.map((b) => b.start), before);
});

await check("a broken share link never wipes the day", async (page) => {
  await page.goto(BASE);
  const n = (await state(page)).blocks.length;
  await page.goto(BASE + "?day=s10.0");
  await page.waitForTimeout(300);
  assert.equal((await state(page)).blocks.length, n);
});

await check("a shared link opens the same day, and persists", async (page) => {
  await page.goto(BASE + "?day=s94.30w36.14e51.3");
  await page.waitForTimeout(400);
  const b = (await state(page)).blocks.map((x) => [x.type, x.start, x.len]);
  assert.deepEqual(b, [["work", 9, 3.5], ["eat", 12.75, 0.75], ["sleep", 23.5, 7.5]]);
  assert.ok(!page.url().includes("day="), "link param is cleaned from the address bar");
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal((await state(page)).blocks.length, 3);
});

await check("menu: 24-hour clock and play the day", async (page) => {
  await page.goto(BASE + "?preview&at=15:00");
  await page.click("#menuBtn");
  await page.click('[data-act="hour12"]');
  await page.keyboard.press("Escape");
  const labels = await page.$$eval("#dial .mark", (n) => n.map((x) => x.textContent));
  assert.ok(labels.includes("18:00") || labels.includes("06:00"), "24h marks: " + labels.join(","));
  await page.click("#menuBtn");
  await page.click('[data-act="play"]');
  await page.waitForTimeout(1500);
  assert.match(await page.textContent("#playTime"), /\d/);
  await page.click("#stopPlay");
});

await check("junk in storage never reaches the screen", async (page) => {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.setItem("dayshaper.blocks.v3", '[{"type":"work","start":"x"},{"type":"sleep","start":23,"len":9},{"type":"work","start":5,"len":4}]'));
  await page.reload();
  await page.waitForTimeout(300);
  const b = (await state(page)).blocks;
  assert.ok(b.length >= 1 && b.every((x) => Number.isFinite(x.start)));
});

// DST: New York springs forward on 8 March 2026 — ?at=10:00 must still read 10:00
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  try {
    await page.clock.install({ time: new Date("2026-03-08T15:00:00Z") });
    await page.goto(BASE + "?preview&at=10:00");
    await page.waitForTimeout(300);
    assert.equal((await page.textContent("#dText .o-big")).trim(), "10:00");
    results.push(["ok", "?at= reads true wall-clock time on a DST day"]);
  } catch (e) { results.push(["FAIL", "?at= reads true wall-clock time on a DST day", e.message.split("\n").slice(0, 4).join("\n")]); }
  await ctx.close();
}

await browser.close();
server.close();
for (const [s, n, e] of results) console.log(`${s.padEnd(4)} ${n}${e ? "\n     " + e.replace(/\n/g, "\n     ") : ""}`);
const failed = results.filter((r) => r[0] !== "ok").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
