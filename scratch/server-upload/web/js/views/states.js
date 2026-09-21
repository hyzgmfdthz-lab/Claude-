/**
 * Staende und Aenderungsprotokoll.
 *
 * Ein "Stand" ist der komplette Datenbestand zu einem Zeitpunkt: Auftraege,
 * Arbeitsfolgen, Parameter, Szenarien. Jeder kann einen Stand speichern
 * (mit Pflichtnotiz) - die Kollegen sehen ihn sofort. Geladen wird ein Stand
 * ausdruecklich; weitergearbeitet wird danach im Arbeitsstand, und beim
 * naechsten Speichern entsteht wieder ein NEUER Stand. Ein gespeicherter
 * Stand wird nie ueberschrieben.
 */

import { h, card, table, fmt, toast, modal, confirmDialog, kpi } from '../ui.js';
import { api, actor } from '../api.js';

export function render(a) {
  const box = h('div.view');
  const liste = h('div', h('div.empty', 'Stände werden geladen …'));
  const protokoll = h('div', h('div.empty', 'Protokoll wird geladen …'));

  const wegKarte = h('div');
  box.append(
    wegKarte,
    saveCard(a),
    card('Gespeicherte Stände', liste, {
      sub: 'Für alle sichtbar. Ein Stand enthält den kompletten Datenbestand – Aufträge, Arbeitsfolgen und Parameter.',
      flush: true,
    }),
    card('Änderungsprotokoll', protokoll, {
      sub: 'Wer hat wann was geändert (die letzten 200 Einträge)',
      flush: true,
    }));

  ladeWeg(a, wegKarte);
  loadStates(a, liste);
  loadLog(protokoll);
  return box;
}

/* ------------------------------------------------------------------ *
 * IST -> heute -> SOLL
 * ------------------------------------------------------------------ */

/**
 * Der Arbeitsweg der Abteilungsleitung, als eine Zeile.
 *
 * "Ist-Stand angeben, Defizite sehen und nach und nach abstellen. Der
 * IST-Stand bleibt unveraendert, ich passe so lange an, bis wir eine
 * akzeptable OTD haben. Ziel ist, den Plan zu haben und als SOLL-Stand
 * festzulegen - der SOLL-Stand wird dann zukuenftig zum IST-Stand."
 */
async function ladeWeg(a, box) {
  let soll = null;
  try { soll = await api.target(a.scenarioId); } catch { soll = null; }
  const ist = a.reference ?? null;
  const jetzt = a.analysis?.kpis ?? null;

  const punkt = (titel, wert, unter, ton) => h(`div.weg__punkt${ton ? `.weg__punkt--${ton}` : ''}`,
    h('div.weg__titel', titel),
    h('div.weg__wert', wert),
    h('div.weg__unter', unter));

  const pfeil = () => h('div.weg__pfeil', '→');

  const teile = [
    punkt('IST-Stand', ist ? fmt.pct(ist.ist?.otd, 0) : 'nicht festgelegt',
      ist ? `„${ist.state?.name}" · ${ist.ist?.late ?? '–'} Aufträge zu spät` : 'Einen Stand als IST festlegen',
      ist ? 'ist' : 'leer'),
    pfeil(),
    punkt('heute', jetzt ? fmt.pct(jetzt.otd, 0) : '–',
      jetzt ? `${jetzt.late} Aufträge zu spät · Stand „${aktuellerName(a)}"` : '', 'jetzt'),
    pfeil(),
    punkt('SOLL-Stand', soll ? fmt.pct(soll.soll?.otd, 0) : 'noch offen',
      soll ? `„${soll.state?.name}" · ${soll.soll?.late ?? '–'} Aufträge zu spät` : 'Wenn die Termintreue passt: festlegen',
      soll ? 'soll' : 'leer'),
  ];

  const knoepfe = h('div.btn-row',
    h('button.btn.btn--sm', {
      title: 'Den heutigen Stand einfrieren – er bleibt unverändert und dient als Vergleichspunkt',
      onclick: () => fixiere(a, 'IST'),
    }, 'Heute als IST-Stand fixieren'),
    h('button.btn.btn--sm.btn--primary', {
      title: 'Den heutigen Stand als Ziel festlegen – darauf wird hingearbeitet',
      onclick: () => fixiere(a, 'SOLL'),
    }, 'Heute als SOLL-Stand festlegen'),
    soll && h('button.btn.btn--sm', {
      title: 'Das Ziel ist erreicht: Der SOLL-Stand wird zum neuen IST-Stand, das Ziel ist wieder offen',
      onclick: () => uebernimmSoll(a, soll),
    }, 'SOLL-Stand zum IST-Stand machen'));

  box.replaceChildren(card('Von wo nach wo',
    h('div',
      h('div.weg', teile),
      soll && h('div.note', { style: { marginTop: '10px' } },
        soll.erreicht
          ? 'Der heutige Stand hält das Ziel bereits ein. Der SOLL-Stand kann zum IST-Stand werden.'
          : `Bis zum Ziel fehlen noch ${abstand(soll)}.`),
      knoepfe),
    {
      sub: 'IST-Stand: woher wir kommen (bleibt unverändert). Heute: woran gerade gearbeitet wird. '
        + 'SOLL-Stand: der Plan, auf den hingearbeitet wird – erreicht, wird er zum neuen IST-Stand.',
    }));
}

function aktuellerName(a) {
  return a.state?.scenarios?.find((s) => s.id === a.scenarioId)?.name ?? '–';
}

function abstand(soll) {
  const teile = [];
  const dOtd = Number(soll.soll?.otd ?? 0) - Number(soll.jetzt?.otd ?? 0);
  const dLate = Number(soll.jetzt?.late ?? 0) - Number(soll.soll?.late ?? 0);
  if (dOtd > 0.5) teile.push(`${fmt.num(dOtd, 1)} Prozentpunkte Termintreue`);
  if (dLate > 0) teile.push(`${dLate} Aufträge`);
  return teile.length ? teile.join(' und ') : 'nur noch Kleinigkeiten';
}

/** @param {any} a @param {'IST'|'SOLL'} art */
async function fixiere(a, art) {
  const istSoll = art === 'SOLL';
  let name = istSoll
    ? `SOLL-Stand ${new Date().toLocaleDateString('de-DE')}`
    : `IST-Stand ${new Date().toLocaleDateString('de-DE')}`;
  let note = '';
  const m = modal({
    title: istSoll ? 'Heutigen Stand als SOLL festlegen' : 'Heutigen Stand als IST fixieren',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        istSoll
          ? 'Der Stand wird gespeichert und als Ziel festgelegt. Alle Kennzahlen zeigen danach '
            + 'zusätzlich den Abstand dorthin. Das Szenario wird zugleich als aktueller Plan markiert.'
          : 'Der Stand wird gespeichert und als Vergleichspunkt festgelegt. Er bleibt unverändert – '
            + 'alle Kennzahlen zeigen danach zusätzlich die Abweichung dazu.'),
      h('label.field', h('span', 'Name'),
        h('input', { type: 'text', value: name, oninput: (e) => { name = e.target.value; } })),
      h('label.field', h('span', 'Notiz (Pflicht)'),
        h('input', {
          type: 'text',
          placeholder: istSoll ? 'z. B. Ziel: 95 % Termintreue mit 5 h Mehrarbeit' : 'z. B. Stand vor den Maßnahmen',
          oninput: (e) => { note = e.target.value; },
        }))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!note.trim()) { toast('Bitte kurz eintragen, worum es geht.', 'error'); return; }
          try {
            if (istSoll) await api.fixTarget({ name, note });
            else await api.fixReference({ name, note });
            m.close();
            await a.reload();
            toast(istSoll ? 'SOLL-Stand festgelegt.' : 'IST-Stand fixiert.', 'ok');
          } catch (err) {
            toast(err?.message ?? 'Das hat nicht geklappt.', 'error');
          }
        },
      }, istSoll ? 'Als SOLL festlegen' : 'Als IST fixieren'),
    ],
  });
}

async function uebernimmSoll(a, soll) {
  const ok = await confirmDialog('SOLL-Stand zum IST-Stand machen?',
    `„${soll.state?.name}" wird ab jetzt der Vergleichspunkt. Das Ziel ist danach wieder offen – `
    + 'jede weitere Änderung misst sich an diesem Stand.'
    + (soll.erreicht ? '' : '\n\nAchtung: Der heutige Stand hält das Ziel noch nicht ein.'),
    'Übernehmen');
  if (!ok) return;
  try {
    await api.promoteTarget();
    await a.reload();
    toast('Der SOLL-Stand ist jetzt der IST-Stand.', 'ok');
  } catch (err) {
    toast(err?.message ?? 'Das hat nicht geklappt.', 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Stand speichern
 * ------------------------------------------------------------------ */

function saveCard(a) {
  let name = `Stand ${new Date().toLocaleDateString('de-DE')}`;
  let note = '';

  const save = async () => {
    if (!note.trim()) { toast('Bitte kurz eintragen, worum es bei diesem Stand geht.', 'error'); return; }
    await api.saveState({ name, note });
    toast('Stand gespeichert – die Kollegen sehen ihn sofort.', 'ok');
    await a.reload();
  };

  return card('Aktuellen Stand speichern',
    h('div',
      h('div.grid.grid--form',
        h('label.field', h('span', 'Name'),
          h('input', { type: 'text', value: name, oninput: (e) => { name = e.target.value; } })),
        h('label.field', h('span', 'Notiz – was wurde gemacht? (Pflicht)'),
          h('input', {
            type: 'text', placeholder: 'z. B. 3 Leiharbeiter ab KW 42 eingeplant',
            oninput: (e) => { note = e.target.value; },
            onkeydown: (e) => { if (e.key === 'Enter') save(); },
          }))),
      h('div.btn-row', h('button.btn.btn--primary', { onclick: save }, '💾 Stand speichern'))),
    { sub: 'Der Stand wird zusätzlich gespeichert; vorhandene Stände bleiben unverändert.' });
}

/* ------------------------------------------------------------------ *
 * Liste der Staende
 * ------------------------------------------------------------------ */

async function loadStates(a, container) {
  try {
    const list = await api.states();
    if (list.length === 0) {
      container.replaceChildren(h('div.empty', 'Noch kein Stand gespeichert.'));
      return;
    }
    container.replaceChildren(table([
      {
        key: 'name',
        label: 'Stand',
        render: (s) => h('div',
          h('strong', s.name),
          s.kind === 'AUTO' && h('span.pill.pill--grey', { style: { marginLeft: '6px' } }, 'automatisch'),
          s.id === a.state?.referenceStateId && h('span.pill.pill--violet', { style: { marginLeft: '6px' } }, 'IST-Stand'),
          s.id === a.state?.targetStateId && h('span.pill.pill--green', { style: { marginLeft: '6px' } }, 'SOLL-Stand'),
          h('div.small.muted', s.note || '–')),
      },
      { key: 'createdBy', label: 'von', render: (s) => h('span.mono', s.createdBy || '–') },
      {
        key: 'createdAt',
        label: 'wann',
        render: (s) => h('div', fmt.dateTime(s.createdAt), h('div.small.faint', fmt.ago(s.createdAt))),
      },
      {
        key: 'meta',
        label: 'Termintreue',
        num: true,
        render: (s) => (s.meta?.otd == null
          ? h('span.faint', '–')
          : h('span', { style: { fontWeight: 600 } }, fmt.pct(s.meta.otd, 0))),
      },
      {
        key: 'late',
        label: 'zu spät',
        num: true,
        render: (s) => (s.meta?.late == null ? h('span.faint', '–') : `${s.meta.late}`),
      },
      {
        key: 'actions',
        label: '',
        render: (s) => h('div.btn-row',
          h('button.btn.btn--sm', { onclick: (e) => { e.stopPropagation(); showState(a, s); } }, 'Ansehen'),
          h('button.btn.btn--sm', { onclick: (e) => { e.stopPropagation(); loadState(a, s); } }, 'Laden'),
          h(`button.btn.btn--sm${s.id === a.state?.referenceStateId ? '.btn--primary' : ''}`, {
            title: 'Alle Kennzahlen zeigen danach zusätzlich die Abweichung zu diesem Stand',
            onclick: async (e) => {
              e.stopPropagation();
              const ist = s.id === a.state?.referenceStateId;
              await api.setReference(ist ? null : s.id);
              toast(ist ? 'IST-Stand aufgehoben.' : `„${s.name}" ist jetzt der IST-Stand.`, 'ok');
              await a.reload();
            },
          }, s.id === a.state?.referenceStateId ? 'IST-Stand aufheben' : 'Als IST-Stand'),
          h(`button.btn.btn--sm${s.id === a.state?.targetStateId ? '.btn--primary' : ''}`, {
            title: 'Das Ziel, auf das hingearbeitet wird – die Kennzahlen zeigen danach den Abstand dorthin',
            onclick: async (e) => {
              e.stopPropagation();
              const soll = s.id === a.state?.targetStateId;
              try {
                await api.setTarget(soll ? null : s.id);
                toast(soll ? 'SOLL-Stand aufgehoben.' : `„${s.name}" ist jetzt der SOLL-Stand.`, 'ok');
                await a.reload();
              } catch (err) {
                toast(err?.message ?? 'Der SOLL-Stand konnte nicht gesetzt werden.', 'error');
              }
            },
          }, s.id === a.state?.targetStateId ? 'SOLL-Stand aufheben' : 'Als SOLL-Stand'),
          s.mayDelete && h('button.btn.btn--sm.btn--danger', {
            onclick: async (e) => {
              e.stopPropagation();
              const ok = await confirmDialog('Stand löschen?',
                `„${s.name}" von ${s.createdBy} wird endgültig gelöscht.`, 'Löschen');
              if (!ok) return;
              await api.deleteState(s.id);
              toast('Stand gelöscht.', 'ok');
              await a.reload();
            },
          }, 'Löschen')),
      },
    ], list, { compact: true }));
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Stände konnten nicht geladen werden.'));
  }
}

/** Stand ansehen, ohne etwas zu verändern. */
async function showState(a, head) {
  const body = h('div', h('div.empty', 'Wird geladen …'));
  const m = modal({ title: `Stand: ${head.name}`, body, wide: true, actions: [] });
  try {
    const s = await api.stateSummary(head.id);
    body.replaceChildren(
      h('div.small.muted', { style: { marginBottom: '10px' } },
        `Gespeichert von ${s.createdBy || '–'} am ${fmt.dateTime(s.createdAt)}`),
      h('div.note.note--info', h('strong', 'Notiz: '), s.note || '–'),
      h('div.grid.grid--kpi', { style: { marginTop: '12px' } },
        kpi('Termintreue', fmt.pct(s.kpis.otd, 0), { tone: s.kpis.otd >= 95 ? 'green' : s.kpis.otd >= 75 ? 'amber' : 'red' }),
        kpi('Zu spät', s.kpis.late, { tone: s.kpis.late ? 'red' : 'green' }),
        kpi('Aufträge', s.projects, { tone: 'grey' }),
        kpi('Offene Stunden', fmt.num(s.kpis.openHours), { unit: 'h', tone: 'grey' })),
      h('div.small.muted', { style: { marginTop: '12px' } },
        'Wichtigste Stellschrauben in diesem Stand:'),
      table([
        { key: 'k', label: 'Wert' },
        { key: 'v', label: '', num: true },
      ], [
        { k: 'Stammmitarbeiter', v: s.config?.workforce?.baseHeadcount ?? '–' },
        { k: 'Leiharbeiter', v: (s.config?.workforce?.tempWorkers ?? []).reduce((x, t) => x + Number(t.count || 0), 0) },
        { k: 'Überstunden je MA/Woche', v: `${s.config?.workforce?.overtimePerEmployeeDefault ?? 0} h` },
        { k: 'Belegungszeit je Tag', v: `${s.config?.resources?.operatingHoursPerDay ?? '–'} h` },
        { k: 'Orbitalschweißer', v: s.config?.resources?.welders?.default ?? '–' },
        { k: 'Heftplätze', v: s.config?.resources?.heftPlaces ?? '–' },
        { k: 'Aufträge gleichzeitig', v: s.config?.projectLimits?.maxParallelProjects ?? '–' },
        { k: 'Produktivität', v: fmt.pct((s.config?.productivity?.global ?? 0) * 100, 0) },
      ], { compact: true }),
      h('div.btn-row', { style: { marginTop: '12px' } },
        h('button.btn.btn--primary', {
          onclick: () => { m.close(); loadState(a, head); },
        }, 'Diesen Stand laden'),
        h('button.btn', { onclick: () => m.close() }, 'Schließen')));
  } catch {
    body.replaceChildren(h('div.note.note--error', 'Der Stand konnte nicht gelesen werden.'));
  }
}

/** Stand in den gemeinsamen Arbeitsstand laden. */
async function loadState(a, head) {
  const ok = await confirmDialog('Stand laden?',
    `„${head.name}" (${head.createdBy || '–'}, ${fmt.dateTime(head.createdAt)}) wird als Arbeitsstand geladen.\n\n`
    + 'Das wirkt für alle Kollegen. Der gespeicherte Stand bleibt unverändert – '
    + 'wenn Sie danach speichern, entsteht ein neuer Stand.\n\n'
    + 'Tipp: Vorher den jetzigen Stand speichern, damit er nicht verloren geht.',
    'Stand laden');
  if (!ok) return;
  await api.loadState(head.id);
  await a.reload();
  toast('Stand geladen.', 'ok');
}

/* ------------------------------------------------------------------ *
 * Aenderungsprotokoll
 * ------------------------------------------------------------------ */

async function loadLog(container) {
  try {
    const list = await api.changeLog(200);
    if (list.length === 0) {
      container.replaceChildren(h('div.empty', 'Noch keine Einträge.'));
      return;
    }
    container.replaceChildren(table([
      { key: 'at', label: 'Zeitpunkt', render: (e) => h('div', fmt.dateTime(e.at), h('div.small.faint', fmt.ago(e.at))) },
      {
        key: 'by',
        label: 'wer',
        render: (e) => h(`span.mono${e.by === actor.name ? '' : '.strong'}`,
          { style: e.by === actor.name ? { color: 'var(--c-text-muted)' } : { fontWeight: 700 } },
          e.by || '–'),
      },
      { key: 'text', label: 'was' },
    ], list, { compact: true }));
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Protokoll konnte nicht geladen werden.'));
  }
}
