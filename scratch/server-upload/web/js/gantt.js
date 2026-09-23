/**
 * Interaktives Gantt-Diagramm auf Tages- und Wochenebene (§62/§63).
 */
import { h, s, fmt, statusPill } from './ui.js';

const ROW_H = 26;
const HEAD_H = 34;

const STATUS_COLOR = {
  FERTIG: '#7a8794',
  IN_TIME: '#2e8b57',
  KRITISCH: '#c8860d',
  VERSPAETET: '#c0392b',
  OHNE_TERMIN: '#6b4fa8',
};

const OP_COLOR = {
  SAEGEN: '#4d7ea8', ENTGRATEN: '#5b8fa8', BIEGEN: '#3f8f8c', HEFTEN: '#00727a',
  ORBITAL_KEHLNAHT: '#0f6ecd', ORBITAL_STUMPFNAHT: '#0a4f92', HANDSCHWEISSEN: '#1f9c8f',
  BEIZEN: '#6b4fa8', MOLCHEN: '#b8842e', VORMONTAGE: '#8a6bbf', HYDRO: '#c8860d',
  ENDKONTROLLE: '#2e8b57', REINIGEN: '#7a8794',
};

const MS = 86400000;
const toTs = (iso) => Date.UTC(...iso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
const fromTs = (t) => new Date(t).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((toTs(b) - toTs(a)) / MS);
const weekdayOf = (iso) => { const d = new Date(toTs(iso)).getUTCDay(); return d === 0 ? 7 : d; };

/**
 * @param {{
 *   projects:any[], from:string, to:string, mode:'day'|'week', today:string,
 *   expanded:Set<string>, onToggle:(id:string)=>void, onSelect:(p:any)=>void
 * }} o
 */
export function gantt(o) {
  const mode = o.mode ?? 'day';
  const unit = mode === 'day' ? 20 : 30;
  const totalDays = Math.max(1, dayDiff(o.from, o.to) + 1);
  const cols = mode === 'day' ? totalDays : Math.ceil(totalDays / 7);
  const width = cols * unit;

  const xOf = (iso) => {
    const d = Math.max(0, Math.min(totalDays, dayDiff(o.from, iso)));
    return mode === 'day' ? d * unit : (d / 7) * unit;
  };
  const wOf = (a, b) => Math.max(mode === 'day' ? unit - 3 : 4, xOf(b) + (mode === 'day' ? unit : unit / 7) - xOf(a) - 2);

  /* -------- Kopfzeile -------- */
  const headNodes = [];
  let lastMonth = '';
  for (let i = 0; i < cols; i++) {
    const iso = fromTs(toTs(o.from) + i * (mode === 'day' ? 1 : 7) * MS);
    const x = i * unit;
    const month = iso.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      headNodes.push(s('line', { class: 'g-monthline', x1: x, x2: x, y1: 0, y2: HEAD_H }));
      headNodes.push(s('text', { x: x + 3, y: 12, 'font-size': 10, 'font-weight': 600, fill: '#1c2430' },
        new Date(toTs(iso)).toLocaleDateString('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' })));
    }
    if (mode === 'day') {
      const wd = weekdayOf(iso);
      if (wd >= 6) headNodes.push(s('rect', { class: 'g-weekend', x, y: 14, width: unit, height: HEAD_H - 14 }));
      headNodes.push(s('text', { x: x + unit / 2, y: 25, 'text-anchor': 'middle', 'font-size': 9 }, iso.slice(8)));
      headNodes.push(s('text', { x: x + unit / 2, y: 33, 'text-anchor': 'middle', 'font-size': 8, fill: '#8a97a6' },
        ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][wd]));
    } else {
      const wk = isoWeekNumber(iso);
      headNodes.push(s('text', { x: x + unit / 2, y: 27, 'text-anchor': 'middle', 'font-size': 9.5 }, `${wk}`));
    }
  }

  /* -------- Zeilen -------- */
  const rows = [];
  const labels = [];
  let y = 0;

  for (const p of o.projects) {
    const isOpen = o.expanded.has(p.id);
    labels.push(h('div.gantt__row', { title: `${p.orderNo} ${p.name}` },
      h('span.gantt__toggle', { onclick: (e) => { e.stopPropagation(); o.onToggle(p.id); } }, isOpen ? '▾' : '▸'),
      h('span.gantt__name', { onclick: () => o.onSelect(p), style: { cursor: 'pointer' } },
        h('strong', p.orderNo || p.name), ' ', h('span.faint', p.customer)),
      statusPill(p.status)));

    // Hintergrund
    rows.push(s('rect', { x: 0, y, width, height: ROW_H, fill: y / ROW_H % 2 ? '#fbfcfd' : '#fff' }));

    const start = p.start || p.releaseDate || o.from;
    const end = p.forecastFinish || p.dueDate || start;
    if (start && end) {
      rows.push(s('rect', {
        class: 'g-bar', x: xOf(start), y: y + 5, width: wOf(start, end), height: ROW_H - 12,
        fill: STATUS_COLOR[p.status] ?? '#7a8794', opacity: .92,
        onclick: () => o.onSelect(p), style: 'cursor:pointer',
      }, s('title', {}, `${p.orderNo || p.name}\nStart ${fmt.date(start)}\nPrognose ${fmt.date(p.forecastFinish)}\nSoll ${fmt.date(p.dueDate)}`)));
    }
    // Freigabe/Materialtermin
    if (p.releaseDate && p.start && p.releaseDate < p.start) {
      rows.push(s('rect', {
        x: xOf(p.releaseDate), y: y + ROW_H / 2 - 1, width: Math.max(2, xOf(p.start) - xOf(p.releaseDate)), height: 2,
        fill: '#c4ccd6',
      }, s('title', {}, `Freigegeben ab ${fmt.date(p.releaseDate)} (Material/Startregel)`)));
    }
    // Solltermin als Raute
    if (p.dueDate) {
      const x = xOf(p.dueDate) + (mode === 'day' ? unit / 2 : 0);
      rows.push(s('path', {
        class: 'g-due', d: `M${x},${y + 4} L${x + 5},${y + ROW_H / 2} L${x},${y + ROW_H - 4} L${x - 5},${y + ROW_H / 2} Z`,
      }, s('title', {}, `Fertigstellung (Soll): ${fmt.date(p.dueDate)}`)));
    }
    y += ROW_H;

    if (isOpen) {
      for (const op of p.operations) {
        labels.push(h('div.gantt__row.gantt__row--op',
          h('span.gantt__name', op.name),
          h('span.small.faint', `${fmt.num(op.totalUnits, 1)} ${op.unit === 'Maschinenstunden' ? 'Msh' : 'h'}`)));
        rows.push(s('rect', { x: 0, y, width, height: ROW_H, fill: '#f7f9fb' }));
        if (op.start && op.end) {
          rows.push(s('rect', {
            class: 'g-bar', x: xOf(op.start), y: y + 7, width: wOf(op.start, op.end), height: ROW_H - 15,
            fill: OP_COLOR[op.opId] ?? '#5c6b7d', opacity: .9,
          }, s('title', {}, `${op.name}\n${fmt.date(op.start)} – ${fmt.date(op.end)}\n${fmt.num(op.totalUnits, 1)} ${op.unit}\nEingeplant ${fmt.h(op.plannedManHours)} Mannstunden`)));
        } else {
          rows.push(s('text', { x: 4, y: y + 17, 'font-size': 9.5, fill: '#b6bfc9' }, 'nicht eingeplant'));
        }
        y += ROW_H;
      }
    }
  }

  const height = Math.max(ROW_H, y);

  // Wochenend-/Rasterlinien
  const grid = [];
  for (let i = 0; i <= cols; i++) {
    const x = i * unit;
    if (mode === 'day') {
      const iso = fromTs(toTs(o.from) + i * MS);
      if (weekdayOf(iso) >= 6) grid.push(s('rect', { class: 'g-weekend', x, y: 0, width: unit, height }));
      if (weekdayOf(iso) === 1) grid.push(s('line', { class: 'g-monthline', x1: x, x2: x, y1: 0, y2: height }));
      else grid.push(s('line', { class: 'g-grid', x1: x, x2: x, y1: 0, y2: height }));
    } else {
      grid.push(s('line', { class: 'g-grid', x1: x, x2: x, y1: 0, y2: height }));
    }
  }
  const todayX = xOf(o.today) + (mode === 'day' ? unit / 2 : 0);
  grid.push(s('line', { class: 'g-today', x1: todayX, x2: todayX, y1: 0, y2: height }));

  return h('div.gantt',
    h('div.gantt__labels',
      h('div.gantt__row.gantt__row--head', h('span.gantt__name', 'Projekt / Arbeitsgang')),
      labels),
    h('div.gantt__timeline',
      s('svg', { width, height: HEAD_H, viewBox: `0 0 ${width} ${HEAD_H}`, style: 'display:block' },
        s('rect', { x: 0, y: 0, width, height: HEAD_H, fill: '#f7f9fb' }), headNodes),
      s('svg', { width, height, viewBox: `0 0 ${width} ${height}` }, grid, rows)));
}

function isoWeekNumber(iso) {
  const t = toTs(iso);
  const d = new Date(t);
  const wd = (d.getUTCDay() || 7);
  const thursday = new Date(t + (4 - wd) * MS);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / MS / 7) + 1;
}
