/**
 * Szenarienverwaltung.
 *
 * EINE zentrale Projektquelle (§76): Szenarien enthalten ausschliesslich
 * Parameter und Uebersteuerungen, niemals eigene Projektlisten.
 */

import { deepClone, deepMerge, makeId } from './model.js';
import { defaultConfig } from './defaults.js';
import { applyRules } from './rules.js';

/**
 * Erzeugt den Eingabedatensatz eines Szenarios fuer die Engine.
 * @param {any} dataset
 * @param {string} scenarioId
 */
export function materialize(dataset, scenarioId) {
  const scenario = getScenario(dataset, scenarioId);
  const config = deepMerge(defaultConfig(), scenario.config ?? {});
  const overrides = scenario.projectOverrides ?? {};

  const projects = dataset.projects.map((p) => {
    const ov = overrides[p.id];
    if (!ov) return deepClone(p);
    const merged = { ...deepClone(p), ...deepClone(ov) };
    merged.id = p.id; // ID bleibt immer stabil
    return merged;
  });

  if (scenario.sequenceOverride && Array.isArray(scenario.sequenceOverride)) {
    const pos = new Map(scenario.sequenceOverride.map((id, i) => [id, (i + 1) * 10]));
    for (const p of projects) {
      if (pos.has(p.id)) p.sequence = pos.get(p.id);
    }
  }

  const input = {
    scenario,
    config,
    projects,
    templates: deepClone(dataset.templates),
    workplaces: deepClone(dataset.workplaces ?? []),
    rules: deepClone(dataset.rules ?? []),
  };

  // Regeln der Abteilung wirken auf die Arbeitsfolge der einzelnen Auftraege.
  input.rulesApplied = applyRules(input);
  return input;
}

/** @param {any} dataset @param {string} id */
export function getScenario(dataset, id) {
  const s = dataset.scenarios.find((x) => x.id === id) ?? dataset.scenarios.find((x) => x.isBaseline);
  if (!s) throw new Error('Kein Szenario vorhanden.');
  return s;
}

/**
 * Dupliziert ein Szenario (Baseline bleibt unveraendert, §69).
 * @param {any} dataset @param {string} sourceId @param {string} name
 */
export function duplicateScenario(dataset, sourceId, name) {
  const src = getScenario(dataset, sourceId);
  const copy = {
    id: makeId('SZN'),
    name: name || `${src.name} (Kopie)`,
    description: '',
    isBaseline: false,
    parentId: src.id,
    createdAt: new Date().toISOString(),
    config: deepClone(src.config),
    projectOverrides: deepClone(src.projectOverrides ?? {}),
    sequenceOverride: src.sequenceOverride ? deepClone(src.sequenceOverride) : null,
    measures: [],
  };
  dataset.scenarios.push(copy);
  return copy;
}

/** Setzt ein Szenario auf die Baseline zurueck. */
export function resetScenario(dataset, id) {
  const s = getScenario(dataset, id);
  if (s.isBaseline) throw new Error('Die Baseline kann nicht zurückgesetzt werden.');
  const base = dataset.scenarios.find((x) => x.isBaseline);
  s.config = deepClone(base.config);
  s.projectOverrides = {};
  s.sequenceOverride = null;
  s.measures = [];
  return s;
}
