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
import { blockedByOperation, blockedByOperationWoche } from './kpi.js';
import { weekKey } from './calendar.js';

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
 * Schichtzahl je Arbeitsgang, wie sie fuer EINE bestimmte Kalenderwoche
 * eingestellt ist (Nutzerauftrag 25.09.2026: "Nachtschicht muss in
 * Engpasswochen geplant werden" - nicht durchgehend fuer den ganzen
 * Zeitraum). Faellt ohne wochenweise Uebersteuerung auf den Wert von
 * `schichtenJeArbeitsgang` zurueck - identisch fuer jede Woche, solange
 * niemand `operatingHoursByWeek` je Arbeitsgang gesetzt hat.
 * @param {any} config @param {string} wk Wochenschluessel ('YYYY-Www')
 * @returns {Record<string, number>}
 */
export function schichtenJeArbeitsgangWoche(config, wk) {
  const res = config.resources ?? {};
  const allgemein = Number(res.operatingHoursPerDay) || SCHICHT_STUNDEN;
  /** @type {Record<string, number>} */
  const out = {};
  for (const op of OPERATIONS) {
    const eigen = res.byOperation?.[op.id];
    const wert = eigen?.operatingHoursByWeek?.[wk] ?? eigen?.operatingHours ?? allgemein;
    out[op.id] = schichtenAus(wert);
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
  const faehig = shiftCapability(config);
  const wochen = [...new Set((result.daySeries ?? []).map((d) => weekKey(d.date)))];
  /** Wochenweiser Plan der bereits verfeinerten Arbeitsgaenge, ueber alle Aussenrunden hinweg */
  /** @type {Record<string, Record<string, number>>} */
  const wochenPlan = {};

  /*
   * Aeussere Schleife: Phase 1 (Arbeitsgang-Ebene) und Phase 2 (Wochen-
   * Verfeinerung) wiederholen sich, bis eine ganze Runde nichts mehr
   * aendert. Noetig, weil Phase 2 Kapazitaet freimacht (nicht mehr
   * benoetigte Wochen fallen zurueck), die Phase 1 in der naechsten Runde
   * fuer einen ANDEREN Arbeitsgang nutzen kann - genau wie das Leeren von
   * `verworfen` weiter unten, nur eine Ebene hoeher. Ohne diese Schleife
   * blieb im Praxistest (Nutzerpruefung 25.09.2026) ein zweiter Runde
   * noetig: Biegen, Kehlnaht, Endkontrolle und eine dritte Beiz-Schicht
   * wurden erst gefunden, wenn man den fertigen Vorschlag ein zweites Mal
   * durch den Rechner schickte - "laeuft es schon so" fand dann noch 4
   * weitere Aenderungen, obwohl nichts mehr uebrig bleiben sollte.
   */
  /*
   * Manche Arbeitsgaenge sind nur gemeinsam ueberfluessig, nicht einzeln:
   * ALLE zusammen hochgefahren zeigt keiner mehr einen eigenen Rueckstand
   * (Feinschliff nimmt sie dann in der naechsten Runde zurueck), aber
   * einzeln fuer sich genommen (Ausgangslage nur mit dem staerksten
   * Kandidaten) hilft doch wieder jeder von ihnen ein wenig - die naechste
   * Runde findet sie also erneut. Ohne Gegenmassnahme pendelt die Rechnung
   * endlos zwischen "alle sieben oben" und "nur der eine" hin und her,
   * bei GLEICHER Verspaetung (belegt bei der Nutzerpruefung 25.09.2026).
   * Erkannt wird das am wiederkehrenden Zustand; gewaehlt wird dann die
   * schlankere der beiden Varianten - weniger Zusatzschichten fuer
   * denselben Termin-Nutzen ist immer die bessere Wahl.
   */
  const gesehen = new Map();
  for (let aussenRunde = 0; aussenRunde < 10; aussenRunde++) {
    const schichtenVorRunde = { ...schichten };

    /** Arbeitsgaenge, bei denen eine weitere Schicht schon geprueft wurde */
    const verworfen = new Set();
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
      const naechsteConfig = mitEinemKandidaten(config, opId, naechste);
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
      /*
       * Eine angenommene Schicht aendert den Stand fuer ALLE anderen
       * Arbeitsgaenge mit - ein vorhin verworfener Kandidat kann dadurch
       * jetzt doch etwas bringen (Nutzerpruefung 24.09.2026: ohne diese
       * Zeile blieb ein zweiter Biegeplatz dauerhaft verworfen, obwohl er
       * nach spaeteren Schichten nachweislich noch Verspaetung abbaute -
       * ein zweiter Lauf von planeSchichten fand ihn dann noch, obwohl der
       * erste Lauf laengst "fertig" gemeldet hatte).
       */
      verworfen.clear();
      break;
    }
    if (!uebernommen) break;
  }

  /*
   * Feinschliff Teil 1: Jede gesetzte Schicht wird einmal testweise ganz
   * ZURUECKGENOMMEN (fuer den GANZEN Zeitraum). Bringt die Ruecknahme
   * dasselbe oder mehr, bleibt sie draussen - eine Schicht, die nichts
   * mehr beitraegt, kostet nur Zuschlaege und Personal. Der Greedy-Weg kann
   * solche Schichten hinterlassen, weil ein spaeterer Schritt ihre Wirkung
   * uebernimmt.
   */
  for (const opId of Object.keys(schichten)) {
    if (Math.abs(schichten[opId] - start[opId]) < 0.01) continue;
    const weniger = { ...schichten, [opId]: Math.max(start[opId], Math.floor(schichten[opId]) - 1) };
    if (Math.abs(weniger[opId] - schichten[opId]) < 0.01) continue;
    const c2 = mitEinemKandidaten(config, opId, weniger[opId]);
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

  /*
   * Woelbt ein Arbeitsgang diese Runde vollstaendig auf den Ausgangswert
   * zurueck (Feinschliff Teil 1), ist ein fruehererer wochenweiser Eintrag
   * dafuer nicht mehr gueltig - er wird verworfen, damit Phase 2 unten
   * nicht mit veralteten Wochen weiterrechnet.
   */
  for (const opId of Object.keys(wochenPlan)) {
    if (Math.abs(schichten[opId] - start[opId]) < 0.01) delete wochenPlan[opId];
  }

  /*
   * Feinschliff Teil 2: wochenweise verfeinern (Nutzerauftrag 25.09.2026:
   * "die Nachtschicht muss in Engpasswochen geplant werden" - nicht
   * durchgehend fuer den ganzen Zeitraum). Teil 1 hat je Arbeitsgang
   * entschieden, OB und wie weit eine Schicht insgesamt hilft. Hier wird
   * das nur noch VERFEINERT: fuer jeden hochgesetzten Arbeitsgang wird
   * Woche fuer Woche geprueft, ob die hoehere Schicht in DIESER Woche
   * wirklich noetig ist - oder ob die Woche ohne Verspaetungsschaden auf
   * den Ausgangswert zurueckfallen kann. Eine Woche wird nur
   * zurueckgenommen, nie hoehergesetzt: das Ergebnis kann also nie
   * schlechter sein als nach Teil 1, nur schlanker.
   *
   * Nur Arbeitsgaenge, die neu oder hoeher als bisher sind, bekommen einen
   * frischen wochenweisen Eintrag - bereits in frueheren Aussenrunden
   * verfeinerte Arbeitsgaenge bleiben unangetastet, solange sich an ihrer
   * Spitzenschicht nichts geaendert hat.
   */
  for (const opId of Object.keys(schichten)) {
    if (Math.abs(schichten[opId] - start[opId]) < 0.01) continue;
    const bisherigerPeak = wochenPlan[opId] ? Math.max(...Object.values(wochenPlan[opId])) : start[opId];
    if (bisherigerPeak >= schichten[opId] - 0.01) continue;
    wochenPlan[opId] = {};
    for (const wk of wochen) wochenPlan[opId][wk] = schichten[opId];
  }
  if (Object.keys(wochenPlan).length > 0 && wochen.length > 1) {
    // Neu aufbauen: ab hier zaehlt nur noch die wochenweise Darstellung.
    config = mitSchichtenWoche(input.config, wochenPlan);
    stand = rechne(config);

    for (const opId of Object.keys(wochenPlan)) {
      /*
       * Getestet (mit einer vollen Neuterminierung) wird nur, wo es sich
       * lohnen KANN: Wochen, in denen dieser Arbeitsgang beim jetzigen
       * (hochgefahrenen) Stand schon so gut wie keinen Rueckstand mehr hat.
       * Wochen mit echtem Rueckstand werden gar nicht erst teuer getestet,
       * sondern gleich als noch noetig behandelt - eine Ruecknahme dort
       * wuerde ohnehin fast immer scheitern. Neu ermittelt fuer JEDEN
       * Arbeitsgang, damit bereits zurueckgenommene Wochen anderer
       * Arbeitsgaenge beruecksichtigt sind.
       */
      const stauJeWoche = blockedByOperationWoche(stand);
      /*
       * Zusaetzliche Sperre (Nutzerpruefung 25.09.2026 mit echten Daten
       * gefunden): Haelt ein ANDERER hochgesetzter Arbeitsgang dieselbe
       * Woche ohnehin auf Mehrschichtbetrieb, aendert die Ruecknahme
       * dieses einen Arbeitsganges an der Kopfzahl der Woche gar nichts -
       * unbedenklich. Waere diese Woche aber die LETZTE, die noch
       * mehrschichtig gehalten wird, faellt die ganze Woche auf 1 Schicht
       * zurueck - dann verlieren auch Leute ihren Schichtplatz, die
       * anderswo noch gebraucht wuerden (genau das hat vorhin den
       * Leerlauf von 264 auf 351 Personentage hochgetrieben, obwohl die
       * Verspaetung nicht litt). Eine solche Woche wird nur zurueckgenommen,
       * wenn WIRKLICH ueberall Ruhe ist - nicht nur bei diesem Arbeitsgang.
       */
      const stauGesamtJeWoche = {};
      const kandidatenWochen = wochen.filter((wk) => {
        if ((stauJeWoche[wk]?.[opId]?.manHours ?? 0) >= 0.5) return false;
        if (Math.abs(wochenPlan[opId][wk] - start[opId]) < 0.01) return false;
        const andereHaltenWocheHoch = Object.entries(wochenPlan).some(([anderId, jeWoche]) => (
          anderId !== opId && Math.floor(jeWoche[wk] ?? start[anderId]) > Math.floor(start[anderId])));
        if (andereHaltenWocheHoch) return true;
        if (!(wk in stauGesamtJeWoche)) {
          stauGesamtJeWoche[wk] = Object.values(stauJeWoche[wk] ?? {})
            .reduce((a, b) => a + (b.manHours || 0), 0);
        }
        return stauGesamtJeWoche[wk] < 0.5;
      });

      /*
       * Erst im GANZEN versuchen: alle Kandidatenwochen dieses
       * Arbeitsganges auf einmal zuruecknehmen - EIN Rechenlauf statt
       * vieler. Das ist der haeufige Fall (die Kandidaten sind ja gerade
       * die Wochen ohne nennenswerten Rueckstand) und spart die meisten
       * der sonst noetigen Neuterminierungen. Nur wenn das GANZE schadet,
       * wird einzeln nachgesehen - dann kann es trotzdem einzelne Wochen
       * geben, deren Ruecknahme fuer sich allein noch verkraftbar ist.
       */
      if (kandidatenWochen.length > 1) {
        const batchPlan = { ...wochenPlan[opId] };
        for (const wk of kandidatenWochen) batchPlan[wk] = start[opId];
        const c2 = mitSchichtenWoche(input.config, { ...wochenPlan, [opId]: batchPlan });
        const g2 = rechne(c2);
        if (verspaetung(g2) <= verspaetung(stand) && summeStau(g2) <= summeStau(stand) + 0.5) {
          wochenPlan[opId] = batchPlan;
          config = c2;
          stand = g2;
          kandidatenWochen.length = 0; // erledigt - keine Einzelpruefung mehr noetig
        }
      }

      for (const wk of kandidatenWochen) {
        if (Math.abs(wochenPlan[opId][wk] - start[opId]) < 0.01) continue; // schon zurueckgenommen
        const versuchPlan = { ...wochenPlan, [opId]: { ...wochenPlan[opId], [wk]: start[opId] } };
        const c2 = mitSchichtenWoche(input.config, versuchPlan);
        const g2 = rechne(c2);
        if (verspaetung(g2) <= verspaetung(stand) && summeStau(g2) <= summeStau(stand) + 0.5) {
          wochenPlan[opId][wk] = start[opId];
          config = c2;
          stand = g2;
        }
      }
      // Voellig zurueckgenommene Arbeitsgaenge zaehlen nicht mehr als Aenderung.
      const nochGebraucht = Object.values(wochenPlan[opId])
        .some((n) => Math.abs(n - start[opId]) >= 0.01);
      if (!nochGebraucht) delete wochenPlan[opId];
    }
    // Peak je Arbeitsgang aus dem wochenweisen Plan (fuer Anzeige/Vergleich).
    schichten = { ...start };
    for (const [opId, jeWoche] of Object.entries(wochenPlan)) {
      schichten[opId] = Math.max(...Object.values(jeWoche));
    }
  }

    /*
     * Konvergenz: hat diese Aussenrunde NICHTS mehr veraendert (weder
     * Phase 1 noch die Feinschliffe), ist der Plan stabil - eine weitere
     * Runde wuerde exakt dasselbe wiederfinden.
     */
    const geaendertDieseRunde = Object.keys(start).some((opId) => Math.abs(
      (schichten[opId] ?? start[opId]) - (schichtenVorRunde[opId] ?? start[opId])) > 0.01);
    if (!geaendertDieseRunde) break;

    // Pendelt der Zustand (siehe oben)? Dann die schlankere der beiden
    // wiederkehrenden Varianten nehmen und abbrechen.
    const signatur = JSON.stringify(schichten);
    const summe = Object.values(schichten).reduce((a, b) => a + b, 0);
    const fruehereRunde = gesehen.get(signatur);
    if (fruehereRunde) {
      if (fruehereRunde.summe > summe) {
        // Die aktuelle (schlankere) Variante bleibt bestehen - nichts zu tun.
      } else {
        // Die zuerst gesehene Variante war schon die schlankere - zurueck dorthin.
        schichten = fruehereRunde.schichten;
        config = fruehereRunde.config;
        stand = fruehereRunde.stand;
        Object.keys(wochenPlan).forEach((k) => delete wochenPlan[k]);
        Object.assign(wochenPlan, fruehereRunde.wochenPlan);
      }
      break;
    }
    gesehen.set(signatur, {
      schichten: { ...schichten },
      config,
      stand,
      wochenPlan: JSON.parse(JSON.stringify(wochenPlan)),
      summe,
    });
  }

  return {
    /** Schichten je Arbeitsgang vorher und nachher (Spitzenwert je Arbeitsgang) */
    vorher: start,
    schichten,
    /** Nur die Arbeitsgaenge, die sich aendern */
    aenderungen: Object.keys(schichten)
      .filter((opId) => Math.abs(schichten[opId] - start[opId]) > 0.01)
      .map((opId) => ({
        opId,
        name: OPERATION_BY_ID[opId]?.name ?? opId,
        von: start[opId],
        /** Hoechste Schicht, die dieser Arbeitsgang in irgendeiner Woche erreicht */
        nach: schichten[opId],
        stundenVon: stundenFuer(start[opId]),
        stundenNach: stundenFuer(schichten[opId]),
        /** NUR die Wochen, die tatsaechlich hoehergefahren werden (KW -> Schichtzahl) */
        wochen: Object.fromEntries(
          Object.entries(wochenPlan[opId] ?? {}).filter(([, n]) => Math.abs(n - start[opId]) >= 0.01)),
        /** Was unter Parameter steht - kann unter der wirksamen Zeit liegen */
        eingestelltVon: eingestellteStunden(input.config, opId),
      })),
    schritte,
    /** Konfigurationsausschnitt zum Uebernehmen */
    patch: patchAusWoche(wochenPlan, start),
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

/**
 * Testkonfiguration fuer EINEN Kandidaten in Phase 1 von `planeSchichten` -
 * setzt nur diesen einen Arbeitsgang, laesst alle anderen unberuehrt.
 *
 * Nicht `mitSchichten` verwenden: das liest ueber `schichtenJeArbeitsgang`
 * (nicht wochenweise) ab, was "schon eingestellt" ist - ein Arbeitsgang,
 * der aus einer frueheren Runde bereits wochenweise verfeinert ist (nur in
 * bestimmten KW hochgefahren, `operatingHoursByWeek` statt flachem
 * `operatingHours`), erscheint dort als "noch auf 1" und wird beim naechsten
 * getesteten Kandidaten versehentlich WIEDER flach fuer den GANZEN
 * Zeitraum hochgesetzt. Damit vergleicht Phase 1 den neuen Kandidaten
 * gegen einen zu guenstigen (zu grosszuegigen) Massstab und lehnt ihn zu
 * frueh ab. Gefunden bei der Nutzerpruefung 25.09.2026: "laeuft es schon
 * so" fand nach dem Uebernehmen noch weitere Arbeitsgaenge, die im
 * ersten Durchlauf faelschlich verworfen worden waren.
 * @param {any} config @param {string} opId @param {number} n
 */
function mitEinemKandidaten(config, opId, n) {
  const c = JSON.parse(JSON.stringify(config));
  c.resources ??= {};
  c.resources.byOperation ??= {};
  c.resources.byOperation[opId] = { ...c.resources.byOperation[opId], operatingHours: stundenFuer(n) };
  return c;
}

/**
 * Konfiguration mit geaenderten Belegungszeiten - WOCHENWEISE.
 *
 * Wie `mitSchichten`, nur je Kalenderwoche statt fuer den ganzen Zeitraum
 * (Nutzerauftrag 25.09.2026: Nachtschicht nur in Engpasswochen). Angefasst
 * wird wieder nur, was sich wirklich aendert - Wochen ohne Eintrag bleiben
 * beim bisherigen Wert des Arbeitsganges.
 * @param {any} config
 * @param {Record<string, Record<string, number>>} planJeOpUndWoche [opId][wk] = Schichtzahl
 */
export function mitSchichtenWoche(config, planJeOpUndWoche) {
  const start = schichtenJeArbeitsgang(config);
  const c = JSON.parse(JSON.stringify(config));
  c.resources ??= {};
  c.resources.byOperation ??= {};
  for (const [opId, jeWoche] of Object.entries(planJeOpUndWoche)) {
    const eintraege = Object.entries(jeWoche)
      .filter(([, n]) => Math.abs(Number(n) - (start[opId] ?? 1)) >= 0.01);
    if (eintraege.length === 0) continue;
    c.resources.byOperation[opId] ??= {};
    c.resources.byOperation[opId].operatingHoursByWeek ??= {};
    for (const [wk, n] of eintraege) {
      c.resources.byOperation[opId].operatingHoursByWeek[wk] = stundenFuer(n);
    }
  }
  return c;
}

/** Nur die geaenderten Arbeitsgaenge, wochenweise, als Patch. */
function patchAusWoche(wochenPlan, start) {
  /** @type {Record<string, any>} */
  const byOperation = {};
  let n = 0;
  for (const [opId, jeWoche] of Object.entries(wochenPlan)) {
    const operatingHoursByWeek = {};
    let geaendert = false;
    for (const [wk, s] of Object.entries(jeWoche)) {
      if (Math.abs(s - start[opId]) < 0.01) continue;
      operatingHoursByWeek[wk] = stundenFuer(s);
      geaendert = true;
    }
    if (!geaendert) continue;
    byOperation[opId] = { operatingHoursByWeek };
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
  /** @type {Record<string, number>} */
  const schichtenJeWoche = {};
  /** @type {Record<string, Record<string, number>>} */
  const zuordnung = {};
  /** Hoechste Schichtzahl je Arbeitsgang, ueber ALLE Wochen (informativ)
   * @type {Record<string, number>} */
  const schichtenMax = {};
  /** Hoechste Schichtzahl, die irgendeine Woche im Zeitraum braucht */
  let maxSchichtenGesamt = 1;
  /** Zuletzt berechnete Soll-Besetzung/Plaetze je Schicht (letzte Woche) */
  let letzteGrenzen = [];
  let letztePlaetzeJeSchicht = [];

  const faehig = personen.filter((p) => p.shiftCapable !== false);
  const nurFrueh = personen.filter((p) => p.shiftCapable === false);
  /*
   * Niemand arbeitet allein. Vorgabe der Abteilungsleitung: "keiner darf
   * alleine arbeiten immer mindestens zu zweit." Eine Schicht bekommt
   * deshalb entweder gar niemanden oder mindestens zwei Leute - eine
   * Nachtschicht mit einer Person waere nicht zulaessig.
   */
  const minZusammen = Math.max(1, Number(config.workforce?.minZusammen ?? 2));

  /*
   * Wochenweise (Nutzerauftrag 25.09.2026: "Nachtschicht muss in
   * Engpasswochen geplant werden" - nicht durchgehend). Jede Woche bekommt
   * ihre EIGENE Schichtzahl je Arbeitsgang (schichtenJeArbeitsgangWoche) und
   * daraus ihre eigene Soll-Besetzung je Schicht - eine Woche ohne
   * Engpassschicht braucht dann auch niemanden in der Spaet-/Nachtschicht.
   * Ohne wochenweise Uebersteuerung ist das fuer jede Woche derselbe Wert
   * wie vorher (schichtenJeArbeitsgang) - unveraendertes Verhalten.
   */
  wochen.forEach((wk, wocheIndex) => {
    const schichten = schichtenJeArbeitsgangWoche(config, wk);
    const maxSchichten = Math.max(1, ...Object.values(schichten).map((n) => Math.floor(n)));
    schichtenJeWoche[wk] = maxSchichten;
    maxSchichtenGesamt = Math.max(maxSchichtenGesamt, maxSchichten);
    for (const [opId, n] of Object.entries(schichten)) {
      schichtenMax[opId] = Math.max(schichtenMax[opId] ?? 1, Math.floor(n));
    }

    /*
     * Wie viele Leute braucht jede Schicht DIESE Woche?
     *
     * NICHT gleichmaessig - das war der Fehler im ersten Entwurf. Wird nur
     * die Saege dreischichtig gefahren, laufen Heften, Orbitalschweissen und
     * Vormontage weiter einschichtig; wer in der Nachtschicht steht, kann
     * dort nicht arbeiten.
     *
     * Zweimal falsch gemacht, beide Male von der Abteilungsleitung
     * korrigiert:
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
     * Fruehschicht zuerst, was die einschichtigen Arbeitsgaenge brauchen.
     * Erst der Rest wird auf die mehrschichtigen Arbeitsgaenge verteilt,
     * und dort auch nur so weit, wie es dort Plaetze gibt.
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
    letzteGrenzen = grenzen;
    letztePlaetzeJeSchicht = plaetzeJeSchicht;

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
    /** Hoechste Schichtzahl, die irgendeine Woche im Zeitraum braucht */
    maxSchichten: maxSchichtenGesamt,
    /** Hoechste Schichtzahl je Arbeitsgang, ueber alle Wochen (informativ) */
    schichten: schichtenMax,
    /** Soll-Besetzung je Schicht der ZULETZT berechneten Woche */
    koepfeJeSchichtZiel: letzteGrenzen,
    plaetzeJeSchicht: letztePlaetzeJeSchicht,
  };
}
