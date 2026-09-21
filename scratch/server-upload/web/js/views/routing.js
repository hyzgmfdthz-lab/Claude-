/**
 * Arbeitsfolgen je Projektart / MEGC-Variante (§8/§11).
 */
import { h, card, table, fmt, toast, validateTag, confirmDialog } from '../ui.js';
import { api } from '../api.js';

export function render(a) {
  const templates = a.state.templates;
  const keys = Object.keys(templates);
  const active = a.ui.templateKey && templates[a.ui.templateKey] ? a.ui.templateKey : keys[0];
  const tpl = templates[active];
  const ops = a.state.catalog.operations;

  const usage = a.analysis.projects.filter((p) => p.templateKey === active);

  const save = async (steps, extra = {}) => {
    await api.updateTemplate(active, { steps, ...extra });
    await a.reload();
    toast('Arbeitsfolge gespeichert – alle betroffenen Projekte wurden neu berechnet.', 'ok');
  };

  const totalUnits = tpl.steps.reduce((s0, s1) => s0 + Number(s1.hours || 0), 0);
  const totalMan = tpl.steps.reduce((s0, s1) => {
    const op = ops.find((o) => o.id === s1.opId);
    return s0 + Number(s1.hours || 0) * (op?.manHourFactor ?? 1);
  }, 0);

  return h('div.view',
    h('div.note.note--info',
      h('strong', 'Arbeitsfolge als Abhängigkeitsnetz: '),
      'Jeder Arbeitsgang kann beliebige Vorgänger haben. „Ende–Start“ bedeutet, der Vorgänger muss vollständig fertig sein. ',
      '„Überlappend“ bedeutet, der Nachfolger darf anteilig starten, sobald der Vorgänger den eingestellten Vorsprung erarbeitet hat ',
      '(so laufen Heften und Orbitalschweißen über verschiedene Baugruppen parallel).'),

    card('Arbeitsfolge auswählen',
      h('div.btn-row', keys.map((k) => h(`button.btn${k === active ? '.btn--primary' : ''}`, {
        onclick: () => { a.ui.templateKey = k; a.render(); },
      }, templates[k].label, templates[k].validated === false && h('span', { style: { marginLeft: '5px', opacity: .8 } }, '●')))),
      { sub: '● = Stunden sind noch zu validieren' }),

    card(`${tpl.label}`,
      table([
        { key: 'opId', label: 'Nr.', render: (s0) => h('span.faint', String(tpl.steps.indexOf(s0) + 1)) },
        { key: 'name', label: 'Arbeitsgang', render: (s0) => h('strong', ops.find((o) => o.id === s0.opId)?.name ?? s0.opId) },
        {
          key: 'unit',
          label: 'Einheit',
          render: (s0) => h('span.small.faint', ops.find((o) => o.id === s0.opId)?.unit ?? ''),
        },
        {
          key: 'hours',
          label: 'Stunden',
          num: true,
          render: (s0) => h('input', {
            type: 'number', min: 0, step: '0.5', value: s0.hours, style: { width: '90px' },
            onchange: (e) => {
              const steps = tpl.steps.map((x) => (x.opId === s0.opId ? { ...x, hours: Number(e.target.value) } : x));
              save(steps, { validated: tpl.validated });
            },
          }),
        },
        {
          key: 'man',
          label: 'Mannstunden',
          num: true,
          render: (s0) => {
            const f = ops.find((o) => o.id === s0.opId)?.manHourFactor ?? 1;
            return h('span.small.muted', fmt.h(Number(s0.hours || 0) * f));
          },
        },
        {
          key: 'pred',
          label: 'Vorgänger',
          render: (s0) => h('select', {
            style: { width: '150px' },
            onchange: (e) => {
              const steps = tpl.steps.map((x) => (x.opId === s0.opId
                ? { ...x, predecessors: e.target.value ? [{ ...(x.predecessors?.[0] ?? {}), opId: e.target.value, type: x.predecessors?.[0]?.type ?? 'FS' }] : [] }
                : x));
              save(steps);
            },
          }, [h('option', { value: '' }, '– kein –'),
            ...tpl.steps.filter((x) => x.opId !== s0.opId).map((x) => h('option', {
              value: x.opId, selected: s0.predecessors?.[0]?.opId === x.opId,
            }, ops.find((o) => o.id === x.opId)?.name ?? x.opId))]),
        },
        {
          key: 'type',
          label: 'Art',
          render: (s0) => h('select', {
            style: { width: '130px' }, disabled: !s0.predecessors?.length,
            onchange: (e) => {
              const steps = tpl.steps.map((x) => (x.opId === s0.opId
                ? { ...x, predecessors: (x.predecessors ?? []).map((p) => ({ ...p, type: e.target.value })) } : x));
              save(steps);
            },
          }, [['FS', 'Ende–Start'], ['OVERLAP', 'Überlappend']].map(([v, l]) => h('option', {
            value: v, selected: (s0.predecessors?.[0]?.type ?? 'FS') === v,
          }, l))),
        },
        {
          key: 'lead',
          label: 'Vorsprung (h)',
          num: true,
          render: (s0) => h('input', {
            type: 'number', min: 0, step: '0.5', style: { width: '80px' },
            value: s0.predecessors?.[0]?.leadHours ?? '',
            placeholder: String(a.scenarioCfg.config.tacking.minLeadHours),
            disabled: (s0.predecessors?.[0]?.type ?? 'FS') !== 'OVERLAP',
            onchange: (e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              const steps = tpl.steps.map((x) => (x.opId === s0.opId
                ? { ...x, predecessors: (x.predecessors ?? []).map((p) => ({ ...p, leadHours: v })) } : x));
              save(steps);
            },
          }),
        },
        {
          key: 'gate',
          label: 'Frühester Start (Wochen vor Termin)',
          num: true,
          render: (s0) => h('input', {
            type: 'number', min: 0, step: '0.5', style: { width: '80px' }, placeholder: '–',
            value: s0.earliestStartWeeksBeforeDue ?? '',
            onchange: (e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              save(tpl.steps.map((x) => (x.opId === s0.opId ? { ...x, earliestStartWeeksBeforeDue: v } : x)));
            },
          }),
        },
        {
          key: 'del',
          label: '',
          render: (s0) => h('button.btn.btn--sm.btn--danger', {
            onclick: () => save(tpl.steps.filter((x) => x.opId !== s0.opId)
              .map((x) => ({ ...x, predecessors: (x.predecessors ?? []).filter((p) => p.opId !== s0.opId) }))),
          }, 'Entfernen'),
        },
      ], tpl.steps, {
        compact: true,
        foot: ['', 'Summe', '', fmt.num(totalUnits, 1), fmt.h(totalMan), '', '', '', '', ''],
      }),
      {
        flush: true,
        sub: `${usage.length} Projekte verwenden diese Arbeitsfolge · Gesamt ${fmt.num(totalUnits, 1)} Einheiten = ${fmt.h(totalMan)} Mannstunden`,
        actions: [
          tpl.validated === false && h('span.tag-validate', 'zu validieren'),
          h('select', {
            style: { width: '210px' },
            onchange: async (e) => {
              if (!e.target.value) return;
              const opId = e.target.value;
              const last = tpl.steps[tpl.steps.length - 1];
              await save([...tpl.steps, {
                opId, hours: 0,
                predecessors: last ? [{ opId: last.opId, type: 'FS', leadHours: null }] : [],
                earliestStartWeeksBeforeDue: null, maxWorkers: null,
              }]);
            },
          }, [h('option', { value: '' }, '+ Arbeitsgang ergänzen …'),
            ...ops.filter((o) => !tpl.steps.some((s0) => s0.opId === o.id)).map((o) => h('option', { value: o.id }, o.name))]),
          h('button.btn.btn--sm', {
            onclick: async () => {
              await api.updateTemplate(active, { validated: !(tpl.validated !== false) });
              await a.reload();
            },
          }, tpl.validated === false ? 'Als validiert markieren' : 'Als „zu validieren“ markieren'),
        ],
      }),

    card('Aufträge mit dieser Arbeitsfolge',
      table([
        { key: 'orderNo', label: 'Auftrag' },
        { key: 'customer', label: 'Kunde' },
        { key: 'dueDate', label: 'Fertigstellung', render: (p) => fmt.date(p.dueDate) },
        { key: 'totalManHours', label: 'Gesamtstunden', num: true, render: (p) => fmt.h(p.totalManHours) },
        { key: 'remainingManHours', label: 'Rest', num: true, render: (p) => fmt.h(p.remainingManHours) },
      ], usage, { compact: true, empty: 'Aktuell verwendet kein Auftrag diese Arbeitsfolge.' }),
      { flush: true }),

    card('Alle Arbeitsfolgen zurücksetzen',
      h('div',
        h('div.small.muted', { style: { marginBottom: '8px' } },
          'Setzt sämtliche Arbeitsfolgen auf die Auslieferungswerte zurück. Projektspezifische Stunden bleiben erhalten.'),
        h('button.btn.btn--danger', {
          onclick: async () => {
            const ok = await confirmDialog('Arbeitsfolgen zurücksetzen?',
              'Alle Änderungen an den Arbeitsfolgen gehen verloren. Fortfahren?', 'Zurücksetzen');
            if (!ok) return;
            await api.resetTemplates();
            await a.reload();
            toast('Arbeitsfolgen zurückgesetzt.', 'ok');
          },
        }, 'Zurücksetzen')),
      { sub: 'Vorsicht: nicht umkehrbar' }),

    h('div.small.faint', validateTag(), ' Die Stunden je Arbeitsgang sind Startwerte und müssen fachlich bestätigt werden.'));
}
