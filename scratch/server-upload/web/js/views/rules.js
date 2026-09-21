/**
 * Regeln der Abteilung.
 *
 * Eingabe als Satz ("Verschraubungen können nach dem Biegen schon gemacht
 * werden"). Die Anwendung uebersetzt den Satz in eine Regel und zeigt sie als
 * Baukasten - dort laesst sie sich nachschaerfen, bevor sie gespeichert wird.
 * Erst danach wirkt sie auf die Planung.
 */

import { h, card, table, fmt, toast, confirmDialog, selectField, checkField, kpi, modal } from '../ui.js';
import { api } from '../api.js';

const BEISPIELE = [
  'Verschraubungen können nach dem Biegen schon gemacht werden',
  'Sägen, Entgraten und Biegen können 8 Wochen vor dem Heften starten, Rohmaterial ist vorhanden',
  'Hydroprüfung nur dienstags bis donnerstags',
  'Am Beizen dürfen höchstens 2 Mitarbeiter gleichzeitig arbeiten',
];

export function render(a) {
  const box = h('div.view');
  const liste = h('div', h('div.empty', 'Regeln werden geladen …'));

  box.append(
    eingabeCard(a),
    a.ui.ruleDraft ? baukastenCard(a) : null,
    card('Regeln', liste, {
      sub: 'Regeln gelten für alle Stände gemeinsam. Ausgeschaltete Regeln wirken nicht.',
      flush: true,
    }));

  loadRules(a, liste);
  return box;
}

/* ------------------------------------------------------------------ *
 * Satz eingeben
 * ------------------------------------------------------------------ */

function eingabeCard(a) {
  let text = a.ui.ruleText ?? '';

  const verstehen = async (value) => {
    const satz = (value ?? text).trim();
    if (!satz) { toast('Bitte die Regel als Satz eintragen.', 'error'); return; }
    a.ui.ruleText = satz;
    const parsed = await api.parseRule(satz);
    if (!parsed.ok) {
      a.ui.ruleDraft = null;
      a.ui.ruleParse = parsed;
      a.render();
      return;
    }
    a.ui.ruleDraft = parsed.rule;
    a.ui.ruleParse = parsed;
    a.render();
  };

  const parse = a.ui.ruleParse;

  return card('Neue Regel',
    h('div',
      h('div.small.muted', { style: { marginBottom: '8px' } },
        'Schreiben Sie die Regel in einem Satz. Die Anwendung übersetzt sie und zeigt sie '
        + 'anschließend als Baukasten – dort können Sie nachschärfen, bevor gespeichert wird.'),
      h('div.field-row',
        h('input.rule__input', {
          type: 'text',
          value: text,
          placeholder: 'z. B. Verschraubungen können nach dem Biegen schon gemacht werden',
          oninput: (e) => { text = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter') verstehen(e.target.value); },
        }),
        h('button.btn.btn--primary', { onclick: () => verstehen() }, 'Regel verstehen')),

      parse && !parse.ok && h('div.note.note--warn', { style: { marginTop: '10px' } },
        h('strong', 'So ist die Regel noch nicht eindeutig: '),
        h('div', parse.issues.join(' ')),
        parse.understood?.length ? h('div.small.muted', parse.understood.join(' · ')) : null,
        h('div.btn-row', { style: { marginTop: '8px' } },
          h('button.btn.btn--sm', {
            onclick: async () => {
              const r = await api.emptyRule('REIHENFOLGE');
              a.ui.ruleDraft = r.rule;
              a.ui.ruleParse = null;
              a.render();
            },
          }, 'Regel von Hand zusammenstellen'))),

      h('div.small.faint', { style: { marginTop: '10px' } }, 'Beispiele zum Anklicken:'),
      h('div.btn-row',
        BEISPIELE.map((b) => h('button.btn.btn--sm.btn--ghost', {
          onclick: () => verstehen(b),
          title: b,
        }, b.length > 46 ? `${b.slice(0, 44)} …` : b)))),
    { sub: 'Die Übersetzung läuft vollständig auf diesem Rechner – ohne Internet.' });
}

/* ------------------------------------------------------------------ *
 * Baukasten
 * ------------------------------------------------------------------ */

function baukastenCard(a) {
  const draft = a.ui.ruleDraft;
  const parse = a.ui.ruleParse;
  const ops = a.state.catalog.operations;
  const set = (patch) => { a.ui.ruleDraft = { ...draft, ...patch }; a.render(); };
  const setParams = (patch) => set({ params: { ...draft.params, ...patch } });
  const setScope = (patch) => set({ scope: { ...draft.scope, ...patch } });

  const opOptions = ops.map((o) => ({ value: o.id, label: o.name }));

  return card('Erkannte Regel – bitte prüfen',
    h('div',
      parse?.understood?.length ? h('div.note.note--info',
        h('strong', 'Verstanden: '), parse.understood.join(' · ')) : null,

      h('div.grid.grid--form',
        selectField('Art der Regel', draft.type, [
          { value: 'REIHENFOLGE', label: 'Reihenfolge – wann darf ein Arbeitsgang beginnen?' },
          { value: 'VORLAUF', label: 'Vorlauf – Arbeitsgänge dürfen früher starten' },
          { value: 'WOCHENTAGE', label: 'Wochentage – nur an bestimmten Tagen' },
          { value: 'GRENZE', label: 'Obergrenze – höchstens so viele Mitarbeiter' },
          { value: 'AUFTRAGSFOLGE', label: 'Auftragsreihenfolge – Auftrag vor Auftrag' },
        ], async (v) => {
          const r = await api.emptyRule(v);
          a.ui.ruleDraft = { ...r.rule, text: draft.text };
          a.render();
        })),

      typeFields(a, draft, opOptions, setParams),

      h('hr.sep'),
      h('div.card__title', 'Für welche Aufträge gilt die Regel?'),
      scopeFields(a, draft, setScope),

      h('div.note', { style: { marginTop: '12px' } },
        h('strong', 'So wird die Regel gespeichert: '),
        h('span', summaryOf(a, draft))),

      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn.btn--primary', {
          onclick: async () => {
            try {
              await api.createRule(draft);
              a.ui.ruleDraft = null;
              a.ui.ruleParse = null;
              a.ui.ruleText = '';
              toast('Regel gespeichert und angewendet.', 'ok');
              await a.recalc();
            } catch { /* Meldung kommt aus der Schnittstelle */ }
          },
        }, 'Regel speichern'),
        h('button.btn', {
          onclick: () => { a.ui.ruleDraft = null; a.ui.ruleParse = null; a.render(); },
        }, 'Verwerfen'))),
    { sub: 'Gespeichert wird erst mit „Regel speichern".' });
}

/** Felder je Regelart. */
function typeFields(a, draft, opOptions, setParams) {
  const p = draft.params ?? {};
  const ops = a.state.catalog.operations;

  if (draft.type === 'REIHENFOLGE') {
    return h('div.grid.grid--form',
      selectField('Dieser Arbeitsgang', p.opId, opOptions, (v) => setParams({ opId: v })),
      selectField('… hängt ab von', p.afterOpId, opOptions, (v) => setParams({ afterOpId: v })),
      selectField('Art der Abhängigkeit', p.mode, [
        { value: 'FS', label: 'erst danach – Vorgänger muss fertig sein' },
        { value: 'OVERLAP', label: 'überlappend – darf schon beginnen' },
        { value: 'PARALLEL', label: 'unabhängig – kann gleichzeitig laufen' },
      ], (v) => setParams({ mode: v })),
      p.mode === 'OVERLAP' && h('label.field',
        h('span', 'Vorsprung des Vorgängers (h)'),
        h('input', {
          type: 'number', min: 0, step: '0.5', value: p.leadHours ?? 0,
          onchange: (e) => setParams({ leadHours: Number(e.target.value) }),
        }),
        h('div.field__hint', 'Wie viele Stunden Arbeit müssen vorher erledigt sein.')));
  }

  if (draft.type === 'VORLAUF') {
    return h('div',
      h('div.small.muted', { style: { marginBottom: '6px' } }, 'Diese Arbeitsgänge dürfen früher beginnen:'),
      h('div.btn-row', ops.map((o) => h('label.inline-check',
        h('input', {
          type: 'checkbox',
          checked: (p.opIds ?? []).includes(o.id),
          onchange: (e) => {
            const list = new Set(p.opIds ?? []);
            if (e.target.checked) list.add(o.id); else list.delete(o.id);
            setParams({ opIds: [...list] });
          },
        }), h('span', o.name)))),
      h('div.grid.grid--form', { style: { marginTop: '10px' } },
        h('label.field', h('span', 'Wie viele Wochen früher?'),
          h('input', {
            type: 'number', min: 0, step: '0.5', value: p.weeks ?? 0,
            onchange: (e) => setParams({ weeks: Number(e.target.value) }),
          })),
        selectField('Gerechnet ab', p.anchor, [
          { value: 'DUE', label: 'Fertigstellungstermin des Auftrags' },
          { value: 'OP', label: 'gedacht als Vorlauf vor einem Arbeitsgang' },
        ], (v) => setParams({ anchor: v })),
        p.anchor === 'OP' && selectField('Vorlauf vor', p.anchorOpId ?? ops[0].id,
          opOptions, (v) => setParams({ anchorOpId: v }))),
      p.anchor === 'OP' && h('div.small.muted',
        'Hinweis: Gerechnet wird der Vorlauf ab dem Fertigstellungstermin des Auftrags – '
        + 'der genannte Arbeitsgang dient nur als Gedankenstütze.'),
      checkField('Material ist für diese Arbeitsgänge vorhanden', !!p.ignoreMaterial,
        (v) => setParams({ ignoreMaterial: v })));
  }

  if (draft.type === 'WOCHENTAGE') {
    return h('div',
      h('div.grid.grid--form',
        selectField('Arbeitsgang', p.opId, opOptions, (v) => setParams({ opId: v }))),
      h('div.small.muted', { style: { margin: '6px 0' } }, 'Nur an diesen Wochentagen möglich:'),
      h('div.btn-row', [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr']].map(([n, label]) => h('label.inline-check',
        h('input', {
          type: 'checkbox',
          checked: (p.weekdays ?? []).includes(n),
          onchange: (e) => {
            const days = new Set(p.weekdays ?? []);
            if (e.target.checked) days.add(n); else days.delete(n);
            setParams({ weekdays: [...days].sort() });
          },
        }), h('span', label)))),
      h('div.small.faint', { style: { marginTop: '6px' } },
        'Wochentagsregeln gelten immer für alle Aufträge – der Arbeitsplatz steht allen gemeinsam zur Verfügung.'));
  }

  if (draft.type === 'GRENZE') {
    return h('div.grid.grid--form',
      selectField('Arbeitsgang', p.opId, opOptions, (v) => setParams({ opId: v })),
      h('label.field', h('span', 'Höchstens so viele Mitarbeiter gleichzeitig'),
        h('input', {
          type: 'number', min: 1, step: 1, value: p.maxWorkers ?? 1,
          onchange: (e) => setParams({ maxWorkers: Number(e.target.value) }),
        })));
  }

  if (draft.type === 'AUFTRAGSFOLGE') {
    const opts = a.analysis.projects.map((x) => ({ value: x.id, label: `${x.orderNo || x.name} (${x.customer || '–'})` }));
    return h('div.grid.grid--form',
      selectField('Dieser Auftrag zuerst', p.beforeProjectId ?? '', [{ value: '', label: '— bitte wählen —' }, ...opts],
        (v) => setParams({ beforeProjectId: v || null })),
      selectField('… und danach', p.afterProjectId ?? '', [{ value: '', label: '— bitte wählen —' }, ...opts],
        (v) => setParams({ afterProjectId: v || null })));
  }

  return h('div.note.note--warn', 'Unbekannte Regelart.');
}

/** Geltungsbereich. */
function scopeFields(a, draft, setScope) {
  const scope = draft.scope ?? { kind: 'ALL' };
  const types = a.state.catalog.projectTypes;
  const variants = a.state.catalog.variants;

  return h('div',
    h('div.btn-row',
      [['ALL', 'Alle Aufträge'], ['TYPE', 'Nach Auftragsart / Variante'], ['PROJECT', 'Einzelne Aufträge']]
        .map(([kind, label]) => h(`button.btn.btn--sm${scope.kind === kind ? '.btn--primary' : ''}`, {
          onclick: () => setScope({ kind }),
        }, label))),

    scope.kind === 'TYPE' && h('div', { style: { marginTop: '10px' } },
      h('div.small.muted', 'Auftragsarten (nichts ausgewählt = alle):'),
      h('div.btn-row', types.map((t) => h('label.inline-check',
        h('input', {
          type: 'checkbox',
          checked: (scope.projectTypes ?? []).includes(t.id),
          onchange: (e) => {
            const list = new Set(scope.projectTypes ?? []);
            if (e.target.checked) list.add(t.id); else list.delete(t.id);
            setScope({ projectTypes: [...list] });
          },
        }), h('span', t.name)))),
      h('div.small.muted', { style: { marginTop: '6px' } }, 'Varianten (nichts ausgewählt = alle):'),
      h('div.btn-row', variants.map((v) => h('label.inline-check',
        h('input', {
          type: 'checkbox',
          checked: (scope.variants ?? []).includes(v.id),
          onchange: (e) => {
            const list = new Set(scope.variants ?? []);
            if (e.target.checked) list.add(v.id); else list.delete(v.id);
            setScope({ variants: [...list] });
          },
        }), h('span', v.name))))),

    scope.kind === 'PROJECT' && h('div', { style: { marginTop: '10px' } },
      h('div.small.muted', 'Aufträge auswählen:'),
      h('div.rule__projects', a.analysis.projects.map((p) => h('label.inline-check',
        h('input', {
          type: 'checkbox',
          checked: (scope.projectIds ?? []).includes(p.id),
          onchange: (e) => {
            const list = new Set(scope.projectIds ?? []);
            if (e.target.checked) list.add(p.id); else list.delete(p.id);
            setScope({ projectIds: [...list] });
          },
        }), h('span', p.orderNo || p.name))))));
}

/** Vorschau des Regelsatzes (lokal zusammengesetzt, ohne Serveraufruf). */
function summaryOf(a, draft) {
  const name = (id) => a.state.catalog.operations.find((o) => o.id === id)?.name ?? id;
  const p = draft.params ?? {};
  const scope = draft.scope?.kind === 'ALL' ? 'für alle Aufträge'
    : draft.scope?.kind === 'TYPE'
      ? `für ${[...(draft.scope.projectTypes ?? []).map((t) => a.state.catalog.projectTypes.find((x) => x.id === t)?.name ?? t),
        ...(draft.scope.variants ?? []).map((v) => a.state.catalog.variants.find((x) => x.id === v)?.name ?? v)].join(', ') || 'alle Aufträge'}`
      : `für ${(draft.scope?.projectIds ?? []).length} ausgewählte Aufträge`;

  switch (draft.type) {
    case 'REIHENFOLGE':
      return `${name(p.opId)} ${p.mode === 'PARALLEL' ? 'ist unabhängig von' : p.mode === 'OVERLAP' ? 'darf beginnen, sobald angefangen wurde mit' : 'beginnt erst nach'} ${name(p.afterOpId)} – ${scope}`;
    case 'VORLAUF':
      return `${(p.opIds ?? []).map(name).join(', ') || '—'} dürfen bis zu ${p.weeks} Wochen früher beginnen${p.ignoreMaterial ? ', Material gilt als vorhanden' : ''} – ${scope}`;
    case 'WOCHENTAGE':
      return `${name(p.opId)} nur ${(p.weekdays ?? []).map((d) => ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr'][d]).join(', ') || '—'} – für alle Aufträge`;
    case 'GRENZE':
      return `höchstens ${p.maxWorkers} Mitarbeiter gleichzeitig an ${name(p.opId)} – ${scope}`;
    case 'AUFTRAGSFOLGE': {
      const no = (id) => a.analysis.projects.find((x) => x.id === id)?.orderNo ?? '—';
      return `Auftrag ${no(p.beforeProjectId)} wird vor ${no(p.afterProjectId)} gefertigt`;
    }
    default: return '';
  }
}

/* ------------------------------------------------------------------ *
 * Liste der Regeln
 * ------------------------------------------------------------------ */

async function loadRules(a, container) {
  try {
    const data = await api.rules(a.scenarioId);
    if (data.rules.length === 0) {
      container.replaceChildren(h('div.empty',
        'Noch keine Regeln. Die Planung rechnet mit der Standard-Arbeitsfolge.'));
      return;
    }
    container.replaceChildren(table([
      {
        key: 'summary',
        label: 'Regel',
        render: (r) => h('div',
          h('div', { style: { fontWeight: 600 } }, r.summary),
          r.text && h('div.small.muted', `„${r.text}"`),
          (r.issues ?? []).map((i) => h(`div.small${i.level === 'FEHLER' ? '' : '.muted'}`,
            { style: i.level === 'FEHLER' ? { color: 'var(--c-red)', fontWeight: 600 } : null },
            `${i.level === 'FEHLER' ? '⚠ ' : ''}${i.text}`))),
      },
      { key: 'createdBy', label: 'von', render: (r) => h('span.mono.small', r.createdBy || '–') },
      {
        key: 'enabled',
        label: 'aktiv',
        render: (r) => h('label.inline-check', h('input', {
          type: 'checkbox',
          checked: r.enabled !== false,
          disabled: r.blocked,
          onchange: async (e) => {
            await api.setRuleEnabled(r.id, e.target.checked);
            await a.recalc(e.target.checked ? 'Regel eingeschaltet' : 'Regel ausgeschaltet');
          },
        })),
      },
      {
        key: 'actions',
        label: '',
        render: (r) => h('div.btn-row',
          h('button.btn.btn--sm', {
            onclick: () => { a.ui.ruleDraft = r; a.ui.ruleParse = null; a.render(); },
          }, 'Ändern'),
          h('button.btn.btn--sm', { onclick: () => showImpact(a, r) }, 'Wirkung'),
          h('button.btn.btn--sm.btn--danger', {
            onclick: async () => {
              const ok = await confirmDialog('Regel löschen?', r.summary, 'Löschen');
              if (!ok) return;
              await api.deleteRule(r.id);
              await a.recalc('Regel gelöscht');
            },
          }, 'Löschen')),
      },
    ], data.rules, { compact: true }));
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Regeln konnten nicht geladen werden.'));
  }
}

/** Wirkung einer Regel: mit und ohne. */
async function showImpact(a, rule) {
  const body = h('div', h('div.empty', 'Wird gerechnet …'));
  modal({ title: 'Wirkung der Regel', body, wide: true, actions: [] });
  try {
    const r = await api.ruleImpact(rule.id, a.scenarioId);
    const delta = Math.round((r.mit.otd - r.ohne.otd) * 10) / 10;
    body.replaceChildren(
      h('div.small.muted', { style: { marginBottom: '10px' } }, r.summary),
      h('div.grid.grid--kpi',
        kpi('Termintreue ohne Regel', fmt.pct(r.ohne.otd, 0), { tone: 'grey' }),
        kpi('Termintreue mit Regel', fmt.pct(r.mit.otd, 0), { tone: delta >= 0 ? 'green' : 'red' }),
        kpi('Zu spät ohne', r.ohne.late, { tone: 'grey' }),
        kpi('Zu spät mit', r.mit.late, { tone: r.mit.late <= r.ohne.late ? 'green' : 'red' })),
      h('div.note', { style: { marginTop: '10px' } },
        delta === 0
          ? 'Die Regel ändert an der Termintreue nichts.'
          : delta > 0
            ? `Die Regel verbessert die Termintreue um ${fmt.num(delta, 1)} Prozentpunkte.`
            : `Die Regel verschlechtert die Termintreue um ${fmt.num(Math.abs(delta), 1)} Prozentpunkte.`));
  } catch {
    body.replaceChildren(h('div.note.note--error', 'Die Wirkung konnte nicht berechnet werden.'));
  }
}
