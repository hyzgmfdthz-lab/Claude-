/**
 * Plausibilitaetspruefung: "Kommt mir das komisch vor?"
 *
 * Auftrag der Abteilungsleitung: "Die App sollte immer warnen wenn ihr
 * etwas komisch vorkommt oder nicht plausibel ist."
 *
 * Abgrenzung zur Datenpruefung (validation.js): Dort geht es um den
 * Datenbestand allein - fehlende Termine, doppelte Auftragsnummern,
 * unmoegliche Werte. Hier geht es um das ERGEBNIS im Vergleich zur
 * Wirklichkeit: Sprunghafte Besetzung, nicht gepflegte Urlaube, ein
 * Schichtmodell, das die Mannschaft gar nicht besetzen kann, Auftraege,
 * die laut Lieferdatum fertig sein muessten, aber keinen Haken haben.
 *
 * Grundhaltung: Die Anwendung erfindet keine Zahlen, sondern benennt die
 * Stelle, an der eine Annahme die Messwerte ueberstimmt.
 */

import { round1, round2, OPERATION_BY_ID } from './model.js';
import { formatDE, cmpDate, weekKey, addDays, weekday } from './calendar.js';
import { peopleOf, teamOn, shiftCapability, weekActive, SHIFTS } from './team.js';

/** Dringlichkeit eines Befundes. */
export const PLAUSI_LEVEL = {
  KRITISCH: 'KRITISCH',
  WARNUNG: 'WARNUNG',
  HINWEIS: 'HINWEIS',
};

const RANG = { KRITISCH: 3, WARNUNG: 2, HINWEIS: 1 };

/** Bereiche, in denen ein Befund auftreten kann. */
export const PLAUSI_AREA = {
  BESETZUNG: 'Besetzung',
  AUFTRAEGE: 'Aufträge',
  KAPAZITAET: 'Kapazität',
  DATEN: 'Datenpflege',
};

/**
 * Prueft einen gerechneten Stand auf Unplausibilitaeten.
 *
 * @param {any} input     materialisiertes Szenario (config, projects, ...)
 * @param {any} result    Ergebnis von runSchedule
 * @param {{weeks?:any[], kpis?:any, staffing?:any, range?:any, assignment?:any}} [extra]
 * @returns {{items:any[], counts:Record<string,number>, countsAll:Record<string,number>,
 *   acknowledged:number, open:number, worst:string|null, summary:string}}
 */
export function pruefePlausibilitaet(input, result, extra = {}) {
  const config = input.config;
  const items = [];
  /**
   * @param {string} level @param {string} code @param {string} area
   * @param {string} title @param {string} text
   * @param {{hint?:string, ids?:string[], value?:any}} [o]
   */
  const add = (level, code, area, title, text, o = {}) => {
    items.push({
      code, level, area, title, text,
      hint: o.hint ?? null,
      ids: o.ids ?? null,
      value: o.value ?? null,
      /**
       * Wiedererkennung ueber Neuberechnungen hinweg. Der Schluessel haengt
       * bewusst NICHT am Text: Zahlen im Text aendern sich staendig, der
       * Sachverhalt bleibt derselbe. Daran haengt das Bestaetigen
       * ("Thema ist abgestellt, weg damit").
       */
      key: befundKey(code, o.ids),
      acknowledged: false,
      ack: null,
    });
  };

  besetzung(config, result, extra, add);
  mannschaft(config, result, add);
  schichten(config, add);
  auftraege(config, input.projects ?? [], result, extra, add);
  kapazitaet(config, result, extra, add);
  datenpflege(config, input, result, add);

  items.sort((a, b) => (RANG[b.level] ?? 0) - (RANG[a.level] ?? 0));
  return fasseZusammen(items);
}

/**
 * Stabiler Schluessel eines Befundes.
 * @param {string} code @param {string[]|null|undefined} ids
 */
export function befundKey(code, ids) {
  const teil = Array.isArray(ids) && ids.length > 0 ? ids.slice().sort().join('+') : '';
  return teil ? `${code}#${teil}` : code;
}

/**
 * Zaehlt die Befunde. Bestaetigte Befunde zaehlen NICHT mit - sie stehen
 * weiter in der Liste, aber weder in der Kachel noch in der Ampel.
 * @param {any[]} items
 */
/**
 * @param {any[]} items
 * @returns {{items:any[], counts:Record<string,number>, countsAll:Record<string,number>,
 *   acknowledged:number, open:number, worst:string|null, summary:string}}
 */
function fasseZusammen(items) {
  const counts = { KRITISCH: 0, WARNUNG: 0, HINWEIS: 0 };
  const countsAll = { KRITISCH: 0, WARNUNG: 0, HINWEIS: 0 };
  let acknowledged = 0;
  let worst = null;
  for (const i of items) {
    countsAll[i.level] = (countsAll[i.level] ?? 0) + 1;
    if (i.acknowledged) { acknowledged += 1; continue; }
    counts[i.level] = (counts[i.level] ?? 0) + 1;
    if ((RANG[i.level] ?? 0) > (RANG[worst] ?? 0)) worst = i.level;
  }
  return {
    items, counts, countsAll, acknowledged, worst,
    open: items.length - acknowledged,
    summary: zusammenfassung(counts)
      + (acknowledged > 0 ? ` · ${acknowledged} bestätigt` : ''),
  };
}

/**
 * Traegt die Bestaetigungen ("erledigt, wegklicken") in einen gerechneten
 * Stand ein und zaehlt neu.
 *
 * Absichtlich hier und nicht beim Speichern: Ein bestaetigter Befund
 * verschwindet nicht aus der Pruefung. Er wird nur leiser. Taucht derselbe
 * Sachverhalt spaeter DRINGENDER auf (aus einem Hinweis wird eine Warnung),
 * meldet er sich wieder - sonst waere eine einmalige Bestaetigung ein
 * dauerhafter blinder Fleck.
 *
 * @param {any} plausi Ergebnis von pruefePlausibilitaet
 * @param {{key:string, level?:string, user?:string, at?:string, note?:string}[]} acks
 * @returns {{items:any[], counts:Record<string,number>, countsAll:Record<string,number>,
 *   acknowledged:number, open:number, worst:string|null, summary:string}}
 */
export function wendeBestaetigungenAn(plausi, acks) {
  if (!plausi || !Array.isArray(plausi.items)) return plausi;
  const map = new Map((acks ?? []).filter((a) => a && a.key).map((a) => [a.key, a]));
  for (const item of plausi.items) {
    const ack = map.get(item.key);
    item.acknowledged = false;
    item.ack = null;
    if (!ack) continue;
    const damals = RANG[ack.level] ?? 0;
    if ((RANG[item.level] ?? 0) > damals) {
      // Dringlichkeit gestiegen: der Befund meldet sich wieder.
      item.ack = { ...ack, reopened: true };
      continue;
    }
    item.acknowledged = true;
    item.ack = { ...ack, reopened: false };
  }
  return fasseZusammen(plausi.items);
}

/** Faellige Arbeit bis einschliesslich der n-ten Woche. */
function arbeitBis(faellig, wochen, n) {
  let s = 0;
  for (let i = 0; i < n && i < wochen.length; i++) s += faellig.get(wochen[i].weekKey) ?? 0;
  return s;
}

/** Kapazitaet bis einschliesslich der n-ten Woche. */
function kapBis(wochen, n) {
  let s = 0;
  for (let i = 0; i < n && i < wochen.length; i++) s += Number(wochen[i].capacity) || 0;
  return s;
}

/**
 * Kopfzahlen unter 10 mit einer Stelle - "1,6 Mitarbeiter" ist eine
 * Aussage, "2 Mitarbeiter" waere schon eine Aufrundung nach oben.
 */
function formatKoepfe(n) {
  return n < 10 ? String(round1(n)).replace('.', ',') : String(Math.round(n));
}

/** Lesbare Kalenderwoche aus einem Wochenschluessel. @param {string} key */
function kwText(key) { return `KW ${Number(String(key).slice(6))}/${String(key).slice(0, 4)}`; }

function zusammenfassung(counts) {
  const teile = [];
  if (counts.KRITISCH) teile.push(`${counts.KRITISCH} kritisch`);
  if (counts.WARNUNG) teile.push(`${counts.WARNUNG} Warnung${counts.WARNUNG === 1 ? '' : 'en'}`);
  if (counts.HINWEIS) teile.push(`${counts.HINWEIS} Hinweis${counts.HINWEIS === 1 ? '' : 'e'}`);
  if (teile.length === 0) return 'Keine Auffälligkeiten gefunden.';
  return teile.join(' · ');
}

/* ------------------------------------------------------------------ *
 * Besetzung
 * ------------------------------------------------------------------ */

/**
 * Der haeufigste stille Fehler: Bis zum letzten Messtag rechnet die
 * Anwendung mit der Tagesliste, danach mit der Mannschaft. Springt die
 * Besetzung an dieser Nahtstelle nach oben, ist der Plan ab dort zu
 * optimistisch - typischerweise weil Urlaube noch nicht gepflegt sind.
 */
function besetzung(config, result, extra, add) {
  const tage = (result.daySeries ?? []).filter((d) => d.kind !== 'OFF');
  if (tage.length === 0) return;

  const gemessen = tage.filter((d) => d.headcountDetail?.source === 'TAGESLISTE');
  const angenommen = tage.filter((d) => d.headcountDetail?.source !== 'TAGESLISTE');
  const mittel = (list) => (list.length
    ? round2(list.reduce((a, d) => a + Number(d.headcountDetail?.effective ?? d.headcount ?? 0), 0) / list.length)
    : null);

  /*
   * Seit die Messwerte nur bis zum Stichtag gelten, stehen in der
   * gerechneten Reihe oft gar keine Messtage mehr - die Rechnung beginnt
   * am Stichtag. Der Vergleich bleibt trotzdem wichtig: Was zuletzt
   * WIRKLICH da war, gegen das, was ab jetzt geplant ist. Dafuer wird
   * notfalls direkt in die Tagesliste geschaut.
   */
  const liste = Object.entries(config.workforce?.dailyAvailable ?? {})
    .filter(([d]) => weekday(d) <= 5 && (!config.planningDate || d <= config.planningDate))
    .sort(([a], [b]) => a.localeCompare(b));
  const ausListe = liste.length >= 10
    ? {
      werte: liste.slice(-15).map(([, v]) => Number(v)),
      letzterTag: liste[liste.length - 1][0],
    }
    : null;

  if ((gemessen.length >= 5 || ausListe) && angenommen.length >= 3) {
    const letzten = gemessen.length >= 5
      ? mittel(gemessen.slice(-10))
      : round2(ausListe.werte.reduce((a, b) => a + b, 0) / ausListe.werte.length);
    const ersten = mittel(angenommen.slice(0, 10));
    const nahtstelle = gemessen.length >= 5
      ? gemessen[gemessen.length - 1]?.date
      : ausListe.letzterTag;
    const differenz = round1((ersten ?? 0) - (letzten ?? 0));
    if (differenz >= 1) {
      add(differenz >= 2 ? PLAUSI_LEVEL.KRITISCH : PLAUSI_LEVEL.WARNUNG,
        'BESETZUNG_SPRUNG', PLAUSI_AREA.BESETZUNG,
        'Geplante Besetzung liegt über der zuletzt gemessenen',
        `Gemessen waren bis ${formatDE(nahtstelle)} im Schnitt ${letzten} Mitarbeiter da. `
        + `Ab dem Planungsstichtag rechnet die Anwendung mit ${ersten} – also ${differenz} mehr.`,
        {
          hint: 'Meist fehlen die Urlaube in der Mannschaft. Solange sie fehlen, ist der Plan '
            + 'ab dieser Stelle zu optimistisch und begründet keinen Personalantrag.',
          value: { gemessen: letzten, geplant: ersten, ab: nahtstelle },
        });
    }
  }

  // Sprunghafte Besetzung innerhalb der Rechnung (ohne Quellenwechsel)
  let groesster = null;
  for (let i = 1; i < tage.length; i++) {
    const a = tage[i - 1];
    const b = tage[i];
    if ((a.headcountDetail?.source ?? '') !== (b.headcountDetail?.source ?? '')) continue;
    const va = Number(a.headcountDetail?.effective ?? a.headcount ?? 0);
    const vb = Number(b.headcountDetail?.effective ?? b.headcount ?? 0);
    const d = Math.abs(vb - va);
    if (d >= 3 && (!groesster || d > groesster.d)) groesster = { d: round1(d), von: a, bis: b, va, vb };
  }
  if (groesster) {
    add(PLAUSI_LEVEL.HINWEIS, 'BESETZUNG_UNRUHIG', PLAUSI_AREA.BESETZUNG,
      'Besetzung wechselt von einem Tag auf den anderen stark',
      `Von ${formatDE(groesster.von.date)} auf ${formatDE(groesster.bis.date)} ändert sich die `
      + `Besetzung um ${groesster.d} Mitarbeiter (${round1(groesster.va)} → ${round1(groesster.vb)}).`,
      { hint: 'Das kann stimmen (Urlaubsblock, Schichtwechsel) – bitte einmal gegenprüfen.' });
  }
}

/* ------------------------------------------------------------------ *
 * Mannschaft
 * ------------------------------------------------------------------ */

function mannschaft(config, result, add) {
  const team = config.workforce?.team;
  if (!team || !Array.isArray(team.people) || team.people.length === 0) return;
  const people = peopleOf(config);
  const stichtag = config.planningDate;

  /* --- Urlaube gepflegt? --- */
  const letzterMesstag = letzterTageslistentag(config);
  const abGepflegt = letzterMesstag ? addDays(letzterMesstag, 1) : stichtag;
  // Nur wer nach dem Messzeitraum ueberhaupt eingeplant ist, zaehlt -
  // Platzhalter-Leiharbeiter ohne angehakte Woche wuerden die Zahl
  // sonst unnoetig aufblaehen.
  const eingeplant = people.filter((p) => weekActive(p, abGepflegt)
    || Object.entries(p.weeks ?? {}).some(([, an]) => an));
  const spaeter = [];
  for (const p of eingeplant) {
    const hat = (p.absences ?? []).some((a) => a?.from && cmpDate(a.to || a.from, abGepflegt) >= 0);
    if (!hat) spaeter.push(p.id);
  }
  if (eingeplant.length > 0 && spaeter.length === eingeplant.length) {
    add(PLAUSI_LEVEL.WARNUNG, 'URLAUB_UNGEPFLEGT', PLAUSI_AREA.BESETZUNG,
      'Keine Abwesenheit nach dem letzten Messtag gepflegt',
      `Ab ${formatDE(abGepflegt)} rechnet die Anwendung mit der Mannschaftsliste. `
      + `Dort ist für keine der ${eingeplant.length} eingeplanten Personen ein Urlaub, eine Schulung oder eine `
      + 'andere Abwesenheit eingetragen – die Planung geht also davon aus, dass ab dort '
      + 'niemand mehr fehlt.',
      { hint: 'Urlaubsplanung unter "Mannschaft → Abwesenheiten" eintragen. Vorher ist jede '
        + 'Aussage über freie Kapazität zu gut.' });
  }

  /*
   * --- Zahlenlisten neben der Mannschaft ---
   *
   * "Leiharbeiter" und "Neueinstellungen" unter Parameter -> Personal sind
   * reine ANZAHLEN. Sie kommen zur Mannschaft DAZU. Uebernimmt jemand einen
   * Vorschlag aus "Was bringt wirklich etwas?", landen sie dort - und in der
   * Wochenuebersicht stehen ploetzlich 29 Mitarbeiter, wo die Mannschaft
   * neun hat. In der Mannschaftsliste sucht man sie vergeblich.
   */
  const wf = config.workforce ?? {};
  const anzahl = (liste) => (liste ?? []).reduce((a2, x) => a2 + (Number(x?.count) || 0), 0);
  const zusatz = anzahl(wf.tempWorkers) + anzahl(wf.newHires);
  if (zusatz > 0) {
    const namen = [...(wf.tempWorkers ?? []), ...(wf.newHires ?? [])]
      .filter((x) => Number(x?.count) > 0)
      .map((x) => `${x.label || 'ohne Bezeichnung'} (+${x.count}${x.from ? ` ab ${formatDE(x.from)}` : ''})`);
    add(PLAUSI_LEVEL.HINWEIS, 'ZAHLENLISTEN_OHNE_WIRKUNG', PLAUSI_AREA.BESETZUNG,
      'Alte Zahlenlisten sind noch hinterlegt – sie zählen nicht mehr',
      `Unter Parameter → Personal stehen ${zusatz} Personen als reine Anzahl: ${namen.join(', ')}. `
      + 'Solange die Mannschaft die Grundlage ist, gehen sie NICHT in die Rechnung ein – '
      + 'Personal wird ausschließlich über den Reiter Mannschaft gepflegt.',
      { hint: 'Wer wirklich kommt, gehört in die Mannschaft (Leiharbeiter mit Eintritt). '
        + 'Die alten Einträge lassen sich unter Einstellungen → Parameter → Personal entfernen.',
        value: { zusatz } });
  }

  /* --- Leiharbeiter ohne Einsatzende --- */
  const offen = people.filter((p) => p.kind === 'LEIHE' && p.startDate && !p.endDate
    && (p.defaultActive !== false));
  if (offen.length > 0) {
    add(PLAUSI_LEVEL.HINWEIS, 'LEIHE_OHNE_ENDE', PLAUSI_AREA.BESETZUNG,
      `${offen.length} Leiharbeiter ohne Einsatzende`,
      `${offen.map((p) => p.label || p.id).join(', ')} sind ab ihrem Eintritt dauerhaft `
      + 'eingeplant, weil kein Einsatzende hinterlegt ist. Der Plan rechnet sie damit bis zum '
      + 'Ende des Horizonts mit.',
      { ids: offen.map((p) => p.id),
        hint: 'Läuft der Überlassungsvertrag aus, das Ende in der Mannschaft eintragen – '
          + 'sonst plant die Anwendung mit Leuten, die nicht mehr da sind.' });
  }

  /*
   * --- Qualifikationsmatrix ---
   *
   * Hier wurde gewarnt, wenn bei allen Personen alle Arbeitsgaenge angehakt
   * sind. Die Warnung ist gestrichen. Festlegung der Abteilungsleitung
   * (18.09.2026): "Braucht die Pruefung nicht drauf hinweisen wir haben so
   * viele faehige schweisser wie in der Q-Matrix angegeben."
   *
   * Die Matrix IST die Auskunft - sie zu bezweifeln waere Anmassung. Wer
   * dort angehakt ist, kann den Arbeitsgang. Was fehlt, meldet weiterhin
   * ARBEITSGANG_OHNE_QUALIFIZIERTE: ein Arbeitsgang, den niemand darf.
   */

  /*
   * --- Arbeitsgang ohne Qualifizierte ---
   *
   * Der gefaehrlichste Handgriff in der Matrix: Wird der letzte Haken fuer
   * einen Arbeitsgang entfernt, kann die Anwendung dessen Arbeit NIE mehr
   * einplanen - der Auftrag steht still, ohne dass es nach einem
   * Kapazitaetsproblem aussieht. Vorgabe vom 18.09.2026 ("passe den
   * Einsatzplan automatisch an wenn ich die Qualimatrix anpasse"): Die
   * Folge muss sofort auf dem Tisch liegen.
   */
  if (team.enforceSkills !== false && people.length > 0) {
    const gebraucht = new Map();
    for (const p2 of result.projects ?? []) {
      for (const o of p2.operations ?? []) {
        const offenH = Number(o.initialRemainingUnits ?? 0) * Number(o.manHourFactor ?? 1);
        if (offenH <= 0) continue;
        gebraucht.set(o.opId, round1((gebraucht.get(o.opId) ?? 0) + offenH));
      }
    }
    const ohne = [];
    for (const [opId, stunden] of gebraucht) {
      const wer = people.filter((p2) => p2.skills?.[opId]);
      if (wer.length === 0) {
        ohne.push({ opId, name: OPERATION_BY_ID[opId]?.name ?? opId, stunden });
      }
    }
    if (ohne.length > 0) {
      ohne.sort((x, y) => y.stunden - x.stunden);
      add(PLAUSI_LEVEL.KRITISCH, 'ARBEITSGANG_OHNE_QUALIFIZIERTE', PLAUSI_AREA.BESETZUNG,
        `${ohne.length} ${ohne.length === 1 ? 'Arbeitsgang' : 'Arbeitsgänge'} ohne qualifizierte Mitarbeiter`,
        `Für ${ohne.map((x) => `${x.name} (${Math.round(x.stunden)} h offen)`).join(', ')} ist in der `
        + 'Qualifikationsmatrix niemand angehakt. Diese Arbeit kann nicht eingeplant werden – '
        + 'die betroffenen Aufträge stehen still, und im Einsatzplan steht bei den Anwesenden '
        + '„keine Qualifikation".',
        { hint: 'In der Mannschaft unter „Wer darf was?" mindestens eine Person anhaken. '
          + 'Ist wirklich niemand qualifiziert, gehört die Arbeit vergeben oder geschult – '
          + 'ein leerer Arbeitsgang macht jeden Termin unerreichbar.',
          value: { arbeitsgaenge: ohne } });
    }
  }

  /* --- Mannschaft gegen die alten Wochenzahlen --- */
  const weekly = config.workforce?.weekly ?? {};
  const wochen = Object.keys(weekly).sort();
  const abweichungen = [];
  for (const wk of wochen) {
    const alt = Number(weekly[wk]?.base);
    if (!Number.isFinite(alt)) continue;
    let montag;
    try { montag = wochenMontag(wk); } catch { continue; }
    if (cmpDate(montag, stichtag) < 0) continue;
    const neu = teamOn(config, montag).factor;
    if (Math.abs(neu - alt) >= 1.5) abweichungen.push({ wk, alt, neu: round1(neu) });
  }
  if (abweichungen.length >= 3) {
    const bsp = abweichungen.slice(0, 3).map((a) => `${a.wk}: ${a.alt} → ${a.neu}`).join(', ');
    add(PLAUSI_LEVEL.HINWEIS, 'MANNSCHAFT_GEGEN_WOCHENZAHLEN', PLAUSI_AREA.BESETZUNG,
      'Mannschaft und alte Wochenzahlen widersprechen sich',
      `In ${abweichungen.length} Wochen weicht die Mannschaftsliste um mindestens 1,5 Mitarbeiter `
      + `von den Wochenzahlen der bisherigen Planung ab (${bsp}).`,
      { hint: 'Die alten Wochenzahlen enthielten Urlaube bereits. Eine Abweichung nach oben ist '
        + 'meist ein Zeichen für fehlende Abwesenheiten in der Mannschaft.' });
  }
}

/* ------------------------------------------------------------------ *
 * Schichten
 * ------------------------------------------------------------------ */

/**
 * Schichtbetrieb ist nur so viel wert, wie die Mannschaft ihn besetzen
 * kann. Die Abteilungsleitung hat zwei Regeln vorgegeben: STWUE und MAAP
 * fahren keine Schicht, und niemand ist alleine auf Schicht.
 */
function schichten(config, add) {
  const eigene = config.resources?.byOperation ?? {};
  const allgemein = Number(config.resources?.operatingHoursPerDay ?? 7);
  const SCHICHT = 7.5;

  /**
   * Wie viel laenger als eine Schicht ist der Platz besetzt?
   *
   * Bewusst KEINE Rundung auf ganze Schichten: 12 h sind eine versetzte
   * Besetzung, keine zweite Schicht. Wer 12 h aufrundet, verlangt doppelt
   * so viele Leute wie noetig und meldet einen Engpass, den es nicht gibt.
   */
  const faktor = (stunden) => Math.max(1, (Number(stunden) || SCHICHT) / SCHICHT);

  /** Wie das Modell in der Oberflaeche heisst. */
  const modell = (stunden) => {
    const f = faktor(stunden);
    if (f >= 2.9) return '3 Schichten';
    if (f >= 1.9) return '2 Schichten';
    return `versetzte Besetzung ${round1(Number(stunden))} h`;
  };

  /** Zusaetzlich noetige Anwesenheit ueber die Regelschicht hinaus. */
  let zusatzKoepfe = 0;
  const mitEigenem = [];
  const ueberAllgemein = [];
  for (const [opId, w] of Object.entries(eigene)) {
    const eigenerWert = w?.operatingHours != null && w.operatingHours !== '';
    const stunden = eigenerWert ? Number(w.operatingHours) : allgemein;
    const f = faktor(stunden);
    if (f <= 1.05) continue;
    const plaetze = Math.max(1, Number(w?.places ?? 1));
    const jePlatz = Math.max(1, Number(w?.workersPerPlace ?? 1));
    zusatzKoepfe += (f - 1) * plaetze * jePlatz;
    const name = OPERATION_BY_ID[opId]?.name ?? opId;
    (eigenerWert ? mitEigenem : ueberAllgemein).push(`${name} (${modell(stunden)})`);
  }
  zusatzKoepfe = Math.ceil(zusatzKoepfe);
  if (zusatzKoepfe <= 0) return;

  /*
   * Woher der Wert kommt, gehoert in die Meldung. Sonst liest sich
   * "AV 2-schichtig, SAEGEN 2-schichtig, ..." so, als haette jemand jeden
   * Arbeitsgang einzeln umgestellt - dabei steht meist nur EIN allgemeiner
   * Wert dahinter.
   */
  /** Hoechstens vier Namen - der Rest waere eine Wand aus Text. */
  const kurz = (liste) => (liste.length <= 4
    ? liste.join(', ')
    : `${liste.slice(0, 4).join(', ')} und ${liste.length - 4} weitere`);

  const herkunft = [];
  if (ueberAllgemein.length > 0) {
    herkunft.push(`${ueberAllgemein.length} Arbeitsgänge über die allgemeine Belegungszeit von `
      + `${round1(allgemein)} h – nicht einzeln eingestellt (${kurz(ueberAllgemein)})`);
  }
  if (mitEigenem.length > 0) {
    herkunft.push(`${mitEigenem.length} mit eigenem Wert (${kurz(mitEigenem)})`);
  }

  const wo = ueberAllgemein.length > 0
    ? 'Eingestellt wird das unter Einstellungen → Parameter, Feld „Belegungszeit der Plätze je Tag"; '
      + 'je Arbeitsgang unter Übersicht → Engpässe & Wirkung in der Tabelle „Belegungszeit und Plätze je Arbeitsgang".'
    : 'Eingestellt wird das unter Übersicht → Engpässe & Wirkung in der Tabelle '
      + '„Belegungszeit und Plätze je Arbeitsgang", Spalte „Schichtmodell".';

  const faehig = shiftCapability(config);
  const koepfe = Number(faehig.capable ?? 0);
  if (koepfe < zusatzKoepfe) {
    add(PLAUSI_LEVEL.KRITISCH, 'SCHICHT_NICHT_BESETZBAR', PLAUSI_AREA.BESETZUNG,
      'Der eingestellte Schichtbetrieb ist nicht besetzbar',
      `Die längere Belegungszeit verlangt ${zusatzKoepfe} Personen zusätzlich außerhalb der `
      + `Regelschicht. Schichtfähig sind ${koepfe}. Betroffen: ${herkunft.join(' · ')}.`,
      { hint: `${wo} Ohne Schicht fahren laut Auskunft: `
        + `${(faehig.blockedIds ?? []).join(', ') || '–'}. Entweder die Belegungszeit zurücknehmen `
        + 'oder schichtfähige Leute dazu holen.',
        value: { gebraucht: zusatzKoepfe, faehig: koepfe } });
  } else if (koepfe < zusatzKoepfe * 2) {
    add(PLAUSI_LEVEL.HINWEIS, 'SCHICHT_KNAPP', PLAUSI_AREA.BESETZUNG,
      'Schichtbetrieb ist personell knapp',
      `Die längere Belegungszeit braucht ${zusatzKoepfe} schichtfähige Personen; `
      + `verfügbar sind ${koepfe}. Für Urlaub und Krankheit bleibt kaum Luft. `
      + `Betroffen: ${herkunft.join(' · ')}.`,
      { hint: `${wo} Niemand fährt alleine auf Schicht – bei Ausfall steht die Schicht.` });
  }

  const hoechste = Math.max(...Object.values(eigene)
    .map((w) => faktor(w?.operatingHours ?? allgemein)));
  if (hoechste >= 2.9) {
    add(PLAUSI_LEVEL.HINWEIS, 'NACHTSCHICHT', PLAUSI_AREA.KAPAZITAET,
      'Nachtschicht ist eingeplant',
      `Mindestens ein Arbeitsplatz ist ${round1(hoechste * SCHICHT)} h am Tag besetzt – `
      + `das sind drei Schichten (${SHIFTS.map((x) => x.name).join(', ')}).`,
      { hint: 'Nachtarbeit ist zuschlagspflichtig und mitbestimmungspflichtig – vor dem '
        + 'Antrag mit dem Betriebsrat abstimmen.' });
  }
}

/* ------------------------------------------------------------------ *
 * Auftraege
 * ------------------------------------------------------------------ */

function auftraege(config, projects, result, extra, add) {
  const stichtag = config.planningDate;
  const kpis = extra.kpis ?? {};

  /* --- Laut Lieferdatum fertig, aber kein Haken --- */
  const wohlFertig = projects.filter((p) => !p.done && p.handoverDate
    && cmpDate(p.handoverDate, stichtag) < 0 && fortschritt(p) < 99.5);
  if (wohlFertig.length > 0) {
    add(PLAUSI_LEVEL.WARNUNG, 'FERTIG_LAUT_LIEFERDATUM', PLAUSI_AREA.AUFTRAEGE,
      `${wohlFertig.length} Aufträge sind laut Lieferdatum vermutlich fertig`,
      `Bei ${wohlFertig.length} Aufträgen liegt das Lieferdatum der Anlage vor dem `
      + `Planungsstichtag ${formatDE(stichtag)}, der Armaturenbau ist aber nicht abgehakt `
      + `(${wohlFertig.slice(0, 6).map((p) => p.orderNo || p.id).join(', ')}`
      + `${wohlFertig.length > 6 ? ' …' : ''}).`,
      { ids: wohlFertig.map((p) => p.id),
        hint: 'Auskunft der Abteilungsleitung: "Häkchen sind nicht 100 % sauber geführt, viele '
          + 'Teile sind in Wahrheit fertig, zu erkennen am Lieferdatum." Diese Aufträge belasten '
          + 'die Kapazität, obwohl die Arbeit erledigt ist.' });
  }

  /* --- Fehlteile ohne erwarteten Liefertermin --- */
  const ohneTermin = projects.filter((p) => p.missingParts && !p.materialAvailableFrom && !p.done);
  if (ohneTermin.length > 0) {
    add(PLAUSI_LEVEL.WARNUNG, 'FEHLTEIL_OHNE_TERMIN', PLAUSI_AREA.AUFTRAEGE,
      `${ohneTermin.length} Aufträge mit Fehlteilen ohne Liefertermin`,
      `Bei ${ohneTermin.length} Aufträgen sind Fehlteile gemeldet, aber kein erwarteter `
      + 'Liefertermin hinterlegt. Die Anwendung plant sie deshalb, als wäre das Material da.',
      { ids: ohneTermin.map((p) => p.id),
        hint: 'Ohne Termin ist die Prognose dieser Aufträge zu gut. Solange die Vorstufe keinen '
          + 'Termin nennt, hilft nur ein Erfahrungswert – und der gehört als Fehlteilquote '
          + 'in die Reserve, nicht in den Einzelauftrag.' });
  }

  /* --- Anteil der Verspaetungen aus Fehlteilen --- */
  const spaet = Number(kpis.late ?? 0);
  const material = Number(kpis.lateByMaterial ?? 0);
  if (spaet >= 3 && material / spaet >= 0.25) {
    add(PLAUSI_LEVEL.HINWEIS, 'FEHLTEIL_ANTEIL', PLAUSI_AREA.AUFTRAEGE,
      'Ein erheblicher Teil der Verspätungen kommt aus Fehlteilen',
      `${material} von ${spaet} verspäteten Aufträgen (${Math.round((material / spaet) * 100)} %) `
      + 'verspäten sich wegen fehlenden Materials, nicht wegen fehlender Kapazität.',
      { hint: 'Mehr Personal oder Schichten ändern daran nichts. Diese Aufträge gehören nicht in '
        + 'die Begründung eines Personalantrags – sie gehören in die Vorstufe.' });
  }

  /* --- Auftraege ohne Termin --- */
  const ohneDue = projects.filter((p) => !p.dueDate && !p.done);
  if (ohneDue.length > 0) {
    add(PLAUSI_LEVEL.HINWEIS, 'OHNE_TERMIN', PLAUSI_AREA.AUFTRAEGE,
      `${ohneDue.length} Aufträge ohne Fertigstellungstermin`,
      `${ohneDue.length} Aufträge haben keinen Termin. Sie verbrauchen Kapazität, gehen aber in `
      + 'die Termintreue nicht ein.',
      { ids: ohneDue.map((p) => p.id) });
  }

  /* --- Arbeitsplanzeiten --- */
  const ohneStunden = (result.projects ?? []).filter((p) => !p.done
    && Number(p.totalManHours ?? 0) <= 0);
  if (ohneStunden.length > 0) {
    add(PLAUSI_LEVEL.WARNUNG, 'ARBEITSPLAN_OHNE_ZEITEN', PLAUSI_AREA.DATEN,
      `${ohneStunden.length} Aufträge ohne Arbeitszeiten`,
      `${ohneStunden.length} offene Aufträge haben keine Stunden im Arbeitsplan `
      + `(${ohneStunden.slice(0, 6).map((p) => p.orderNo || p.id).join(', ')}). `
      + 'Sie belegen dadurch keine Kapazität und sehen im Plan unauffällig aus.',
      { ids: ohneStunden.map((p) => p.id) });
  }
}

/** Fortschritt eines Auftrages in Prozent (beide Pflegearten). */
function fortschritt(p) {
  if (p.progressMode === 'PERCENT') return Number(p.progressPercent ?? 0);
  if (p.progressMode === 'PER_OPERATION') {
    const ops = p.operations ?? [];
    const soll = ops.reduce((a, o) => a + (Number(o.totalUnits ?? 0) || 0), 0);
    const ist = ops.reduce((a, o) => a + (Number(o.doneUnits ?? 0) || 0), 0);
    return soll > 0 ? (ist / soll) * 100 : 0;
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * Kapazitaet
 * ------------------------------------------------------------------ */

function kapazitaet(config, result, extra, add) {
  const wf = config.workforce ?? {};

  /*
   * --- Zusaetzliches Personal noetig ---
   *
   * Vorgabe der Abteilungsleitung (17.09.2026): "Wenn zusaetzliches
   * Personal dazu kommen muss, moechte ich eine Meldung bekommen und das
   * rein ueber den Reiter Mannschaft anpassen."
   *
   * ACHTUNG - diese Stelle war grob falsch und wurde am 18.09.2026
   * zurueckgewiesen: "Wie kommst du drauf, dass 441 h = 14 neue
   * Leiharbeiter sind? Das passt nicht."
   *
   * Der Vorwurf traf voll zu. Drei Fehler steckten uebereinander:
   *
   *  1. Als Bedarf diente `week.demand`. Das ist ein GEGLAETTETES Profil:
   *     Die Reststunden eines Auftrags werden gleichmaessig ueber das
   *     Fenster von Arbeitsbeginn bis Fertigstellung verteilt. Es sagt
   *     nicht, was in dieser Woche fertig sein MUSS.
   *  2. Gewertet wurde die schlimmste EINZELWOCHE. Eine Luecke in einer
   *     Woche laesst sich aber aus der freien Kapazitaet der Wochen davor
   *     decken - Arbeit ist verschiebbar, solange der Termin haelt.
   *  3. Die Stunden dieser einen Woche wurden durch die WOCHENleistung
   *     eines Mitarbeiters geteilt. Das ergibt Koepfe fuer genau diese
   *     eine Woche - angeboten wurden sie aber als dauerhafte
   *     Leiharbeiter.
   *
   * Im Startdatenbestand kam so heraus: 334 h in der schlimmsten Woche,
   * "rund 10 Mitarbeiter". Richtig gerechnet fehlen 679 h bis KW 48, und
   * die sind in 12 Wochen von 1,6 Mitarbeitern zu leisten - Faktor 6.
   *
   * Jetzt gilt derselbe Weg wie in der Mehraufwand-Ansicht, damit beide
   * Ansichten nicht verschiedene Zahlen nennen:
   *   - Bedarf = Arbeit, die nach ihrem TERMIN bis zu dieser Woche fertig
   *     sein muss (ueberfaellige Auftraege zaehlen sofort).
   *   - Verglichen wird KUMULIERT: alles bis zu dieser Woche gegen die
   *     Kapazitaet bis zu dieser Woche.
   *   - Koepfe = fehlende Stunden / (Wochen bis dahin x Wochenleistung).
   */
  const wochenReihe = extra.weeks ?? [];
  const produktivitaet = Number(config.productivity?.global ?? 1) || 1;
  const stundenJeKopf = Number(config.workTime?.regularHoursPerWeek ?? 37.5) * produktivitaet;
  if (wochenReihe.length > 0 && stundenJeKopf > 0) {
    /* Faellige Arbeit je Woche aus den Terminen der Auftraege */
    const faellig = new Map(wochenReihe.map((w) => [w.weekKey, 0]));
    const ersteWoche = wochenReihe[0].weekKey;
    let ohneTermin = 0;
    let nachHorizont = 0;
    for (const p of result.projects ?? []) {
      const offen = Number(p.remainingManHours) || 0;
      if (offen <= 0) continue;
      if (!p.dueDate) { ohneTermin += offen; continue; }
      const kw = weekKey(p.dueDate);
      if (faellig.has(kw)) {
        faellig.set(kw, faellig.get(kw) + offen);
      } else if (cmpDate(p.dueDate, wochenReihe[0].from) < 0) {
        // Ueberfaellig - muss sofort fertig werden
        faellig.set(ersteWoche, faellig.get(ersteWoche) + offen);
      } else {
        nachHorizont += offen;
      }
    }

    /* Kumuliert vergleichen: was bis hierher fertig sein muss gegen die
       Kapazitaet bis hierher. */
    let kumFaellig = 0;
    let kumKapazitaet = 0;
    let luecke = 0;
    let lueckeWoche = null;
    let lueckeWochen = 0;
    let engeWochen = 0;
    wochenReihe.forEach((w, i) => {
      kumFaellig += faellig.get(w.weekKey) ?? 0;
      kumKapazitaet += Number(w.capacity) || 0;
      const offen = kumFaellig - kumKapazitaet;
      if (offen > 0) engeWochen += 1;
      if (offen > luecke) { luecke = offen; lueckeWoche = w.weekKey; lueckeWochen = i + 1; }
    });

    const koepfe = lueckeWochen > 0
      ? Math.ceil((luecke / (lueckeWochen * stundenJeKopf)) * 10) / 10
      : 0;
    /* Gesamtbilanz: reicht die Kapazitaet ueberhaupt, nur zu spaet? */
    /* Ist eine Einarbeitungskurve hinterlegt? Dann leistet eine neue Kraft
       in den ersten Wochen weniger als die reine Rechnung unterstellt. */
    const kurve = config.workforce?.rampUp?.temp;
    const einarbeitung = Array.isArray(kurve) && kurve.some((x) => Number(x) < 1);
    const kapGesamt = wochenReihe.reduce((a2, w) => a2 + (Number(w.capacity) || 0), 0);
    const arbeitGesamt = kumFaellig;
    const reichtInSumme = kapGesamt >= arbeitGesamt;

    /*
     * ENTSCHEIDENDE Vorpruefung: Sind die Mitarbeiterstunden ueberhaupt
     * die Grenze?
     *
     * Im Startdatenbestand sind 13.921 Mannstunden vorhanden, nutzbar sind
     * 6.500 h - 47 %. An 1.007 Personentagen steht jemand da, ohne dass
     * ein Platz frei ist. In dieser Lage ist "es fehlt Personal" schlicht
     * falsch: Zehn weitere Leiharbeiter wuerden nur mit danebenstehen.
     * Gemeldet am 18.09.2026 ("Wie kommst du drauf, dass 441 h = 14 neue
     * Leiharbeiter sind?").
     */
    let poolKap = 0;
    let poolGenutzt = 0;
    const bisDatum = lueckeWoche
      ? (wochenReihe[Math.min(lueckeWochen, wochenReihe.length) - 1]?.to ?? null)
      : null;
    for (const d of result.daySeries ?? []) {
      if (bisDatum && cmpDate(d.date, bisDatum) > 0) break;
      if ((d.poolCapacity ?? 0) <= 0) continue;
      poolKap += d.poolCapacity;
      poolGenutzt += d.poolUsed ?? 0;
    }
    const auslastung = poolKap > 0 ? poolGenutzt / poolKap : 1;

    /*
     * Die entscheidende Frage ist nicht, WIE VOLL die Mannschaft ist,
     * sondern WORAN die Arbeit haengt. Eine geringe Auslastung kann auch
     * schlicht heissen, dass nicht mehr Arbeit da ist - dann fehlt
     * niemand. Deshalb wird die wartende Arbeit nach Ursache getrennt:
     *
     *   an den Leuten  - Mitarbeiterstunden, Einsetzbare Mitarbeiter
     *   an der Anlage   - Plaetze, Maschinen, Prueffenster, Regeln
     *
     * Nur wenn die Arbeit ueberwiegend an den LEUTEN haengt, hilft
     * zusaetzliches Personal. Haengt sie an der Anlage, wuerden neue
     * Leiharbeiter danebenstehen - genau das war der Vorwurf vom
     * 18.09.2026.
     */
    const AN_DEN_LEUTEN = new Set(['POOL', 'SKILL']);
    const rang = extra.kpis?.bottleneckRanking ?? [];
    let wartetAnLeuten = 0;
    let wartetAnAnlage = 0;
    for (const e of rang) {
      const h = Number(e.manHours) || 0;
      if (AN_DEN_LEUTEN.has(e.cause)) wartetAnLeuten += h;
      else wartetAnAnlage += h;
    }
    const wartetGesamt = wartetAnLeuten + wartetAnAnlage;
    /*
     * Personal ist die Grenze, wenn die wartende Arbeit ueberwiegend an
     * den Leuten haengt - oder wenn ueberhaupt nichts wartet, die
     * Mannschaft aber voll ausgelastet ist (dann ist einfach zu wenig Zeit
     * da).
     */
    const personalIstGrenze = wartetGesamt > 0.5
      ? wartetAnLeuten >= wartetAnAnlage
      : auslastung >= 0.9;

    if (luecke > 0.5 && !personalIstGrenze) {
      const engpass = (extra.kpis?.bottleneck?.label) ?? 'Plätze und Belegungszeit';
      add(PLAUSI_LEVEL.WARNUNG, 'MANNSCHAFT_NICHT_AUSLASTBAR', PLAUSI_AREA.BESETZUNG,
        'Mehr Personal hilft hier nicht',
        `Bis ${kwText(lueckeWoche)} fehlen ${Math.round(luecke)} h – aber nicht an Leuten. `
        + `${Math.round(wartetAnAnlage)} h Arbeit warten auf Plätze, Maschinen oder Prüffenster, `
        + `nur ${Math.round(wartetAnLeuten)} h auf Mitarbeiterstunden. Von `
        + `${Math.round(poolKap)} Mitarbeiterstunden sind ${Math.round(poolGenutzt)} h eingesetzt `
        + `(${Math.round(auslastung * 100)} %). Begrenzend ist: ${engpass}.`,
        { hint: 'Zusätzliche Leiharbeiter würden hier nur danebenstehen. Was wirklich hilft, '
          + 'steht in "Übersicht → Mehraufwand": ein zweiter Platz, längere Belegungszeit '
          + '(Schichtbetrieb) oder Samstagsarbeit. Der Einsatzplan zeigt je Tag, wer ohne Platz '
          + 'dasteht.',
          value: {
            stunden: round1(luecke),
            weekKey: lueckeWoche,
            poolKapazitaet: round1(poolKap),
            poolGenutzt: round1(poolGenutzt),
            auslastung: round2(auslastung),
            wartetAnLeuten: round1(wartetAnLeuten),
            wartetAnAnlage: round1(wartetAnAnlage),
            engpass,
          } });
    } else if (luecke > 0.5 && koepfe > 0) {
      add(koepfe >= 1 ? PLAUSI_LEVEL.WARNUNG : PLAUSI_LEVEL.HINWEIS,
        'PERSONAL_FEHLT', PLAUSI_AREA.BESETZUNG,
        'Zusätzliches Personal nötig',
        `Bis ${kwText(lueckeWoche)} müssen ${Math.round(arbeitBis(faellig, wochenReihe, lueckeWochen))} h `
        + `fertig sein, verfügbar sind bis dahin ${Math.round(kapBis(wochenReihe, lueckeWochen))} h. `
        + `Es fehlen ${Math.round(luecke)} h. Verteilt auf die ${lueckeWochen} Wochen bis dahin sind das `
        + `${koepfe < 1 ? 'weniger als ein Mitarbeiter' : `${formatKoepfe(koepfe)} Mitarbeiter`}`
        + `${reichtInSumme
          ? ' – über den ganzen Zeitraum reicht die Kapazität, sie kommt nur zu spät.'
          : '.'}`
        + `${einarbeitung
          ? ' Neue Leiharbeiter leisten in den ersten Wochen nur 40/60/80 % und binden Betreuung –'
            + ' rechne mit etwas mehr.'
          : ''}`,
        { hint: 'Eintragen ausschließlich unter Mannschaft: Leiharbeiter mit Eintrittsdatum oder '
          + 'eine Woche anhaken. Die Zahl ist der Bedarf bis zur engsten Woche – nicht die Zahl der '
          + 'Leute, die dauerhaft fehlen. Ob Überstunden, ein zweiter Platz oder Samstagsarbeit '
          + 'günstiger sind, rechnet "Übersicht → Mehraufwand" durch.',
          value: {
            stunden: round1(luecke),
            koepfe,
            weekKey: lueckeWoche,
            wochen: lueckeWochen,
            engeWochen,
            reichtInSumme,
            ohneTermin: round1(ohneTermin),
            nachHorizont: round1(nachHorizont),
          } });
    }
  }

  /*
   * --- Tage, an denen nur einer da waere ---
   *
   * Vorgabe der Abteilungsleitung, mehrfach bestaetigt (18.09.2026):
   * "Keiner darf alleine arbeiten, immer mindestens zu zweit." Die
   * Kapazitaetsrechnung setzt einen solchen Tag deshalb auf null
   * (capacity.js, headcountFor).
   *
   * Sichtbar war das nirgends. Ein Tag ohne Kapazitaet sieht dann wie ein
   * Rechenfehler aus - deshalb sagt die Anwendung jetzt, WARUM er leer
   * ist, und wie viele Stunden die Regel kostet. Das ist keine
   * Stellschraube: Der Ausweg ist ein zweiter Mann, nicht eine andere
   * Einstellung.
   */
  const alleinTage = (result.daySeries ?? [])
    .filter((d) => d.headcountDetail?.alone
      && (!extra.range?.from || cmpDate(d.date, extra.range.from) >= 0)
      && (!extra.range?.to || cmpDate(d.date, extra.range.to) <= 0));
  if (alleinTage.length > 0) {
    const verloren = alleinTage.reduce(
      (a2, d) => a2 + (Number(d.headcountDetail.effectiveRaw) || 0) * (Number(d.hoursPerEmployee) || 0), 0);
    const mindest = Number(alleinTage[0].headcountDetail.minZusammen) || 2;
    add(PLAUSI_LEVEL.WARNUNG, 'ALLEIN_AM_TAG', PLAUSI_AREA.BESETZUNG,
      `${alleinTage.length} ${alleinTage.length === 1 ? 'Tag' : 'Tage'} mit nur einer Person – `
      + 'an diesen Tagen wird nicht gearbeitet',
      `Am ${formatDE(alleinTage[0].date)}${alleinTage.length > 1 ? ' und an weiteren Tagen' : ''} `
      + `steht nach der Anwesenheit nur eine Person zur Verfügung. Arbeitsschutz: es müssen immer `
      + `mindestens ${mindest} Personen zusammen sein, deshalb rechnet die Planung an diesen Tagen `
      + `mit 0 h statt mit rund ${Math.round(verloren)} h. Das ist kein Rechenfehler, sondern die Regel.`,
      { hint: 'Abhilfe ist ein zweiter Mann an diesen Tagen – Urlaub verschieben, Springer einteilen '
        + 'oder den Tag bewusst freihalten. Die Regel selbst ist keine Stellschraube.',
        value: { tage: alleinTage.slice(0, 10).map((d) => d.date), stunden: round1(verloren), mindest } });
  }

  /*
   * --- Wo der Auftragsbestand endet ---
   *
   * Vorgabe der Abteilungsleitung (18.09.2026): "ich habe die Auftraege
   * fuer naechstes Jahr noch nicht eingepflegt. es gibt da keine
   * Ueberkappa." Und: "Die APP soll immer nur den angewaehlten Zeitraum
   * bewerten."
   *
   * Beides ist umgesetzt: Der Standardzeitraum endet an der letzten
   * Fertigstellung. Damit die Grenze nicht unsichtbar ist, sagt die
   * Anwendung, WO der Auftragsbestand endet - als Hinweis, nicht als
   * Warnung. Es ist kein Fehler, dass das naechste Jahr noch fehlt.
   */
  const bisDatumFenster = extra.range?.to ?? null;
  const rechenEnde = result.horizonEnd ?? null;
  if (bisDatumFenster && rechenEnde && cmpDate(rechenEnde, bisDatumFenster) > 0) {
    const tageDanach = (result.daySeries ?? []).filter((d) => cmpDate(d.date, bisDatumFenster) > 0);
    const kapDanach = tageDanach.reduce((a2, d) => a2 + (Number(d.poolCapacity) || 0), 0);
    if (kapDanach > 200) {
      add(PLAUSI_LEVEL.HINWEIS, 'AUFTRAGSHORIZONT_ENDE', PLAUSI_AREA.AUFTRAEGE,
        `Der Auftragsbestand endet am ${formatDE(bisDatumFenster)}`,
        `Bewertet wird der Zeitraum bis ${formatDE(bisDatumFenster)} – dort liegt die letzte `
        + 'Fertigstellung mit offener Arbeit. Die Rechnung selbst läuft weiter bis '
        + `${formatDE(rechenEnde)}; in dieser Zeit stehen ${Math.round(kapDanach)} h Kapazität ohne `
        + 'Aufträge. Das ist keine freie Kapazität und keine Unterlast – die Aufträge sind nur noch '
        + 'nicht eingepflegt.',
        { hint: 'Sobald die Aufträge des nächsten Jahres eingetragen sind, verschiebt sich der '
          + 'Zeitraum von selbst. Ein anderer Zeitraum lässt sich oben rechts einstellen – alle '
          + 'Zahlen folgen ihm.',
          value: { bis: bisDatumFenster, rechenEnde, kapazitaetDanach: round1(kapDanach) } });
    }
  }

  /*
   * --- Schichten, die niemand besetzen kann ---
   *
   * Die Terminierung rechnet mit PLATZstunden: Ein Arbeitsgang mit zwei
   * Plaetzen und zwei Schichten bietet 30 Platzstunden am Tag. Ob dafuer
   * auch Leute in der zweiten Schicht stehen, weiss sie nicht - die
   * Schichtzuordnung der Mannschaft entsteht erst im Einsatzplan, und sie
   * gilt wochenweise.
   *
   * Bleibt dabei etwas uebrig, ist das keine Rundung, sondern eine
   * Planungsluecke: Der Termin ist gerechnet, aber niemand steht da. Das
   * gehoert auf den Tisch (Vorgabe 18.09.2026: "wenn dann immernoch
   * Arbeitsplaetze fehlen sollen diese angezeigt werden").
   */
  /*
   * Bis 40 h in der Summe gelten als Puffer.
   *
   * Festlegung der Abteilungsleitung (18.09.2026): "ich denke eine gesamt
   * summe bis 40h ist zu ignorieren und als Puffer anzusehen." Das ist rund
   * eine Mannwoche auf ein halbes Jahr - darunter zu warnen waere Laerm.
   */
  const PUFFER_STUNDEN = 40;
  if (extra.assignment && Number(extra.assignment.unassignedHours) > PUFFER_STUNDEN) {
    const je = extra.assignment.unbesetzteSchichten ?? {};
    const namen = Object.entries(je)
      .sort((a2, b2) => b2[1] - a2[1])
      .slice(0, 4)
      .map(([opId, h]) => `${OPERATION_BY_ID[opId]?.name ?? opId} ${Math.round(Number(h))} h`);
    const offen = round1(Number(extra.assignment.unassignedHours));
    const gesamt = round1(result.daySeries.reduce((a2, d) => a2 + (Number(d.poolUsed) || 0), 0));
    const anteil = gesamt > 0 ? offen / gesamt : 0;
    add(anteil > 0.05 ? PLAUSI_LEVEL.WARNUNG : PLAUSI_LEVEL.HINWEIS,
      'SCHICHT_NICHT_ZUGEORDNET', PLAUSI_AREA.BESETZUNG,
      `${Math.round(offen)} h sind keiner Person zugeordnet`,
      `Die Terminierung hat ${Math.round(offen)} h eingeplant, für die im Einsatzplan niemand `
      + `in der passenden Schicht steht${namen.length ? `: ${namen.join(', ')}` : ''}. `
      + `Das sind ${(anteil * 100).toFixed(1)} % der eingeplanten Arbeit. Grund ist die `
      + 'Schichtaufteilung: Ein Arbeitsgang, der nur einschichtig läuft, kann von der Spät- und '
      + 'Nachtschicht nicht bedient werden.',
      { hint: 'Entweder diesen Arbeitsgang ebenfalls mehrschichtig fahren (Einstellungen → '
        + 'Parameter → Schichten und Plätze je Arbeitsgang) oder mehr Leute schichtfähig machen. '
        + 'Der Einsatzplan zeigt je Tag, welche Schicht leer läuft.',
        value: { stunden: offen, anteil: round2(anteil), jeArbeitsgang: je } });
  }

  /* --- Zubehoer und Kleinarbeiten --- */
  const reserve = Number(wf.reserveHoursPerWeek ?? 0);
  if (reserve <= 0) {
    add(PLAUSI_LEVEL.WARNUNG, 'ZUBEHOER_OHNE_RESERVE', PLAUSI_AREA.KAPAZITAET,
      'Keine Reserve für Zubehör und Kleinarbeiten',
      'Neben den Aufträgen läuft laufend Arbeit, die nicht einzeln geplant wird: Zubehör, '
      + 'Adapter, Nacharbeit, Muster. Die Reserve steht auf 0 – diese Stunden fehlen im Plan.',
      { hint: 'Auskunft der Abteilungsleitung: rund 12–24 Mannstunden je Woche. '
        + 'Im Steuerstand unter "Zubehör" einstellbar.' });
  }

  /* --- Produktivitaet --- */
  const prod = Number(config.productivity?.global ?? 1);
  if (prod > 1.0001) {
    add(PLAUSI_LEVEL.KRITISCH, 'PRODUKTIVITAET_UEBER_100', PLAUSI_AREA.KAPAZITAET,
      'Produktivität über 100 %',
      `Die Rechnung läuft mit ${Math.round(prod * 1000) / 10} % Produktivität. Damit leistet `
      + 'jede Person mehr Stunden, als sie im Betrieb ist.',
      { hint: 'Rüsten, Suchen, Besprechungen und Wege sind damit wegdefiniert. '
        + 'Plausibel sind 85–95 %.' });
  } else if (prod > 0 && prod < 0.6) {
    add(PLAUSI_LEVEL.HINWEIS, 'PRODUKTIVITAET_NIEDRIG', PLAUSI_AREA.KAPAZITAET,
      'Produktivität sehr niedrig',
      `Die Rechnung läuft mit ${Math.round(prod * 1000) / 10} % Produktivität. `
      + 'Das entspricht weniger als 4,5 produktiven Stunden am Tag.',
      { hint: 'Wenn das stimmt, ist der eigentliche Hebel nicht Personal, sondern die Störzeit.' });
  }

  /* --- Krankenquote --- */
  const quote = Number(wf.sickRate ?? 0);
  const ausMannschaft = wf.team?.source === 'MANNSCHAFT';
  if (quote <= 0 && ausMannschaft) {
    add(PLAUSI_LEVEL.HINWEIS, 'KRANKENQUOTE_NULL', PLAUSI_AREA.BESETZUNG,
      'Krankenquote steht auf 0',
      'Die Besetzung kommt aus der Mannschaftsliste und enthält keine Krankheit. '
      + 'Damit ist jeder Eingeplante an jedem Tag da.',
      { hint: 'Entweder eine Quote im Steuerstand setzen oder bewusst so lassen, '
        + 'weil die Produktivität das abdeckt.' });
  }

  /* --- Samstagsarbeit auf Dauer --- */
  const wochen = Object.values(config.saturday?.weeks ?? {});
  const aktiv = wochen.filter((w) => w?.enabled).length;
  const alle = (extra.weeks ?? []).length || wochen.length;
  if (aktiv >= 6 && alle > 0 && aktiv / alle >= 0.33) {
    add(PLAUSI_LEVEL.WARNUNG, 'SAMSTAG_DAUERHAFT', PLAUSI_AREA.KAPAZITAET,
      'Samstagsarbeit ist dauerhaft eingeplant',
      `In ${aktiv} von ${alle} Wochen ist Samstagsarbeit angehakt.`,
      { hint: 'Dauerhafte Samstagsarbeit ist keine Spitzenabdeckung mehr. Der Betriebsrat wird '
        + 'nach der Ursache fragen – die Antwort steht in der Engpassliste.' });
  }

  /* --- Arbeitsvorbereitung: neu und noch nicht belegt --- */
  const av = config.resources?.byOperation?.AV;
  if (av && Number(av.places ?? 0) > 0) {
    const blockiert = round2((result.blocked ?? [])
      .filter((b) => !b.info && b.opId === 'AV')
      .reduce((a, b) => a + Number(b.manHours ?? 0), 0));
    add(blockiert > 100 ? PLAUSI_LEVEL.WARNUNG : PLAUSI_LEVEL.HINWEIS,
      'AV_ZU_VALIDIEREN', PLAUSI_AREA.KAPAZITAET,
      'Arbeitsvorbereitung ist neu in der Rechnung',
      `Je Auftrag sind 7,5 Stunden Arbeitsvorbereitung angesetzt (Fertigungsbegleitliste, `
      + `Entnahmen, Rohrentnahme, Simulation des Biegeprogramms), und es wird mit `
      + `${av.places} Vorgang gleichzeitig gerechnet.`
      + (blockiert > 0 ? ` Dadurch bleiben ${Math.round(blockiert)} h Arbeit liegen.` : ''),
      { hint: 'Beide Werte sind Auskunft, nicht Messung. Wenn zwei Aufträge gleichzeitig '
        + 'vorbereitet werden können, gehört die Zahl unter "Einstellungen → Parameter" '
        + 'hochgesetzt – das verschiebt den Engpass deutlich.' });
  }

  /*
   * Stau vor den Plaetzen.
   *
   * Gemessen wird die groesste TAGESWARTESCHLANGE, nicht ihre Summe ueber
   * alle Tage. Die Summe hat frueher ein Vielfaches ausgewiesen, weil ein
   * Auftrag an jedem Tag, an dem er wartete, neu gezaehlt wurde.
   */
  const blockiert = (result.blocked ?? []).filter((b) => !b.info);
  /** @type {Record<string, number>} */
  const proTag = {};
  for (const b of blockiert) proTag[b.date] = round2((proTag[b.date] ?? 0) + Number(b.manHours ?? 0));
  const tage = Object.entries(proTag).sort((a, b) => b[1] - a[1]);
  const spitze = tage[0];
  const tagesKap = Number(extra.kpis?.availableHours ?? 0) / Math.max(1, (result.daySeries ?? []).filter((d) => d.kind !== 'OFF').length);
  if (spitze && tagesKap > 0 && spitze[1] / tagesKap >= 1) {
    add(PLAUSI_LEVEL.WARNUNG, 'VIEL_STAU', PLAUSI_AREA.KAPAZITAET,
      'Vor den Plätzen staut sich Arbeit',
      `Am ${formatDE(spitze[0])} warteten ${Math.round(spitze[1])} h auf einen Platz – `
      + `mehr als die ${Math.round(tagesKap)} h, die an einem Tag überhaupt geleistet werden können. `
      + `An ${tage.length} Tagen des Zeitraums wartet Arbeit.`,
      { hint: 'Nicht die Mannschaft ist hier der Engpass, sondern Plätze, Maschinen oder '
        + 'Qualifikation. Mehr Personal würde daran nichts ändern. Wie viele Stunden wirklich '
        + 'fehlen, steht unter Übersicht → Mehraufwand.' });
  }
}

/* ------------------------------------------------------------------ *
 * Datenpflege
 * ------------------------------------------------------------------ */

function datenpflege(config, input, result, add) {
  const wf = config.workforce ?? {};
  const tage = wf.dailyAvailable ?? {};
  const alleSchluessel = Object.keys(tage).sort();
  const stichtag = config.planningDate;
  // Nur Messwerte bis zum Stichtag gehen in die Rechnung ein
  const schluessel = alleSchluessel.filter((d) => !stichtag || d <= stichtag);
  const danach = alleSchluessel.length - schluessel.length;
  if (danach > 0 && wf.useDailyAvailable !== false) {
    add(PLAUSI_LEVEL.HINWEIS, 'TAGESLISTE_NACH_STICHTAG', PLAUSI_AREA.DATEN,
      `${danach} Tageswerte liegen nach dem Stichtag und werden nicht verwendet`,
      `Die Tagesliste reicht bis ${formatDE(alleSchluessel[alleSchluessel.length - 1])}, der `
      + `Planungsstichtag ist der ${formatDE(stichtag)}. Ab dem Stichtag rechnet die Anwendung aus `
      + 'der Mannschaft – die Werte danach sind Vorausschau, nicht Messung.',
      { hint: 'So festgelegt, damit die Zukunft nicht an einer Liste hängt, die niemand mehr pflegt. '
        + 'Was in diesen Tagen bekannt ist (Eintritte, Urlaube), gehört in die Mannschaft.' });
  }
  if (schluessel.length > 0 && wf.useDailyAvailable !== false) {
    const von = schluessel[0];
    const bis = schluessel[schluessel.length - 1];
    const feiertage = new Set(config.holidays ?? []);
    const arbeitstage = (config.workTime?.workDays ?? [1, 2, 3, 4, 5]);
    let luecken = 0;
    for (let d = von; cmpDate(d, bis) <= 0; d = addDays(d, 1)) {
      const wt = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
      if (!arbeitstage.includes(wt)) continue;
      if (feiertage.has(d)) continue;
      if (tage[d] == null) luecken++;
    }
    if (luecken > 0) {
      add(PLAUSI_LEVEL.HINWEIS, 'TAGESLISTE_LUECKE', PLAUSI_AREA.DATEN,
        `${luecken} Arbeitstage ohne gemessenen Wert`,
        `Die Tagesliste läuft von ${formatDE(von)} bis ${formatDE(bis)}. In diesem Zeitraum `
        + `fehlen für ${luecken} Arbeitstage Werte – dort rechnet die Anwendung mit der Mannschaft.`,
        { hint: 'Fehlen die Tage nur wegen Betriebsruhe, bitte eine 0 eintragen. '
          + 'Sonst mischen sich Messwert und Annahme innerhalb einer Woche.' });
    }
    add(PLAUSI_LEVEL.HINWEIS, 'TAGESLISTE_KORREKTUR', PLAUSI_AREA.DATEN,
      'Tagesliste ist um 1 korrigiert',
      `Die ${alleSchluessel.length} gemessenen Tageswerte sind auf Anweisung der `
      + 'Abteilungsleitung um jeweils 1 Mitarbeiter verringert, weil die Ursprungsdatei falsch '
      + `rechnet. In die Rechnung gehen davon ${schluessel.length} ein (bis zum Stichtag).`,
      { hint: 'Wird die Ursprungsdatei korrigiert, muss diese Korrektur hier entfallen. '
        + 'Für die Urlaubstabelle gilt die Korrektur ausdrücklich NICHT – sie zählt Personen.' });
  }

  /* --- Eingelesene Urlaubsplanung --- */
  const imp = wf.attendanceImport;
  if (imp) {
    const unklar = (imp.unknownCodes ?? []).filter((c) => !(c in (wf.attendanceCodes ?? {})));
    if (unklar.length > 0) {
      add(PLAUSI_LEVEL.WARNUNG, 'URLAUB_KUERZEL_UNKLAR', PLAUSI_AREA.DATEN,
        `Unklare Kürzel in der Urlaubsplanung: ${unklar.join(', ')}`,
        `Die eingelesene Urlaubsplanung (${formatDE(imp.from)} bis ${formatDE(imp.to)}) enthält die `
        + `Kürzel ${unklar.join(', ')}. Ob die Person an diesen Tagen da ist, ist nicht festgelegt – `
        + 'die Anwendung zählt sie deshalb weder als anwesend noch als abwesend.',
        { hint: 'Unter "Mannschaft → Urlaubsplanung einlesen" festlegen, wie das Kürzel zu rechnen ist. '
          + 'Bis dahin ist die Besetzung an diesen Tagen zu gut.' });
    }
    if (Number(imp.open) > 0) {
      add(PLAUSI_LEVEL.HINWEIS, 'URLAUB_OHNE_ZUORDNUNG', PLAUSI_AREA.BESETZUNG,
        `${imp.open} Zeilen der Urlaubsplanung sind keinem Kürzel zugeordnet`,
        `Von ${imp.rows} eingelesenen Zeilen sind ${imp.assigned} einem Kürzel zugeordnet. `
        + `Die übrigen ${imp.open} gehen nur als Anzahl abwesender Personen je Tag in die Rechnung – `
        + 'mit einem Zeitanteil von 1,0 je Person.',
        { hint: 'Für die Kapazität genügt das. Für die Qualifikationen nicht: die Anwendung weiß nicht, '
          + 'WER fehlt, und rechnet die Arbeitsgänge deshalb zu gut.' });
    }
  }

  /* --- Nicht validierte Arbeitsplanzeiten --- */
  const vorlagen = Object.values(input.templates ?? {});
  const offen = vorlagen.filter((t) => t && t.validated === false);
  if (offen.length > 0) {
    const genutzt = new Set((input.projects ?? []).map((p) => p.projectType));
    const relevant = offen.filter((t) => [...genutzt].some((g) => String(t.key).startsWith(String(g))));
    if (relevant.length > 0) {
      add(PLAUSI_LEVEL.WARNUNG, 'ARBEITSPLAN_UNVALIDIERT', PLAUSI_AREA.DATEN,
        `${relevant.length} Arbeitspläne sind noch nicht bestätigt`,
        `Für ${relevant.map((t) => t.label).join(', ')} sind die Zeiten abgeleitet, nicht belegt. `
        + 'Sie gehen aber voll in die Kapazitätsrechnung ein.',
        { hint: 'Auskunft der Abteilungsleitung: "Die Zeiten in den Arbeitsplänen stimmen noch '
          + 'nicht ganz." Unter "Arbeitsfolge" einstellbar.' });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Hilfen
 * ------------------------------------------------------------------ */

/** Letzter Tag, fuer den ein gemessener Wert vorliegt (oder null). */
function letzterTageslistentag(config) {
  const wf = config.workforce ?? {};
  if (wf.useDailyAvailable === false) return null;
  const keys = Object.keys(wf.dailyAvailable ?? {});
  if (keys.length === 0) return null;
  return keys.sort()[keys.length - 1];
}

/** Montag einer Kalenderwoche ('2026-W41'). */
function wochenMontag(wk) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(wk));
  if (!m) throw new Error(`Ungueltige Kalenderwoche: ${wk}`);
  const jan4 = `${m[1]}-01-04`;
  const wt = new Date(`${jan4}T00:00:00Z`).getUTCDay() || 7;
  const montagKw1 = addDays(jan4, -(wt - 1));
  return addDays(montagKw1, (Number(m[2]) - 1) * 7);
}

/** Nur fuer Tests: Kalenderwoche eines Datums. */
export function plausiWeekKey(date) {
  return weekKey(date);
}
