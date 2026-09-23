/**
 * Kennzahlen und Auswertungen (Dashboard, Kapazitaet je Arbeitsgang, OTD).
 */

import { OPERATIONS, OPERATION_BY_ID, PROJECT_STATUS, round1, round2 } from './model.js';
import {
  LIMITER, LIMITER_LABEL, poolHoursFor, aushilfeVon,
} from './capacity.js';
import { cmpDate, weekKey, addDays } from './calendar.js';

/**
 * Zusaetzlich benoetigte Mitarbeiter je Kalenderwoche.
 *
 * Rechnerische Groesse: die in der Woche fehlenden Stunden umgerechnet in
 * Mitarbeiter. Beantwortet die Frage "wie viele Leute fehlen mir wann".
 *
 * @param {any[]} weeks Wochenaggregat
 * @param {any} config
 */
export function missingStaffPerWeek(weeks, config) {
  const prod = config.productivity?.global ?? 1;
  const hoursPerWeek = (config.workTime?.regularHoursPerWeek ?? 37.5) * prod;
  return weeks.map((w) => {
    const missing = Math.max(0, w.demand - w.capacity);
    return {
      weekKey: w.weekKey,
      from: w.from,
      missingHours: round2(missing),
      missingStaff: hoursPerWeek > 0 ? Math.ceil((missing / hoursPerWeek) * 10) / 10 : 0,
    };
  });
}

/**
 * Auslastung je Arbeitsplatz und Kalenderwoche.
 *
 * Belegung = tatsaechlich eingeplante Stunden am jeweiligen Arbeitsplatztyp.
 * Beim Orbitalschweissen wird in Maschinenstunden gerechnet
 * (Mannstunden x Maschinen je Schweisser).
 *
 * @param {any} result Ergebnis von runSchedule
 * @param {any[]} workplaces
 * @param {any[]} weeks sortiertes Wochenaggregat
 */
export function workplaceLoad(result, workplaces, weeks) {
  const cfg = result.config;
  const perWelder = Math.max(1, Number(cfg.resources?.machinesPerWelder ?? 2));
  const dayHours = (cfg.workTime?.regularHoursPerWeek ?? 37.5)
    / Math.max(1, (cfg.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);

  /**
   * Belegungszeit je Arbeitsgang an einem Tag - eigener Wert vor allgemeinem.
   * Sie ist nie kuerzer als die Arbeitszeit einer Person an diesem Tag
   * (an Samstagen also kuerzer als an Werktagen).
   */
  const hoursFor = (opId, hoursPerEmployee = dayHours) => {
    const own = cfg.resources?.byOperation?.[opId]?.operatingHours;
    const v = own ?? cfg.resources?.operatingHoursPerDay;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.max(hoursPerEmployee, n) : hoursPerEmployee;
  };

  // Arbeitsplaetze nach Typ gruppieren
  /** @type {Record<string, any[]>} */
  const byType = {};
  for (const w of workplaces ?? []) {
    if (w.active === false) continue;
    (byType[w.type] ??= []).push(w);
  }
  // Platzzahl: eigener Wert je Arbeitsgang, sonst Planungsparameter,
  // sonst die aktiven Arbeitsplaetze dieses Typs.
  const countFor = (type, opId) => {
    const own = cfg.resources?.byOperation?.[opId]?.places;
    if (own != null && own !== '') return Math.max(0, Number(own));
    if (type === 'HEFTPLATZ') return Math.max(0, Number(cfg.resources?.heftPlaces ?? 0));
    if (type === 'ORBITAL') return Math.max(0, Number(cfg.resources?.orbitalMachinesActive ?? 0));
    return (byType[type] ?? []).length;
  };

  /**
   * Moegliche Belegungsstunden je Arbeitsgang und Kalenderwoche.
   *
   * Gezaehlt werden nur Tage, an denen der Arbeitsgang UEBERHAUPT laufen
   * kann. Damit fliessen Feiertage, Samstagsregelung, Wochentagsfenster
   * (Hydro nur Di-Do), NoBo-Anwesenheit und Wochentagsregeln der Abteilung
   * ein - genau wie in der Terminierung. Sonst wuerde die Auslastung eines
   * Arbeitsplatzes zu niedrig erscheinen, und eine Aenderung am
   * Wochentagsfenster haette in der Auswertung keine Wirkung.
   *
   * @type {Record<string, Record<string, {hours:number, days:number}>>}
   */
  const moeglich = {};
  for (const d of result.daySeries) {
    for (const op of OPERATIONS) {
      const c = d.byOp?.[op.id];
      if (!c || c.capUnits <= 0) continue;
      const proTag = (moeglich[op.id] ??= {});
      const woche = (proTag[d.weekKey] ??= { hours: 0, days: 0 });
      // Belegungszeit dieses Tages (Samstag und Ueberstunden wirken mit)
      woche.hours = round2(woche.hours + hoursFor(op.id, d.hoursPerEmployee));
      woche.days += 1;
    }
  }

  /*
   * Stau vor einem Arbeitsgang.
   *
   * Der Planlauf haelt fuer JEDEN TAG fest, wie viele Stunden Arbeit
   * anstanden, aber nicht gebucht werden konnten (`result.blocked`). Ein
   * Auftrag, der zwanzig Tage auf den Pruefstand wartet, steht dort
   * zwanzigmal mit seinen Reststunden drin.
   *
   * Daraus ergeben sich DREI verschiedene Groessen - sie werden bewusst
   * getrennt gefuehrt, weil ihre Verwechslung die alte Fehlzahl erzeugt hat:
   *
   *   hours  Summe ueber alle Tage. Einheit: Stunden MAL Tage, nicht
   *          Stunden. Taugt nur als Rangfolge ("wo staut es sich am
   *          haeufigsten und am staerksten"), nie als Arbeitsmenge.
   *   peak   groesste Warteschlange an EINEM Tag. Einheit: Stunden.
   *          Das ist die Zahl, die man sich vorstellen kann.
   *   days   an wie vielen Tagen ueberhaupt etwas wartete.
   *
   * @type {Record<string, Record<string, {hours:number, peak:number, days:number, causes:Record<string, number>}>>}
   */
  const blockiert = {};
  /** Tageswerte je Arbeitsgang, um Spitze und Tage zu bestimmen. */
  const proTag = {};
  for (const b of result.blocked ?? []) {
    if (b.info || !b.opId) continue;
    const wk = weekKey(b.date);
    const proOp = (blockiert[b.opId] ??= {});
    const woche = (proOp[wk] ??= { hours: 0, peak: 0, days: 0, causes: {} });
    woche.hours = round2(woche.hours + b.manHours);
    woche.causes[b.cause] = round2((woche.causes[b.cause] ?? 0) + b.manHours);
    const tage = (proTag[b.opId] ??= {});
    tage[b.date] = round2((tage[b.date] ?? 0) + b.manHours);
  }
  for (const [opId, tage] of Object.entries(proTag)) {
    for (const [datum, wert] of Object.entries(tage)) {
      const woche = blockiert[opId]?.[weekKey(datum)];
      if (!woche) continue;
      woche.days += 1;
      if (wert > woche.peak) woche.peak = wert;
    }
  }
  const hauptursache = (causes) => {
    const top = Object.entries(causes ?? {}).sort((a, b) => b[1] - a[1])[0];
    return top ? { cause: top[0], label: LIMITER_LABEL[top[0]] ?? top[0], hours: top[1] } : null;
  };

  const rows = [];
  for (const op of OPERATIONS) {
    const type = OPERATION_BY_ID[op.id].workplaceType;
    const places = countFor(type, op.id);
    if (places <= 0) continue;
    const istOrbital = op.id === 'ORBITAL_KEHLNAHT' || op.id === 'ORBITAL_STUMPFNAHT';
    const machineFactor = istOrbital ? perWelder : 1;
    /*
     * Aushilfe (Nutzeranforderung 25.09.2026) hebt die Platzgrenze bewusst
     * an diesem Arbeitsgang - sonst schiene die Auslastung hier ueber
     * 100 %, obwohl genau dafuer die Aushilfe gedacht ist.
     */
    const hilfe = aushilfeVon(cfg, op.id);

    const cells = weeks.map((w) => {
      const used = (w.byOp[op.id]?.usedUnits ?? 0) * machineFactor;
      const fenster = moeglich[op.id]?.[w.weekKey] ?? { hours: 0, days: 0 };
      const capacity = places * fenster.hours + (hilfe ? hilfe.max * hilfe.leistung * fenster.hours : 0);
      const blocked = blockiert[op.id]?.[w.weekKey];
      return {
        weekKey: w.weekKey,
        hours: round2(used),
        capacityHours: round2(capacity),
        /** An wie vielen Tagen dieser Woche war der Arbeitsgang möglich? */
        days: fenster.days,
        utilization: capacity > 0 ? round2((used / capacity) * 100) : (used > 0 ? 999 : 0),
        /**
         * Stau, aufsummiert ueber die Tage der Woche. Einheit: Stunden MAL
         * Tage - eine Rangfolge, keine Arbeitsmenge (siehe oben).
         */
        blockedHours: round2(blocked?.hours ?? 0),
        /** Groesste Warteschlange an einem einzelnen Tag dieser Woche (h) */
        blockedPeak: round2(blocked?.peak ?? 0),
        /** An wie vielen Tagen dieser Woche wartete Arbeit */
        blockedDays: blocked?.days ?? 0,
        blockedCause: hauptursache(blocked?.causes)?.label ?? null,
      };
    });

    const totalHours = round2(cells.reduce((a, c) => a + c.hours, 0));
    const totalCapacity = round2(cells.reduce((a, c) => a + c.capacityHours, 0));
    const alleUrsachen = {};
    for (const wk of Object.keys(blockiert[op.id] ?? {})) {
      for (const [c, h] of Object.entries(blockiert[op.id][wk].causes)) {
        alleUrsachen[c] = round2((alleUrsachen[c] ?? 0) + h);
      }
    }
    const top = hauptursache(alleUrsachen);
    rows.push({
      opId: op.id,
      name: op.name,
      type,
      places,
      unit: istOrbital ? 'Maschinenstunden' : 'Platzstunden',
      /*
       * Kehlnaht und Stumpfnaht Orbital teilen sich denselben Maschinen-
       * /Schweißer-Topf (Nutzerauftrag 23.09.2026) - die hier gezeigte
       * Kapazität gilt für BEIDE zusammen, nicht für jeden einzeln zusätzlich.
       */
      sharedCapacityWith: istOrbital
        ? (op.id === 'ORBITAL_KEHLNAHT' ? 'ORBITAL_STUMPFNAHT' : 'ORBITAL_KEHLNAHT') : null,
      workplaceNames: (byType[type] ?? []).map((w) => w.name),
      totalHours,
      /** Mögliche Belegungsstunden über den gesamten Zeitraum */
      totalCapacityHours: totalCapacity,
      /** Auslastung über den gesamten Zeitraum (nicht der Wochenspitzenwert) */
      totalUtilization: totalCapacity > 0 ? round2((totalHours / totalCapacity) * 100) : 0,
      /** Wochen mit Überlast */
      overloadWeeks: cells.filter((c) => c.utilization > 100.5).length,
      /** Stau ueber den ganzen Zeitraum in Stunden MAL Tagen (Rangfolge) */
      blockedHours: round2(cells.reduce((a, c) => a + c.blockedHours, 0)),
      /** Groesste Warteschlange an einem einzelnen Tag (h) - vorstellbar */
      blockedPeak: round2(Math.max(0, ...cells.map((c) => c.blockedPeak))),
      /** An wie vielen Tagen des Zeitraums wartete hier Arbeit */
      blockedDays: cells.reduce((a, c) => a + c.blockedDays, 0),
      blockedCause: top?.label ?? null,
      blockedCauses: alleUrsachen,
      /** Tage je Woche, an denen der Arbeitsgang möglich ist (Mittelwert) */
      daysPerWeek: round2(cells.reduce((a, c) => a + c.days, 0) / Math.max(1, cells.length)),
      peak: round2(Math.max(0, ...cells.map((c) => c.utilization))),
      cells,
    });
  }

  /*
   * Zeile "Mitarbeiterstunden gesamt": ohne sie passt die Matrix nicht mit
   * dem Diagramm "Aufwand gegen Kapazität" zusammen - dort stehen
   * Mannstunden, hier Platz- und Maschinenstunden.
   */
  const poolCells = weeks.map((w) => {
    const capacity = round2(w.capacity ?? 0);
    const used = round2(w.planned ?? 0);
    return {
      weekKey: w.weekKey,
      hours: used,
      capacityHours: capacity,
      days: w.workDays ?? 0,
      utilization: capacity > 0 ? round2((used / capacity) * 100) : (used > 0 ? 999 : 0),
      /*
       * Kein Stau im Sinne der uebrigen Zeilen: Vor der MANNSCHAFT steht
       * keine Warteschlange, es fehlen schlicht Stunden. Frueher stand hier
       * "Bedarf minus verplant" in derselben Spalte wie die Tageswarte-
       * schlangen der Arbeitsgaenge - zwei voellig verschiedene Groessen
       * untereinander. Die ehrliche Zahl dazu steht im Mehraufwand.
       */
      blockedHours: null,
      blockedPeak: null,
      blockedDays: null,
      blockedCause: null,
    };
  });
  const poolHours = round2(poolCells.reduce((a, c) => a + c.hours, 0));
  const poolCapacity = round2(poolCells.reduce((a, c) => a + c.capacityHours, 0));
  rows.unshift({
    opId: 'POOL',
    name: 'Mitarbeiterstunden gesamt',
    type: 'POOL',
    isPool: true,
    places: null,
    unit: 'Mannstunden',
    workplaceNames: [],
    totalHours: poolHours,
    totalCapacityHours: poolCapacity,
    totalUtilization: poolCapacity > 0 ? round2((poolHours / poolCapacity) * 100) : 0,
    overloadWeeks: poolCells.filter((c) => c.utilization > 100.5).length,
    blockedHours: null,
    blockedPeak: null,
    blockedDays: null,
    blockedCause: null,
    blockedCauses: {},
    daysPerWeek: round2(poolCells.reduce((a, c) => a + c.days, 0) / Math.max(1, poolCells.length)),
    peak: round2(Math.max(0, ...poolCells.map((c) => c.utilization))),
    cells: poolCells,
  });

  return rows;
}

/**
 * Welche Qualifikation fehlt wie oft?
 *
 * Statt "es fehlen 5 Mitarbeiter" beantwortet das die Frage
 * "es fehlen 3 Orbitalschweisser und 2 Hefter". Grundlage sind die
 * Stunden, die am Personal des jeweiligen Arbeitsganges gescheitert sind
 * (Ursache "Mitarbeiterstunden" oder "Einsetzbare Mitarbeiter").
 *
 * @param {any} result @param {any} config
 */
export function missingQualification(result, config) {
  const prod = Number(config.productivity?.global ?? 1) || 1;
  const hoursPerWeek = (Number(config.workTime?.regularHoursPerWeek ?? 37.5) || 37.5) * prod;
  const wochen = new Set();
  /** @type {Record<string, {opId:string,name:string,hours:number,causes:Record<string,number>}>} */
  const agg = {};
  for (const b of result.blocked ?? []) {
    if (b.info || !b.opId) continue;
    if (b.cause !== LIMITER.POOL && b.cause !== LIMITER.SKILL) continue;
    wochen.add(weekKey(b.date));
    const e = (agg[b.opId] ??= {
      opId: b.opId, name: OPERATION_BY_ID[b.opId]?.name ?? b.opId, hours: 0, causes: {},
    });
    e.hours = round2(e.hours + b.manHours);
    e.causes[b.cause] = round2((e.causes[b.cause] ?? 0) + b.manHours);
  }
  const wochenZahl = Math.max(1, wochen.size);
  return Object.values(agg)
    .map((e) => ({
      ...e,
      /** Mitarbeiter, die über den betroffenen Zeitraum gefehlt haben */
      missingStaff: Math.ceil((e.hours / wochenZahl / hoursPerWeek) * 10) / 10,
      weeks: wochenZahl,
    }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * Aufwand, der ueber der verfuegbaren Kapazitaet liegt, um alle Termine zu
 * halten ("Ueberhang").
 *
 * Rechenweg - terminbezogen, nicht als Jahressumme:
 *
 *   Fuer jeden Fertigstellungstermin (aufsteigend):
 *     Bedarf bis dahin    = Summe der offenen Mannstunden aller Auftraege,
 *                           die bis zu diesem Termin fertig sein muessen
 *     Kapazitaet bis dahin = Summe der Tageskapazitaeten bis zu diesem Termin
 *     Fehlbetrag          = Bedarf - Kapazitaet
 *   Ergebnis = groesster Fehlbetrag ueber alle Termine
 *
 * Das beantwortet die Frage "wie viele Stunden mehr brauche ich, um in time
 * zu fertigen". Eine Gesamtdifferenz ueber den ganzen Zeitraum beantwortet
 * sie NICHT: die Summe kann reichen, waehrend sie zu den einzelnen Terminen
 * fehlt.
 *
 * Nicht enthalten sind Maschinen- und Platzgrenzen (Orbitalmaschinen,
 * Heftplaetze). Dafuer steht die Kennzahl "Engste Stelle" daneben.
 *
 * @param {any} result Ergebnis von runSchedule
 * @param {string|null} [windowEnd] Nur Termine bis zu diesem Datum werten -
 *   ohne Angabe (z.B. in den bestehenden Tests) wie bisher der ganze
 *   Auftragsbestand.
 */
export function deadlineShortfall(result, windowEnd = null) {
  /*
   * FIX (gemeldet 21.09.2026 anhand eines Bildschirmfotos): "+1.932 h ueber
   * Kapazitaet" in der Kopfzeile blieb gleich, egal welchen Zeitraum man im
   * Feld "Zeitraum" auswaehlte - z.B. "heute - 31.12.2026". Der Grund: die
   * Funktion suchte den groessten Fehlbetrag ueber ALLE Auftraege mit
   * offenem Termin, auch wenn deren Termin weit hinter dem gewaehlten
   * Zeitraum lag (bis in den Rechenhorizont 2027 hinein). Damit widersprach
   * die Kopfzeile der eigenen Vorgabe der Abteilungsleitung (18.09.2026):
   * "Die APP soll immer nur den angewaehlten Zeitraum bewerten" - die
   * anderen Kennzahlen (verfuegbare Stunden, Auslastung, WIP-Ausnahmen)
   * wurden dafuer bereits umgestellt, dieser Wert wurde dabei uebersehen.
   */
  // `remainingManHours` eines Ergebnisses sind die zum Planungsstichtag
  // OFFENEN Stunden (nicht der Rest nach der Rechnung) - genau der Bedarf.
  const offen = result.projects
    .filter((p) => p.dueDate && p.remainingManHours > 0)
    .filter((p) => !windowEnd || cmpDate(p.dueDate, windowEnd) <= 0)
    .map((p) => ({
      id: p.id,
      orderNo: p.orderNo,
      dueDate: p.dueDate,
      hours: Number(p.remainingManHours) || 0,
    }))
    .sort((a, b) => cmpDate(a.dueDate, b.dueDate));

  if (offen.length === 0) {
    return { hours: 0, untilDate: null, weekKey: null, demand: 0, capacity: 0, steps: [] };
  }

  // Kapazitaet je Tag aufsummieren
  const kumuliert = [];
  let summe = 0;
  for (const d of result.daySeries) {
    summe = round2(summe + (d.poolCapacity ?? 0));
    kumuliert.push({ date: d.date, capacity: summe });
  }
  const kapazitaetBis = (datum) => {
    let letzte = 0;
    for (const k of kumuliert) {
      if (cmpDate(k.date, datum) > 0) break;
      letzte = k.capacity;
    }
    return letzte;
  };

  const steps = [];
  let bedarf = 0;
  let groesster = { hours: 0, untilDate: null, weekKey: null, demand: 0, capacity: 0 };

  for (const p of offen) {
    bedarf = round2(bedarf + p.hours);
    const kapazitaet = kapazitaetBis(p.dueDate);
    const fehlt = round2(bedarf - kapazitaet);
    steps.push({ dueDate: p.dueDate, demand: bedarf, capacity: kapazitaet, shortfall: Math.max(0, fehlt) });
    if (fehlt > groesster.hours) {
      groesster = {
        hours: fehlt,
        untilDate: p.dueDate,
        weekKey: weekKey(p.dueDate),
        demand: bedarf,
        capacity: kapazitaet,
      };
    }
  }

  return { ...groesster, steps };
}

/**
 * Dashboard-Kennzahlen.
 * @param {any} result Ergebnis von runSchedule
 * @param {Record<string, any>} weeks Wochenaggregat
 */
export function dashboardKpis(result, weeks, range = {}) {
  const projects = result.projects;
  const relevant = projects.filter((p) => p.status !== 'OHNE_TERMIN');
  const done = projects.filter((p) => p.status === PROJECT_STATUS.DONE).length;
  const inTime = projects.filter((p) => p.status === PROJECT_STATUS.IN_TIME).length;
  const critical = projects.filter((p) => p.status === PROJECT_STATUS.CRITICAL).length;
  const late = projects.filter((p) => p.status === PROJECT_STATUS.LATE).length;
  const withoutDue = projects.filter((p) => p.status === 'OHNE_TERMIN').length;

  const otdBase = relevant.length;
  const otd = otdBase > 0 ? round2(((otdBase - late) / otdBase) * 100) : 100;

  const openHours = round2(projects.reduce((a, p) => a + p.remainingManHours, 0));
  const weekArr = Object.values(weeks).sort((a, b) => String(a.weekKey).localeCompare(String(b.weekKey)));

  // Kennzahlenfenster: bis zum spaetesten Fertigstellungstermin.
  // Bewusst NICHT von der Prognose abhaengig - sonst waeren die Kennzahlen
  // zweier Szenarien nicht vergleichbar (ein besserer Plan haette ein kuerzeres
  // Fenster und dadurch scheinbar weniger verfuegbare Stunden).
  const lastDue = projects.reduce((acc, p) => (p.dueDate && (!acc || cmpDate(p.dueDate, acc) > 0) ? p.dueDate : acc), null);
  // Auswertungsfenster fuer Auslastungen: bis Termin oder Prognose, je nachdem was spaeter liegt
  const lastRelevant = projects.reduce((acc, p) => {
    const d = p.forecastFinish && (!p.dueDate || cmpDate(p.forecastFinish, p.dueDate) > 0) ? p.forecastFinish : p.dueDate;
    return d && (!acc || cmpDate(d, acc) > 0) ? d : acc;
  }, lastDue);
  /*
   * Der angewaehlte Zeitraum hat Vorrang (Vorgabe 18.09.2026: "Die APP soll
   * immer nur den angewaehlten Zeitraum bewerten"). Ohne Angabe gilt wie
   * bisher der letzte Fertigstellungstermin.
   */
  const windowEnd = range.to ?? lastDue ?? lastRelevant;
  const windowStart = range.from ?? null;
  const windowWeeks = weekArr.filter((w) => (!windowEnd || cmpDate(w.from, windowEnd) <= 0)
    && (!windowStart || cmpDate(w.to ?? w.from, windowStart) >= 0));

  /*
   * Kapazitaet bis zum letzten Termin - TAGGENAU.
   *
   * Hier stand die Summe der Wochen, deren Montag noch vor dem Termin lag.
   * Damit zaehlte die Randwoche KOMPLETT mit, auch ihre Tage nach dem
   * Termin: im Startdatenbestand 9.012 h statt 8.649 h, also 363 h
   * Kapazitaet, die es bis zum Termin gar nicht mehr gibt. Gemeldet von der
   * Abteilungsleitung am 18.09.2026, als die Zahlen nicht aufgingen.
   *
   * FIX (gefunden beim Portieren in die Netzwerkversion, 21.09.2026):
   * `result.daySeries` endet, sobald alle Auftraege fertig sind
   * (`states.every(finished)` in scheduler.js) - das ist eine Optimierung
   * der Terminierung, keine Kalenderaussage. Reicht die Kapazitaet, um vor
   * dem Fenster-Ende fertig zu werden, brach die Summe schon dort ab und
   * zaehlte die Resttage bis zum Termin gar nicht mehr mit. Ergebnis: MEHR
   * Kapazitaet (z. B. laengeres Zeitfenster, Ueberstunden) konnte
   * `availableHours` sogar SENKEN, weil der Plan dadurch frueher fertig war
   * - genau der Prognoseeinfluss, den der Kommentar oben ausdruecklich
   * ausschliessen wollte. Jetzt taggenau direkt aus der Kapazitaetsformel,
   * unabhaengig davon, wie weit die Terminierung tatsaechlich gerechnet hat.
   */
  const availableHours = round2((() => {
    const cfg = result.config;
    const von = windowStart && cmpDate(windowStart, cfg.planningDate) > 0 ? windowStart : cfg.planningDate;
    if (!windowEnd || cmpDate(von, windowEnd) > 0) return 0;
    let sum = 0;
    for (let d = von; cmpDate(d, windowEnd) <= 0; d = addDays(d, 1)) {
      sum += Number(poolHoursFor(cfg, d).poolHours) || 0;
    }
    return sum;
  })());
  const overloadHours = round2(windowWeeks.reduce((a, w) => a + w.overload, 0));
  const firstOverload = windowWeeks.find((w) => w.overload > 0.5);

  const bottleneck = bottleneckRanking(result);
  const totalLateDays = projects.reduce((a, p) => a + (p.lateDays || 0), 0);
  /*
   * Verspaetung nach Ursache trennen.
   *
   * Ein Auftrag, der auf Fehlteile wartet, ist zu spaet - aber nicht wegen
   * der Kapazitaet. Wer das vermischt, beantragt Personal fuer ein
   * Lieferproblem. Deshalb stehen beide Zahlen getrennt.
   */
  const lateProjects = projects.filter((p) => (p.lateDays || 0) > 0);
  const materialLate = lateProjects.filter((p) => p.lateByMaterial);
  const lateByMaterial = materialLate.length;
  const lateDaysByMaterial = round2(materialLate.reduce((a, p) => a + (p.lateDays || 0), 0));
  const lateByCapacity = lateProjects.length - lateByMaterial;
  const missingPartsProjects = projects.filter((p) => p.missingParts).length;

  // Zusatzbedarf in Mitarbeiterwochen (§73)
  const prod = result.config.productivity?.global ?? 1;
  const hoursPerEmployeeWeek = (result.config.workTime?.regularHoursPerWeek ?? 37.5) * prod;
  const requiredFteWeeks = hoursPerEmployeeWeek > 0 ? round1(overloadHours / hoursPerEmployeeWeek) : 0;

  /*
   * FIX Hoch08 (Audit 20.09.2026): dieselbe Fensterregel wie bei
   * `availableHours` oben - der angewaehlte Zeitraum (`windowStart`/
   * `windowEnd`), nicht `lastRelevant` (das Ende des ganzen
   * Auftragsbestands, unabhaengig von der Auswahl).
   */
  const orbital = orbitalUtilization(result, windowEnd, windowStart);
  const heft = processUtilization(result, 'HEFTEN', windowEnd, windowStart);
  const shortfall = deadlineShortfall(result, windowEnd);

  /*
   * FIX (gefunden 21.09.2026 beim Nachweis der Regler-Wirkung): die
   * WIP-Ausnahme ("Grenze bei Leerlauf automatisch lockern", Nutzer-
   * entscheidung 21.09.2026) wurde in scheduler.js zwar korrekt vermerkt
   * (dayRecord.wipAusnahmen), aber NIRGENDS in einer Auswertung oder
   * Ansicht gelesen - der ausdruecklich geforderte "sichtbare Hinweis,
   * dass das eine Ausnahme war" fehlte komplett. Wer "Aufträge
   * gleichzeitig" oder "Mitarbeiter je Auftrag" enger stellte, sah keine
   * Wirkung und keinen Hinweis, WARUM nicht - die Grenze wurde still
   * uebersteuert. Jetzt als Kennzahl verfuegbar.
   */
  const wipAusnahmen = { stunden: 0, tage: 0, jeGrund: {} };
  for (const d of result.daySeries ?? []) {
    if (windowEnd && cmpDate(d.date, windowEnd) > 0) continue;
    if (windowStart && cmpDate(d.date, windowStart) < 0) continue;
    if (!d.wipAusnahmen?.length) continue;
    wipAusnahmen.tage += 1;
    for (const a of d.wipAusnahmen) {
      wipAusnahmen.stunden = round2(wipAusnahmen.stunden + a.manHours);
      const label = LIMITER_LABEL[a.grund] ?? a.grund;
      wipAusnahmen.jeGrund[label] = round2((wipAusnahmen.jeGrund[label] ?? 0) + a.manHours);
    }
  }

  return {
    totalProjects: projects.length,
    done, inTime, critical, late, withoutDue,
    otd,
    totalLateDays,
    /** Verspaetungen, die auf Fehlteile zurueckgehen */
    lateByMaterial,
    lateDaysByMaterial,
    /** Verspaetungen, an denen Kapazitaet etwas aendern kann */
    lateByCapacity,
    /** Auftraege mit gemeldeten Fehlteilen (auch wenn noch im Termin) */
    missingPartsProjects,
    maxLateDays: projects.reduce((a, p) => Math.max(a, p.lateDays || 0), 0),
    openHours,
    availableHours,
    availableHoursUntil: windowEnd,
    overloadHours,
    /** Stunden, die bis zu den Terminen ueber der Kapazitaet liegen */
    shortfallHours: round2(Math.max(0, shortfall.hours)),
    shortfallUntil: shortfall.untilDate,
    shortfallWeek: shortfall.weekKey,
    shortfallDemand: shortfall.demand,
    shortfallCapacity: shortfall.capacity,
    firstOverloadWeek: firstOverload ? firstOverload.weekKey : null,
    firstOverloadHours: firstOverload ? firstOverload.overload : 0,
    bottleneck: bottleneck[0] ?? null,
    bottleneckRanking: bottleneck,
    /**
     * WIP-Ausnahme ("Aufträge gleichzeitig"/"Mitarbeiter je Auftrag" bei
     * Leerlauf automatisch gelockert) - Stunden und Tage, an denen das im
     * gewählten Zeitraum tatsächlich gegriffen hat, je Grenze.
     */
    wipAusnahmen,
    requiredFteWeeks,
    orbitalUtilization: orbital.utilization,
    orbital,
    heftUtilization: heft.utilization,
    heft,
    runtimeMs: result.runtimeMs,
  };
}

/**
 * Rangfolge der Engpaesse: welche Grenze haelt wie viel Arbeit auf?
 *
 * ACHTUNG, das ist die Stelle, an der diese Auswertung zweimal falsch war.
 * `result.blocked` ist eine TAGESWARTESCHLANGE: Steht ein Arbeitsgang mit
 * 30 h zehn Tage lang an, erscheint er zehnmal mit 30 h. Die frueher hier
 * gebildete Summe ueber alle Eintraege hatte deshalb die Einheit
 * "Stunden mal Tage" und wurde als "x Stunden konnten nicht eingeplant
 * werden" ausgegeben - im Startdatenbestand 3.039 h, obwohl an keinem Tag
 * mehr als 237 h warteten und in Summe nur 885 h Arbeit betroffen waren.
 * Gemeldet von der Abteilungsleitung am 18.09.2026:
 * "3145 h belegt und weitere 3286 h nicht einplanbar - das kann nicht
 * passen."
 *
 * Deshalb wird jede Arbeit jetzt genau EINMAL gezaehlt: je Auftrag und
 * Arbeitsgang zaehlt die groesste Wartemenge (das ist die offene Arbeit,
 * die dort stand). Damit bleibt die Zahl unter dem Arbeitsinhalt - genau
 * das laesst sich nachrechnen und wird im Test geprueft.
 *
 * @param {any} result
 */
export function bottleneckRanking(result) {
  /** @type {Record<string, any>} */
  const agg = {};
  /** Groesste Wartemenge je Ursache, Auftrag und Arbeitsgang */
  const jeArbeit = new Map();
  /** Tageswarteschlange je Ursache - fuer Spitze und Anzahl der Tage */
  const jeTag = new Map();

  for (const b of result.blocked) {
    if (b.info) continue;
    const e = (agg[b.cause] ??= {
      cause: b.cause, manHours: 0, ops: {}, operations: 0,
      days: 0, peakHours: 0, queueHoursDays: 0,
    });
    e.queueHoursDays = round2(e.queueHoursDays + b.manHours);
    const arbeit = `${b.cause}\u0000${b.projectId}\u0000${b.opId}`;
    jeArbeit.set(arbeit, Math.max(jeArbeit.get(arbeit) ?? 0, b.manHours));
    const tag = `${b.cause}\u0000${b.date}`;
    jeTag.set(tag, (jeTag.get(tag) ?? 0) + b.manHours);
  }

  for (const [key, stunden] of jeArbeit) {
    const [cause, , opId] = key.split('\u0000');
    const e = agg[cause];
    e.manHours = round2(e.manHours + stunden);
    e.operations += 1;
    if (opId && opId !== 'undefined') e.ops[opId] = round2((e.ops[opId] ?? 0) + stunden);
  }
  for (const [key, stunden] of jeTag) {
    const e = agg[key.split('\u0000')[0]];
    e.days += 1;
    e.peakHours = Math.max(e.peakHours, round2(stunden));
  }

  return Object.values(agg)
    .sort((a, b) => b.manHours - a.manHours)
    .map((e) => ({
      ...e,
      label: LIMITER_LABEL[e.cause] ?? e.cause,
      topOperation: Object.entries(e.ops).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }));
}

/**
 * Auslastung eines Arbeitsganges im relevanten Zeitfenster.
 *
 * FIX Hoch08 (Audit 20.09.2026): der angewaehlte Zeitraum hat auch eine
 * UNTERGRENZE (`from`). Vorher lief diese Auswertung immer ab dem ersten Tag
 * der Tagesreihe (Planungsstichtag) - eine Auswahl von nur einem einzelnen
 * Tag zaehlte trotzdem alle Tage seit Planungsbeginn mit.
 *
 * @param {any} result @param {string} opId @param {string|null} until
 * @param {string|null} [from]
 */
export function processUtilization(result, opId, until, from = null) {
  let cap = 0;
  let used = 0;
  let capDays = 0;
  for (const d of result.daySeries) {
    if (from && cmpDate(d.date, from) < 0) continue;
    if (until && cmpDate(d.date, until) > 0) break;
    const v = d.byOp[opId];
    if (!v) continue;
    cap += v.capUnits;
    used += v.usedUnits;
    if (v.capUnits > 0) capDays++;
  }
  return {
    opId,
    name: OPERATION_BY_ID[opId]?.name ?? opId,
    unit: OPERATION_BY_ID[opId]?.unit,
    capacity: round2(cap),
    used: round2(used),
    utilization: cap > 0 ? round2((used / cap) * 100) : 0,
    days: capDays,
  };
}

/**
 * Kombinierte Auslastung von Kehlnaht und Stumpfnaht Orbital - dieselbe
 * Ergebnisform wie processUtilization(), aber ueber den GEMEINSAMEN
 * Maschinentopf gerechnet (Nutzerauftrag 23.09.2026): die Kapazitaet wird
 * nur einmal gezaehlt, der Verbrauch aus beiden Arbeitsgaengen zusammen.
 * @param {any} result @param {string|null} until @param {string|null} [from]
 */
function orbitalUtilization(result, until, from = null) {
  let cap = 0;
  let used = 0;
  let capDays = 0;
  for (const d of result.daySeries) {
    if (from && cmpDate(d.date, from) < 0) continue;
    if (until && cmpDate(d.date, until) > 0) break;
    const kehl = d.byOp.ORBITAL_KEHLNAHT;
    const stumpf = d.byOp.ORBITAL_STUMPFNAHT;
    if (!kehl && !stumpf) continue;
    const capHeute = kehl?.capUnits ?? stumpf?.capUnits ?? 0;
    cap += capHeute;
    used += (kehl?.usedUnits ?? 0) + (stumpf?.usedUnits ?? 0);
    if (capHeute > 0) capDays++;
  }
  return {
    opId: 'ORBITAL',
    name: 'Orbitalschweißen (Kehlnaht + Stumpfnaht)',
    unit: 'Mannstunden',
    capacity: round2(cap),
    used: round2(used),
    utilization: cap > 0 ? round2((used / cap) * 100) : 0,
    days: capDays,
  };
}

/**
 * Bedarf / Kapazitaet / Ueber- und Unterdeckung je Arbeitsgang (§53).
 * @param {any} result @param {Record<string, any>} demandByDate
 * @param {string} from @param {string} to
 */
export function processBalance(result, demandByDate, from, to) {
  /** @type {Record<string, any>} */
  const rows = {};
  for (const op of OPERATIONS) {
    rows[op.id] = {
      opId: op.id, name: op.name, unit: op.unit,
      demandManHours: 0, capacityManHours: 0, plannedManHours: 0,
      capacityUnits: 0, plannedUnits: 0, manHourFactor: op.manHourFactor,
      /** Arbeitsinhalt und offene Arbeit der Auftraege in diesem Arbeitsgang */
      contentManHours: 0, openManHours: 0, orders: 0,
      /** Liegengeblieben: Arbeit, Tage, groesster Tag, Hauptursache */
      blockedManHours: 0, blockedDays: 0, blockedPeak: 0, blockedCause: null,
    };
  }
  for (const d of result.daySeries) {
    if (from && cmpDate(d.date, from) < 0) continue;
    if (to && cmpDate(d.date, to) > 0) continue;
    for (const op of OPERATIONS) {
      const v = d.byOp[op.id];
      if (!v) continue;
      rows[op.id].capacityManHours = round2(rows[op.id].capacityManHours + v.capManHours);
      rows[op.id].plannedManHours = round2(rows[op.id].plannedManHours + v.usedManHours);
      rows[op.id].capacityUnits = round2(rows[op.id].capacityUnits + v.capUnits);
      rows[op.id].plannedUnits = round2(rows[op.id].plannedUnits + v.usedUnits);
      rows[op.id].demandManHours = round2(rows[op.id].demandManHours + (demandByDate?.[d.date]?.byOp?.[op.id] ?? 0));
    }
  }
  /*
   * Die Stunden auf die Arbeitsgaenge buchen (Vorgabe der Abteilungsleitung
   * 18.09.2026: "buch bitte die Stunden auf die Arbeitsgaenge bei Engpass &
   * Wirkung"). Drei Groessen, die sich nachrechnen lassen:
   *   openManHours     - offene Arbeit der Auftraege in diesem Arbeitsgang
   *   plannedManHours  - davon im Zeitraum eingeplant
   *   blockedManHours  - Arbeit, die an einer Grenze liegenblieb (EINMAL
   *                      gezaehlt, nicht je Wartetag)
   */
  for (const p of result.projects ?? []) {
    for (const o of p.operations ?? []) {
      const r = rows[o.opId];
      if (!r) continue;
      const faktor = Number(o.manHourFactor ?? 1);
      r.contentManHours = round2(r.contentManHours + Number(o.totalUnits ?? 0) * faktor);
      r.openManHours = round2(r.openManHours + Number(o.initialRemainingUnits ?? 0) * faktor);
      r.orders += Number(o.initialRemainingUnits ?? 0) > 0 ? 1 : 0;
    }
  }
  const stau = blockedByOperation(result);
  for (const r of Object.values(rows)) {
    const b = stau[r.opId];
    if (!b) continue;
    r.blockedManHours = b.manHours;
    r.blockedDays = b.days;
    r.blockedPeak = b.peakHours;
    r.blockedCause = b.topCause;
  }

  return Object.values(rows).map((r) => ({
    ...r,
    /** Noch nicht eingeplante offene Arbeit im Zeitraum */
    notPlannedManHours: round2(Math.max(0, r.openManHours - r.plannedManHours)),
    balance: round2(r.capacityManHours - r.demandManHours),
    utilization: r.capacityManHours > 0 ? round2((r.plannedManHours / r.capacityManHours) * 100) : 0,
  }));
}

/**
 * Rechenweg der Kapazitaet - damit die Zahl nachrechenbar ist.
 *
 * Gemeldet von der Abteilungsleitung am 18.09.2026: "Die Zahlen und
 * Rechnungen sind nicht logisch. Ich habe 14 MA, es soll fuer 110 Tage
 * geplant werden ... wenn ich aber in die Ansicht gehe, kommen wir auf eine
 * Gesamtstundenzahl von 10731 h, das kann nicht stimmen."
 *
 * Der Vorwurf war berechtigt, aber nicht als Rechenfehler: Die Anwendung
 * hat nie gesagt, WELCHEN Zeitraum eine Kapazitaetszahl abdeckt und wie sie
 * entsteht. Diese Funktion legt beides offen. Je Arbeitstag gilt exakt:
 *
 *   Besetzung x (Wochenstunden / 5) x Produktivitaet - Betreuung - Reserve/5
 *
 * Die Betreuungsstunden fuer neue Kraefte gehen mit ab - sie sind der
 * Grund, warum eine Handrechnung ohne sie um einige Stunden je Tag
 * danebenliegt. Aufsummiert ueber die Arbeitstage ergibt das genau die
 * ausgewiesene Kapazitaet - die Gegenprobe steht als Test in
 * kapazitaet.test.js.
 *
 * @param {any} config @param {any[]} days Tagesreihe @param {string|null} until
 */
export function capacityDerivation(config, days, until, von = null) {
  const wochenStunden = Number(config.workTime?.regularHoursPerWeek ?? 37.5);
  const tageJeWoche = Number(config.workTime?.workDaysPerWeek ?? 5) || 5;
  const reserve = Number(config.workforce?.reserveHoursPerWeek ?? 0);
  const fenster = days.filter((d) => (!until || cmpDate(d.date, until) <= 0)
    && (!von || cmpDate(d.date, von) >= 0));
  const kap = (d) => Number(d.poolCapacity ?? d.capacity ?? 0) || 0;
  const arbeitstage = fenster.filter((d) => kap(d) > 0);
  const anzahl = arbeitstage.length;
  const summe = round2(fenster.reduce((a, d) => a + kap(d), 0));
  const stundenJeTag = round2(wochenStunden / tageJeWoche);
  const reserveJeTag = round2(reserve / tageJeWoche);

  /*
   * Getrennt nach Tagesart - sonst ist die Naeherung keine Naeherung.
   *
   * Hier stand ein einziges Produkt aus Mittelwerten mit der REGULAEREN
   * Arbeitszeit (37,5 h / 5 = 7,5 h). Gemeldet von der Abteilungsleitung
   * am 18.09.2026: "Warum gibt es da so ein grosses Defizit?" - bei 4 h
   * Ueberstunden je Mitarbeiter und Woche fehlten 943 h, und die Fusszeile
   * schob es auf "Feiertage und Urlaub". Das war falsch: Feiertage und
   * Urlaub stecken schon in der mittleren Besetzung und in der Zahl der
   * Arbeitstage. Gefehlt haben die UEBERSTUNDEN - die Naeherung rechnete
   * jeden Tag mit 7,5 h, die Planung mit 8,3 h.
   *
   * Samstage sind der zweite Fall: Sie zaehlen als Arbeitstag, laufen aber
   * mit eigener Laenge (6 h) und nur einem Teil der Mannschaft (20 %).
   * In einem gemeinsamen Mittelwert verschiebt das beide Seiten.
   *
   * Deshalb werden jetzt zwei Gruppen gerechnet, jede mit ihren eigenen
   * Mittelwerten und der Besetzung, mit der die Planung wirklich gerechnet
   * hat. Beide Summen zusammen ergeben die ausgewiesene Kapazitaet bis auf
   * Rundung - Tests halten das fuer Ueberstunden und Samstage fest.
   */
  const istSamstag = (d) => d.kind === 'SATURDAY';
  /** Besetzung, mit der die Planung den Tag gerechnet hat. */
  const koepfeAm = (d) => (istSamstag(d) && d.saturdayHeadcount != null
    ? Number(d.saturdayHeadcount) || 0
    : Number(d.headcount) || 0);

  const gruppe = (liste) => {
    const n = liste.length;
    if (n === 0) {
      return { days: 0, avgHeadcount: 0, hoursPerDay: 0, productivity: 0, grossHours: 0 };
    }
    const mittel = (f) => round2(liste.reduce((a, d) => a + f(d), 0) / n);
    const koepfe = mittel(koepfeAm);
    const stunden = mittel((d) => Number(d.hoursPerEmployee) || 0);
    /*
     * Die Produktivitaet wird auf VIER Stellen gefuehrt. Auf zwei gerundet
     * (0,93 statt 0,9333) liegt die Naeherung sonst um 0,36 % daneben -
     * bei 8.000 h sind das 30 h, die niemand zuordnen kann.
     */
    const prod = Math.round((liste.reduce((a, d) => a + (Number(d.productivity) || 0), 0) / n) * 10000) / 10000;
    return {
      days: n,
      avgHeadcount: koepfe,
      hoursPerDay: stunden,
      productivity: prod,
      /** Brutto vor Betreuung und Reserve - das ist die Naeherung der Gruppe */
      grossHours: round2(koepfe * stunden * prod * n),
    };
  };

  const regulaer = gruppe(arbeitstage.filter((d) => !istSamstag(d)));
  const samstage = gruppe(arbeitstage.filter(istSamstag));

  const betreuungSumme = round2(arbeitstage.reduce((a, d) => a + (Number(d.mentoringHours) || 0), 0));
  const mittelBetreuung = anzahl > 0 ? round2(betreuungSumme / anzahl) : 0;
  const reserveSumme = round2(arbeitstage.reduce(
    (a, d) => a + (Number(d.reserveHours) ?? reserveJeTag), 0));

  /*
   * Ueberstunden sichtbar machen: Sie sind der Unterschied zwischen der
   * Regelarbeitszeit und der Zeit, mit der die Planung an regulaeren Tagen
   * gerechnet hat.
   */
  const ueberJeTag = round2(Math.max(0, regulaer.hoursPerDay - stundenJeTag));
  const ueberSumme = round2(regulaer.avgHeadcount * ueberJeTag * regulaer.productivity * regulaer.days);

  const naeherung = round2(regulaer.grossHours + samstage.grossHours - betreuungSumme - reserveSumme);
  const mittelKoepfe = anzahl > 0
    ? round2(arbeitstage.reduce((a, d) => a + koepfeAm(d), 0) / anzahl)
    : 0;
  const mittelProd = anzahl > 0
    ? Math.round((arbeitstage.reduce((a, d) => a + (Number(d.productivity) || 0), 0) / anzahl) * 10000) / 10000
    : 0;

  /*
   * Tage, die die Sicherheitsregel auf null setzt (niemand arbeitet
   * allein). Sie zaehlen NICHT als Arbeitstage und fehlen damit in jeder
   * Handrechnung, die sie nicht kennt - deshalb stehen sie im Rechenweg.
   */
  const alleinTage = fenster.filter((d) => d.headcountDetail?.alone);
  const alleinStunden = round2(alleinTage.reduce(
    (a, d) => a + (Number(d.headcountDetail?.effectiveRaw) || 0) * (Number(d.hoursPerEmployee) || 0), 0));

  return {
    from: fenster[0]?.date ?? null,
    to: fenster.at(-1)?.date ?? null,
    calendarDays: fenster.length,
    /** Mindestbesetzung aus Arbeitsschutz - keine Stellschraube */
    minTogether: Math.max(0, Number(config.workforce?.minZusammen ?? 2)),
    aloneDays: alleinTage.length,
    aloneHours: alleinStunden,
    workDays: anzahl,
    weeks: round2(fenster.length / 7),
    avgHeadcount: mittelKoepfe,
    /** Regelarbeitszeit je Tag - OHNE Ueberstunden */
    hoursPerDay: stundenJeTag,
    hoursPerWeek: wochenStunden,
    productivity: mittelProd,
    reservePerWeek: reserve,
    reservePerDay: reserveJeTag,
    reserveTotal: reserveSumme,
    /** Betreuungsstunden je Arbeitstag im Schnitt (Einarbeitung) */
    mentoringPerDay: mittelBetreuung,
    mentoringTotal: betreuungSumme,
    /** Regulaere Arbeitstage - eigene Mittelwerte */
    regularDays: regulaer.days,
    regularHeadcount: regulaer.avgHeadcount,
    regularHoursPerDay: regulaer.hoursPerDay,
    regularProductivity: regulaer.productivity,
    regularGrossHours: regulaer.grossHours,
    /** Ueberstunden: der Teil der regulaeren Stunden ueber der Regelarbeitszeit */
    overtimePerDay: ueberJeTag,
    overtimeHours: ueberSumme,
    /** Samstage - eigene Laenge, eigene Besetzung */
    saturdayDays: samstage.days,
    saturdayHeadcount: samstage.avgHeadcount,
    saturdayHoursPerDay: samstage.hoursPerDay,
    saturdayProductivity: samstage.productivity,
    saturdayGrossHours: samstage.grossHours,
    /** Exakt: Summe der Tageswerte - das ist die ausgewiesene Kapazitaet */
    capacityHours: summe,
    /** Naeherung aus den Mittelwerten je Tagesart */
    approxHours: naeherung,
    deviation: round2(summe - naeherung),
  };
}

/**
 * Liegengebliebene Arbeit je Arbeitsgang - jede Arbeit genau EINMAL.
 *
 * Wie bei `bottleneckRanking`: `result.blocked` ist eine Tageswarteschlange.
 * Je Auftrag und Arbeitsgang zaehlt die groesste Wartemenge, nicht die Summe
 * ueber die Wartetage.
 *
 * @param {any} result
 * @returns {Record<string, {manHours:number, days:number, peakHours:number, topCause:string|null}>}
 */
export function blockedByOperation(result) {
  /** @type {Record<string, any>} */
  const out = {};
  const jeArbeit = new Map();
  const jeTag = new Map();
  const jeUrsache = {};
  for (const b of result.blocked ?? []) {
    if (b.info || !b.opId) continue;
    const e = (out[b.opId] ??= { manHours: 0, days: 0, peakHours: 0, topCause: null });
    void e;
    const arbeit = `${b.opId}\u0000${b.projectId}`;
    jeArbeit.set(arbeit, Math.max(jeArbeit.get(arbeit) ?? 0, b.manHours));
    const tag = `${b.opId}\u0000${b.date}`;
    jeTag.set(tag, (jeTag.get(tag) ?? 0) + b.manHours);
    ((jeUrsache[b.opId] ??= {})[b.cause] = (jeUrsache[b.opId][b.cause] ?? 0) + b.manHours);
  }
  for (const [key, stunden] of jeArbeit) {
    const opId = key.split('\u0000')[0];
    out[opId].manHours = round2(out[opId].manHours + stunden);
  }
  for (const [key, stunden] of jeTag) {
    const opId = key.split('\u0000')[0];
    out[opId].days += 1;
    out[opId].peakHours = Math.max(out[opId].peakHours, round2(stunden));
  }
  for (const [opId, ursachen] of Object.entries(jeUrsache)) {
    const top = Object.entries(ursachen).sort((a, b) => b[1] - a[1])[0]?.[0];
    out[opId].topCause = top ? (LIMITER_LABEL[top] ?? top) : null;
  }
  return out;
}

/**
 * Orbitalschweiss-Sonderauswertung (§54).
 *
 * FIX Hoch08 (Audit 20.09.2026): dieselbe Fensterregel wie bei
 * `processUtilization` - der angewaehlte Zeitraum hat auch eine
 * Untergrenze (`from`).
 *
 * @param {any} result @param {string|null} until @param {string|null} [from]
 */
export function orbitalReport(result, until, from = null) {
  const cfg = result.config;
  let machineHoursNeeded = 0;
  let machineHoursCap = 0;
  let manHours = 0;
  let welderSum = 0;
  let days = 0;
  let usableSum = 0;
  for (const d of result.daySeries) {
    if (from && cmpDate(d.date, from) < 0) continue;
    if (until && cmpDate(d.date, until) > 0) break;
    const kehl = d.byOp.ORBITAL_KEHLNAHT;
    const stumpf = d.byOp.ORBITAL_STUMPFNAHT;
    if ((!kehl && !stumpf) || d.poolCapacity <= 0) continue;
    /*
     * Kehlnaht und Stumpfnaht teilen sich denselben Maschinen-Topf
     * (Nutzerauftrag 23.09.2026) - die Kapazitaet (capUnits) ist bei
     * beiden gleich hoch und wird deshalb nur EINMAL gezaehlt. Verbraucht
     * (usedUnits/usedManHours) wird dagegen aus BEIDEN zusammengezaehlt.
     */
    machineHoursCap += kehl?.capUnits ?? stumpf?.capUnits ?? 0;
    machineHoursNeeded += (kehl?.usedUnits ?? 0) + (stumpf?.usedUnits ?? 0);
    manHours += (kehl?.usedManHours ?? 0) + (stumpf?.usedManHours ?? 0);
    welderSum += d.resources.welders;
    usableSum += d.resources.orbitalMachinesUsable;
    days++;
  }
  const machines = Number(cfg.resources?.orbitalMachinesActive ?? cfg.resources?.orbitalMachines ?? 0);
  const perWelder = Number(cfg.resources?.machinesPerWelder ?? 2);
  const avgWelders = days > 0 ? round2(welderSum / days) : 0;
  // Der Arbeitsinhalt wird in Mannstunden gefuehrt; die Maschinenbelegung
  // ergibt sich aus "Maschinen je Schweisser" (Lastenheft §54).
  const machineHoursNeededTotal = machineHoursNeeded * perWelder;
  const machineHoursCapTotal = machineHoursCap * perWelder;
  return {
    machinesInstalled: Number(cfg.resources?.orbitalMachines ?? 0),
    machinesActive: machines,
    machinesPerWelder: perWelder,
    weldersQualified: Number(cfg.resources?.welders?.qualified ?? 0),
    avgWelders,
    maxSimultaneousMachines: round2(Math.min(machines, avgWelders * perWelder)),
    avgUsableMachines: days > 0 ? round2(usableSum / days) : 0,
    manHoursCapacity: round2(machineHoursCap),
    manHoursNeeded: round2(machineHoursNeeded),
    machineHoursCapacity: round2(machineHoursCapTotal),
    machineHoursNeeded: round2(machineHoursNeededTotal),
    manHours: round2(manHours),
    utilization: machineHoursCap > 0 ? round2((machineHoursNeeded / machineHoursCap) * 100) : 0,
    limitedBy: avgWelders * perWelder < machines ? LIMITER.ORBITAL_WELDER : LIMITER.ORBITAL_MACHINE,
    limitedByLabel: avgWelders * perWelder < machines
      ? LIMITER_LABEL[LIMITER.ORBITAL_WELDER] : LIMITER_LABEL[LIMITER.ORBITAL_MACHINE],
    days,
  };
}
