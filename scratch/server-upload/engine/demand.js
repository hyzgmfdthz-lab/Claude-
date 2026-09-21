/**
 * Bedarfsprofil (unbeschraenkte Belastung).
 *
 * Liefert die Stundenlast, die sich rein aus Terminen und Arbeitsfolgen
 * ergibt - OHNE Kapazitaetsbegrenzung. Gegenueberstellung mit der
 * Kapazitaetskennlinie ergibt das Hauptkapazitaetsdiagramm (§60) und die
 * Ueberlaststunden.
 */

import { OPERATION_BY_ID, round2 } from './model.js';
import { resolveRouting, topoSort } from './routing.js';
import { dayKind, DAY_KIND } from './capacity.js';
import { cmpDate, dateRange, weekKey, addDays, maxDate } from './calendar.js';
import { releaseInfo } from './scheduler.js';

/**
 * @param {{config:any, projects:any[], templates:Record<string,any>}} input
 * @param {string[]} dates
 */
export function computeDemand(input, dates) {
  const { config, projects, templates } = input;
  const planningDate = config.planningDate;

  /** @type {Record<string, {total:number, byOp:Record<string, number>}>} */
  const byDate = {};
  for (const d of dates) byDate[d] = { total: 0, byOp: {} };

  const workingDays = dates.filter((d) => dayKind(config, d) !== DAY_KIND.OFF || isPlannedWorkday(config, d));

  for (const project of projects) {
    if (project.active === false) continue;
    const routing = resolveRouting(project, templates, config);
    if (routing.remainingManHours <= 0) continue;
    const ops = topoSort(routing.ops);
    const rel = releaseInfo(project, config);

    let from = maxDate(rel.release || planningDate, planningDate);
    let to = project.dueDate || addDays(from, 20);
    if (cmpDate(to, from) < 0) to = from; // ueberfaellig -> sofortiger Bedarf

    const window = dateRange(from, to).filter((d) => isPlannedWorkday(config, d) && byDate[d]);
    const slots = window.length > 0 ? window : [planningDate];

    const totalMan = routing.remainingManHours;
    if (totalMan <= 0) continue;

    // Arbeitsgaenge anteilig ueber das Fenster verteilen (Reihenfolge beachtet)
    let cum = 0;
    for (const op of ops) {
      const man = op.remainingUnits * op.manHourFactor;
      if (man <= 0) continue;
      const startFrac = cum / totalMan;
      const endFrac = (cum + man) / totalMan;
      cum += man;

      const s = Math.floor(startFrac * slots.length);
      const e = Math.max(s + 1, Math.ceil(endFrac * slots.length));
      const opSlots = slots.slice(s, Math.min(e, slots.length));
      const per = man / (opSlots.length || 1);
      for (const d of (opSlots.length ? opSlots : [slots[slots.length - 1]])) {
        if (!byDate[d]) continue;
        byDate[d].total = round2(byDate[d].total + per);
        byDate[d].byOp[op.opId] = round2((byDate[d].byOp[op.opId] ?? 0) + per);
      }
    }
  }

  void workingDays;
  void OPERATION_BY_ID;
  return byDate;
}

/** Regulaerer Planarbeitstag (Mo-Fr, ohne Feiertage) - unabhaengig von Samstagsarbeit. */
export function isPlannedWorkday(config, date) {
  if (Array.isArray(config.holidays) && config.holidays.includes(date)) return false;
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const iso = wd === 0 ? 7 : wd;
  return (config.workTime?.workDays ?? [1, 2, 3, 4, 5]).includes(iso);
}

/**
 * Aggregiert Tageswerte zu Kalenderwochen.
 * @param {any[]} daySeries @param {Record<string, any>} demandByDate
 */
export function aggregateWeeks(daySeries, demandByDate) {
  /** @type {Record<string, any>} */
  const weeks = {};
  for (const d of daySeries) {
    const k = d.weekKey;
    const w = (weeks[k] ??= {
      weekKey: k, from: d.date, to: d.date,
      capacity: 0, planned: 0, demand: 0,
      byOp: {}, saturday: false, days: 0, headcountSum: 0,
      /**
       * Anteil der Besetzung, der NICHT aus der Mannschaftsliste kommt,
       * sondern aus den Zahlenlisten "Leiharbeiter"/"Neueinstellungen".
       * Getrennt gefuehrt, weil sonst unerklaerlich ist, wieso in der
       * Wochenuebersicht 29 Leute stehen, wo die Mannschaft neun hat.
       */
      extraSum: 0,
    });
    w.to = d.date;
    w.capacity = round2(w.capacity + d.poolCapacity);
    w.planned = round2(w.planned + d.poolUsed);
    w.demand = round2(w.demand + (demandByDate?.[d.date]?.total ?? 0));
    if (d.kind === 'SATURDAY') w.saturday = true;
    if (d.poolCapacity > 0) {
      w.days++;
      w.headcountSum += d.headcount;
      w.extraSum += Number(d.headcountDetail?.temps ?? 0) + Number(d.headcountDetail?.hires ?? 0);
    }
    for (const [opId, v] of Object.entries(d.byOp)) {
      const o = (w.byOp[opId] ??= { capUnits: 0, usedUnits: 0, capManHours: 0, usedManHours: 0, demandManHours: 0 });
      o.capUnits = round2(o.capUnits + v.capUnits);
      o.usedUnits = round2(o.usedUnits + v.usedUnits);
      o.capManHours = round2(o.capManHours + v.capManHours);
      o.usedManHours = round2(o.usedManHours + v.usedManHours);
      o.demandManHours = round2(o.demandManHours + (demandByDate?.[d.date]?.byOp?.[opId] ?? 0));
    }
  }
  for (const w of Object.values(weeks)) {
    w.overload = round2(Math.max(0, w.demand - w.capacity));
    w.utilization = w.capacity > 0 ? round2(w.planned / w.capacity) : 0;
    w.avgHeadcount = w.days > 0 ? round2(w.headcountSum / w.days) : 0;
    /** Davon aus den Zahlenlisten, nicht aus der Mannschaft. */
    w.avgExtraHeadcount = w.days > 0 ? round2(w.extraSum / w.days) : 0;
  }
  return weeks;
}

/** Sortierte Wochenliste. */
export function weekList(weeks) {
  return Object.values(weeks).sort((a, b) => String(a.weekKey).localeCompare(String(b.weekKey)));
}

export { weekKey };
