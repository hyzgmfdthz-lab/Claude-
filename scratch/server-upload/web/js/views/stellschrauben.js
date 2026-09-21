/**
 * Stellschrauben - der Simulationsteil der Anwendung.
 *
 * Bis hierher standen alle Regler in einer langen Leiste im Steuerstand.
 * Die Abteilungsleitung hat dazu gesagt: "Ich bin mit den vielen
 * Einstellmoeglichkeiten super happy, aber die Anordnung und Uebersicht
 * der Einstellmoeglichkeiten sind kritisch."
 *
 * Daher jetzt:
 *   - Die Stellschrauben stehen in einem Panel rechts, das sich von JEDER
 *     Ansicht aus oeffnen laesst. Man sieht also die Wirkung dort, wo man
 *     gerade arbeitet, statt erst zurueckzuwechseln.
 *   - Sie sind in drei Gruppen zugeklappt: Mannschaft und Zeit, Plaetze
 *     und Maschinen, Regeln und Reserven. Offen ist nur die Gruppe, an der
 *     gerade gearbeitet wird.
 *
 * Jede Aenderung rechnet unverzueglich durch - daran hat sich nichts
 * geaendert.
 */

import { h, fmt, toast, confirmDialog, modal, panel, fold } from '../ui.js';
import { api } from '../api.js';

const WOCHENTAGE = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr']];

/**
 * Welche Gruppen sind offen?
 *
 * Als Menge und nicht als einzelner Name: Wer an Mannschaft UND Plaetzen
 * dreht, soll nicht bei jedem Rechnen wieder aufklappen muessen. Der
 * Zustand ueberlebt das Schliessen des Panels.
 */
const offeneGruppen = new Set(['mannschaft']);

/**
 * Oeffnet die Stellschrauben als Seitenpanel.
 * @param {any} a
 */
export function openStellschrauben(a) {
  const cfg = a.scenarioCfg.config;
  const p = panel({
    title: 'Stellschrauben',
    sub: 'Jede Änderung rechnet sofort durch · wirkt im aktuellen Stand',
    body: gruppen(a, cfg),
    actions: [
      h('button.btn.btn--sm', {
        onclick: async () => {
          const ok = await confirmDialog('Alle Stellschrauben zurücksetzen?',
            'Alle Werte werden auf den Ausgangsstand (Baseline) zurückgesetzt. Aufträge bleiben unverändert.',
            'Zurücksetzen');
          if (!ok) return;
          await api.resetScenario(a.scenarioId);
          await a.recalc('Auf Ausgangsstand zurückgesetzt');
        },
      }, '↺ Zurücksetzen'),
      h('button.btn.btn--sm', { onclick: () => saveStateDialog(a) }, '💾 Stand speichern'),
      h('span.small.faint', { style: { marginLeft: 'auto', alignSelf: 'center' } },
        a.scenario?.name ?? ''),
    ],
    onClose: () => { a.ui.panel = null; },
  });
  a.ui.panel = 'stellschrauben';
  return p;
}

/** Die drei Gruppen. */
function gruppen(a, cfg) {
  const set = (patch) => a.patchConfig(patch, null);
  const slider = reglerBauer(a);
  const satWeeks = Object.values(cfg.saturday.weeks ?? {}).filter((w) => w.enabled).length;
  const auf = (name) => offeneGruppen.has(name);
  const merke = (name) => (offen) => {
    if (offen) offeneGruppen.add(name); else offeneGruppen.delete(name);
  };

  return h('div',
    fold('Mannschaft und Zeit', h('div',
      personalBlock(a, cfg),

      slider('Überstunden je MA und Woche', cfg.workforce.overtimePerEmployeeDefault, 0, 10, 0.5,
        (v) => set({ workforce: { overtimePerEmployeeDefault: v } }),
        { format: (v) => `${v} h` }),

      h('div.rail__group',
        h('label.rail__label', h('span', 'Samstagsarbeit'),
          h('span.rail__value', satWeeks > 0 ? `${satWeeks} Wochen` : 'aus')),
        h('div.btn-row',
          h(`button.btn.btn--sm${satWeeks === 0 ? '.btn--primary' : ''}`, {
            onclick: () => a.patchConfig({ saturday: { enabledDefault: false } }, null, { clear: ['saturday.weeks'] }),
          }, 'Aus'),
          h('button.btn.btn--sm', { onclick: () => enableSaturdays(a, 4) }, 'Nächste 4 KW'),
          h('button.btn.btn--sm', { onclick: () => enableSaturdays(a, 99) }, 'Alle')),
        h('div.rail__hint', `${Math.round((cfg.saturday.quota ?? 0.2) * 100)} % der Mitarbeiter, `
          + `${cfg.workTime.saturdayHours} h`)),

      slider('Krankenquote', Math.round((cfg.workforce.sickRate ?? 0) * 100), 0, 20, 1,
        (v) => set({ workforce: { sickRate: v / 100 } }),
        { format: (v) => `${v} %`, hint: 'Pauschaler Abzug auf die Besetzung – zusätzlich zur Produktivität' }),

      slider('Produktivität', Math.round(cfg.productivity.global * 100), 60, 110, 1,
        (v) => set({ productivity: { global: v / 100 } }),
        {
          format: (v) => `${v} %`,
          hint: `entspricht ${fmt.num((cfg.workTime.regularHoursPerWeek / 5) * cfg.productivity.global, 1)} `
            + 'produktiven Stunden je Tag',
        })),
    { open: auf('mannschaft'), onToggle: merke('mannschaft'), count: 'Stärke, Zeit, Ausfall' }),

    fold('Plätze und Maschinen', h('div',
      schichtBlock(a, cfg),

      slider('Orbitalschweißer im Einsatz', cfg.resources.welders.default, 0, 10, 1,
        (v) => set({ resources: { welders: { default: v } } }),
        {
          hint: `${cfg.resources.welders.qualified ?? '–'} sind qualifiziert`
            + (cfg.resources.welders.inTraining ? `, davon ${cfg.resources.welders.inTraining} in Ausbildung` : '')
            + ` · 1 Schweißer bedient ${cfg.resources.machinesPerWelder} Maschinen`,
        }),

      slider('Heftplätze', cfg.resources.heftPlaces, 1, cfg.resources.heftPlacesMax, 1,
        (v) => set({ resources: { heftPlaces: v } }),
        { hint: `technisch möglich: ${cfg.resources.heftPlacesMax}` }),

      hydroGroup(a, cfg),
      noboGroup(a, cfg),

      h('div.rail__group',
        h('label.rail__label', h('span', 'Platzgrenzen'),
          h('span.rail__value', cfg.resources.enforcePlaces === false ? 'aus' : 'an')),
        h('div.btn-row',
          h(`button.btn.btn--sm${cfg.resources.enforcePlaces !== false ? '.btn--primary' : ''}`, {
            onclick: () => set({ resources: { enforcePlaces: true } }),
          }, 'An'),
          h(`button.btn.btn--sm${cfg.resources.enforcePlaces === false ? '.btn--primary' : ''}`, {
            onclick: () => set({ resources: { enforcePlaces: false } }),
          }, 'Aus')),
        h('div.rail__hint', 'An: Sägen, Entgraten, Biegen, Beizen, Reinigen und der Prüfstand sind je einmal '
          + 'vorhanden, Vormontage und Endkontrolle zweimal. Aus: nur Personal, Heftplätze und Maschinen begrenzen.'))),
    { open: auf('plaetze'), onToggle: merke('plaetze'), count: 'der gemessene Engpass' }),

    fold('Regeln und Reserven', h('div',
      slider('Aufträge gleichzeitig', cfg.projectLimits.maxParallelProjects, 0, 10, 1,
        (v) => set({ projectLimits: { maxParallelProjects: v } }),
        {
          format: (v) => (v === 0 ? 'unbegrenzt' : String(v)),
          hint: 'Wie viele Aufträge zeitgleich in der Abteilung laufen',
        }),

      slider('Mitarbeiter je Auftrag', cfg.projectLimits.maxWorkersPerProject, 1, 12, 1,
        (v) => set({ projectLimits: { maxWorkersPerProject: v } }),
        { hint: 'Wie viele gleichzeitig an einem Auftrag arbeiten' }),

      slider('Zubehör und Kleinarbeiten', Number(cfg.workforce.reserveHoursPerWeek) || 0, 0, 80, 5,
        (v) => set({ workforce: { reserveHoursPerWeek: v } }),
        {
          format: (v) => `${v} h/Woche`,
          hint: (Number(cfg.workforce.reserveHoursPerWeek) || 0) === 0
            ? 'Adapter, Zuleitungen, Nacharbeit, Muster: Diese Arbeit läuft nebenher, steht aber in keinem '
              + 'Auftrag. Solange hier 0 steht, rechnet die Planung zu optimistisch.'
            : `Gehen vorab von der Kapazität ab – das sind ${fmt.num((Number(cfg.workforce.reserveHoursPerWeek) || 0) / 37.5, 2)} Mitarbeiter.`,
        })),
    { open: auf('regeln'), onToggle: merke('regeln'), count: 'Reihenfolge, Zubehör' }));
}

/** Regler mit Zahl daneben, wirkt sofort. */
function reglerBauer() {
  return (label, value, min, max, step, onChange, opts = {}) => h('div.rail__group',
    h('label.rail__label', h('span', label),
      h('span.rail__value', opts.format ? opts.format(value) : value)),
    h('input', {
      type: 'range', min, max, step, value,
      oninput: (e) => {
        e.target.previousSibling.querySelector('.rail__value').textContent = opts.format
          ? opts.format(Number(e.target.value)) : e.target.value;
      },
      onchange: (e) => onChange(Number(e.target.value)),
    }),
    opts.hint && h('div.rail__hint', opts.hint));
}

/**
 * Personal im Steuerstand.
 *
 * Seit die Mannschaftsliste die Grundlage ist, waeren Regler hier
 * irrefuehrend: Sie wuerden sich bewegen und nichts bewirken. Deshalb steht
 * hier nur, wie stark die Mannschaft in dieser Woche ist - geaendert wird
 * im Bereich "Mannschaft", an genau einer Stelle.
 */
function personalBlock(a, cfg) {
  const team = a.analysis.team;
  const ausListe = cfg.workforce?.team?.source === 'MANNSCHAFT';

  if (!ausListe) {
    return h('div.rail__group',
      h('label.rail__label', h('span', 'Stammmitarbeiter'),
        h('span.rail__value', String(cfg.workforce.baseHeadcount))),
      h('input', {
        type: 'range', min: 0, max: 40, step: 1, value: cfg.workforce.baseHeadcount,
        onchange: (e) => a.patchConfig({ workforce: { baseHeadcount: Number(e.target.value) } }, null),
      }),
      h('div.rail__hint', 'Grundlage der Besetzung sind derzeit die Wochenzahlen. '
        + 'Im Bereich Mannschaft lässt sich auf die Personenliste umstellen.'));
  }

  const leihe = (cfg.workforce?.team?.people ?? []).filter((p) => p.kind === 'LEIHE');
  const leiheAktiv = leihe.filter((p) => p.defaultActive !== false
    || Object.values(p.weeks ?? {}).some(Boolean)).length;

  return h('div.rail__group',
    h('label.rail__label', h('span', 'Mannschaft'),
      h('span.rail__value', `${fmt.num(team?.factor ?? 0, 1)} MA`)),
    h('div.rail__hint',
      `${team?.heads ?? 0} Kürzel anwesend, ${team?.shiftCapable ?? 0} davon schichtfähig`,
      leiheAktiv > 0 ? ` · ${leiheAktiv} Leiharbeiter eingeplant` : ' · keine Leiharbeiter eingeplant'),
    h('div.btn-row', { style: { marginTop: '6px' } },
      h('button.btn.btn--sm', { onclick: () => a.navigate('team') }, 'Mannschaft öffnen'),
      h('button.btn.btn--sm', {
        title: 'Zur Rückfallebene: Besetzung wieder aus den Wochenzahlen',
        onclick: () => a.patchConfig({ workforce: { team: { source: 'ZAHLEN' } } }, 'Grundlage: Wochenzahlen'),
      }, 'Auf Zahlen umstellen')),
    h('div.rail__hint', { style: { marginTop: '6px' } },
      'Personal, Leiharbeiter und Anwesenheit je Kalenderwoche werden in der Mannschaft gepflegt – '
      + 'nur dort, damit es nicht zwei Wahrheiten gibt.'));
}

/**
 * Wochentage der Hydropruefung.
 *
 * Wichtig fuer das Verstaendnis: Gepruefft werden kann nur, wenn BEIDES
 * zusammenfaellt - erlaubter Wochentag UND NoBo vor Ort. Wer die Hydrotage
 * ausweitet, ohne den NoBo mitzunehmen, aendert nichts. Genau das fragt die
 * Anwendung deshalb nach.
 */
function hydroGroup(a, cfg) {
  const tage = cfg.hydro?.allowedWeekdays ?? [2, 3, 4];
  const nobo = cfg.nobo?.weekdays ?? [];
  const schnitt = tage.filter((d) => nobo.includes(d));

  const umschalten = async (tag) => {
    const neu = tage.includes(tag) ? tage.filter((d) => d !== tag) : [...tage, tag].sort();
    if (neu.length === 0) { toast('Mindestens ein Wochentag muss bleiben.', 'error'); return; }
    const fehlt = neu.filter((d) => !nobo.includes(d));
    if (fehlt.length > 0 && !tage.includes(tag)) {
      const mit = await confirmDialog('NoBo mitziehen?',
        `Am ${WOCHENTAGE.filter(([n]) => fehlt.includes(n)).map(([, l]) => l).join(', ')} ist der NoBo bisher nicht da. `
        + 'Ohne ihn darf nicht geprüft werden – die Änderung bliebe wirkungslos. '
        + 'Soll die NoBo-Anwesenheit auf dieselben Tage gesetzt werden?', 'NoBo mitziehen');
      if (mit) {
        await a.patchConfig({ hydro: { allowedWeekdays: neu }, nobo: { weekdays: neu } },
          'Hydrotage und NoBo geändert');
        return;
      }
    }
    await a.patchConfig({ hydro: { allowedWeekdays: neu } }, 'Hydrotage geändert');
  };

  return h('div.rail__group',
    h('label.rail__label', h('span', 'Hydroprüfung an'), h('span.rail__value', `${schnitt.length} Tage nutzbar`)),
    h('div.btn-row', WOCHENTAGE.map(([n, l]) => h(`button.btn.btn--sm${tage.includes(n) ? '.btn--primary' : ''}`, {
      title: nobo.includes(n) ? 'NoBo ist an diesem Tag da' : 'Ohne NoBo – hier kann nicht geprüft werden',
      onclick: () => umschalten(n),
    }, l))),
    h('div.rail__hint', schnitt.length < tage.length
      ? `Nur ${schnitt.length} der ${tage.length} erlaubten Tage sind nutzbar – an den anderen fehlt der NoBo.`
      : 'Geprüft wird nur, wenn der Wochentag erlaubt ist und der NoBo da ist.'));
}

/** Anwesenheit des NoBo als Wochentage. */
function noboGroup(a, cfg) {
  const nobo = cfg.nobo?.weekdays ?? [];
  const umschalten = (tag) => {
    const neu = nobo.includes(tag) ? nobo.filter((d) => d !== tag) : [...nobo, tag].sort();
    a.patchConfig({ nobo: { weekdays: neu } }, 'NoBo-Anwesenheit geändert');
  };
  return h('div.rail__group',
    h('label.rail__label', h('span', 'NoBo anwesend'), h('span.rail__value', `${nobo.length} Tage`)),
    h('div.btn-row', WOCHENTAGE.map(([n, l]) => h(`button.btn.btn--sm${nobo.includes(n) ? '.btn--primary' : ''}`, {
      onclick: () => umschalten(n),
    }, l))),
    h('div.rail__hint', 'Regelanwesenheit. Einzelne Tage werden im NoBo-Kalender unter Einstellungen gepflegt.'));
}

/**
 * Schichten im Steuerstand.
 *
 * Ein einzelner Regler "Belegungszeit je Tag" hat verwirrt: Er stand neben
 * der Schichteinstellung je Arbeitsplatz und beide widersprachen sich.
 * Jetzt gibt es nur noch eine Stelle - die Tabelle unten -, und hier steht,
 * was daraus folgt.
 */
function schichtBlock(a, cfg) {
  const eigene = cfg.resources.byOperation ?? {};
  const allgemein = Number(cfg.resources.operatingHoursPerDay) || 7.5;
  // Keine Rundung auf ganze Schichten: 12 h sind eine versetzte Besetzung,
  // keine zweite Schicht (dieselbe Rechnung wie in engine/plausibilitaet.js).
  const faktor = (stunden) => Math.max(1, (Number(stunden) || 7.5) / 7.5);
  const modell = (stunden) => {
    const f = faktor(stunden);
    if (f >= 2.9) return '3 Schichten';
    if (f >= 1.9) return '2 Schichten';
    return `versetzt ${fmt.num(Number(stunden), 1)} h`;
  };

  const eigenerWert = (w) => w?.operatingHours != null && w.operatingHours !== '';
  const mitEigenem = Object.entries(eigene)
    .filter(([, w]) => eigenerWert(w) && faktor(w.operatingHours) > 1.05)
    .map(([opId, w]) => `${opName(a, opId)} (${modell(w.operatingHours)})`);
  const ueberAllgemein = Object.entries(eigene).filter(([, w]) => !eigenerWert(w)).length;
  const allgemeinLaenger = faktor(allgemein) > 1.05;
  const team = a.analysis.team;
  const hoechste = Math.max(faktor(allgemein), ...Object.values(eigene)
    .map((w) => (eigenerWert(w) ? faktor(w.operatingHours) : 1)));

  const wert = allgemeinLaenger
    ? `${fmt.num(allgemein, 1)} h allgemein`
    : mitEigenem.length === 0 ? 'einschichtig' : `${mitEigenem.length} Arbeitsplätze`;

  return h('div.rail__group',
    h('label.rail__label', h('span', 'Schichten'), h('span.rail__value', wert)),
    h('div.rail__hint',
      allgemeinLaenger
        // Der haeufigste Irrtum: Ein einziger allgemeiner Wert laesst JEDEN
        // Arbeitsgang mehrschichtig aussehen, ohne dass jemand ihn einzeln
        // umgestellt hat. Deshalb steht hier, woher der Wert kommt.
        ? `Die Plätze sind ${fmt.num(allgemein, 1)} h am Tag besetzt (${modell(allgemein)}) – das gilt `
          + `für ${ueberAllgemein} Arbeitsgänge ohne eigenen Wert. Geändert wird das unter `
          + 'Einstellungen → Parameter, Feld „Belegungszeit der Plätze je Tag".'
        : mitEigenem.length === 0
          ? 'Alle Arbeitsplätze laufen einschichtig. Mehrschichtig wird je Arbeitsplatz unter '
            + 'Übersicht → Engpässe & Wirkung eingestellt, Tabelle „Belegungszeit und Plätze je Arbeitsgang".'
          : `${mitEigenem.join(', ')}. Eingestellt unter Übersicht → Engpässe & Wirkung.`),
    mitEigenem.length > 0 && allgemeinLaenger && h('div.rail__hint', { style: { marginTop: '4px' } },
      `Mit eigenem Wert: ${mitEigenem.join(', ')}.`),
    hoechste > 1.05 && team && h('div.rail__hint', { style: { marginTop: '4px' } },
      `Schichtfähig sind ${team.shiftCapable} von ${team.shiftTotal ?? team.heads} eingeplanten Personen`,
      team.shiftBlocked?.length ? ` (keine Schicht: ${team.shiftBlocked.join(', ')})` : '',
      '. Eine längere Belegungszeit erzeugt keine zusätzlichen Mitarbeiterstunden – sie verteilt '
      + 'dieselben Stunden über mehr Zeit.'));
}


/**
 * Hinweis unter dem Regler „Stammmitarbeiter".
 *
 * Wichtig fuer das Verstaendnis: Solange fuer einzelne Kalenderwochen eigene
 * Werte gepflegt sind, wirkt der Regler dort NICHT. Ohne diesen Hinweis sieht
 * es aus, als haette der Regler keine Wirkung.
 */
/**
 * Stand speichern: Name und Pflichtnotiz.
 * Der Stand ist sofort fuer alle Kollegen sichtbar (Bereich "Stände").
 */
function saveStateDialog(a) {
  let name = `Stand ${new Date().toLocaleDateString('de-DE')}`;
  let note = '';
  const m = modal({
    title: 'Aktuellen Stand speichern',
    body: h('div',
      h('div.small.muted', { style: { marginBottom: '10px' } },
        'Gespeichert wird der komplette Datenbestand – Aufträge, Arbeitsfolgen und alle Stellschrauben. '
        + 'Die Kollegen sehen den Stand sofort im Bereich „Stände".'),
      h('label.field', h('span', 'Name'),
        h('input', { type: 'text', value: name, oninput: (e) => { name = e.target.value; } })),
      h('label.field', h('span', 'Notiz – was wurde gemacht? (Pflicht)'),
        h('input', {
          type: 'text', placeholder: 'z. B. 3 Leiharbeiter ab KW 42 eingeplant',
          oninput: (e) => { note = e.target.value; },
        }))),
    actions: [
      h('button.btn', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.btn--primary', {
        onclick: async () => {
          if (!note.trim()) { toast('Bitte kurz eintragen, worum es bei diesem Stand geht.', 'error'); return; }
          try {
            await api.saveState({ name, note });
            m.close();
            toast('Stand gespeichert – die Kollegen sehen ihn sofort.', 'ok');
            await a.reload();
          } catch { /* Meldung kommt aus der Schnittstelle */ }
        },
      }, 'Stand speichern'),
    ],
  });
}


async function enableSaturdays(a, count) {
  const weeks = {};
  for (const w of a.analysis.weeks.slice(0, count)) weeks[w.weekKey] = { enabled: true };
  await a.patchConfig({ saturday: { weeks } }, null);
}

/** Name eines Arbeitsganges. */
function opName(a, opId) {
  return a.analysis.processUtilization?.find((p) => p.opId === opId)?.name
    ?? a.state?.catalog?.operations?.find((o) => o.id === opId)?.name
    ?? opId;
}
