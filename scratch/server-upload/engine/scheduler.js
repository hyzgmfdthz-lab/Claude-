/**
 * Planungsengine - kapazitaetsbegrenzte Vorwaertsterminierung auf Tagesebene.
 *
 * Kernprinzip (Lastenheft §3): In einer Periode kann nur so viel Arbeit
 * erledigt werden, wie tatsaechlich Kapazitaet vorhanden ist. Nicht erledigte
 * Stunden bleiben offen und verschieben die Fertigstellung.
 *
 * Verfahren: zeitschrittbasiertes, prioritaetsgesteuertes Dispatching
 * (Serial Schedule Generation Scheme mit Ressourcen-, Kalender- und
 * Sonderrestriktionen). Innerhalb eines Tages wird mehrfach iteriert, damit
 * ueberlappende Arbeitsgaenge (Heften / Orbitalschweißen) realistisch
 * ineinandergreifen koennen.
 */

import {
  OPERATION_BY_ID, PROJECT_STATUS, DEP_TYPE, round2, capacityGroupSiblings,
} from './model.js';
import { dayCapacity, DAY_KIND, LIMITER } from './capacity.js';
import { resolveRouting, topoSort } from './routing.js';
import { addDays, addWeeks, cmpDate, dateRange, weekKey, diffDays } from './calendar.js';
import { teamOn, personEffectiveFactor } from './team.js';

/** Toleranz fuer Stundenvergleiche (0,01 h = 36 Sekunden). */
const EPS = 0.01;

/** Rest, ab dem ein Auftrag im Horizont wirklich nicht fertig wird (Stunden). */
const REST_TOLERANZ = 0.25;
/** Maximale Iterationen je Projekt und Tag (Ueberlappungs-Verzahnung). */
const MAX_PASSES = 60;

/**
 * Schneidet numerisches Rauschen ab. Restmengen unterhalb der Toleranz
 * gelten als erledigt - andernfalls koennen Rundungsreste die
 * Ueberlappungslogik dauerhaft blockieren.
 * @param {number} n
 */
function clampHours(n) {
  if (!Number.isFinite(n)) return n;
  const r = Math.round((n + Number.EPSILON) * 10000) / 10000;
  return r < EPS ? 0 : r;
}

/**
 * Ermittelt die fruheste Startfreigabe eines Projektes.
 * @param {any} project @param {any} config
 */
export function releaseInfo(project, config) {
  const due = project.dueDate;
  const lead = config.leadTimes ?? {};
  const startWeeks = Number(lead.startWeeks?.[project.projectType] ?? 3);
  const materialWeeks = Number(lead.materialWeeks ?? 4);

  const startGate = project.earliestStart || (due ? addWeeks(due, -startWeeks) : null);
  const materialGate = project.materialAvailableFrom || (due ? addWeeks(due, -materialWeeks) : null);

  let release = startGate;
  let driver = 'RELEASE';
  if (materialGate && (!release || cmpDate(materialGate, release) > 0)) {
    release = materialGate;
    driver = 'MATERIAL';
  }
  return { release, startGate, materialGate, driver, startWeeks, materialWeeks };
}

/**
 * Fertigungsreihenfolge bestimmen.
 * @param {any[]} projects @param {any} config
 * @returns {any[]} sortierte Kopie
 */
export function orderProjects(projects, config) {
  const rule = config.sequencing?.rule ?? 'PRIORITY_DUE';
  const prio = (p) => Number(String(p.priority || 'P3').replace('P', '')) || 3;
  const due = (p) => p.dueDate || '9999-12-31';
  const seq = (p) => Number(p.sequence ?? 0);
  const arr = projects.slice();

  /** @type {(a:any,b:any)=>number} */
  let cmp;
  switch (rule) {
    case 'MANUAL':
      cmp = (a, b) => seq(a) - seq(b) || due(a).localeCompare(due(b));
      break;
    case 'EDD':
      cmp = (a, b) => due(a).localeCompare(due(b)) || prio(a) - prio(b) || seq(a) - seq(b);
      break;
    case 'PRIORITY':
      cmp = (a, b) => prio(a) - prio(b) || seq(a) - seq(b) || due(a).localeCompare(due(b));
      break;
    case 'SPT':
      cmp = (a, b) => (a.__remainingManHours ?? 0) - (b.__remainingManHours ?? 0) || due(a).localeCompare(due(b));
      break;
    case 'LPT':
      cmp = (a, b) => (b.__remainingManHours ?? 0) - (a.__remainingManHours ?? 0) || due(a).localeCompare(due(b));
      break;
    case 'CR': // Critical Ratio: wenig Zeit je Reststunde zuerst
      cmp = (a, b) => ((a.__slack ?? 0) / Math.max(1, a.__remainingManHours ?? 1))
        - ((b.__slack ?? 0) / Math.max(1, b.__remainingManHours ?? 1));
      break;
    case 'SLACK':
      cmp = (a, b) => (a.__slack ?? 0) - (b.__slack ?? 0) || due(a).localeCompare(due(b));
      break;
    case 'PRIORITY_DUE':
    default:
      cmp = (a, b) => prio(a) - prio(b) || due(a).localeCompare(due(b)) || seq(a) - seq(b);
  }

  if (rule === 'MANUAL' || config.sequencing?.respectLocked === false) return arr.sort(cmp);

  // Manuell fixierte Projekte behalten ihre Position aus der manuellen Reihenfolge.
  const manual = arr.slice().sort((a, b) => seq(a) - seq(b));
  const locked = manual.filter((p) => p.sequenceLocked);
  if (locked.length === 0) return arr.sort(cmp);

  const free = arr.filter((p) => !p.sequenceLocked).sort(cmp);
  const out = free.slice();
  for (const l of locked) {
    const pos = Math.min(out.length, Math.max(0, manual.indexOf(l)));
    out.splice(pos, 0, l);
  }
  return out;
}

/**
 * Hauptfunktion der Engine.
 * @param {{config:any, projects:any[], templates:Record<string,any>, workplaces?:any[]}} input
 */
export function runSchedule(input) {
  const t0 = Date.now();
  const config = input.config;
  const templates = input.templates ?? {};
  const planningDate = config.planningDate;
  const horizonDays = Math.max(7, Number(config.horizonDays ?? 365));
  const horizonEnd = addDays(planningDate, horizonDays);
  const dates = dateRange(planningDate, horizonEnd);

  const activeProjects = (input.projects ?? []).filter((p) => p.active !== false);

  /* ---------------- Projektzustaende ---------------- */
  const states = activeProjects.map((project) => buildState(project, templates, config));

  for (const s of states) {
    s.project.__remainingManHours = s.remainingManHours;
    s.project.__slack = s.project.dueDate ? diffDays(planningDate, s.project.dueDate) : 9999;
  }

  const ordered = orderProjects(activeProjects, config);
  const orderIndex = new Map(ordered.map((p, i) => [p.id, i]));
  states.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  states.forEach((s, i) => { s.orderIndex = i; });

  /* ---------------- Ergebnisstrukturen ---------------- */
  /** @type {any[]} */ const allocations = [];
  /** @type {any[]} */ const blocked = [];
  /** @type {any[]} */ const daySeries = [];

  const maxParallel = Number(config.projectLimits?.maxParallelProjects ?? 0);
  const maxWorkersProject = Number(config.projectLimits?.maxWorkersPerProject ?? 0);
  const tacking = config.tacking ?? {};
  const targetLead = Number(tacking.targetLeadHours ?? 0);
  const maxLead = tacking.enforceMaxLead === false ? Infinity : Number(tacking.maxLeadHours ?? Infinity);

  /* ---------------- Zeitschleife ---------------- */
  for (const date of dates) {
    const cap = dayCapacity(config, date);
    const dayRecord = newDayRecord(date, cap);

    if (cap.kind === DAY_KIND.OFF || cap.poolHours <= EPS) {
      daySeries.push(dayRecord);
      if (states.every((s) => s.finished)) break;
      continue;
    }

    /*
     * FIX Kritisch02: Person, Qualifikation und Zeit gemeinsam reservieren.
     *
     * ctx.opRest gibt je Arbeitsgang einen Anteil des Gesamtpools zurueck
     * (poolHours * Qualifikationsanteil) - UNABHAENGIG je Arbeitsgang
     * gerechnet. Ist dieselbe Person fuer mehrere Arbeitsgaenge qualifiziert
     * (der Regelfall), steckt ihr Stundenbudget dadurch in mehreren
     * Arbeitsgaengen gleichzeitig: der Terminierer kann am selben Tag mehr
     * Stunden buchen, als real anwesende Personen leisten koennen.
     *
     * Deshalb hier, VOR der Verteilung an die Auftraege, ein geteiltes
     * Tagesstundenkonto je real anwesender Person (nur wenn eine
     * Mannschaftsliste mit Qualifikationspruefung aktiv ist - sonst gibt es
     * keine Namen, gegen die reserviert werden koennte). `allocateProjectDay`
     * zieht daraus ab; ist eine Person bereits in einem anderen Arbeitsgang
     * verplant, steht sie hier nicht mehr zur Verfuegung - fuer JEDEN
     * Auftrag und JEDEN Arbeitsgang des Tages gemeinsam.
     */
    const teamCfg = config?.workforce?.team;
    /*
     * FIX (gefunden durch engine/test/regression.test.js, §16/§17):
     * die Kopfzahl der Terminierung kommt bei `source !== 'MANNSCHAFT'`
     * (Ruckfallebene "ZAHLEN"/Wochenwerte) NICHT aus der Namensliste,
     * sondern aus baseHeadcount/tempWorkers/newHires (siehe
     * engine/capacity.js, headcountFor, "ausListe"). Das geteilte
     * Personen-Stundenkonto darf deshalb nur aktiv werden, wenn die
     * Mannschaftsliste tatsaechlich die massgebliche Quelle ist - sonst
     * deckelt es faelschlich auf die kleinere Namensliste, obwohl die
     * eingestellte Kopfzahl (z. B. mit zusaetzlichen Leiharbeitern) groesser
     * ist.
     */
    const teamToday = teamCfg && teamCfg.source === 'MANNSCHAFT' && teamCfg.enforceSkills !== false
      ? teamOn(config, date)
      : null;
    const personRest = teamToday
      ? Object.fromEntries(teamToday.present.map((p) => [
        p.id,
        round2(personEffectiveFactor(config, p, date) * cap.hoursPerEmployee * cap.productivity),
      ]))
      : null;
    const qualifiedIds = teamToday
      ? Object.fromEntries(Object.entries(teamToday.byOp).map(([opId, o]) => [opId, o.ids]))
      : null;

    const ctx = {
      date, cap, dayRecord, allocations, blocked,
      poolRest: cap.poolHours,
      personRest, qualifiedIds,
      opRest: Object.fromEntries(Object.entries(cap.byOp).map(([k, v]) => [k, v.capUnits])),
      /*
       * Aushilfe (Nutzeranforderung 25.09.2026): wie viele Einheiten des
       * heutigen opRest nur durch Aushilfe entstanden sind, und zu welchem
       * Stundenfaktor sie kosten. Getrennt gehalten, weil eine Aushilfe-
       * Einheit die Mannschaft mehr kostet als eine normale (siehe
       * allocateProjectDay) - ohne die Trennung waere die Aushilfe
       * geschenkt.
       */
      opAushilfe: Object.fromEntries(Object.entries(cap.byOp).map(([k, v]) => [
        k, Math.max(0, (v.capUnits ?? 0) - (v.capOhneAushilfe ?? v.capUnits ?? 0)),
      ])),
      opAushilfeFaktor: Object.fromEntries(Object.entries(cap.byOp).map(([k, v]) => [
        k, Number(v.aushilfeStundenfaktor ?? 1),
      ])),
      maxWorkersProject, maxLead, targetLead,
    };

    let parallelUsed = 0;
    const todaysOrder = maxParallel > 0
      ? states.slice().sort((a, b) => (a.started === b.started ? a.orderIndex - b.orderIndex : (a.started ? -1 : 1)))
      : states;

    /*
     * Ein Auftrag wird an diesem Tag bearbeitet - Buchhaltung an einer
     * Stelle, damit der normale Durchlauf und die WIP-Ausnahme (siehe
     * unten) exakt dieselbe Nachbereitung durchlaufen.
     */
    const bearbeiteAuftrag = (st, bypassProjectLimit = false) => {
      const used = allocateProjectDay(st, ctx, bypassProjectLimit);
      if (used > EPS) {
        parallelUsed++;
        dayRecord.activeProjects++;
        st.started = true;
        st.startDate ??= date;
      }
      const rest = remainingManHoursOf(st);
      st.remainingManHours = rest;
      if (rest <= EPS && !st.finished) {
        st.finished = true;
        st.forecastFinish = lastAllocationDate(st) ?? date;
      }
      return used;
    };
    const vermerkeWipAusnahme = (st, grund, manHours) => {
      (dayRecord.wipAusnahmen ??= []).push({ projectId: st.id, grund, manHours: round2(manHours) });
    };

    /** @type {any[]} Ganz uebersprungen wegen "hoechstens N Auftraege gleichzeitig" */
    const wegenParallelUebersprungen = [];

    for (const st of todaysOrder) {
      if (st.finished) continue;
      if (ctx.poolRest <= EPS) break;
      if (st.earliestRelease && cmpDate(date, st.earliestRelease) < 0) continue;

      if (maxParallel > 0 && parallelUsed >= maxParallel) {
        blocked.push({ date, projectId: st.id, opId: null, manHours: 0, cause: LIMITER.PARALLEL_PROJECTS, info: true });
        wegenParallelUebersprungen.push(st);
        continue;
      }

      bearbeiteAuftrag(st);
    }

    /*
     * FIX R06/WIP-Ausnahme: "Grenze bei Leerlauf automatisch lockern - mit
     * sichtbarem Hinweis, dass das eine Ausnahme war."
     *
     * Bleibt nach dem normalen Durchlauf noch echte Mannschaftszeit im
     * Pool uebrig - niemand wuerde durch das Oeffnen der Grenze also
     * jemand anderem etwas wegnehmen -, oeffnet die Anwendung gezielt
     * genau die zwei WIP-Grenzen, an denen (und nur daran) ein Auftrag an
     * diesem Tag gescheitert ist. Vorgaenger, Material, Qualifikation,
     * Plaetze und Maschinen bleiben in jedem Fall hart.
     */
    if (ctx.poolRest > EPS && wegenParallelUebersprungen.length > 0) {
      for (const st of wegenParallelUebersprungen) {
        if (st.finished || ctx.poolRest <= EPS) break;
        const used = bearbeiteAuftrag(st);
        if (used > EPS) vermerkeWipAusnahme(st, LIMITER.PARALLEL_PROJECTS, used);
      }
    }
    /*
     * 2. "Hoechstens M Mitarbeiter je Auftrag": jeder noch offene Auftrag
     *    bekommt einen zweiten, um genau diese Grenze erweiterten
     *    Durchlauf. Ohne echten Poolrest oder ohne dass die Grenze
     *    tatsaechlich der Engpass war, aendert dieser Durchlauf nichts -
     *    er ist dann ein wirkungsloser No-Op, kein Risiko.
     *
     * Nutzerentscheidung 21.09.2026 (nach Ruecksprache trotz Konflikt mit
     * Test "§16 Maximale Mitarbeiterzahl je Projekt begrenzt den
     * Tagesfortschritt"): die WIP-Ausnahme bleibt fuer beide Grenzen
     * (maxParallelProjects UND maxWorkersProject) bestehen. Der Test wurde
     * bewusst auf dieses Verhalten angepasst, siehe regression.test.js.
     */
    if (maxWorkersProject > 0 && ctx.poolRest > EPS) {
      for (const st of todaysOrder) {
        if (st.finished || ctx.poolRest <= EPS) break;
        if (st.earliestRelease && cmpDate(date, st.earliestRelease) < 0) continue;
        const used = bearbeiteAuftrag(st, true);
        if (used > EPS) vermerkeWipAusnahme(st, LIMITER.PROJECT_LIMIT, used);
      }
    }

    daySeries.push(dayRecord);
    if (states.every((s) => s.finished)) break;
  }

  const results = states.map((st) => buildProjectResult(st, config, horizonEnd));

  return {
    planningDate,
    horizonEnd,
    dates,
    daySeries,
    allocations,
    blocked,
    projects: results,
    states,
    runtimeMs: Date.now() - t0,
    config,
  };
}

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */

function buildState(project, templates, config) {
  const routing = resolveRouting(project, templates, config);
  const ops = topoSort(routing.ops);
  const rel = releaseInfo(project, config);
  /** @type {Record<string, any>} */
  const opState = {};
  for (const op of ops) {
    opState[op.opId] = {
      opId: op.opId,
      totalUnits: op.totalUnits,
      remainingUnits: op.remainingUnits,
      doneUnits: op.doneUnits,
      initialDoneUnits: op.doneUnits,
      manHourFactor: op.manHourFactor,
      predecessors: op.predecessors,
      earliestStartWeeksBeforeDue: op.earliestStartWeeksBeforeDue,
      // Freigabe durch eine Regel der Abteilung (z. B. "Sägen darf 8 Wochen
      // vor dem Heften beginnen"). Ohne Regel gilt die Freigabe des Auftrags.
      releaseDate: opReleaseDate(op, project, rel),
      maxWorkers: op.maxWorkers,
      order: op.order,
      firstDate: null,
      lastDate: null,
      plannedManHours: 0,
      /** @type {Record<string, number>} */
      byDate: {},
      /** @type {{opId:string, leadHours:number}[]} */
      overlapSuccessors: [],
    };
  }
  for (const op of ops) {
    for (const p of op.predecessors) {
      if (p.type === DEP_TYPE.OVERLAP && opState[p.opId]) {
        opState[p.opId].overlapSuccessors.push({ opId: op.opId, leadHours: Number(p.leadHours ?? 0) });
      }
    }
  }
  return {
    project, id: project.id, ops, opState, release: rel,
    // Frueheste Freigabe ueber alle Arbeitsgaenge (Regeln koennen sie vorziehen)
    earliestRelease: Object.values(opState).reduce(
      (acc, o) => (o.releaseDate && (!acc || cmpDate(o.releaseDate, acc) < 0) ? o.releaseDate : acc),
      rel.release),
    totalManHours: routing.totalManHours,
    initialRemainingManHours: routing.remainingManHours,
    remainingManHours: routing.remainingManHours,
    missingTemplate: routing.missingTemplate,
    usedFallbackTemplate: routing.usedFallbackTemplate,
    templateKey: routing.templateKey,
    finished: routing.remainingManHours <= EPS,
    forecastFinish: null,
    startDate: null,
    started: routing.doneManHours > EPS,
    orderIndex: 0,
  };
}

function newDayRecord(date, cap) {
  /** @type {any} */
  const rec = {
    date, kind: cap.kind, weekKey: weekKey(date),
    poolCapacity: cap.poolHours, poolUsed: 0,
    headcount: cap.headcount.effective,
    headcountDetail: cap.headcount,
    saturdayHeadcount: cap.saturdayHeadcount,
    productivity: cap.productivity,
    hoursPerEmployee: cap.hoursPerEmployee,
    /*
     * Betreuung und Reserve gehen vom Pool ab. Sie standen bisher nur in
     * der Kapazitaetsrechnung und fehlten in der Tagesreihe - damit liess
     * sich die Poolstunde nicht nachrechnen (gemeldet 18.09.2026).
     */
    mentoringHours: cap.mentoringHours ?? 0,
    reserveHours: cap.reserveHours ?? 0,
    resources: cap.resources,
    byOp: {},
    activeProjects: 0,
  };
  for (const [opId, c] of Object.entries(cap.byOp)) {
    rec.byOp[opId] = {
      capUnits: c.capUnits, usedUnits: 0,
      capManHours: c.capManHours, usedManHours: 0,
      limiter: c.limiter,
      /** Was OHNE Aushilfe moeglich waere - damit ist sie nachrechenbar. */
      capOhneAushilfe: c.capOhneAushilfe ?? c.capUnits,
      aushilfeUnits: 0, aushilfeManHours: 0,
    };
  }
  return rec;
}

function remainingManHoursOf(st) {
  let sum = 0;
  for (const o of st.ops) sum += st.opState[o.opId].remainingUnits * st.opState[o.opId].manHourFactor;
  return clampHours(sum);
}

function lastAllocationDate(st) {
  let last = null;
  for (const o of st.ops) {
    const d = st.opState[o.opId].lastDate;
    if (d && (!last || cmpDate(d, last) > 0)) last = d;
  }
  return last;
}

/**
 * Belegt einen Tag fuer ein Projekt (mehrere Durchlaeufe wegen Ueberlappung).
 *
 * @param {boolean} [bypassProjectLimit] FIX R06/WIP-Ausnahme: ein zweiter
 *   Aufruf fuer denselben Auftrag am selben Tag (siehe runSchedule) kann
 *   damit die Grenze "Mitarbeiter je Auftrag" gezielt ausser Kraft setzen,
 *   wenn nach dem normalen Durchlauf noch echte, sonst ungenutzte
 *   Mannschaftszeit im Pool uebrig ist.
 * @returns {number} verbrauchte Mannstunden
 */
function allocateProjectDay(st, ctx, bypassProjectLimit = false) {
  const { cap, date } = ctx;
  let projectManRest = (!bypassProjectLimit && ctx.maxWorkersProject > 0)
    ? ctx.maxWorkersProject * cap.hoursPerEmployee * cap.productivity
    : Infinity;
  let usedTotal = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let progressed = false;
    const opsToday = st.ops.slice().sort((a, b) => opPriority(st, a, ctx.targetLead) - opPriority(st, b, ctx.targetLead));

    for (const opDef of opsToday) {
      const op = st.opState[opDef.opId];
      if (!op || op.remainingUnits <= EPS) continue;
      if (ctx.poolRest <= EPS || projectManRest <= EPS) break;

      if (!opGateOpen(st, op, date)) continue;

      const allow = allowanceFor(st, op, ctx.maxLead, ctx);
      if (allow.units <= EPS) continue;

      const f = op.manHourFactor;
      const capOpUnits = ctx.opRest[op.opId] ?? 0;
      if (capOpUnits <= EPS) continue;

      /*
       * FIX Kritisch02: geteiltes Personen-Stundenkonto (siehe runSchedule).
       * Nur die Personen, die diesen Arbeitsgang tatsaechlich duerfen, UND
       * nur mit den Stunden, die sie heute noch nicht in einem anderen
       * Arbeitsgang verplant bekommen haben.
       */
      const qualIds = ctx.qualifiedIds?.[op.opId] ?? null;
      const personCapRest = qualIds
        ? qualIds.reduce((a, id) => a + Math.max(0, ctx.personRest[id] ?? 0), 0)
        : Infinity;

      /*
       * Aushilfestunden kosten mehr: von Hand entgraten braucht fuer
       * dieselbe Menge die doppelte Arbeitszeit. Der Poolvorrat muss
       * deshalb zum TEUERSTEN Satz gerechnet werden, der an diesem
       * Arbeitsgang heute noch greifen kann - sonst wuerde mehr zugeteilt,
       * als die Mannschaft tragen kann.
       *
       * Aushilfe ist kein Namensbudget, sondern ein Platz-Mehraufwand
       * (siehe capacity.js/aushilfeVon) - sie zaehlt deshalb NICHT gegen
       * das Personen-Stundenkonto (Kritisch02), nur die normale Belegung.
       */
      const hilfeRest = ctx.opAushilfe?.[op.opId] ?? 0;
      const hilfeFaktor = ctx.opAushilfeFaktor?.[op.opId] ?? 1;
      const normalRest = Math.max(0, capOpUnits - hilfeRest);

      const personUnits = qualIds ? personCapRest / f : Infinity;
      const projectUnits = projectManRest / f;
      // Obergrenze je Arbeitsgang: sie gilt fuer den GANZEN Tag. Da ein Tag in
      // mehreren Durchlaeufen belegt wird (Ueberlappung), muss das bereits
      // heute Gebuchte abgezogen werden - sonst wuerde die Grenze je Durchlauf
      // erneut gewaehrt.
      const opWorkerUnits = op.maxWorkers != null && op.maxWorkers !== ''
        ? Math.max(0, ((Number(op.maxWorkers) * cap.hoursPerEmployee * cap.productivity) / f)
          - (op.byDate[date] ?? 0))
        : Infinity;

      /*
       * Wie viel Arbeitsinhalt traegt der Poolvorrat noch? Erst der Platz
       * zum normalen Satz, dann die Aushilfe zu ihrem teureren - sonst
       * wuerde der billige Satz auch fuer die Aushilfe gelten und der Pool
       * waere ueberzogen.
       */
      const normalMoeglich = Math.min(normalRest, ctx.poolRest / f, personUnits);
      const poolNachNormal = Math.max(0, ctx.poolRest - normalMoeglich * f);
      const hilfeMoeglich = Math.min(hilfeRest, poolNachNormal / (f * hilfeFaktor));
      const poolUnits = normalMoeglich + hilfeMoeglich;

      const wanted = Math.min(op.remainingUnits, allow.units);
      const granted = Math.max(0, Math.min(wanted, capOpUnits, poolUnits, projectUnits, opWorkerUnits));
      if (granted <= EPS) continue;

      // remainingUnits ist die fuehrende Groesse; doneUnits wird abgeleitet,
      // damit beide Werte nicht auseinanderlaufen koennen.
      op.remainingUnits = clampHours(op.remainingUnits - granted);
      op.doneUnits = op.totalUnits - op.remainingUnits;
      // Der Platz wird zuerst normal belegt, der Rest geht auf die
      // Aushilfe - und die kostet ihren Stundenfaktor.
      const ausNormal = Math.min(granted, normalRest);
      const ausHilfe = Math.max(0, granted - ausNormal);
      const man = ausNormal * f + ausHilfe * f * hilfeFaktor;
      if (ausHilfe > EPS) {
        ctx.opAushilfe[op.opId] = clampHours(hilfeRest - ausHilfe);
        ctx.dayRecord.byOp[op.opId].aushilfeUnits = round2((ctx.dayRecord.byOp[op.opId].aushilfeUnits ?? 0) + ausHilfe);
        ctx.dayRecord.byOp[op.opId].aushilfeManHours = round2(
          (ctx.dayRecord.byOp[op.opId].aushilfeManHours ?? 0) + ausHilfe * f * hilfeFaktor,
        );
      }
      op.plannedManHours = round2(op.plannedManHours + man);
      op.byDate[date] = round2((op.byDate[date] ?? 0) + granted);
      op.firstDate ??= date;
      op.lastDate = date;

      /*
       * FIX Kritisch02: das gemeinsame Personen-Stundenkonto um die
       * NORMALE Belegung verringern (Aushilfe ist kein Namensbudget). Wer
       * hier verplant ist, steht heute keinem anderen Arbeitsgang mehr zur
       * Verfuegung - egal aus welchem Auftrag die naechste Anfrage kommt.
       */
      if (qualIds && ausNormal > EPS) {
        let restZuVerteilen = ausNormal * f;
        for (const id of qualIds) {
          if (restZuVerteilen <= EPS) break;
          const habenNoch = ctx.personRest[id] ?? 0;
          if (habenNoch <= EPS) continue;
          const nimmt = Math.min(habenNoch, restZuVerteilen);
          ctx.personRest[id] = clampHours(habenNoch - nimmt);
          restZuVerteilen -= nimmt;
        }
      }

      ctx.poolRest = clampHours(ctx.poolRest - man);
      ctx.opRest[op.opId] = clampHours(capOpUnits - granted);
      /*
       * Geteilter Kapazitaetstopf (Nutzerauftrag 23.09.2026): Kehlnaht und
       * Stumpfnaht Orbital nutzen dieselben Maschinen und denselben
       * Schweißer-Pool. Was der eine Arbeitsgang heute verbraucht, fehlt
       * dem anderen - deshalb wird hier bei jedem Geschwister-Arbeitsgang
       * derselbe Betrag mit abgezogen, statt beiden unabhaengig den vollen
       * Topf zu geben (das wuerde die Maschinenkapazitaet verdoppeln).
       */
      for (const sib of capacityGroupSiblings(op.opId)) {
        if (ctx.opRest[sib] == null) continue;
        ctx.opRest[sib] = clampHours(ctx.opRest[sib] - granted);
      }
      /*
       * Vom Auftrag geht nur der ARBEITSINHALT ab. Der Mehraufwand der
       * Aushilfe kostet Arbeitszeit (Pool), macht den Auftrag aber nicht
       * weiter fertig.
       */
      projectManRest = projectManRest === Infinity ? Infinity : clampHours(projectManRest - granted * f);
      usedTotal += man;

      ctx.dayRecord.poolUsed = round2(ctx.dayRecord.poolUsed + man);
      ctx.dayRecord.byOp[op.opId].usedUnits = round2(ctx.dayRecord.byOp[op.opId].usedUnits + granted);
      ctx.dayRecord.byOp[op.opId].usedManHours = round2(ctx.dayRecord.byOp[op.opId].usedManHours + man);

      const last = ctx.allocations[ctx.allocations.length - 1];
      if (last && last.date === date && last.projectId === st.id && last.opId === op.opId) {
        last.units = round2(last.units + granted);
        last.manHours = round2(last.manHours + man);
      } else {
        ctx.allocations.push({ date, projectId: st.id, opId: op.opId, units: round2(granted), manHours: round2(man) });
      }
      progressed = true;
    }
    if (!progressed) break;
  }

  diagnose(st, ctx, projectManRest);
  return usedTotal;
}

/**
 * Erfasst nach Abschluss des Tages die limitierenden Faktoren.
 * Es werden nur Arbeitsgaenge erfasst, die heute grundsaetzlich haetten
 * bearbeitet werden koennen (Vorgaenger erfuellt), aber an Kapazitaet
 * oder Sonderrestriktionen gescheitert sind.
 */
function diagnose(st, ctx, projectManRest) {
  const { cap, date } = ctx;
  for (const opDef of st.ops) {
    const op = st.opState[opDef.opId];
    if (!op || op.remainingUnits <= EPS) continue;
    if (!opGateOpen(st, op, date)) continue;
    const allow = allowanceFor(st, op, ctx.maxLead, ctx);
    if (allow.units <= EPS) continue; // Vorgaenger/Vorsprung -> Ursache liegt beim Vorgaenger

    const f = op.manHourFactor;
    const qualIds = ctx.qualifiedIds?.[op.opId] ?? null;
    const personCapRest = qualIds
      ? qualIds.reduce((a, id) => a + Math.max(0, ctx.personRest[id] ?? 0), 0)
      : Infinity;
    const limits = [
      { v: ctx.opRest[op.opId] ?? 0, c: cap.byOp[op.opId]?.limiter ?? LIMITER.SKILL },
      { v: ctx.poolRest / f, c: LIMITER.POOL },
      { v: projectManRest === Infinity ? Infinity : projectManRest / f, c: LIMITER.PROJECT_LIMIT },
      { v: qualIds ? personCapRest / f : Infinity, c: LIMITER.SKILL },
    ];
    limits.sort((a, b) => a.v - b.v);
    const shortfall = Math.min(op.remainingUnits, allow.units);
    if (shortfall > EPS) {
      ctx.blocked.push({
        date, projectId: st.id, opId: op.opId,
        manHours: round2(shortfall * f),
        cause: limits[0].c,
      });
    }
  }
}

/**
 * Frueheste Freigabe eines einzelnen Arbeitsganges.
 *
 * Normalerweise gilt die Freigabe des gesamten Auftrags. Eine Regel der
 * Abteilung kann einzelne Arbeitsgaenge frueher freigeben ("Sägen, Entgraten
 * und Biegen duerfen 8 Wochen frueher starten"). Ist dabei gesagt, dass das
 * Material vorhanden ist, entfaellt fuer diese Arbeitsgaenge auch die
 * Materialgrenze.
 *
 * @param {any} op @param {any} project @param {any} rel Ergebnis von releaseInfo
 * @returns {string|null}
 */
function opReleaseDate(op, project, rel) {
  if (op.releaseWeeksBeforeDue == null || !project.dueDate) return rel.release;
  const own = addWeeks(project.dueDate, -Number(op.releaseWeeksBeforeDue));
  /*
   * FIX Bedingt11: eine ausdruecklich gemeldete Fehlteil-Sperre
   * (project.missingParts === true) ist keine arbeitsgangspezifische
   * Materialgrenze, sondern eine harte Sperre des GANZEN Auftrags - von
   * Hand gesetzt, nicht aus dem Kalender abgeleitet. Eine Regel
   * ("ignoreMaterial") fuer einen einzelnen, nicht materialkritischen
   * Arbeitsgang darf diese Sperre nicht umgehen.
   */
  if (op.ignoreMaterial && project.missingParts !== true) return own;
  // Ohne ausdrueckliche Materialfreigabe bleibt die Materialgrenze bestehen.
  if (rel.materialGate && cmpDate(rel.materialGate, own) > 0) return rel.materialGate;
  return own;
}

/** Frueheste Aufnahme eines Arbeitsganges (z.B. Heftstart T-4 Wochen). */
function opGateOpen(st, op, date) {
  if (op.releaseDate && cmpDate(date, op.releaseDate) < 0) return false;
  if (op.earliestStartWeeksBeforeDue == null || !st.project.dueDate) return true;
  const gate = addWeeks(st.project.dueDate, -Number(op.earliestStartWeeksBeforeDue));
  return cmpDate(date, gate) >= 0;
}

/** Reihenfolge der Arbeitsgaenge innerhalb eines Projektes an einem Tag. */
function opPriority(st, opDef, targetLead) {
  const op = st.opState[opDef.opId];
  if (op?.overlapSuccessors?.length) {
    const succ = st.opState[op.overlapSuccessors[0].opId];
    if (succ && succ.totalUnits > 0 && op.totalUnits > 0 && op.remainingUnits > EPS) {
      const succEquiv = (succ.doneUnits / succ.totalUnits) * op.totalUnits;
      if (op.doneUnits - succEquiv < targetLead) return opDef.order - 0.5;
    }
  }
  return opDef.order;
}

/**
 * Maximal heute zulaessige Menge dieses Arbeitsganges aus Sicht des
 * Abhaengigkeitsnetzes (FS, Ueberlappung, Maximalvorsprung).
 * @returns {{units:number, cause:string}}
 */
function allowanceFor(st, op, maxLead, ctx) {
  let allowed = op.remainingUnits;
  let cause = LIMITER.NONE;

  for (const p of op.predecessors) {
    const pred = st.opState[p.opId];
    if (!pred || pred.totalUnits <= EPS) continue; // Arbeitsgang ohne Aufwand ("x")

    if (p.type === DEP_TYPE.OVERLAP) {
      const lead = Number(p.leadHours ?? 0);
      let allowedCum;
      if (pred.remainingUnits <= EPS) {
        allowedCum = op.totalUnits;
      } else {
        const ratio = Math.max(0, (pred.doneUnits - lead) / pred.totalUnits);
        allowedCum = Math.min(op.totalUnits, ratio * op.totalUnits);
      }
      const room = allowedCum - op.doneUnits;
      if (room < allowed) { allowed = room; cause = LIMITER.TACK_LEAD; }
    } else if (pred.remainingUnits > EPS) {
      return { units: 0, cause: LIMITER.PREDECESSOR };
    } else if (ctx && pred.lastDate === ctx.date) {
      /*
       * FIX Hoch04: Ende-Start heisst ENDE, nicht "irgendwann heute fertig
       * geworden". Der Vorgaenger ist HEUTE fertig geworden. Ohne Uhrzeit
       * im Modell (es wird tagesweise, nicht stundenweise gerechnet) ist
       * die Naeherung: Er hat dafuer einen Teil des heutigen Zeitfensters
       * gebraucht - was danach noch uebrig ist, steht dem echten
       * Ende-Start-Nachfolger heute noch zur Verfuegung, nicht mehr. Ein
       * kurzer Vorgaenger laesst dem Nachfolger noch Reststunden desselben
       * Tages; ein Vorgaenger, der das ganze Tagesfenster gebraucht hat,
       * laesst nichts mehr uebrig - der Nachfolger beginnt dann erst am
       * naechsten Tag. Vorher sah die Pruefung nur "remainingUnits bereits
       * 0" und liess zwei volle Arbeitstage auf denselben Kalendertag
       * rutschen.
       */
      const predWindow = Number(ctx.cap?.byOp?.[p.opId]?.detail?.operatingHours ?? ctx.cap?.hoursPerEmployee ?? 0);
      const predUsedToday = Number(pred.byDate?.[ctx.date] ?? 0) * (Number(pred.manHourFactor) || 1);
      const uebrigStunden = Math.max(0, predWindow - predUsedToday);
      const uebrigUnits = uebrigStunden / (Number(op.manHourFactor) || 1);
      if (uebrigUnits < allowed) { allowed = uebrigUnits; cause = LIMITER.PREDECESSOR; }
    }
  }

  // Maximalvorsprung: Vorgaenger darf dem ueberlappenden Nachfolger nicht davonlaufen
  if (allowed > EPS && Number.isFinite(maxLead) && op.overlapSuccessors.length && op.totalUnits > EPS) {
    for (const s of op.overlapSuccessors) {
      const succ = st.opState[s.opId];
      if (!succ || succ.totalUnits <= EPS) continue;
      const succEquiv = (succ.doneUnits / succ.totalUnits) * op.totalUnits;
      const room = Math.min(op.totalUnits, succEquiv + maxLead) - op.doneUnits;
      if (room < allowed) { allowed = room; cause = LIMITER.TACK_LEAD; }
    }
  }

  return { units: Math.max(0, allowed), cause: allowed <= EPS && cause === LIMITER.NONE ? LIMITER.PREDECESSOR : cause };
}

/** Erzeugt das Projektergebnis inkl. Status und Terminabweichung. */
function buildProjectResult(st, config, horizonEnd) {
  const p = st.project;
  const due = p.dueDate;
  const planningDate = config.planningDate;
  const criticalSlack = Number(config.criticalSlackDays ?? 3);

  const rest = remainingManHoursOf(st);
  /*
   * "Im Horizont nicht fertigstellbar" darf nicht an Rundung haengen.
   *
   * Die Verteilung rechnet in Stunden mit zwei Nachkommastellen; ueber
   * hunderte Zuteilungen bleiben leicht ein paar Hundertstel offen. Mit
   * der Toleranz von EPS (0,01 h) galt ein Auftrag mit 0,02 h Rest als
   * "NICHT fertigstellbar" - das ist sachlich falsch und liest sich in der
   * Ursachenanalyse wie ein Alarm. Ab einer Viertelstunde Rest ist es eine
   * echte Aussage.
   */
  const notCompletable = rest > REST_TOLERANZ;
  const forecast = notCompletable ? null : (st.forecastFinish ?? lastAllocationDate(st));

  const totalMan = st.totalManHours;
  const doneInitial = round2(totalMan - st.initialRemainingManHours);

  let status;
  let lateDays = 0;

  if (st.initialRemainingManHours <= EPS) {
    status = PROJECT_STATUS.DONE;
  } else if (!due) {
    status = 'OHNE_TERMIN';
  } else if (cmpDate(due, planningDate) < 0) {
    status = PROJECT_STATUS.LATE;
    lateDays = forecast ? diffDays(due, forecast) : diffDays(due, horizonEnd);
  } else if (notCompletable) {
    status = PROJECT_STATUS.LATE;
    lateDays = diffDays(due, horizonEnd);
  } else if (cmpDate(forecast, due) > 0) {
    status = PROJECT_STATUS.LATE;
    lateDays = diffDays(due, forecast);
  } else {
    const slack = diffDays(forecast, due);
    status = slack <= criticalSlack ? PROJECT_STATUS.CRITICAL : PROJECT_STATUS.IN_TIME;
  }

  const operations = st.ops.map((o) => {
    const s = st.opState[o.opId];
    const def = OPERATION_BY_ID[o.opId];
    return {
      opId: o.opId,
      name: def?.name ?? o.opId,
      unit: def?.unit,
      totalUnits: s.totalUnits,
      doneUnits: round2(s.doneUnits),
      remainingUnits: s.remainingUnits,
      initialRemainingUnits: round2(s.totalUnits - s.initialDoneUnits),
      manHourFactor: s.manHourFactor,
      plannedManHours: s.plannedManHours,
      start: s.firstDate,
      end: s.lastDate,
      order: s.order,
      byDate: s.byDate,
    };
  });

  return {
    id: p.id,
    orderNo: p.orderNo,
    customer: p.customer,
    name: p.name,
    projectType: p.projectType,
    variant: p.variant,
    priority: p.priority,
    sequence: p.sequence,
    sequenceLocked: p.sequenceLocked,
    dueDate: due,
    handoverDate: p.handoverDate,
    forecastFinish: forecast,
    notCompletable,
    status,
    lateDays: Math.max(0, lateDays),
    slackDays: forecast && due ? diffDays(forecast, due) : null,
    totalManHours: totalMan,
    doneManHours: doneInitial,
    remainingManHours: st.initialRemainingManHours,
    openManHoursAfterHorizon: rest,
    progressPercent: totalMan > 0 ? Math.round((doneInitial / totalMan) * 100) : 0,
    start: st.startDate,
    releaseDate: st.release.release,
    releaseDriver: st.release.driver,
    materialDate: st.release.materialGate,
    /** Fehlteile - Ursache ausserhalb der Kapazitaet */
    missingParts: st.project.missingParts === true,
    missingPartsNote: st.project.missingPartsNote ?? '',
    /**
     * Geht die Verspaetung auf Material zurueck? Dann hilft weder Personal
     * noch Schichtbetrieb - das muss getrennt ausgewiesen werden.
     */
    lateByMaterial: lateDays > 0 && (st.project.missingParts === true || st.release.driver === 'MATERIAL'),
    startGate: st.release.startGate,
    templateKey: st.templateKey,
    missingTemplate: st.missingTemplate,
    usedFallbackTemplate: st.usedFallbackTemplate,
    operations,
  };
}
