/**
 * Kapazitaetsrechnung auf Tagesebene.
 *
 * Grundsatz (Lastenheft §3): Es darf ausschliesslich die tatsaechlich
 * vorhandene Kapazitaet verbraucht werden. Diese Datei liefert je Kalendertag
 * die verfuegbaren Mannstunden (Pool), die arbeitsgangbezogenen Obergrenzen
 * sowie die Prozessressourcen (Heftplaetze, Orbitalmaschinen, Schweisser,
 * Hydro-Prüfstand, NoBo).
 */

import { OPERATIONS, OPERATION_BY_ID, round2 } from './model.js';
import {
  teamOn, skillShares, mentoringHoursOfTeam, personEffectiveFactor,
} from './team.js';
import { weekday, weekKey, diffDays, mondayOf } from './calendar.js';

/** @type {{REGULAR:'REGULAR', SATURDAY:'SATURDAY', OFF:'OFF'}} */
export const DAY_KIND = { REGULAR: 'REGULAR', SATURDAY: 'SATURDAY', OFF: 'OFF' };

/** Limitierende Faktoren (fuer Engpass-/Ursachenanalyse). */
export const LIMITER = {
  POOL: 'POOL',                 // allgemeine Mannstunden
  SKILL: 'SKILL',               // Qualifikation/Personal je Arbeitsgang
  HEFTPLATZ: 'HEFTPLATZ',
  ORBITAL_MACHINE: 'ORBITAL_MACHINE',
  ORBITAL_WELDER: 'ORBITAL_WELDER',
  HYDRO_STATION: 'HYDRO_STATION',
  HYDRO_WINDOW: 'HYDRO_WINDOW', // Di-Do Regel
  OP_WINDOW: 'OP_WINDOW',       // Wochentagsregel der Abteilung
  WORKPLACE: 'WORKPLACE',       // Plaetze des Arbeitsganges belegt
  NOBO: 'NOBO',
  BEIZ_STATION: 'BEIZ_STATION',
  PROJECT_LIMIT: 'PROJECT_LIMIT',
  PREDECESSOR: 'PREDECESSOR',
  TACK_LEAD: 'TACK_LEAD',
  MATERIAL: 'MATERIAL',
  RELEASE: 'RELEASE',
  PARALLEL_PROJECTS: 'PARALLEL_PROJECTS',
  NONE: 'NONE',
};

export const LIMITER_LABEL = {
  POOL: 'Mitarbeiterstunden',
  SKILL: 'Einsetzbare Mitarbeiter',
  HEFTPLATZ: 'Heftplätze',
  ORBITAL_MACHINE: 'Orbitalmaschinen',
  ORBITAL_WELDER: 'Orbitalschweißer',
  HYDRO_STATION: 'Hydro-Prüfstand',
  HYDRO_WINDOW: 'Hydro nur Di–Do',
  OP_WINDOW: 'Wochentagsregel',
  WORKPLACE: 'Arbeitsplätze',
  NOBO: 'NoBo nicht anwesend',
  BEIZ_STATION: 'Beizplatz',
  PROJECT_LIMIT: 'Mitarbeiter je Auftrag',
  PREDECESSOR: 'Vorgänger nicht fertig',
  TACK_LEAD: 'Heftvorsprung',
  MATERIAL: 'Material',
  RELEASE: 'Startfreigabe',
  PARALLEL_PROJECTS: 'Aufträge gleichzeitig',
  NONE: 'Keine Einschränkung',
};

/** Ausfuehrliche Erklaerung des Engpasses (fuer Hinweistexte). */
export const LIMITER_HELP = {
  POOL: 'Die verfügbaren Mitarbeiterstunden des Tages waren aufgebraucht.',
  SKILL: 'Es standen zu wenige für diesen Arbeitsgang einsetzbare Mitarbeiter bereit.',
  HEFTPLATZ: 'Alle Heftplätze waren belegt.',
  ORBITAL_MACHINE: 'Die Orbitalmaschinen waren ausgelastet – je Schweißer können nur zwei Maschinen laufen.',
  ORBITAL_WELDER: 'Es waren zu wenige Orbitalschweißer im Einsatz.',
  HYDRO_STATION: 'Der Hydro-Prüfstand war belegt.',
  HYDRO_WINDOW: 'Hydroprüfung ist nur Dienstag bis Donnerstag möglich.',
  OP_WINDOW: 'Eine Regel der Abteilung lässt diesen Arbeitsgang an diesem Wochentag nicht zu.',
  WORKPLACE: 'Die Plätze dieses Arbeitsganges waren für die eingestellte Belegungszeit ausgelastet.',
  NOBO: 'Der NoBo war an diesem Tag nicht anwesend.',
  BEIZ_STATION: 'Der Beizplatz war belegt.',
  PROJECT_LIMIT: 'Es dürfen nur begrenzt viele Mitarbeiter gleichzeitig an einem Auftrag arbeiten.',
  PREDECESSOR: 'Der vorherige Arbeitsgang war noch nicht fertig.',
  TACK_LEAD: 'Heften und Orbitalschweißen müssen einen Abstand halten.',
  MATERIAL: 'Das Material war noch nicht verfügbar.',
  RELEASE: 'Der Auftrag war noch nicht zur Fertigung freigegeben.',
  PARALLEL_PROJECTS: 'Es dürfen nur begrenzt viele Aufträge gleichzeitig laufen.',
  NONE: '',
};

/**
 * Einarbeitungsfaktor.
 * @param {number[]} curve Faktoren fuer Woche 1..n, danach 1.0
 * @param {number} weeksSinceStart 0 = erste Woche
 */
export function rampFactor(curve, weeksSinceStart) {
  if (!Array.isArray(curve) || curve.length === 0) return 1;
  if (weeksSinceStart < 0) return 0;
  if (weeksSinceStart >= curve.length) return 1;
  const v = Number(curve[weeksSinceStart]);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/**
 * Wochenspezifische Uebersteuerung.
 * @param {any} config @param {string} date
 */
function weeklyOverride(config, date) {
  return config.workforce?.weekly?.[weekKey(date)] ?? {};
}

/**
 * Ist an diesem Tag Samstagsarbeit aktiviert?
 * @param {any} config @param {string} date
 */
export function saturdayActive(config, date) {
  if (weekday(date) !== 6) return false;
  const cfg = config.saturday ?? {};
  const w = cfg.weeks?.[weekKey(date)];
  if (w && typeof w.enabled === 'boolean') return w.enabled;
  return !!cfg.enabledDefault;
}

/**
 * Tagesart bestimmen.
 * @param {any} config @param {string} date
 * @returns {'REGULAR'|'SATURDAY'|'OFF'}
 */
export function dayKind(config, date) {
  if (Array.isArray(config.holidays) && config.holidays.includes(date)) return DAY_KIND.OFF;
  const wd = weekday(date);
  const workDays = config.workTime?.workDays ?? [1, 2, 3, 4, 5];
  if (workDays.includes(wd)) return DAY_KIND.REGULAR;
  if (wd === 6 && saturdayActive(config, date)) return DAY_KIND.SATURDAY;
  return DAY_KIND.OFF;
}

/**
 * Personalstaerke eines Tages (Koepfe, einschliesslich Einarbeitungsgewichtung).
 * @param {any} config @param {string} date
 */
export function headcountFor(config, date) {
  const wf = config.workforce ?? {};
  const ov = weeklyOverride(config, date);
  const monday = mondayOf(date);

  /*
   * Grundlage der Besetzung. "MANNSCHAFT" rechnet aus der Personenliste:
   * anwesende Personen mal ihrem Zeitanteil (der Vorarbeiter mit 0,5).
   * Sonst bleibt es bei den Wochenwerten der bisherigen Planung, in denen
   * Urlaube bereits eingerechnet sind.
   */
  /*
   * Rangfolge der Besetzung:
   *   1. Tageswert aus der Liste der Abteilungsleitung (gemessene
   *      Wirklichkeit, bereits um 1 korrigiert) - er schlaegt alles.
   *   2. Mannschaftsliste (Anwesenheit je Kalenderwoche).
   *   3. Wochenzahlen der bisherigen Excel-Planung.
   * Ohne diese Rangfolge wuerde die Anwendung ueber vorhandene Messwerte
   * hinweg mit einer Annahme rechnen.
   */
  /*
   * Messwerte gelten nur BIS ZUM STICHTAG.
   *
   * Vorgabe der Abteilungsleitung (15.09.2026): "ab morgen Mannschaft -
   * sonst haengt die Zukunft an einer Liste, die niemand mehr pflegt."
   * Die Tagesliste reicht zwar weiter in die Zukunft, aber die dortigen
   * Werte sind Vorausschau, nicht Messung. Ab dem Stichtag rechnet die
   * Anwendung aus der Mannschaft - dort stehen Eintritte, Urlaube und
   * Abwesenheiten.
   */
  const stichtag = config.planningDate;
  const tageswert = (wf.useDailyAvailable === false || (stichtag && date > stichtag))
    ? undefined
    : wf.dailyAvailable?.[date];
  const ausListe = wf.team?.source === 'MANNSCHAFT';
  const team = ausListe ? teamOn(config, date) : null;
  const base = tageswert != null
    ? Number(tageswert)
    : (ausListe ? team.factor : Number(ov.base ?? wf.baseHeadcount ?? 0));
  /*
   * Abwesende aus der Wochenplanung bzw. aus der eingelesenen
   * Urlaubsplanung.
   *
   *   Wochenzahlen   - der Abzug steht in der Woche selbst.
   *   Mannschaft     - zugeordnete Abwesenheiten stecken bereits in
   *                    team.factor. Zeilen der Urlaubsplanung, die noch
   *                    keinem Kuerzel zugeordnet sind, kommen hier dazu -
   *                    mit Zeitanteil 1,0 je Person, weil die Zeile nicht
   *                    mehr hergibt.
   *   Tagesliste     - der gemessene Wert enthaelt die Abwesenheiten schon.
   */
  const offeneAbwesende = (tageswert == null && ausListe)
    ? Math.max(0, Number(wf.plannedAbsences?.[date] ?? 0))
    : 0;
  const absent = tageswert != null
    ? 0
    : (ausListe ? offeneAbwesende : Number(ov.absent ?? 0));

  /*
   * Zahlenlisten "Leiharbeiter" und "Neueinstellungen".
   *
   * Sie gehoeren zur Rueckfallebene (Wochenzahlen). Sobald die MANNSCHAFT
   * die Grundlage ist, zaehlen sie NICHT mehr mit - Vorgabe der
   * Abteilungsleitung (17.09.2026): "Wenn zusaetzliches Personal dazu
   * kommen muss, moechte ich eine Meldung bekommen und das rein ueber den
   * Reiter Mannschaft anpassen."
   *
   * Vorher wurden sie stillschweigend addiert, waehrend ihr
   * Betreuungsaufwand (mentoringHoursPerDay) in dieser Betriebsart schon
   * ignoriert wurde - also zusaetzliche Koepfe ohne zusaetzliche Last. Die
   * Plausibilitaetspruefung meldet vorhandene Eintraege jetzt, statt sie
   * zu verrechnen.
   */
  let temps = 0;
  let tempsNominal = 0;
  let hires = 0;
  let hiresNominal = 0;
  if (!ausListe) {
    for (const t of wf.tempWorkers ?? []) {
      if (!t || !t.from) continue;
      if (date < t.from) continue;
      if (t.to && date > t.to) continue;
      const weeks = Math.floor(diffDays(mondayOf(t.from), monday) / 7);
      tempsNominal += Number(t.count) || 0;
      temps += (Number(t.count) || 0) * rampFactor(wf.rampUp?.temp, weeks);
    }
    for (const h of wf.newHires ?? []) {
      if (!h || !h.from) continue;
      if (date < h.from) continue;
      const weeks = Math.floor(diffDays(mondayOf(h.from), monday) / 7);
      hiresNominal += Number(h.count) || 0;
      hires += (Number(h.count) || 0) * rampFactor(wf.rampUp?.hire, weeks);
    }
  }

  // Krankenquote: pauschaler Abzug auf die gesamte Besetzung.
  const sickRate = Math.max(0, Math.min(0.5, Number(wf.sickRate ?? 0)));
  const roh = (Math.max(0, base - absent) + temps + hires) * (1 - sickRate);

  /*
   * NIEMAND ARBEITET ALLEIN.
   *
   * Vorgabe der Abteilungsleitung, am 18.09.2026 ausdruecklich bestaetigt:
   * "Gilt immer! Es darf aus Sicherheitsgruenden niemand alleine arbeiten.
   * Es muss immer ein 2. Mann dabei sein."
   *
   * Das ist keine Stellschraube, sondern Arbeitsschutz. Steht an einem Tag
   * nur eine Person zur Verfuegung, wird an diesem Tag nicht gearbeitet -
   * die Kapazitaet ist null, nicht "eine halbe Person". Vorher erzeugte ein
   * solcher Tag Stunden, die es in der Werkstatt nie gegeben haette.
   *
   * Gemessen wird an KOEPFEN, nicht an Zeitanteilen: Zwei Halbtagskraefte
   * sind zwei Personen und damit zulaessig; eine Vollzeitkraft allein ist
   * es nicht.
   */
  const minZusammen = Math.max(0, Number(wf.minZusammen ?? 2));
  const koepfe = team ? team.present.length : Math.round(Math.max(0, base - absent) + tempsNominal + hiresNominal);
  const alleinTag = minZusammen > 1 && koepfe > 0 && koepfe < minZusammen;
  const effective = alleinTag ? 0 : roh;

  return {
    base, absent, temps: round2(temps), hires: round2(hires),
    tempsNominal, hiresNominal,
    sickRate,
    /** Mindestbesetzung (Arbeitsschutz) und ob sie an diesem Tag greift */
    minZusammen,
    heads: koepfe,
    alone: alleinTag,
    /** Was ohne die Sicherheitsregel herausgekommen waere */
    effectiveRaw: round2(roh),
    /** Abwesende aus noch nicht zugeordneten Zeilen der Urlaubsplanung */
    plannedAbsent: offeneAbwesende,
    /** Woher die Zahl kommt - fuer die Begruendung in der Oberflaeche */
    source: tageswert != null ? 'TAGESLISTE' : (ausListe ? 'MANNSCHAFT' : 'WOCHENZAHLEN'),
    fromTeam: ausListe && tageswert == null,
    teamAbsent: team ? team.absent.map((p) => p.id) : null,
    nominal: Math.max(0, base - absent) + tempsNominal + hiresNominal,
    effective: round2(effective),
  };
}

/**
 * Produktivitaet eines Tages.
 * @param {any} config @param {string} date
 */
export function productivityFor(config, date) {
  const ov = weeklyOverride(config, date);
  const p = ov.productivity ?? config.productivity?.global ?? 1;
  return Math.max(0.01, Math.min(2, Number(p)));
}

/**
 * Ueberstunden je Mitarbeiter und Woche.
 * @param {any} config @param {string} date
 */
export function overtimeFor(config, date) {
  const ov = weeklyOverride(config, date);
  return Number(ov.overtimePerEmployee ?? config.workforce?.overtimePerEmployeeDefault ?? 0);
}

/**
 * Betriebszeitfenster der Arbeitsplaetze und Maschinen an einem Tag.
 *
 * Durch versetzte Besetzung kann ein Arbeitsplatz laenger belegt werden, als ein
 * einzelner Mitarbeiter arbeitet (Beispiel: 12 oder 14 Stunden Fenster bei
 * 7 produktiven Stunden je Mitarbeiter). Das Fenster begrenzt ausschliesslich
 * Plaetze und Maschinen, niemals die Arbeitszeit einer Person.
 *
 * Reihenfolge, vom genauesten zum allgemeinsten:
 *   1. eigener Wert des Arbeitsgangs FUER DIESE KW (Nutzerauftrag 25.09.2026:
 *      Nachtschicht nur in Engpasswochen, nicht durchgehend)
 *   2. eigener Wert des Arbeitsgangs (gilt fuer den ganzen Zeitraum)
 *   3. allgemeiner Wochenwert (gilt fuer alle Arbeitsgaenge dieser KW)
 *   4. allgemeiner Wert
 * Unterhalb der Arbeitszeit eines Mitarbeiters ist das Fenster nie - ein
 * Platz ist mindestens so lange besetzt, wie gearbeitet wird.
 *
 * @param {any} config @param {string} date @param {number} hoursPerEmployee
 * @param {string|null} [opId] Arbeitsgang mit eigenem Fenster
 */
export function operatingHours(config, date, hoursPerEmployee, opId = null) {
  const res = config.resources ?? {};
  const eigen = opId ? res.byOperation?.[opId] : null;
  const eigenWoche = eigen?.operatingHoursByWeek?.[weekKey(date)];
  const own = eigen?.operatingHours;
  const weekly = res.operatingHoursByWeek?.[weekKey(date)];
  const v = eigenWoche ?? own ?? weekly ?? res.operatingHoursPerDay;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return hoursPerEmployee;
  return Math.max(hoursPerEmployee, n);
}

/**
 * Anzahl der Plaetze eines Arbeitsganges.
 *
 * Vorrang hat der eigene Wert aus den Planungsparametern
 * (`resources.byOperation[opId].places`). Fuer Heften, Orbitalschweissen,
 * Hydro und Beizen gelten sonst die bisherigen Einzelwerte. Fuer alle
 * uebrigen Arbeitsgaenge bedeutet `null`: keine Platzbegrenzung.
 *
 * @param {any} config @param {string} opId
 * @returns {number|null}
 */
export function placesFor(config, opId) {
  const res = config.resources ?? {};
  // Platzgrenzen lassen sich gemeinsam abschalten - zum Vergleich "mit und
  // ohne", nicht fuer den Dauerbetrieb.
  if (res.enforcePlaces === false && opId !== 'ORBITAL' && opId !== 'ORBITAL_KEHLNAHT'
    && opId !== 'ORBITAL_STUMPFNAHT' && opId !== 'HEFTEN' && opId !== 'HANDSCHWEISSEN') return null;
  const own = res.byOperation?.[opId]?.places;
  if (own != null && own !== '') return Math.max(0, Number(own));
  /*
   * Kehlnaht und Stumpfnaht Orbital fallen ohne eigenen Wert auf dieselbe
   * Maschinenzahl zurueck wie die alte Ressource 'ORBITAL' (Nutzerauftrag
   * 23.09.2026 - sie teilen sich denselben Topf).
   */
  const fallbackKey = (opId === 'ORBITAL_KEHLNAHT' || opId === 'ORBITAL_STUMPFNAHT') ? 'ORBITAL' : opId;
  const fallback = {
    HEFTEN: res.heftPlaces,
    ORBITAL: res.orbitalMachinesActive ?? res.orbitalMachines,
    HYDRO: res.hydroStations,
    BEIZEN: res.beizStations,
  }[fallbackKey];
  if (fallback == null || fallback === '') return null;
  return Math.max(0, Number(fallback));
}

/**
 * Wie viele Personen koennen an einem Platz dieses Arbeitsganges gleichzeitig
 * arbeiten? Ueberall eine - auch bei Vormontage und Endkontrolle (bestaetigt
 * von der Abteilungsleitung 19.09.2026: "2 Arbeitsplaetze und 2 Personen,
 * pro Arbeitsplatz eine Person").
 * @param {any} config @param {string} opId
 */
export function workersPerPlace(config, opId) {
  const res = config.resources ?? {};
  if (opId === 'HEFTEN') return Math.max(0, Number(res.workersPerHeftPlace ?? 1));
  const own = res.byOperation?.[opId]?.workersPerPlace;
  if (own != null && own !== '') return Math.max(0, Number(own));
  return 1;
}

/**
 * Aushilfe an einem Arbeitsgang (Nutzeranforderung 25.09.2026: "notfalls
 * als Helfer bei der Hydroprüfung oder Endkontrolle etc.").
 *
 * Sie hebt die PLATZgrenze, nicht die Mannschaft - eine zusaetzliche, nicht
 * fuer diesen Arbeitsgang qualifizierte Person kann dort aushelfen und so
 * zusaetzlichen Durchsatz schaffen, wenn sie sonst untaetig waere. Anders
 * als die normale Besetzung ist sie KEIN Namensbudget in der Terminierung
 * (siehe scheduler.js) - erst der Einsatzplan (assignment.js) weist ihr
 * tatsaechlich eine Person zu.
 *
 * @param {any} config @param {string} opId
 * @returns {{max:number, leistung:number, stundenfaktor:number, label:string, text:string}|null}
 */
export function aushilfeVon(config, opId) {
  const res = config.resources ?? {};
  if (res.aushilfeAktiv === false) return null;
  const a = res.byOperation?.[opId]?.aushilfe;
  if (!a) return null;
  const max = Math.max(0, Number(a.max ?? 0));
  const leistung = Math.max(0, Number(a.leistung ?? 0));
  if (max <= 0 || leistung <= 0) return null;
  return {
    max,
    leistung,
    stundenfaktor: Math.max(1, Number(a.stundenfaktor ?? 1)),
    label: String(a.label ?? 'Aushilfe'),
    text: String(a.text ?? ''),
  };
}

/**
 * Betreuungsstunden fuer eingearbeitete Kraefte an einem Tag.
 * Sie werden dem Stammteam abgezogen (Mentoring).
 * @param {any} config @param {string} date
 */
export function mentoringHoursPerDay(config, date) {
  const wf = config.workforce ?? {};
  const curves = wf.rampUp?.mentoringHoursPerWeek ?? {};
  const workDays = Math.max(1, (config.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);
  const monday = mondayOf(date);
  let perWeek = 0;
  const collect = (list, curve) => {
    for (const e of list ?? []) {
      if (!e || !e.from || date < e.from) continue;
      if (e.to && date > e.to) continue;
      const weeks = Math.floor(diffDays(mondayOf(e.from), monday) / 7);
      const h = Array.isArray(curve) && weeks < curve.length ? Number(curve[weeks]) : 0;
      if (Number.isFinite(h)) perWeek += (Number(e.count) || 0) * h;
    }
  };
  if (wf.team?.source === 'MANNSCHAFT') {
    // Aus der Mannschaft: Betreuung fuer jeden neuen Kopf einzeln
    perWeek += mentoringHoursOfTeam(config, date);
  } else {
    collect(wf.tempWorkers, curves.temp);
    collect(wf.newHires, curves.hire);
  }
  return perWeek / workDays;
}

/**
 * Stunden je Werktag, die fuer Zubehoer und Kleinarbeiten abgehen.
 * @param {any} config
 */
export function reserveHoursPerDay(config) {
  const wochen = Number(config?.workforce?.reserveHoursPerWeek ?? 0);
  if (!Number.isFinite(wochen) || wochen <= 0) return 0;
  const tage = Math.max(1, (config.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);
  return wochen / tage;
}

/**
 * Verfuegbare Orbitalschweisser an einem Tag.
 *
 * Kommt die Besetzung aus der MANNSCHAFT, zaehlen die Leute, die in der
 * Qualifikationsmatrix beim Orbitalschweissen angehakt sind und an diesem
 * Tag da sind - gewichtet mit ihrem Zeitanteil.
 *
 * Vorgabe der Abteilungsleitung (18.09.2026): "vergiss die 2 in Ausbildung
 * orientier dich an der Qualimatrix" und "hier sind wieder zwei Regler
 * fuer einen Wert". Genau so war es: Das Feld "Eingesetzte
 * Orbitalschweisser je Tag" (Startwert 4) und die Matrix bestimmten
 * dasselbe, und die Felder "qualifiziert insgesamt 6" / "davon 2 in
 * Ausbildung" ein drittes Mal. Jetzt gilt die Matrix - dieselbe
 * Entscheidung wie bei den Zahlenlisten fuer Leiharbeiter.
 *
 * @param {any} config @param {string} date @param {'REGULAR'|'SATURDAY'|'OFF'} kind
 */
export function weldersFor(config, date, kind) {
  const w = config.resources?.welders ?? {};
  if (config.workforce?.team?.source === 'MANNSCHAFT'
    && config.workforce?.team?.enforceSkills !== false) {
    const on = teamOn(config, date);
    /*
     * Orbitalschweisser = wer fuer Kehlnaht ODER Stumpfnaht qualifiziert
     * ist (Vereinigungsmenge, nicht Summe - sonst zaehlte eine fuer beides
     * qualifizierte Person doppelt). Beide teilen sich denselben
     * Maschinen-/Schweisser-Pool (siehe model.js, capacityGroup).
     */
    const kehl = on.byOp?.ORBITAL_KEHLNAHT?.ids ?? [];
    const stumpf = on.byOp?.ORBITAL_STUMPFNAHT?.ids ?? [];
    const idSet = new Set([...kehl, ...stumpf]);
    const n2 = on.present.filter((p) => idSet.has(p.id))
      .reduce((a, p) => a + personEffectiveFactor(config, p, date), 0);
    return kind === DAY_KIND.SATURDAY ? round2(n2 * saturdayQuota(config, date)) : round2(n2);
  }
  let n;
  if (w.byDate && Object.prototype.hasOwnProperty.call(w.byDate, date)) n = Number(w.byDate[date]);
  else if (w.byWeekday && Object.prototype.hasOwnProperty.call(w.byWeekday, String(weekday(date)))) n = Number(w.byWeekday[String(weekday(date))]);
  else n = Number(w.default ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (kind === DAY_KIND.SATURDAY) {
    const quota = saturdayQuota(config, date);
    n = round2(n * quota);
  }
  return n;
}

/** Samstagsquote der Woche. @param {any} config @param {string} date */
export function saturdayQuota(config, date) {
  const cfg = config.saturday ?? {};
  const w = cfg.weeks?.[weekKey(date)];
  if (w && w.quotaOverride != null && w.quotaOverride !== '') return Number(w.quotaOverride);
  return Number(cfg.quota ?? 0.2);
}

/** Ist der NoBo an diesem Tag anwesend? @param {any} config @param {string} date */
export function noboPresent(config, date) {
  const n = config.nobo ?? {};
  if (n.exceptions && Object.prototype.hasOwnProperty.call(n.exceptions, date)) return !!n.exceptions[date];
  return (n.weekdays ?? []).includes(weekday(date));
}

/** Ist Hydroprüfung an diesem Tag grundsaetzlich zulaessig (Wochentagsfenster)? */
export function hydroWindowOpen(config, date) {
  return (config.hydro?.allowedWeekdays ?? [2, 3, 4]).includes(weekday(date));
}

/**
 * Nur die Mannschafts-Poolstunden eines Tages - ohne die Aufschluesselung je
 * Arbeitsgang/Maschine/Platz, die `dayCapacity()` zusaetzlich bildet.
 *
 * Fuer Auswertungen, die NUR die Poolstunden vieler Tage brauchen (z. B.
 * `availableHours` in kpi.js ueber einen ganzen Kennzahlenzeitraum), ist
 * `dayCapacity()` unnoetig teuer - es baut je Tag zusaetzlich die
 * vollstaendige byOp-Aufschluesselung fuer alle Arbeitsgaenge. Dieselbe
 * Formel wie dort, an einer Stelle gehalten.
 *
 * @param {any} config @param {string} date
 * @returns {{kind:"REGULAR"|"SATURDAY"|"OFF", hc:any, prod:number, hoursPerEmployee:number,
 *   headsForPool:number, poolGross:number, mentoring:number, reserve:number, poolHours:number}}
 */
export function poolHoursFor(config, date) {
  const kind = dayKind(config, date);
  const hc = headcountFor(config, date);
  const prod = productivityFor(config, date);
  if (kind === DAY_KIND.OFF) {
    return {
      kind, hc, prod, hoursPerEmployee: 0, headsForPool: 0, poolGross: 0, mentoring: 0, reserve: 0, poolHours: 0,
    };
  }
  const regularPerDay = (Number(config.workTime?.regularHoursPerWeek ?? 37.5)) / Math.max(1, (config.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);
  const overtimePerDay = overtimeFor(config, date) / Math.max(1, (config.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);
  let hoursPerEmployee;
  let headsForPool;
  if (kind === DAY_KIND.SATURDAY) {
    hoursPerEmployee = Number(config.workTime?.saturdayHours ?? 6);
    const w = config.saturday?.weeks?.[weekKey(date)];
    if (w && w.headcountOverride != null && w.headcountOverride !== '') {
      headsForPool = Number(w.headcountOverride);
    } else {
      headsForPool = hc.effective * saturdayQuota(config, date);
    }
  } else {
    hoursPerEmployee = regularPerDay + overtimePerDay;
    headsForPool = hc.effective;
  }
  const mentoring = kind === DAY_KIND.SATURDAY ? 0 : mentoringHoursPerDay(config, date);
  // Zubehoer und Kleinarbeiten gehen vorab ab - sie verbrauchen Stunden,
  // ohne als Auftrag in der Planung zu stehen.
  const reserve = kind === DAY_KIND.SATURDAY ? 0 : reserveHoursPerDay(config);
  const poolGross = Math.max(0, headsForPool * hoursPerEmployee * prod);
  const poolHours = round2(Math.max(0, poolGross - mentoring - reserve));
  return {
    kind, hc, prod, hoursPerEmployee, headsForPool, poolGross, mentoring, reserve, poolHours,
  };
}

/**
 * Vollstaendige Tageskapazitaet.
 *
 * @param {any} config
 * @param {string} date
 * @returns {{
 *   date:string, kind:string, headcount:any, productivity:number,
 *   hoursPerEmployee:number, poolHours:number, poolGross:number, mentoringHours:number,
 *   reserveHours:number, saturdayHeadcount:number|null,
 *   byOp: Record<string, {capUnits:number, capManHours:number, capOhneAushilfe:number,
 *     aushilfeStundenfaktor:number, limiter:string, detail:any}>,
 *   resources: any
 * }}
 */
export function dayCapacity(config, date) {
  const {
    kind, hc, prod, hoursPerEmployee, headsForPool, poolGross, mentoring, reserve, poolHours,
  } = poolHoursFor(config, date);
  const res = config.resources ?? {};
  const machinesPerWelder = Math.max(1, Number(res.machinesPerWelder ?? 2));

  /** @type {any} */
  const empty = {
    date, kind, headcount: hc, productivity: prod, hoursPerEmployee: 0, poolHours: 0,
    saturdayHeadcount: null, byOp: {}, resources: {},
  };

  if (kind === DAY_KIND.OFF) {
    for (const op of OPERATIONS) {
      empty.byOp[op.id] = { capUnits: 0, capManHours: 0, limiter: LIMITER.POOL, detail: {} };
    }
    empty.resources = { welders: 0, orbitalMachinesUsable: 0, heftPlaces: 0, noboPresent: false, hydroOpen: false };
    return empty;
  }

  const saturdayHeadcount = kind === DAY_KIND.SATURDAY ? round2(headsForPool) : null;

  // Allgemeines Fenster (fuer die Anzeige); je Arbeitsgang kann es abweichen.
  const opHours = operatingHours(config, date, hoursPerEmployee);
  const welders = weldersFor(config, date, kind);
  const machinesActive = Math.max(0, Number(placesFor(config, 'ORBITAL') ?? res.orbitalMachinesActive ?? res.orbitalMachines ?? 0));
  const machinesUsable = Math.min(machinesActive, welders * machinesPerWelder);
  const heftPlaces = Math.max(0, Number(placesFor(config, 'HEFTEN') ?? res.heftPlaces ?? 0));
  const workersPerHeftPlace = Math.max(0, Number(res.workersPerHeftPlace ?? 1));
  const nobo = noboPresent(config, date);
  const hydroOpen = hydroWindowOpen(config, date);

  /*
   * Anteil der Mannschaft je Arbeitsgang aus der Qualifikationsmatrix.
   * Wer einen Arbeitsgang nicht darf, zaehlt dort nicht mit - der
   * Arbeitsgang wartet dann, auch wenn andere Leute frei waeren.
   */
  const teamShares = skillShares(config, date);
  const teamToday = teamShares ? teamOn(config, date) : null;

  /** @type {Record<string, any>} */
  const byOp = {};
  for (const op of OPERATIONS) {
    const skill = config.skills?.[op.id] ?? { share: 1, headcount: null };
    let share = Math.max(0, Math.min(1, Number(skill.share ?? 1)));
    if (teamShares && teamShares[op.id] != null) share = Math.min(share, teamShares[op.id]);
    let capMan = poolHours * share;
    let limiter = LIMITER.SKILL;
    if (skill.headcount != null && skill.headcount !== '') {
      const byHead = Number(skill.headcount) * hoursPerEmployee * prod * (kind === DAY_KIND.SATURDAY ? saturdayQuota(config, date) : 1);
      if (byHead < capMan) { capMan = byHead; limiter = LIMITER.SKILL; }
    }
    if (capMan >= poolHours) { capMan = poolHours; limiter = LIMITER.POOL; }

    const f = OPERATION_BY_ID[op.id].manHourFactor;
    let capUnits = capMan / f;
    /** @type {any} */
    const detail = { skillCapManHours: round2(capMan) };
    if (teamShares) {
      detail.teamShare = round2(teamShares[op.id] ?? 1);
      detail.qualified = teamToday?.byOp[op.id]?.ids ?? [];
    }

    // Belegungszeit dieses Arbeitsganges (eigener Wert oder allgemeiner)
    const opWindow = operatingHours(config, date, hoursPerEmployee, op.id);
    detail.operatingHours = opWindow;

    if (op.id === 'HEFTEN') {
      const placeCap = heftPlaces * workersPerHeftPlace * opWindow * prod;
      detail.heftPlaceCap = round2(placeCap);
      if (placeCap < capUnits) { capUnits = placeCap; limiter = LIMITER.HEFTPLATZ; }
    } else if (op.id === 'ORBITAL_KEHLNAHT' || op.id === 'ORBITAL_STUMPFNAHT') {
      /*
       * Kehlnaht und Stumpfnaht teilen sich denselben Maschinen-/
       * Schweißer-Pool - hier bekommt deshalb JEDER der beiden Arbeitsgaenge
       * dieselbe Obergrenze (das, was der GANZE Topf hergeben wuerde). Dass
       * die beiden sich den Topf teilen und nicht gemeinsam das Doppelte
       * bekommen, stellt scheduler.js sicher (capacityGroupSiblings): was
       * der eine verbraucht, wird dem anderen ebenfalls abgezogen.
       */
      // Arbeitsinhalt in Mannstunden. Zwei getrennte Restriktionen:
      //  - Maschinen: je Schweisser koennen mehrere Maschinen bedient werden,
      //    die Maschinen begrenzen daher die gleichzeitig einsetzbaren Schweisser.
      //  - Personal: nur qualifizierte Orbitalschweisser, mit ihrer Arbeitszeit.
      const machineCap = (machinesActive / machinesPerWelder) * opWindow * prod;
      /*
       * Zwei verschiedene Groessen - das ist hier entscheidend:
       *
       *   machineCap  waechst mit dem Belegungsfenster. Maschinen koennen
       *               laenger laufen.
       *   welderCap   waechst NICHT. `welders.default` sind die
       *               EINGESETZTEN Schweisser JE TAG (Startwert 4 von 6
       *               qualifizierten, 2 noch in Ausbildung). Vier Leute
       *               liefern am Tag 4 x 7,5 h - auch wenn man sie auf
       *               zwei Schichten verteilt.
       *
       * Eine zweite Schicht am Orbitalschweissen bringt deshalb trotzdem
       * etwas: Bei einer Schicht begrenzen die MASCHINEN (3 x 7,5 =
       * 22,5 h), bei zwei Schichten die SCHWEISSER (4 x 7,5 = 30 h) - also
       * ein Drittel mehr. Mehr als 30 h gibt es erst mit mehr eingesetzten
       * Schweissern.
       *
       * Hier stand zwischenzeitlich `welders * opWindow` - das war falsch
       * und haette aus vier Schweissern 90 Stunden am Tag gemacht.
       * Nachgefragt hatte die Abteilungsleitung am 18.09.2026 zu Recht,
       * warum eine zweite Schicht nichts bringt; die Antwort ist nicht
       * "sie bringt nichts", sondern "sie bringt 22,5 -> 30 h, und darueber
       * hinaus fehlen eingesetzte Schweisser".
       */
      const welderCap = welders * hoursPerEmployee * prod;
      detail.machineCapManHours = round2(machineCap);
      detail.welderCapManHours = round2(welderCap);
      detail.machineHoursCapacity = round2(machineCap * machinesPerWelder);
      detail.machinesUsable = round2(machinesUsable);
      const hard = Math.min(machineCap, welderCap);
      if (hard <= capUnits) {
        capUnits = hard;
        limiter = welderCap <= machineCap ? LIMITER.ORBITAL_WELDER : LIMITER.ORBITAL_MACHINE;
      }
    } else if (op.id === 'HYDRO') {
      const stations = placesFor(config, 'HYDRO');
      if (!hydroOpen) { capUnits = 0; limiter = LIMITER.HYDRO_WINDOW; }
      else if (config.hydro?.requireNoBo !== false && !nobo) { capUnits = 0; limiter = LIMITER.NOBO; }
      else if (stations != null) {
        // Ein Prüfstand, eine Prüfung, eine Person: Ruesten und Pruefen
        // binden den Platz durchgehend.
        const stationCap = stations * workersPerPlace(config, 'HYDRO') * opWindow * prod;
        detail.stationCap = round2(stationCap);
        detail.places = stations;
        if (stationCap < capUnits) { capUnits = stationCap; limiter = LIMITER.HYDRO_STATION; }
      }
    } else if (op.id === 'BEIZEN' && placesFor(config, 'BEIZEN') != null) {
      const stationCap = placesFor(config, 'BEIZEN') * workersPerPlace(config, 'BEIZEN') * opWindow * prod;
      detail.stationCap = round2(stationCap);
      if (stationCap < capUnits) { capUnits = stationCap; limiter = LIMITER.BEIZ_STATION; }
    } else {
      // Alle uebrigen Arbeitsgaenge: nur begrenzt, wenn Plaetze hinterlegt
      // sind. An einem Platz koennen mehrere Personen arbeiten
      // (Vormontage und Endkontrolle: zwei).
      const places = placesFor(config, op.id);
      if (places != null) {
        const proPlatz = workersPerPlace(config, op.id);
        const placeCap = places * proPlatz * opWindow * prod;
        detail.placeCap = round2(placeCap);
        detail.places = places;
        detail.workersPerPlace = proPlatz;
        if (placeCap < capUnits) { capUnits = placeCap; limiter = LIMITER.WORKPLACE; }
      }
    }

    /*
     * Aushilfe: Sie hebt die PLATZgrenze, nicht die Mannschaft.
     *
     * Deshalb steht sie hier ganz am Ende und wirkt nur, wenn der Platz
     * die engste Stelle war. Begrenzt gerade die Mannschaft, der
     * Materialtermin oder ein Prueftag, aendert eine Aushilfe nichts - und
     * sie wird dann auch nicht ausgewiesen.
     */
    const hilfe = aushilfeVon(config, op.id);
    /*
     * Orbital (Nutzerauftrag 24.09.2026, "die 2 MA gehen notfalls als
     * Helfer bei einem anderen Arbeitsgang unterstützen"): nur wenn die
     * MASCHINEN die Grenze sind, nicht wenn die eingesetzten Schweißer
     * fehlen (ORBITAL_WELDER) - das ist die Mannschaft selbst, dagegen
     * hilft ein ungelernter Helfer nachweislich nichts (siehe Kommentar
     * oben bei "Aushilfe: Sie hebt die PLATZgrenze, nicht die Mannschaft").
     * Ein Helfer kann Rohrstücke ruesten/entnehmen, waehrend der
     * Schweißer nur schweißt - das verkuerzt die Maschinenbelegung je
     * Naht, genau wie bei Hydro/Endkontrolle.
     */
    const plaetzeBegrenzen = limiter === LIMITER.WORKPLACE || limiter === LIMITER.HYDRO_STATION
      || limiter === LIMITER.BEIZ_STATION || limiter === LIMITER.HEFTPLATZ
      || limiter === LIMITER.ORBITAL_MACHINE;
    if (hilfe && plaetzeBegrenzen && capUnits > 0) {
      const zusatz = hilfe.max * hilfe.leistung * opWindow * prod;
      detail.aushilfe = {
        label: hilfe.label,
        text: hilfe.text,
        einheiten: round2(zusatz),
        stundenfaktor: hilfe.stundenfaktor,
        ohneAushilfe: round2(capUnits),
      };
      capUnits += zusatz;
    }

    // Wochentagsregel der Abteilung (siehe rules.js)
    const allowedDays = config.operationWeekdays?.[op.id];
    if (Array.isArray(allowedDays) && allowedDays.length > 0 && !allowedDays.includes(weekday(date))) {
      capUnits = 0;
      limiter = LIMITER.OP_WINDOW;
      detail.allowedWeekdays = allowedDays;
    }

    /*
     * FIX (Nutzerpruefung 25.09.2026, gefunden beim Untersuchen der
     * Schichtuebergabe): `capManHours` rechnete den Aushilfe-Zusatz mit
     * demselben Faktor wie die normale Besetzung - dabei kostet er, wenn
     * `stundenfaktor` > 1 ist (z. B. Entgraten von Hand: doppelte
     * Arbeitszeit fuer dieselbe Menge), TATSAECHLICH mehr Personenstunden
     * pro Einheit. Die Terminierung selbst rechnete das schon richtig
     * (`usedManHours` beruecksichtigt den Faktor) - nur die angezeigte
     * TAGESKAPAZITAET war zu niedrig, sodass der Einsatzplan an manchen
     * Tagen mehr Stunden auswies, als die Kapazitaet zuliess (28 statt
     * 21 h bei voll ausgeschoepfter Aushilfe). Der Ausgleich: den
     * effektiven Stunden-je-Einheit-Faktor aus dem VERHAELTNIS von
     * Basis- und Aushilfe-Anteil bilden, statt pauschal `f` zu nehmen -
     * wird die Kapazitaet danach noch durch die Wochentagsregel auf 0
     * gesetzt, bleibt auch capManHours bei 0 (0 * Faktor).
     */
    let manHourFaktorEffektiv = f;
    if (detail.aushilfe) {
      const basis = Math.max(0, detail.aushilfe.ohneAushilfe);
      const zusatz = Math.max(0, detail.aushilfe.einheiten);
      const einheitenGesamt = basis + zusatz;
      if (einheitenGesamt > 0) {
        const stundenGesamt = basis * f + zusatz * f * detail.aushilfe.stundenfaktor;
        manHourFaktorEffektiv = stundenGesamt / einheitenGesamt;
      }
    }
    byOp[op.id] = {
      capUnits: round2(Math.max(0, capUnits)),
      capManHours: round2(Math.max(0, capUnits) * manHourFaktorEffektiv),
      /** Was OHNE Aushilfe moeglich waere - damit ist sie nachrechenbar. */
      capOhneAushilfe: round2(Math.max(0, detail.aushilfe ? detail.aushilfe.ohneAushilfe : capUnits)),
      aushilfeStundenfaktor: detail.aushilfe ? detail.aushilfe.stundenfaktor : 1,
      limiter,
      detail,
    };
  }

  return {
    date, kind, headcount: hc, productivity: prod,
    hoursPerEmployee: round2(hoursPerEmployee),
    poolHours,
    poolGross: round2(poolGross),
    mentoringHours: round2(mentoring),
    reserveHours: round2(reserve),
    saturdayHeadcount,
    byOp,
    resources: {
      welders,
      operatingHours: opHours,
      machinesActive,
      orbitalMachinesUsable: round2(machinesUsable),
      machinesPerWelder,
      heftPlaces,
      workersPerHeftPlace,
      hydroStations: res.hydroStations == null || res.hydroStations === '' ? null : Number(res.hydroStations),
      noboPresent: nobo,
      hydroOpen,
      saturdayQuota: kind === DAY_KIND.SATURDAY ? saturdayQuota(config, date) : null,
    },
  };
}

/**
 * Kapazitaeten fuer einen Zeitraum vorberechnen.
 * @param {any} config @param {string[]} dates
 */
export function capacitySeries(config, dates) {
  return dates.map((d) => dayCapacity(config, d));
}
