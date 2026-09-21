/**
 * Diagramme (reines SVG, ohne Fremdbibliotheken).
 */
import { h, s, fmt } from './ui.js';

const PAD = { top: 14, right: 16, bottom: 34, left: 54 };

function niceMax(v) {
  if (v <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= mag * f) return mag * f;
  }
  return mag * 10;
}

/**
 * Hauptkapazitaetsdiagramm: Saeulen (Bedarf/Verplant) gegen Kapazitaetskennlinie (§60).
 *
 * @param {{
 *   labels:string[], demand:number[], planned:number[], capacity:number[],
 *   capacity2?:number[], height?:number, barWidth?:number, unit?:string,
 *   onSelect?:(i:number)=>void, sublabels?:string[]
 * }} o
 */
export function capacityChart(o) {
  const n = o.labels.length;
  // Diagrammbreite an den verfuegbaren Platz anpassen
  const avail = (o.availableWidth
    ?? (document.querySelector('.content')?.clientWidth ?? 1200)) - PAD.left - PAD.right - 34;
  const bw = o.barWidth ?? Math.max(15, Math.min(96, Math.floor(avail / Math.max(1, n))));
  const height = o.height ?? 260;
  const width = PAD.left + PAD.right + n * bw;
  const plotH = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(
    ...o.demand, ...o.capacity, ...(o.capacity2 ?? []), ...o.planned, 1,
  ) * 1.05);
  const y = (v) => PAD.top + plotH - (v / max) * plotH;
  const xc = (i) => PAD.left + i * bw + bw / 2;

  const nodes = [];

  // Gitter und Y-Achse
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const v = (max / ticks) * t;
    nodes.push(s('line', { class: 'gridline', x1: PAD.left, x2: width - PAD.right, y1: y(v), y2: y(v) }));
    nodes.push(s('text', { x: PAD.left - 7, y: y(v) + 4, 'text-anchor': 'end' }, fmt.num(v)));
  }

  // Saeulen
  o.labels.forEach((label, i) => {
    const d = o.demand[i] ?? 0;
    const p = o.planned[i] ?? 0;
    const cap = o.capacity[i] ?? 0;
    const over = d > cap + 0.01;
    const w1 = bw * 0.46;
    const w2 = bw * 0.28;
    if (d > 0) {
      nodes.push(s('rect', {
        class: `bar-demand${over ? ' bar-demand--over' : ''}`,
        x: xc(i) - w1 - 1, y: y(d), width: w1, height: Math.max(0, PAD.top + plotH - y(d)), rx: 2,
      }, s('title', {}, `${label}\nBedarf: ${fmt.h(d)}\nKapazität: ${fmt.h(cap)}${over ? `\nÜberlast: ${fmt.h(d - cap)}` : ''}`)));
    }
    if (p > 0) {
      nodes.push(s('rect', {
        class: 'bar-planned', x: xc(i) + 1, y: y(p), width: w2, height: Math.max(0, PAD.top + plotH - y(p)), rx: 2,
      }, s('title', {}, `${label}\nEingeplant: ${fmt.h(p)}\nAuslastung: ${cap > 0 ? Math.round((p / cap) * 100) : 0} %`)));
    }
    nodes.push(s('rect', {
      class: 'hover-target', x: PAD.left + i * bw, y: PAD.top, width: bw, height: plotH,
      onclick: () => o.onSelect?.(i),
    }, s('title', {}, `${label}\nBedarf ${fmt.h(d)} · Kapazität ${fmt.h(cap)} · Eingeplant ${fmt.h(p)}`)));
  });

  // Kapazitaetskennlinie(n) als Treppenlinie
  const stepPath = (values) => {
    let d = '';
    values.forEach((v, i) => {
      const x0 = PAD.left + i * bw;
      const x1 = x0 + bw;
      d += `${i === 0 ? 'M' : 'L'}${x0},${y(v)} L${x1},${y(v)} `;
    });
    return d.trim();
  };
  if (o.capacity2) nodes.push(s('path', { class: 'line-capacity2', d: stepPath(o.capacity2) }));
  nodes.push(s('path', { class: 'line-capacity', d: stepPath(o.capacity) }));

  // X-Achse
  const every = n > 30 ? Math.ceil(n / 26) : 1;
  o.labels.forEach((label, i) => {
    if (i % every !== 0) return;
    nodes.push(s('text', { x: xc(i), y: height - PAD.bottom + 14, 'text-anchor': 'middle' }, label));
    if (o.sublabels?.[i]) {
      nodes.push(s('text', { x: xc(i), y: height - PAD.bottom + 25, 'text-anchor': 'middle', 'font-size': '9.5' }, o.sublabels[i]));
    }
  });
  nodes.push(s('line', { class: 'axis-line', x1: PAD.left, x2: width - PAD.right, y1: y(0), y2: y(0), stroke: '#c4ccd6' }));

  const svg = s('svg', {
    class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height,
    style: 'max-width:100%',
  }, nodes);

  return h('div', { style: { overflowX: 'auto' } }, svg);
}

export function capacityLegend(extra) {
  return h('div.legend',
    h('span', h('i', { style: { background: '#2a78d6' } }), 'Aufwand'),
    h('span', h('i', { style: { background: '#d03b3b' } }), 'Woche mit Überlast'),
    h('span', h('i', { style: { background: '#1baf7a' } }), 'Eingeplant'),
    h('span', h('i', { style: { background: '#1c2430' } }), 'Verfügbare Kapazität'),
    extra);
}

/* ------------------------------------------------------------------ *
 * Auslastungsmatrix (Arbeitsplatz x Kalenderwoche)
 * ------------------------------------------------------------------ */

/** Einfarbige Rampe fuer Auslastung 0-100 %; darueber Statusfarbe. */
const RAMP = ['#eef5fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

/** @param {number} pct */
function rampColor(pct) {
  if (pct <= 0) return null;
  const i = Math.min(RAMP.length - 1, Math.floor((pct / 100) * (RAMP.length - 1)));
  return RAMP[i];
}

/**
 * Auslastung je Arbeitsplatz und Kalenderwoche.
 *
 * Zahlen stehen in jeder Zelle - die Farbe ist nur Unterstuetzung, nie die
 * einzige Information. Werte ueber 100 % werden als Ueberlast hervorgehoben.
 *
 * @param {{rows:any[], weeks:any[], onCell?:(row:any,cell:any)=>void}} o
 */
export function utilizationMatrix(o) {
  const rows = o.rows ?? [];
  const weeks = o.weeks ?? [];
  if (o.mode === 'gesamt') return gesamtTabelle(rows, weeks);

  const head = h('tr',
    h('th.matrix__rowhead', 'Arbeitsplatz'),
    h('th', 'Plätze'),
    weeks.map((w) => h('th', { title: `Woche ab ${fmt.date(w.from)}` }, fmt.week(w.weekKey))),
    h('th', 'Spitze'),
    h('th', {
      title: 'Größte Warteschlange an einem einzelnen Tag des Zeitraums, in Stunden. '
        + 'So viel Arbeit stand am schlimmsten Tag an, ohne gebucht werden zu können.',
    }, 'Stau max h'));

  const keys = new Set(weeks.map((w) => w.weekKey));
  const body = rows.map((row) => {
    const cells = row.cells.filter((c) => keys.has(c.weekKey));
    const peak = cells.length ? Math.max(...cells.map((c) => c.utilization)) : 0;
    // Groesste TAGES-Warteschlange, nicht ihre Summe: Die Summe waere in
    // Stunden mal Tagen und damit keine vorstellbare Groesse.
    const stauMax = Math.max(0, ...cells.map((c) => Number(c.blockedPeak ?? 0)));
    const stauTage = cells.reduce((x, c) => x + Number(c.blockedDays ?? 0), 0);
    return h(`tr${row.isPool ? '.matrix__pool' : ''}`,
      h('td.matrix__rowhead', { title: row.workplaceNames?.join(', ') || row.name }, row.name),
      h('td', { style: { color: 'var(--c-text-muted)' } }, row.places ?? '–'),
      cells.map((c) => {
        const over = c.utilization > 100.5;
        const cls = over ? '.cell--over' : c.utilization <= 0 ? '.cell--empty' : '';
        const bg = over ? null : rampColor(c.utilization);
        const dark = !over && c.utilization > 60;
        return h(`td${cls}`, {
          style: bg ? { background: bg, color: dark ? '#fff' : 'var(--c-text)' } : null,
          title: `${row.name} · ${fmt.weekLong(c.weekKey)}\n`
            + `Belegung ${fmt.num(c.hours)} h von ${fmt.num(c.capacityHours)} h möglich`
            + `${c.days ? ` (an ${c.days} Tagen)` : ''}\n`
            + `Auslastung ${fmt.num(c.utilization)} %${over ? ' – längere Belegung oder mehr Plätze nötig' : ''}`
            + (c.blockedDays > 0
              ? `\nStau an ${c.blockedDays} Tag${c.blockedDays === 1 ? '' : 'en'}, `
                + `am stärksten ${fmt.num(c.blockedPeak, 1)} h${c.blockedCause ? ` (${c.blockedCause})` : ''}`
              : ''),
          onclick: () => o.onCell?.(row, c),
        }, c.utilization > 0 ? Math.round(c.utilization) : '–');
      }),
      h('td', { style: { fontWeight: 700, color: peak > 100.5 ? 'var(--c-red)' : 'var(--c-text-muted)' } },
        Math.round(peak)),
      h('td', {
        style: { fontWeight: 700, color: stauMax > 0 ? 'var(--c-red)' : 'var(--c-text-muted)' },
        title: stauMax > 0
          ? `An ${stauTage} Tagen wartete Arbeit, am stärksten ${fmt.num(stauMax, 1)} h an einem Tag.`
            + `${row.blockedCause ? ` Hauptursache: ${row.blockedCause}` : ''}`
          : 'Hier wartete nie Arbeit.',
      }, stauMax > 0 ? fmt.num(stauMax) : '–'));
  });

  return h('div',
    h('div.scroll-x', h('table.matrix', h('thead', head), h('tbody', body))),
    h('div.matrix__legend', { style: { marginTop: '8px' } },
      h('span', 'wenig'),
      RAMP.slice(1).map((c) => h('i', { style: { background: c } })),
      h('span', '100 %'),
      h('i', { style: { background: '#d03b3b', marginLeft: '8px' } }),
      h('span', 'über 100 % – Überlast'),
      h('span', { style: { marginLeft: '12px' } },
        'Zahlen in Prozent der möglichen Belegungszeit. „Stau max h" = die größte Warteschlange '
        + 'an einem einzelnen Tag.')));
}

/**
 * Gesamtansicht ueber den gewaehlten Zeitraum.
 *
 * Die Wochenmatrix zeigt Spitzen, aber nicht, wie stark ein Arbeitsplatz
 * ueber die ganze Zeit belegt ist - und vor allem nicht, wie viel Arbeit
 * dort liegengeblieben ist. Genau das steht hier.
 */
function gesamtTabelle(rows, weeks) {
  const keys = new Set(weeks.map((w) => w.weekKey));
  const zeilen = rows.map((row) => {
    const cells = row.cells.filter((c) => keys.has(c.weekKey));
    let hours = 0; let capacity = 0; let tage = 0;
    let stauTage = 0; let stauMax = 0;
    for (const c of cells) {
      hours += c.hours; capacity += c.capacityHours; tage += c.days ?? 0;
      stauTage += Number(c.blockedDays ?? 0);
      stauMax = Math.max(stauMax, Number(c.blockedPeak ?? 0));
    }
    return {
      row,
      name: row.name,
      places: row.places,
      hours: Math.round(hours * 10) / 10,
      capacity: Math.round(capacity * 10) / 10,
      utilization: capacity > 0 ? Math.round((hours / capacity) * 1000) / 10 : 0,
      overloadWeeks: cells.filter((c) => c.utilization > 100.5).length,
      /*
       * Zwei getrennte, vorstellbare Groessen statt einer Summe in
       * "Stunden mal Tagen": an wie vielen Tagen hier etwas wartete, und
       * wie gross die Schlange am schlimmsten Tag war.
       */
      stauTage,
      stauMax: Math.round(stauMax * 10) / 10,
      cause: row.blockedCause,
      daysPerWeek: cells.length ? Math.round((tage / cells.length) * 10) / 10 : 0,
    };
  });

  const zelle = (v, tone) => h('td.num', { style: tone ? { fontWeight: 700, color: tone } : null }, v);
  return h('div.table-wrap',
    h('table.tbl.tbl--compact',
      h('thead', h('tr',
        h('th', 'Arbeitsplatz'),
        h('th.num', 'Plätze'),
        h('th.num', { title: 'Tage je Woche, an denen der Arbeitsgang möglich ist' }, 'Tage/KW'),
        h('th.num', 'mögliche h'),
        h('th.num', 'belegte h'),
        h('th.num', 'Auslastung'),
        h('th.num', { title: 'Kalenderwochen über 100 %' }, 'Wochen > 100 %'),
        h('th.num', {
          title: 'An wie vielen Arbeitstagen des Zeitraums wartete hier Arbeit, '
            + 'die nicht gebucht werden konnte?',
        }, 'Stau an Tagen'),
        h('th.num', {
          title: 'Wie groß war die Warteschlange am schlimmsten Tag? In Stunden – '
            + 'das ist die Arbeit, die an diesem einen Tag anstand und nicht durchpasste.',
        }, 'größter Tag h'),
        h('th', 'Hauptursache'))),
      h('tbody', zeilen.map((z) => h(`tr${z.row.isPool ? '.matrix__pool' : ''}`,
        h('td', h('strong', z.name)),
        zelle(z.places ?? '–'),
        zelle(z.daysPerWeek || '–'),
        zelle(fmt.num(z.capacity)),
        zelle(fmt.num(z.hours)),
        zelle(`${fmt.num(z.utilization, 1)} %`, z.utilization > 100.5 ? 'var(--c-red)' : null),
        zelle(z.overloadWeeks || '–', z.overloadWeeks ? 'var(--c-red)' : null),
        zelle(z.stauTage > 0 ? fmt.num(z.stauTage) : '–', z.stauTage > 0 ? 'var(--c-amber)' : null),
        zelle(z.stauMax > 0 ? fmt.num(z.stauMax, 1) : '–', z.stauMax > 0 ? 'var(--c-red)' : null),
        h('td.small', z.cause ?? '–'))))));
}

/**
 * Bedarf gegen Kapazitaet je Arbeitsgang (§53/§61).
 * @param {{name:string, demandManHours:number, capacityManHours:number, plannedManHours:number, unit?:string}[]} rows
 */
export function processChart(rows, opts = {}) {
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.demandManHours, r.capacityManHours)), 1));
  return h('div.stack', rows.map((r) => {
    const over = r.demandManHours > r.capacityManHours + 0.01;
    return h('div', { style: { display: 'grid', gridTemplateColumns: '170px 1fr 140px', gap: '10px', alignItems: 'center' } },
      h('div.small', { style: { fontWeight: 600 } }, r.name),
      h('div', { style: { position: 'relative', height: '22px' } },
        h('div', {
          style: {
            position: 'absolute', left: 0, top: '3px', height: '8px', borderRadius: '4px',
            width: `${(r.capacityManHours / max) * 100}%`, background: '#dfe4ea',
          },
          title: `Kapazität ${fmt.h(r.capacityManHours)}`,
        }),
        h('div', {
          style: {
            position: 'absolute', left: 0, top: '12px', height: '8px', borderRadius: '4px',
            width: `${(r.demandManHours / max) * 100}%`, background: over ? '#c0392b' : '#9fc4d8',
          },
          title: `Bedarf ${fmt.h(r.demandManHours)}`,
        }),
        h('div', {
          style: {
            position: 'absolute', left: `${(r.capacityManHours / max) * 100}%`, top: 0, bottom: 0,
            width: '2px', background: '#1c2430',
          },
        })),
      h('div.small.right', { class: over ? '' : 'muted' },
        `${fmt.h(r.demandManHours)} / ${fmt.h(r.capacityManHours)}`,
        h('br'),
        h('span', { class: over ? 'pill pill--red' : 'pill pill--green', style: { fontSize: '10px' } },
          over ? `Unterdeckung ${fmt.h(r.demandManHours - r.capacityManHours)}` : `frei ${fmt.h(r.capacityManHours - r.demandManHours)}`)));
  }), opts.footer);
}

/**
 * Balkenvergleich fuer Szenarien (§70).
 * @param {{label:string, values:{name:string, value:number}[]}} o
 */
export function compareBars(o) {
  const max = niceMax(Math.max(...o.values.map((v) => Math.abs(v.value)), 1));
  const colors = ['#00727a', '#0f6ecd', '#6b4fa8', '#c8860d', '#2e8b57', '#c0392b'];
  return h('div',
    h('div.small', { style: { fontWeight: 600, marginBottom: '5px' } }, o.label),
    h('div.stack', o.values.map((v, i) => h('div', { style: { display: 'grid', gridTemplateColumns: '150px 1fr 74px', gap: '8px', alignItems: 'center' } },
      h('div.small.muted', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.name),
      h('div', { style: { background: '#eef1f4', borderRadius: '4px', height: '13px', overflow: 'hidden' } },
        h('div', { style: { width: `${(Math.abs(v.value) / max) * 100}%`, height: '100%', background: colors[i % colors.length] } })),
      h('div.small.right', { style: { fontVariantNumeric: 'tabular-nums' } }, fmt.num(v.value, o.digits ?? 0), o.unit ? ` ${o.unit}` : '')))));
}
