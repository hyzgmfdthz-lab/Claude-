/**
 * Projektverwaltung und Projektdetailansicht (§74/§75).
 */
import {
  h, card, table, fmt, statusPill, modal, panel, confirmDialog, toast,
  field, selectField, checkField, bar,
} from '../ui.js';
import { api } from '../api.js';

const TYPE_OPTIONS = (a) => a.state.catalog.projectTypes.map((t) => ({ value: t.id, label: t.name }));

/**
 * Direktbearbeitung in der Liste.
 *
 * Vorgabe der Abteilungsleitung: kleine Felder ohne Dialog aendern. Termin
 * und Prioritaet aendern sich am haeufigsten - alles andere bleibt im
 * Bearbeiten-Dialog, damit man nicht versehentlich eine Arbeitsfolge
 * verstellt.
 */
function terminZelle(a, p) {
  return h('input', {
    type: 'date', value: p.dueDate ?? '', title: 'Fertigstellung Armaturenbau – wirkt sofort',
    style: { width: '132px', fontSize: '12px' },
    onclick: (e) => e.stopPropagation(),
    onchange: async (e) => {
      e.stopPropagation();
      const wert = e.target.value || null;
      await api.updateProject(p.id, { dueDate: wert });
      await a.recalc(wert ? `${p.orderNo}: Fertigstellung ${fmt.date(wert)}` : `${p.orderNo}: Termin entfernt`);
    },
  });
}

function prioZelle(a, p) {
  return h('select', {
    title: 'Priorität – P1 ist die höchste',
    style: { fontSize: '12px', padding: '2px 4px' },
    onclick: (e) => e.stopPropagation(),
    onchange: async (e) => {
      e.stopPropagation();
      await api.updateProject(p.id, { priority: e.target.value });
      await a.recalc(`${p.orderNo}: Priorität ${e.target.value}`);
    },
  }, ['P1', 'P2', 'P3', 'P4'].map((x) => h('option', { value: x, selected: p.priority === x }, x)));
}
const VARIANT_OPTIONS = (a) => [{ value: '', label: '– keine –' }, ...a.state.catalog.variants.map((v) => ({ value: v.id, label: v.name }))];

export function render(a) {
  const an = a.analysis;
  const f = a.ui.projectFilter;
  const byId = new Map(an.projects.map((p) => [p.id, p]));

  let rows = a.state.projects.map((p) => ({ ...p, result: byId.get(p.id) }));
  rows.sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0));
  if (f.text) {
    const t = f.text.toLowerCase();
    rows = rows.filter((p) => `${p.orderNo} ${p.name} ${p.customer}`.toLowerCase().includes(t));
  }
  if (f.status !== 'ALL') rows = rows.filter((p) => p.result?.status === f.status);
  if (f.type !== 'ALL') rows = rows.filter((p) => p.projectType === f.type);

  const move = async (p, dir) => {
    const ids = a.state.projects.slice().sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0)).map((x) => x.id);
    const i = ids.indexOf(p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.reorderProjects(ids);
    await a.reload();
    toast('Fertigungsreihenfolge geändert – Planung wurde neu berechnet.', 'ok');
  };

  return h('div.view',
    h('div.note.note--info',
      h('strong', 'Eine zentrale Projektquelle: '),
      'Alle Ansichten (Gantt, Kapazität, Szenarien) verwenden ausschließlich diese Liste. ',
      'Die Reihenfolge unten ist die manuelle Fertigungsreihenfolge; sie wirkt je nach eingestellter Reihenfolgeregel ',
      `(aktuell: ${ruleName(an.config.sequencing.rule)}).`),

    card('Projekte',
      table([
        {
          key: 'sequence',
          label: '#',
          render: (p) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
            h('span.small.faint', { style: { width: '22px' } }, p.sequence),
            h('button.btn.btn--sm.btn--ghost', { title: 'nach oben', onclick: (e) => { e.stopPropagation(); move(p, -1); } }, '▲'),
            h('button.btn.btn--sm.btn--ghost', { title: 'nach unten', onclick: (e) => { e.stopPropagation(); move(p, 1); } }, '▼')),
        },
        { key: 'orderNo', label: 'Auftrag', render: (p) => h('div', h('strong', p.orderNo || '–'), p.sequenceLocked && h('span.pill.pill--blue', { style: { marginLeft: '5px' } }, 'fix')) },
        { key: 'customer', label: 'Kunde' },
        { key: 'name', label: 'Projekt' },
        { key: 'projectType', label: 'Art', render: (p) => typeLabel(a, p) },
        { key: 'priority', label: 'Prio', render: (p) => prioZelle(a, p) },
        { key: 'dueDate', label: 'Fertigstellung', render: (p) => terminZelle(a, p) },
        { key: 'forecast', label: 'Prognose', render: (p) => (p.result?.forecastFinish ? fmt.date(p.result.forecastFinish) : h('span.faint', 'nicht planbar')) },
        { key: 'late', label: 'Abw.', num: true, render: (p) => (p.result?.lateDays ? h('span', { style: { color: '#c0392b', fontWeight: 600 } }, `+${p.result.lateDays} T`) : (p.result?.slackDays != null ? h('span.faint', `${p.result.slackDays} T Puffer`) : '–')) },
        { key: 'status', label: 'Status', render: (p) => (p.result ? statusPill(p.result.status) : '–') },
        { key: 'hours', label: 'Rest', num: true, render: (p) => fmt.h(p.result?.remainingManHours ?? 0) },
        {
          key: 'progress',
          label: 'Fortschritt %',
          render: (p) => progressCell(a, p),
        },
      ], rows, { onRow: (p) => openProject(a, p.id), empty: 'Keine Aufträge gefunden.' }),
      {
        flush: true,
        sub: `${rows.length} von ${a.state.projects.length} Projekten`,
        actions: [
          h('input', {
            type: 'text', placeholder: 'Suchen …', value: f.text, style: { width: '160px' },
            oninput: (e) => { f.text = e.target.value; a.render(); },
          }),
          h('select', {
            style: { width: '150px' },
            onchange: (e) => { f.status = e.target.value; a.render(); },
          }, [['ALL', 'Alle Status'], ['VERSPAETET', 'Verspätet'], ['KRITISCH', 'Kritisch'], ['IN_TIME', 'In Time'], ['FERTIG', 'Fertig'], ['OHNE_TERMIN', 'Ohne Termin']]
            .map(([v, l]) => h('option', { value: v, selected: f.status === v }, l))),
          h('select', {
            style: { width: '150px' },
            onchange: (e) => { f.type = e.target.value; a.render(); },
          }, [{ value: 'ALL', label: 'Alle Auftragsarten' }, ...TYPE_OPTIONS(a)]
            .map((o) => h('option', { value: o.value, selected: f.type === o.value }, o.label))),
          h('button.btn.btn--primary', { onclick: () => editProject(a, null) }, '+ Neuer Auftrag'),
        ],
      }));
}

/**
 * Fortschritt eines Auftrags - direkt in der Liste änderbar.
 *
 * Die Eingabe in Prozent ist der schnelle Weg für angearbeitete Aufträge.
 * Sind für den Auftrag Reststunden je Arbeitsgang gepflegt, hat das Vorrang;
 * dann steht der Wert nur zur Information da (Änderung über den Dialog).
 */
function progressCell(a, p) {
  const perOp = p.progressMode === 'PER_OPERATION';
  const wert = perOp ? (p.result?.progressPercent ?? 0) : (p.progressPercent ?? 0);

  const speichern = async (value) => {
    const zahl = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    await api.updateProject(p.id, {
      progressMode: zahl > 0 ? 'PERCENT' : (p.progressMode === 'PERCENT' ? 'NONE' : p.progressMode),
      progressPercent: zahl,
    });
    await a.recalc(`Fortschritt ${p.orderNo || p.name}: ${zahl} %`);
  };

  return h('div', {
    style: { minWidth: '130px' },
    onclick: (e) => e.stopPropagation(),
  },
  h('div.field-row', { style: { gap: '6px', alignItems: 'center' } },
    h('div', { style: { flex: '1' } }, bar(p.result?.progressPercent ?? 0)),
    perOp
      ? h('span.small.faint', { title: 'Für diesen Auftrag sind Reststunden je Arbeitsgang gepflegt.' },
        `${wert} % (je AG)`)
      : h('input', {
        type: 'number', min: 0, max: 100, step: 1, value: wert,
        style: { width: '62px' },
        title: 'Gesamtfortschritt in Prozent – direkt änderbar',
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => speichern(e.target.value),
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      })));
}

function ruleName(rule) {
  return {
    PRIORITY_DUE: 'Priorität, dann Termin', MANUAL: 'manuelle Reihenfolge', EDD: 'frühester Termin',
    PRIORITY: 'nur Priorität', SLACK: 'geringster Puffer', CR: 'kritisches Verhältnis',
    SPT: 'kürzeste Arbeit zuerst', LPT: 'längste Arbeit zuerst',
  }[rule] ?? rule;
}

function typeLabel(a, p) {
  const t = a.state.catalog.projectTypes.find((x) => x.id === p.projectType);
  const v = a.state.catalog.variants.find((x) => x.id === p.variant);
  return `${t?.name ?? p.projectType}${v ? ` ${v.name}` : ''}`;
}

/* ------------------------------------------------------------------ *
 * Detailansicht
 * ------------------------------------------------------------------ */

export function openProject(a, id) {
  const an = a.analysis;
  const p = an.projects.find((x) => x.id === id);
  const raw = a.state.projects.find((x) => x.id === id);
  if (!p || !raw) return;
  const rc = an.rootCauses[id];

  const info = (label, value) => h('div', h('div.small.faint', label), h('div', { style: { fontWeight: 600 } }, value));

  /*
   * Das Detail steht jetzt im Seitenpanel rechts und nicht mehr im
   * Fenster in der Bildmitte: Wer einen Auftrag ansieht, soll die Liste
   * oder das Belegungsgitter dahinter weiter sehen.
   */
  const m = panel({
    title: `${p.orderNo || p.name}`,
    sub: `${p.customer || 'ohne Kunde'} · ${typeLabel(a, raw)}`,
    wide: true,
    body: h('div',
      h('div.grid.grid--3', { style: { marginBottom: '14px' } },
        info('Projektart', typeLabel(a, raw)),
        info('Priorität / Reihenfolge', `${p.priority} · Position ${p.sequence}${p.sequenceLocked ? ' (fixiert)' : ''}`),
        info('Fertigstellung (Deadline Armaturenbau)', fmt.date(p.dueDate)),
        info('Prognose laut Kapazitätsrechnung', p.forecastFinish ? fmt.date(p.forecastFinish) : 'im Horizont nicht planbar'),
        info('Status', statusPill(p.status)),
        info('Frühester Arbeitsbeginn', `${fmt.date(p.releaseDate)} (${p.releaseDriver === 'MATERIAL' ? 'Material T-' : 'Startregel T-'}…)`),
        info('Gesamtstunden', fmt.h(p.totalManHours)),
        info('Erledigt / Rest', `${fmt.h(p.doneManHours)} / ${fmt.h(p.remainingManHours)}`),
        info('Fortschritt', `${p.progressPercent} %`),
        info('Fehlteile', p.missingParts
          ? h('span',
            h('span.pill.pill--red', 'Fehlteile'),
            p.missingPartsNote ? h('div.small.muted', p.missingPartsNote) : null,
            p.materialDate ? h('div.small.faint', `Material ab ${fmt.date(p.materialDate)}`) : null)
          : h('span.faint', 'keine gemeldet'))),

      h('div.card',
        h('div.card__head', h('div.card__title', 'Ursachenanalyse')),
        h('div.card__body', h('pre.explain', rc?.text ?? 'Keine Auffälligkeiten.'))),

      h('div.card',
        h('div.card__head', h('div.card__title', 'Arbeitsfolge und geplante Termine')),
        table([
          { key: 'name', label: 'Arbeitsgang' },
          { key: 'unit', label: 'Einheit', render: (o) => h('span.small.faint', o.unit) },
          { key: 'totalUnits', label: 'Soll', num: true, render: (o) => fmt.num(o.totalUnits, 1) },
          { key: 'doneUnits', label: 'Erledigt', num: true, render: (o) => fmt.num(o.doneUnits, 1) },
          { key: 'initialRemainingUnits', label: 'Rest (Start)', num: true, render: (o) => fmt.num(o.initialRemainingUnits, 1) },
          { key: 'plannedManHours', label: 'Mannstunden', num: true, render: (o) => fmt.h(o.plannedManHours) },
          { key: 'start', label: 'Start', render: (o) => (o.start ? fmt.date(o.start) : '–') },
          { key: 'end', label: 'Ende', render: (o) => (o.end ? fmt.date(o.end) : '–') },
          {
            key: 'rest',
            label: 'Offen',
            num: true,
            render: (o) => (o.remainingUnits > 0 ? h('span.pill.pill--red', fmt.num(o.remainingUnits, 1)) : h('span.pill.pill--green', 'fertig')),
          },
        ], p.operations, { compact: true }))),
    actions: [
      h('button.btn.btn--danger', {
        onclick: async () => {
          const ok = await confirmDialog('Auftrag löschen?',
            `Soll das Projekt "${p.orderNo || p.name}" wirklich dauerhaft gelöscht werden?`, 'Löschen');
          if (!ok) return;
          await api.deleteProject(id);
          m.close();
          await a.reload();
          toast('Auftrag gelöscht.', 'ok');
        },
      }, 'Löschen'),
      h('button.btn', {
        onclick: async () => { await api.duplicateProject(id); m.close(); await a.reload(); toast('Auftrag kopiert.', 'ok'); },
      }, 'Duplizieren'),
      h('button.btn.btn--primary', { onclick: () => { m.close(); editProject(a, id); } }, 'Bearbeiten'),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Bearbeiten
 * ------------------------------------------------------------------ */

export function editProject(a, id) {
  const existing = id ? a.state.projects.find((x) => x.id === id) : null;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      orderNo: '', customer: '', name: '', projectType: 'NEUBAU', variant: 'FT40',
      dueDate: null, handoverDate: null, priority: 'P3', sequenceLocked: false,
      progressMode: 'NONE', progressPercent: 0, operations: [], totalHoursOverride: null,
      materialAvailableFrom: null, earliestStart: null, done: false, note: '',
    };

  const opsBox = h('div');
  const renderOps = () => {
    const ops = a.state.catalog.operations;
    const byId = new Map((draft.operations ?? []).map((o) => [o.opId, o]));
    opsBox.replaceChildren(table([
      { key: 'name', label: 'Arbeitsgang' },
      {
        key: 'status',
        label: 'Status',
        render: (op) => h('select', {
          style: { width: '110px' },
          onchange: (e) => setOp(op.id, { status: e.target.value || undefined }),
        }, [['', 'offen'], ['FERTIG', 'Fertig'], ['X', 'x (kein Aufwand)']]
          .map(([v, l]) => h('option', { value: v, selected: (byId.get(op.id)?.status ?? '') === v }, l))),
      },
      {
        key: 'plannedHours',
        label: 'Sollstunden (abweichend)',
        num: true,
        render: (op) => h('input', {
          type: 'number', step: '0.5', min: '0', style: { width: '90px' },
          value: byId.get(op.id)?.plannedHours ?? '',
          onchange: (e) => setOp(op.id, { plannedHours: e.target.value === '' ? undefined : Number(e.target.value) }),
        }),
      },
      {
        key: 'remainingHours',
        label: 'Reststunden',
        num: true,
        render: (op) => h('input', {
          type: 'number', step: '0.5', min: '0', style: { width: '90px' },
          value: byId.get(op.id)?.remainingHours ?? '',
          disabled: draft.progressMode !== 'PER_OPERATION',
          onchange: (e) => setOp(op.id, { remainingHours: e.target.value === '' ? undefined : Number(e.target.value) }),
        }),
      },
    ], ops, { compact: true }));
  };

  const setOp = (opId, patch) => {
    draft.operations ??= [];
    let entry = draft.operations.find((o) => o.opId === opId);
    if (!entry) { entry = { opId }; draft.operations.push(entry); }
    Object.assign(entry, patch);
    for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
    draft.operations = draft.operations.filter((o) => Object.keys(o).length > 1);
  };

  const progressBox = h('div');
  const renderProgress = () => {
    progressBox.replaceChildren(
      draft.progressMode === 'PERCENT'
        ? field('Gesamtfortschritt (%)', draft.progressPercent, (v) => { draft.progressPercent = v ?? 0; }, { type: 'number', min: 0, max: 100 })
        : h('div.small.muted', draft.progressMode === 'PER_OPERATION'
          ? 'Pflegen Sie die Reststunden je Arbeitsgang unten – diese Angabe ist die präzisere Information.'
          : 'Es wird kein Fortschritt berücksichtigt; das Projekt gilt als vollständig offen.'));
  };
  renderProgress();
  renderOps();

  const m = modal({
    title: existing ? `Auftrag bearbeiten – ${existing.orderNo || existing.name}` : 'Neuer Auftrag',
    wide: true,
    body: h('div',
      h('div.grid.grid--form',
        field('Auftragsnummer', draft.orderNo, (v) => { draft.orderNo = v; }, { placeholder: 'z. B. WGC40-S00445' }),
        field('Kunde', draft.customer, (v) => { draft.customer = v; }),
        field('Auftragsbezeichnung', draft.name, (v) => { draft.name = v; }),
        selectField('Projektart', draft.projectType, TYPE_OPTIONS(a), (v) => { draft.projectType = v; }),
        selectField('MEGC-Variante', draft.variant ?? '', VARIANT_OPTIONS(a), (v) => { draft.variant = v || null; }),
        selectField('Priorität', draft.priority, ['P1', 'P2', 'P3', 'P4'].map((p) => ({ value: p, label: p })), (v) => { draft.priority = v; }),
        field('Fertigstellung (Deadline Armaturenbau)', draft.dueDate ?? '', (v) => { draft.dueDate = v || null; }, { type: 'date' }),
        field('„Fertig“ Gesamtanlage (nur Information)', draft.handoverDate ?? '', (v) => { draft.handoverDate = v || null; }, { type: 'date', hint: 'Wird für die Terminbewertung des Armaturenbaus NICHT verwendet.' }),
        checkField('Fehlteile – Material ist nicht vollständig da',
          draft.missingParts === true, (v) => { draft.missingParts = v; },
          { groupLabel: 'Material' }),
        field('Material verfügbar ab', draft.materialAvailableFrom ?? '', (v) => { draft.materialAvailableFrom = v || null; }, {
          type: 'date',
          hint: 'Bei Fehlteilen der erwartete Liefertermin – vorher kann nicht gearbeitet werden. '
            + 'Ohne Angabe: vier Wochen vor Fertigstellung.',
        }),
        field('Was fehlt?', draft.missingPartsNote ?? '', (v) => { draft.missingPartsNote = v; }, {
          hint: 'Freitext – erscheint in der Ursachenliste. Eine Verspätung aus Fehlteilen ist kein Kapazitätsproblem.',
        }),
        field('Gesamtstunden (überschreibt Arbeitsfolge)', draft.totalHoursOverride ?? '', (v) => { draft.totalHoursOverride = v; }, { type: 'number', step: '1', min: 0 }),
        field('Frühester Arbeitsbeginn (optional)', draft.earliestStart ?? '', (v) => { draft.earliestStart = v || null; }, { type: 'date' }),
        selectField('Fortschrittsart', draft.progressMode, [
          { value: 'NONE', label: 'kein Fortschritt' },
          { value: 'PERCENT', label: 'Gesamtfortschritt in %' },
          { value: 'PER_OPERATION', label: 'Reststunden je Arbeitsgang' },
        ], (v) => { draft.progressMode = v; renderProgress(); renderOps(); })),

      progressBox,
      h('div.field-row', { style: { marginBottom: '10px' } },
        checkField('Reihenfolge/Priorität manuell fixieren', draft.sequenceLocked, (v) => { draft.sequenceLocked = v; }),
        checkField('Projekt vollständig fertiggestellt', draft.done, (v) => { draft.done = v; })),
      h('label.field', h('span', 'Bemerkung'), h('textarea', { value: draft.note ?? '', onchange: (e) => { draft.note = e.target.value; } })),

      h('div.card', h('div.card__head', h('div.card__title', 'Arbeitsgänge (projektspezifisch)'),
        h('div.card__sub', 'Leer lassen = Werte aus der Arbeitsfolge der Projektart/Variante')), opsBox)),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!draft.orderNo && !draft.name) { toast('Bitte Auftragsnummer oder Bezeichnung angeben.', 'error'); return; }
          if (existing) await api.updateProject(existing.id, draft);
          else await api.createProject(draft);
          m.close();
          await a.reload();
          toast('Gespeichert – Planung wurde neu berechnet.', 'ok');
        },
      }, 'Speichern und neu berechnen'),
    ],
  });
}
