/**
 * Mannschaft des Armaturenbaus: wer ist da und wer darf was.
 *
 * Bis hierher rechnete die Anwendung nur mit Zahlen ("9 Mitarbeiter, davon
 * 4 Orbitalschweisser"). Das reicht fuer die Kapazitaet, beantwortet aber
 * zwei Fragen nicht: Wer genau kann einen Arbeitsgang uebernehmen, und was
 * macht der Einzelne in welcher Woche?
 *
 * Deshalb gibt es hier eine Mannschaftsliste mit Kuerzeln, einer
 * Qualifikationsmatrix (Haken je Arbeitsgang), Schichtfaehigkeit und
 * Abwesenheiten. Klarnamen werden bewusst nicht gefuehrt.
 *
 * Zwei Grundlagen der Besetzung sind moeglich:
 *   ZAHLEN      - die Staerke kommt wie bisher aus den Wochenwerten
 *                 (Urlaube sind dort bereits eingerechnet).
 *   MANNSCHAFT  - die Staerke ergibt sich aus der Liste: anwesende
 *                 Personen mal ihrem Zeitanteil.
 * Die Qualifikationsmatrix wirkt in BEIDEN Faellen.
 */

import { OPERATIONS } from './model.js';
import { weekKey, weekStart, addDays } from './calendar.js';

/** Schichten laut Betrieb (7,5 h je Schicht). */
export const SHIFTS = [
  { id: 'FRUEH', name: 'Frühschicht', from: '06:00', to: '14:00' },
  { id: 'SPAET', name: 'Spätschicht', from: '14:00', to: '22:00' },
  { id: 'NACHT', name: 'Nachtschicht', from: '22:00', to: '06:00' },
];

/** Abwesenheitsarten. */
export const ABSENCE_KINDS = {
  URLAUB: 'Urlaub',
  KRANK: 'Krank',
  SCHULUNG: 'Schulung',
  /** Demontage: an eine andere Abteilung verliehen (Kuerzel DM der Urlaubsplanung) */
  VERLEIH: 'Demontage (verliehen)',
  SONST: 'Sonstiges',
};

/*
 * Skill-Level statt Ja/Nein (Nutzerauftrag 23.09.2026: "ein skill level für
 * MA an den verschiedenen Arbeitsplätzen ... Wenn MA xy mit dem besten
 * skill nicht da ist wird er durch denjenigen mit dem nächst höheren
 * ersetzt"). Wirkt NUR auf die Rangfolge, wer zuerst eingeteilt wird - die
 * Bearbeitungszeit bleibt fuer alle Stufen gleich (Nutzerentscheidung).
 *
 * 0 gilt als "nicht qualifiziert" - identisch zum bisherigen `false`, jeder
 * truthy-Check (`p.skills?.[opId]`) funktioniert dadurch unveraendert.
 */
export const SKILL_LEVELS = {
  0: 'nicht qualifiziert',
  1: 'Grundkenntnisse',
  2: 'Fortgeschritten',
  3: 'Experte',
};

/**
 * Alle Arbeitsgaenge auf Skill-Level `value`.
 *
 * `value=2` (Fortgeschritten) als Startwert entspricht dem bisherigen
 * `true` ("kann") - eine unbelegte Annahme, kein Messwert. Echte Stufen je
 * Person muessen von der Abteilung noch gepflegt werden (siehe
 * docs/ZU-VALIDIEREN.md).
 */
function allSkills(value = 2) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const op of OPERATIONS) out[op.id] = value;
  return out;
}

/** Art der Zugehoerigkeit - entscheidet ueber Kostensatz und Einarbeitung. */
export const PERSON_KINDS = {
  STAMM: 'Stammmitarbeiter',
  LEIHE: 'Leiharbeiter',
  NEU: 'Neueinstellung',
};

/** Moegliche Zeitanteile (FTE). */
export const FACTORS = [0.25, 0.5, 0.75, 1];

/**
 * @param {string} id
 * @param {{role?:string, factor?:number, shiftCapable?:boolean, note?:string,
 *   kind?:string, rate?:number, defaultActive?:boolean, label?:string,
 *   startDate?:string|null, endDate?:string|null}} [o]
 */
function person(id, o = {}) {
  return {
    id,
    /** Frei aenderbarer Name - bei Leiharbeitern der tatsaechliche Name */
    label: o.label ?? '',
    role: o.role ?? '',
    kind: o.kind ?? 'STAMM',
    /** Zeitanteil (FTE): 1 = voll, 0,5 = halb (Vorarbeiter) */
    factor: o.factor ?? 1,
    /** Kostensatz je Stunde */
    rate: o.rate ?? null,
    /** Darf in Spaet- und Nachtschicht eingesetzt werden */
    shiftCapable: o.shiftCapable !== false,
    skills: allSkills(),
    /** @type {{from:string, to:string, kind:string, note?:string}[]} */
    absences: [],
    /**
     * Anwesenheit je Kalenderwoche. Nur Abweichungen stehen hier drin -
     * alles andere folgt `defaultActive`. Stammleute sind grundsaetzlich
     * da, Leiharbeiter grundsaetzlich nicht (sie werden wochenweise
     * dazugeschaltet).
     * @type {Record<string, boolean>}
     */
    weeks: {},
    /**
     * Von Hand gesetzte Schicht je Kalenderwoche (1 = frueh, 2 = spaet,
     * 3 = nacht). Nutzerauftrag (23.09.2026): "ich brauche noch die
     * Moeglichkeit die Mitarbeiter KW weise in Schichten einzuplanen."
     * Nur Abweichungen stehen hier drin - ohne Eintrag rotiert die Person
     * weiter automatisch (siehe schichtplan.js, wochenSchichten). Nur fuer
     * schichtfaehige Personen wirksam.
     * @type {Record<string, number>}
     */
    shiftWeeks: {},
    /**
     * Einsatzfenster. Vor `startDate` und nach `endDate` ist die Person
     * nicht verfuegbar - auch dann nicht, wenn eine Woche angehakt ist.
     * Ohne Fenster gilt die Person als dauerhaft im Haus.
     */
    startDate: o.startDate ?? null,
    endDate: o.endDate ?? null,
    defaultActive: o.defaultActive !== false,
    active: true,
    note: o.note ?? '',
  };
}

/**
 * Mannschaft laut Auskunft der Abteilungsleitung (Stand 09/2026):
 * 8,5 Mitarbeiter, davon der Vorarbeiter zur Haelfte in der Fertigung.
 * STWUE und MAAP fahren keine Schicht.
 *
 * Die Qualifikationen stehen bewusst zunaechst alle auf "kann" - wer was
 * NICHT darf, wird in der Matrix abgehakt. Erfunden wird hier nichts.
 *
 * Nutzerbestaetigung (26.09.2026, Tabelle der Abteilungsleitung): STWUE,
 * MAAP, JARO, SIDR, SYLA, KEBE, MAJE, LURO und TOBE sind Stammmitarbeiter.
 * `kind: 'STAMM'` steht hier bei jeder Person ausdruecklich, damit es nicht
 * nur ueber den Vorgabewert in `person()` gilt, sondern im Datensatz selbst
 * nachlesbar ist.
 */
/**
 * Tatsaechlich zugesagte Leiharbeiter (Auskunft der Abteilungsleitung am
 * 15.09.2026: "Heute 2 Leiharbeiter. Montag noch einer und am 01.10 kommen
 * die naechsten 2 - also real").
 *
 * Sie sind ab ihrem Eintritt dauerhaft eingeplant. Wie lange der Einsatz
 * laeuft, ist nicht bekannt - deshalb steht kein Ende drin, und die
 * Plausibilitaetspruefung weist darauf hin.
 */
export const ZUGESAGTE_LEIHE = {
  'LEIHE-01': '2026-09-15',
  'LEIHE-02': '2026-09-15',
  'LEIHE-03': '2026-09-21',
  'LEIHE-04': '2026-10-01',
  'LEIHE-05': '2026-10-01',
};

export function defaultTeam() {
  const leihe = [];
  for (let n = 1; n <= 15; n++) {
    const id = `LEIHE-${String(n).padStart(2, '0')}`;
    const start = ZUGESAGTE_LEIHE[id] ?? null;
    leihe.push(person(id, {
      label: `Leiharbeiter ${n}`,
      kind: 'LEIHE',
      rate: 55,
      // Zugesagte Leiharbeiter sind ab ihrem Eintritt da. Alle weiteren
      // sind Platzhalter und nur in den Wochen eingeplant, die
      // ausdruecklich angehakt werden.
      defaultActive: start != null,
      startDate: start,
      note: start ? `Eintritt ${start} – zugesagt, Einsatzende offen` : '',
    }));
  }
  return {
    /**
     * Grundlage der Besetzung. 'MANNSCHAFT' rechnet aus dieser Liste -
     * seit die Anwesenheit je Kalenderwoche gepflegt wird, ist das die
     * genauere Angabe. 'ZAHLEN' bleibt als Rueckfallebene.
     */
    source: 'MANNSCHAFT',
    /** Qualifikationen hart rechnen (ein Arbeitsgang wartet ohne Qualifizierte) */
    enforceSkills: true,
    validated: false,
    people: [
      person('STWUE', { kind: 'STAMM', role: 'Vorarbeiter', factor: 0.5, shiftCapable: false, note: 'zur Hälfte in der Fertigung' }),
      person('MAAP', { kind: 'STAMM', shiftCapable: false }),
      person('JARO', { kind: 'STAMM' }),
      person('SIDR', { kind: 'STAMM' }),
      person('SYLA', { kind: 'STAMM' }),
      person('KEBE', { kind: 'STAMM' }),
      person('MAJE', { kind: 'STAMM' }),
      person('LURO', { kind: 'STAMM' }),
      person('TOBE', { kind: 'STAMM' }),
      ...leihe,
    ],
  };
}

/** Liste der Personen eines Standes (leer, wenn keine Mannschaft gepflegt ist). */
export function peopleOf(config) {
  const list = config?.workforce?.team?.people;
  return Array.isArray(list) ? list.filter((p) => p && p.active !== false) : [];
}

/**
 * Ist die Person an diesem Tag da?
 * @param {any} p @param {string} date
 */
export function personPresent(p, date) {
  // 1. Ist die Person in dieser Kalenderwoche ueberhaupt eingeplant?
  if (!weekActive(p, date)) return false;
  // 2. Urlaub, Krankheit, Schulung
  for (const a of p.absences ?? []) {
    if (!a?.from) continue;
    const to = a.to || a.from;
    if (date >= a.from && date <= to) return false;
  }
  return true;
}

/**
 * Ist die Person in der Kalenderwoche dieses Tages eingeplant?
 * Nur Abweichungen stehen in `weeks`, alles andere folgt `defaultActive`.
 * @param {any} p @param {string} date
 */
export function weekActive(p, date) {
  if (p.active === false) return false;
  // Das Einsatzfenster ist hart: wer erst naechsten Monat anfaengt, kann
  // diese Woche nicht arbeiten - auch wenn die Woche angehakt waere.
  if (!inEngagement(p, date)) return false;
  const wk = weekKey(date);
  const eigen = p.weeks?.[wk];
  if (typeof eigen === 'boolean') return eigen;
  return p.defaultActive !== false;
}

/**
 * Liegt der Tag im Einsatzfenster der Person?
 * @param {any} p @param {string} date
 */
export function inEngagement(p, date) {
  if (p?.startDate && date < p.startDate) return false;
  if (p?.endDate && date > p.endDate) return false;
  return true;
}

/**
 * Wochen, in denen die Person eingeplant ist - fuer die Matrix in der
 * Oberflaeche.
 * @param {any} p @param {string[]} wochen
 */
export function weekFlags(p, wochen) {
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const wk of wochen) {
    const eigen = p.weeks?.[wk];
    const an = typeof eigen === 'boolean' ? eigen : p.defaultActive !== false;
    // Wochen ausserhalb des Einsatzfensters sind nie angehakt.
    out[wk] = an && weekInEngagement(p, wk);
  }
  return out;
}

/**
 * Beruehrt die Kalenderwoche das Einsatzfenster der Person?
 * @param {any} p @param {string} wk
 */
export function weekInEngagement(p, wk) {
  if (!p?.startDate && !p?.endDate) return true;
  let montag;
  try { montag = weekStart(wk); } catch { return true; }
  const freitag = addDays(montag, 4);
  if (p.startDate && freitag < p.startDate) return false;
  if (p.endDate && montag > p.endDate) return false;
  return true;
}

/** Abwesenheit einer Person an einem Tag (oder null). */
export function absenceOn(p, date) {
  for (const a of p.absences ?? []) {
    if (!a?.from) continue;
    const to = a.to || a.from;
    if (date >= a.from && date <= to) return a;
  }
  return null;
}

/**
 * Mannschaft an einem Tag.
 * @param {any} config @param {string} date
 * @returns {{factor:number, heads:number, present:any[], absent:any[], byOp:Record<string,{factor:number, heads:number, ids:string[]}>}}
 */
/**
 * Ramp-bereinigter Zeitanteil einer Person an einem Tag - dieselbe Formel,
 * die `teamOn` fuer die Anteilsrechnung verwendet. Eigens exportiert, damit
 * die Terminierung (engine/scheduler.js) je Person ein echtes,
 * arbeitsgangUEBERGREIFENDES Tagesstundenkonto fuehren kann: dieselbe
 * Person darf nicht in zwei Arbeitsgaengen gleichzeitig stecken.
 * @param {any} config @param {any} p @param {string} date
 */
export function personEffectiveFactor(config, p, date) {
  return (Number(p.factor ?? 1) || 0) * rampOf(config, p, date);
}

export function teamOn(config, date) {
  const people = peopleOf(config);
  const present = [];
  const absent = [];
  for (const p of people) (personPresent(p, date) ? present : absent).push(p);

  /** @type {Record<string, {factor:number, heads:number, ids:string[]}>} */
  const byOp = {};
  for (const op of OPERATIONS) byOp[op.id] = { factor: 0, heads: 0, ids: [] };
  let factor = 0;
  for (const p of present) {
    // Leiharbeiter und Neueinstellungen leisten in den ersten Wochen
    // weniger (40/60/80 %). Ohne das waere jeder Neue ab Tag eins voll
    // eingerechnet - und der Plan zu optimistisch.
    const f = personEffectiveFactor(config, p, date);
    factor += f;
    for (const op of OPERATIONS) {
      if (p.skills?.[op.id]) {
        byOp[op.id].factor += f;
        byOp[op.id].heads += 1;
        byOp[op.id].ids.push(p.id);
      }
    }
  }
  return { factor: round2(factor), heads: present.length, present, absent, byOp };
}

/**
 * Anteil der Mannschaft, der einen Arbeitsgang uebernehmen kann.
 *
 * Genau dieser Anteil begrenzt die Kapazitaet des Arbeitsganges - unabhaengig
 * davon, ob die Staerke aus den Wochenwerten oder aus der Liste kommt. Ohne
 * gepflegte Mannschaft bleibt es bei den Werten unter "Qualifikationen".
 *
 * @param {any} config @param {string} date
 * @returns {Record<string, number>|null}
 */
export function skillShares(config, date) {
  const team = config?.workforce?.team;
  if (!team || team.enforceSkills === false) return null;
  const on = teamOn(config, date);
  if (on.factor <= 0) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const op of OPERATIONS) out[op.id] = on.byOp[op.id].factor / on.factor;
  return out;
}

/**
 * Schichtfaehigkeit der Mannschaft - fuer den Hinweis im Steuerstand.
 * @param {any} config
 */
export function shiftCapability(config, date = null) {
  // Nur wer ueberhaupt eingeplant ist, zaehlt: Leiharbeiter ohne
  // angehakte Woche stehen nicht zur Verfuegung.
  const people = date
    ? teamOn(config, date).present
    : peopleOf(config).filter((p) => p.defaultActive !== false
      || Object.values(p.weeks ?? {}).some(Boolean));
  const capable = people.filter((p) => p.shiftCapable !== false);
  return {
    total: people.length,
    capable: capable.length,
    capableIds: capable.map((p) => p.id),
    blockedIds: people.filter((p) => p.shiftCapable === false).map((p) => p.id),
    factor: round2(capable.reduce((a, p) => a + (Number(p.factor ?? 1) || 0), 0)),
  };
}

/** Wie viele Personen koennen einen Arbeitsgang, unabhaengig von Abwesenheiten? */
export function qualifiedFor(config, opId) {
  return peopleOf(config).filter((p) => p.skills?.[opId]).map((p) => p.id);
}

/**
 * Erste Kalenderwoche, in der die Person eingeplant ist.
 * Bei Stammleuten ohne Eintrittsdatum: keine - sie sind eingearbeitet.
 * @param {any} p
 */
export function firstWeekOf(p) {
  if (p.startDate) return weekKey(p.startDate);
  const angehakt = Object.entries(p.weeks ?? {}).filter(([, an]) => an).map(([wk]) => wk).sort();
  return angehakt[0] ?? null;
}

/**
 * Einarbeitungsfaktor einer Person an einem Tag.
 *
 * Gilt nur fuer Leiharbeiter und Neueinstellungen und nur, solange die
 * Kurve laeuft (Vorgabe 40/60/80 %, dann 100 %). Stammleute stehen immer
 * auf 1.
 *
 * @param {any} config @param {any} p @param {string} date
 */
export function rampOf(config, p, date) {
  if (p.kind !== 'LEIHE' && p.kind !== 'NEU') return 1;
  const start = firstWeekOf(p);
  if (!start) return 1;
  const kurve = p.kind === 'LEIHE'
    ? config?.workforce?.rampUp?.temp
    : config?.workforce?.rampUp?.hire;
  if (!Array.isArray(kurve) || kurve.length === 0) return 1;
  const wochen = weeksBetween(start, weekKey(date));
  if (wochen < 0) return 0;
  if (wochen >= kurve.length) return 1;
  const v = Number(kurve[wochen]);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/**
 * Betreuungsstunden je Woche, die die Mannschaft fuer Neue aufwendet.
 * Sie fehlen in der Fertigung - deshalb werden sie abgezogen.
 * @param {any} config @param {string} date
 */
export function mentoringHoursOfTeam(config, date) {
  const kurven = config?.workforce?.rampUp?.mentoringHoursPerWeek ?? {};
  let stunden = 0;
  for (const p of peopleOf(config)) {
    if (p.kind !== 'LEIHE' && p.kind !== 'NEU') continue;
    if (!personPresent(p, date)) continue;
    const start = firstWeekOf(p);
    if (!start) continue;
    const kurve = p.kind === 'LEIHE' ? kurven.temp : kurven.hire;
    if (!Array.isArray(kurve)) continue;
    const wochen = weeksBetween(start, weekKey(date));
    if (wochen < 0 || wochen >= kurve.length) continue;
    const h = Number(kurve[wochen]);
    if (Number.isFinite(h)) stunden += h;
  }
  return round2(stunden);
}

/** Abstand zweier Kalenderwochen in Wochen (grob, ueber das Jahr hinweg). */
function weeksBetween(von, bis) {
  const zahl = (wk) => {
    const [jahr, woche] = String(wk).split('-W');
    return Number(jahr) * 53 + Number(woche);
  };
  return zahl(bis) - zahl(von);
}

/**
 * Stundensatz einer Person: eigener Wert, sonst der Satz ihrer Art.
 * @param {any} config @param {any} p
 */
export function rateOf(config, p) {
  if (p?.rate != null && p.rate !== '') return Number(p.rate);
  const c = config?.costs ?? {};
  if (p?.kind === 'LEIHE') return Number(c.tempRate ?? 55);
  return Number(c.baseRate ?? 22.5);
}

/** Mittlerer Stundensatz der an diesem Tag anwesenden Mannschaft. */
export function averageRate(config, date) {
  const on = teamOn(config, date);
  let stunden = 0;
  let kosten = 0;
  for (const p of on.present) {
    const f = Number(p.factor ?? 1) || 0;
    stunden += f;
    kosten += f * rateOf(config, p);
  }
  return stunden > 0 ? round2(kosten / stunden) : Number(config?.costs?.baseRate ?? 22.5);
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Zusaetzliche Leiharbeiter in die MANNSCHAFT eintragen.
 *
 * Vorgabe der Abteilungsleitung (17.09.2026): "Wenn zusaetzliches Personal
 * dazu kommen muss, moechte ich eine Meldung bekommen und das rein ueber
 * den Reiter Mannschaft anpassen."
 *
 * Deshalb gibt es nur noch EINEN Weg, Personal in die Rechnung zu bringen:
 * die Mannschaftsliste. Die Bedarfsrechnung und die Vorschlaege aus "Was
 * bringt wirklich etwas?" muessen aber weiter durchspielen koennen, was
 * zusaetzliche Leute braechten - sie benutzen dafuer diese Funktion auf
 * einer KOPIE. Frei vorhandene Leiharbeiterplaetze werden zuerst genutzt;
 * reichen sie nicht, kommen weitere Kuerzel dazu.
 *
 * @param {any} config Ausgangsstand (bleibt unveraendert)
 * @param {number} anzahl wie viele Personen zusaetzlich
 * @param {string} ab Eintrittsdatum (ISO)
 * @param {{kind?:string, label?:string, ohneEinarbeitung?:boolean}} [opts]
 * @returns {any} veraenderte Kopie
 */
export function mitZusatzPersonal(config, anzahl, ab, opts = {}) {
  const c = JSON.parse(JSON.stringify(config));
  const n = Math.max(0, Math.round(Number(anzahl) || 0));
  if (n === 0) return c;
  const art = opts.kind ?? 'LEIHE';
  c.workforce ??= {};
  c.workforce.team ??= {};
  const leute = (c.workforce.team.people ??= []);

  /*
   * Volle Leistung ab dem ersten Tag, wenn ausdruecklich gewuenscht: Die
   * Bedarfsrechnung soll zeigen, wie viel KAPAZITAET fehlt - nicht, wie
   * lange eine Einarbeitung dauert.
   */
  if (opts.ohneEinarbeitung) {
    c.workforce.rampUp = {
      ...(c.workforce.rampUp ?? {}),
      temp: [], hire: [],
      mentoringHoursPerWeek: { ...(c.workforce.rampUp?.mentoringHoursPerWeek ?? {}), temp: [], hire: [] },
    };
  }

  let offen = n;
  // 1. freie Plaetze nutzen
  for (const p of leute) {
    if (offen === 0) break;
    if (p.kind !== art) continue;
    if (p.startDate || Object.values(p.weeks ?? {}).some(Boolean)) continue;
    p.startDate = ab;
    p.defaultActive = true;
    p.note = opts.label ?? p.note ?? '';
    offen -= 1;
  }
  // 2. fehlende Plaetze anlegen
  let nummer = leute.length + 1;
  while (offen > 0) {
    const id = `${art === 'NEU' ? 'NEU' : 'LEIHE'}-${String(nummer).padStart(2, '0')}`;
    nummer += 1;
    if (leute.some((p) => p.id === id)) continue;
    leute.push({
      ...person(id, {
        label: opts.label ?? (art === 'NEU' ? 'Neueinstellung' : 'Leiharbeiter'),
        kind: art,
        rate: art === 'LEIHE' ? 55 : null,
        startDate: ab,
        defaultActive: true,
      }),
    });
    offen -= 1;
  }
  return c;
}
