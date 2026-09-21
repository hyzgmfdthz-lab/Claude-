/**
 * Belegungsgitter: Zeilen = Arbeitsplatz oder Mitarbeiter, Spalten = Tage.
 *
 * Das ist die Ansicht, die in gaengigen Ressourcenplanern das Herzstueck
 * ist: Man sieht auf einen Blick, wer oder was an welchem Tag belegt ist,
 * wo es eng wird und welcher Auftrag dahintersteckt.
 *
 * Grundsatz dieser Fassung: Das Gitter ist das ERGEBNIS der Rechnung, keine
 * zweite Wahrheit. Es wird gelesen, nicht gezogen. Das Festlegen einzelner
 * Arbeitsgaenge per Maus ist ausdruecklich als naechster Schritt
 * vorgesehen - erst dann, wenn es gegen die Rechnung geprueft ist.
 *
 * Zeilenart "Arbeitsplatz" heisst hier: je Arbeitsgang eine Zeile. Im
 * Armaturenbau ist das dasselbe - Saegen, Entgraten, Biegen, Beizen,
 * Reinigen und der Prueffstand sind je einmal vorhanden, Heften dreimal,
 * Orbitalschweissen sechsmal, Vormontage und Endkontrolle zweimal. Die
 * Kapazitaet wird genau je Arbeitsgang gerechnet, deshalb stimmen Zeile
 * und Rechnung ueberein.
 */

import { OPERATIONS, OPERATION_BY_ID, round2, PROJECT_STATUS } from './model.js';
import { cmpDate, addDays, isoWeek, formatDE } from './calendar.js';
import { LIMITER_LABEL } from './capacity.js';
import { peopleOf, teamOn, absenceOn, ABSENCE_KINDS } from './team.js';

/** Zeilenarten des Gitters. */
export const BOARD_MODE = { WORKPLACE: 'WORKPLACE', PERSON: 'PERSON' };

/**
 * Baut das Gitter.
 *
 * @param {any} input   materialisiertes Szenario
 * @param {any} result  Ergebnis von runSchedule
 * @param {{mode?:string, from?:string, to?:string, assignment?:any}} [opts]
 */
export function board(input, result, opts = {}) {
  const mode = opts.mode === BOARD_MODE.PERSON ? BOARD_MODE.PERSON : BOARD_MODE.WORKPLACE;
  const von = opts.from || input.config.planningDate;
  const bis = opts.to || addDays(von, 27);

  const tage = result.daySeries
    .filter((d) => cmpDate(d.date, von) >= 0 && cmpDate(d.date, bis) <= 0)
    .map((d) => ({
      date: d.date,
      kind: d.kind,
      weekKey: d.weekKey,
      /** Arbeitstag? Sonntage und Feiertage sind grau */
      open: d.kind !== 'OFF',
      headcount: round2(Number(d.headcountDetail?.effective ?? d.headcount ?? 0)),
      source: d.headcountDetail?.source ?? null,
    }));

  const projekte = new Map(result.projects.map((p) => [p.id, p]));
  const rows = mode === BOARD_MODE.PERSON
    ? personenZeilen(input, result, tage, opts.assignment, projekte)
    : arbeitsplatzZeilen(input, result, tage, projekte);

  return {
    mode,
    from: von,
    to: bis,
    planningDate: input.config.planningDate,
    days: tage,
    weeks: wochenSpannen(tage),
    rows,
    /** Summenzeile: wie voll ist die Abteilung an diesem Tag? */
    total: gesamtZeile(result, tage),
  };
}

/* ------------------------------------------------------------------ *
 * Zeilen je Arbeitsplatz
 * ------------------------------------------------------------------ */

function arbeitsplatzZeilen(input, result, tage, projekte) {
  const cfg = input.config;
  const datumIm = new Set(tage.map((t) => t.date));

  /** Belegung je Arbeitsgang und Tag */
  /** @type {Record<string, Record<string, any>>} */
  const belegt = {};
  for (const op of OPERATIONS) belegt[op.id] = {};
  for (const a of result.allocations) {
    if (!datumIm.has(a.date) || !belegt[a.opId]) continue;
    const zelle = (belegt[a.opId][a.date] ??= { hours: 0, entries: [] });
    zelle.hours = round2(zelle.hours + a.manHours);
    const p = projekte.get(a.projectId);
    zelle.entries.push({
      projectId: a.projectId,
      orderNo: p?.orderNo || a.projectId,
      status: p?.status ?? null,
      hours: round2(a.manHours),
    });
  }

  /** Nicht einplanbare Stunden je Arbeitsgang und Tag - der eigentliche Engpass */
  /** @type {Record<string, Record<string, {hours:number, cause:string}>>} */
  const blockiert = {};
  for (const b of result.blocked) {
    if (b.info || !b.opId || !datumIm.has(b.date)) continue;
    const e = (blockiert[b.opId] ??= {});
    const z = (e[b.date] ??= { hours: 0, cause: b.cause });
    z.hours = round2(z.hours + Number(b.manHours ?? 0));
  }

  const tagIndex = new Map(result.daySeries.map((d) => [d.date, d]));

  const rows = [];
  for (const op of OPERATIONS) {
    const eigen = cfg.resources?.byOperation?.[op.id] ?? {};
    const plaetze = platzZahl(cfg, op.id);
    /** @type {Record<string, any>} */
    const cells = {};
    let summe = 0;
    let engpassTage = 0;
    for (const t of tage) {
      const tag = tagIndex.get(t.date);
      const kap = round2(Number(tag?.byOp?.[op.id]?.capManHours ?? 0));
      const z = belegt[op.id][t.date];
      const stunden = round2(z?.hours ?? 0);
      const offen = round2(blockiert[op.id]?.[t.date]?.hours ?? 0);
      const quote = kap > 0 ? round2((stunden / kap) * 100) : 0;
      // "Voll" heisst: die Kapazitaet dieses Arbeitsganges ist ausgeschoepft
      // UND es wartet Arbeit. Genau das ist ein Engpass, nicht 100 % allein.
      const eng = offen > 0.05;
      if (eng) engpassTage++;
      summe += stunden;
      cells[t.date] = {
        hours: stunden,
        capacity: kap,
        util: quote,
        blockedHours: offen,
        blockedCause: offen > 0 ? (blockiert[op.id][t.date].cause ?? null) : null,
        blockedLabel: offen > 0 ? (LIMITER_LABEL[blockiert[op.id][t.date].cause] ?? null) : null,
        clash: eng,
        limiter: tag?.byOp?.[op.id]?.limiter ?? null,
        entries: verdichte(z?.entries ?? []),
      };
    }
    rows.push({
      id: op.id,
      kind: 'WORKPLACE',
      label: op.name,
      meta: platzText(plaetze, eigen, cfg),
      places: plaetze,
      totalHours: round2(summe),
      bottleneckDays: engpassTage,
      cells,
    });
  }
  return rows;
}

/** Wie viele Plaetze hat ein Arbeitsgang? */
function platzZahl(cfg, opId) {
  if (opId === 'HEFTEN') return Number(cfg.resources?.heftPlaces ?? 1);
  if (opId === 'ORBITAL') return Number(cfg.resources?.orbitalMachinesActive ?? cfg.resources?.orbitalMachines ?? 1);
  const eigen = cfg.resources?.byOperation?.[opId];
  return eigen?.places == null ? null : Number(eigen.places);
}

function platzText(plaetze, eigen, cfg) {
  const teile = [];
  if (plaetze != null) teile.push(plaetze === 1 ? '1 Platz' : `${plaetze} Plätze`);
  const jePlatz = Number(eigen?.workersPerPlace ?? 0);
  if (jePlatz > 1) teile.push(`${jePlatz} Personen je Platz`);
  const stunden = Number(eigen?.operatingHours ?? cfg.resources?.operatingHoursPerDay ?? 0);
  if (stunden > 7.6) teile.push(`${Math.max(1, Math.round(stunden / 7.5))}-schichtig`);
  return teile.join(' · ');
}

/* ------------------------------------------------------------------ *
 * Zeilen je Mitarbeiter
 * ------------------------------------------------------------------ */

function personenZeilen(input, result, tage, assignment, projekte) {
  const cfg = input.config;
  const leute = peopleOf(cfg);
  if (leute.length === 0) return [];

  /** Zuteilung je Person und Tag aus dem Einsatzplan */
  /** @type {Record<string, Record<string, any[]>>} */
  const zuteilung = {};
  for (const t of assignment?.days ?? []) {
    for (const e of t.entries ?? []) {
      const p = (zuteilung[e.personId] ??= {});
      (p[t.date] ??= []).push(e);
    }
  }

  const rows = [];
  for (const person of leute) {
    /** @type {Record<string, any>} */
    const cells = {};
    let summe = 0;
    let abwesend = 0;
    for (const t of tage) {
      const ab = absenceOn(person, t.date);
      const eintraege = zuteilung[person.id]?.[t.date] ?? [];
      const stunden = round2(eintraege.reduce((x, e) => x + Number(e.hours ?? 0), 0));
      const imHaus = teamOn(cfg, t.date).present.some((x) => x.id === person.id);
      if (ab) abwesend++;
      summe += stunden;
      const kap = imHaus ? round2(Number(t.headcount) > 0 ? tagesStunden(cfg, person, t) : 0) : 0;
      cells[t.date] = {
        hours: stunden,
        capacity: kap,
        util: kap > 0 ? round2((stunden / kap) * 100) : 0,
        clash: kap > 0 && stunden > kap + 0.05,
        absent: ab ? (ABSENCE_KINDS[ab.kind] ?? ab.kind) : (imHaus ? null : 'nicht eingeplant'),
        entries: verdichte(eintraege.map((e) => ({
          projectId: e.projectId,
          orderNo: projekte.get(e.projectId)?.orderNo || e.projectId,
          status: projekte.get(e.projectId)?.status ?? null,
          hours: round2(e.hours),
          opId: e.opId,
          opName: e.opName ?? OPERATION_BY_ID[e.opId]?.name ?? e.opId,
        }))),
      };
    }
    rows.push({
      id: person.id,
      kind: 'PERSON',
      label: person.label ? `${person.id} · ${person.label}` : person.id,
      meta: [
        person.kind === 'LEIHE' ? 'Leihe' : person.kind === 'NEU' ? 'neu' : 'Stamm',
        `${person.factor} FTE`,
        person.shiftCapable === false ? 'keine Schicht' : null,
      ].filter(Boolean).join(' · '),
      totalHours: round2(summe),
      absentDays: abwesend,
      cells,
    });
  }
  return rows;
}

/** Stunden, die eine Person an diesem Tag leisten kann. */
function tagesStunden(cfg, person, tag) {
  const regular = Number(cfg.workTime?.regularHoursPerWeek ?? 37.5)
    / Math.max(1, (cfg.workTime?.workDays ?? [1, 2, 3, 4, 5]).length);
  const basis = tag.kind === 'SATURDAY' ? Number(cfg.workTime?.saturdayHours ?? 6) : regular;
  return basis * (Number(person.factor) || 0) * Number(cfg.productivity?.global ?? 1);
}

/* ------------------------------------------------------------------ *
 * Gemeinsames
 * ------------------------------------------------------------------ */

/** Mehrere Eintraege desselben Auftrages zu einem zusammenfassen. */
function verdichte(entries) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const e of entries) {
    const key = `${e.projectId}|${e.opId ?? ''}`;
    const vorhanden = map.get(key);
    if (vorhanden) vorhanden.hours = round2(vorhanden.hours + e.hours);
    else map.set(key, { ...e });
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

/** Kalenderwochen als Spaltengruppen. */
function wochenSpannen(tage) {
  const out = [];
  for (const t of tage) {
    const wk = t.weekKey ?? isoWeek(t.date).key;
    const letzte = out[out.length - 1];
    if (letzte && letzte.weekKey === wk) letzte.days++;
    else out.push({ weekKey: wk, days: 1, from: t.date });
  }
  return out;
}

/** Summenzeile: Auslastung der ganzen Abteilung je Tag. */
function gesamtZeile(result, tage) {
  /** @type {Record<string, any>} */
  const cells = {};
  const index = new Map(result.daySeries.map((d) => [d.date, d]));
  for (const t of tage) {
    const d = index.get(t.date);
    const kap = round2(Number(d?.poolCapacity ?? 0));
    const benutzt = round2(Number(d?.poolUsed ?? 0));
    cells[t.date] = {
      hours: benutzt,
      capacity: kap,
      util: kap > 0 ? round2((benutzt / kap) * 100) : 0,
      clash: kap > 0 && benutzt > kap + 0.05,
      headcount: round2(Number(d?.headcountDetail?.effective ?? d?.headcount ?? 0)),
      entries: [],
    };
  }
  return { id: 'POOL', kind: 'TOTAL', label: 'Mitarbeiterstunden gesamt', meta: 'alle Arbeitsgänge', cells };
}

/**
 * Lesbare Beschreibung einer Zelle - fuer den Hinweistext im Gitter.
 * @param {any} row @param {string} date @param {any} cell
 */
export function cellText(row, date, cell) {
  const zeilen = [`${row.label} · ${formatDE(date)}`];
  if (cell.absent) zeilen.push(cell.absent);
  if (cell.capacity > 0) {
    zeilen.push(`${cell.hours} von ${cell.capacity} h belegt (${Math.round(cell.util)} %)`);
  } else if (cell.hours > 0) {
    zeilen.push(`${cell.hours} h belegt`);
  } else {
    zeilen.push('frei');
  }
  if (cell.blockedHours > 0) {
    // Warteschlange dieses Tages, keine Arbeitsmenge ueber mehrere Tage.
    zeilen.push(`Stau: ${cell.blockedHours} h warten – ${cell.blockedLabel ?? cell.blockedCause}`);
  }
  for (const e of cell.entries.slice(0, 6)) {
    zeilen.push(`• ${e.orderNo}${e.opName ? ` · ${e.opName}` : ''} · ${e.hours} h`
      + (e.status === PROJECT_STATUS.LATE ? ' (zu spät)' : ''));
  }
  if (cell.entries.length > 6) zeilen.push(`… und ${cell.entries.length - 6} weitere`);
  return zeilen.join('\n');
}
