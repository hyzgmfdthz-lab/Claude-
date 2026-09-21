/**
 * Mehraufwand: was zusaetzlich geleistet werden muss, damit kein Termin faellt.
 *
 * Diese Datei loest die alte Kennzahl "x Stunden nicht einplanbar" ab. Die war
 * sachlich falsch: Sie summierte eine WARTESCHLANGE ueber alle Tage auf. Ein
 * Auftrag, der fuenf Tage auf den Saegeplatz wartete, stand dort fuenfmal
 * drin - aus 141 Stunden Warteschlange wurden so 4.119 "nicht einplanbare"
 * Stunden. Eine Zahl, die um ein Vielfaches zu hoch ist, verleitet zu
 * Massnahmen, die viel zu gross sind.
 *
 * Die ehrliche Groesse ist eine andere und einfach nachzurechnen:
 *
 *   Bis zu jeder Woche stehen fest
 *     - die Stunden, die bis dahin FAELLIG sind (offene Arbeit der Auftraege,
 *       deren Fertigstellung bis dahin liegt), und
 *     - die Stunden, die bis dahin GELEISTET werden koennen (Kapazitaet).
 *   Die groesste Differenz ueber den Zeitraum ist der Mehraufwand.
 *
 * Beispiel aus dem Startdatenbestand: Bis KW 48 sind 5.329 h faellig,
 * geleistet werden koennen 4.649 h - es fehlen 679 h. Nicht 4.119.
 *
 * Bewusste Abgrenzung: Diese Rechnung zaehlt STUNDEN. Sie sagt nicht, dass
 * mit diesen Stunden auch jeder Termin steht - Saegen und Entgraten haben je
 * einen Platz, und der Stau dort loest sich nicht allein durch Mehrarbeit.
 * Sie ist damit eine UNTERGRENZE, und die Anwendung sagt das auch so.
 *
 * Zeitraum: 13 Wochen ab dem Planungsstichtag ("laufendes Quartal",
 * rollierend). Ein Kalenderquartal waere heute drei Wochen lang und naechste
 * Woche wieder dreizehn - die Zahl wuerde jede Woche springen.
 */

import { OPERATION_BY_ID, round1, round2, deepClone } from './model.js';
import { weekKey, weekStart, addDays, formatDE, cmpDate } from './calendar.js';
import { dayCapacity, placesFor } from './capacity.js';
import { hourlyCost } from './costs.js';
import { peopleOf } from './team.js';

/** Laenge des rollierenden Quartals in Wochen. */
export const QUARTAL_WOCHEN = 13;

/**
 * Obergrenze der Mehrarbeit je Mitarbeiter und Woche.
 * Auskunft der Abteilungsleitung (09/2026): "5 Stunden sind akzeptabel."
 */
export const UEBERSTUNDEN_GRENZE = 5;

/** Anteil der Mannschaft, der samstags kommt (Vorgabe: 20 %). */
export const SAMSTAG_QUOTE = 0.2;

/** Schluessel der Massnahmen - Reihenfolge ist die Vorgabe der Abteilung. */
export const MASSNAHME = {
  UEBERSTUNDEN: 'UEBERSTUNDEN',
  PLATZ: 'PLATZ',
  LEIHE: 'LEIHE',
  SAMSTAG: 'SAMSTAG',
};

/**
 * Rechnet den Mehraufwand eines Standes aus.
 *
 * @param {{config:any, projects:any[], templates:Record<string,any>}} input
 * @param {any} result Ergebnis von runSchedule (fuer Reststunden und Stau)
 * @returns {any}
 */
export function mehraufwand(input, result) {
  const config = input.config;
  const stichtag = config.planningDate;
  const wochen = wochenFenster(result, stichtag);
  if (wochen.length === 0) {
    return leer(stichtag);
  }
  const von = wochen[0].von;
  const bis = wochen[wochen.length - 1].bis;

  fuelleAuftraege(wochen, result);
  fuelleStau(wochen, result);

  // Aufsummieren: erst daraus wird aus zwei Reihen eine Aussage.
  let kumKap = 0;
  let kumFaellig = 0;
  for (const w of wochen) {
    kumKap = round2(kumKap + w.kapazitaet);
    kumFaellig = round2(kumFaellig + w.faellig);
    w.kumKapazitaet = kumKap;
    w.kumFaellig = kumFaellig;
    w.luecke = round1(Math.max(0, kumFaellig - kumKap));
  }

  const spitze = wochen.reduce((a, b) => (b.luecke > a.luecke ? b : a), wochen[0]);
  const stunden = spitze.luecke;
  const spitzeIndex = wochen.indexOf(spitze);

  // Ein Rechner fuer beide - jeder Kapazitaetsdurchgang wird nur einmal
  // gemacht, egal wie oft dieselbe Einstellung gebraucht wird.
  const rechner = gewinnRechner(config, wochen);
  const massnahmen = alleMassnahmen(input, wochen, stunden, rechner, spitzeIndex);
  const paket = schnuerePaket(input, wochen, stunden, massnahmen, rechner, spitzeIndex);

  return {
    stichtag,
    von,
    bis,
    wochen,
    /** Fehlende Stunden und die Woche, in der die Luecke am groessten ist. */
    stunden,
    engpassWoche: stunden > 0 ? spitze.weekKey : null,
    gedeckt: stunden <= 0,
    summe: satz(stunden, spitze, wochen),
    massnahmen,
    paket,
    /** Ausdrueckliche Einschraenkung - gehoert an die Zahl, nicht ins Kleingedruckte. */
    hinweis: 'Gezählt werden Stunden. Ob die Termine damit wirklich stehen, '
      + 'hängt zusätzlich an den Plätzen – die Anwendung rechnet nach dem '
      + 'Übernehmen den vollen Plan neu.',
  };
}

/** Leeres Ergebnis (kein Zeitraum vorhanden). @param {string} stichtag */
function leer(stichtag) {
  return {
    stichtag, von: null, bis: null, wochen: [], stunden: 0, engpassWoche: null,
    gedeckt: true, summe: 'Kein Zeitraum vorhanden.', massnahmen: [], paket: null,
    hinweis: '',
  };
}

/** Ein Satz, der die Zahl erklaert. */
function satz(stunden, spitze, wochen) {
  if (stunden <= 0) {
    return `Die Kapazität reicht in allen ${wochen.length} Wochen rechtzeitig aus.`;
  }
  return `Bis ${kw(spitze.weekKey)} sind ${fmt(spitze.kumFaellig)} h fällig, `
    + `geleistet werden können ${fmt(spitze.kumKapazitaet)} h – es fehlen ${fmt(stunden)} h.`;
}

/** @param {string} key */
function kw(key) { return `KW ${Number(key.slice(6))}`; }
/** @param {number} n */
function fmt(n) { return new Intl.NumberFormat('de-DE').format(Math.round(n)); }

/* ------------------------------------------------------------------ *
 * Zeitraum und Reihen
 * ------------------------------------------------------------------ */

/**
 * Die 13 Wochen ab dem Stichtag mit Kapazitaet je Woche.
 * @param {any} result @param {string} stichtag
 */
function wochenFenster(result, stichtag) {
  const tage = (result.daySeries ?? []).filter((d) => d.date >= stichtag);
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const d of tage) {
    const key = weekKey(d.date);
    if (!map.has(key)) {
      map.set(key, {
        weekKey: key,
        kw: Number(key.slice(6)),
        von: weekStart(key),
        bis: addDays(weekStart(key), 6),
        arbeitstage: 0,
        kapazitaet: 0,
        faellig: 0,
        auftraege: [],
        stau: [],
        letzterArbeitstag: null,
      });
    }
    const w = map.get(key);
    if (d.kind !== 'OFF') {
      w.arbeitstage += 1;
      w.letzterArbeitstag = d.date;
    }
    w.kapazitaet = round2(w.kapazitaet + Number(d.poolCapacity ?? 0));
  }
  return [...map.values()].slice(0, QUARTAL_WOCHEN);
}

/**
 * Traegt je Woche die Auftraege ein, deren Fertigstellung darin liegt.
 * @param {any[]} wochen @param {any} result
 */
function fuelleAuftraege(wochen, result) {
  const byKey = new Map(wochen.map((w) => [w.weekKey, w]));
  for (const p of result.projects ?? []) {
    if (!p.dueDate || p.remainingManHours <= 0) continue;
    const w = byKey.get(weekKey(p.dueDate));
    if (!w) continue;
    w.faellig = round2(w.faellig + p.remainingManHours);
    w.auftraege.push({
      id: p.id,
      orderNo: p.orderNo,
      customer: p.customer,
      dueDate: p.dueDate,
      stunden: round1(p.remainingManHours),
      lateDays: p.lateDays ?? 0,
      status: p.status,
      /**
       * Faellt der Auftrag nicht wegen der Kapazitaet, sondern weil er zu
       * spaet anfangen darf? Dann hilft nur ein anderer Arbeitsbeginn.
       */
      releaseDriver: p.releaseDriver ?? null,
      releaseDate: p.releaseDate ?? null,
    });
  }
  for (const w of wochen) w.auftraege.sort((a, b) => b.stunden - a.stunden);
}

/**
 * Traegt je Woche ein, was am letzten Arbeitstag der Woche wartet.
 *
 * Ausdruecklich eine MOMENTAUFNAHME und keine Summe ueber die Tage - genau
 * diese Summe war der Fehler der alten Kennzahl.
 *
 * @param {any[]} wochen @param {any} result
 */
function fuelleStau(wochen, result) {
  const byKey = new Map(wochen.map((w) => [w.weekKey, w]));
  /** @type {Map<string, Record<string, number>>} */
  const roh = new Map();
  for (const b of result.blocked ?? []) {
    if (b.info || !b.opId) continue;
    const w = byKey.get(weekKey(b.date));
    if (!w || w.letzterArbeitstag !== b.date) continue;
    if (!roh.has(w.weekKey)) roh.set(w.weekKey, {});
    const eintrag = roh.get(w.weekKey);
    eintrag[b.opId] = (eintrag[b.opId] ?? 0) + b.manHours;
  }
  for (const w of wochen) {
    const eintrag = roh.get(w.weekKey) ?? {};
    w.stau = Object.entries(eintrag)
      .map(([opId, h]) => ({ opId, name: OPERATION_BY_ID[opId]?.name ?? opId, stunden: round1(h) }))
      .filter((x) => x.stunden > 0)
      .sort((a, b) => b.stunden - a.stunden);
  }
}

/* ------------------------------------------------------------------ *
 * Massnahmen
 * ------------------------------------------------------------------ */

/**
 * Rechner fuer "was bringt diese Einstellung?".
 *
 * Gerechnet wird nur die Kapazitaetsseite - ohne Planlauf. Jeder Durchgang
 * geht ueber 13 Wochen x 7 Tage; deshalb wird jeder Durchgang gemerkt.
 * Ohne das Merken lief die vollstaendige Analyse in 500 statt 250 ms, und
 * sie laeuft bei jeder Reglerbewegung neu.
 *
 * @param {any} config Ausgangsstand
 * @param {any[]} wochen
 */
function gewinnRechner(config, wochen) {
  /** @type {Map<string, number[]>} */
  const merker = new Map();

  /** Kapazitaet je Woche fuer eine veraenderte Einstellung. */
  const proWoche = (schluessel, aendere) => {
    const gemerkt = merker.get(schluessel);
    if (gemerkt) return gemerkt;
    const c = aendere ? deepClone(config) : config;
    if (aendere) aendere(c);
    const reihe = wochen.map((w) => {
      let summe = 0;
      for (let i = 0; i < 7; i++) summe += dayCapacity(c, addDays(w.von, i)).poolHours ?? 0;
      return summe;
    });
    merker.set(schluessel, reihe);
    return reihe;
  };

  const basis = proWoche('BASIS', null);
  const summe = (reihe) => reihe.reduce((a, b) => a + b, 0);
  const basisSumme = summe(basis);

  return {
    basis,
    /** Zusatzstunden im ganzen Zeitraum. */
    gewinn: (schluessel, aendere) => round1(summe(proWoche(schluessel, aendere)) - basisSumme),
    /** Zusatzstunden je Woche - fuer Massnahmen, die Woche fuer Woche wirken. */
    gewinnJeWoche: (schluessel, aendere) => proWoche(schluessel, aendere)
      .map((v, i) => round1(v - basis[i])),
  };
}

/** Wochenschluessel des Zeitraums. @param {any[]} wochen */
function schluessel(wochen) { return wochen.map((w) => w.weekKey); }

/** Setzt Mehrarbeit je Mitarbeiter und Woche im ganzen Zeitraum. */
function patchUeberstunden(stunden, wochen) {
  return (/** @type {any} */ c) => {
    c.workforce ??= {};
    c.workforce.weekly ??= {};
    for (const key of schluessel(wochen)) {
      c.workforce.weekly[key] = { ...(c.workforce.weekly[key] ?? {}), overtimePerEmployee: stunden };
    }
  };
}

/** Schaltet Samstagsarbeit in den ersten n Wochen des Zeitraums ein. */
function patchSamstag(anzahl, wochen, quote = SAMSTAG_QUOTE) {
  return (/** @type {any} */ c) => {
    c.saturday ??= {};
    c.saturday.weeks ??= {};
    c.saturday.quota = quote;
    for (const key of schluessel(wochen).slice(0, anzahl)) {
      c.saturday.weeks[key] = { enabled: true, quotaOverride: quote, headcountOverride: null };
    }
  };
}

/** Holt n zusaetzliche Leiharbeiter ab dem naechsten Montag dazu. */
function patchLeihe(anzahl, ab) {
  return (/** @type {any} */ c) => {
    const leute = c.workforce?.team?.people ?? [];
    const frei = leute.filter((/** @type {any} */ p) => p.kind === 'LEIHE' && !p.startDate).slice(0, anzahl);
    for (const p of frei) {
      p.startDate = ab;
      p.defaultActive = true;
      p.note = `Aus dem Mehraufwand übernommen – Eintritt ${formatDE(ab)}`;
    }
  };
}

/** Richtet einen zweiten Platz am staerksten stauenden Arbeitsgang ein. */
function patchPlatz(opId) {
  return (/** @type {any} */ c) => {
    c.resources ??= {};
    c.resources.byOperation ??= {};
    const vorhanden = c.resources.byOperation[opId] ?? {};
    const max = Number(vorhanden.maxPlaces ?? 0);
    const jetzt = Number(vorhanden.places ?? 1);
    c.resources.byOperation[opId] = {
      ...vorhanden,
      places: max > 0 ? Math.min(max, jetzt + 1) : jetzt + 1,
    };
  };
}

/**
 * Alle vier Wege, immer alle vier.
 *
 * Auch der, der nichts bringt: Dass ein zweiter Saegeplatz KEINE
 * Mannstunden schafft, ist selbst eine Aussage. Sie verschwindet, wenn die
 * Karte ausgeblendet wird (Vorgabe der Abteilungsleitung).
 *
 * @param {any} input @param {any[]} wochen @param {number} luecke
 */
function alleMassnahmen(input, wochen, luecke, rechner, spitzeIndex) {
  const config = input.config;
  const ab = naechsterMontag(wochen[0].von, config.planningDate);
  /** @type {any[]} */
  const out = [];

  /*
   * FIX Hoch06 (Audit 20.09.2026): "gedeckt" heisst RECHTZEITIG gedeckt.
   *
   * `rechner.gewinn(...)` summiert den Zusatzgewinn ueber den GANZEN
   * Betrachtungszeitraum. Eine Massnahme, die erst NACH der Engpasswoche
   * wirkt (z. B. Leiharbeiter ab naechstem Montag, waehrend die groesste
   * Luecke schon diesen Freitag ist), zeigte trotzdem "reicht: true" - die
   * Gesamtstunden passten, obwohl an der eigentlichen Faelligkeit nichts
   * anders war. Deshalb hier zusaetzlich der kumulierte Gewinn NUR bis
   * einschliesslich der Engpasswoche - das ist die Groesse, die "reicht"
   * tatsaechlich beantworten muss.
   */
  const rechtzeitig = (schluessel, aendere) => round1(
    rechner.gewinnJeWoche(schluessel, aendere).slice(0, spitzeIndex + 1).reduce((a, b) => a + b, 0),
  );

  /* 1. Ueberstunden - guenstigster Weg, aber mit Grenze. */
  const ueberProStunde = rechner.gewinn('UE-1', patchUeberstunden(1, wochen));
  const noetig = ueberProStunde > 0 ? Math.ceil((luecke / ueberProStunde) * 2) / 2 : Infinity;
  const ueberWert = Math.min(UEBERSTUNDEN_GRENZE, Math.max(1, Number.isFinite(noetig) ? noetig : UEBERSTUNDEN_GRENZE));
  const ueberStunden = rechner.gewinn(`UE-${ueberWert}`, patchUeberstunden(ueberWert, wochen));
  const ueberRechtzeitig = rechtzeitig(`UE-${ueberWert}`, patchUeberstunden(ueberWert, wochen));
  out.push({
    key: MASSNAHME.UEBERSTUNDEN,
    rang: 1,
    name: 'Überstunden',
    wert: ueberWert,
    einheit: 'h je MA und Woche',
    beschreibung: `${zahl(ueberWert)} h je Mitarbeiter und Woche, ${wochen.length} Wochen lang`,
    stunden: ueberStunden,
    /** Davon bis einschliesslich der Engpasswoche wirksam (Fix Hoch06) */
    rechtzeitigStunden: ueberRechtzeitig,
    kosten: kosten(config, ueberStunden, 'OVERTIME'),
    reicht: ueberRechtzeitig >= luecke,
    grenze: ueberWert >= UEBERSTUNDEN_GRENZE && ueberStunden < luecke
      ? `Mehr als ${UEBERSTUNDEN_GRENZE} h je Mitarbeiter und Woche sind nicht vorgesehen.`
      : null,
    hinweis: `Eine Überstunde je Mitarbeiter und Woche bringt ${zahl(ueberProStunde)} h im Zeitraum.`,
    patch: { typ: MASSNAHME.UEBERSTUNDEN, wert: ueberWert },
  });

  /* 2. Zweiter Platz / Schicht - schafft Durchsatz, keine Mannstunden. */
  const engpass = groessterStau(wochen, config);
  out.push({
    key: MASSNAHME.PLATZ,
    rang: 2,
    name: 'Zweiter Platz / Schicht',
    wert: engpass ? 1 : 0,
    einheit: engpass ? `Platz ${engpass.name}` : '',
    beschreibung: engpass
      ? `Zweiter Platz beim ${engpass.name}`
      : 'Kein Arbeitsgang, an dem ein zweiter Platz möglich wäre',
    stunden: 0,
    kosten: 0,
    reicht: false,
    grenze: null,
    hinweis: engpass
      ? `Bringt keine zusätzlichen Mannstunden – löst aber den Stau beim ${engpass.name} `
        + `(${zahl(engpass.stunden)} h warten). Ohne Leute, die den Platz besetzen, bringt er nichts.`
      : 'Für die übrigen Arbeitsgänge ist kein zweiter Platz hinterlegt.',
    patch: engpass ? { typ: MASSNAHME.PLATZ, opId: engpass.opId } : null,
  });

  /* 3. Leiharbeiter. */
  const proLeihe = rechner.gewinn(`LE-1-${ab}`, patchLeihe(1, ab));
  const leiheFrei = freieLeihe(config);
  const leiheNoetig = proLeihe > 0 ? Math.min(leiheFrei, Math.ceil(luecke / proLeihe)) : leiheFrei;
  const leiheWert = Math.max(1, leiheNoetig);
  const leiheStunden = rechner.gewinn(`LE-${leiheWert}-${ab}`, patchLeihe(leiheWert, ab));
  const leiheRechtzeitig = rechtzeitig(`LE-${leiheWert}-${ab}`, patchLeihe(leiheWert, ab));
  const leiheRechnungsstunden = abrechnungsStunden(config, wochen, ab, leiheWert);
  out.push({
    key: MASSNAHME.LEIHE,
    rang: 3,
    name: 'Leiharbeiter',
    wert: leiheWert,
    einheit: leiheWert === 1 ? 'zusätzlich' : 'zusätzlich',
    beschreibung: `${leiheWert} Leiharbeiter zusätzlich ab ${formatDE(ab)}`,
    stunden: leiheStunden,
    /** Davon bis einschliesslich der Engpasswoche wirksam (Fix Hoch06) */
    rechtzeitigStunden: leiheRechtzeitig,
    /** Bezahlte Anwesenheitsstunden - Grundlage der Kostenrechnung (Fix Hoch05) */
    rechnungsstunden: leiheRechnungsstunden,
    kosten: kosten(config, leiheRechnungsstunden, 'TEMP'),
    reicht: leiheRechtzeitig >= luecke,
    grenze: leiheWert >= leiheFrei && leiheStunden < luecke
      ? `Mehr als ${leiheFrei} Leiharbeiterplätze sind nicht angelegt.`
      : null,
    hinweis: `Ein Leiharbeiter bringt ${zahl(proLeihe)} h im Zeitraum – `
      + 'Einarbeitung (40/60/80 %) und Betreuungsaufwand sind abgezogen.',
    patch: { typ: MASSNAHME.LEIHE, wert: leiheWert, ab },
  });

  /* 4. Samstagsarbeit. */
  const proSamstag = rechner.gewinn('SA-1', patchSamstag(1, wochen));
  const samstagNoetig = proSamstag > 0 ? Math.min(wochen.length, Math.ceil(luecke / proSamstag)) : wochen.length;
  const samstagWert = Math.max(1, samstagNoetig);
  const samstagStunden = rechner.gewinn(`SA-${samstagWert}`, patchSamstag(samstagWert, wochen));
  const samstagRechtzeitig = rechtzeitig(`SA-${samstagWert}`, patchSamstag(samstagWert, wochen));
  out.push({
    key: MASSNAHME.SAMSTAG,
    rang: 4,
    name: 'Samstagsarbeit',
    wert: samstagWert,
    einheit: samstagWert === 1 ? 'Samstag' : 'Samstage',
    beschreibung: `${samstagWert} Samstage mit ${Math.round(SAMSTAG_QUOTE * 100)} % der Mannschaft`,
    stunden: samstagStunden,
    /** Davon bis einschliesslich der Engpasswoche wirksam (Fix Hoch06) */
    rechtzeitigStunden: samstagRechtzeitig,
    kosten: kosten(config, samstagStunden, 'SATURDAY'),
    reicht: samstagRechtzeitig >= luecke,
    grenze: samstagWert >= wochen.length && samstagStunden < luecke
      ? `Mehr als ${wochen.length} Samstage hat der Zeitraum nicht.`
      : null,
    hinweis: `Ein Samstag bringt ${zahl(proSamstag)} h.`,
    patch: { typ: MASSNAHME.SAMSTAG, wert: samstagWert },
  });

  for (const m of out) {
    m.deckung = luecke > 0 ? Math.round((m.stunden / luecke) * 100) : 100;
  }
  return out;
}

/**
 * Das Paket fuer den ganzen Zeitraum.
 *
 * Reihenfolge wie von der Abteilungsleitung vorgegeben: Ueberstunden bis zur
 * Grenze, dann zweiter Platz, dann Leiharbeiter, dann Samstag. Genommen wird
 * von jedem Mittel nur so viel wie noetig - "ausreizen" heisst nicht "mehr
 * kaufen, als fehlt".
 *
 * @param {any} input @param {any[]} wochen @param {number} luecke @param {any[]} massnahmen
 */
function schnuerePaket(input, wochen, luecke, massnahmen, rechner, spitzeIndex) {
  if (luecke <= 0) return null;
  const config = input.config;
  const ab = naechsterMontag(wochen[0].von, config.planningDate);
  const teile = [];
  let offen = luecke;

  const proUeberstunde = rechner.gewinn('UE-1', patchUeberstunden(1, wochen));
  if (proUeberstunde > 0) {
    const noetig = Math.min(UEBERSTUNDEN_GRENZE, Math.ceil((offen / proUeberstunde) * 2) / 2);
    if (noetig > 0) {
      const h = rechner.gewinn(`UE-${noetig}`, patchUeberstunden(noetig, wochen));
      teile.push({
        key: MASSNAHME.UEBERSTUNDEN,
        text: `${zahl(noetig)} h Überstunden je Mitarbeiter und Woche`,
        stunden: h,
        kosten: kosten(config, h, 'OVERTIME'),
        patch: { typ: MASSNAHME.UEBERSTUNDEN, wert: noetig },
      });
      offen = round1(offen - h);
    }
  }

  const platz = massnahmen.find((m) => m.key === MASSNAHME.PLATZ && m.patch);
  if (platz) {
    teile.push({
      key: MASSNAHME.PLATZ,
      text: platz.beschreibung,
      stunden: 0,
      kosten: 0,
      patch: platz.patch,
      hinweis: 'löst den Stau, schafft aber keine Stunden',
    });
  }

  if (offen > 0) {
    const proLeihe = rechner.gewinn(`LE-1-${ab}`, patchLeihe(1, ab));
    const frei = freieLeihe(config);
    const anzahl = proLeihe > 0 ? Math.min(frei, Math.ceil(offen / proLeihe)) : 0;
    if (anzahl > 0) {
      const h = rechner.gewinn(`LE-${anzahl}-${ab}`, patchLeihe(anzahl, ab));
      /* FIX Hoch05: Kosten auf Rechnungsstunden, nicht auf den Nettogewinn. */
      const rechnungsstunden = abrechnungsStunden(config, wochen, ab, anzahl);
      teile.push({
        key: MASSNAHME.LEIHE,
        text: `${anzahl} Leiharbeiter zusätzlich ab ${formatDE(ab)}`,
        stunden: h,
        rechnungsstunden,
        kosten: kosten(config, rechnungsstunden, 'TEMP'),
        patch: { typ: MASSNAHME.LEIHE, wert: anzahl, ab },
      });
      offen = round1(offen - h);
    }
  }

  if (offen > 0) {
    const proSamstag = rechner.gewinn('SA-1', patchSamstag(1, wochen));
    const anzahl = proSamstag > 0 ? Math.min(wochen.length, Math.ceil(offen / proSamstag)) : 0;
    if (anzahl > 0) {
      const h = rechner.gewinn(`SA-${anzahl}`, patchSamstag(anzahl, wochen));
      teile.push({
        key: MASSNAHME.SAMSTAG,
        text: `${anzahl} Samstage mit ${Math.round(SAMSTAG_QUOTE * 100)} % der Mannschaft`,
        stunden: h,
        kosten: kosten(config, h, 'SATURDAY'),
        patch: { typ: MASSNAHME.SAMSTAG, wert: anzahl },
      });
      offen = round1(offen - h);
    }
  }

  const stunden = round1(teile.reduce((a, t) => a + t.stunden, 0));
  const kostenSumme = round2(teile.reduce((a, t) => a + t.kosten, 0));

  /*
   * FIX Hoch06 (Audit 20.09.2026): dieselbe Verwechslung wie bei den
   * Einzelmassnahmen, hier fuer das GESAMTPAKET. `stunden` (und damit
   * `reicht`) zaehlt den Zusatzgewinn ueber den ganzen Zeitraum - nicht, ob
   * an der Engpasswoche selbst genug zusammenkommt. Deshalb zusaetzlich je
   * Teil der kumulierte Gewinn bis einschliesslich der Engpasswoche.
   */
  const patchVon = (t) => {
    if (t.patch?.typ === MASSNAHME.UEBERSTUNDEN) return patchUeberstunden(t.patch.wert, wochen);
    if (t.patch?.typ === MASSNAHME.LEIHE) return patchLeihe(t.patch.wert, t.patch.ab);
    if (t.patch?.typ === MASSNAHME.SAMSTAG) return patchSamstag(t.patch.wert, wochen);
    return null;
  };
  const rechtzeitigStunden = round1(teile.reduce((a, t) => {
    const fn = patchVon(t);
    if (!fn) return a;
    const reihe = rechner.gewinnJeWoche(`PAKET-${t.key}-${JSON.stringify(t.patch)}`, fn);
    return a + reihe.slice(0, spitzeIndex + 1).reduce((x, y) => x + y, 0);
  }, 0));

  return {
    teile,
    stunden,
    /** Davon bis einschliesslich der Engpasswoche wirksam (Fix Hoch06) */
    rechtzeitigStunden,
    kosten: kostenSumme,
    deckung: luecke > 0 ? Math.round((stunden / luecke) * 100) : 100,
    reicht: rechtzeitigStunden >= luecke,
    offen: round1(Math.max(0, offen)),
    text: teile.map((t) => t.text).join(' + '),
  };
}

/* ------------------------------------------------------------------ *
 * Hilfen
 * ------------------------------------------------------------------ */

/** Arbeitsgang mit dem groessten Stau, an dem ein zweiter Platz moeglich ist. */
function groessterStau(wochen, config) {
  /** @type {Record<string, number>} */
  const summe = {};
  for (const w of wochen) {
    for (const s of w.stau) summe[s.opId] = Math.max(summe[s.opId] ?? 0, s.stunden);
  }
  const kandidaten = Object.entries(summe)
    .filter(([opId]) => moeglicherPlatz(config, opId))
    .sort((a, b) => b[1] - a[1]);
  if (kandidaten.length === 0) return null;
  const [opId, stunden] = kandidaten[0];
  return { opId, name: OPERATION_BY_ID[opId]?.name ?? opId, stunden: round1(stunden) };
}

/**
 * Ist an diesem Arbeitsgang ueberhaupt ein weiterer Platz vorgesehen?
 *
 * Nur wo `maxPlaces` hinterlegt ist: Saegen, Arbeitsvorbereitung und
 * Entgraten. Fuer Biegen und Beizen gibt es keinen zweiten Platz - die
 * Anwendung darf ihn dort auch nicht vorschlagen.
 */
function moeglicherPlatz(config, opId) {
  const eintrag = config?.resources?.byOperation?.[opId];
  if (!eintrag) return false;
  const max = Number(eintrag.maxPlaces ?? 0);
  if (!(max > 0)) return false;
  const jetzt = Number(placesFor(config, opId) ?? eintrag.places ?? 1);
  return max > jetzt;
}

/** Wie viele Leiharbeiterplaetze sind noch frei? */
function freieLeihe(config) {
  return peopleOf(config).filter((p) => p.kind === 'LEIHE' && !p.startDate).length;
}

/** Naechster Montag ab dem Stichtag (Eintritt neuer Leute). */
function naechsterMontag(wochenVon, stichtag) {
  let d = wochenVon;
  while (d < stichtag) d = addDays(d, 7);
  return d;
}

/**
 * FIX Hoch05 (Audit 20.09.2026): bezahlte Anwesenheits-/Rechnungsstunden
 * zusaetzlicher Leiharbeiter - GETRENNT vom produktiven Kapazitaetsgewinn.
 *
 * `rechner.gewinn(...)` liefert den NETTO-Kapazitaetsgewinn: Einarbeitung
 * (40/60/80 %) und Betreuungsaufwand sind darin bereits abgezogen. Die
 * Rechnung stellt aber die volle vereinbarte Wochenarbeitszeit in Rechnung -
 * unabhaengig davon, wie produktiv die Einarbeitungswoche war. Wer den
 * Nettogewinn mit dem Rechnungssatz multipliziert, unterschaetzt die Kosten.
 *
 * @param {any} config @param {any[]} wochen @param {string} ab @param {number} anzahl
 */
export function abrechnungsStunden(config, wochen, ab, anzahl) {
  const proWoche = Number(config.workTime?.regularHoursPerWeek ?? 37.5);
  const volleWochen = wochen.filter((w) => cmpDate(w.von, ab) >= 0).length;
  return round2(Math.max(0, anzahl) * volleWochen * proWoche);
}

/** Kosten der Zusatzstunden. @param {any} config @param {number} stunden @param {string} art */
function kosten(config, stunden, art) {
  if (stunden <= 0) return 0;
  const satzProStunde = art === 'TEMP'
    ? hourlyCost(config, { kind: 'LEIHE' }, 'REGULAR')
    : hourlyCost(config, { kind: 'STAMM' }, art === 'SATURDAY' ? 'SATURDAY' : 'OVERTIME');
  return round2(stunden * satzProStunde);
}

/** @param {number} n */
function zahl(n) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(n);
}

/**
 * Wandelt einen Massnahmen-Patch in eine Konfigurationsaenderung um.
 *
 * Getrennt gehalten, damit die Oberflaeche nur den Schluessel schicken muss
 * und die Rechnung an einer Stelle steht.
 *
 * @param {any} config Ausgangsstand (wird nicht veraendert)
 * @param {any} patch  aus `massnahmen[].patch` oder `paket.teile[].patch`
 * @param {string[]} wochenKeys Wochen des Zeitraums
 * @returns {any} veraenderte Kopie
 */
export function wendeMassnahmeAn(config, patch, wochenKeys) {
  const c = deepClone(config);
  const wochen = wochenKeys.map((key) => ({ weekKey: key, von: weekStart(key) }));
  if (!patch || !patch.typ) return c;
  switch (patch.typ) {
    case MASSNAHME.UEBERSTUNDEN: patchUeberstunden(Number(patch.wert), wochen)(c); break;
    case MASSNAHME.SAMSTAG: patchSamstag(Number(patch.wert), wochen)(c); break;
    case MASSNAHME.LEIHE: patchLeihe(Number(patch.wert), patch.ab)(c); break;
    case MASSNAHME.PLATZ: patchPlatz(patch.opId)(c); break;
    default: break;
  }
  return c;
}
