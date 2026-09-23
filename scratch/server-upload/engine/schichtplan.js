/**
 * Schichtplanung der Arbeitsplaetze.
 *
 * Vorgabe der Abteilungsleitung (18.09.2026):
 *   "Kein Platz frei ist keine Option, plane dann an den Arbeitsplaetzen so
 *    die Schichten dass es maximal effizient ist unter Beruecksichtigung
 *    der 2-3 Schicht und der MA darf die Schichten nur wochenweise
 *    wechseln nicht tageweise."
 *   "Wenn dann immernoch Arbeitsplaetze fehlen sollen diese angezeigt
 *    werden."
 *
 * Ausgangslage: Im Startdatenbestand stehen 1.007 von 2.183 anwesenden
 * Personentagen ohne Arbeit da, weil kein Platz frei ist - 7.421 von
 * 13.921 Mannstunden bleiben ungenutzt. Ein Platz laeuft 7 h am Tag; 11
 * Plaetze ergeben 77 Platzstunden, die Mannschaft bringt aber 88
 * Mannstunden. Die Werkstatt ist die Grenze, nicht die Mannschaft.
 *
 * Dieses Modul beantwortet zwei Fragen:
 *
 *  1. WELCHE Arbeitsgaenge muessen in zweiter oder dritter Schicht laufen,
 *     damit die anwesende Mannschaft ueberhaupt arbeiten kann? Gerechnet
 *     wird greedy und nachvollziehbar: Immer der Arbeitsgang, an dem am
 *     meisten Arbeit auf Plaetze wartet, bekommt die naechste Schicht -
 *     solange schichtfaehige Leute da sind und die dritte Schicht nicht
 *     ueberschritten wird.
 *
 *  2. Was bleibt UEBRIG? Reicht auch die dritte Schicht nicht, fehlen
 *     echte Plaetze. Die werden mit Arbeitsgang und Stueckzahl benannt,
 *     statt weiter Leute danebenstehen zu lassen.
 *
 * Die wochenweise Schichtzuordnung der Personen steht in `assignment.js` -
 * sie ist eine Frage des Einsatzplans, nicht der Einrichtung.
 */

import { OPERATIONS, OPERATION_BY_ID, round1, round2 } from './model.js';
import { placesFor, workersPerPlace } from './capacity.js';
import { shiftCapability } from './team.js';
import { blockedByOperation } from './kpi.js';

/** Hoechstzahl der Schichten - drei, mehr gibt der Tag nicht her. */
export const MAX_SCHICHTEN = 3;

/** Laenge einer Schicht in Stunden (Regelarbeitszeit je Tag). */
export const SCHICHT_STUNDEN = 7.5;

/**
 * Wie viele Schichten laeuft ein Arbeitsgang bei dieser Belegungszeit?
 * 7,5 h = eine Schicht, 15 h = zwei, 22,5 h = drei.
 * @param {number} stunden
 */
export function schichtenAus(stunden) {
  const n = Number(stunden);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(MAX_SCHICHTEN, Math.round((n / SCHICHT_STUNDEN) * 100) / 100));
}

/**
 * Belegungszeit fuer eine gewuenschte Schichtzahl.
 *
 * Hier stand `Math.round(schichten)`. Das war ein stiller Rechenfehler mit
 * messbarer Wirkung: Eine versetzte Besetzung von 12 h ergibt 1,6
 * Schichten (`schichtenAus`), und `stundenFuer(1,6)` hat daraus 15 h
 * gemacht. Damit war `mitSchichten(config, unveraenderte Schichten)` KEINE
 * Nullmassnahme mehr - jeder Arbeitsgang bekam 3 h Belegungszeit
 * geschenkt, die niemand eingestellt hatte. Gemessen am
 * Oberflaechendatenbestand: 790 Verspaetungstage in Wirklichkeit, 683 in
 * der internen Vergleichsrechnung des Schichtplaners - und die erste
 * angenommene Schicht bekam eine Wirkung von 206 Tagen zugeschrieben, die
 * gar nicht von ihr kam. Gefunden am 18.09.2026.
 *
 * Gerundet wird deshalb nicht mehr; begrenzt wird weiter auf eine bis
 * drei Schichten.
 */
export function stundenFuer(schichten) {
  const n = Number(schichten);
  if (!Number.isFinite(n)) return SCHICHT_STUNDEN;
  return round2(Math.max(1, Math.min(MAX_SCHICHTEN, n)) * SCHICHT_STUNDEN);
}

/**
 * Schichtzahl je Arbeitsgang, wie sie derzeit eingestellt ist.
 * @param {any} config
 * @returns {Record<string, number>}
 */
/**
 * Belegungszeit, die fuer diesen Arbeitsgang EINGESTELLT ist.
 *
 * Nicht zu verwechseln mit der wirksamen: Die Planung setzt ein Fenster
 * nie unter die Arbeitszeit einer Person (`operatingHours` in
 * capacity.js). Steht hier 7 h, rechnet die Planung mit 7,5 h. Fuer die
 * Anzeige "bisher / geplant" wird der eingestellte Wert gebraucht - sonst
 * steht in der Schichtkarte eine andere Zahl als unter Parameter.
 * @param {any} config @param {string} opId
 */
export function eingestellteStunden(config, opId) {
  const res = config.resources ?? {};
  const eigen = res.byOperation?.[opId]?.operatingHours;
  const wert = Number(eigen ?? res.operatingHoursPerDay);
  return Number.isFinite(wert) && wert > 0 ? round2(wert) : SCHICHT_STUNDEN;
}

/**
 * Schichtzahl je Arbeitsgang, wie sie derzeit eingestellt ist.
 * @param {any} config
 * @returns {Record<string, number>}
 */
export function schichtenJeArbeitsgang(config) {
  const res = config.resources ?? {};
  const allgemein = Number(res.operatingHoursPerDay) || SCHICHT_STUNDEN;
  /** @type {Record<string, number>} */
  const out = {};
  for (const op of OPERATIONS) {
    const eigen = res.byOperation?.[op.id]?.operatingHours;
    out[op.id] = schichtenAus(eigen ?? allgemein);
  }
  return out;
}

/**
 * Platzstunden je Tag, die ein Arbeitsgang bei n Schichten hergibt.
 * @param {any} config @param {string} opId @param {number} schichten
 */
export function platzStundenJeTag(config, opId, schichten) {
  const plaetze = placesFor(config, opId);
  if (plaetze == null) return Number.POSITIVE_INFINITY;
  const jePlatz = Math.max(1, Number(workersPerPlace(config, opId) ?? 1));
  return round2(Number(plaetze) * jePlatz * stundenFuer(schichten));
}

/**
 * Wie viele Personen braucht ein Arbeitsgang gleichzeitig, wenn er n
 * Schichten laeuft? Je Schicht die Plaetze mal Leute je Platz.
 * @param {any} config @param {string} opId
 */
export function koepfeJeSchicht(config, opId) {
  const plaetze = placesFor(config, opId);
  if (plaetze == null) return 1;
  /*
   * Beim Orbitalschweissen begrenzen die Maschinen die SCHWEISSER: einer
   * bedient zwei. Sechs Maschinen sind also drei Koepfe, nicht sechs -
   * derselbe Fehler stand schon einmal im Einsatzplan, und er hat hier
   * die Fruehschicht kuenstlich aufgeblaeht (11 statt 8 Leute), sodass die
   * Spaetschicht leer blieb.
   */
  if (opId === 'ORBITAL_KEHLNAHT' || opId === 'ORBITAL_STUMPFNAHT') {
    const jeSchweisser = Math.max(1, Number(config.resources?.machinesPerWelder ?? 2));
    return Math.max(1, Math.floor(Number(plaetze) / jeSchweisser));
  }
  return Math.max(1, Number(plaetze) * Math.max(1, Number(workersPerPlace(config, opId) ?? 1)));
}

/**
 * Schichten so planen, dass die anwesende Mannschaft arbeiten kann.
 *
 * Greedy und in der Reihenfolge, die ein Abteilungsleiter waehlen wuerde:
 * Der Arbeitsgang mit dem groessten Rueckstand bekommt die naechste
 * Schicht. Abgebrochen wird, wenn
 *   - nichts mehr auf Plaetze wartet (dann ist es effizient),
 *   - die schichtfaehige Mannschaft aufgebraucht ist,
 *   - oder alle betroffenen Arbeitsgaenge in der dritten Schicht laufen.
 *
 * @param {any} input Ergebnis von materialize
 * @param {any} result Ergebnis von runSchedule
 * @param {(config:any)=>any} rechne Funktion, die einen Stand neu terminiert
 * @param {{maxRunden?:number}} [opts]
 */
export function planeSchichten(input, result, rechne, opts = {}) {
  const maxRunden = Number(opts.maxRunden ?? 22);
  const start = schichtenJeArbeitsgang(input.config);
  /** @type {Record<string, number>} */
  let schichten = { ...start };
  let stand = result;
  let config = input.config;

  const schritte = [];
  /** Arbeitsgaenge, bei denen eine weitere Schicht schon geprueft wurde */
  const verworfen = new Set();
  const faehig = shiftCapability(config);

  for (let runde = 0; runde < maxRunden; runde++) {
    const stau = blockedByOperation(stand);
    /*
     * Nur Rueckstaende, die wirklich an den PLAETZEN haengen. Wartet die
     * Arbeit am Vorgaenger oder am Material, bringt eine zweite Schicht
     * an dieser Stelle nichts.
     */
    /*
     * ALLE Arbeitsgaenge mit Rueckstand sind Kandidaten - nicht nur die,
     * deren Hauptursache ein Platz ist.
     *
     * Hier stand ein Filter auf Platzursachen. Das war ein Denkfehler mit
     * messbaren Folgen: Beim Orbitalschweissen heisst die Hauptursache
     * "Mitarbeiter je Auftrag", der Arbeitsgang war damit kein Kandidat -
     * und eine dritte Schicht dort haette 22 Verspaetungstage gebracht.
     * Gefunden beim Logikdurchgang am 18.09.2026.
     *
     * Ob eine Schicht wirklich hilft, entscheidet weiter die Rechnung, nicht
     * die Ursache: Jeder Schritt wird durchterminiert und verworfen, wenn er
     * nichts bringt.
     */
    const kandidaten = Object.entries(stau)
      .filter(([opId, b]) => b.manHours > 0.5
        && schichten[opId] < MAX_SCHICHTEN
        && placesFor(config, opId) != null)
      .sort((a, b) => b[1].manHours - a[1].manHours);
    if (kandidaten.length === 0) break;

    /*
     * Reihum durch die Kandidaten, nicht nur der erste. Bringt eine
     * Schicht an der groessten Baustelle nichts, ist die zweitgroesste
     * dran - abbrechen waere hier falsch, und in der ersten Fassung
     * dieses Moduls blieb dadurch die Haelfte der Arbeitsgaenge
     * einschichtig, obwohl 345 h Entgraten lagen.
     */
    let uebernommen = false;
    for (const [opId, b] of kandidaten) {
      if (verworfen.has(opId)) continue;
      const naechste = Math.min(MAX_SCHICHTEN, Math.floor(schichten[opId]) + 1);
      const gebraucht = gebrauchteSchichtkoepfe({ ...schichten, [opId]: naechste }, config);
      if (gebraucht > faehig.capable) {
        schritte.push({
          opId,
          name: OPERATION_BY_ID[opId]?.name ?? opId,
          von: schichten[opId],
          nach: naechste,
          angewendet: false,
          grund: 'ZU_WENIG_SCHICHTFAEHIG',
          gebraucht,
          vorhanden: faehig.capable,
          stau: round1(b.manHours),
        });
        verworfen.add(opId);
        continue;
      }

      const naechsterStand = { ...schichten, [opId]: naechste };
      const naechsteConfig = mitSchichten(config, naechsterStand);
      const gerechnet = rechne(naechsteConfig);

      const vorher = verspaetung(stand);
      const nachher = verspaetung(gerechnet);
      const stauVorher = summeStau(stand);
      const stauNachher = summeStau(gerechnet);

      /*
       * Eine Schicht, die nichts bringt, wird nicht eingeplant - sie
       * kostet Zuschlaege und Nerven. "Maximal effizient" heisst hier: nur
       * Schichten, die Verspaetung oder Rueckstand tatsaechlich abbauen.
       */
      /*
       * Eine Schicht wird nur angenommen, wenn sie TERMINE rettet.
       *
       * Vorher genuegte auch ein kleinerer Rueckstand ("|| stauNachher <
       * stauVorher"). Das hat geschadet: Die dritte Schicht am
       * Orbitalschweissen wurde mit 869 -> 869 Verspaetungstagen
       * angenommen, weil der Stau minimal sank - und verbrauchte das
       * schichtfaehige Personal, das anschliessend bei Heften und Biegen
       * fehlte. Ergebnis 869 statt 708 Tage. Gefunden beim Logikdurchgang
       * am 18.09.2026.
       *
       * Schichtfaehige Leute sind knapp. Sie werden nur fuer Termine
       * ausgegeben, nicht fuer eine schoenere Warteschlange.
       */
      const bringt = nachher <= vorher - 1;
      schritte.push({
        opId,
        name: OPERATION_BY_ID[opId]?.name ?? opId,
        von: schichten[opId],
        nach: naechste,
        angewendet: bringt,
        grund: bringt ? null : 'OHNE_WIRKUNG',
        verspaetungVorher: vorher,
        verspaetungNachher: nachher,
        stauVorher: round1(stauVorher),
        stauNachher: round1(stauNachher),
        stau: round1(b.manHours),
      });
      if (!bringt) { verworfen.add(opId); continue; }

      schichten = naechsterStand;
      config = naechsteConfig;
      stand = gerechnet;
      uebernommen = true;
      break;
    }
    if (!uebernommen) break;
  }

  /*
   * Feinschliff: Jede gesetzte Schicht wird einmal testweise
   * ZURUECKGENOMMEN. Bringt die Ruecknahme dasselbe oder mehr, bleibt sie
   * draussen - eine Schicht, die nichts mehr beitraegt, kostet nur
   * Zuschlaege und Personal. Der Greedy-Weg kann solche Schichten
   * hinterlassen, weil ein spaeterer Schritt ihre Wirkung uebernimmt.
   */
  for (const opId of Object.keys(schichten)) {
    if (Math.abs(schichten[opId] - start[opId]) < 0.01) continue;
    const weniger = { ...schichten, [opId]: Math.max(start[opId], Math.floor(schichten[opId]) - 1) };
    if (Math.abs(weniger[opId] - schichten[opId]) < 0.01) continue;
    const c2 = mitSchichten(config, weniger);
    const g2 = rechne(c2);
    if (verspaetung(g2) <= verspaetung(stand) && summeStau(g2) <= summeStau(stand) + 0.5) {
      schritte.push({
        opId,
        name: OPERATION_BY_ID[opId]?.name ?? opId,
        von: schichten[opId],
        nach: weniger[opId],
        angewendet: true,
        grund: 'NICHT_MEHR_NOETIG',
        verspaetungVorher: verspaetung(stand),
        verspaetungNachher: verspaetung(g2),
      });
      schichten = weniger;
      config = c2;
      stand = g2;
    }
  }

  return {
    /** Schichten je Arbeitsgang vorher und nachher */
    vorher: start,
    schichten,
    /** Nur die Arbeitsgaenge, die sich aendern */
    aenderungen: Object.keys(schichten)
      .filter((opId) => Math.abs(schichten[opId] - start[opId]) > 0.01)
      .map((opId) => ({
        opId,
        name: OPERATION_BY_ID[opId]?.name ?? opId,
        von: start[opId],
        nach: schichten[opId],
        stundenVon: stundenFuer(start[opId]),
        stundenNach: stundenFuer(schichten[opId]),
        /** Was unter Parameter steht - kann unter der wirksamen Zeit liegen */
        eingestelltVon: eingestellteStunden(input.config, opId),
      })),
    schritte,
    /** Konfigurationsausschnitt zum Uebernehmen */
    patch: patchAus(schichten, start),
    /** Was danach noch fehlt - echte Plaetze */
    fehlendePlaetze: fehlendePlaetze(config, stand, schichten),
    schichtfaehig: faehig.capable,
    mannschaft: faehig.total,
    verspaetungVorher: verspaetung(result),
    verspaetungNachher: verspaetung(stand),
    stauVorher: round1(summeStau(result)),
    stauNachher: round1(summeStau(stand)),
  };
}

/**
 * Klartext fuer das Orbitalschweissen.
 *
 * Hier haengt die Kette anders als bei einem Platz: Die Maschinen
 * begrenzen die Schweisser (einer bedient zwei), und die Schweisser
 * begrenzen die Stunden. "13 Schweisser zusaetzlich" war deshalb Unsinn -
 * bei sechs Maschinen koennen nie mehr als drei gleichzeitig arbeiten.
 *
 * @param {number} maschinen @param {number} jeSchweisser
 * @param {number} schichten @param {number} spitze Groesste Tageswarteschlange
 */
function orbitalText(maschinen, jeSchweisser, schichten, spitze) {
  const schweisserJeSchicht = Math.max(1, Math.floor(maschinen / jeSchweisser));
  const jeSchicht = round2(schweisserJeSchicht * SCHICHT_STUNDEN);
  const jetzt = round2(jeSchicht * Math.floor(schichten));
  const noetigeSchichten = Math.ceil(spitze / jeSchicht);
  const teile = [
    `${maschinen} Maschinen ÷ ${jeSchweisser} je Schweißer = höchstens ${schweisserJeSchicht} `
    + `Schweißer gleichzeitig, also ${jeSchicht} h je Schicht`,
    `bei ${Math.floor(schichten)} ${Math.floor(schichten) === 1 ? 'Schicht' : 'Schichten'} sind das `
    + `${jetzt} h am Tag, die Spitze verlangt ${round1(spitze)} h`,
  ];
  if (noetigeSchichten <= MAX_SCHICHTEN) {
    teile.push(`nötig: ${noetigeSchichten} Schichten mit je ${schweisserJeSchicht} schichtfähigen Schweißern`);
  } else {
    const inDrei = round2(jeSchicht * MAX_SCHICHTEN);
    const fehlendeMaschinen = Math.ceil(((spitze - inDrei) / SCHICHT_STUNDEN) * jeSchweisser / MAX_SCHICHTEN);
    teile.push(`auch in drei Schichten nur ${inDrei} h – es fehlen zusätzlich rund `
      + `${fehlendeMaschinen} Maschinen (oder die Arbeit muss vorgezogen werden)`);
  }
  return teile.join('; ');
}

/**
 * Welche Abhilfe passt zu einer Ursache, die kein Platz ist?
 * Kurz und in der Sprache der Abteilung.
 * @param {string|null} ursache
 */
function abhilfe(ursache) {
  const u = String(ursache ?? '');
  if (/Mitarbeiter je Auftrag/.test(u)) {
    return 'die Regel „höchstens N Mitarbeiter je Auftrag" anheben (Einstellungen → Parameter)';
  }
  if (/Hydro nur/.test(u) || /Wochentagsregel/.test(u)) {
    return 'die zulässigen Wochentage erweitern – mehr Schichten schaffen keine zusätzlichen Prüftage';
  }
  if (/NoBo/.test(u)) return 'NoBo-Anwesenheit erweitern';
  if (/Mitarbeiterstunden/.test(u)) return 'mehr Personal oder Überstunden – hier fehlen wirklich Stunden';
  if (/Einsetzbare Mitarbeiter/.test(u)) return 'mehr Personen für diesen Arbeitsgang anhaken (Qualifikationsmatrix)';
  if (/Vorgänger/.test(u)) return 'der vorgelagerte Arbeitsgang ist die Bremse, nicht dieser';
  if (/Material/.test(u) || /Startfreigabe/.test(u)) return 'Materialtermin oder frühesten Arbeitsbeginn prüfen';
  if (/Aufträge gleichzeitig/.test(u)) return 'die Regel „Aufträge gleichzeitig" anheben';
  return 'Ursache prüfen – eine weitere Schicht hilft hier nicht';
}

/** Haengt dieser Rueckstand an einem Platz oder einer Maschine? */
function istPlatzUrsache(label) {
  if (!label) return false;
  return /Arbeitsplätze|Heftplätze|Orbitalmaschinen|Prüfstand|Beizplatz/.test(String(label));
}

/**
 * Wie viele schichtfaehige Koepfe verlangt dieser Schichtstand?
 * Die erste Schicht laeuft mit der normalen Mannschaft; jede weitere
 * Schicht braucht je Platz eine schichtfaehige Person.
 * @param {Record<string, number>} schichten @param {any} config
 */
export function gebrauchteSchichtkoepfe(schichten, config) {
  let summe = 0;
  for (const [opId, n] of Object.entries(schichten)) {
    const zusatz = Math.max(0, Math.floor(n) - 1);
    if (zusatz === 0) continue;
    summe += zusatz * koepfeJeSchicht(config, opId);
  }
  return summe;
}

/**
 * Konfiguration mit geaenderten Belegungszeiten.
 *
 * Angefasst wird nur, was sich WIRKLICH aendert. Vorher hat diese Funktion
 * jedem Arbeitsgang eine eigene Belegungszeit eingetragen - auch dort, wo
 * gar keine Schicht geplant wurde. Aus einem allgemeinen Wert von 7 h
 * wurden so stillschweigend 7,5 h je Platz, und ein Vergleich "vorher /
 * nachher" verglich zwei verschiedene Werkstaetten. Bleibt die Schichtzahl
 * gleich, bleibt der Eintrag jetzt unberuehrt.
 */
export function mitSchichten(config, schichten) {
  const jetzt = schichtenJeArbeitsgang(config);
  const c = JSON.parse(JSON.stringify(config));
  c.resources ??= {};
  c.resources.byOperation ??= {};
  for (const [opId, n] of Object.entries(schichten)) {
    if (Math.abs(Number(n) - (jetzt[opId] ?? 1)) < 0.01) continue;
    c.resources.byOperation[opId] ??= {};
    c.resources.byOperation[opId].operatingHours = stundenFuer(n);
  }
  return c;
}

/** Nur die geaenderten Arbeitsgaenge als Patch. */
function patchAus(schichten, start) {
  /** @type {Record<string, any>} */
  const byOperation = {};
  let n = 0;
  for (const opId of Object.keys(schichten)) {
    if (Math.abs(schichten[opId] - start[opId]) < 0.01) continue;
    byOperation[opId] = { operatingHours: stundenFuer(schichten[opId]) };
    n += 1;
  }
  return n > 0 ? { resources: { byOperation } } : null;
}

/** Summe der liegengebliebenen Arbeit (jede Arbeit einmal). */
function summeStau(result) {
  const stau = blockedByOperation(result);
  return Object.values(stau).reduce((a, b) => a + b.manHours, 0);
}

function verspaetung(result) {
  return (result.projects ?? []).reduce((a, p) => a + (p.lateDays || 0), 0);
}

/**
 * Was fehlt noch, nachdem die Schichten geplant sind?
 *
 * Gerechnet wird je Arbeitsgang: Wie viele Platzstunden braucht die
 * liegengebliebene Arbeit, und wie viele zusaetzliche PLAETZE waeren das
 * bei der jetzt geplanten Schichtzahl? Ausgewiesen wird nur, was auch
 * nach der dritten Schicht offen bleibt - alles andere ist eine
 * Schichtfrage, keine Platzfrage.
 *
 * @param {any} config @param {any} result @param {Record<string,number>} schichten
 */
export function fehlendePlaetze(config, result, schichten) {
  const stau = blockedByOperation(result);
  const tage = (result.daySeries ?? []).filter((d) => (d.poolCapacity ?? 0) > 0).length || 1;
  const out = [];
  for (const [opId, b] of Object.entries(stau)) {
    /*
     * Unter 5 h ist kein Engpass, sondern Rundung im Tagesraster -
     * "1 Platz zusaetzlich fuer 0,6 h Arbeitsvorbereitung" waere Unsinn.
     */
    if (b.manHours < 5) continue;
    /*
     * Haengt der Rueckstand NICHT an einem Platz, waere "Plaetze
     * zusaetzlich" die falsche Antwort. Dann wird die wirkliche Ursache
     * benannt - mit der Abhilfe, die dazu passt.
     *
     * Dieser Zweig fehlte und hat die Ausgabe irregefuehrt: Nach der
     * Schichtplanung lag der groesste Rueckstand beim Orbitalschweissen
     * (305 h, Ursache "Mitarbeiter je Auftrag"), ausgewiesen wurden aber
     * nur Beizen und Saegen mit 21 und 17 Verspaetungstagen Wirkung -
     * waehrend die Regel "hoechstens 4 Mitarbeiter je Auftrag" 347 Tage
     * ausmacht.
     */
    if (!istPlatzUrsache(b.topCause)) {
      out.push({
        opId,
        name: OPERATION_BY_ID[opId]?.name ?? opId,
        stunden: round1(b.manHours),
        tage: b.days,
        spitze: round1(b.peakHours),
        ursache: b.topCause,
        einheit: 'ANDERE_URSACHE',
        plaetzeZusaetzlich: 0,
        maxSchichtErreicht: Math.floor(schichten[opId] ?? 1) >= MAX_SCHICHTEN,
        text: `${b.topCause} begrenzt hier, nicht die Plätze – ${abhilfe(b.topCause)}`,
      });
      continue;
    }
    const plaetze = placesFor(config, opId);
    if (plaetze == null) continue;
    const n = schichten[opId] ?? 1;
    const jePlatz = Math.max(1, Number(workersPerPlace(config, opId) ?? 1));
    /*
     * Ein Platz kann man nicht zu 0,4 aufstellen - und die reine
     * Gesamtmenge fuehrt in die Irre: 372 h ueber 159 Tage sind rechnerisch
     * "ein Drittel Platz", stauen sich aber an 118 Tagen mit Spitzen von
     * 34 h. Gerechnet wird deshalb aus der TAGESSPITZE, und aufgerundet auf
     * ganze Plaetze.
     */
    const jeTagJePlatz = round2(jePlatz * stundenFuer(n));
    if (jeTagJePlatz <= 0) continue;
    const nachSpitze = Math.ceil(b.peakHours / jeTagJePlatz);
    const nachMenge = Math.ceil(b.manHours / (jeTagJePlatz * tage));
    /*
     * Beim Orbitalschweissen begrenzen nicht die Maschinen, sondern die
     * SCHWEISSER: einer bedient zwei Maschinen. "+13 Plaetze" waere hier
     * Unsinn - in der ersten Fassung stand genau das da. Gebraucht werden
     * Schweisser, und eine zweite Schicht hilft nur mit schichtfaehigen
     * Schweissern.
     */
    const ueberMaschinen = opId === 'ORBITAL_KEHLNAHT' || opId === 'ORBITAL_STUMPFNAHT';
    const jeSchweisser = Math.max(1, Number(config.resources?.machinesPerWelder ?? 2));
    out.push({
      opId,
      name: OPERATION_BY_ID[opId]?.name ?? opId,
      /** Arbeit, die trotz der geplanten Schichten liegenbleibt */
      stunden: round1(b.manHours),
      tage: b.days,
      spitze: round1(b.peakHours),
      ursache: b.topCause,
      plaetzeJetzt: Number(plaetze),
      schichten: n,
      /** Worin gemessen wird: Plaetze oder Schweisser */
      einheit: ueberMaschinen ? 'SCHWEISSER' : 'PLAETZE',
      /** Ganze Einheiten, um die Tagesspitze aufzunehmen */
      plaetzeZusaetzlich: Math.max(1, nachSpitze),
      /** Ganze Einheiten, um nur die Gesamtmenge unterzubringen */
      plaetzeFuerMenge: Math.max(1, nachMenge),
      /** Was eine Einheit je Tag hergibt */
      platzStundenJeTag: jeTagJePlatz,
      maxSchichtErreicht: Math.floor(n) >= MAX_SCHICHTEN,
      /** Nur beim Orbitalschweissen: wie viele Maschinen ein Schweisser bedient */
      maschinenJeSchweisser: ueberMaschinen ? jeSchweisser : null,
      /** Klartext fuer die Ansicht */
      text: ueberMaschinen
        ? orbitalText(Number(plaetze), jeSchweisser, n, b.peakHours)
        : `${Math.max(1, nachSpitze)} ${nachSpitze === 1 ? 'Platz' : 'Plätze'} zusätzlich`
          + ` (jetzt ${Number(plaetze)} bei ${n} ${n === 1 ? 'Schicht' : 'Schichten'})`,
    });
  }
  return out.sort((a, b) => b.stunden - a.stunden);
}

/**
 * Schichtzuordnung der Mannschaft - WOCHENWEISE.
 *
 * Ausdrueckliche Vorgabe der Abteilungsleitung (18.09.2026): "der MA darf
 * die Schichten nur wochenweise wechseln nicht tageweise." Eine
 * tageweise Rotation waere fuer die Leute unzumutbar und in der
 * Zeiterfassung ein Albtraum.
 *
 * Verteilt wird so:
 *   - Wer nicht schichtfaehig ist, bleibt immer in der Fruehschicht.
 *   - Die uebrigen rotieren woche fuer woche durch die Schichten, damit
 *     nicht immer dieselben die Nachtschicht tragen.
 *   - Je Schicht wird so besetzt, wie die Arbeitsgaenge Plaetze haben -
 *     mehr Leute in einer Schicht koennen ohnehin nicht arbeiten.
 *
 * @param {any} config
 * @param {string[]} wochen Wochenschluessel in Reihenfolge
 * @param {any[]} personen Personen, die ueberhaupt eingeplant sind
 * @returns {{schichtenJeWoche:Record<string,number>,
 *   zuordnung:Record<string,Record<string,number>>, maxSchichten:number,
 *   schichten:Record<string,number>, koepfeJeSchichtZiel:number[],
 *   plaetzeJeSchicht:number[]}}
 *   zuordnung[weekKey][personId] = Schichtnummer (1 = frueh)
 */
export function wochenSchichten(config, wochen, personen) {
  const schichten = schichtenJeArbeitsgang(config);
  const maxSchichten = Math.max(1, ...Object.values(schichten).map((n) => Math.floor(n)));

  /*
   * Wie viele Leute braucht jede Schicht?
   *
   * NICHT gleichmaessig - das war der Fehler im ersten Entwurf. Wird nur
   * die Saege dreischichtig gefahren, laufen Heften, Orbitalschweissen und
   * Vormontage weiter einschichtig; wer in der Nachtschicht steht, kann
   * dort nicht arbeiten. Mit einer Drittelung blieben 255 h ohne Namen und
   * die Last spreizte sich von 409 bis 651 h.
   *
   * Gewichtet wird deshalb mit den PLAETZEN, die in der jeweiligen Schicht
   * ueberhaupt besetzbar sind: Schicht 1 bedient alle Arbeitsgaenge,
   * Schicht 2 nur die zwei- und dreischichtigen, Schicht 3 nur die
   * dreischichtigen.
   */
  /*
   * Wie viele Leute braucht jede Schicht?
   *
   * Zweimal falsch gemacht, beide Male von der Abteilungsleitung
   * korrigiert:
   *
   *  1. Gleichmaessig dritteln - dabei blieben 255 h ohne Namen und die
   *     Last spreizte sich von 409 bis 651 h.
   *  2. Nach allen besetzbaren Plaetzen gewichten - dabei landete niemand
   *     in der dritten Schicht, obwohl die Saege dreischichtig laeuft.
   *
   * Der Hinweis, der es klaert (18.09.2026): "es muss keine volle Schicht
   * gemacht werden, es kann auch nur an gewissen Arbeitsplaetzen
   * mehrschichtig gearbeitet werden. Nicht an allen."
   *
   * Entscheidend ist die KNAPPHEIT: Ein einschichtiger Arbeitsgang kann
   * NUR in der Fruehschicht besetzt werden. Deshalb bekommt die
   * Fruehschicht zuerst, was die einschichtigen Arbeitsgaenge brauchen -
   * im Startdatenbestand allein 10 Plaetze (Heften 2, Orbital 3,
   * Vormontage 4, AV 1) von 14 Leuten. Erst der Rest wird auf die
   * mehrschichtigen Arbeitsgaenge verteilt, und dort auch nur so weit, wie
   * es dort Plaetze gibt.
   */
  /** Plaetze, die in Schicht s ueberhaupt besetzbar sind */
  const plaetzeJeSchicht = [];
  /** Plaetze, die AUSSCHLIESSLICH in Schicht s besetzbar sind */
  const nurInSchicht = [];
  for (let sn = 1; sn <= maxSchichten; sn++) {
    let alle = 0;
    let exklusiv = 0;
    /*
     * Geteilter Kapazitaetstopf (Nutzerauftrag 23.09.2026): Kehlnaht und
     * Stumpfnaht Orbital teilen sich dieselben Koepfe - sonst wuerden hier
     * doppelt so viele Schweisser verlangt, wie es Maschinen gibt.
     */
    const gezaehlteGruppen = new Set();
    for (const [opId, n] of Object.entries(schichten)) {
      const stufen = Math.max(1, Math.floor(n));
      if (stufen < sn) continue;
      const gruppe = OPERATION_BY_ID[opId]?.capacityGroup;
      if (gruppe) {
        if (gezaehlteGruppen.has(gruppe)) continue;
        gezaehlteGruppen.add(gruppe);
      }
      const koepfe = koepfeJeSchicht(config, opId);
      alle += koepfe;
      if (stufen === sn && sn === 1) exklusiv += koepfe;
    }
    plaetzeJeSchicht.push(alle);
    nurInSchicht.push(exklusiv);
  }

  /** @type {Record<string, number>} */
  const schichtenJeWoche = {};
  /** @type {Record<string, Record<string, number>>} */
  const zuordnung = {};

  const faehig = personen.filter((p) => p.shiftCapable !== false);
  const nurFrueh = personen.filter((p) => p.shiftCapable === false);

  /*
   * Schritt 1: Die Fruehschicht bekommt, was die einschichtigen
   * Arbeitsgaenge verlangen - sie haben keine Alternative. Die nicht
   * schichtfaehigen Leute stehen dort ohnehin und werden abgezogen.
   */
  const grenzen = new Array(maxSchichten).fill(0);
  let rest = faehig.length;
  const fruehPflicht = Math.max(0, (nurInSchicht[0] ?? 0) - nurFrueh.length);
  grenzen[0] = Math.min(rest, fruehPflicht);
  rest -= grenzen[0];

  /*
   * Schritt 2: Der Rest geht auf die mehrschichtigen Arbeitsgaenge -
   * spaete und dritte Schicht zuerst, weil dort die Plaetze sonst leer
   * bleiben, aber nie mehr Leute als Plaetze.
   */
  /*
   * Niemand arbeitet allein. Vorgabe der Abteilungsleitung: "keiner darf
   * alleine arbeiten immer mindestens zu zweit." Eine Schicht bekommt
   * deshalb entweder gar niemanden oder mindestens zwei Leute - eine
   * Nachtschicht mit einer Person waere nicht zulaessig.
   */
  const minZusammen = Math.max(1, Number(config.workforce?.minZusammen ?? 2));
  for (let sn = maxSchichten; sn >= 2 && rest > 0; sn--) {
    const plaetze = plaetzeJeSchicht[sn - 1] ?? 0;
    if (plaetze <= 0) continue;
    const nehmen = Math.min(rest, Math.max(plaetze, minZusammen));
    if (nehmen < minZusammen) continue; // lieber keine Schicht als eine Person allein
    grenzen[sn - 1] = nehmen;
    rest -= nehmen;
  }
  /* Was dann noch offen ist, arbeitet in der Fruehschicht - dort ist immer Arbeit */
  grenzen[0] += rest;
  /*
   * Gegenprobe der Zweier-Regel: Bleibt in einer Schicht genau eine Person
   * uebrig, wird diese Schicht nicht gefahren - die Person geht in die
   * Fruehschicht.
   */
  for (let sn = maxSchichten; sn >= 2; sn--) {
    if (grenzen[sn - 1] > 0 && grenzen[sn - 1] < minZusammen) {
      grenzen[0] += grenzen[sn - 1];
      grenzen[sn - 1] = 0;
    }
  }
  /*
   * Von Hand gesetzte Schicht (Nutzerauftrag 23.09.2026): "ich brauche
   * noch die Moeglichkeit die Mitarbeiter KW weise in Schichten
   * einzuplanen." Wer fuer diese Woche eine Schicht gesetzt bekommen hat
   * (person.shiftWeeks[wk], siehe team.js), behaelt sie - die Rotation
   * greift nur noch fuer die uebrigen Personen und nur noch fuer die
   * Plaetze, die die manuelle Zuordnung nicht schon belegt. Nicht
   * schichtfaehige Personen (nurFrueh) koennen nicht manuell versetzt
   * werden - dieselbe Grenze wie bei der Rotation.
   */
  wochen.forEach((wk, wocheIndex) => {
    schichtenJeWoche[wk] = maxSchichten;
    /** @type {Record<string, number>} */
    const derWoche = {};
    for (const p of nurFrueh) derWoche[p.id] = 1;

    /** @type {Map<string, number>} */
    const manuell = new Map();
    for (const p of faehig) {
      const gesetzt = Number(p.shiftWeeks?.[wk]);
      if (Number.isInteger(gesetzt) && gesetzt >= 1) manuell.set(p.id, gesetzt);
    }
    for (const [id, sn] of manuell) derWoche[id] = sn;

    if (maxSchichten <= 1) {
      for (const p of faehig) if (!manuell.has(p.id)) derWoche[p.id] = 1;
      zuordnung[wk] = derWoche;
      return;
    }

    /*
     * Rotation: Die Reihe wird je Woche um die Groesse der Fruehschicht
     * weitergedreht. Damit traegt nicht immer dieselbe Gruppe die Spaet-
     * und Nachtschicht - und innerhalb der Woche wechselt niemand.
     *
     * Laeuft nur noch ueber die Personen ohne manuelle Zuordnung, und die
     * Sollbesetzung je Schicht sinkt um das, was manuell schon belegt ist.
     */
    const frei = faehig.filter((p) => !manuell.has(p.id));
    const grenzenRest = grenzen.map((n, idx) => {
      const belegt = [...manuell.values()].filter((sn) => sn === idx + 1).length;
      return Math.max(0, n - belegt);
    });
    const reihe = [...frei].sort((a, b) => (a.id < b.id ? -1 : 1));
    const versatz = reihe.length
      ? (wocheIndex * Math.max(1, grenzenRest[0])) % reihe.length
      : 0;
    const gedreht = [...reihe.slice(versatz), ...reihe.slice(0, versatz)];
    let i = 0;
    for (let sn = 1; sn <= maxSchichten; sn++) {
      const n = grenzenRest[sn - 1] ?? 0;
      for (let k = 0; k < n && i < gedreht.length; k++, i++) derWoche[gedreht[i].id] = sn;
    }
    /* Wer uebrig bleibt, geht in die Fruehschicht - dort ist immer Arbeit */
    for (; i < gedreht.length; i++) derWoche[gedreht[i].id] = 1;
    zuordnung[wk] = derWoche;
  });

  return {
    schichtenJeWoche,
    zuordnung,
    maxSchichten,
    schichten,
    /** Soll-Besetzung je Schicht, aus den besetzbaren Plaetzen gewichtet */
    koepfeJeSchichtZiel: grenzen,
    plaetzeJeSchicht,
  };
}
