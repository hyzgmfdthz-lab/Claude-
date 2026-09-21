/**
 * Loesungsvorschlaege und automatische Optimierung (§65-§68, §72).
 *
 * Verfahren: engpassorientierte, gierige Suche (Greedy mit Bewertung je
 * Vollsimulation). Es werden ausschliesslich VORSCHLAEGE erzeugt - die
 * Uebernahme in die Daten erfolgt erst nach ausdruecklicher Freigabe
 * durch den Anwender (§44).
 */

import { deepClone, round1, round2, OPERATION_BY_ID } from './model.js';
import { runSchedule } from './scheduler.js';
import { computeDemand, aggregateWeeks, weekList } from './demand.js';
import { dashboardKpis } from './kpi.js';
import { LIMITER } from './capacity.js';
import { weekStart, mondayOf, addWeeks, weekKey, formatDE } from './calendar.js';
import { mitZusatzPersonal } from './team.js';

export const OBJECTIVES = {
  MAX_OTD: 'Maximale Termintreue (OTD)',
  MIN_LATE_PROJECTS: 'Minimale Anzahl verspäteter Projekte',
  MIN_TOTAL_DELAY: 'Minimale Gesamtverspätung',
  MIN_STAFF: 'Minimaler zusätzlicher Personaleinsatz',
  MIN_SATURDAY: 'Minimale Samstagsarbeit',
};

/**
 * Fuehrt eine vollstaendige Bewertung einer Konfiguration durch.
 * @param {any} input {config, projects, templates}
 */
export function evaluate(input) {
  const result = runSchedule(input);
  const demand = computeDemand(input, result.dates);
  const weeks = aggregateWeeks(result.daySeries, demand);
  const kpis = dashboardKpis(result, weeks);
  return { result, demand, weeks, kpis };
}

/* ------------------------------------------------------------------ *
 * Massnahmen
 * ------------------------------------------------------------------ */

/**
 * Erzeugt die Massnahmenkandidaten passend zum erkannten Engpass.
 * @param {any} evaluation
 * @param {any} config
 * @param {{allowed?:string[]}} [options]
 */
export function generateMeasures(evaluation, config, options = {}) {
  const allowed = options.allowed ?? ['TEMP', 'OVERTIME', 'SATURDAY', 'HEFT_PLACE', 'PLACE', 'WELDER', 'MACHINE', 'SEQUENCE', 'NOBO', 'PROJECT_STAFF', 'HIRE', 'WINDOW', 'WIP'];
  const kpis = evaluation.kpis;
  const causes = Object.fromEntries((kpis.bottleneckRanking ?? []).map((c) => [c.cause, c.manHours]));
  const measures = [];

  const overloadWeeks = weekList(evaluation.weeks)
    .filter((w) => w.overload > 0.5 || w.utilization > 0.95)
    .slice(0, 8);
  const firstWeek = kpis.firstOverloadWeek ?? overloadWeeks[0]?.weekKey ?? weekKey(config.planningDate);
  const startDate = mondayOf(weekStart(firstWeek));
  const shortWeek = (k) => `KW${String(k).slice(-2)}`;

  const generalShortage = (causes[LIMITER.POOL] ?? 0) + (causes[LIMITER.SKILL] ?? 0) + (causes[LIMITER.PROJECT_LIMIT] ?? 0);

  if (allowed.includes('TEMP') && generalShortage > 1) {
    for (const n of [2, 3, 4, 6]) {
      measures.push({
        type: 'TEMP',
        id: `TEMP_${n}_${firstWeek}`,
        label: `+${n} Leiharbeiter ab ${shortWeek(firstWeek)}`,
        description: `${n} Leiharbeiter ab ${formatDE(startDate)} (mit hinterlegter Einarbeitungskurve).`,
        cost: { staff: n, weeks: 1 },
        /*
         * Personal kommt ausschliesslich ueber die Mannschaft in die
         * Rechnung (Vorgabe 17.09.2026). Hier wird nur DURCHGESPIELT, was
         * zusaetzliche Leute braechten - auf einer Kopie. Die Zahlenlisten
         * bleiben der Rueckfallebene vorbehalten.
         */
        apply: (cfg) => {
          if (cfg.workforce?.team?.source === 'MANNSCHAFT') {
            return mitZusatzPersonal(cfg, n, startDate, { label: `Optimierung: +${n} Leiharbeiter` });
          }
          const c = deepClone(cfg);
          c.workforce.tempWorkers = [...(c.workforce.tempWorkers ?? []), {
            id: `OPT-TEMP-${n}-${firstWeek}`, label: `Optimierung: +${n} Leiharbeiter`,
            count: n, from: startDate, to: null, skills: null,
          }];
          return c;
        },
      });
    }
  }

  if (allowed.includes('HIRE') && generalShortage > 1) {
    const max = Number(config.workforce?.maxNewHires ?? 5);
    for (const n of [2, Math.min(5, max)]) {
      if (n <= 0 || n > max) continue;
      measures.push({
        type: 'HIRE',
        id: `HIRE_${n}_${firstWeek}`,
        label: `+${n} Neueinstellungen ab ${shortWeek(firstWeek)}`,
        description: `${n} Neueinstellungen ab ${formatDE(startDate)} (mit Einarbeitungskurve, max. ${max}).`,
        cost: { staff: n, permanent: n },
        apply: (cfg) => {
          if (cfg.workforce?.team?.source === 'MANNSCHAFT') {
            return mitZusatzPersonal(cfg, n, startDate, {
              kind: 'NEU', label: `Optimierung: +${n} Neueinstellungen`,
            });
          }
          const c = deepClone(cfg);
          c.workforce.newHires = [...(c.workforce.newHires ?? []), {
            id: `OPT-HIRE-${n}-${firstWeek}`, label: `Optimierung: +${n} Neueinstellungen`,
            count: n, from: startDate, skills: null,
          }];
          return c;
        },
      });
    }
  }

  if (allowed.includes('OVERTIME') && generalShortage > 1) {
    for (const h of [1, 2, 3, 5]) {
      if (h <= Number(config.workforce?.overtimePerEmployeeDefault ?? 0)) continue;
      measures.push({
        type: 'OVERTIME',
        id: `OT_${h}`,
        label: `+${h} Überstunden je MA und Woche`,
        description: `Überstunden von ${config.workforce?.overtimePerEmployeeDefault ?? 0} h auf ${h} h je Mitarbeiter und Woche.`,
        cost: { overtime: h },
        apply: (cfg) => {
          const c = deepClone(cfg);
          c.workforce.overtimePerEmployeeDefault = h;
          return c;
        },
      });
    }
  }

  if (allowed.includes('SATURDAY') && overloadWeeks.length > 0) {
    for (const n of [1, 2, 4]) {
      const wks = overloadWeeks.slice(0, n).map((w) => w.weekKey);
      if (wks.length < n) continue;
      const alreadyOn = wks.every((k) => config.saturday?.weeks?.[k]?.enabled);
      if (alreadyOn) continue;
      measures.push({
        type: 'SATURDAY',
        id: `SA_${wks.join('_')}`,
        label: `Samstagsarbeit ${wks.map(shortWeek).join(' + ')}`,
        description: `Samstagsarbeit (${config.workTime?.saturdayHours ?? 6} h, ${Math.round((config.saturday?.quota ?? 0.2) * 100)} % der Mitarbeiter) in ${wks.map(shortWeek).join(', ')}.`,
        cost: { saturdays: wks.length },
        apply: (cfg) => {
          const c = deepClone(cfg);
          c.saturday.weeks = { ...(c.saturday.weeks ?? {}) };
          for (const k of wks) c.saturday.weeks[k] = { ...(c.saturday.weeks[k] ?? {}), enabled: true };
          return c;
        },
      });
    }
  }

  // Versetzte Besetzung: laengeres Betriebszeitfenster der Plaetze und Maschinen.
  // Wirkt nur bei platz- oder maschinengebundenen Engpaessen.
  const placeBound = (causes[LIMITER.HEFTPLATZ] ?? 0) + (causes[LIMITER.ORBITAL_MACHINE] ?? 0)
    + (causes[LIMITER.HYDRO_STATION] ?? 0) + (causes[LIMITER.BEIZ_STATION] ?? 0);
  if (allowed.includes('WINDOW') && placeBound > 1) {
    const dayHours = Number(config.workTime?.regularHoursPerWeek ?? 37.5) / Math.max(1, (config.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);
    const current = Number(config.resources?.operatingHoursPerDay ?? dayHours) || dayHours;
    for (const hours of [10, 12, 14]) {
      if (hours <= current) continue;
      measures.push({
        type: 'WINDOW',
        id: `WINDOW_${hours}`,
        label: `Betriebszeitfenster ${hours} h je Tag (versetzte Besetzung)`,
        description: `Arbeitsplätze und Maschinen durch versetzte Besetzung bis ${hours} h je Tag belegen `
          + `(bisher ${Math.round(current * 10) / 10} h). Die Arbeitszeit der einzelnen Mitarbeiter bleibt unverändert.`,
        cost: { organisation: 2 },
        apply: (cfg) => { const c = deepClone(cfg); c.resources.operatingHoursPerDay = hours; return c; },
      });
    }
  }

  if (allowed.includes('HEFT_PLACE') && (causes[LIMITER.HEFTPLATZ] ?? 0) > 1) {
    const cur = Number(config.resources?.heftPlaces ?? 2);
    const max = Number(config.resources?.heftPlacesMax ?? 3);
    if (cur < max) {
      measures.push({
        type: 'HEFT_PLACE',
        id: `HEFT_${cur + 1}`,
        label: `${cur + 1}. Heftplatz aktivieren`,
        description: `Zusätzlichen Heftplatz aktivieren (${cur} → ${cur + 1}).`,
        cost: { resource: 1 },
        apply: (cfg) => { const c = deepClone(cfg); c.resources.heftPlaces = cur + 1; return c; },
      });
    }
  }

  /*
   * Zusaetzlicher Arbeitsplatz - aber nur dort, wo die Abteilung gesagt hat,
   * dass ein weiterer Platz eingerichtet werden kann (maxPlaces). Ein Platz,
   * den es nicht gibt, waere ein erfundener Vorschlag.
   */
  if (allowed.includes('PLACE') && (causes[LIMITER.WORKPLACE] ?? 0) > 1) {
    for (const [opId, werte] of Object.entries(config.resources?.byOperation ?? {})) {
      const cur = Number(werte?.places ?? 0);
      const max = Number(werte?.maxPlaces ?? 0);
      if (!(max > cur)) continue;
      const name = OPERATION_BY_ID[opId]?.name ?? opId;
      measures.push({
        type: `PLACE_${opId}`,
        id: `PLACE_${opId}_${cur + 1}`,
        label: `${cur + 1}. Platz für ${name} einrichten`,
        description: `Zusätzlichen Arbeitsplatz für ${name} einrichten (${cur} → ${cur + 1}).`,
        cost: { resource: 1 },
        apply: (cfg) => {
          const c = deepClone(cfg);
          c.resources.byOperation = { ...(c.resources.byOperation ?? {}) };
          c.resources.byOperation[opId] = { ...(c.resources.byOperation[opId] ?? {}), places: cur + 1 };
          return c;
        },
      });
    }
  }

  if (allowed.includes('WELDER') && (causes[LIMITER.ORBITAL_WELDER] ?? 0) > 1) {
    const cur = Number(config.resources?.welders?.default ?? 0);
    const qualified = Number(config.resources?.welders?.qualified ?? 0);
    for (const n of [1, 2]) {
      const ziel = cur + n;
      const braucht = qualified > 0 && ziel > qualified;
      measures.push({
        type: 'WELDER',
        id: `WELD_${n}`,
        label: braucht
          ? `${ziel} Orbitalschweißer je Tag (${ziel - qualified} zusätzlich qualifizieren)`
          : `+${n} eingesetzte Orbitalschweißer (${cur} → ${ziel})`,
        description: braucht
          ? `Einsatz von ${ziel} Orbitalschweißern je Tag. Dafür müssen ${ziel - qualified} Mitarbeiter zusätzlich `
            + `qualifiziert werden (aktuell ${qualified} qualifiziert). Ein Schweißer bedient ${config.resources?.machinesPerWelder ?? 2} Maschinen.`
          : `Eingesetzte Orbitalschweißer je Tag von ${cur} auf ${ziel} erhöhen `
            + `(${qualified} sind qualifiziert, 1 Schweißer bedient ${config.resources?.machinesPerWelder ?? 2} Maschinen).`,
        cost: { staff: n, qualified: braucht ? ziel - qualified : 0 },
        apply: (cfg) => {
          const c = deepClone(cfg);
          c.resources.welders.default = ziel;
          if (qualified > 0 && ziel > qualified) c.resources.welders.qualified = ziel;
          const bw = { ...(c.resources.welders.byWeekday ?? {}) };
          for (const k of Object.keys(bw)) bw[k] = Number(bw[k]) + n;
          c.resources.welders.byWeekday = bw;
          return c;
        },
      });
    }
  }

  if (allowed.includes('MACHINE') && (causes[LIMITER.ORBITAL_MACHINE] ?? 0) > 1) {
    const cur = Number(config.resources?.orbitalMachinesActive ?? 6);
    measures.push({
      type: 'MACHINE',
      id: `MACH_${cur + 1}`,
      label: `+1 Orbitalschweißmaschine (${cur} → ${cur + 1})`,
      description: 'Zusätzliche Orbitalschweißmaschine bereitstellen.',
      cost: { resource: 1 },
      apply: (cfg) => {
        const c = deepClone(cfg);
        c.resources.orbitalMachinesActive = cur + 1;
        c.resources.orbitalMachines = Math.max(Number(c.resources.orbitalMachines ?? 0), cur + 1);
        return c;
      },
    });
  }

  if (allowed.includes('NOBO') && ((causes[LIMITER.NOBO] ?? 0) > 1 || (causes[LIMITER.HYDRO_WINDOW] ?? 0) > 1)) {
    const cur = config.nobo?.weekdays ?? [];
    const missing = [2, 3, 4].filter((d) => !cur.includes(d));
    if (missing.length) {
      const names = { 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag' };
      measures.push({
        type: 'NOBO',
        id: `NOBO_${missing.join('_')}`,
        label: `NoBo zusätzlich ${missing.map((d) => names[d]).join(' + ')}`,
        description: `NoBo-Anwesenheit auf ${[...cur, ...missing].sort().map((d) => names[d] ?? d).join(', ')} erweitern.`,
        cost: { external: missing.length },
        apply: (cfg) => {
          const c = deepClone(cfg);
          c.nobo.weekdays = [...new Set([...cur, ...missing])].sort();
          return c;
        },
      });
    }
  }

  // WIP-Grenze: gleichzeitig bearbeitete Kernauftraege
  const wip = Number(config.projectLimits?.maxParallelProjects ?? 0);
  if (allowed.includes('WIP') && wip > 0 && (kpis.late > 0 || kpis.overloadHours > 1)) {
    for (const n of [wip + 1, wip + 2, 0]) {
      measures.push({
        type: 'WIP',
        id: `WIP_${n}`,
        label: n === 0
          ? 'WIP-Grenze aufheben (Parallelität aus Ressourcen)'
          : `${n} statt ${wip} parallele Kernaufträge`,
        description: n === 0
          ? 'Die Begrenzung auf gleichzeitig bearbeitete Kernaufträge aufheben. Die Parallelität ergibt sich dann '
            + 'ausschließlich aus Personal, Heftplätzen, Maschinen und Prüfkapazität.'
          : `Gleichzeitig bearbeitete Kernaufträge von ${wip} auf ${n} erhöhen (mehr Fläche, Vorrichtungen und Material im Umlauf).`,
        cost: { organisation: n === 0 ? 3 : 1 },
        apply: (cfg) => { const c = deepClone(cfg); c.projectLimits.maxParallelProjects = n; return c; },
      });
    }
  }

  if (allowed.includes('PROJECT_STAFF') && (causes[LIMITER.PROJECT_LIMIT] ?? 0) > 1) {
    const cur = Number(config.projectLimits?.maxWorkersPerProject ?? 4);
    for (const n of [cur + 1, cur + 2]) {
      measures.push({
        type: 'PROJECT_STAFF',
        id: `PSTAFF_${n}`,
        label: `${n} statt ${cur} Mitarbeiter je Projekt`,
        description: `Mehr Mitarbeiter gleichzeitig je Projekt einsetzen (${cur} → ${n}).`,
        cost: { organisation: 1 },
        apply: (cfg) => { const c = deepClone(cfg); c.projectLimits.maxWorkersPerProject = n; return c; },
      });
    }
  }

  if (allowed.includes('SEQUENCE')) {
    for (const rule of ['EDD', 'CR', 'SLACK', 'PRIORITY_DUE']) {
      if (rule === config.sequencing?.rule) continue;
      const names = {
        EDD: 'Reihenfolge nach frühestem Termin (EDD)',
        CR: 'Reihenfolge nach kritischem Verhältnis (Critical Ratio)',
        SLACK: 'Reihenfolge nach geringstem Puffer',
        PRIORITY_DUE: 'Reihenfolge nach Priorität und Termin',
      };
      measures.push({
        type: 'SEQUENCE',
        id: `SEQ_${rule}`,
        label: names[rule],
        description: `Fertigungsreihenfolge umstellen auf: ${names[rule]}. Manuell fixierte Projekte bleiben unverändert.`,
        cost: { organisation: 1 },
        apply: (cfg) => { const c = deepClone(cfg); c.sequencing = { ...c.sequencing, rule }; return c; },
      });
    }
  }

  return measures;
}

/* ------------------------------------------------------------------ *
 * Bewertung / Zielfunktion
 * ------------------------------------------------------------------ */

function costScore(measures) {
  let staff = 0; let saturdays = 0; let overtime = 0; let other = 0;
  for (const m of measures) {
    staff += m.cost?.staff ?? 0;
    saturdays += m.cost?.saturdays ?? 0;
    overtime += m.cost?.overtime ?? 0;
    other += (m.cost?.resource ?? 0) + (m.cost?.external ?? 0) + (m.cost?.organisation ?? 0);
  }
  return { staff, saturdays, overtime, other, total: staff * 3 + saturdays * 2 + overtime * 1 + other * 1.5 };
}

/**
 * Zielwert (kleiner ist besser).
 * @param {any} kpis @param {any[]} measures @param {string} objective
 */
export function score(kpis, measures, objective) {
  const c = costScore(measures);
  switch (objective) {
    case 'MIN_TOTAL_DELAY':
      return kpis.totalLateDays * 100 + kpis.late * 10 + c.total;
    case 'MIN_STAFF':
      return kpis.late * 10000 + kpis.totalLateDays * 10 + c.staff * 100 + c.total;
    case 'MIN_SATURDAY':
      return kpis.late * 10000 + kpis.totalLateDays * 10 + c.saturdays * 200 + c.total;
    case 'MIN_LATE_PROJECTS':
      return kpis.late * 10000 + kpis.totalLateDays + c.total;
    case 'MAX_OTD':
    default:
      return (100 - kpis.otd) * 1000 + kpis.late * 100 + kpis.totalLateDays + c.total * 0.5;
  }
}

/**
 * Gierige Suche nach einem Massnahmenpaket.
 *
 * @param {{config:any, projects:any[], templates:Record<string,any>}} input
 * @param {{objective?:string, allowed?:string[], maxRounds?:number}} [options]
 */
export function optimize(input, options = {}) {
  const objective = options.objective ?? 'MAX_OTD';
  const maxRounds = options.maxRounds ?? 6;

  let currentConfig = deepClone(input.config);
  let currentEval = evaluate({ ...input, config: currentConfig });
  const baselineKpis = currentEval.kpis;
  /** @type {any[]} */
  const applied = [];
  let evaluations = 1;

  for (let round = 0; round < maxRounds; round++) {
    if (currentEval.kpis.late === 0 && currentEval.kpis.overloadHours < 1) break;

    const candidates = generateMeasures(currentEval, currentConfig, options)
      .filter((m) => !applied.some((a) => a.type === m.type && a.id === m.id));
    if (candidates.length === 0) break;

    let best = null;
    for (const m of candidates) {
      const cfg = m.apply(currentConfig);
      const ev = evaluate({ ...input, config: cfg });
      evaluations++;
      const s = score(ev.kpis, [...applied, m], objective);
      if (!best || s < best.score) best = { measure: m, config: cfg, evaluation: ev, score: s };
    }

    const currentScore = score(currentEval.kpis, applied, objective);
    if (!best || best.score >= currentScore - 1e-9) break;

    // Eine Massnahme wird nur uebernommen, wenn sie fachlich etwas bewirkt.
    const k0 = currentEval.kpis;
    const k1 = best.evaluation.kpis;
    const improves = k1.late < k0.late || k1.totalLateDays < k0.totalLateDays
      || k1.overloadHours < k0.overloadHours - 1 || k1.critical < k0.critical;
    if (!improves) break;

    applied.push({
      type: best.measure.type,
      id: best.measure.id,
      label: best.measure.label,
      description: best.measure.description,
      cost: best.measure.cost,
      kpisAfter: summarize(best.evaluation.kpis),
    });
    currentConfig = best.config;
    currentEval = best.evaluation;
  }

  return {
    objective,
    objectiveLabel: OBJECTIVES[objective] ?? objective,
    measures: applied,
    config: currentConfig,
    kpisBefore: summarize(baselineKpis),
    kpisAfter: summarize(currentEval.kpis),
    delta: kpiDelta(baselineKpis, currentEval.kpis),
    projects: currentEval.result.projects.map((p) => ({
      id: p.id, orderNo: p.orderNo, name: p.name, status: p.status,
      dueDate: p.dueDate, forecastFinish: p.forecastFinish, lateDays: p.lateDays,
    })),
    evaluations,
    solved: currentEval.kpis.late === 0,
    cost: costScore(applied.map((a) => ({ cost: a.cost }))),
  };
}

/**
 * Wie viele zusaetzliche Mitarbeiter sind ab wann noetig, damit alle Termine
 * gehalten werden?
 *
 * Beantwortet die Leitungsfrage "wofuer brauche ich mehr Personal und ab wann".
 * Verfahren: binaere Suche ueber die Anzahl zusaetzlicher Kraefte, jede Stufe
 * mit vollstaendiger Simulation. Die Kraefte werden ab der ersten Ueberlastwoche
 * eingesetzt und wirken sofort mit voller Leistung (keine Einarbeitungskurve),
 * damit die Zahl den reinen Kapazitaetsbedarf ausdrueckt.
 *
 * @param {{config:any, projects:any[], templates:Record<string,any>}} input
 * @param {{maxStaff?:number, fromWeek?:string}} [options]
 */
export function requiredAdditionalStaff(input, options = {}) {
  const maxStaff = options.maxStaff ?? 24;
  const baseEval = evaluate(input);
  const base = summarize(baseEval.kpis);

  if (base.late === 0) {
    return { needed: 0, solved: true, fromWeek: null, fromDate: null, base, after: base, evaluations: 1, bottleneck: null };
  }

  const weekKeyStart = options.fromWeek ?? baseEval.kpis.firstOverloadWeek ?? weekKey(input.config.planningDate);
  const fromDate = mondayOf(weekStart(weekKeyStart));

  const withStaff = (n) => {
    // Auch die Bedarfsrechnung geht ueber die Mannschaft, wenn sie die
    // Grundlage ist - sonst rechnet sie mit Koepfen, die die Anwendung
    // gar nicht mehr zaehlt.
    if (input.config.workforce?.team?.source === 'MANNSCHAFT') {
      return mitZusatzPersonal(input.config, n, fromDate, {
        label: `Bedarfsrechnung: +${n} Mitarbeiter`, ohneEinarbeitung: true,
      });
    }
    const cfg = deepClone(input.config);
    cfg.workforce.tempWorkers = [...(cfg.workforce.tempWorkers ?? []), {
      id: 'BEDARFSRECHNUNG', label: `Bedarfsrechnung: +${n} Mitarbeiter`,
      count: n, from: fromDate, to: null, skills: null,
    }];
    // Volle Leistung ab dem ersten Tag - die Zahl soll den Kapazitaetsbedarf zeigen
    cfg.workforce.rampUp = { ...cfg.workforce.rampUp, temp: [], mentoringHoursPerWeek: { ...cfg.workforce.rampUp?.mentoringHoursPerWeek, temp: [] } };
    return cfg;
  };

  let evaluations = 1;
  const top = evaluate({ ...input, config: withStaff(maxStaff) });
  evaluations++;
  if (top.kpis.late > 0) {
    return {
      needed: null, solved: false, fromWeek: weekKeyStart, fromDate,
      base, after: summarize(top.kpis), triedStaff: maxStaff, evaluations,
      bottleneck: top.kpis.bottleneck?.label ?? null,
      bottleneckCause: top.kpis.bottleneck?.cause ?? null,
      note: `Auch mit ${maxStaff} zusätzlichen Mitarbeitern werden nicht alle Termine gehalten. `
        + `Begrenzend ist dann: ${top.kpis.bottleneck?.label ?? 'unbekannt'}.`,
    };
  }

  let low = 1;
  let high = maxStaff;
  let bestEval = top;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const ev = evaluate({ ...input, config: withStaff(mid) });
    evaluations++;
    if (ev.kpis.late === 0) { high = mid; bestEval = ev; } else { low = mid + 1; }
  }

  return {
    needed: high,
    solved: true,
    fromWeek: weekKeyStart,
    fromDate,
    base,
    after: summarize(bestEval.kpis),
    evaluations,
    bottleneck: baseEval.kpis.bottleneck?.label ?? null,
    bottleneckCause: baseEval.kpis.bottleneck?.cause ?? null,
  };
}

/**
 * Erzeugt mehrere alternative Loesungsvarianten (§65).
 * @param {any} input
 * @param {{objectives?:string[], maxRounds?:number}} [options]
 */
export function proposeSolutions(input, options = {}) {
  const variants = [
    { objective: 'MAX_OTD', allowed: ['TEMP', 'OVERTIME', 'SATURDAY', 'HEFT_PLACE', 'PLACE', 'WELDER', 'MACHINE', 'SEQUENCE', 'NOBO', 'PROJECT_STAFF', 'WINDOW', 'WIP'], title: 'Maximale Termintreue' },
    { objective: 'MIN_STAFF', allowed: ['SEQUENCE', 'HEFT_PLACE', 'PLACE', 'WELDER', 'MACHINE', 'NOBO', 'PROJECT_STAFF', 'OVERTIME', 'WINDOW', 'WIP'], title: 'Ohne zusätzliches Personal' },
    { objective: 'MIN_SATURDAY', allowed: ['TEMP', 'OVERTIME', 'HEFT_PLACE', 'WELDER', 'SEQUENCE', 'NOBO', 'PROJECT_STAFF', 'WINDOW', 'WIP'], title: 'Ohne Samstagsarbeit' },
    { objective: 'MIN_LATE_PROJECTS', allowed: ['SEQUENCE', 'SATURDAY', 'OVERTIME', 'TEMP', 'HEFT_PLACE', 'NOBO', 'WINDOW', 'WIP'], title: 'Wenige verspätete Projekte' },
    { objective: 'MAX_OTD', allowed: ['WINDOW', 'WELDER', 'HEFT_PLACE', 'MACHINE', 'SEQUENCE', 'NOBO', 'PROJECT_STAFF', 'WIP'], title: 'Nur organisatorische Maßnahmen' },
  ];

  const out = [];
  const seen = new Set();
  for (const v of variants) {
    const r = optimize(input, { objective: v.objective, allowed: v.allowed, maxRounds: options.maxRounds ?? 4 });
    const key = r.measures.map((m) => m.id).join('|');
    if (r.measures.length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: v.title, ...r });
  }
  return out.sort((a, b) => (a.kpisAfter.late - b.kpisAfter.late) || (a.cost.total - b.cost.total));
}

/**
 * "Was bringt wirklich etwas?"
 *
 * Rechnet jeden einzelnen Hebel FUER SICH durch und stellt die Wirkung
 * nebeneinander: gesparte Verspaetungstage, Aufträge, die in den Termin
 * kommen, Termintreue und der Ueberhang ueber der Kapazitaet.
 *
 * Der Unterschied zu den Loesungsvorschlaegen: Dort werden Massnahmen
 * KOMBINIERT, bis das Ziel erreicht ist. Hier steht jede Massnahme allein -
 * damit sichtbar wird, welcher Hebel ueberhaupt wirkt und welcher nichts
 * bringt, weil der Engpass woanders liegt.
 *
 * @param {any} input @param {{allowed?:string[], limit?:number}} [options]
 */
export function whatHelps(input, options = {}) {
  const base = evaluate(input);
  const vorher = summarize(base.kpis);
  const measures = generateMeasures(base, input.config, { allowed: options.allowed });

  const out = [];
  for (const m of measures) {
    let after;
    let config;
    try {
      config = m.apply(input.config);
      after = evaluate({ ...input, config });
    } catch { continue; }
    const nachher = summarize(after.kpis);
    out.push({
      id: m.id,
      type: m.type,
      label: m.label,
      description: m.description,
      cost: m.cost ?? {},
      kpis: nachher,
      config,
      /** Ersparnis - positiv heisst besser */
      savedLateDays: round1(vorher.totalLateDays - nachher.totalLateDays),
      savedLate: vorher.late - nachher.late,
      otdGain: round2(nachher.otd - vorher.otd),
      shortfallGain: round2((vorher.shortfallHours ?? 0) - (nachher.shortfallHours ?? 0)),
      bottleneckBefore: vorher.bottleneck,
      bottleneckAfter: nachher.bottleneck,
      /** Der Engpass wandert - dann hilft dieser Hebel nur bis dorthin */
      movesBottleneck: vorher.bottleneck !== nachher.bottleneck,
    });
  }

  // Je Art nur den besten Hebel behalten - sonst stehen fuenf Varianten
  // derselben Massnahme uebereinander.
  const besteJeArt = new Map();
  for (const e of out) {
    const alt = besteJeArt.get(e.type);
    if (!alt || e.savedLateDays > alt.savedLateDays
      || (e.savedLateDays === alt.savedLateDays && e.otdGain > alt.otdGain)) besteJeArt.set(e.type, e);
  }

  const liste = [...besteJeArt.values()]
    .sort((a, b) => (b.savedLateDays - a.savedLateDays) || (b.otdGain - a.otdGain));

  return {
    before: vorher,
    measures: liste.slice(0, options.limit ?? 12),
    /** Hebel ohne jede Wirkung - ebenso wichtig zu wissen */
    withoutEffect: liste.filter((e) => e.savedLateDays === 0 && e.otdGain <= 0).map((e) => e.label),
    /**
     * Hebel, die den Plan VERSCHLECHTERN.
     *
     * Das ist kein Rechenfehler, sondern ein Ergebnis: Neue Kraefte
     * leisten in den ersten Wochen 40/60/80 % und binden 5/3/1 Stunden
     * Betreuung der Stammmannschaft. Solange nicht die Mannschaft der
     * Engpass ist, kostet das mehr, als es bringt. Wer das nicht sieht,
     * beantragt Leute und wundert sich.
     */
    harmful: liste.filter((e) => e.savedLateDays < 0).map((e) => ({
      label: e.label,
      lostLateDays: round1(-e.savedLateDays),
      bottleneck: e.bottleneckBefore,
    })),
  };
}

/** Kurzfassung der Kennzahlen. */
export function summarize(k) {
  return {
    otd: k.otd, late: k.late, critical: k.critical, inTime: k.inTime, done: k.done,
    totalLateDays: k.totalLateDays, maxLateDays: k.maxLateDays,
    overloadHours: k.overloadHours, openHours: k.openHours, availableHours: k.availableHours,
    firstOverloadWeek: k.firstOverloadWeek,
    bottleneck: k.bottleneck ? k.bottleneck.label : null,
    orbitalUtilization: k.orbitalUtilization, heftUtilization: k.heftUtilization,
    requiredFteWeeks: k.requiredFteWeeks,
    /** Stunden ueber der Kapazitaet bis zu den Terminen */
    shortfallHours: k.shortfallHours,
    shortfallWeek: k.shortfallWeek,
    shortfallUntil: k.shortfallUntil,
  };
}

/**
 * Wirkung einer Aenderung (§71).
 * @param {any} before @param {any} after
 */
export function kpiDelta(before, after) {
  const d = (a, b) => round2(b - a);
  return {
    otd: d(before.otd, after.otd),
    late: after.late - before.late,
    critical: after.critical - before.critical,
    inTime: after.inTime - before.inTime,
    totalLateDays: after.totalLateDays - before.totalLateDays,
    overloadHours: d(before.overloadHours, after.overloadHours),
    availableHours: d(before.availableHours, after.availableHours),
    openHours: d(before.openHours ?? 0, after.openHours ?? 0),
    shortfallHours: d(before.shortfallHours ?? 0, after.shortfallHours ?? 0),
    orbitalUtilization: d(before.orbitalUtilization, after.orbitalUtilization),
    heftUtilization: d(before.heftUtilization, after.heftUtilization),
    requiredFteWeeks: round1(after.requiredFteWeeks - before.requiredFteWeeks),
  };
}

/**
 * Vergleicht Projektstatus zweier Laeufe (Rot -> Gruen usw.).
 * @param {any} resultBefore @param {any} resultAfter
 */
export function projectStatusDiff(resultBefore, resultAfter) {
  const before = new Map(resultBefore.projects.map((p) => [p.id, p]));
  const out = [];
  for (const a of resultAfter.projects) {
    const b = before.get(a.id);
    if (!b) { out.push({ id: a.id, orderNo: a.orderNo, from: null, to: a.status, change: 'NEU' }); continue; }
    if (b.status !== a.status || b.forecastFinish !== a.forecastFinish) {
      out.push({
        id: a.id, orderNo: a.orderNo, name: a.name,
        from: b.status, to: a.status,
        forecastBefore: b.forecastFinish, forecastAfter: a.forecastFinish,
        lateDaysBefore: b.lateDays, lateDaysAfter: a.lateDays,
        change: b.status === a.status ? 'TERMIN' : 'STATUS',
      });
    }
  }
  return out;
}

export { addWeeks };
