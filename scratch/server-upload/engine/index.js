/**
 * Oeffentliche Schnittstelle der Planungsengine.
 *
 * Die Engine ist vollstaendig unabhaengig von der Benutzeroberflaeche
 * (§86) und kann eigenstaendig automatisiert getestet werden.
 */

export * from './model.js';
export * from './calendar.js';
export * from './defaults.js';
export * from './capacity.js';
export * from './routing.js';
export * from './scheduler.js';
export * from './demand.js';
export * from './kpi.js';
export * from './rootcause.js';
export * from './validation.js';
export * from './scenario.js';
export * from './auth.js';
export * from './rules.js';
export * from './optimizer.js';
export * from './seed.js';
export * from './team.js';
export * from './schichtplan.js';
export * from './costs.js';
export * from './verfuegbarkeit.js';
export * from './assignment.js';
export * from './plausibilitaet.js';
export * from './anwesenheitsmatrix.js';
export * from './belegung.js';
export * from './mehraufwand.js';

import { runSchedule } from './scheduler.js';
import { computeDemand, aggregateWeeks, weekList } from './demand.js';
import { dashboardKpis, processBalance, orbitalReport, processUtilization, workplaceLoad, missingStaffPerWeek, missingQualification, capacityDerivation } from './kpi.js';
import { rootCauses, bottleneckByOperation } from './rootcause.js';
import { validate, validationSummary } from './validation.js';
import { materialize } from './scenario.js';
import { teamOn, shiftCapability } from './team.js';
import { costRates, overtimeVersusTemp } from './costs.js';
import { pruefePlausibilitaet } from './plausibilitaet.js';
import { OPERATIONS, round2 } from './model.js';
import { cmpDate } from './calendar.js';

/**
 * Vollstaendige Analyse eines Szenarios.
 *
 * @param {any} dataset
 * @param {string} scenarioId
 * @param {{from?:string, to?:string}} [range] Auswertungszeitraum
 */
export function analyze(dataset, scenarioId, range = {}) {
  const input = materialize(dataset, scenarioId);
  const result = runSchedule(input);
  const demand = computeDemand(input, result.dates);
  const weeks = aggregateWeeks(result.daySeries, demand);
  const kpis = dashboardKpis(result, weeks);
  const causes = rootCauses(result);
  const issues = validate(input);

  /** @type {string|null} */
  let lastRelevant = null;
  for (const p of result.projects) {
    const d = p.forecastFinish || p.dueDate;
    if (d && (!lastRelevant || cmpDate(d, lastRelevant) > 0)) lastRelevant = d;
  }
  lastRelevant ??= result.horizonEnd;

  /*
   * Standardzeitraum = AUFTRAGSHORIZONT, nicht Rechenhorizont.
   *
   * Der Rechenhorizont laeuft bis zur letzten Prognose (im
   * Startdatenbestand KW 17/2027), die Auftraege enden aber in KW 05/2027.
   * Ohne diese Grenze bewertete die Anwendung zwoelf Wochen ohne einen
   * einzigen Auftrag - und wies dort 4.909 h als freie Kapazitaet aus.
   * Vorgabe der Abteilungsleitung (18.09.2026): "Die APP soll immer nur den
   * angewaehlten Zeitraum bewerten"; ohne Anwahl ist das der Zeitraum, in
   * dem es Arbeit gibt.
   */
  let letzterTermin = null;
  for (const p of result.projects) {
    if (!p.dueDate) continue;
    if (Number(p.remainingManHours ?? 0) <= 0) continue;
    if (!letzterTermin || cmpDate(p.dueDate, letzterTermin) > 0) letzterTermin = p.dueDate;
  }
  const from = range.from ?? input.config.planningDate;
  const to = range.to ?? letzterTermin ?? lastRelevant;

  /*
   * DER ANGEWAEHLTE ZEITRAUM GILT UEBERALL.
   *
   * Vorgabe der Abteilungsleitung (18.09.2026): "Die APP soll immer nur den
   * angewaehlten Zeitraum bewerten."
   *
   * Vorher war das halb umgesetzt: Die Auslastung je Arbeitsgang
   * (processBalance) hielt sich an den Zeitraum, aber Wochenuebersicht,
   * Kennzahlen, Plausibilitaetspruefung und Belegungsgitter liefen bis zum
   * letzten Prognosetermin - also oft weit darueber hinaus. Dadurch
   * bewertete die Anwendung Wochen, die niemand angewaehlt hatte; im
   * Startdatenbestand 12 Wochen ohne einen einzigen Auftrag.
   *
   * Jetzt wird EIN Fenster gebildet und an jede Auswertung durchgereicht.
   */
  const weekRows = weekList(weeks).filter((w) => cmpDate(w.from, to) <= 0
    && cmpDate(w.to ?? w.from, from) >= 0);
  /** Kennzahlen des angewaehlten Zeitraums */
  const kpisImFenster = dashboardKpis(result, Object.fromEntries(
    Object.entries(weeks).filter(([, w]) => cmpDate(w.from, to) <= 0
      && cmpDate(w.to ?? w.from, from) >= 0)), { from, to });

  return {
    scenario: {
      id: input.scenario.id,
      name: input.scenario.name,
      description: input.scenario.description,
      isBaseline: !!input.scenario.isBaseline,
    },
    config: input.config,
    planningDate: input.config.planningDate,
    horizonEnd: result.horizonEnd,
    relevantUntil: lastRelevant,
    /** Letzte Fertigstellung mit offener Arbeit - der Auftragshorizont */
    orderHorizon: letzterTermin,
    projects: result.projects,
    days: trimDays(result.daySeries, demand, from, to),
    /** Tagesreihe ueber den ganzen Rechenhorizont - fuer Terminplan und Gantt */
    daysHorizont: trimDays(result.daySeries, demand, from, lastRelevant),
    weeks: weekRows,
    missingStaff: missingStaffPerWeek(weekRows, input.config),
    /** Welche Qualifikation fehlt wie oft (statt nur "5 MA fehlen") */
    missingQualification: missingQualification(result, input.config),
    /** Mannschaft: Staerke, Schichtfaehigkeit, Qualifizierte je Arbeitsgang */
    team: teamSummary(input.config),
    /** Kostensaetze mit Zuschlaegen - nur Ausweis, nie Optimierungsziel */
    costs: { ...costRates(input.config), comparison: overtimeVersusTemp(input.config) },
    /** Woher die Besetzung je Tag kommt und was daran auffaellt */
    staffing: staffingReport(input.config, result),
    workplaceLoad: workplaceLoad(result, input.workplaces, weekRows),
    kpis: kpisImFenster,
    /** Kennzahlen ueber den ganzen Rechenhorizont - nur zum Vergleich */
    kpisHorizont: kpis,
    /** Der Zeitraum, auf den sich ALLE Zahlen dieser Antwort beziehen */
    range: { from, to, weeks: weekRows.length },
    processBalance: processBalance(result, demand, from, to),
    /** Rechenweg der Kapazitaet - welcher Zeitraum, welche Bestandteile */
    capacityDerivation: capacityDerivation(input.config, result.daySeries, to, from),
    processUtilization: OPERATIONS.map((o) => processUtilization(result, o.id, to, from)),
    orbital: orbitalReport(result, to, from),
    rootCauses: causes,
    bottleneckByOperation: bottleneckByOperation(result),
    validation: { issues, summary: validationSummary(issues) },
    /**
     * Plausibilitaetspruefung: was an DIESEM Ergebnis komisch aussieht.
     * Ausdruecklicher Auftrag der Abteilungsleitung - die Anwendung soll
     * warnen, statt eine schoene Zahl zu zeigen.
     */
    plausibility: pruefePlausibilitaet(input, result,
      { weeks: weekRows, kpis: kpisImFenster, range: { from, to } }),
    /*
     * Der Mehraufwand steckt BEWUSST nicht hier drin, obwohl er dazugehoert.
     * Er rechnet mehrere Kapazitaetsdurchgaenge ueber 13 Wochen und wuerde
     * die Analyse von 250 auf 500 ms bringen - bei jeder Reglerbewegung.
     * Die Ansicht holt ihn ueber `api.mehraufwand(...)` einzeln nach.
     */
    gantt: buildGantt(result),
    runtimeMs: result.runtimeMs,
  };
}

/**
 * Woher die Besetzung kommt - und was daran auffaellt.
 *
 * Drei Quellen sind moeglich: die gemessene Tagesliste der
 * Abteilungsleitung, die Mannschaftsliste und die alten Wochenzahlen.
 * Die Anwendung sagt hier ausdruecklich, welcher Tag aus welcher Quelle
 * kommt - sonst waere nicht nachvollziehbar, warum eine Woche 6 und die
 * naechste 8,5 Mitarbeiter hat.
 */
function staffingReport(config, result) {
  const tage = result.daySeries.filter((d) => d.kind !== 'OFF');
  const zaehler = { TAGESLISTE: 0, MANNSCHAFT: 0, WOCHENZAHLEN: 0 };
  let messwerte = [];
  let annahmen = [];
  for (const d of tage) {
    const quelle = d.headcountDetail?.source ?? 'WOCHENZAHLEN';
    zaehler[quelle] = (zaehler[quelle] ?? 0) + 1;
    const koepfe = Number(d.headcountDetail?.effective ?? d.headcount ?? 0);
    if (quelle === 'TAGESLISTE') messwerte.push(koepfe); else annahmen.push(koepfe);
  }
  const mittel = (list) => (list.length ? round2(list.reduce((a, b) => a + b, 0) / list.length) : null);
  const gemessen = mittel(messwerte);
  const angenommen = mittel(annahmen);
  const letzterMesstag = [...tage].reverse().find((d) => d.headcountDetail?.source === 'TAGESLISTE')?.date ?? null;

  const hinweise = [];
  if (gemessen != null && angenommen != null && angenommen > gemessen + 0.4) {
    hinweise.push({
      art: 'BESETZUNG',
      text: `Gemessen waren im Schnitt ${gemessen} Mitarbeiter verfügbar, für die Zeit ohne Messwerte `
        + `rechnet die Planung mit ${angenommen}. Das sind ${round2(angenommen - gemessen)} mehr, `
        + 'als in der Wirklichkeit zuletzt da waren – bis Urlaub und Abwesenheiten in der Mannschaft '
        + 'gepflegt sind, ist der Plan zu optimistisch.',
    });
  }
  if (letzterMesstag && zaehler.TAGESLISTE > 0) {
    hinweise.push({
      art: 'MESSWERTE',
      text: `Gemessene Tageswerte liegen bis ${letzterMesstag} vor (${zaehler.TAGESLISTE} Arbeitstage). `
        + 'Danach rechnet die Anwendung mit der Mannschaftsliste.',
    });
  }
  return {
    bySource: zaehler,
    measuredAverage: gemessen,
    assumedAverage: angenommen,
    lastMeasuredDay: letzterMesstag,
    notes: hinweise,
  };
}

/**
 * Kurzfassung der Mannschaft fuer die Oberflaeche.
 * Ohne gepflegte Mannschaft: null (dann gilt weiter die Zahlenrechnung).
 */
function teamSummary(config) {
  const people = config.workforce?.team?.people;
  if (!Array.isArray(people) || people.length === 0) return null;
  const on = teamOn(config, config.planningDate);
  const shifts = shiftCapability(config);
  return {
    source: config.workforce.team.source ?? 'ZAHLEN',
    enforceSkills: config.workforce.team.enforceSkills !== false,
    heads: on.heads,
    factor: on.factor,
    shiftCapable: shifts.capable,
    /**
     * Bezugsgroesse zu shiftCapable: alle eingeplanten Personen.
     * `heads` waere hier falsch - das sind die am Stichtag ANWESENDEN,
     * eine andere Menge ("12 von 9 Mitarbeitern" ist kein Satz).
     */
    shiftTotal: shifts.total,
    shiftBlocked: shifts.blockedIds,
    byOperation: OPERATIONS.map((op) => ({
      opId: op.id,
      name: op.name,
      qualified: on.byOp[op.id]?.heads ?? 0,
      ids: on.byOp[op.id]?.ids ?? [],
      share: on.factor > 0 ? round2(((on.byOp[op.id]?.factor ?? 0) / on.factor) * 100) : 0,
    })),
  };
}

/** Tagesreihe auf den relevanten Zeitraum begrenzen und Bedarf ergaenzen. */
function trimDays(daySeries, demand, from, to) {
  return daySeries
    .filter((d) => cmpDate(d.date, from) >= 0 && cmpDate(d.date, to) <= 0)
    .map((d) => ({
      date: d.date,
      kind: d.kind,
      weekKey: d.weekKey,
      capacity: d.poolCapacity,
      planned: d.poolUsed,
      demand: round2(demand?.[d.date]?.total ?? 0),
      headcount: d.headcount,
      saturdayHeadcount: d.saturdayHeadcount,
      productivity: d.productivity,
      activeProjects: d.activeProjects,
      resources: d.resources,
      byOp: Object.fromEntries(Object.entries(d.byOp).map(([k, v]) => [k, {
        ...v, demandManHours: round2(demand?.[d.date]?.byOp?.[k] ?? 0),
      }])),
    }));
}

/** Gantt-Daten: Projekt mit Arbeitsgaengen als Unterebene (§62/§63). */
export function buildGantt(result) {
  return result.projects.map((p) => ({
    id: p.id,
    orderNo: p.orderNo,
    customer: p.customer,
    name: p.name,
    projectType: p.projectType,
    variant: p.variant,
    priority: p.priority,
    status: p.status,
    dueDate: p.dueDate,
    forecastFinish: p.forecastFinish,
    releaseDate: p.releaseDate,
    start: p.start,
    lateDays: p.lateDays,
    operations: p.operations
      .filter((o) => o.totalUnits > 0)
      .map((o) => ({
        opId: o.opId, name: o.name, start: o.start, end: o.end,
        totalUnits: o.totalUnits, remainingUnits: o.remainingUnits,
        plannedManHours: o.plannedManHours, unit: o.unit,
      })),
  }));
}
