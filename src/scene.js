/* The atmosphere behind the dial: gradient, misty ridges, clouds, stars, the
   crescent moon and a low sun at the horizon. Everything is driven by CSS
   custom properties so the browser does the crossfades; JS only writes the
   numbers once a minute (or every frame while the day is playing). */

import { mix, rgba, luminance } from "./color.js";
import { sunHeight } from "./sky.js";
import { mod24 } from "./engine.js";

/* Smooth hills from a few summed sines; deterministic so the land never jumps. */
function ridge(width, height, base, amp, seed, steps = 48) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    const u = i / steps;
    const y = base
      - amp * (0.55 * Math.sin(u * 5.1 + seed) + 0.3 * Math.sin(u * 11.3 + seed * 2.1) + 0.15 * Math.sin(u * 23.7 + seed * 0.7));
    pts.push([x, y]);
  }
  let d = `M0 ${height}L${pts[0][0]} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    d += `Q${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
  }
  return d + `L${width} ${pts[pts.length - 1][1].toFixed(1)}L${width} ${height}Z`;
}

export function createScene(root) {
  const ridges = root.querySelector(".ridges");
  const W = 400, H = 200;
  ridges.setAttribute("viewBox", `0 0 ${W} ${H}`);
  ridges.innerHTML = `
    <defs>
      <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--haze);stop-opacity:0"/>
        <stop offset="1" style="stop-color:var(--haze);stop-opacity:.55"/>
      </linearGradient>
    </defs>
    <path class="r0" d="${ridge(W, H, 70, 26, 1.7)}"/>
    <rect class="mist" x="0" y="40" width="${W}" height="80" fill="url(#mist)"/>
    <path class="r1" d="${ridge(W, H, 112, 22, 4.2)}"/>
    <rect class="mist" x="0" y="90" width="${W}" height="70" fill="url(#mist)" opacity=".7"/>
    <path class="r2" d="${ridge(W, H, 150, 16, 8.9)}"/>`;

  const stars = root.querySelector(".stars");
  const sunEl = root.querySelector(".hsun");
  function scatterStars() {
    const w = innerWidth, h = innerHeight, out = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const x = Math.round(rnd() * w), y = Math.round(rnd() * rnd() * h * 0.78);
      const big = rnd() < 0.14;
      out.push(`${x}px ${y}px 0 ${big ? 1.2 : 0.5}px rgba(255,255,255,${(0.35 + rnd() * 0.6).toFixed(2)})`);
    }
    stars.style.boxShadow = out.join(",");
  }
  scatterStars();
  addEventListener("resize", scatterStars);

  const R = document.documentElement.style;
  let last = "";

  /** Paint the sky for hour t. */
  function paint(sky, t, sun) {
    const lightPills = luminance(sky.inkLow) < 0.3; // dark words ride on pale pills, pale words on deep ones
    const v = {
      "--sky-top": sky.top, "--sky-mid": sky.mid, "--sky-bot": sky.bot,
      "--ridge-0": sky.ridge[0], "--ridge-1": sky.ridge[1], "--ridge-2": sky.ridge[2],
      "--haze": sky.haze,
      "--ink": sky.ink, "--ink-low": sky.inkLow,
      "--stars": sky.stars.toFixed(3), "--clouds": sky.clouds.toFixed(3), "--moon": sky.moon.toFixed(3),
      "--cloud": mix("#ffffff", sky.haze, 0.35),
      "--pill": lightPills ? rgba("#ffffff", 0.5) : rgba("#ffffff", 0.1),
      "--pill-strong": lightPills ? rgba("#ffffff", 0.78) : rgba(mix(sky.mid, "#0b1030", 0.45), 0.78),
      "--pill-line": lightPills ? rgba("#ffffff", 0.6) : rgba("#ffffff", 0.14),
      "--shadow": sky.dark > 0.5 ? "rgba(3,6,24,.42)" : rgba(mix(sky.mid, "#2a3a66", 0.6), 0.22),
      "--track": sky.dark > 0.5 ? rgba("#0a1030", 0.32) : rgba("#ffffff", 0.42),
      "--track-day": sky.dark > 0.5 ? rgba("#fff1d0", 0.1) : rgba("#fffaf0", 0.5),
      "--dot": rgba(sky.ink, 0.5),
      "--sheet": sky.dark > 0.5 ? rgba(mix(sky.mid, "#0b1030", 0.55), 0.94) : rgba(mix(sky.bot, "#ffffff", 0.7), 0.95),
    };
    const key = JSON.stringify(v);
    if (key !== last) { for (const k in v) R.setProperty(k, v[k]); last = key; }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", sky.top);
    document.documentElement.classList.toggle("dark", sky.dark > 0.5);

    // the low sun: rises on the left (where sunrise sits on the dial), sets on the right
    const h = sunHeight(t, sun);
    const nearRise = mod24(t - sun.sunrise) < mod24(sun.sunset - sun.sunrise) / 2;
    if (!sun.polar && h > -0.12 && h < 0.4) {
      const x = nearRise ? 24 - h * 20 : 76 + h * 20;
      const y = 74 - h * 46;
      sunEl.style.transform = `translate(${x}vw, ${y}vh)`;
      sunEl.style.opacity = (Math.min(1, (0.4 - h) / 0.2) * Math.min(1, (h + 0.12) / 0.1)).toFixed(3);
    } else {
      sunEl.style.opacity = "0";
    }
  }

  return { paint };
}
