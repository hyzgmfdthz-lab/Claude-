/**
 * Mannschaft und Einsatzplan.
 *
 * Links die Frage "wer kann was", rechts die Frage "wer macht wann was".
 * Beides haengt zusammen: Die Haken in der Qualifikationsmatrix begrenzen
 * die Kapazitaet des Arbeitsganges, und genau nach ihnen wird der
 * Einsatzplan verteilt.
 *
 * Gefuehrt werden nur Kuerzel - keine Klarnamen.
 */

import { h, card, table, fmt, toast, modal, confirmDialog, selectField } from '../ui.js';
import { api } from '../api.js';
// Derselbe Excel-Leser, den auch die Einzeldatei verwendet - keine zweite Kopie.
import { readXlsx, readCsv } from '../../../browser/xlsx.js';

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/**
 * Ein Reiter des Bereichs "Mannschaft".
 *
 * Die Reiter stehen jetzt in der Bereichsleiste oben (eine Ebene statt
 * zwei) - deshalb rendert diese Ansicht nur noch den gewaehlten Inhalt.
 *
 * @param {any} a @param {string} tab
 */
export function renderTab(a, tab) {
  a.ui.teamTab = tab;
  if (tab === 'einsatz') return h('div.view', einsatzplan(a));
  if (tab === 'anwesenheit') return h('div.view', anwesenheit(a));
  if (tab === 'urlaub') return h('div.view', urlaubEinlesen(a));
  if (tab === 'aushang') return h('div.view', aushang(a));
  return h('div.view', mannschaft(a));
}

/* ------------------------------------------------------------------ *
 * Mannschaft: Kuerzel, Qualifikationen, Abwesenheiten
 * ------------------------------------------------------------------ */

function mannschaft(a) {
  const box = h('div');
  const inhalt = h('div', h('div.empty', 'Mannschaft wird geladen …'));
  const wer = h('div');
  ladeWerZaehlt(a, wer);
  box.append(wer, grundlagen(a), card('Wer darf was?', inhalt, {
    sub: 'Ein Haken heißt: Diese Person kann den Arbeitsgang übernehmen. Ohne Haken zählt sie dort nicht mit.',
    flush: true,
    actions: [h('button.btn.btn--sm', { onclick: () => personDialog(a, null) }, '+ Kürzel')],
  }));
  ladeMannschaft(a, inhalt);
  return box;
}

/**
 * Wer geht heute wirklich in die Rechnung ein - mit Kuerzeln.
 *
 * Rueckfrage aus der Abteilung: "Warum wird immer automatisch Personal
 * geplant, das nicht in der Mannschaftsliste ist?" Solange dort nur eine
 * Summe stand, war das nicht nachpruefbar. Jetzt stehen die Namen da, die
 * Herkunft daneben - und ein Schalter, der alles ausser der Stammmannschaft
 * abschaltet.
 */
async function ladeWerZaehlt(a, box) {
  let t;
  try { t = await api.team(a.scenarioId); } catch { return; }
  const g = t.gerechnet;
  if (!g) return;

  if (g.source !== 'MANNSCHAFT') {
    box.replaceChildren(card('Wer wird gerechnet?',
      h('div.note.note--warn',
        h('strong', 'Nicht die Mannschaftsliste. '),
        'Grundlage sind derzeit die Wochenwerte aus der alten Excel-Planung. '
        + 'Unten auf „Mannschaftsliste" umstellen, damit diese Liste zählt.')));
    return;
  }

  const stamm = g.personen.filter((p) => p.kind === 'STAMM');
  /*
   * Wichtig: Nicht nur wer HEUTE zaehlt, sondern wer ueberhaupt hinterlegt
   * ist. Die zugesagten Leiharbeiter treten erst nach dem Stichtag ein -
   * am Stichtag stand deshalb "niemand eingeplant", obwohl die Anwendung
   * ab der naechsten Woche mit ihnen rechnet. Genau das war die Frage.
   */
  const leiheGeplant = (t.people ?? []).filter((p) => p.kind !== 'STAMM'
    && (p.startDate || Object.values(p.weeks ?? {}).some(Boolean)));
  const leiheHeute = g.personen.filter((p) => p.kind !== 'STAMM');
  const erstEintritt = leiheGeplant.map((p) => p.startDate).filter(Boolean).sort()[0] ?? null;
  const frei = (t.people ?? []).filter((p) => p.kind !== 'STAMM'
    && !p.startDate && !Object.values(p.weeks ?? {}).some(Boolean));

  const zugesagteIds = g.zugesagt ?? [];
  const zugesagte = leiheGeplant.filter((p) => zugesagteIds.includes(p.id));
  const selbst = leiheGeplant.filter((p) => !zugesagteIds.includes(p.id));

  const nennen = (liste) => liste.map((p) => p.id + (p.label ? ` (${p.label})` : '')).join(', ');
  const mitEintritt = (liste) => liste
    .map((p) => `${p.id}${p.startDate ? ` ab ${fmt.date(p.startDate)}` : ''}`).join(', ');

  return box.replaceChildren(card('Wer wird gerechnet?',
    h('div',
      h('div.weg',
        h('div.weg__punkt.weg__punkt--jetzt',
          h('div.weg__titel', `am ${fmt.date(g.date)} gerechnet`),
          // Hier stand einmal die Summe aus Liste UND Zahlenlisten. Seit
          // die Zahlenlisten nicht mehr zaehlen, waere das eine Zahl, die
          // in der Rechnung nirgends auftaucht.
          h('div.weg__wert', `${fmt.num(g.factor, 1)} MA`),
          h('div.weg__unter', 'alle aus dieser Liste')),
        h('div.weg__punkt',
          h('div.weg__titel', 'Stammmannschaft'),
          h('div.weg__wert', `${fmt.num(g.stamm, 1)} MA`),
          h('div.weg__unter', stamm.length ? nennen(stamm) : 'niemand')),
        h(`div.weg__punkt${leiheGeplant.length ? '' : '.weg__punkt--leer'}`,
          h('div.weg__titel', 'Leiharbeiter / neu'),
          h('div.weg__wert', `${fmt.num(g.leihe, 1)} MA heute`),
          h('div.weg__unter', leiheGeplant.length
            ? `${leiheGeplant.length} hinterlegt${erstEintritt && g.leihe === 0 ? `, erster Eintritt ${fmt.date(erstEintritt)}` : ''}: `
              + mitEintritt(leiheGeplant)
            : 'niemand eingeplant'))),

      // Die Meldung, die die Abteilungsleitung ausdruecklich haben wollte:
      // nicht heimlich Koepfe dazurechnen, sondern sagen, dass welche
      // fehlen - und das Eintragen gleich daneben anbieten.
      personalMeldung(a, t),

      g.zusatz.summe > 0 && h('div.note.note--warn', { style: { marginTop: '10px' } },
        h('strong', `${g.zusatz.summe} Personen stehen noch in den alten Zahlenlisten. `),
        `(${g.zusatz.temp} Leiharbeiter, ${g.zusatz.hire} Neueinstellungen unter Parameter → Personal.) `
        + 'Sie haben kein Kürzel und gehen NICHT in die Rechnung ein. ',
        h('button.btn.btn--sm', {
          style: { marginLeft: '6px' },
          onclick: () => a.navigate('einstellungen/parameter'),
        }, 'Dort ansehen')),

      leiheGeplant.length > 0 && h('div.note.note--warn', { style: { marginTop: '10px' } },
        h('strong', `${leiheGeplant.length} Leiharbeiter sind hinterlegt und zählen ab ihrem Eintritt `
          + 'automatisch mit: '),
        mitEintritt(leiheGeplant),
        /*
         * Die Herkunft muss stimmen: Die fuenf zugesagten stammen aus der
         * Auskunft vom 15.09.2026, alles darueber hinaus hat jemand selbst
         * eingeplant. Ein pauschales "nicht von dir" waere falsch, sobald
         * ueber die Meldung Leute dazugekommen sind.
         */
        zugesagte.length > 0
          ? h('span', `. Davon ${zugesagte.length} aus der Auskunft vom 15.09.2026 `
            + '(„heute 2 Leiharbeiter, Montag noch einer, am 01.10. die nächsten 2") – '
            + `${nennen(zugesagte)}. `)
          : h('span', '. '),
        selbst.length > 0
          ? h('span', `${selbst.length} weitere sind hier eingeplant worden: ${nennen(selbst)}. `)
          : null,
        leiheHeute.length === 0 && erstEintritt
          ? h('span', `Am ${fmt.date(g.date)} zählt noch keiner von ihnen; ab ${fmt.date(erstEintritt)} schon. `)
          : null,
        h('button.btn.btn--sm', {
          style: { marginLeft: '6px' },
          onclick: () => nurStamm(a, t),
        }, 'Nur mit der Stammmannschaft rechnen')),

      frei.length > 0 && h('div.small.faint', { style: { marginTop: '8px' } },
        `${frei.length} weitere Leiharbeiterplätze sind als leere Zeilen angelegt (${nennen(frei)}). `
        + 'Sie zählen nicht mit, solange kein Eintritt und keine Woche gesetzt ist – '
        + 'in der Liste unten sind sie deshalb ausgeblendet.')),
  {
    sub: 'Nur wer hier steht, geht in die Rechnung ein. Die Liste unten ist die Quelle – '
      + 'geändert wird ausschließlich dort.',
  }));
}

/**
 * Meldung: Es fehlt Personal.
 *
 * Vorgabe der Abteilungsleitung (17.09.2026): "Wenn zusaetzliches Personal
 * dazu kommen muss, moechte ich eine Meldung bekommen und das rein ueber
 * den Reiter Mannschaft anpassen." Die Zahl kommt aus der
 * Plausibilitaetspruefung (Befund PERSONAL_FEHLT), eingetragen wird direkt
 * hier.
 */
function personalMeldung(a, t) {
  const items = a.analysis?.plausibility?.items ?? [];
  /*
   * Zwei Lagen, zwei Meldungen. Der Unterschied ist der, den die
   * Abteilungsleitung am 18.09.2026 zu Recht eingefordert hat: Solange die
   * Leute nicht ausgelastet werden koennen, ist "es fehlt Personal" falsch
   * und ein Knopf "14 Leiharbeiter einplanen" schlicht Unsinn.
   */
  const ohnePlatz = items.find((i) => i.code === 'MANNSCHAFT_NICHT_AUSLASTBAR' && !i.acknowledged);
  if (ohnePlatz) {
    return h('div.note.note--warn', { style: { marginTop: '10px' } },
      h('strong', 'Mehr Personal hilft hier nicht. '),
      ohnePlatz.text,
      h('div.small', { style: { marginTop: '4px' } },
        'Deshalb wird hier auch nicht angeboten, Leute einzuplanen – sie würden nur danebenstehen.'),
      h('div.btn-row', { style: { marginTop: '8px' } },
        h('button.btn.btn--sm.btn--primary', {
          onclick: () => a.navigate('uebersicht/mehraufwand'),
        }, 'Was wirklich hilft'),
        h('button.btn.btn--sm', {
          onclick: () => a.navigate('mannschaft/einsatz'),
        }, 'Wer steht ohne Platz da?')));
  }

  const befund = items.find((i) => i.code === 'PERSONAL_FEHLT' && !i.acknowledged);
  if (!befund) return null;
  const koepfe = Number(befund.value?.koepfe ?? 0);
  const anzahl = Math.max(1, Math.ceil(koepfe));
  return h('div.note.note--error', { style: { marginTop: '10px' } },
    h('strong', 'Es fehlt Personal. '),
    befund.text,
    h('div.small', { style: { marginTop: '4px' } },
      'Die Anwendung rechnet dafür nichts von selbst dazu – eingetragen wird hier, in dieser Liste. '
      + `Die ${formatZahl(koepfe)} sind der Bedarf bis zur engsten Woche, nicht die Zahl der Leute, `
      + 'die dauerhaft fehlen.'),
    h('div.btn-row', { style: { marginTop: '8px' } },
      h('button.btn.btn--sm.btn--primary', {
        onclick: () => leihEintragen(a, t, anzahl),
      }, `${anzahl} Leiharbeiter einplanen`),
      h('button.btn.btn--sm', {
        onclick: () => a.navigate('uebersicht/mehraufwand'),
      }, 'Erst durchrechnen, was es bringt')));
}

/** Kopfzahlen unter 10 mit einer Stelle - "1,7" ist eine Aussage, "2" rundet auf. */
function formatZahl(n) {
  return n < 10 ? String(Math.round(n * 10) / 10).replace('.', ',') : String(Math.round(n));
}

/** Leiharbeiter in der Mannschaft einplanen - Anzahl und Eintritt. */
function leihEintragen(a, t, vorschlag) {
  let anzahl = vorschlag;
  let ab = a.analysis?.planningDate ?? '';
  const frei = t.people.filter((p) => p.kind !== 'STAMM'
    && !p.startDate && !Object.values(p.weeks ?? {}).some(Boolean));
  const m = modal({
    title: 'Leiharbeiter einplanen',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        `Es sind ${frei.length} freie Leiharbeiterplätze angelegt. Für jede Person wird einer davon `
        + 'mit Eintrittsdatum belegt; reichen sie nicht, kommen weitere Kürzel dazu. '
        + 'Einarbeitung (40/60/80 %) und Betreuungsaufwand rechnet die Anwendung automatisch mit.'),
      h('label.field', h('span', 'Wie viele Personen?'),
        h('input', {
          type: 'number', min: 1, max: 30, value: anzahl,
          oninput: (e) => { anzahl = Math.max(1, Number(e.target.value) || 1); },
        })),
      h('label.field', h('span', 'Eintritt'),
        h('input', { type: 'date', value: ab, onchange: (e) => { ab = e.target.value; } }))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!ab) { toast('Bitte ein Eintrittsdatum angeben.', 'error'); return; }
          const people = t.people.map((p) => ({ ...p }));
          let offen = anzahl;
          for (const p of people) {
            if (offen === 0) break;
            if (p.kind === 'STAMM') continue;
            if (p.startDate || Object.values(p.weeks ?? {}).some(Boolean)) continue;
            p.startDate = ab;
            p.defaultActive = true;
            offen -= 1;
          }
          let nummer = people.length + 1;
          while (offen > 0) {
            const id = `LEIHE-${String(nummer).padStart(2, '0')}`;
            nummer += 1;
            if (people.some((p) => p.id === id)) continue;
            people.push({
              id, label: `Leiharbeiter ${nummer - 1}`, role: '', kind: 'LEIHE', factor: 1, rate: 55,
              shiftCapable: true, skills: {}, absences: [], weeks: {},
              startDate: ab, endDate: null, defaultActive: true, active: true, note: '',
            });
            offen -= 1;
          }
          try {
            await a.patchConfig({ workforce: { team: { people } } },
              `${anzahl} Leiharbeiter ab ${fmt.date(ab)} eingeplant`);
            m.close();
          } catch (err) {
            toast(err?.message ?? 'Das hat nicht geklappt.', 'error');
          }
        },
      }, 'Einplanen'),
    ],
  });
}

/** Schaltet jede Person ab, die nicht zur Stammmannschaft gehört. */
async function nurStamm(a, t) {
  const betroffen = t.people.filter((p) => p.kind !== 'STAMM'
    && (p.defaultActive !== false || p.startDate || Object.values(p.weeks ?? {}).some(Boolean)));
  if (betroffen.length === 0) { toast('Es ist niemand außer der Stammmannschaft eingeplant.', ''); return; }
  const ok = await confirmDialog('Nur mit der Stammmannschaft rechnen?',
    `${betroffen.length} Leiharbeiter/neue Kräfte werden ausgeplant: ${betroffen.map((p) => p.id).join(', ')}.\n\n`
    + 'Eintritt und angehakte Wochen werden dabei entfernt. Einzeln lässt sich das jederzeit '
    + 'wieder setzen.', 'Ausplanen');
  if (!ok) return;
  const people = t.people.map((p) => (p.kind === 'STAMM' ? { ...p } : {
    ...p, defaultActive: false, startDate: null, weeks: {},
  }));
  await a.patchConfig({ workforce: { team: { people } } }, 'Nur Stammmannschaft eingeplant');
}

/** Grundeinstellungen: Woher kommt die Besetzung, wie hart zählen Qualifikationen. */
function grundlagen(a) {
  const cfg = a.scenarioCfg.config;
  const team = cfg.workforce?.team ?? {};
  const set = (patch, msg) => a.patchConfig(patch, msg);
  const summe = (team.people ?? []).filter((p) => p.active !== false)
    .reduce((x, p) => x + (Number(p.factor) || 0), 0);

  return card('Grundlage der Besetzung',
    h('div',
      h('div.grid.grid--form',
        selectField('Woher kommt die Mitarbeiterzahl?', team.source ?? 'ZAHLEN', [
          { value: 'ZAHLEN', label: 'Wochenwerte (wie bisher aus der Excel-Planung)' },
          { value: 'MANNSCHAFT', label: `Mannschaftsliste (${fmt.num(summe, 1)} Mitarbeiter)` },
        ], (v) => set({ workforce: { team: { source: v } } }, 'Grundlage der Besetzung geändert'), {
          hint: 'In den Wochenwerten sind Urlaube bereits eingerechnet. Die Liste rechnet mit Anwesenheit je Person.',
        }),
        h('label.field',
          h('span', `Krankenquote: ${Math.round((cfg.workforce?.sickRate ?? 0) * 100)} %`),
          h('input', {
            type: 'range', min: 0, max: 20, step: 1, value: Math.round((cfg.workforce?.sickRate ?? 0) * 100),
            onchange: (e) => set({ workforce: { sickRate: Number(e.target.value) / 100 } }, 'Krankenquote geändert'),
          }),
          h('div.small.faint', 'Pauschaler Abzug auf die gesamte Besetzung – wirkt zusätzlich zur Produktivität.')),
        h('label.field', h('span', 'Qualifikationen'), h('div.inline-check',
          h('input', {
            type: 'checkbox', checked: team.enforceSkills !== false,
            onchange: (e) => set({ workforce: { team: { enforceSkills: e.target.checked } } },
              e.target.checked ? 'Qualifikationen wirken' : 'Qualifikationen wirken nicht'),
          }),
          h('span', 'hart rechnen – ein Arbeitsgang wartet, wenn niemand Qualifiziertes da ist')))),
      hinweise(a)),
    { sub: 'Diese drei Einstellungen entscheiden, wie die Mannschaft in die Rechnung eingeht.' });
}

/** Was die aktuelle Mannschaft für die Planung bedeutet. */
function hinweise(a) {
  const t = a.analysis.team;
  if (!t) return null;
  const eng = (t.byOperation ?? []).filter((o) => o.qualified > 0 && o.qualified <= 2);
  const ohne = (t.byOperation ?? []).filter((o) => o.qualified === 0);
  return h('div', { style: { marginTop: '10px' } },
    h('div.small',
      // heads = am Stichtag anwesend, shiftTotal = ueberhaupt eingeplant.
      // Beides in einen Satz zu mischen ergab Unsinn wie "12 von 9".
      `${fmt.num(t.factor, 1)} Mitarbeiter am Stichtag (${t.heads} Kürzel) · `
      + `${t.shiftCapable} von ${t.shiftTotal ?? t.heads} eingeplanten Personen sind schichtfähig`,
      t.shiftBlocked?.length ? ` – keine Schicht: ${t.shiftBlocked.join(', ')}` : ''),
    ohne.length > 0 && h('div.note.note--error', { style: { marginTop: '8px' } },
      h('strong', 'Ohne Qualifizierte: '),
      `${ohne.map((o) => o.name).join(', ')} – diese Arbeitsgänge können nicht eingeplant werden.`),
    eng.length > 0 && h('div.note.note--warn', { style: { marginTop: '8px' } },
      h('strong', 'Nur wenige Qualifizierte: '),
      eng.map((o) => `${o.name} (${o.qualified})`).join(', '),
      ' – fällt hier jemand aus, steht der Arbeitsgang.'));
}

async function ladeMannschaft(a, container) {
  try {
    const t = await api.team(a.scenarioId);
    if (t.people.length === 0) {
      container.replaceChildren(h('div.empty', 'Noch keine Kürzel angelegt.'));
      return;
    }
    /*
     * Der Einsatzplan wird gleich mitgeholt.
     *
     * Vorgabe der Abteilungsleitung (18.09.2026): "Passe den Einsatzplan
     * automatisch an wenn ich die Qualimatrix anpasse." Gerechnet hat die
     * Anwendung das immer neu - nur zu sehen war es erst, wenn man in den
     * anderen Reiter wechselte. Jetzt steht die Wirkung dort, wo der Haken
     * gesetzt wird: Stunden je Person und die Tage, an denen sie wegen
     * fehlender Qualifikation leer ausgeht.
     */
    let plan = null;
    try { plan = await api.assignment(a.scenarioId); } catch { plan = null; }
    const imPlan = new Map((plan?.people ?? []).map((x) => [x.id, x]));
    const spalten = [
      {
        key: 'id',
        label: 'Kürzel / Name',
        render: (p) => h('div',
          p.kind === 'LEIHE' || p.kind === 'NEU'
            ? h('input', {
              type: 'text', value: p.label ?? '', placeholder: p.id, style: { width: '130px' },
              title: 'Name frei änderbar',
              onchange: (e) => speichern(a, t, p.id, (x) => { x.label = e.target.value; }),
            })
            : h('strong.mono', p.id),
          p.role && h('div.small.faint', p.role),
          p.absences?.length > 0 && h('div.small.muted', `${p.absences.length} Abwesenheit(en)`)),
      },
      {
        key: 'kind',
        label: 'Art',
        // Aenderbar: die Art entscheidet ueber Kostensatz, Einarbeitung und
        // Betreuungsaufwand. Wer als Stamm gefuehrt wird, aber Leiharbeiter
        // ist, wird sonst zu guenstig und zu produktiv gerechnet.
        render: (p) => h('select', {
          title: 'Stamm = eigener Mitarbeiter, Leihe = Leiharbeiter, neu = neu eingestellt '
            + '(Leihe und neu rechnen mit Einarbeitungskurve und Betreuungsaufwand)',
          onchange: (e) => speichern(a, t, p.id, (x) => { x.kind = e.target.value; }),
        }, [
          { value: 'STAMM', label: 'Stamm' },
          { value: 'LEIHE', label: 'Leihe' },
          { value: 'NEU', label: 'neu' },
        ].map((o) => h('option', { value: o.value, selected: (p.kind ?? 'STAMM') === o.value }, o.label))),
      },
      {
        key: 'factor',
        label: 'FTE',
        num: true,
        render: (p) => h('select', {
          title: 'Zeitanteil in der Fertigung',
          onchange: (e) => speichern(a, t, p.id, (x) => { x.factor = Number(e.target.value); }),
        }, [0.25, 0.5, 0.75, 1].map((f) => h('option', {
          value: f, selected: Number(p.factor) === f,
        }, fmt.num(f, f === 1 ? 0 : 2)))),
      },
      {
        key: 'einsatz',
        label: 'Eintritt / Ende',
        render: (p) => (p.kind === 'STAMM'
          ? h('span.faint.small', 'dauerhaft')
          : h('div.btn-row',
            h('input', {
              type: 'date', value: p.startDate ?? '', style: { width: '128px' },
              title: 'Eintritt – vorher zählt die Person nicht mit',
              onchange: (e) => speichern(a, t, p.id, (x) => {
                x.startDate = e.target.value || null;
                // Wer einen Eintritt hat, ist ab dann dauerhaft da
                if (e.target.value) x.defaultActive = true;
              }),
            }),
            h('input', {
              type: 'date', value: p.endDate ?? '', style: { width: '128px' },
              title: 'Einsatzende – danach zählt die Person nicht mehr mit',
              onchange: (e) => speichern(a, t, p.id, (x) => { x.endDate = e.target.value || null; }),
            }))),
      },
      {
        key: 'rate',
        label: '€/h',
        num: true,
        render: (p) => h('input', {
          type: 'number', min: 0, step: 1, style: { width: '70px' },
          value: p.rate ?? '', placeholder: p.kind === 'LEIHE' ? '55' : '35',
          title: 'Kostensatz je Stunde – leer = Satz der Art',
          onchange: (e) => speichern(a, t, p.id, (x) => { x.rate = e.target.value === '' ? null : Number(e.target.value); }),
        }),
      },
      {
        key: 'shiftCapable',
        label: 'Schicht',
        render: (p) => h('input', {
          type: 'checkbox', checked: p.shiftCapable !== false,
          title: 'Darf in Spät- und Nachtschicht eingesetzt werden',
          onchange: (e) => speichern(a, t, p.id, (x) => { x.shiftCapable = e.target.checked; }),
        }),
      },
      ...t.operations.map((op) => ({
        key: op.id,
        label: op.name.split(' ')[0].slice(0, 9),
        render: (p) => h('input', {
          type: 'checkbox', checked: !!p.skills?.[op.id], title: `${p.id}: ${op.name}`,
          onchange: (e) => speichern(a, t, p.id, (x) => { x.skills = { ...x.skills, [op.id]: e.target.checked }; }),
        }),
      })),
      {
        key: 'einsatz',
        label: 'im Plan',
        num: true,
        render: (p) => {
          const e = imPlan.get(p.id);
          if (!e) return h('span.faint', '–');
          const ohneQuali = Number(e.idleReasons?.KEINE_QUALIFIKATION ?? 0);
          const ohnePlatz = Number(e.idleReasons?.KEIN_PLATZ_FREI ?? 0);
          return h('div', { style: { textAlign: 'right' } },
            e.hours > 0
              ? h('strong', { title: 'Stunden im Einsatzplan über den ganzen Zeitraum' }, fmt.h(e.hours))
              : h('span.pill.pill--red', 'keine Arbeit'),
            ohneQuali > 0
              ? h('div.small', { style: { color: 'var(--c-amber)' },
                title: 'An so vielen Tagen anwesend, aber für die laufenden Arbeitsgänge nicht angehakt' },
              `${ohneQuali} Tage ohne Quali`)
              : null,
            ohnePlatz > 0
              ? h('div.small.faint', { title: 'An so vielen Tagen anwesend, aber kein Platz frei – '
                + 'daran ändert die Qualifikationsmatrix nichts' },
              `${ohnePlatz} Tage ohne Platz`)
              : null);
        },
      },
      {
        key: 'aktion',
        label: '',
        render: (p) => h('div.btn-row',
          h('button.btn.btn--sm', { onclick: () => abwesenheitDialog(a, t, p) }, 'Abwesenheit'),
          h('button.btn.btn--sm', { onclick: () => personDialog(a, p) }, 'Ändern')),
      },
    ];
    const eingeplant = (p) => p.defaultActive !== false || Object.values(p.weeks ?? {}).some(Boolean);
    /*
     * Leere Leiharbeiterplaetze bleiben zu.
     *
     * Die Liste war mit 15 Platzhaltern gefuellt, von denen keiner
     * eingetragen wurde. Eine Abteilung mit neun Leuten sah dadurch nach 24
     * aus - und die Frage "wer ist das alles?" war voellig berechtigt.
     * Gezeigt wird deshalb, wer zaehlt; die leeren Plaetze auf Wunsch.
     */
    const frei = t.people.filter((p) => p.kind !== 'STAMM' && !p.startDate && !eingeplant(p));
    a.ui.mannschaftAlle ??= false;
    const sichtbar = a.ui.mannschaftAlle ? t.people : t.people.filter((p) => !frei.includes(p));

    container.replaceChildren(
      frei.length > 0 && h('div.btn-row', { style: { padding: '10px 14px 0' } },
        h('span.small.muted', { style: { marginRight: '4px' } },
          `${frei.length} leere Leiharbeiterplätze sind ${a.ui.mannschaftAlle ? 'eingeblendet' : 'ausgeblendet'} – `
          + 'sie zählen nicht mit.'),
        h('button.btn.btn--sm', {
          onclick: () => { a.ui.mannschaftAlle = !a.ui.mannschaftAlle; ladeMannschaft(a, container); },
        }, a.ui.mannschaftAlle ? 'Leere Plätze ausblenden' : 'Leere Plätze anzeigen')),
      table(spalten, sichtbar, { compact: true }),
      h('div.small.faint', { style: { padding: '8px 14px' } },
        'Ein Haken wirkt sofort auf die Rechnung: Der Anteil der Mannschaft, der einen Arbeitsgang kann, '
        + 'begrenzt dessen Kapazität. ',
        `Eingeplant sind derzeit ${t.people.filter(eingeplant).length} von ${t.people.length} Kürzeln – `
        + 'Leiharbeiter mit Eintritt zählen ab diesem Tag mit, alle übrigen erst, wenn sie in der '
        + 'Anwesenheit je Kalenderwoche angehakt sind. Ohne Einsatzende rechnet die Anwendung bis '
        + 'zum Ende des Horizonts mit ihnen.'));
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Mannschaft konnte nicht geladen werden.'));
  }
}

/** Eine Person ändern und die Liste als Ganzes speichern. */
async function speichern(a, t, personId, mutate) {
  const people = t.people.map((p) => (p.id === personId ? { ...p } : p));
  const ziel = people.find((p) => p.id === personId);
  mutate(ziel);
  await a.patchConfig({ workforce: { team: { people } } }, `${personId} geändert`);
}

function personDialog(a, person) {
  const neu = !person;
  let id = person?.id ?? '';
  let role = person?.role ?? '';
  let factor = person?.factor ?? 1;
  let active = person?.active !== false;

  const m = modal({
    title: neu ? 'Kürzel anlegen' : `Kürzel ${person.id}`,
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'Geführt wird nur das Kürzel – keine Klarnamen. Der Zeitanteil sagt, wie viel der Person '
        + 'in der Fertigung zur Verfügung steht (der Vorarbeiter z. B. 0,5).'),
      h('label.field', h('span', 'Kürzel'),
        h('input', { type: 'text', value: id, disabled: !neu, oninput: (e) => { id = e.target.value.toUpperCase(); } })),
      h('label.field', h('span', 'Funktion (frei)'),
        h('input', { type: 'text', value: role, oninput: (e) => { role = e.target.value; } })),
      h('label.field', h('span', 'Zeitanteil (1 = voll)'),
        h('input', { type: 'number', min: 0, max: 1, step: 0.1, value: factor, oninput: (e) => { factor = Number(e.target.value); } })),
      !neu && h('label.field', h('span', 'In der Mannschaft'), h('div.inline-check',
        h('input', { type: 'checkbox', checked: active, onchange: (e) => { active = e.target.checked; } }),
        h('span', 'zählt zur Besetzung')))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      !neu && h('button.btn.btn--danger', {
        onclick: async () => {
          const ok = await confirmDialog('Kürzel entfernen?',
            `„${person.id}" wird aus der Mannschaft entfernt. Die Rechnung ändert sich dadurch.`, 'Entfernen');
          if (!ok) return;
          const t = await api.team(a.scenarioId);
          await a.patchConfig({ workforce: { team: { people: t.people.filter((p) => p.id !== person.id) } } },
            `${person.id} entfernt`);
          m.close();
        },
      }, 'Entfernen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!id.trim()) { toast('Bitte ein Kürzel eintragen.', 'error'); return; }
          const t = await api.team(a.scenarioId);
          let people;
          if (neu) {
            if (t.people.some((p) => p.id === id.trim())) { toast('Dieses Kürzel gibt es schon.', 'error'); return; }
            const skills = Object.fromEntries(t.operations.map((o) => [o.id, true]));
            people = [...t.people, { id: id.trim(), role, factor, shiftCapable: true, skills, absences: [], active: true }];
          } else {
            people = t.people.map((p) => (p.id === person.id ? { ...p, role, factor, active } : p));
          }
          await a.patchConfig({ workforce: { team: { people } } }, neu ? `${id} angelegt` : `${person.id} geändert`);
          m.close();
        },
      }, neu ? 'Anlegen' : 'Übernehmen'),
    ].filter(Boolean),
  });
}

function abwesenheitDialog(a, t, person) {
  const liste = h('div');
  let from = a.analysis.planningDate;
  let to = a.analysis.planningDate;
  let kind = 'URLAUB';

  const zeichne = (abwesenheiten) => {
    liste.replaceChildren(abwesenheiten.length === 0
      ? h('div.empty', 'Keine Abwesenheit eingetragen.')
      : table([
        { key: 'kind', label: 'Art', render: (x) => t.absenceKinds[x.kind] ?? x.kind },
        { key: 'from', label: 'von', render: (x) => fmt.date(x.from) },
        { key: 'to', label: 'bis', render: (x) => fmt.date(x.to || x.from) },
        {
          key: 'weg',
          label: '',
          render: (x) => h('button.btn.btn--sm', {
            onclick: async () => {
              const rest = abwesenheiten.filter((y) => y !== x);
              await schreibe(rest);
            },
          }, 'Löschen'),
        },
      ], abwesenheiten, { compact: true }));
  };

  const schreibe = async (abwesenheiten) => {
    const people = t.people.map((p) => (p.id === person.id ? { ...p, absences: abwesenheiten } : p));
    await a.patchConfig({ workforce: { team: { people } } }, `Abwesenheit ${person.id}`);
    person.absences = abwesenheiten;
    t.people = people;
    zeichne(abwesenheiten);
  };

  zeichne(person.absences ?? []);
  modal({
    title: `Abwesenheiten ${person.id}`,
    wide: true,
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'An diesen Tagen wird die Person nicht eingeplant. Wirkt auf die Rechnung, sobald die '
        + 'Mannschaftsliste die Grundlage der Besetzung ist – im Einsatzplan immer.'),
      liste,
      h('div.grid.grid--form', { style: { marginTop: '12px' } },
        selectField('Art', kind, Object.entries(t.absenceKinds).map(([v, l]) => ({ value: v, label: l })), (v) => { kind = v; }),
        h('label.field', h('span', 'von'), h('input', { type: 'date', value: from, onchange: (e) => { from = e.target.value; } })),
        h('label.field', h('span', 'bis'), h('input', { type: 'date', value: to, onchange: (e) => { to = e.target.value; } }))),
      h('div.btn-row', { style: { marginTop: '8px' } },
        h('button.btn.btn--primary', {
          onclick: async () => {
            if (!from || !to || to < from) { toast('Bitte einen gültigen Zeitraum wählen.', 'error'); return; }
            await schreibe([...(person.absences ?? []), { from, to, kind }]);
            toast('Abwesenheit eingetragen.', 'ok');
          },
        }, 'Eintragen'))),
    actions: [],
  });
}

/* ------------------------------------------------------------------ *
 * Anwesenheit je Kalenderwoche
 * ------------------------------------------------------------------ */

/**
 * Wer ist in welcher Kalenderwoche eingeplant?
 *
 * Das ersetzt die alten Wochenzahlen aus der Excel: Statt "KW 37: sechs
 * Mitarbeiter" steht hier, WER da ist. Leiharbeiter werden hier
 * wochenweise dazugeschaltet - ohne Haken zaehlen sie nicht mit.
 *
 * Gezeigt werden 13 Wochen auf einmal, blaetterbar bis Ende 2027.
 */
function anwesenheit(a) {
  const inhalt = h('div', h('div.empty', 'Anwesenheit wird geladen …'));
  ladeAnwesenheit(a, inhalt);
  return card('Anwesenheit je Kalenderwoche', inhalt, {
    sub: 'Haken = die Person ist in dieser Woche eingeplant. Diese Matrix ist die Grundlage der Kapazität.',
    flush: true,
  });
}

/** Alle Kalenderwochen vom Planungsstichtag bis Ende 2027. */
function wochenListe(a) {
  const start = new Date(`${a.analysis.planningDate}T00:00:00Z`);
  // auf Montag zurück
  const tag = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - (tag - 1));
  const ende = new Date('2027-12-31T00:00:00Z');
  const out = [];
  for (const d = start; d <= ende; d.setUTCDate(d.getUTCDate() + 7)) {
    out.push({ key: kwSchluessel(d), from: d.toISOString().slice(0, 10) });
  }
  return out;
}

/** ISO-Kalenderwoche als Schlüssel, z. B. 2026-W38. */
function kwSchluessel(datum) {
  const d = new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()));
  const tag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - tag);
  const jahresStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const woche = Math.ceil((((d.getTime() - jahresStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(woche).padStart(2, '0')}`;
}

async function ladeAnwesenheit(a, container) {
  try {
    const t = await api.team(a.scenarioId);
    const alle = wochenListe(a);
    a.ui.anwesenheitSeite ??= 0;
    const zeichne = () => {
      const seiten = Math.ceil(alle.length / 13);
      const seite = Math.min(Math.max(0, a.ui.anwesenheitSeite), seiten - 1);
      a.ui.anwesenheitSeite = seite;
      const wochen = alle.slice(seite * 13, seite * 13 + 13);
      container.replaceChildren(matrixTabelle(a, t, alle, wochen, seite, seiten, zeichne));
    };
    zeichne();
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Anwesenheit konnte nicht geladen werden.'));
  }
}

function matrixTabelle(a, t, alle, wochen, seite, seiten, neu) {
  const aktiv = (p, wk) => {
    const eigen = p.weeks?.[wk];
    return typeof eigen === 'boolean' ? eigen : p.defaultActive !== false;
  };

  const setzen = async (personId, aenderung) => {
    const people = t.people.map((p) => (p.id === personId ? { ...p, weeks: { ...(p.weeks ?? {}) } } : p));
    const ziel = people.find((p) => p.id === personId);
    aenderung(ziel);
    t.people = people;
    neu();
    await a.patchConfig({ workforce: { team: { people } } }, `Anwesenheit ${ziel.label || ziel.id}`);
  };

  const kopf = h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 14px', flexWrap: 'wrap' } },
    h('button.btn.btn--sm', { disabled: seite <= 0, onclick: () => { a.ui.anwesenheitSeite = seite - 1; neu(); } }, '‹ früher'),
    h('strong', `${fmt.weekLong(wochen[0]?.key)} bis ${fmt.weekLong(wochen[wochen.length - 1]?.key)}`),
    h('button.btn.btn--sm', { disabled: seite >= seiten - 1, onclick: () => { a.ui.anwesenheitSeite = seite + 1; neu(); } }, 'später ›'),
    h('span.small.faint', { style: { marginLeft: 'auto' } },
      `Zeitraum bis Ende 2027 · ${alle.length} Kalenderwochen`));

  const summe = (wk) => t.people.reduce((x, p) => x + (aktiv(p, wk) ? (Number(p.factor) || 0) : 0), 0);
  const excel = (wk) => a.scenarioCfg.config.workforce?.weekly?.[wk]?.base;

  const kopfzeile = h('tr',
    h('th.matrix__rowhead', 'Person'),
    wochen.map((w) => h('th', { title: `Woche ab ${fmt.date(w.from)}` }, fmt.week(w.key))),
    h('th', 'Wochen an'));

  const zeilen = t.people.map((p) => h('tr',
    h('td.matrix__rowhead',
      h('strong.mono', p.label || p.id),
      h('div.small.faint', `${fmt.num(p.factor, p.factor === 1 ? 0 : 2)} FTE`)),
    wochen.map((w) => h('td', { style: { padding: '2px' } }, h('input', {
      type: 'checkbox', checked: aktiv(p, w.key),
      title: `${p.label || p.id} · ${fmt.weekLong(w.key)}`,
      onchange: (e) => setzen(p.id, (x) => { x.weeks[w.key] = e.target.checked; }),
    }))),
    h('td',
      h('button.btn.btn--sm', {
        title: 'Alle gezeigten Wochen an- oder abhaken',
        onclick: () => setzen(p.id, (x) => {
          const alleAn = wochen.every((w) => aktiv(p, w.key));
          for (const w of wochen) x.weeks[w.key] = !alleAn;
        }),
      }, wochen.every((w) => aktiv(p, w.key)) ? 'alle aus' : 'alle an'))));

  const summenzeile = h('tr.matrix__pool',
    h('td.matrix__rowhead', h('strong', 'Summe FTE')),
    wochen.map((w) => {
      const ist = summe(w.key);
      const alt = excel(w.key);
      const abweichung = alt != null && Math.abs(alt - ist) > 0.4;
      return h('td', {
        style: { fontWeight: 700, color: abweichung ? 'var(--c-amber)' : null },
        title: alt != null
          ? `Laut bisheriger Excel-Planung: ${fmt.num(alt, 1)} Mitarbeiter`
          : 'kein Excel-Wert für diese Woche',
      }, fmt.num(ist, 1));
    }),
    h('td', ''));

  const excelHinweis = wochen.some((w) => {
    const alt = excel(w.key);
    return alt != null && Math.abs(alt - summe(w.key)) > 0.4;
  });

  return h('div',
    kopf,
    excelHinweis && h('div.note.note--warn', { style: { margin: '0 14px 10px' } },
      h('strong', 'Urlaub und Abwesenheiten fehlen noch. '),
      'In den gelb markierten Wochen weicht die Summe von Ihren bisherigen Excel-Werten ab – dort waren '
      + 'weniger Mitarbeiter verfügbar. Solange die Haken nicht gesetzt sind, rechnet die Anwendung diese '
      + 'Wochen zu optimistisch. Für einen Antrag beim Betriebsrat muss das vorher stimmen.'),
    h('div.scroll-x', h('table.matrix', h('thead', kopfzeile), h('tbody', [...zeilen, summenzeile]))),
    h('div.small.faint', { style: { padding: '8px 14px' } },
      'Stammleute sind grundsätzlich eingeplant, Leiharbeiter grundsätzlich nicht. '
      + 'Ein Leiharbeiter leistet in seinen ersten drei Wochen 40, 60 und 80 Prozent – '
      + 'die Einarbeitung ist in der Summe berücksichtigt.'));
}

/* ------------------------------------------------------------------ *
 * Einsatzplan
 * ------------------------------------------------------------------ */

function einsatzplan(a) {
  const inhalt = h('div', h('div.empty', 'Einsatzplan wird gerechnet …'));
  ladeEinsatz(a, inhalt);
  return card('Einsatzplan je Mitarbeiter', inhalt, {
    sub: 'Wer arbeitet wann an welchem Auftrag. Verteilt wird nach Qualifikation und Anwesenheit.',
    flush: true,
  });
}

async function ladeEinsatz(a, container) {
  try {
    const plan = await api.assignment(a.scenarioId);
    if (!plan || plan.days.length === 0) {
      container.replaceChildren(h('div.empty', 'Kein Einsatzplan – es ist keine Mannschaft gepflegt.'));
      return;
    }
    a.ui.einsatzWoche = plan.weeks.includes(a.ui.einsatzWoche) ? a.ui.einsatzWoche : plan.weeks[0];
    const zeichne = () => container.replaceChildren(wochenPlan(a, plan, zeichne));
    zeichne();
  } catch {
    container.replaceChildren(h('div.note.note--error', 'Einsatzplan konnte nicht gerechnet werden.'));
  }
}

function wochenPlan(a, plan, neu) {
  const wk = a.ui.einsatzWoche;
  const tage = plan.days.filter((d) => d.weekKey === wk);
  const index = plan.weeks.indexOf(wk);

  const kopf = h('div.btn-row', { style: { padding: '10px 14px', alignItems: 'center' } },
    h('button.btn.btn--sm', {
      disabled: index <= 0,
      onclick: () => { a.ui.einsatzWoche = plan.weeks[Math.max(0, index - 1)]; neu(); },
    }, '‹ Woche'),
    h('strong', { style: { minWidth: '120px', textAlign: 'center' } }, fmt.weekLong(wk)),
    h('button.btn.btn--sm', {
      disabled: index >= plan.weeks.length - 1,
      onclick: () => { a.ui.einsatzWoche = plan.weeks[Math.min(plan.weeks.length - 1, index + 1)]; neu(); },
    }, 'Woche ›'),
    plan.unassignedHours > 0 && h('span.small.muted',
      `${fmt.num(plan.unassignedHours)} h sind niemandem zugeordnet`));

  if (tage.length === 0) return h('div', kopf, h('div.empty', 'In dieser Woche ist nichts eingeplant.'));

  /*
   * Wer ist das eigentlich?
   *
   * Im Einsatzplan standen nur die Kuerzel. Ein "LEIHE-03" sagt niemandem
   * etwas, und ob ein Leiharbeiter ueberhaupt dabei ist, war nicht zu
   * erkennen. Deshalb stehen jetzt Name, Art und - wenn die Zeile leer
   * bleibt - der Grund dafuer daneben.
   */
  const mannschaftsliste = a.scenarioCfg.config.workforce?.team?.people ?? [];
  const person = (id) => mannschaftsliste.find((x) => x.id === id) ?? {};

  const stundenIn = (p) => tage.reduce((x, d) => x + d.entries.filter((e) => e.personId === p.id)
    .reduce((y, e) => y + e.hours, 0), 0);

  const grundFuerLeer = (p) => {
    const mensch = person(p.id);
    const ersterTag = tage[0]?.date;
    const letzterTag = tage[tage.length - 1]?.date;
    if (mensch.startDate && ersterTag && mensch.startDate > letzterTag) {
      return `Eintritt erst ${fmt.date(mensch.startDate)}`;
    }
    if (mensch.endDate && ersterTag && mensch.endDate < ersterTag) {
      return `Einsatz endete ${fmt.date(mensch.endDate)}`;
    }
    const abwesend = tage.filter((d) => d.absent.some((x) => x.id === p.id)).length;
    if (abwesend === tage.length && tage.length > 0) {
      const art = tage[0].absent.find((x) => x.id === p.id)?.kind;
      if (art) return `ganze Woche ${art.toLowerCase()}`;
      return mensch.kind === 'LEIHE' ? 'nicht abgerufen' : 'nicht eingeplant';
    }
    return 'diese Woche keine Zuteilung';
  };

  const artPille = (p) => {
    const art = person(p.id).kind ?? 'STAMM';
    if (art === 'LEIHE') return h('span.pill.pill--violet', 'Leihe');
    if (art === 'NEU') return h('span.pill.pill--blue', 'neu');
    return null;
  };

  const zeigeAlle = a.ui.einsatzAlle !== false;
  const zeilen = zeigeAlle ? plan.people : plan.people.filter((p) => stundenIn(p) > 0);

  const spalten = [
    {
      key: 'id',
      label: 'Kürzel',
      render: (p) => h('div',
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          h('strong.mono', p.id), artPille(p)),
        person(p.id).label ? h('div.small.muted', person(p.id).label) : null,
        stundenIn(p) === 0 ? h('div.small.faint', grundFuerLeer(p)) : null),
    },
    ...tage.map((d) => ({
      key: d.date,
      label: `${WOCHENTAGE[new Date(d.date).getDay()]} ${fmt.dateShort(d.date)}`,
      render: (p) => zelle(d, p.id),
    })),
    {
      key: 'summe',
      label: 'Summe h',
      num: true,
      render: (p) => {
        const gesamt = stundenIn(p);
        return gesamt > 0 ? h('strong', fmt.num(gesamt, 1)) : h('span.faint', '–');
      },
    },
  ];

  const mitEinsatz = plan.people.filter((p) => stundenIn(p) > 0).length;
  const leihImEinsatz = plan.people.filter((p) => stundenIn(p) > 0 && person(p.id).kind === 'LEIHE').length;

  /*
   * Was in dieser Woche an Anwesenheit nicht genutzt werden konnte - und
   * warum. Das ist die Zahl, die den Blick auf die Plaetze lenkt statt auf
   * die Mannschaft.
   */
  const leerTage = tage.reduce((x, d) => x + (d.idle ?? []).length, 0);
  const leerGruende = {};
  for (const d of tage) for (const i of d.idle ?? []) leerGruende[i.grund] = (leerGruende[i.grund] ?? 0) + 1;
  /*
   * FIX (gemeldet 21.09.2026 anhand eines Bildschirmfotos): der
   * Hinweistext bei "Arbeit des Tages ist vergeben" nannte bisher IMMER
   * dieselben zwei Beispielursachen ("höchstens 3 Aufträge gleichzeitig",
   * "höchstens 4 Mitarbeiter je Auftrag") - unabhängig davon, ob diese
   * Grenzen ueberhaupt aktiv sind und unabhaengig von der tatsaechlichen
   * Ursache. Jetzt wird die tatsaechliche Ursache je Person (warteUrsache,
   * siehe engine/assignment.js) ausgezaehlt und im Text genannt.
   */
  const arbeitVerteiltUrsachen = {};
  let arbeitVerteiltOhneUrsache = 0;
  for (const d of tage) {
    for (const i of d.idle ?? []) {
      if (i.grund !== 'ARBEIT_VERTEILT') continue;
      if (i.warteUrsache?.ursache) {
        arbeitVerteiltUrsachen[i.warteUrsache.ursache] = (arbeitVerteiltUrsachen[i.warteUrsache.ursache] ?? 0) + 1;
      } else {
        arbeitVerteiltOhneUrsache += 1;
      }
    }
  }
  const arbeitstage = tage.reduce((x, d) => x + (d.entries.some((e) => e.personId) ? 1 : 0), 0);
  const stundenGesamt = tage.reduce((x, d) => x + d.entries.filter((e) => e.personId)
    .reduce((y, e) => y + e.hours, 0), 0);

  const fuss = h('div.small', { style: { padding: '8px 14px' } },
    h('div.faint',
      `In dieser Woche sind ${mitEinsatz} von ${plan.people.length} Personen eingeplant, `
      + `davon ${leihImEinsatz} Leiharbeiter, zusammen ${fmt.h(stundenGesamt)} an ${arbeitstage} Tagen. `,
      'Leiharbeiter zählen erst ab ihrem Eintritt mit; die übrigen erscheinen, sobald sie unter '
      + '„Anwesenheit je KW" abgerufen werden.'),
    leerTage > 0
      ? h('div.note.note--warn', { style: { marginTop: '8px' } },
        h('strong', `${leerTage} Personentage ohne Arbeit, obwohl anwesend. `),
        Object.entries(leerGruende)
          .map(([g, n]) => `${n}× ${LEER_GRUND[g]?.text ?? g}`).join(', '),
        '. ',
        leerGruende.ARBEIT_VERTEILT
          ? h('span', arbeitVerteiltText(arbeitVerteiltUrsachen, arbeitVerteiltOhneUrsache))
          : null,
        leerGruende.KEIN_PLATZ_FREI
          ? h('span', ' Wo wirklich kein Platz frei war, blieb Arbeit liegen – dort hilft ein '
            + 'Platz mehr oder eine weitere Schicht (Übersicht → Engpässe & Wirkung).')
          : null,
        leerGruende.SCHICHT_OHNE_ARBEIT
          ? h('span', ' „Schicht ohne Arbeit" heißt: In der Schicht dieser Woche lief an diesem Tag '
            + 'nichts, was die Person darf. Die Einteilung gilt wochenweise – siehe Schichtplan.')
          : null)
      : null);

  const umschalter = h('label.inline-check', { style: { marginLeft: 'auto' } },
    h('input', {
      type: 'checkbox', checked: !zeigeAlle,
      onchange: (e) => { a.ui.einsatzAlle = !e.target.checked; neu(); },
    }),
    h('span', 'nur Eingeplante zeigen'));
  kopf.append(umschalter);

  return h('div', kopf, table(spalten, zeilen, { compact: true }), fuss);
}

/**
 * Text fuer "Arbeit des Tages ist vergeben" - nennt die TATSAECHLICHE
 * Ursache (aus warteUrsache je Person, engine/assignment.js) statt einer
 * immer gleichen Beispielerklaerung.
 * @param {Record<string, number>} ursachen Anzahl Personentage je Ursache
 * @param {number} ohneUrsache Personentage ohne feststellbare Wartearsache
 *   (der Pool war exakt ausgeschoepft, keine Arbeit blieb liegen)
 */
function arbeitVerteiltText(ursachen, ohneUrsache) {
  const einleitung = 'Der häufigste Grund ist nicht der Platz, sondern die freigegebene Arbeit: '
    + 'Was heute beginnen darf, ist verteilt.';
  const eintraege = Object.entries(ursachen).sort((a, b) => b[1] - a[1]);
  if (eintraege.length === 0) {
    return `${einleitung} Die Mannschaftsstunden waren an diesen Tagen bereits vollständig verplant – `
      + 'mehr Plätze oder eine weitere Schicht schaffen dort keine zusätzliche Stunde.';
  }
  const genannt = eintraege.map(([u, n]) => `${n}× ${u}`).join(', ')
    + (ohneUrsache > 0 ? `, ${ohneUrsache}× ausgereizte Mannschaftsstunden` : '');
  const nurPool = eintraege.every(([u]) => u === 'Mitarbeiterstunden') && ohneUrsache === 0;
  const nurWip = eintraege.every(([u]) => u === 'Aufträge gleichzeitig' || u === 'Mitarbeiter je Auftrag');
  const zusatz = nurPool
    ? ' Mehr Plätze oder eine weitere Schicht ändern daran nichts – die Mannschaftsstunden selbst reichten nicht.'
    : nurWip
      ? ' Diese Grenzen werden bei drohendem Leerlauf automatisch und sichtbar gelockert.'
      : ' Mehr Plätze oder eine weitere Schicht helfen nur dort, wo tatsächlich ein Platz die Ursache war.';
  return `${einleitung} Tatsächliche Ursache in diesem Zeitraum: ${genannt}.${zusatz}`;
}

/** Warum steht hier nichts? Klartext statt Gedankenstrich. */
const LEER_GRUND = {
  KEIN_PLATZ_FREI: { text: 'kein Platz frei', lang: 'Anwesend, aber alle Plätze dieses Arbeitsgangs sind belegt. Mehr Personal ändert daran nichts.' },
  /*
   * "Kein Platz frei" war zu oft die falsche Antwort (Rückfrage
   * 18.09.2026): meistens war der Platz gar nicht belegt, es fehlte
   * schlicht freigegebene Arbeit (Vorgänger, Material, oder die Grenzen
   * "höchstens N Aufträge gleichzeitig"/"höchstens M Mitarbeiter je
   * Auftrag"). Ein zweiter Platz hätte daran nichts geändert.
   */
  ARBEIT_VERTEILT: { text: 'Arbeit des Tages ist vergeben', lang: 'Anwesend, aber alles heute freigegebene ist bereits verteilt. Ein weiterer Platz würde hier nichts ändern.' },
  KEINE_QUALIFIKATION: { text: 'keine Qualifikation', lang: 'Anwesend, aber für die heute laufenden Arbeitsgänge nicht angehakt.' },
  KEINE_ARBEIT: { text: 'keine Arbeit offen', lang: 'Anwesend, an diesem Tag ist nichts einzuplanen.' },
  /*
   * Kommt erst mit dem Schichtbetrieb vor: Der Mann ist in der Spaet- oder
   * Nachtschicht eingeteilt (wochenweise, nicht tageweise), und keiner der
   * Arbeitsgaenge, die er darf, laeuft in dieser Schicht. Ohne diesen
   * Eintrag stand in der Liste der nackte Schluessel.
   */
  SCHICHT_OHNE_ARBEIT: {
    text: 'Schicht ohne Arbeit',
    lang: 'Anwesend, aber in seiner Schicht läuft kein Arbeitsgang, den er darf. '
      + 'Entweder die Schichteinteilung dieser Woche passt nicht zur Arbeit – oder der '
      + 'Arbeitsgang läuft nur einschichtig.',
  },
};

function zelle(tag, personId) {
  const ab = tag.absent.find((x) => x.id === personId);
  if (ab) return h('span.pill.pill--grey', ab.kind ? ab.kind.toLowerCase() : 'abwesend');
  const eintraege = tag.entries.filter((e) => e.personId === personId);
  if (eintraege.length === 0) {
    /*
     * Hier stand ein Gedankenstrich. Die Rueckfrage der Abteilungsleitung
     * (18.09.2026) war genau die: "MAAP wird an manchen Tagen gar nicht
     * geplant, obwohl anwesend - das kann nicht richtig sein." Ohne Grund
     * sieht es nach einem Fehler aus, auch wenn schlicht kein Platz frei
     * war. Der Grund kommt jetzt aus dem Einsatzplan mit.
     */
    const leer = (tag.idle ?? []).find((x) => x.id === personId);
    const g = leer ? LEER_GRUND[leer.grund] : null;
    if (g) return h('span.pill.pill--amber', { title: g.lang }, g.text);
    return h('span.faint', '–');
  }
  return h('div', eintraege.map((e) => h('div.small',
    h('strong', e.opName ?? e.opId), ' ', h('span.mono', e.orderNo), ' ',
    h('span.faint', `${fmt.num(e.hours, 1)} h`))));
}

/* ------------------------------------------------------------------ *
 * Urlaubsplanung einlesen
 * ------------------------------------------------------------------ */

/**
 * Die Urlaubsplanung der Abteilung ist eine Tabelle: oben die Kalendertage,
 * darunter je Person eine Zeile mit T (da) und A (weg). Sie wird hier
 * eingefuegt statt abgetippt - eine Spalte zu verrutschen wuerde jemandem
 * Urlaub erfinden.
 *
 * Bewusst zweistufig: erst ansehen, dann uebernehmen. Und die Zuordnung
 * Zeile -> Kuerzel macht der Anwender, nicht die Anwendung: die Tabelle
 * nennt die Personen nicht.
 */
function urlaubEinlesen(a) {
  const cfg = a.scenarioCfg.config;
  const letzter = cfg.workforce?.attendanceImport ?? null;
  const box = h('div');

  const eingabe = h('textarea', {
    rows: 8, placeholder: '15.09.\t16.09.\t17.09.\t…\nT\tT\tA\t…\nT\tA\tA\t…',
    style: { width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px' },
  });

  /* ---------- Excel-Datei statt Zwischenablage ---------- */
  const blattWahl = h('div');
  const dateiFeld = h('input', {
    type: 'file', accept: '.xlsx,.xlsm,.xltx,.csv,.txt',
    style: { display: 'none' },
    onchange: (e) => { if (e.target.files?.[0]) dateiLesen(e.target.files[0]); },
  });

  const ablage = h('div.dropzone', { onclick: () => dateiFeld.click() },
    h('div.dropzone__text',
      h('strong', 'Excel-Datei hierher ziehen'),
      h('div.small.muted', 'oder klicken und auswählen · .xlsx, .xlsm, .csv'),
      h('div.small.faint', 'Alternativ unten den Bereich aus Excel kopieren und einfügen.')));
  ablage.addEventListener('dragover', (e) => { e.preventDefault(); ablage.classList.add('dropzone--aktiv'); });
  ablage.addEventListener('dragleave', () => ablage.classList.remove('dropzone--aktiv'));
  ablage.addEventListener('drop', (e) => {
    e.preventDefault();
    ablage.classList.remove('dropzone--aktiv');
    const datei = e.dataTransfer?.files?.[0];
    if (datei) dateiLesen(datei);
  });

  /**
   * Liest eine Excel- oder CSV-Datei ein.
   *
   * Excel speichert Datumsangaben als Zahl (Tage seit dem 30.12.1899).
   * Ohne Ruecksetzung stuende in der Kopfzeile 46276 statt 15.09. -
   * deshalb wird jede Zahl in einem plausiblen Datumsbereich
   * zurueckgerechnet.
   */
  const dateiLesen = async (datei) => {
    const name = String(datei.name ?? '').toLowerCase();
    try {
      if (/\.(csv|txt)$/.test(name)) {
        const text = await datei.text();
        eingabe.value = text.includes('\t') ? text : readCsv(text).map((r) => r.join('\t')).join('\n');
        blattWahl.replaceChildren(h('div.small.muted', `Datei gelesen: ${datei.name}`));
        await lesen();
        return;
      }
      const puffer = new Uint8Array(await datei.arrayBuffer());
      const blaetter = readXlsx(puffer).filter((b) => b.rows.length > 0);
      if (blaetter.length === 0) { toast('In dieser Datei steht keine Tabelle.', 'error'); return; }

      const uebernehmen = (index) => {
        eingabe.value = alsText(blaetter[index].rows);
        lesen();
      };
      if (blaetter.length === 1) {
        blattWahl.replaceChildren(h('div.small.muted',
          `Datei gelesen: ${datei.name} · Blatt „${blaetter[0].name}" · ${blaetter[0].rows.length} Zeilen`));
      } else {
        blattWahl.replaceChildren(h('div.btn-row', { style: { alignItems: 'center' } },
          h('span.small.muted', `${datei.name} – welches Blatt?`),
          h('select', {
            style: { maxWidth: '260px' },
            onchange: (e) => uebernehmen(Number(e.target.value)),
          }, blaetter.map((b, i) => h('option', { value: i }, `${b.name} (${b.rows.length} Zeilen)`)))));
      }
      uebernehmen(0);
    } catch (e) {
      toast(e?.message || 'Die Datei konnte nicht gelesen werden.', 'error');
    }
  };

  /** Zeilen einer Excel-Tabelle in die Form bringen, die der Einleser erwartet. */
  const alsText = (rows) => rows
    .map((r) => (r ?? []).map((c) => zelleAlsText(c)).join('\t'))
    .join('\n');

  const zelleAlsText = (wert) => {
    if (wert === null || wert === undefined) return '';
    if (typeof wert !== 'number') return String(wert).trim();
    // Datumsbereich 1954 bis 2119 - alles andere bleibt eine Zahl
    if (wert > 20000 && wert < 80000 && Number.isInteger(wert)) {
      const d = new Date(Date.UTC(1899, 11, 30) + wert * 86400000);
      const tag = String(d.getUTCDate()).padStart(2, '0');
      const monat = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${tag}.${monat}.${d.getUTCFullYear()}`;
    }
    return String(wert).replace('.', ',');
  };
  const jahrFeld = h('input', {
    type: 'number', min: 2020, max: 2100, step: 1,
    value: String(new Date(cfg.planningDate ?? '2026-01-01').getUTCFullYear()),
    style: { width: '90px' },
  });
  const vorschau = h('div');
  /** Deutung zusaetzlicher Kuerzel: true = anwesend @type {Record<string, boolean>} */
  const deutung = { ...(cfg.workforce?.attendanceCodes ?? {}) };
  /** Zuordnung Zeile -> Kuerzel @type {Record<string, string>} */
  const zuordnung = {};
  let gelesen = null;

  const lesen = async () => {
    vorschau.replaceChildren(h('div.empty', 'Tabelle wird gelesen …'));
    try {
      gelesen = await api.parseAttendance({
        text: eingabe.value, year: Number(jahrFeld.value) || undefined, codes: deutung,
      });
      zeichneVorschau();
    } catch (e) {
      gelesen = null;
      vorschau.replaceChildren(h('div.note.note--error', e?.message || 'Die Tabelle konnte nicht gelesen werden.'));
    }
  };

  const zeichneVorschau = () => {
    if (!gelesen) return;
    const m = gelesen;
    const leute = (cfg.workforce?.team?.people ?? []);
    const auswahl = [{ value: '', label: '– noch nicht zugeordnet –' },
      ...leute.map((p) => ({ value: p.id, label: p.kind === 'STAMM' ? p.id : `${p.id} · ${p.label || ''}` }))];

    vorschau.replaceChildren(
      h('div.small.muted', { style: { marginBottom: '8px' } },
        `Zeitraum ${fmt.date(m.from)} bis ${fmt.date(m.to)} · ${m.dates.length} Spalten, `
        + `davon ${m.workdays} Arbeitstage · ${m.rows.length} Zeilen erkannt`),

      ...m.warnings.map((w) => h('div.note.note--warn', { style: { marginBottom: '8px' } }, w)),

      m.unknownCodes.length > 0 && h('div.note.note--warn', { style: { marginBottom: '10px' } },
        h('strong', 'Unbekannte Kürzel – bitte sagen, wie sie zu rechnen sind: '),
        h('div', { style: { marginTop: '6px', display: 'flex', gap: '14px', flexWrap: 'wrap' } },
          ...m.unknownCodes.map((c) => h('div',
            h('strong.mono', c.code),
            h('span.small.faint', ` (${c.count}× in Zeile ${c.rows.join(', ')})`),
            h('div.btn-row', { style: { marginTop: '4px' } },
              h(`button.btn.btn--sm${deutung[c.code] === false ? '.btn--primary' : ''}`, {
                onclick: () => { deutung[c.code] = false; lesen(); },
              }, 'abwesend'),
              h(`button.btn.btn--sm${deutung[c.code] === true ? '.btn--primary' : ''}`, {
                onclick: () => { deutung[c.code] = true; lesen(); },
              }, 'anwesend'))))),
        h('div.small', { style: { marginTop: '6px' } },
          'Solange nichts gewählt ist, zählt das Kürzel weder als Anwesenheit noch als Abwesenheit – '
          + 'die Anwendung rät nicht.')),

      table([
        { key: 'label', label: 'Zeile', render: (r) => h('strong', r.label) },
        { key: 'days', label: 'gepflegte Tage', num: true },
        { key: 'anwesend', label: 'anwesend', num: true },
        {
          key: 'abwesend',
          label: 'abwesend',
          num: true,
          render: (r) => (r.abwesend > 0 ? h('span.pill.pill--amber', r.abwesend) : h('span.faint', '0')),
        },
        {
          key: 'unbekannt',
          label: 'unklar',
          num: true,
          render: (r) => (r.unbekannt > 0 ? h('span.pill.pill--red', r.unbekannt) : h('span.faint', '0')),
        },
        {
          key: 'absences',
          label: 'Zeiträume',
          render: (r) => (r.absences.length === 0
            ? h('span.faint', '–')
            : h('span.small', r.absences.map((x) => `${fmt.date(x.from)}–${fmt.date(x.to)}`).join(', '))),
        },
        {
          key: 'person',
          label: 'gehört zu',
          render: (r) => h('select', {
            onchange: (e) => { zuordnung[String(r.index)] = e.target.value; },
          }, auswahl.map((o) => h('option', {
            value: o.value, selected: zuordnung[String(r.index)] === o.value,
          }, o.label))),
        },
      ], m.rows, { compact: true }),

      h('div.note.note--info', { style: { marginTop: '10px' } },
        h('strong', 'Zuordnung: '),
        'Die Tabelle nennt keine Namen. Zugeordnete Zeilen werden zur echten Abwesenheit der Person. '
        + 'Nicht zugeordnete Zeilen gehen als ANZAHL abwesender Personen je Tag in die Rechnung – '
        + 'mit Zeitanteil 1,0 je Person, weil die Zeile nicht mehr hergibt.'),

      h('div.btn-row', { style: { marginTop: '10px' } },
        h('button.btn.btn--primary', {
          onclick: async () => {
            const offen = m.rows.length - Object.values(zuordnung).filter(Boolean).length;
            const frage = offen > 0
              ? `${offen} von ${m.rows.length} Zeilen sind keinem Kürzel zugeordnet. Diese zählen `
                + 'nur als Anzahl je Tag. Trotzdem übernehmen?'
              : `Alle ${m.rows.length} Zeilen werden als Abwesenheit der zugeordneten Personen gespeichert. `
                + 'Bestehende Abwesenheiten in diesem Zeitraum werden ersetzt.';
            const ok = await confirmDialog('Urlaubsplanung übernehmen?', frage, 'Übernehmen');
            if (!ok) return;
            try {
              const r = await api.applyAttendance(a.scenarioId, {
                text: eingabe.value, year: Number(jahrFeld.value) || undefined,
                codes: deutung, mapping: zuordnung, replace: true,
              });
              toast(`Urlaubsplanung übernommen: ${r.assigned} Zeilen zugeordnet, `
                + `${r.absencesWritten} Zeiträume gespeichert, ${r.open} Zeilen als Anzahl je Tag.`, 'ok');
              await a.reload();
            } catch (e) {
              toast(e?.message || 'Übernehmen fehlgeschlagen.', 'err');
            }
          },
        }, 'Übernehmen'),
        h('button.btn', { onclick: () => { eingabe.value = ''; vorschau.replaceChildren(); gelesen = null; } },
          'Verwerfen')));
  };

  box.append(
    card('Urlaubsplanung einlesen',
      h('div.stack',
        h('div.small.muted',
          'Entweder die Excel-Datei hierher ziehen oder den Bereich aus Excel kopieren und '
          + 'unten einfügen. Erkannt werden T (anwesend), A (abwesend) und DM (Demontage – '
          + 'an eine andere Abteilung verliehen); weitere Kürzel werden erfragt.'),
        dateiFeld,
        ablage,
        blattWahl,
        eingabe,
        h('div.btn-row',
          h('label.field', { style: { maxWidth: '150px' } },
            h('span', 'Jahr der Spalten'), jahrFeld),
          h('button.btn.btn--primary', { style: { alignSelf: 'flex-end' }, onclick: () => lesen() },
            'Tabelle ansehen'))),
      {
        sub: 'Erst ansehen, dann übernehmen – abgetippt wird nichts.',
        actions: letzter
          ? [h('span.small.faint', `zuletzt eingelesen: ${fmt.date(letzter.from)}–${fmt.date(letzter.to)} `
            + `(${letzter.assigned}/${letzter.rows} zugeordnet)`)]
          : null,
      }),
    card('Vorschau', vorschau, { flush: true }),
    offeneAbwesenheiten(a));
  return box;
}

/** Was aus nicht zugeordneten Zeilen in der Rechnung steht. */
function offeneAbwesenheiten(a) {
  const geplant = a.scenarioCfg.config.workforce?.plannedAbsences ?? {};
  const tage = Object.entries(geplant).filter(([, n]) => Number(n) > 0).sort();
  if (tage.length === 0) return null;
  const personentage = tage.reduce((x, [, n]) => x + Number(n), 0);
  return card('Abwesende ohne Zuordnung',
    h('div',
      h('div.small.muted', { style: { marginBottom: '8px' } },
        `${personentage} Personentage an ${tage.length} Tagen (${fmt.date(tage[0][0])} bis `
        + `${fmt.date(tage[tage.length - 1][0])}). Sie gehen von der Stärke aus der Mannschaft ab.`),
      table([
        { key: 'datum', label: 'Tag', render: (r) => fmt.date(r.datum) },
        { key: 'anzahl', label: 'abwesend', num: true },
      ], tage.slice(0, 40).map(([datum, anzahl]) => ({ datum, anzahl })), { compact: true }),
      tage.length > 40 && h('div.small.faint', { style: { padding: '6px 14px' } },
        `… und ${tage.length - 40} weitere Tage.`)),
    {
      flush: true,
      sub: 'Solange eine Zeile keinem Kürzel zugeordnet ist, kennt die Anwendung nur die Anzahl – '
        + 'nicht, wer fehlt. Für die Qualifikationen macht das einen Unterschied.',
    });
}

/* ------------------------------------------------------------------ *
 * Aushang
 * ------------------------------------------------------------------ */

/**
 * Aushang fuer die Werkstatt.
 *
 * Vorgabe der Abteilungsleitung: eine Seite fuer ALLE, nicht eine Seite
 * je Mitarbeiter. Darum eine Tabelle Kuerzel x Wochentag mit dem
 * Arbeitsgang und dem Auftrag - so wie es an der Tafel haengt.
 *
 * Gedruckt wird mit der Druckfunktion des Browsers; die Seitenleiste und
 * die Bedienelemente werden dabei ausgeblendet (@media print).
 */
function aushang(a) {
  const inhalt = h('div', h('div.empty', 'Aushang wird gerechnet …'));
  ladeAushang(a, inhalt);
  return card('Aushang – eine Seite für alle', inhalt, {
    flush: true,
    sub: 'Wer arbeitet diese Woche wo. Zum Aushängen in der Werkstatt.',
    actions: [
      h('button.btn.btn--sm', { onclick: () => window.print() }, '🖨 Drucken'),
    ],
  });
}

async function ladeAushang(a, ziel) {
  try {
    const plan = await api.assignment(a.scenarioId);
    if (!plan || plan.days.length === 0) {
      ziel.replaceChildren(h('div.empty', 'Kein Einsatzplan – es ist keine Mannschaft gepflegt.'));
      return;
    }
    a.ui.einsatzWoche = plan.weeks.includes(a.ui.einsatzWoche) ? a.ui.einsatzWoche : plan.weeks[0];
    const zeichne = () => ziel.replaceChildren(aushangBlatt(a, plan, zeichne));
    zeichne();
  } catch {
    ziel.replaceChildren(h('div.note.note--error', 'Der Aushang konnte nicht gerechnet werden.'));
  }
}

function aushangBlatt(a, plan, neu) {
  const wk = a.ui.einsatzWoche;
  const tage = plan.days.filter((d) => d.weekKey === wk);
  const index = plan.weeks.indexOf(wk);
  const leute = plan.people ?? [];

  const kopf = h('div.btn-row.no-print', { style: { padding: '10px 14px', alignItems: 'center' } },
    h('button.btn.btn--sm', {
      disabled: index <= 0,
      onclick: () => { a.ui.einsatzWoche = plan.weeks[Math.max(0, index - 1)]; neu(); },
    }, '‹ Woche'),
    h('strong', { style: { minWidth: '150px', textAlign: 'center' } }, fmt.weekLong(wk)),
    h('button.btn.btn--sm', {
      disabled: index >= plan.weeks.length - 1,
      onclick: () => { a.ui.einsatzWoche = plan.weeks[Math.min(plan.weeks.length - 1, index + 1)]; neu(); },
    }, 'Woche ›'));

  if (tage.length === 0) return h('div', kopf, h('div.empty', 'In dieser Woche ist nichts eingeplant.'));

  const zelleText = (tag, personId) => {
    const e = (tag.entries ?? []).filter((x) => x.personId === personId);
    if (e.length === 0) return h('span.faint', '–');
    return h('div', ...e.map((x) => h('div', { style: { lineHeight: '1.3' } },
      h('strong', { style: { fontSize: '11px' } }, x.opName ?? x.opId),
      h('div.small.muted', `${x.orderNo ?? x.projectId} · ${fmt.num(x.hours, 1)} h`))));
  };

  const spalten = [
    { key: 'id', label: 'Kürzel', render: (p) => h('strong.mono', p.id) },
    ...tage.map((d) => ({
      key: d.date,
      label: `${WOCHENTAGE[new Date(d.date).getDay()]} ${fmt.dateShort(d.date)}`,
      render: (p) => zelleText(d, p.id),
    })),
  ];

  return h('div',
    kopf,
    h('div.aushang__kopf',
      h('strong', 'Armaturenbau MEGC · Einsatz ', fmt.weekLong(wk)),
      h('span.small.muted', { style: { marginLeft: 'auto' } },
        `Stand ${fmt.date(a.analysis.planningDate)} · gedruckt ${new Date().toLocaleDateString('de-DE')}`)),
    table(spalten, leute, { compact: true, empty: 'Keine Mannschaft gepflegt.' }),
    h('div.small.faint', { style: { padding: '8px 14px' } },
      'Verteilt nach Qualifikation und Anwesenheit. Änderungen bitte über die Anwendung, '
      + 'nicht auf dem Ausdruck – sonst rechnet niemand damit.'));
}
