/**
 * Terminplan als interaktives Gantt (§62/§63).
 */
import { h, card, fmt, statusPill } from '../ui.js';
import { gantt } from '../gantt.js';
import { openProject } from './projects.js';

export function render(a) {
  const an = a.analysis;
  const mode = a.ui.ganttMode;

  const dates = an.projects.flatMap((p) => [p.start, p.releaseDate, p.forecastFinish, p.dueDate]).filter(Boolean);
  const from = dates.length ? dates.reduce((m, d) => (d < m ? d : m), an.planningDate) : an.planningDate;
  const to = dates.length ? dates.reduce((m, d) => (d > m ? d : m), an.planningDate) : an.relevantUntil;

  const chart = gantt({
    projects: an.gantt,
    from: minDate(from, an.planningDate),
    to: addDays(to, 5),
    mode,
    today: an.planningDate,
    expanded: a.ui.ganttExpanded,
    onToggle: (id) => {
      if (a.ui.ganttExpanded.has(id)) a.ui.ganttExpanded.delete(id);
      else a.ui.ganttExpanded.add(id);
      a.render();
    },
    onSelect: (p) => openProject(a, p.id),
  });

  return h('div.view',
    card('Terminplan',
      chart,
      {
        flush: true,
        sub: 'Balken = tatsächlich eingeplante Bearbeitung, Raute = Fertigstellungstermin (Soll), gestrichelte Linie = Planungsstichtag. Projekt aufklappen zeigt die Arbeitsgänge.',
        actions: [
          h('div.seg',
            h('button', { class: mode === 'day' ? 'is-active' : '', onclick: () => { a.ui.ganttMode = 'day'; a.render(); } }, 'Tage'),
            h('button', { class: mode === 'week' ? 'is-active' : '', onclick: () => { a.ui.ganttMode = 'week'; a.render(); } }, 'Wochen')),
          h('button.btn.btn--sm', {
            onclick: () => {
              if (a.ui.ganttExpanded.size) a.ui.ganttExpanded.clear();
              else an.gantt.forEach((p) => a.ui.ganttExpanded.add(p.id));
              a.render();
            },
          }, a.ui.ganttExpanded.size ? 'Alle zuklappen' : 'Alle aufklappen'),
        ],
      }),

    h('div.legend',
      h('span', h('i', { style: { background: '#2e8b57' } }), 'In Time'),
      h('span', h('i', { style: { background: '#c8860d' } }), 'Kritisch'),
      h('span', h('i', { style: { background: '#c0392b' } }), 'Verspätet'),
      h('span', h('i', { style: { background: '#6b4fa8' } }), 'Ohne Termin'),
      h('span', h('i', { style: { background: '#7a8794' } }), 'Fertig')),

    card('Projektübersicht zum Terminplan',
      h('div.table-wrap', h('table.tbl.tbl--compact',
        h('thead', h('tr', ['Auftrag', 'Kunde', 'Projektart', 'Variante', 'Fertigstellung Soll', 'Prognose', 'Abweichung', 'Status']
          .map((t) => h('th', t)))),
        h('tbody', an.gantt.map((p) => h('tr.is-clickable', { onclick: () => openProject(a, p.id) },
          h('td', h('strong', p.orderNo || p.name)),
          h('td', p.customer),
          h('td', typeName(a, p.projectType)),
          h('td', variantName(a, p.variant)),
          h('td', fmt.date(p.dueDate)),
          h('td', p.forecastFinish ? fmt.date(p.forecastFinish) : h('span.faint', 'nicht planbar')),
          h('td', p.lateDays ? h('span', { style: { color: '#c0392b', fontWeight: 600 } }, `+${p.lateDays} Tage`) : h('span.faint', '–')),
          h('td', statusPill(p.status))))))),
      { flush: true }));
}

function typeName(a, id) { return a.state.catalog.projectTypes.find((t) => t.id === id)?.name ?? id; }
function variantName(a, id) { return a.state.catalog.variants.find((t) => t.id === id)?.name ?? '–'; }
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function minDate(a1, b) { return a1 < b ? a1 : b; }
