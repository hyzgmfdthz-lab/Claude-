/**
 * Vergleich mit dem IST-Stand.
 *
 * Der IST-Stand friert die Kapazitaetsseite ein - Besetzung, Schichten,
 * Plaetze, Maschinen, Regeln. Gerechnet wird er mit den HEUTIGEN Auftraegen.
 * Damit beantwortet diese Ansicht genau eine Frage:
 *
 *   Was wuerde aus dem heutigen Auftragsbestand unter den alten Bedingungen -
 *   und was unter den jetzigen?
 *
 * Deshalb steht hier nie "damals waren es andere Auftraege": Beide Seiten
 * rechnen mit demselben Auftragsbestand.
 */

import { h, card, table, fmt, kpi, toast, modal, confirmDialog, statusPill } from '../ui.js';
import { api } from '../api.js';
import { capacityChart } from '../charts.js';
import { openProject } from './projects.js';

export function render(a) {
  const ref = a.reference;
  if (!ref) return h('div.view', leerCard(a));

  return h('div.view',
    kopfCard(a, ref),
    kennzahlenCard(ref),
    unterschiedeCard(ref),
    diagrammCard(a, ref),
    auftragsCard(a, ref));
}

/* ---------------- ohne IST-Stand ---------------- */

function leerCard(a) {
  return card('Noch kein IST-Stand festgelegt',
    h('div',
      h('div.small.muted',
        'Der IST-Stand ist der eingefrorene Ausgangszustand der Kapazitäten: Besetzung, Schichten, '
        + 'Plätze, Maschinen und Regeln. Die Aufträge bleiben immer die aktuellen – dadurch vergleicht '
        + 'die Anwendung nie Äpfel mit Birnen, sondern beantwortet die Frage: '
        + 'Was würde aus dem heutigen Auftragsbestand unter den alten Bedingungen, was unter den jetzigen?'),
      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn.btn--primary', { onclick: () => fixReferenceDialog(a) }, 'Aktuellen Stand als IST-Stand fixieren'),
        h('button.btn', { onclick: () => a.navigate('states') }, 'Gespeicherten Stand wählen'))),
    { sub: 'Einmal fixieren – danach wird jede Änderung dagegen gemessen.' });
}

/* ---------------- Kopf ---------------- */

function kopfCard(a, ref) {
  const besser = ref.delta.totalLateDays < 0;
  return card('Gegen den IST-Stand',
    h('div',
      h('div.grid.grid--kpi',
        kpi('Termintreue', fmt.pct(ref.jetzt.otd, 0), {
          tone: ref.jetzt.otd >= 95 ? 'green' : ref.jetzt.otd >= 75 ? 'amber' : 'red',
          hint: `IST: ${fmt.pct(ref.ist.otd, 0)}`,
          ...delta(ref.delta.otd),
        }),
        kpi('Zu spät', ref.jetzt.late, {
          tone: ref.jetzt.late ? 'red' : 'green',
          hint: `IST: ${ref.ist.late}`,
          ...delta(ref.delta.late, { besser: 'tief' }),
        }),
        kpi('Verspätungstage', fmt.num(ref.jetzt.totalLateDays), {
          tone: besser ? 'green' : 'grey',
          hint: `IST: ${fmt.num(ref.ist.totalLateDays)}`,
          ...delta(ref.delta.totalLateDays, { besser: 'tief' }),
        }),
        kpi('Über Kapazität', fmt.num(ref.jetzt.shortfallHours ?? 0), {
          unit: 'h',
          tone: (ref.jetzt.shortfallHours ?? 0) > 0 ? 'red' : 'green',
          hint: `IST: ${fmt.num(ref.ist.shortfallHours ?? 0)} h`,
          ...delta(ref.delta.shortfallHours, { besser: 'tief' }),
        }),
        kpi('Engste Stelle', ref.jetzt.bottleneck ?? 'keine', {
          tone: 'red', hint: `IST: ${ref.ist.bottleneck ?? 'keine'}`,
        }))),
    {
      sub: `IST-Stand: „${ref.state.name}" · ${fmt.dateTime(ref.state.createdAt)} · ${ref.state.createdBy} · `
        + 'gerechnet mit den heutigen Aufträgen',
      actions: [
        h('button.btn.btn--sm', { onclick: () => fixReferenceDialog(a) }, 'Neu fixieren'),
        h('button.btn.btn--sm', {
          onclick: async () => {
            const ok = await confirmDialog('IST-Stand aufheben?',
              'Der gespeicherte Stand bleibt erhalten, es wird nur nicht mehr dagegen verglichen.', 'Aufheben');
            if (!ok) return;
            await api.setReference(null);
            toast('IST-Stand aufgehoben.', 'ok');
            await a.reload();
          },
        }, 'Aufheben'),
      ],
    });
}

/** Abweichung als Zusatz an der Kennzahl. */
function delta(wert, opts = {}) {
  if (wert == null || Math.abs(wert) < 0.05) return {};
  const besserHoch = opts.besser !== 'tief';
  const gut = besserHoch ? wert > 0 : wert < 0;
  return {
    delta: `${wert > 0 ? '+' : ''}${fmt.num(wert, Math.abs(wert) < 10 ? 1 : 0)} zum IST`,
    deltaTone: gut ? 'up' : 'down',
  };
}

/* ---------------- Kennzahlen ---------------- */

function kennzahlenCard(ref) {
  const zeile = (label, ist, jetzt, opts = {}) => ({ label, ist: ist ?? 0, jetzt: jetzt ?? 0, ...opts });
  const rows = [
    zeile('Aufträge im Termin', ref.ist.inTime + ref.ist.critical, ref.jetzt.inTime + ref.jetzt.critical),
    zeile('Aufträge zu spät', ref.ist.late, ref.jetzt.late, { besser: 'tief' }),
    zeile('Verspätung gesamt', ref.ist.totalLateDays, ref.jetzt.totalLateDays, { einheit: 'Tage', besser: 'tief' }),
    zeile('Termintreue', ref.ist.otd, ref.jetzt.otd, { einheit: '%', digits: 1 }),
    zeile('Kapazität bis zu den Terminen', ref.ist.availableHours, ref.jetzt.availableHours, { einheit: 'h' }),
    zeile('Offener Aufwand', ref.ist.openHours, ref.jetzt.openHours, { einheit: 'h', besser: 'tief' }),
    zeile('Über Kapazität', ref.ist.shortfallHours, ref.jetzt.shortfallHours, { einheit: 'h', besser: 'tief' }),
    zeile('Auslastung Orbital', ref.ist.orbitalUtilization, ref.jetzt.orbitalUtilization, { einheit: '%', digits: 1, besser: 'tief' }),
  ];
  const wert = (r, v) => (r.einheit === '%' ? fmt.pct(v, r.digits ?? 0) : fmt.num(v, r.digits ?? 0));

  return card('Kennzahlen im Vergleich',
    table([
      { key: 'label', label: 'Kennzahl' },
      { key: 'ist', label: 'IST-Stand', num: true, render: (r) => h('span.faint', wert(r, r.ist)) },
      { key: 'jetzt', label: 'aktuell', num: true, render: (r) => h('strong', wert(r, r.jetzt)) },
      {
        key: 'diff',
        label: 'Veränderung',
        num: true,
        render: (r) => {
          const d = r.jetzt - r.ist;
          if (Math.abs(d) < 0.05) return h('span.faint', 'unverändert');
          const gut = r.besser === 'tief' ? d < 0 : d > 0;
          return h('span', { style: { fontWeight: 700, color: gut ? 'var(--c-green)' : 'var(--c-red)' } },
            `${d > 0 ? '+' : ''}${wert(r, d)}`);
        },
      },
    ], rows, { compact: true }),
    { flush: true, sub: 'Beide Seiten rechnen mit denselben, heutigen Aufträgen – nur die Bedingungen unterscheiden sich.' });
}

/* ---------------- Stellschrauben ---------------- */

function unterschiedeCard(ref) {
  const changes = ref.changes ?? [];
  return card(`Was sich geändert hat (${changes.length})`,
    changes.length === 0
      ? h('div.empty', 'Die Stellschrauben entsprechen dem IST-Stand.')
      : table([
        { key: 'label', label: 'Stellschraube', render: (c) => h('strong', c.label) },
        { key: 'ist', label: 'IST-Stand', render: (c) => h('span.faint', c.ist) },
        { key: 'jetzt', label: 'aktuell', render: (c) => h('strong', c.jetzt) },
      ], changes, { compact: true }),
    { flush: true, sub: 'Genau diese Unterschiede erklären die Veränderung der Kennzahlen.' });
}

/* ---------------- Diagramm ---------------- */

function diagrammCard(a, ref) {
  const weeks = a.analysis.weeks;
  const istKapazitaet = new Map((ref.istWeeks ?? []).map((w) => [w.weekKey, w.capacity]));
  return card('Kapazität gegen den IST-Stand',
    h('div',
      capacityChart({
        labels: weeks.map((w) => fmt.week(w.weekKey)),
        sublabels: weeks.map((w) => fmt.dateShort(w.from)),
        demand: weeks.map((w) => w.demand),
        planned: weeks.map((w) => w.planned),
        capacity: weeks.map((w) => w.capacity),
        capacity2: weeks.map((w) => istKapazitaet.get(w.weekKey) ?? 0),
        height: 260,
      }),
      h('div.legend',
        h('span', h('i', { style: { background: '#2a78d6' } }), 'Aufwand'),
        h('span', h('i', { style: { background: '#1baf7a' } }), 'Eingeplant'),
        h('span', h('i', { style: { background: '#1c2430' } }), 'Kapazität jetzt'),
        h('span', h('i', { style: { background: 'var(--c-green)' } }), 'Kapazität im IST-Stand (gestrichelt)'))),
    { flush: true, sub: 'Die gestrichelte Linie ist die Kapazität, die im IST-Stand zur Verfügung stand.' });
}

/* ---------------- Aufträge ---------------- */

function auftragsCard(a, ref) {
  const changes = [...(ref.projectChanges ?? [])].sort((x, y) =>
    ((x.lateDaysAfter ?? 0) - (x.lateDaysBefore ?? 0)) - ((y.lateDaysAfter ?? 0) - (y.lateDaysBefore ?? 0)));
  const besser = changes.filter((c) => (c.lateDaysAfter ?? 0) < (c.lateDaysBefore ?? 0)).length;
  const schlechter = changes.filter((c) => (c.lateDaysAfter ?? 0) > (c.lateDaysBefore ?? 0)).length;

  return card(`Aufträge gegen den IST-Stand (${changes.length})`,
    changes.length === 0
      ? h('div.empty', 'Kein Auftrag hat sich gegenüber dem IST-Stand verändert.')
      : table([
        { key: 'orderNo', label: 'Auftrag', render: (c) => h('strong', c.orderNo ?? c.id) },
        { key: 'from', label: 'IST', render: (c) => (c.from ? statusPill(c.from) : h('span.pill.pill--violet', 'neu')) },
        { key: 'to', label: 'aktuell', render: (c) => statusPill(c.to) },
        { key: 'forecastBefore', label: 'Fertig IST', render: (c) => h('span.faint', fmt.date(c.forecastBefore)) },
        { key: 'forecastAfter', label: 'Fertig aktuell', render: (c) => fmt.date(c.forecastAfter) },
        {
          key: 'tage',
          label: 'Tage',
          num: true,
          render: (c) => {
            const d = (c.lateDaysAfter ?? 0) - (c.lateDaysBefore ?? 0);
            if (d === 0) return h('span.faint', '–');
            return h('span', { style: { fontWeight: 700, color: d < 0 ? 'var(--c-green)' : 'var(--c-red)' } },
              `${d > 0 ? '+' : ''}${fmt.num(d)}`);
          },
        },
      ], changes, { compact: true, onRow: (c) => openProject(a, c.id) }),
    {
      flush: true,
      sub: changes.length === 0 ? '' : `${besser} Aufträge werden früher fertig, ${schlechter} später. Zeile anklicken für Einzelheiten.`,
    });
}

/* ---------------- IST-Stand fixieren ---------------- */

/** Aktuellen Stand speichern und sofort als IST-Stand festlegen. */
export function fixReferenceDialog(a) {
  let name = `IST-Stand ${new Date().toLocaleDateString('de-DE')}`;
  let note = 'Als IST-Stand fixiert – Grundlage für alle Vergleiche.';
  const m = modal({
    title: 'IST-Stand fixieren',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'Der aktuelle Datenbestand wird als Stand gespeichert und sofort als IST-Stand festgelegt. '
        + 'Verglichen wird danach die Kapazitätsseite: Besetzung, Schichten, Plätze, Maschinen und Regeln. '
        + 'Die Aufträge bleiben auf beiden Seiten die heutigen.'),
      h('label.field', h('span', 'Name'),
        h('input', { type: 'text', value: name, oninput: (e) => { name = e.target.value; } })),
      h('label.field', h('span', 'Notiz – worauf bezieht sich der IST-Stand? (Pflicht)'),
        h('input', { type: 'text', value: note, oninput: (e) => { note = e.target.value; } }))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!note.trim()) { toast('Bitte kurz eintragen, worum es bei diesem Stand geht.', 'error'); return; }
          try {
            await api.fixReference({ name, note });
            m.close();
            toast('IST-Stand festgelegt – Änderungen werden jetzt dagegen gemessen.', 'ok');
            await a.reload();
          } catch { /* Meldung kommt aus der Schnittstelle */ }
        },
      }, 'IST-Stand fixieren'),
    ],
  });
}
