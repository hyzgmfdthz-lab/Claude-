/**
 * Belegung – das Gitter.
 *
 * Zeilen sind Arbeitsplätze (umschaltbar auf Mitarbeiter), Spalten sind
 * Tage. Jede Zelle zeigt, wie voll der Platz an diesem Tag ist und welcher
 * Auftrag darin steckt. Rot heißt: Es wartet Arbeit, die an diesem Tag
 * nicht eingeplant werden konnte – das ist der Engpass, nicht die 100 %.
 *
 * Das Gitter ist das Ergebnis der Rechnung. Verschoben wird hier nichts:
 * Eine Handverschiebung wäre eine zweite Wahrheit neben der Rechnung, und
 * die kommt erst, wenn sie gegen die Rechnung geprüft ist.
 */

import { h, card, fmt, panel } from '../ui.js';
import { api } from '../api.js';
import { openProject } from './projects.js';

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Zoomstufen: wie breit ist eine Spalte? */
const ZOOM = {
  TAG: { id: 'TAG', label: 'Tag', days: 28, group: 'day' },
  WOCHE: { id: 'WOCHE', label: 'Woche', days: 91, group: 'week' },
  MONAT: { id: 'MONAT', label: 'Monat', days: 182, group: 'month' },
};

export function render(a) {
  const ui = (a.ui.board ??= { mode: 'WORKPLACE', zoom: 'TAG', from: null, onlyBottleneck: false });
  const box = h('div.view');
  const inhalt = h('div', h('div.empty', 'Belegung wird gerechnet …'));

  box.append(
    kopf(a, ui),
    card('Belegungsgitter', inhalt, {
      flush: true,
      sub: ui.mode === 'PERSON'
        ? 'Wer ist wann wo eingeplant – aus dem Einsatzplan'
        : 'Wie voll ist jeder Arbeitsplatz – aus der Kapazitätsrechnung',
    }));
  lade(a, ui, inhalt);
  return box;
}

/** Bedienleiste über dem Gitter. */
function kopf(a, ui) {
  const zoom = ZOOM[ui.zoom] ?? ZOOM.TAG;
  const von = ui.from ?? a.analysis.planningDate;

  const schiebe = (tage) => {
    ui.from = addDays(von, tage);
    a.render();
  };

  return h('div.card', { style: { marginBottom: '12px' } },
    h('div.card__body', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' } },
      h('div.seg',
        h(`button${ui.mode === 'WORKPLACE' ? '.is-active' : ''}`, {
          onclick: () => { ui.mode = 'WORKPLACE'; a.render(); },
        }, 'Arbeitsplatz'),
        h(`button${ui.mode === 'PERSON' ? '.is-active' : ''}`, {
          onclick: () => { ui.mode = 'PERSON'; a.render(); },
        }, 'Mitarbeiter')),

      h('div.seg', Object.values(ZOOM).map((z) => h(`button${ui.zoom === z.id ? '.is-active' : ''}`, {
        onclick: () => { ui.zoom = z.id; a.render(); },
      }, z.label))),

      h('div.btn-row',
        h('button.btn.btn--sm', { onclick: () => schiebe(-zoom.days) }, '‹ zurück'),
        h('button.btn.btn--sm', {
          onclick: () => { ui.from = null; a.render(); },
        }, 'Stichtag'),
        h('button.btn.btn--sm', { onclick: () => schiebe(zoom.days) }, 'weiter ›')),

      h('label.inline-check', { style: { marginLeft: 'auto' } },
        h('input', {
          type: 'checkbox', checked: !!ui.onlyBottleneck,
          onchange: (e) => { ui.onlyBottleneck = e.target.checked; a.render(); },
        }),
        h('span', 'nur Engpässe zeigen')),

      h('span.small.faint', `ab ${fmt.date(von)} · ${zoom.days} Tage`)));
}

async function lade(a, ui, ziel) {
  const zoom = ZOOM[ui.zoom] ?? ZOOM.TAG;
  const von = ui.from ?? a.analysis.planningDate;
  const bis = addDays(von, zoom.days - 1);
  try {
    const b = await api.belegung(a.scenarioId, { mode: ui.mode, from: von, to: bis });
    if (!b || b.rows.length === 0) {
      ziel.replaceChildren(h('div.empty', ui.mode === 'PERSON'
        ? 'Keine Mannschaft gepflegt – unter „Mannschaft" anlegen.'
        : 'Keine Belegung im gewählten Zeitraum.'));
      return;
    }
    ziel.replaceChildren(gitter(a, ui, b, zoom), legende());
  } catch (e) {
    ziel.replaceChildren(h('div.note.note--error', e?.message || 'Die Belegung konnte nicht gerechnet werden.'));
  }
}

/* ------------------------------------------------------------------ *
 * Das Gitter
 * ------------------------------------------------------------------ */

function gitter(a, ui, b, zoom) {
  const spalten = spaltenBauen(b, zoom.group);
  const zeilen = ui.onlyBottleneck
    ? b.rows.filter((r) => spalten.some((sp) => holen(r, sp).clash))
    : b.rows;

  const kopfWochen = h('tr.board__weeks',
    h('th.board__rowhead', { rowspan: 2 },
      ui.mode === 'PERSON' ? 'Mitarbeiter' : 'Arbeitsplatz'),
    ...gruppenKoepfe(spalten, zoom.group));
  const kopfTage = h('tr.board__days', ...spalten.map((sp) => h('th', { title: sp.title }, sp.short)));

  const alleZeilen = [
    ...zeilen.map((r) => zeile(a, ui, r, spalten)),
    zeile(a, ui, b.total, spalten, true),
  ];

  return h('div.board',
    h('table.board__grid',
      h('thead', kopfWochen, kopfTage),
      h('tbody', ...alleZeilen)));
}

/** Spalten je nach Zoomstufe: Tage, Wochen oder Monate. */
function spaltenBauen(b, group) {
  if (group === 'day') {
    return b.days.map((d) => ({
      key: d.date,
      dates: [d.date],
      short: `${WOCHENTAG[new Date(`${d.date}T00:00:00Z`).getUTCDay()]} ${d.date.slice(8, 10)}`,
      title: fmt.date(d.date),
      group: d.weekKey,
      open: d.open,
    }));
  }
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const d of b.days) {
    const key = group === 'week' ? d.weekKey : d.date.slice(0, 7);
    let sp = map.get(key);
    if (!sp) {
      sp = {
        key,
        dates: [],
        short: group === 'week' ? `KW ${String(key).split('-W')[1]}` : monatKurz(d.date),
        title: group === 'week' ? fmt.week(key) : monatLang(d.date),
        group: group === 'week' ? monatKurz(d.date) : String(d.date.slice(0, 4)),
        open: false,
      };
      map.set(key, sp);
    }
    sp.dates.push(d.date);
    if (d.open) sp.open = true;
  }
  return [...map.values()];
}

/** Obere Kopfzeile: Wochen (bei Tagesspalten) bzw. Monate. */
function gruppenKoepfe(spalten, group) {
  const out = [];
  for (const sp of spalten) {
    const letzte = out[out.length - 1];
    if (letzte && letzte.key === sp.group) { letzte.span++; continue; }
    out.push({ key: sp.group, span: 1 });
  }
  return out.map((g) => h('th', { colspan: g.span },
    group === 'day' ? fmt.week(g.key) : g.key));
}

/** Eine Zeile des Gitters. */
function zeile(a, ui, row, spalten, gesamt = false) {
  const zellen = spalten.map((sp) => {
    const c = holen(row, sp);
    return zelle(a, ui, row, sp, c, gesamt);
  });
  return h('tr', { style: gesamt ? { fontWeight: '600' } : null },
    h('th.board__rowhead',
      h('span.board__rowname', row.label),
      row.meta ? h('span.board__rowmeta', row.meta) : null,
      !gesamt && row.bottleneckDays > 0
        ? h('span.board__rowmeta', { style: { color: 'var(--c-red)' } },
          `${row.bottleneckDays} Tage Engpass`)
        : null,
      !gesamt && row.absentDays > 0
        ? h('span.board__rowmeta', `${row.absentDays} Tage abwesend`)
        : null),
    ...zellen);
}

/** Werte einer Spalte – bei Wochen- und Monatsspalten aufsummiert. */
function holen(row, sp) {
  if (sp.dates.length === 1) {
    return row.cells[sp.dates[0]] ?? { hours: 0, capacity: 0, util: 0, entries: [] };
  }
  let hours = 0;
  let capacity = 0;
  let blocked = 0;
  let clash = false;
  let absent = 0;
  const entries = new Map();
  for (const d of sp.dates) {
    const c = row.cells[d];
    if (!c) continue;
    hours += Number(c.hours ?? 0);
    capacity += Number(c.capacity ?? 0);
    // Groesster Tageswert, nicht die Summe: Ein Auftrag, der fuenf Tage
    // wartet, steht an fuenf Tagen mit seinen Reststunden drin.
    blocked = Math.max(blocked, Number(c.blockedHours ?? 0));
    if (c.clash) clash = true;
    if (c.absent) absent++;
    for (const e of c.entries ?? []) {
      const key = `${e.projectId}|${e.opId ?? ''}`;
      const v = entries.get(key);
      if (v) v.hours += e.hours; else entries.set(key, { ...e });
    }
  }
  return {
    hours: Math.round(hours * 10) / 10,
    capacity: Math.round(capacity * 10) / 10,
    util: capacity > 0 ? (hours / capacity) * 100 : 0,
    /** Groesste Warteschlange an einem Tag dieser Zelle (h) */
    blockedHours: Math.round(blocked * 10) / 10,
    clash,
    absent: absent === sp.dates.length ? 'abwesend' : null,
    entries: [...entries.values()].sort((x, y) => y.hours - x.hours),
  };
}

/** Eine Zelle. */
function zelle(a, ui, row, sp, c, gesamt) {
  const klassen = ['board__cell'];
  if (!sp.open) klassen.push('board__cell--off');
  if (c.clash) klassen.push('board__cell--clash');
  if (sp.dates.includes(a.analysis.planningDate)) klassen.push('board__cell--today');

  const inhalt = [];
  if (c.absent) {
    inhalt.push(h('span.board__block.board__block--absent', { title: c.absent }, c.absent.slice(0, 6)));
  } else if (c.entries.length > 0) {
    const erste = c.entries[0];
    const ton = erste.status === 'VERSPAETET' ? 'bad'
      : erste.status === 'KRITISCH' ? 'warn'
        : erste.status === 'FERTIG' ? 'done' : 'ok';
    inhalt.push(h(`span.board__block.board__block--${ton}`,
      c.entries.length > 1 ? `${kurz(erste.orderNo)} +${c.entries.length - 1}` : kurz(erste.orderNo)));
  } else if (c.capacity > 0 && sp.open) {
    inhalt.push(h('span.board__pct', '–'));
  }

  if (c.capacity > 0) {
    const quote = Math.min(100, Math.round(c.util));
    const ton = c.clash || c.util > 100.5 ? 'bad' : c.util > 90 ? 'warn' : '';
    inhalt.push(h('span.board__load', h(`i${ton ? `.${ton}` : ''}`, { style: { width: `${quote}%` } })));
  }

  return h(`td.${klassen.join('.')}`, {
    title: zellenText(row, sp, c),
    onclick: gesamt ? null : () => zelleOeffnen(a, ui, row, sp, c),
  }, ...inhalt);
}

function zellenText(row, sp, c) {
  const z = [`${row.label} · ${sp.title}`];
  if (c.absent) z.push(c.absent);
  if (c.capacity > 0) z.push(`${fmt.num(c.hours, 1)} von ${fmt.num(c.capacity, 1)} h (${Math.round(c.util)} %)`);
  else if (c.hours > 0) z.push(`${fmt.num(c.hours, 1)} h`);
  else z.push('frei');
  if (c.blockedHours > 0) z.push(`Stau: ${fmt.num(c.blockedHours, 1)} h`);
  for (const e of c.entries.slice(0, 8)) {
    z.push(`• ${e.orderNo}${e.opName ? ` · ${e.opName}` : ''} · ${fmt.num(e.hours, 1)} h`);
  }
  if (c.entries.length > 8) z.push(`… und ${c.entries.length - 8} weitere`);
  return z.join('\n');
}

/** Klick auf eine Zelle: Seitenpanel mit den Aufträgen darin. */
function zelleOeffnen(a, ui, row, sp, c) {
  panel({
    title: `${row.label} · ${sp.title}`,
    sub: c.capacity > 0
      ? `${fmt.num(c.hours, 1)} von ${fmt.num(c.capacity, 1)} h belegt (${Math.round(c.util)} %)`
      : `${fmt.num(c.hours, 1)} h belegt`,
    body: h('div',
      c.blockedHours > 0 && h('div.note.note--warn',
        h('strong', `Stau: ${fmt.num(c.blockedHours, 1)} Stunden. `),
        'Es wartet Arbeit, die hier nicht untergebracht werden konnte – das ist ein Engpass. ',
        h('span.faint', 'In der Wochen- und Monatsansicht steht der stärkste Tag, nicht die Summe: '
          + 'Wer mehrere Tage wartet, würde sonst mehrfach zählen. Wie viele Stunden wirklich '
          + 'fehlen, steht unter Übersicht → Mehraufwand.')),
      c.absent && h('div.note.note--info', c.absent),
      c.entries.length === 0
        ? h('div.empty', 'In dieser Zelle ist nichts eingeplant.')
        : h('div.stack', ...c.entries.map((e) => h('div.card', { style: { marginBottom: '8px' } },
          h('div.card__body', { style: { padding: '10px 12px' } },
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
              h('strong', e.orderNo),
              e.opName ? h('span.small.muted', e.opName) : null,
              h('span.small.faint', { style: { marginLeft: 'auto' } }, `${fmt.num(e.hours, 1)} h`)),
            h('div.btn-row', { style: { marginTop: '7px' } },
              h('button.btn.btn--sm', {
                onclick: () => openProject(a, e.projectId),
              }, 'Auftrag ansehen')))))),
      h('div.small.faint', { style: { marginTop: '10px' } },
        'Die Belegung ist das Ergebnis der Rechnung. Wer sie ändern will, ändert die Stellschrauben, '
        + 'den Termin oder die Reihenfolge – dann rechnet die Anwendung neu.')),
  });
}

function legende() {
  return h('div.board__legend',
    h('span.key', h('i', { style: { background: 'var(--c-green)' } }), 'im Termin'),
    h('span.key', h('i', { style: { background: 'var(--c-amber)' } }), 'kritisch'),
    h('span.key', h('i', { style: { background: 'var(--c-red)' } }), 'zu spät'),
    h('span.key', h('i', { style: { background: 'var(--c-grey)' } }), 'fertig'),
    h('span.key', h('i', { style: { background: 'var(--c-red-bg)', border: '1px solid var(--c-red)' } }),
      'Zelle rot hinterlegt: Arbeit wartet, hier war kein Platz'),
    h('span.key', 'Balken unten: Auslastung dieses Platzes am Tag'));
}

/* ---------------- Hilfen ---------------- */

function kurz(nummer) {
  const s = String(nummer ?? '');
  // WGC40-S00355 -> S00355: die Nummer hinten unterscheidet die Aufträge
  const m = /-(\w+)$/.exec(s);
  return m ? m[1] : s.slice(-6);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monatKurz(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function monatLang(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
