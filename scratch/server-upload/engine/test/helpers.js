/**
 * Testhilfen: kleine, vollstaendig kontrollierte Datensaetze.
 */
import { defaultConfig, defaultRoutingTemplates } from '../defaults.js';
import { createProject, deepClone } from '../model.js';
import { runSchedule } from '../scheduler.js';
import { computeDemand, aggregateWeeks } from '../demand.js';
import { dashboardKpis } from '../kpi.js';

/** Arbeitsplan mit frei waehlbaren Stunden. */
export function template(key, label, hours, opts = {}) {
  const steps = Object.entries(hours).map(([opId, h], i, arr) => ({
    opId,
    hours: h,
    predecessors: i === 0 ? [] : [{ opId: arr[i - 1][0], type: opts.overlap?.[opId] ? 'OVERLAP' : 'FS', leadHours: opts.lead?.[opId] ?? null }],
    earliestStartWeeksBeforeDue: null,
    maxWorkers: null,
  }));
  return { key, label, validated: true, steps };
}

/** Basiskonfiguration ohne "weiche" Sonderregeln - fuer klare Testaussagen. */
export function testConfig(over = {}) {
  const c = defaultConfig();
  c.planningDate = '2026-09-07'; // Montag
  c.horizonDays = 200;
  c.productivity.global = 1;
  c.workforce.baseHeadcount = 10;
  // Startdaten der realen Planung fuer die Tests neutralisieren
  c.workforce.weekly = {};
  c.workforce.newHires = [];
  c.workforce.tempWorkers = [];
  // Die Zubehoerreserve (18 h/Woche laut Auskunft) ist ein Erfahrungswert
  // der Abteilung, keine Formel. Fuer die Kapazitaetstests steht sie auf 0 -
  // geprueft wird sie in belegung.test.js eigens.
  c.workforce.reserveHoursPerWeek = 0;
  c.holidays = [];
  c.projectLimits.maxParallelProjects = 0;
  c.resources.operatingHoursPerDay = null;
  c.projectLimits.maxWorkersPerProject = 0; // keine Projektbegrenzung
  c.skills = Object.fromEntries(Object.keys(c.skills).map((k) => [k, { share: 1, headcount: null, validated: true }]));
  c.resources.hydroStations = null;
  c.resources.beizStations = null;
  // Die Plaetze der Werkstatt (ein Saegeplatz, ein Biegeplatz ...) werden in
  // capacity.test.js eigens geprueft. Fuer die uebrigen Tests stehen sie
  // bewusst offen, damit dort Personal, Maschinen und Reihenfolge messbar
  // bleiben und nicht ein Platz alles ueberdeckt.
  c.resources.byOperation = {};
  // Die Mannschaftsliste wird in mannschaft.test.js eigens geprueft; hier
  // bleibt die Zahlenrechnung die Grundlage, damit die Formeln messbar sind.
  c.workforce.team.source = 'ZAHLEN';
  c.resources.heftPlaces = 10;
  c.resources.workersPerHeftPlace = 10;
  c.resources.orbitalMachines = 20;
  c.resources.orbitalMachinesActive = 20;
  c.resources.welders = { default: 10, byWeekday: {}, byDate: {}, validated: true };
  c.leadTimes.materialWeeks = 52;
  c.leadTimes.startWeeks = { NEUBAU: 52, UMBAU: 52, WKP: 52, REPARATUR: 52, SONDER: 52 };
  return deepMergeSimple(c, over);
}

function deepMergeSimple(a, b) {
  const out = deepClone(a);
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]))
      ? deepMergeSimple(out[k], v) : deepClone(v);
  }
  return out;
}
export { deepMergeSimple as merge };

/**
 * Ein einzelner Arbeitsgang ohne Sonderrestriktionen.
 * @param {{hours?:number, due?:string, config?:any, opId?:string, projects?:any[]}} [o]
 */
export function simpleInput({ hours = 100, due = '2026-10-30', config = {}, opId = 'SAEGEN', projects } = {}) {
  const templates = { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { [opId]: hours }) };
  return {
    config: testConfig(config),
    templates,
    projects: projects ?? [createProject({
      id: 'T1', orderNo: 'T-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: due, priority: 'P1',
    })],
  };
}

/** Fuehrt Simulation + Kennzahlen aus. */
export function run(input) {
  const result = runSchedule(input);
  const demand = computeDemand(input, result.dates);
  const weeks = aggregateWeeks(result.daySeries, demand);
  const kpis = dashboardKpis(result, weeks);
  return { result, demand, weeks, kpis };
}

/** Summe aller eingeplanten Mannstunden. */
export function plannedHours(result, projectId = null) {
  return result.allocations
    .filter((a) => !projectId || a.projectId === projectId)
    .reduce((a, b) => a + b.manHours, 0);
}

/** Vollstaendiger Standard-Arbeitsplan fuer realistische Tests. */
export function fullTemplates() {
  return defaultRoutingTemplates();
}

export { createProject, deepClone };
