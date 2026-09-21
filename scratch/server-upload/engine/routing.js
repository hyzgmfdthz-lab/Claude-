/**
 * Aufloesung der Arbeitsfolge eines Projektes.
 *
 * Verbindet Projekt (Auftrag) mit Arbeitsplan-Vorlage (Projektart/Variante) und
 * beruecksichtigt projektspezifische Uebersteuerungen sowie den Arbeitsfortschritt.
 */

import { OPERATION_BY_ID, OP_STATUS, DEP_TYPE, routingKey, round2 } from './model.js';

/**
 * @typedef {Object} ResolvedOperation
 * @property {string} opId
 * @property {number} totalUnits      Arbeitsinhalt in Arbeitsgang-Einheiten
 * @property {number} remainingUnits  offener Arbeitsinhalt
 * @property {number} doneUnits
 * @property {number} manHourFactor
 * @property {string} status
 * @property {{opId:string,type:string,leadHours:number|null}[]} predecessors
 * @property {number|null} earliestStartWeeksBeforeDue
 * @property {number|null} [releaseWeeksBeforeDue] Freigabe durch eine Regel (Wochen vor Termin)
 * @property {boolean} [ignoreMaterial] Regel sagt: Material ist vorhanden
 * @property {number|null} maxWorkers
 * @property {number} order
 */

/**
 * Waehlt die passende Arbeitsplan-Vorlage.
 * @param {any} project @param {Record<string,any>} templates
 */
export function templateFor(project, templates) {
  const key = routingKey(project.projectType, project.variant);
  if (templates[key]) return templates[key];
  if (templates[project.projectType]) return templates[project.projectType];
  // Ersatzvorlage: erste Vorlage derselben Projektart (z.B. Variante noch offen).
  const prefix = `${project.projectType}_`;
  const fallbackKey = Object.keys(templates).find((k) => k.startsWith(prefix));
  return fallbackKey ? { ...templates[fallbackKey], isFallback: true } : null;
}

/**
 * Loest die Arbeitsfolge eines Projektes vollstaendig auf.
 *
 * @param {any} project
 * @param {Record<string,any>} templates
 * @param {any} config
 * @returns {{ops: ResolvedOperation[], totalManHours:number, remainingManHours:number, doneManHours:number, templateKey:string|null, missingTemplate:boolean, usedFallbackTemplate:boolean}}
 */
export function resolveRouting(project, templates, config) {
  const tpl = templateFor(project, templates);
  const templateKey = tpl ? tpl.key : null;
  const usedFallback = !!(tpl && tpl.isFallback);
  const overrides = new Map((project.operations ?? []).map((o) => [o.opId, o]));

  /** @type {ResolvedOperation[]} */
  let ops = [];
  const steps = tpl ? tpl.steps : [];

  // 1) Sollstunden je Arbeitsgang bestimmen
  let scale = 1;
  if (project.totalHoursOverride != null && tpl) {
    const tplTotalMan = steps.reduce(
      (a, s) => a + Number(s.hours || 0) * (OPERATION_BY_ID[s.opId]?.manHourFactor ?? 1), 0);
    if (tplTotalMan > 0) scale = Number(project.totalHoursOverride) / tplTotalMan;
  }

  steps.forEach((s, idx) => {
    const ov = overrides.get(s.opId) ?? {};
    const def = OPERATION_BY_ID[s.opId];
    if (!def) return;
    let total = ov.plannedHours != null ? Number(ov.plannedHours) : Number(s.hours || 0) * scale;
    if (!Number.isFinite(total) || total < 0) total = 0;
    const status = ov.status ?? OP_STATUS.OPEN;
    if (status === OP_STATUS.NO_EFFORT) total = 0;
    ops.push({
      opId: s.opId,
      totalUnits: round2(total),
      remainingUnits: round2(total),
      doneUnits: 0,
      manHourFactor: def.manHourFactor,
      status,
      predecessors: (s.predecessors ?? []).map((p) => ({
        opId: p.opId,
        type: p.type ?? DEP_TYPE.FS,
        leadHours: p.leadHours ?? null,
      })),
      earliestStartWeeksBeforeDue: s.earliestStartWeeksBeforeDue ?? null,
      maxWorkers: ov.maxWorkers ?? s.maxWorkers ?? null,
      order: idx,
    });
  });

  // Zusaetzliche projektspezifische Arbeitsgaenge, die nicht in der Vorlage stehen
  for (const [opId, ov] of overrides) {
    if (ops.some((o) => o.opId === opId)) continue;
    const def = OPERATION_BY_ID[opId];
    if (!def || ov.plannedHours == null) continue;
    ops.push({
      opId,
      totalUnits: round2(Number(ov.plannedHours) || 0),
      remainingUnits: round2(Number(ov.plannedHours) || 0),
      doneUnits: 0,
      manHourFactor: def.manHourFactor,
      status: ov.status ?? OP_STATUS.OPEN,
      predecessors: ov.predecessors ?? [],
      earliestStartWeeksBeforeDue: null,
      maxWorkers: ov.maxWorkers ?? null,
      order: ops.length,
    });
  }

  // Regeln der Abteilung (siehe rules.js) uebersteuern die Vorlage
  const ruleOv = project.ruleOverrides ?? null;
  if (ruleOv) {
    for (const op of ops) {
      const r = ruleOv[op.opId];
      if (!r) continue;
      if (r.predecessors) {
        op.predecessors = r.predecessors.map((x) => ({
          opId: x.opId, type: x.type ?? DEP_TYPE.FS, leadHours: x.leadHours ?? null,
        }));
      }
      if (r.maxWorkers != null) op.maxWorkers = Number(r.maxWorkers);
      if (r.releaseWeeksBeforeDue != null) {
        op.releaseWeeksBeforeDue = Number(r.releaseWeeksBeforeDue);
        op.ignoreMaterial = !!r.ignoreMaterial;
      }
    }
    // Arbeitsgaenge, die durch eine Regel auf einen anderen Vorgaenger zeigen,
    // duerfen von diesem nicht mehr als Nachfolger erwartet werden.
    for (const op of ops) {
      op.predecessors = op.predecessors.filter((pred) => ops.some((o) => o.opId === pred.opId));
    }
  }

  // Heften -> Orbital: Vorsprung aus den Planungsparametern, falls nicht gesetzt
  const minLead = Number(config?.tacking?.minLeadHours ?? 0);
  for (const op of ops) {
    for (const p of op.predecessors) {
      if (p.type === DEP_TYPE.OVERLAP && (p.leadHours == null || String(p.leadHours) === '')) {
        p.leadHours = minLead;
      }
    }
  }

  // 2) Fortschritt anwenden
  applyProgress(project, ops);

  const totalManHours = ops.reduce((a, o) => a + o.totalUnits * o.manHourFactor, 0);
  const remainingManHours = ops.reduce((a, o) => a + o.remainingUnits * o.manHourFactor, 0);

  return {
    ops,
    totalManHours: round2(totalManHours),
    remainingManHours: round2(remainingManHours),
    doneManHours: round2(totalManHours - remainingManHours),
    templateKey,
    missingTemplate: !tpl,
    usedFallbackTemplate: usedFallback,
  };
}

/**
 * Wendet den Fortschritt auf die aufgeloeste Arbeitsfolge an.
 *
 * Variante B (Reststunden je Arbeitsgang) hat Vorrang vor Variante A (Prozent).
 * @param {any} project @param {ResolvedOperation[]} ops
 */
function applyProgress(project, ops) {
  const overrides = new Map((project.operations ?? []).map((o) => [o.opId, o]));

  if (project.done) {
    for (const op of ops) { op.remainingUnits = 0; op.doneUnits = op.totalUnits; }
    return;
  }

  // Arbeitsgangstatus zuerst
  for (const op of ops) {
    if (op.status === OP_STATUS.DONE) { op.remainingUnits = 0; op.doneUnits = op.totalUnits; }
    if (op.status === OP_STATUS.NO_EFFORT) { op.remainingUnits = 0; op.doneUnits = 0; op.totalUnits = 0; }
  }

  const hasPerOp = project.progressMode === 'PER_OPERATION'
    && (project.operations ?? []).some((o) => o.remainingHours != null && o.remainingHours !== '');

  if (hasPerOp) {
    for (const op of ops) {
      const ov = overrides.get(op.opId);
      if (!ov || ov.remainingHours == null || ov.remainingHours === '') {
        if (op.status === OP_STATUS.OPEN) { /* unveraendert offen */ }
        continue;
      }
      let rem = Number(ov.remainingHours);
      if (!Number.isFinite(rem) || rem < 0) rem = 0;
      if (rem > op.totalUnits) op.totalUnits = round2(rem); // Reststunden sind fuehrend
      op.remainingUnits = round2(rem);
      op.doneUnits = round2(op.totalUnits - rem);
      op.status = rem === 0 ? OP_STATUS.DONE : OP_STATUS.OPEN;
    }
    return;
  }

  if (project.progressMode === 'PERCENT') {
    const pct = Math.max(0, Math.min(100, Number(project.progressPercent) || 0)) / 100;
    const totalMan = ops.reduce((a, o) => a + o.totalUnits * o.manHourFactor, 0);
    let doneMan = totalMan * pct;
    for (const op of ops.slice().sort((a, b) => a.order - b.order)) {
      const opMan = op.totalUnits * op.manHourFactor;
      if (opMan <= 0) continue;
      if (doneMan <= 0) break;
      const consumed = Math.min(opMan, doneMan);
      doneMan -= consumed;
      const doneUnits = consumed / op.manHourFactor;
      op.doneUnits = round2(Math.max(op.doneUnits, doneUnits));
      op.remainingUnits = round2(Math.max(0, op.totalUnits - op.doneUnits));
      if (op.remainingUnits === 0) op.status = OP_STATUS.DONE;
    }
  }
}

/**
 * Sortiert die Arbeitsgaenge topologisch (stabil nach Reihenfolge in der Vorlage).
 * @param {ResolvedOperation[]} ops
 * @returns {ResolvedOperation[]}
 */
export function topoSort(ops) {
  const byId = new Map(ops.map((o) => [o.opId, o]));
  const visited = new Set();
  const temp = new Set();
  /** @type {ResolvedOperation[]} */
  const out = [];
  const visit = (op) => {
    if (visited.has(op.opId)) return;
    if (temp.has(op.opId)) return; // Zyklus: defensiv abbrechen
    temp.add(op.opId);
    for (const p of op.predecessors) {
      const pred = byId.get(p.opId);
      if (pred) visit(pred);
    }
    temp.delete(op.opId);
    visited.add(op.opId);
    out.push(op);
  };
  for (const op of ops.slice().sort((a, b) => a.order - b.order)) visit(op);
  return out;
}

/**
 * Ermittelt die Endarbeitsgaenge (ohne Nachfolger).
 * @param {ResolvedOperation[]} ops
 */
export function terminalOps(ops) {
  const hasSuccessor = new Set();
  for (const op of ops) for (const p of op.predecessors) hasSuccessor.add(p.opId);
  return ops.filter((o) => !hasSuccessor.has(o.opId));
}
