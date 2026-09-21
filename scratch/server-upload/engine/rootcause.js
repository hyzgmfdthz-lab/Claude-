/**
 * Ursachenanalyse (§64/§90): Warum verspaetet sich ein Projekt?
 */

import { round2, OPERATION_BY_ID, PROJECT_STATUS } from './model.js';
import { LIMITER, LIMITER_LABEL } from './capacity.js';
import { formatDE, cmpDate, diffDays } from './calendar.js';

/**
 * Ursachen je Projekt.
 * @param {any} result
 * @returns {Record<string, any>}
 */
export function rootCauses(result) {
  /** @type {Record<string, any>} */
  const byProject = {};
  for (const p of result.projects) {
    byProject[p.id] = {
      projectId: p.id,
      status: p.status,
      lateDays: p.lateDays,
      causes: {},
      hydroWaitDays: 0,
      firstBlockedDate: null,
      releaseNote: null,
    };
  }

  for (const b of result.blocked) {
    const e = byProject[b.projectId];
    if (!e || b.info) continue;
    // Nur Blockaden bis zur tatsaechlichen Fertigstellung sind relevant
    const p = result.projects.find((x) => x.id === b.projectId);
    if (p?.forecastFinish && cmpDate(b.date, p.forecastFinish) > 0) continue;
    const key = `${b.cause}|${b.opId ?? ''}`;
    const c = (e.causes[key] ??= { cause: b.cause, opId: b.opId, manHours: 0, days: new Set() });
    c.manHours = round2(c.manHours + b.manHours);
    c.days.add(b.date);
    if (!e.firstBlockedDate || cmpDate(b.date, e.firstBlockedDate) < 0) e.firstBlockedDate = b.date;
    if (b.cause === LIMITER.HYDRO_WINDOW || b.cause === LIMITER.NOBO) e.hydroWaitDays++;
  }

  for (const p of result.projects) {
    const e = byProject[p.id];
    e.causes = Object.values(e.causes)
      .map((c) => ({
        cause: c.cause,
        label: LIMITER_LABEL[c.cause] ?? c.cause,
        opId: c.opId,
        opName: c.opId ? (OPERATION_BY_ID[c.opId]?.name ?? c.opId) : null,
        manHours: c.manHours,
        days: c.days.size,
      }))
      .sort((a, b) => b.manHours - a.manHours)
      .slice(0, 8);

    if (p.releaseDate && p.dueDate) {
      const label = p.releaseDriver === 'MATERIAL' ? 'Materialverfügbarkeit' : 'Projektstart-Regel';
      e.releaseNote = `${label}: frühester Arbeitsbeginn ${formatDE(p.releaseDate)}`;
    }
    e.text = explain(p, e);
  }
  return byProject;
}

/** Erzeugt einen lesbaren Ursachentext. */
function explain(p, e) {
  const lines = [];
  const name = p.orderNo || p.name || p.id;
  if (p.status === PROJECT_STATUS.DONE) return `${name} ist fertiggestellt.`;
  if (p.status === 'OHNE_TERMIN') {
    return `${name} hat keinen Fertigstellungstermin. Prognose laut Kapazitätsrechnung: ${formatDE(p.forecastFinish)}.`;
  }
  if (p.status === PROJECT_STATUS.LATE) {
    if (p.notCompletable) {
      lines.push(`${name} kann im Planungshorizont NICHT fertiggestellt werden (${p.openManHoursAfterHorizon} h bleiben offen).`);
    } else {
      lines.push(`${name} verspätet sich um ${p.lateDays} Kalendertage (Soll ${formatDE(p.dueDate)}, Prognose ${formatDE(p.forecastFinish)}).`);
    }
  } else if (p.status === PROJECT_STATUS.CRITICAL) {
    lines.push(`${name} ist kritisch: nur ${p.slackDays} Tage Puffer (Prognose ${formatDE(p.forecastFinish)}).`);
  } else {
    lines.push(`${name} liegt im Termin (Prognose ${formatDE(p.forecastFinish)}, ${p.slackDays} Tage Puffer).`);
  }

  for (const c of e.causes.slice(0, 4)) {
    const op = c.opName ? ` bei ${c.opName}` : '';
    // Je Tag gezaehlt: wer mehrere Tage wartet, steht mehrfach darin. Die
    // Zahl ordnet die Ursachen, sie ist keine Arbeitsmenge.
    lines.push(`• Stau${op}: ${c.manHours} h an ${c.days} Tagen (je Tag gezählt) – Ursache: ${c.label}.`);
  }
  if (e.hydroWaitDays > 0) {
    lines.push(`• Hydroprüfung war an ${e.hydroWaitDays} Tagen nicht möglich (Zeitfenster Di–Do bzw. NoBo nicht anwesend).`);
  }
  if (e.releaseNote && p.status !== PROJECT_STATUS.IN_TIME) lines.push(`• ${e.releaseNote}`);
  return lines.join('\n');
}

/**
 * Gesamtueberblick: welcher Prozess ist der groesste Engpass?
 * @param {any} result
 */
export function bottleneckByOperation(result) {
  /** @type {Record<string, any>} */
  const agg = {};
  for (const b of result.blocked) {
    if (b.info || !b.opId) continue;
    const e = (agg[b.opId] ??= { opId: b.opId, name: OPERATION_BY_ID[b.opId]?.name ?? b.opId, manHours: 0, causes: {} });
    e.manHours = round2(e.manHours + b.manHours);
    e.causes[b.cause] = round2((e.causes[b.cause] ?? 0) + b.manHours);
  }
  return Object.values(agg)
    .map((e) => ({
      ...e,
      mainCause: Object.entries(e.causes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      mainCauseLabel: LIMITER_LABEL[Object.entries(e.causes).sort((a, b) => b[1] - a[1])[0]?.[0]] ?? null,
    }))
    .sort((a, b) => b.manHours - a.manHours);
}

/** Hilfsfunktion: Wartetage bis zum naechsten moeglichen Hydro-Termin. */
export function hydroWaitInfo(result, projectId) {
  const p = result.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const hydro = p.operations.find((o) => o.opId === 'HYDRO');
  const vor = p.operations.find((o) => o.opId === 'VORMONTAGE');
  if (!hydro || !vor || !vor.end || !hydro.start) return null;
  return { readyAt: vor.end, testedAt: hydro.start, waitDays: diffDays(vor.end, hydro.start) };
}
