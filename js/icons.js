/* Inline SVG icon set — single-color stroke glyphs that inherit currentColor, so they theme
   with the CSS variables. No emoji, no image assets. */

const P = {
  d20: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 8.5L7 16h10z"/><path d="M12 2v6.5M3 7l4 9M21 7l-4 9M3 17l4-1M21 17l-4-1M12 22v-6"/>',
  swords: '<path d="M5 4l11 11M19 4L8 15"/><path d="M14.5 16.5l3-3M9.5 16.5l-3-3"/><path d="M17 19l2-2M7 19l-2-2"/>',
  door: '<rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>',
  scroll: '<path d="M7 4h11a2 2 0 012 2v12a2 2 0 01-2 2H7"/><path d="M7 4a2 2 0 00-2 2v12a2 2 0 002 2"/><path d="M9.5 9h7M9.5 12.5h7M9.5 16h4.5"/>',
  flask: '<path d="M10 3h4M11 3v5l-4.6 7.8A3 3 0 009 20.5h6a3 3 0 002.6-4.7L13 8V3"/><path d="M8.2 15h7.6"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z"/>',
  wind: '<path d="M4 9h8.5A2.5 2.5 0 1010 6.5M3 13h13.5a2.5 2.5 0 11-2.5 2.5M4 17h6a2 2 0 11-2 2"/>',
  bolt: '<path d="M13 2L5 13h5l-1 9 8-11h-5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  run: '<path d="M5 5l7 7-7 7M13 5l7 7-7 7"/>',
  next: '<path d="M6 5l8 7-8 7z"/><path d="M18 5v14"/>',
  skull: '<path d="M12 3a7.5 7.5 0 00-7.5 7.5c0 2.6 1.4 4.7 3.5 6V20h8v-3.5c2.1-1.3 3.5-3.4 3.5-6A7.5 7.5 0 0012 3z"/><circle cx="9" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.4" fill="currentColor" stroke="none"/><path d="M10.5 20v-2M13.5 20v-2"/>',
  fire: '<path d="M12 3c1 3-4 4.5-4 9a4.8 4.8 0 009.6 0c0-2-1-3.5-2.1-4.8-.3 1-.9 1.8-1.8 2.3C14.5 7.5 13.5 5 12 3z"/>',
  bed: '<path d="M3 6v13M3 15h18v4M3 11h15a3 3 0 013 3v1"/><circle cx="6.5" cy="8.5" r="1.6"/>',
  gear: '<circle cx="12" cy="12" r="4"/><path d="M12 4v2.5M12 17.5V20M4 12h2.5M17.5 12H20M6.3 6.3l1.8 1.8M15.9 15.9l1.8 1.8M17.7 6.3l-1.8 1.8M8.1 15.9l-1.8 1.8"/>',
  eye: '<path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  foot: '<ellipse cx="9" cy="8" rx="2.3" ry="3.4"/><ellipse cx="15" cy="16" rx="2.3" ry="3.4"/>',
  chest: '<rect x="3" y="8" width="18" height="11" rx="1.5"/><path d="M3 8l2-4h14l2 4M3 13h18M12 13v3"/>',
  arrowUp: '<path d="M12 20V4M5 11l7-7 7 7"/>',
  arrowRight: '<path d="M4 12h16M13 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4 12l5 5L20 7"/>',
  grave: '<path d="M6 21V9a6 6 0 0112 0v12M4 21h16M12 9v6M9.5 11.5h5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9.5a3.5 3.5 0 010 5M18.5 7a7 7 0 010 10"/>',
  volumeOff: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  moon: '<path d="M20 13A8 8 0 1111 4a6.5 6.5 0 009 9z"/>',
  candle: '<path d="M9 21h6M10 21v-8h4v8"/><path d="M12 10.5c1.3-1.2 1.3-2.7 0-4.3-1.3 1.6-1.3 3.1 0 4.3zM12 10.5V13"/>',
  web: '<path d="M12 3v18M4 7l16 10M4 17L20 7"/><path d="M7.5 9.4v5.2L12 17.2l4.5-2.6V9.4L12 6.8z"/>',
  crown: '<path d="M4 18h16M4 18L3 9l5 3 4-6 4 6 5-3-1 9z"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 01-8 0z"/><path d="M8 5H4a4 4 0 004 5M16 5h4a4 4 0 01-4 5M12 14v4M8 21h8M10 18h4"/>',
  stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  restart: '<path d="M20 12a8 8 0 11-2.34-5.66"/><path d="M20 3v4.5h-4.5"/>',
};

export function icon(name, size = 18){
  const span = document.createElement("span");
  span.className = "ic";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.d20}</svg>`;
  return span;
}

/* Large centered glyph for room/end-screen headers. */
export function bigIcon(name, size = 54){
  const el = icon(name, size);
  el.className = "ic big";
  return el;
}
