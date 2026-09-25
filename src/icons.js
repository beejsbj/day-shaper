/* Thin line icons, 24-unit grid, drawn for this app (no emoji: they render
   differently on every phone and shout over the pastels). One sprite, used by
   both the HTML chrome and the dial. */

const P = {
  sleep: '<path d="M19.5 14.6A7.9 7.9 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z"/>',
  work: '<path d="M4.5 19.5l1-4.2L15.8 5a2.1 2.1 0 0 1 3 3L8.5 18.4z"/><path d="M13.8 7l3.2 3.2"/>',
  eat: '<path d="M3.8 11.5h16.4a8.2 8.2 0 0 1-16.4 0z"/><path d="M9.2 8.2c0-1.4 1.1-1.6 1.1-3.2M13.6 8.2c0-1.4 1.1-1.6 1.1-3.2"/>',
  move: '<path d="M13.2 3 5.5 13.2h5.8L10.4 21l8.1-10.3h-5.8z"/>',
  rest: '<path d="M5 9.5h11v4.6a5.2 5.2 0 0 1-5.2 5.2h-.6A5.2 5.2 0 0 1 5 14.1z"/><path d="M16 11h1.4a2.6 2.6 0 0 1 0 5.2H16"/><path d="M8.8 3.6c0 1.3-1 1.4-1 2.8M12.3 3.6c0 1.3-1 1.4-1 2.8"/>',
  free: '<circle cx="12" cy="12" r="8" stroke-dasharray="1.6 3.1"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3"/>',
  sunrise: '<path d="M3 18.5h18"/><path d="M7 18.5a5 5 0 0 1 10 0"/><path d="M12 4v5.5M9.5 6.5 12 4l2.5 2.5"/>',
  sunset: '<path d="M3 18.5h18"/><path d="M7 18.5a5 5 0 0 1 10 0"/><path d="M12 4v5.5M9.5 7 12 9.5 14.5 7"/>',
  daylight: '<path d="M3 18a9 9 0 0 1 18 0" stroke-dasharray="1.4 2.6"/><circle cx="12" cy="9" r="2.3"/>',
  moon: '<path d="M19.5 14.6A7.9 7.9 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z"/>',
  bed: '<path d="M3 19V6.5"/><path d="M3 15h18v4"/><path d="M21 15v-2.2A3.3 3.3 0 0 0 17.7 9.5H11V15"/><circle cx="6.8" cy="11.6" r="1.7"/>',
  more: '<circle cx="6" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  up: '<path d="M6.5 14.5 12 9l5.5 5.5"/>',
  check: '<path d="M5.5 12.5 9.8 16.8 18.5 7.8"/>',
  play: '<path d="M8.5 5.8v12.4L18.3 12z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  pin: '<path d="M12 20.8s-6.2-5.9-6.2-11a6.2 6.2 0 0 1 12.4 0c0 5.1-6.2 11-6.2 11z"/><circle cx="12" cy="9.8" r="2.2"/>',
  share: '<path d="M12 14.5V3.8"/><path d="M8.2 7.4 12 3.6l3.8 3.8"/><path d="M5.5 12.5v5.3a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5.3"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.1 2"/>',
  top: '<circle cx="12" cy="13" r="7.4"/><circle cx="12" cy="5.6" r="1.8" fill="currentColor"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.2v4.2h4.2"/>',
  clear: '<path d="M5 7.2h14"/><path d="M9.5 7.2V5.2h5v2"/><path d="M7 7.2l.9 12h8.2l.9-12"/>',
  palette: '<path d="M12 3.6a8.4 8.4 0 1 0 0 16.8c1.2 0 1.8-.9 1.5-1.9-.4-1.3.4-2.4 1.8-2.4h1.6a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.4-9z"/><circle cx="8.4" cy="11" r="1.1"/><circle cx="11.2" cy="7.6" r="1.1"/><circle cx="15.4" cy="8.6" r="1.1"/>',
};

export const ICON_NAMES = Object.keys(P);

/** Inject the sprite once; every <use href="#i-name"> resolves against it. */
export function installSprite(doc = document) {
  if (doc.getElementById("icon-sprite")) return;
  const symbols = Object.entries(P).map(([k, v]) =>
    `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${v}</symbol>`).join("");
  const wrap = doc.createElement("div");
  wrap.innerHTML = `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`;
  doc.body.prepend(wrap.firstChild);
}

export const icon = (name, cls = "i") =>
  `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
