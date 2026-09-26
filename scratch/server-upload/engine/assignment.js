/**
 * Einsatzplan je Mitarbeiter.
 *
 * Die Terminierung rechnet mit Stunden, nicht mit Personen. Fuer die
 * Werkstatt ist aber genau das die Frage: "Was mache ich am Dienstag, an
 * welchem Auftrag?" Deshalb werden die eingeplanten Stunden nachtraeglich
 * auf die Mannschaft verteilt.
 *
 * ACHTUNG - dieser Plan war verdreht und wurde am 18.09.2026
 * zurueckgewiesen: "Der Einsatzplan ist auch verdreht und nicht logisch.
 * MAAP wird an manchen Tagen gar nicht geplant, obwohl anwesend."
 *
 * Der Vorwurf traf zu. Der Kommentar hier behauptete "gleichmaessige
 * Auslastung", der Code tat das Gegenteil: Er gab der Person mit dem
 * groessten Restbudget ihr GANZES Tagesbudget auf einmal
 * (`Math.min(rest, restStunden)`). Damit nahm der Erste 7,5 h, der Zweite
 * den Rest - und alle weiteren gingen leer aus. Ueber den Horizont kam so
 * heraus: JARO 1.170 h, TOBE 21 h, STWUE 3 h. Kein Plan, den man aushaengen
 * kann.
 *
 * Neu geplant wird, wie es die Abteilungsleitung tun wuerde:
 *
 *   1. Nur wer den Arbeitsgang darf, bekommt ihn (Qualifikationsmatrix).
 *   2. Je Tag hat jede Person ein Stundenbudget: Zeitanteil x Arbeitszeit.
 *   3. Ein Platz, eine Person. An einer Saege stehen nicht fuenf Leute.
 *      Die Zahl der gleichzeitig Eingesetzten ist auf die PLAETZE des
 *      Arbeitsganges begrenzt (beim Orbitalschweissen auf die Schweisser,
 *      die die Maschinen bedienen koennen).
 *   4. Knappe Qualifikationen zuerst - sonst belegt ein Springer die
 *      Stunden, die anschliessend beim Engpass fehlen.
 *   5. Ausgewaehlt wird, wer BISHER am wenigsten Stunden hat. Damit
 *      rotiert die Arbeit ueber die Mannschaft, statt sich bei den ersten
 *      Kuerzeln zu sammeln. Bei Gleichstand bleibt jemand auf dem
 *      Arbeitsgang, den er heute schon macht (keine unnoetigen
 *      Platzwechsel), danach entscheidet das Kuerzel - der Plan ist
 *      reproduzierbar.
 *   6. Wer anwesend ist und trotzdem nichts bekommt, steht MIT GRUND da:
 *      kein Platz frei, keine passende Qualifikation oder schlicht keine
 *      Arbeit mehr. Eine leere Zeile ohne Grund ist keine Auskunft.
 *   7. Was uebrig bleibt, weil die Mannschaft kleiner ist als die
 *      gerechnete Besetzung, steht offen als "noch zuzuordnen" - es wird
 *      niemand erfunden.
 */

import { OPERATION_BY_ID, round2 } from './model.js';
import { peopleOf, personPresent, absenceOn, personEffectiveFactor } from './team.js';
import { placesFor, workersPerPlace, DAY_KIND, LIMITER_LABEL } from './capacity.js';
import { schichtenJeArbeitsgangWoche, wochenSchichten, SCHICHT_STUNDEN } from './schichtplan.js';
import { weekKey, cmpDate } from './calendar.js';
import { resolveRouting } from './routing.js';
import { releaseInfo, opReleaseDate } from './scheduler.js';

/**
 * @param {any} result Ergebnis von runSchedule
 * @param {any} config
 * @param {{from?:string, to?:string}} [range] Zeitraum (leer = alles)
 * @param {{projects?:any[], templates?:any}} [extra] Fuer den Vorzug (siehe unten) -
 *   ohne diese beiden Felder bleibt der Vorzug inaktiv (sicherer Normalfall).
 */
export function assignPeople(result, config, range = {}, extra = {}) {
  const people = peopleOf(config);
  const tage = [];
  /** @type {Record<string, any>} */
  const byPerson = {};
  for (const p of people) {
    byPerson[p.id] = {
      id: p.id, role: p.role ?? '', factor: Number(p.factor ?? 1) || 0,
      hours: 0, byOp: {}, byWeek: {}, absentDays: 0,
      /** Anwesend, aber ohne Arbeit - und warum */
      idleDays: 0, idleReasons: {},
    };
  }
  let offen = 0;

  const capOf = new Map(result.daySeries.map((d) => [d.date, d]));
  /*
   * Eigene Kopien der Allokationen - nicht `result.allocations` selbst.
   * Der Vorzug unten (siehe dort) zieht Stunden von einem spaeteren Tag ab,
   * sobald sie heute vergeben werden - `result` ist aber die Terminierung
   * und darf fuer andere, spaetere Aufrufe (z. B. eine zweite Anzeige mit
   * anderem Zeitraum) unveraendert bleiben.
   */
  const allocationsKlon = (result.allocations ?? []).map((a) => ({ ...a }));
  const alloc = new Map();
  const allocUngefiltert = new Map();
  for (const a of allocationsKlon) {
    (allocUngefiltert.get(a.date) ?? allocUngefiltert.set(a.date, []).get(a.date)).push(a);
    if (range.from && a.date < range.from) continue;
    if (range.to && a.date > range.to) continue;
    (alloc.get(a.date) ?? alloc.set(a.date, []).get(a.date)).push(a);
  }

  /*
   * FIX Mittel10 (Audit 20.09.2026): vollstaendig arbeitsfreie Tage
   * verschwinden nicht mehr aus dem Einsatzplan.
   *
   * Bisher liefen alle folgenden Schritte nur ueber `alloc.keys()` - also
   * ausschliesslich Tage, an denen IRGENDEIN Auftrag irgendetwas gebucht
   * hat. Ein Tag, an dem die Mannschaft komplett ohne freigegebene Arbeit
   * dastand (Beispiel: Personal ab dem Stichtag da, Material/Freigabe erst
   * Tage spaeter), tauchte im Plan gar nicht auf - weder als Zeile noch in
   * `idleDays`. Jetzt zaehlt der VOLLSTAENDIGE Kalender (Arbeitstage und
   * Samstage im gewaehlten Zeitraum), unabhaengig davon, ob an dem Tag
   * gebucht wurde.
   */
  const arbeitstage = result.daySeries
    .filter((d) => d.kind !== DAY_KIND.OFF)
    .filter((d) => (!range.from || d.date >= range.from) && (!range.to || d.date <= range.to))
    .map((d) => d.date);

  const projectName = new Map((result.projects ?? []).map((p) => [p.id, p.orderNo ?? p.id]));

  /*
   * Vorzug (Nutzeranforderung 25.09.2026: "Es kann nicht sein, dass ein MA
   * keine Arbeit hat, weil die Arbeit des Tages vergeben ist. Dann muss
   * Arbeit vom Folgetag vorgezogen werden."): Vorbereitung fuer die
   * eigentliche Vergabe weiter unten (siehe dort). Geprueft wird NICHT nur
   * das Freigabedatum, sondern zusaetzlich, ob ALLE Vorgaenger-Arbeitsgaenge
   * dieses Auftrags schon VOR heute vollstaendig eingeplant sind (keine
   * eigene Allokation mehr an oder nach dem Zieltag) - sonst koennte
   * vorgezogene Arbeit auf einem Vorgaenger aufbauen, der bei einer echten
   * Terminierung erst heute oder morgen fertig wuerde. Ohne diese Pruefung
   * waere ein Vorzug ein Terminierungsfehler, kein Komfortgewinn.
   */
  const projectById = new Map((extra.projects ?? []).map((p) => [p.id, p]));
  /** @type {Map<string, any>} */
  const routingCache = new Map();
  /** @type {Map<string, string|null>} (opId|projectId) -> fruehestes Freigabedatum */
  const freigabeCache = new Map();
  /** @type {Map<string, string>} (projectId|opId) -> spaetestes Allokationsdatum */
  const letzteAllokation = new Map();
  if (extra.projects && extra.templates) {
    for (const a of allocationsKlon) {
      const schluessel = `${a.projectId}|${a.opId}`;
      const bisher = letzteAllokation.get(schluessel);
      if (!bisher || a.date > bisher) letzteAllokation.set(schluessel, a.date);
    }
  }
  /** @param {string} opId @param {string} projectId @param {string} heute */
  const heuteVorziehbar = (opId, projectId, heute) => {
    if (!extra.projects || !extra.templates) return false;
    const project = projectById.get(projectId);
    if (!project) return false;
    let routing = routingCache.get(projectId);
    if (routing === undefined) {
      try { routing = resolveRouting(project, extra.templates, config); } catch { routing = null; }
      routingCache.set(projectId, routing);
    }
    const op = routing?.ops.find((o) => o.opId === opId);
    if (!op) return false;
    const freigabeKey = `${opId}|${projectId}`;
    let freigabe = freigabeCache.get(freigabeKey);
    if (freigabe === undefined) {
      const rel = releaseInfo(project, config);
      freigabe = opReleaseDate(op, project, rel);
      freigabeCache.set(freigabeKey, freigabe);
    }
    if (!freigabe || cmpDate(freigabe, heute) > 0) return false;
    for (const vorgaenger of op.predecessors ?? []) {
      const letzte = letzteAllokation.get(`${projectId}|${vorgaenger.opId}`);
      if (letzte && cmpDate(letzte, heute) >= 0) return false;
    }
    return true;
  };

  /** Wartende Arbeit je Tag - fuer die Begruendung "warum bekomme ich nichts" */
  /** @type {Map<string, any[]>} */
  const stauAm = new Map();
  for (const b of result.blocked ?? []) {
    if (b.info || !b.opId) continue;
    (stauAm.get(b.date) ?? stauAm.set(b.date, []).get(b.date)).push(b);
  }

  /*
   * Luecken-Report (Nutzeranforderung 21.09.2026): fuer jede von der
   * Terminierung als ausfuehrbar eingestufte, aber hier nicht besetzbare
   * Stunde der konkrete, nachpruefbare Ablehnungsgrund - Qualifikation,
   * Budget oder Platzgrenze. Nicht "kein Platz frei" als Sammelbegriff,
   * sondern: welche Bedingung genau hat gefehlt.
   * @type {any[]}
   */
  const luecken = [];

  /*
   * Schichten - wochenweise, nie tageweise.
   *
   * Vorgabe der Abteilungsleitung (18.09.2026): "plane dann an den
   * Arbeitsplaetzen so die Schichten dass es maximal effizient ist unter
   * Beruecksichtigung der 2-3 Schicht und der MA darf die Schichten nur
   * wochenweise wechseln nicht tageweise."
   *
   * Laeuft ein Arbeitsgang zweischichtig, arbeiten dort Leute der ersten
   * UND der zweiten Schicht - je Schicht aber nur so viele, wie er Plaetze
   * hat. Wer in der Spaetschicht ist, kann an einem einschichtigen
   * Arbeitsgang nicht arbeiten.
   */
  const wochenListe = [...new Set(arbeitstage.map((d) => weekKey(d)))].sort();
  const eingeplantePersonen = people.filter((p) => p.defaultActive !== false
    || Object.values(p.weeks ?? {}).some(Boolean));
  const schichtplan = wochenSchichten(config, wochenListe, eingeplantePersonen);
  /** Stunden, die eine Schicht nicht besetzen konnte - je Arbeitsgang */
  const unbesetzteSchichten = {};
  /*
   * Schichtzahl je Arbeitsgang - WOCHENWEISE (Nutzerauftrag 25.09.2026:
   * Nachtschicht nur in Engpasswochen). `wochenSchichten` teilt Personen
   * schon korrekt wochenweise auf Schichten auf; hier muss dieselbe
   * wochenweise Sicht gelten, sonst haelt diese Stelle einen Arbeitsgang
   * noch fuer einschichtig, obwohl die Person laengst in Schicht 3
   * eingeteilt ist - Ergebnis waere "SCHICHT_OHNE_ARBEIT" trotz echter
   * Arbeit (gefunden bei der Nutzerpruefung 25.09.2026 an echten Daten:
   * 260 von 351 Personentagen "Leerlauf" kamen allein daher).
   */
  const schichtenJeOpCache = new Map();
  const schichtenJeOpVon = (wk) => {
    let v = schichtenJeOpCache.get(wk);
    if (!v) { v = schichtenJeArbeitsgangWoche(config, wk); schichtenJeOpCache.set(wk, v); }
    return v;
  };

  for (let dateIdx = 0; dateIdx < arbeitstage.length; dateIdx++) {
    const date = arbeitstage[dateIdx];
    const list = alloc.get(date) ?? [];
    const day = capOf.get(date);
    const hoursPerEmployee = Number(day?.hoursPerEmployee ?? 7.5) || 7.5;
    /*
     * FIX Mittel09 (Audit 20.09.2026): Produktivitaet gehoert ins
     * persoenliche Budget.
     *
     * Hier stand nur `factor * hoursPerEmployee` - die reine
     * Anwesenheitsdauer (7,5 h). Die Terminierung (engine/scheduler.js,
     * ctx.personRest) rechnet dieselbe Person aber mit Produktivitaets- UND
     * Einarbeitungsfaktor (rund 7 h). Beide Anzeigen muessen dieselbe
     * Stundenart verwenden - sonst bucht der Einsatzplan mehr, als die
     * Terminierung fuer diese Person vorgesehen hat.
     */
    const productivity = Number(day?.productivity ?? 1) || 1;
    const anwesend = people.filter((p) => personPresent(p, date));
    for (const p of people) {
      if (!personPresent(p, date)) byPerson[p.id].absentDays += 1;
    }

    /** Schicht je Person in DIESER Woche - innerhalb der Woche unveraendert */
    const schichtVon = schichtplan.zuordnung[weekKey(date)] ?? {};
    /** Schichtzahl je Arbeitsgang in DIESER Woche */
    const schichtenJeOp = schichtenJeOpVon(weekKey(date));
    /** @type {Record<string, number>} Restbudget je Person */
    const rest = {};
    for (const p of anwesend) {
      rest[p.id] = round2(personEffectiveFactor(config, p, date) * hoursPerEmployee * productivity);
    }
    /** Welche Arbeitsgaenge macht eine Person heute schon? */
    const heuteAn = {};
    /** Welche Personen stehen heute an einem Arbeitsgang? (Plaetze zaehlen) */
    const personenAn = {};
    /** Heute liegengebliebene Stunden je Arbeitsgang (fuer den Luecken-Report) */
    const restHeute = {};

    // Arbeit des Tages je Arbeitsgang zusammenfassen - ein Arbeitsgang mit
    // drei Auftraegen ist drei Positionen, aber dieselben Plaetze.
    const proOp = new Map();
    for (const a of list) {
      const e = proOp.get(a.opId) ?? { opId: a.opId, manHours: 0, posten: [] };
      e.manHours = round2(e.manHours + a.manHours);
      e.posten.push(a);
      proOp.set(a.opId, e);
    }

    // Knappste Qualifikation zuerst
    const sorted = [...proOp.values()].sort((a, b) => {
      const qa = anwesend.filter((p) => p.skills?.[a.opId]).length;
      const qb = anwesend.filter((p) => p.skills?.[b.opId]).length;
      if (qa !== qb) return qa - qb;
      return b.manHours - a.manHours;
    });

    /** @type {any[]} */
    const eintraege = [];
    for (const op of sorted) {
      const plaetzeJeSchicht = plaetzeAm(config, op.opId, day);
      /* So viele Schichten laeuft dieser Arbeitsgang */
      const opSchichten = Math.max(1, Math.floor(schichtenJeOp[op.opId] ?? 1));
      /*
       * Aushilfe (Nutzeranforderung 25.09.2026: "notfalls als Helfer bei
       * der Hydroprüfung oder Endkontrolle etc."): wie viele Stunden die
       * Terminierung heute an diesem Arbeitsgang bereits als Aushilfe
       * eingepreist hat (engine/scheduler.js, engine/capacity.js/
       * aushilfeVon). Dort ist es ein Platz-Mehraufwand ohne Namen - hier
       * bekommt er einen: eine sonst untaetige Person deckt ihn, statt
       * dass die Stunde als "Arbeit vergeben" liegen bleibt.
       */
      let hilfeRestHeute = day?.byOp?.[op.opId]?.aushilfeManHours ?? 0;
      for (const a of op.posten.sort((x, y) => y.manHours - x.manHours)) {
        let restStunden = a.manHours;
        const besetzt = (schluessel) => (personenAn[schluessel] ??= new Set());
        /*
         * Weist eine sonst KOMPLETT untaetige Person (heute noch nirgends
         * eingeteilt) als Helfer zu - ohne die Qualifikationsmatrix fuer
         * diesen Arbeitsgang, aber begrenzt auf das, was die Terminierung
         * bereits als Aushilfe-Mehraufwand eingepreist hat (hilfeRestHeute,
         * siehe capacity.js/aushilfeVon). Kein Ersatz fuer eine
         * qualifizierte Person - nur der ausdrueckliche "notfalls"-Fall.
         * @returns {boolean} ob eine Stunde gedeckt werden konnte
         */
        const versucheAushilfe = () => {
          if (hilfeRestHeute <= 0.01 || restStunden <= 0.01) return false;
          /*
           * FIX (Nutzervorgabe 23.09.2026, "die unter Mannschaft angegebene
           * Schicht ist maßgeblich für die Einteilung auf die
           * Arbeitsplätze"): Der reguläre Weg oben prüft schon, dass eine
           * Person nur in IHRER Schicht eingeteilt wird
           * (`(schichtVon[p.id] ?? 1) === sn`). Dieser Aushilfe-Zweig hat
           * das nicht getan - eine fuer Schicht 2 eingeteilte Person konnte
           * so als Helfer an einem Arbeitsgang landen, der nur in Schicht 1
           * laeuft (oder umgekehrt), obwohl beide zeitlich gar nicht
           * zusammentreffen. Die Person muss also in einer Schicht stehen,
           * in der dieser Arbeitsgang ueberhaupt laeuft.
           */
          const frei = anwesend.filter((p) => !heuteAn[p.id]?.length && (rest[p.id] ?? 0) > 0.01
            && (schichtVon[p.id] ?? 1) <= opSchichten);
          if (frei.length === 0) return false;
          frei.sort((x, y) => {
            const lx = byPerson[x.id].hours / Math.max(0.1, byPerson[x.id].factor);
            const ly = byPerson[y.id].hours / Math.max(0.1, byPerson[y.id].factor);
            if (Math.abs(lx - ly) > 0.01) return lx - ly;
            return x.id < y.id ? -1 : 1;
          });
          const p = frei[0];
          const nimm = round2(Math.min(rest[p.id], restStunden, hilfeRestHeute));
          if (nimm <= 0.01) return false;
          (heuteAn[p.id] ??= []).push(a.opId);
          rest[p.id] = round2(rest[p.id] - nimm);
          restStunden = round2(restStunden - nimm);
          hilfeRestHeute = round2(hilfeRestHeute - nimm);
          eintraege.push({
            personId: p.id, opId: a.opId, opName: OPERATION_BY_ID[a.opId]?.name ?? a.opId,
            projectId: a.projectId,
            orderNo: projectName.get(a.projectId) ?? a.projectId,
            hours: nimm,
            schicht: schichtVon[p.id] ?? 1,
            /** Ohne Qualifikationsmatrix, nur als Aushilfe eingesetzt */
            helfer: true,
          });
          const bp = byPerson[p.id];
          bp.hours = round2(bp.hours + nimm);
          bp.byOp[a.opId] = round2((bp.byOp[a.opId] ?? 0) + nimm);
          const wk = weekKey(date);
          bp.byWeek[wk] = round2((bp.byWeek[wk] ?? 0) + nimm);
          return true;
        };
        while (restStunden > 0.01) {
          /*
           * Die Schicht mit den meisten freien Leuten zuerst. Die
           * Platzgrenze gilt JE SCHICHT - fuenf Leute an einer Saege sind
           * auch in der Spaetschicht nicht moeglich.
           *
           * Ablösung bleibt erlaubt: Geht jemandem der Tag aus, uebernimmt
           * ein anderer denselben Platz in derselben Schicht. Ohne das
           * blieben 20 h Saegen ohne Namen - die Saege laeuft 7 h, die
           * eingeteilte Person hatte aber nur noch 3 h.
           */
          let beste = null;
          for (let sn = 1; sn <= opSchichten; sn++) {
            /*
             * Geteilter Platz (Nutzerauftrag 23.09.2026): Kehlnaht und
             * Stumpfnaht Orbital teilen sich dieselben Maschinen - wer dort
             * schon steht, blockiert denselben Platz auch fuer den jeweils
             * anderen Arbeitsgang. Der Schluessel gilt deshalb je
             * Kapazitaetstopf (capacityGroup), nicht je Arbeitsgang.
             */
            const gruppe = OPERATION_BY_ID[a.opId]?.capacityGroup ?? a.opId;
            const drauf = besetzt(`${gruppe}#${sn}`);
            const belegt = [...drauf].filter((id) => (rest[id] ?? 0) > 0.01).length;
            const frei = anwesend.filter((p) => p.skills?.[a.opId] && rest[p.id] > 0.01
              && (schichtVon[p.id] ?? 1) === sn
              && (drauf.has(p.id) || belegt < plaetzeJeSchicht));
            if (frei.length === 0) continue;
            if (beste === null || frei.length > beste.frei.length) beste = { sn, drauf, frei };
          }
          if (beste === null) {
            const gedeckt = versucheAushilfe();
            if (!gedeckt) break;
            continue;
          }
          const drauf = beste.drauf;
          const koennen = beste.frei;
          /*
           * Auswahl nach AUSLASTUNG, nicht nach absoluten Stunden: Stunden
           * geteilt durch Zeitanteil. Sonst bekaeme eine Halbtagskraft
           * genauso viele Stunden wie eine Vollzeitkraft - im ersten
           * Entwurf stand der Vorarbeiter mit 0,5 FTE bei denselben 442 h
           * wie alle anderen.
           */
          koennen.sort((x, y) => {
            /*
             * Skill-Rangfolge zuerst (Nutzerauftrag 23.09.2026: "Wenn MA xy
             * mit dem besten skill nicht da ist wird er durch denjenigen
             * mit dem nächst höheren ersetzt"). Wirkt nur auf die
             * Reihenfolge, nicht auf die Arbeitszeit - bei Gleichstand
             * entscheidet wie bisher die Auslastung.
             */
            const skillX = Number(x.skills?.[a.opId] ?? 0);
            const skillY = Number(y.skills?.[a.opId] ?? 0);
            if (skillX !== skillY) return skillY - skillX;
            const lx = byPerson[x.id].hours / Math.max(0.1, byPerson[x.id].factor);
            const ly = byPerson[y.id].hours / Math.max(0.1, byPerson[y.id].factor);
            if (Math.abs(lx - ly) > 0.01) return lx - ly;
            // Bei Gleichstand: lieber weiterarbeiten als den Platz wechseln
            const wx = drauf.has(x.id) ? 0 : (heuteAn[x.id] ? 2 : 1);
            const wy = drauf.has(y.id) ? 0 : (heuteAn[y.id] ? 2 : 1);
            if (wx !== wy) return wx - wy;
            return x.id < y.id ? -1 : 1;
          });
          const p = koennen[0];
          const nimm = round2(Math.min(rest[p.id], restStunden));
          if (nimm <= 0.01) break;
          drauf.add(p.id);
          (heuteAn[p.id] ??= []).push(a.opId);
          rest[p.id] = round2(rest[p.id] - nimm);
          restStunden = round2(restStunden - nimm);
          eintraege.push({
            personId: p.id, opId: a.opId, opName: OPERATION_BY_ID[a.opId]?.name ?? a.opId,
            projectId: a.projectId,
            orderNo: projectName.get(a.projectId) ?? a.projectId,
            hours: nimm,
            /** In welcher Schicht - 1 = frueh */
            schicht: beste.sn,
          });
          const bp = byPerson[p.id];
          bp.hours = round2(bp.hours + nimm);
          bp.byOp[a.opId] = round2((bp.byOp[a.opId] ?? 0) + nimm);
          const wk = weekKey(date);
          bp.byWeek[wk] = round2((bp.byWeek[wk] ?? 0) + nimm);
        }
        if (restStunden > 0.01) {
          offen = round2(offen + restStunden);
          restHeute[a.opId] = round2((restHeute[a.opId] ?? 0) + restStunden);
          unbesetzteSchichten[a.opId] = round2((unbesetzteSchichten[a.opId] ?? 0) + restStunden);
          eintraege.push({
            personId: null, opId: a.opId, opName: OPERATION_BY_ID[a.opId]?.name ?? a.opId,
            projectId: a.projectId,
            orderNo: projectName.get(a.projectId) ?? a.projectId,
            hours: round2(restStunden),
            schicht: null,
          });
          /*
           * Diagnose je Schicht: dieselben Bedingungen, die die
           * Vergabe-Schleife oben schon prueft (Qualifikation, Budget,
           * Schicht, Platz) - hier nur nicht als Filter, sondern als
           * Befund. Material/Vorgaenger tauchen hier nie auf: waeren sie
           * die Ursache, haette die Terminierung diese Stunde gar nicht
           * erst als ausfuehrbar eingestuft.
           */
          const jeSchicht = [];
          for (let sn = 1; sn <= opSchichten; sn++) {
            const inDerSchicht = anwesend.filter((p) => (schichtVon[p.id] ?? 1) === sn);
            const qualifiziert = inDerSchicht.filter((p) => p.skills?.[a.opId]);
            const mitBudget = qualifiziert.filter((p) => (rest[p.id] ?? 0) > 0.01);
            const schluessel = `${a.opId}#${sn}`;
            const platzBelegt = [...(personenAn[schluessel] ?? [])].filter((id) => (rest[id] ?? 0) > 0.01).length;
            jeSchicht.push({
              schicht: sn,
              anwesendInSchicht: inDerSchicht.length,
              qualifiziert: qualifiziert.length,
              qualifiziertMitBudget: mitBudget.map((p) => ({ id: p.id, restBudget: rest[p.id] })),
              platzGrenze: plaetzeJeSchicht,
              platzBelegt,
              grund: qualifiziert.length === 0
                ? 'KEINE_QUALIFIZIERTE_PERSON_IN_SCHICHT'
                : mitBudget.length === 0
                  ? 'BUDGET_DER_QUALIFIZIERTEN_AUSGESCHOEPFT'
                  : 'PLATZGRENZE_DER_SCHICHT_ERREICHT',
            });
          }
          /*
           * Der klarste, umsetzbare Befund: gab es in IRGENDEINER passenden
           * Schicht eine qualifizierte Person mit Restbudget, die nur an
           * der Platzgrenze scheiterte? Dann ist das eine echte Platzfrage
           * (ein weiterer Platz/eine weitere Schicht haette geholfen).
           * Sonst fehlte die Person selbst.
           */
          const hauptgrund = jeSchicht.some((s) => s.grund === 'PLATZGRENZE_DER_SCHICHT_ERREICHT')
            ? 'PLATZGRENZE_DER_SCHICHT_ERREICHT'
            : jeSchicht.every((s) => s.grund === 'KEINE_QUALIFIZIERTE_PERSON_IN_SCHICHT')
              ? 'KEINE_QUALIFIZIERTE_PERSON_IN_SCHICHT'
              : 'BUDGET_DER_QUALIFIZIERTEN_AUSGESCHOEPFT';
          luecken.push({
            date, weekKey: weekKey(date),
            projectId: a.projectId, orderNo: projectName.get(a.projectId) ?? a.projectId,
            opId: a.opId, opName: OPERATION_BY_ID[a.opId]?.name ?? a.opId,
            stunden: round2(restStunden),
            hauptgrund,
            jeSchicht,
          });
        }
      }
    }

    /*
     * Vorzug: wer nach alldem noch Restbudget hat, bekommt Arbeit von einem
     * SPAETEREN Tag vorgezogen - aber nur, wenn `heuteVorziehbar` (siehe
     * oben) das fuer genau diesen Arbeitsgang/Auftrag bestaetigt (Freigabe
     * UND alle Vorgaenger schon vor heute erledigt). Es wird von den
     * naechsten Tagen zuerst genommen (kein wilder Griff Wochen voraus),
     * und die Platzgrenze der EIGENEN Schicht gilt genauso wie oben - ein
     * Vorzug darf keinen Platz ueberbelegen.
     *
     * Nutzeranfrage 25.09.2026: 5 Werktage waren zu knapp bemessen - "Sägen
     * Entgraten Biegen kann auch weiter vorgezogen werden als 5 Tage, hier
     * sind auch 15 Tage möglich, solange die Arbeitsgang-Reihenfolge
     * eingehalten ist." Die Fensterlaenge selbst ist kein Sicherheitsrisiko
     * - `heuteVorziehbar` prueft Freigabe UND Vorgaenger unabhaengig davon,
     * wie weit der Zieltag entfernt liegt. Deshalb gilt die groessere Zahl
     * fuer ALLE Arbeitsgaenge einheitlich, nicht nur die drei genannten.
     */
    const VORZUG_FENSTER_TAGE = 15;
    if (extra.projects && extra.templates) {
      /*
       * Die Platzgrenze allein reicht nicht - sie prueft nur "wie viele
       * GLEICHZEITIG", nicht "wie viel INSGESAMT der Platz heute leisten
       * kann". Ohne eigene Deckelung wuerde der Vorzug so viele Leute
       * nacheinander an denselben Platz lassen, wie Restbudget da ist -
       * weit ueber das hinaus, was die Terminierung fuer diesen
       * Arbeitsgang HEUTE ueberhaupt an Kapazitaet vorsieht (z. B. eine
       * einzelne Saege mit 7,5 h Tageskapazitaet, aber zehn Personentage
       * vorgezogen). Deshalb wird je Arbeitsgang die noch freie
       * Tageskapazitaet (Kapazitaet minus schon heute genutzt) mitgefuehrt
       * und bei jedem Vorzug abgezogen - dieselbe Groesse, die auch die
       * Terminierung selbst als Grenze fuer den Tag kennt.
       */
      /** @type {Record<string, number>} */
      const freiJeOp = {};
      const freiFuer = (opId) => {
        if (!(opId in freiJeOp)) {
          const b = day?.byOp?.[opId];
          freiJeOp[opId] = Math.max(0, round2((b?.capManHours ?? 0) - (b?.usedManHours ?? 0)));
        }
        return freiJeOp[opId];
      };
      for (const p of anwesend) {
        const meineSchicht = schichtVon[p.id] ?? 1;
        for (let voraus = 1; voraus <= VORZUG_FENSTER_TAGE && (rest[p.id] ?? 0) > 0.01; voraus++) {
          const zielIdx = dateIdx + voraus;
          if (zielIdx >= arbeitstage.length) break;
          const zielDatum = arbeitstage[zielIdx];
          /*
           * Mindestgroesse fuer einen Vorzug (Nutzeranforderung erfuellt,
           * aber nicht um jeden Preis brauchbar): ohne Untergrenze wuerde
           * ein Restbudget von wenigen Minuten das letzte bisschen einer
           * fremden Position abgreifen - am Ende steht dann eine Person
           * mit einem Dutzend Mini-Schnipseln aus verschiedenen Auftraegen
           * im Plan, statt EINER sinnvollen Zusatzaufgabe. 0,5 h ist
           * dieselbe Rueckstandsschwelle, die auch `planeSchichten` fuer
           * "das zaehlt als echter Rueckstand" verwendet.
           */
          const MINDESTBLOCK = 0.5;
          const kandidaten = (allocUngefiltert.get(zielDatum) ?? [])
            .filter((a) => a.manHours > 0.01 && p.skills?.[a.opId] && freiFuer(a.opId) > 0.01
              && Math.floor(schichtenJeOp[a.opId] ?? 1) >= meineSchicht
              && heuteVorziehbar(a.opId, a.projectId, date))
            .sort((x, y) => y.manHours - x.manHours);
          for (const a of kandidaten) {
            if ((rest[p.id] ?? 0) <= 0.01) break;
            const gruppe = OPERATION_BY_ID[a.opId]?.capacityGroup ?? a.opId;
            const drauf = (personenAn[`${gruppe}#${meineSchicht}`] ??= new Set());
            const plaetzeJeSchicht = plaetzeAm(config, a.opId, day);
            const plaetzeJeSchichtMax = plaetzeMaxAm(config, a.opId, day);
            const belegt = [...drauf].filter((id) => (rest[id] ?? 0) > 0.01).length;
            if (!drauf.has(p.id) && belegt >= plaetzeJeSchichtMax) continue;
            const zusatzplatz = !drauf.has(p.id) && belegt >= plaetzeJeSchicht;
            const nimm = round2(Math.min(rest[p.id], a.manHours, freiFuer(a.opId)));
            if (nimm < MINDESTBLOCK && nimm < (rest[p.id] ?? 0) - 0.01) continue;
            if (nimm <= 0.01) continue;
            drauf.add(p.id);
            (heuteAn[p.id] ??= []).push(a.opId);
            rest[p.id] = round2(rest[p.id] - nimm);
            freiJeOp[a.opId] = round2(freiJeOp[a.opId] - nimm);
            // Von der ZIEL-Allokation (spaeterer Tag) abziehen - keine doppelte Zaehlung.
            a.manHours = round2(a.manHours - nimm);
            eintraege.push({
              personId: p.id, opId: a.opId, opName: OPERATION_BY_ID[a.opId]?.name ?? a.opId,
              projectId: a.projectId,
              orderNo: projectName.get(a.projectId) ?? a.projectId,
              hours: nimm,
              /** Kurzfristig ueber die normale Platzgrenze hinaus, siehe plaetzeMaxAm oben */
              zusatzplatz: zusatzplatz || undefined,
              schicht: meineSchicht,
              /** Vorgezogen von einem spaeteren Tag, siehe Kommentar oben */
              vorgezogen: true,
              vonDatum: zielDatum,
            });
            const bp = byPerson[p.id];
            bp.hours = round2(bp.hours + nimm);
            bp.byOp[a.opId] = round2((bp.byOp[a.opId] ?? 0) + nimm);
            const wk = weekKey(date);
            bp.byWeek[wk] = round2((bp.byWeek[wk] ?? 0) + nimm);
          }
        }
      }
    }

    /*
     * Wer anwesend ist und nichts bekommt, braucht einen GRUND. Genau das
     * war die Rueckfrage ("MAAP wird an manchen Tagen gar nicht geplant,
     * obwohl anwesend"): Ohne Grund sieht es nach einem Fehler aus, auch
     * wenn schlicht kein Platz frei war.
     */
    const ohneArbeit = [];
    for (const p of anwesend) {
      if (heuteAn[p.id]?.length) continue;
      const konnte = [...proOp.values()].filter((op) => p.skills?.[op.opId]);
      const meineSchicht = schichtVon[p.id] ?? 1;
      /* Laeuft ueberhaupt ein Arbeitsgang in MEINER Schicht, den ich darf? */
      const inMeinerSchicht = konnte.filter(
        (op) => Math.max(1, Math.floor(schichtenJeOp[op.opId] ?? 1)) >= meineSchicht);
      /*
       * "Kein Platz frei" war zu oft die falsche Antwort.
       *
       * Unterschieden wird jetzt:
       *   KEIN_PLATZ_FREI   heute blieb Arbeit liegen, die niemand mehr
       *                     annehmen konnte -> Plaetze/Schichten helfen
       *   ARBEIT_VERTEILT   alles Freigegebene ist vergeben -> es fehlt
       *                     freigegebene Arbeit, kein Platz
       */
      const bliebLiegen = inMeinerSchicht.some((op) => (restHeute[op.opId] ?? 0) > 0.01);
      const grund = proOp.size === 0
        ? 'KEINE_ARBEIT'
        : konnte.length === 0
          ? 'KEINE_QUALIFIKATION'
          : inMeinerSchicht.length === 0
            ? 'SCHICHT_OHNE_ARBEIT'
            : bliebLiegen
              ? 'KEIN_PLATZ_FREI'
              : 'ARBEIT_VERTEILT';
      /*
       * Wartet an einem meiner Arbeitsgaenge Arbeit, die heute nicht
       * beginnen durfte? Dann steht hier, WORAN sie haengt - das ist die
       * Antwort auf "warum bekomme ich nichts zu tun".
       */
      let warteUrsache = null;
      if (grund === 'ARBEIT_VERTEILT') {
        const meine = new Set(konnte.map((op) => op.opId));
        const wartend = {};
        for (const b of stauAm.get(date) ?? []) {
          if (!meine.has(b.opId)) continue;
          wartend[b.cause] = round2((wartend[b.cause] ?? 0) + b.manHours);
        }
        const top = Object.entries(wartend).sort((x, y) => y[1] - x[1])[0];
        if (top) warteUrsache = { ursache: LIMITER_LABEL[top[0]] ?? top[0], stunden: top[1] };
      }
      ohneArbeit.push({
        id: p.id,
        grund,
        schicht: meineSchicht,
        arbeitsgaenge: konnte.map((op) => op.opId),
        stunden: round2(rest[p.id] ?? 0),
        /** Nur bei ARBEIT_VERTEILT: woran die wartende Arbeit haengt */
        warteUrsache,
      });
      byPerson[p.id].idleDays = (byPerson[p.id].idleDays ?? 0) + 1;
      byPerson[p.id].idleReasons = byPerson[p.id].idleReasons ?? {};
      byPerson[p.id].idleReasons[grund] = (byPerson[p.id].idleReasons[grund] ?? 0) + 1;
    }

    tage.push({
      date,
      weekKey: weekKey(date),
      hoursPerEmployee: round2(hoursPerEmployee),
      entries: eintraege,
      /** Anwesend, aber ohne Arbeit - mit Grund */
      idle: ohneArbeit,
      /** Schicht je Person in dieser Woche (wochenweise, nie tageweise) */
      schichten: schichtVon,
      absent: people.filter((p) => !personPresent(p, date)).map((p) => ({ id: p.id, kind: absenceOn(p, date)?.kind ?? '' })),
    });
  }

  /** Gesamtstunden je Ablehnungsgrund - schneller Ueberblick vor den Einzelfaellen */
  const lueckenJeGrund = {};
  for (const l of luecken) lueckenJeGrund[l.hauptgrund] = round2((lueckenJeGrund[l.hauptgrund] ?? 0) + l.stunden);
  /** Fehlende Besetzung je KW und Arbeitsgang */
  const lueckenJeWocheUndOpMap = {};
  for (const l of luecken) {
    const schluessel = `${l.weekKey}|${l.opId}`;
    const e = (lueckenJeWocheUndOpMap[schluessel] ??= {
      weekKey: l.weekKey, opId: l.opId, opName: l.opName, stunden: 0,
    });
    e.stunden = round2(e.stunden + l.stunden);
  }

  return {
    days: tage,
    people: Object.values(byPerson),
    /** Stunden, fuer die es niemanden in der Mannschaft gibt */
    unassignedHours: round2(offen),
    /** Schichten je Arbeitsgang und die wochenweise Zuordnung */
    schichtplan: {
      maxSchichten: schichtplan.maxSchichten,
      /** Hoechste Schichtzahl je Arbeitsgang, ueber den ganzen Zeitraum (informativ) */
      jeArbeitsgang: schichtplan.schichten,
      jeWoche: schichtplan.zuordnung,
      schichtStunden: SCHICHT_STUNDEN,
    },
    /** Stunden, die eine Schicht nicht besetzen konnte - je Arbeitsgang */
    unbesetzteSchichten,
    /**
     * Luecken-Report: ungedeckter Bedarf mit konkretem, nachpruefbarem
     * Ablehnungsgrund je Stunde. Ersetzt keine Kapazitaetsrechnung - zeigt
     * nur, woran eine von der Terminierung als ausfuehrbar eingestufte
     * Stunde in der Einsatzplanung tatsaechlich gescheitert ist.
     */
    luecken,
    lueckenJeGrund,
    lueckenJeWocheUndOp: Object.values(lueckenJeWocheUndOpMap),
  };
}

/**
 * Wie viele Personen koennen an diesem Arbeitsgang heute gleichzeitig
 * arbeiten? Ein Platz, eine Person - beim Orbitalschweissen begrenzen die
 * Maschinen ueber "Maschinen je Schweisser" die Zahl der Schweisser.
 * @param {any} config @param {string} opId @param {any} day Tagesreihe
 */
function plaetzeAm(config, opId, day) {
  if (opId === 'ORBITAL_KEHLNAHT' || opId === 'ORBITAL_STUMPFNAHT') {
    // Die Maschinen begrenzen die Schweisser: ein Schweisser bedient
    // mehrere Maschinen, mehr Schweisser bringen also nichts. Kehlnaht und
    // Stumpfnaht teilen sich denselben Maschinen-Topf (siehe oben, geteilter
    // Platz-Schluessel).
    const nutzbar = Number(day?.resources?.orbitalMachinesUsable
      ?? placesFor(config, 'ORBITAL') ?? 0);
    const jeSchweisser = Math.max(1, Number(config.resources?.machinesPerWelder ?? 2));
    return Math.max(1, Math.ceil(nutzbar / jeSchweisser));
  }
  const plaetze = placesFor(config, opId);
  /*
   * Ohne Platzgrenze begrenzt nur die Mannschaft. Und: An einem Platz
   * koennen mehrere arbeiten - bei Vormontage und Endkontrolle sind es
   * zwei (workersPerPlace). Das fehlte im ersten Entwurf, dadurch blieben
   * 113 h Endkontrolle ohne Namen, obwohl Leute frei waren.
   */
  if (plaetze == null || !Number.isFinite(Number(plaetze))) return Number.MAX_SAFE_INTEGER;
  const jePlatz = Math.max(1, Number(workersPerPlace(config, opId) ?? 1));
  return Math.max(1, Math.floor(Number(plaetze) * jePlatz));
}

/**
 * Wie viele Personen koennten hoechstens gleichzeitig arbeiten, wenn
 * KURZFRISTIG ein weiterer Platz eingerichtet wird - "ein zweiter ist bei
 * Bedarf einrichtbar" (Nutzeranfrage 25.09.2026: "Es kann kurzfristig ein
 * 2. Sägeplatz aktiviert werden ... Somit kann kein Platzmangel mehr
 * vorkommen"). Nur als LETZTER Ausweg im Vorzug (siehe dort) gedacht, um
 * echten Leerlauf zu vermeiden - keine dauerhafte Kapazitaetsplanung
 * (dafuer gibt es den Mehraufwand/"zweiter Platz" als eigene Massnahme).
 * Ops ohne hinterlegtes `maxPlaces` (z. B. die Orbital-Maschinen, die man
 * nicht einfach dazustellt) bleiben bei der normalen Platzgrenze.
 * @param {any} config @param {string} opId @param {any} day
 */
function plaetzeMaxAm(config, opId, day) {
  const maxPlaces = Number(config.resources?.byOperation?.[opId]?.maxPlaces ?? 0);
  const plaetze = placesFor(config, opId);
  if (maxPlaces <= 0 || plaetze == null || !Number.isFinite(Number(plaetze))
    || maxPlaces <= Number(plaetze)) {
    return plaetzeAm(config, opId, day);
  }
  const jePlatz = Math.max(1, Number(workersPerPlace(config, opId) ?? 1));
  return Math.max(1, Math.floor(maxPlaces * jePlatz));
}

/**
 * Wochenplan einer Person: je Tag, welcher Auftrag und welcher Arbeitsgang.
 * @param {any} plan Ergebnis von assignPeople
 * @param {string} personId
 * @param {string} wk Kalenderwoche, z. B. '2026-W38'
 */
export function personWeek(plan, personId, wk) {
  const tage = plan.days.filter((d) => d.weekKey === wk);
  return tage.map((d) => ({
    date: d.date,
    absent: d.absent.find((a) => a.id === personId) ?? null,
    entries: d.entries
      .filter((e) => e.personId === personId)
      .map((e) => ({ ...e, opName: OPERATION_BY_ID[e.opId]?.name ?? e.opId })),
    hours: round2(d.entries.filter((e) => e.personId === personId).reduce((a, e) => a + e.hours, 0)),
  }));
}
