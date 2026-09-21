/**
 * Markenzeichen im Kopf der Seitenleiste.
 *
 * Nachbau des Hexagon-Purus-Zeichens als SVG: ein Sechseck aus zwei
 * Winkeln, im Farbverlauf von Blaugruen nach Gruen. Die Originaldatei
 * liegt nicht vor - sobald sie kommt, wird dieses SVG ersetzt (eine
 * Stelle, ein Austausch).
 *
 * Bewusst als Zeichnung und nicht als eingebettetes Bild: Die Anwendung
 * soll ohne Netz und ohne weitere Dateien laufen.
 */

import { s } from '../ui.js';

/**
 * @param {number} size Kantenlaenge in Pixel
 */
export function markenzeichen(size = 26) {
  return s('svg', {
    width: String(size), height: String(size), viewBox: '0 0 64 64',
    role: 'img', 'aria-label': 'Hexagon Purus',
  },
  s('defs',
    s('linearGradient', { id: 'hxp', x1: '0', y1: '1', x2: '1', y2: '0' },
      s('stop', { offset: '0', 'stop-color': '#1f9d8f' }),
      s('stop', { offset: '1', 'stop-color': '#5ec85a' }))),
  // Aeusserer Winkel
  s('path', {
    d: 'M32 4 60 20v24L32 60 4 44V20L32 4Z',
    fill: 'none', stroke: 'url(#hxp)', 'stroke-width': '6',
    'stroke-linejoin': 'round',
  }),
  // Innerer Winkel - das Zeichen hat zwei ineinanderliegende Formen
  s('path', {
    d: 'M32 19 46 27v10L32 45 18 37V27L32 19Z',
    fill: 'none', stroke: 'url(#hxp)', 'stroke-width': '4',
    'stroke-linejoin': 'round', opacity: '.75',
  }));
}
