import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleInput, testConfig, template, run, plannedHours, createProject, fullTemplates } from './helpers.js';
import { runSchedule, orderProjects, releaseInfo } from '../scheduler.js';
import { PROJECT_STATUS } from '../model.js';
import { weekday, diffDays, cmpDate } from '../calendar.js';

/* ------------------------------------------------------------------ *
 * Grundprinzip: nur vorhandene Kapazitaet darf verbraucht werden (§3)
 * ------------------------------------------------------------------ */

test('Kapazität > Bedarf: Termine werden gehalten', () => {
  const input = simpleInput({ hours: 50, due: '2026-10-30' });
  const { result } = run(input);
  const p = result.projects[0];
  assert.equal(p.status, PROJECT_STATUS.IN_TIME);
  assert.ok(cmpDate(p.forecastFinish, p.dueDate) <= 0);
});

test('Bedarf > Kapazität: Arbeit wandert weiter und der Termin verschiebt sich', () => {
  // 600 h Arbeit, aber nur 400 h Kapazität in der Periode (§3)
  const input = simpleInput({
    hours: 600, due: '2026-09-11',
    config: { workforce: { baseHeadcount: 10 }, workTime: { regularHoursPerWeek: 40 } },
  });
  const { result } = run(input);
  const p = result.projects[0];
  // Woche 1: 10 MA * 40 h = 400 h -> 200 h bleiben offen
  const week1 = result.allocations
    .filter((a) => cmpDate(a.date, '2026-09-11') <= 0)
    .reduce((s, a) => s + a.manHours, 0);
  assert.equal(Math.round(week1), 400);
  assert.equal(p.status, PROJECT_STATUS.LATE);
  assert.ok(p.lateDays > 0, 'Es muss eine echte Terminverschiebung entstehen');
  // Die restlichen 200 h werden in der Folgewoche erledigt
  assert.equal(Math.round(plannedHours(result)), 600);
});

test('Tageskapazität wird niemals überschritten', () => {
  const input = simpleInput({ hours: 5000, due: '2026-12-31' });
  const { result } = run(input);
  for (const d of result.daySeries) {
    assert.ok(d.poolUsed <= d.poolCapacity + 0.02, `Pool überschritten am ${d.date}: ${d.poolUsed} > ${d.poolCapacity}`);
    for (const [opId, v] of Object.entries(d.byOp)) {
      assert.ok(v.usedUnits <= v.capUnits + 0.02, `${opId} überschritten am ${d.date}`);
    }
  }
});

test('Arbeitserhaltung: eingeplante Stunden entsprechen genau dem Restaufwand', () => {
  const input = simpleInput({ hours: 300, due: '2026-11-30' });
  const { result } = run(input);
  const p = result.projects[0];
  assert.equal(Math.round(plannedHours(result) * 10) / 10, p.remainingManHours);
  assert.equal(p.openManHoursAfterHorizon, 0);
});

test('Kein künstlicher Puffer: der Fertigstellungstermin ist die Deadline (§35)', () => {
  // Genau passend: das Projekt wird am Fertigstellungstag fertig -> nicht verspätet
  const input = simpleInput({
    hours: 75, due: '2026-09-08',
    config: { workforce: { baseHeadcount: 5 }, criticalSlackDays: 0 },
  });
  const { result } = run(input);
  const p = result.projects[0];
  assert.equal(p.forecastFinish, '2026-09-08');
  assert.notEqual(p.status, PROJECT_STATUS.LATE);
});

/* ------------------------------------------------------------------ *
 * Szenariohebel
 * ------------------------------------------------------------------ */

test('Produktivität senken: Kapazität sinkt, Termin wird später', () => {
  const a = run(simpleInput({ hours: 400, due: '2026-09-25', config: { productivity: { global: 1 } } }));
  const b = run(simpleInput({ hours: 400, due: '2026-09-25', config: { productivity: { global: 0.5 } } }));
  assert.ok(b.result.daySeries[0].poolCapacity < a.result.daySeries[0].poolCapacity);
  assert.ok(cmpDate(b.result.projects[0].forecastFinish, a.result.projects[0].forecastFinish) > 0);
});

test('Leiharbeiter erhöhen: passende Kapazität steigt, Termin wird früher', () => {
  const base = run(simpleInput({ hours: 800, due: '2026-10-30' }));
  const more = run(simpleInput({
    hours: 800, due: '2026-10-30',
    config: { workforce: { tempWorkers: [{ id: 'L', label: 'Leih', count: 6, from: '2026-09-07', to: null }] } },
  }));
  assert.ok(more.result.daySeries[0].poolCapacity > base.result.daySeries[0].poolCapacity);
  assert.ok(cmpDate(more.result.projects[0].forecastFinish, base.result.projects[0].forecastFinish) < 0);
});

test('Samstagsarbeit aktivieren: zusätzliche Kapazität entsteht', () => {
  const base = run(simpleInput({ hours: 800, due: '2026-10-30' }));
  const sat = run(simpleInput({
    hours: 800, due: '2026-10-30',
    config: { saturday: { enabledDefault: true, quota: 0.2 } },
  }));
  const satDays = sat.result.daySeries.filter((d) => weekday(d.date) === 6 && d.poolCapacity > 0);
  assert.ok(satDays.length > 0, 'Es muss Samstagskapazität geben');
  const capBase = base.result.daySeries.reduce((s, d) => s + d.poolCapacity, 0);
  const capSat = sat.result.daySeries.reduce((s, d) => s + d.poolCapacity, 0);
  assert.ok(capSat > capBase);
  assert.ok(cmpDate(sat.result.projects[0].forecastFinish, base.result.projects[0].forecastFinish) <= 0);
});

test('Überstunden erhöhen die Kapazität', () => {
  const base = run(simpleInput({ hours: 800, due: '2026-10-30' }));
  const ot = run(simpleInput({ hours: 800, due: '2026-10-30', config: { workforce: { overtimePerEmployeeDefault: 5 } } }));
  assert.ok(ot.result.daySeries[0].poolCapacity > base.result.daySeries[0].poolCapacity);
});

test('Orbitalschweißer reduzieren: Schweißengpass steigt', () => {
  const mk = (welders) => ({
    config: testConfig({ resources: { orbitalMachines: 6, orbitalMachinesActive: 6, welders: { default: welders, byWeekday: {}, byDate: {} } } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { ORBITAL: 400 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-30' })],
  });
  const many = run(mk(5));
  const few = run(mk(1));
  assert.ok(few.result.daySeries[0].byOp.ORBITAL.capUnits < many.result.daySeries[0].byOp.ORBITAL.capUnits);
  assert.ok(cmpDate(few.result.projects[0].forecastFinish, many.result.projects[0].forecastFinish) > 0);
  const blockedFew = few.result.blocked.filter((b) => b.cause === 'ORBITAL_WELDER').length;
  assert.ok(blockedFew > 0, 'Der Schweißerengpass muss als Ursache erfasst werden');
});

test('Orbitalmaschine deaktivieren: Maschinenkapazität sinkt', () => {
  const mk = (machines) => ({
    config: testConfig({ resources: { orbitalMachines: 6, orbitalMachinesActive: machines, welders: { default: 5, byWeekday: {}, byDate: {} } } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { ORBITAL: 400 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-30' })],
  });
  const six = run(mk(6));
  const five = run(mk(5));
  assert.ok(five.result.daySeries[0].byOp.ORBITAL.capUnits < six.result.daySeries[0].byOp.ORBITAL.capUnits);
});

test('Dritter Heftplatz: Heftkapazität und Durchsatz steigen', () => {
  const mk = (places) => ({
    config: testConfig({ resources: { heftPlaces: places, workersPerHeftPlace: 1 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { HEFTEN: 300 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-30' })],
  });
  const two = run(mk(2));
  const three = run(mk(3));
  assert.ok(three.result.daySeries[0].byOp.HEFTEN.capUnits > two.result.daySeries[0].byOp.HEFTEN.capUnits);
  assert.ok(cmpDate(three.result.projects[0].forecastFinish, two.result.projects[0].forecastFinish) < 0);
});

/* ------------------------------------------------------------------ *
 * Hydro / NoBo
 * ------------------------------------------------------------------ */

test('Hydroprüfung findet nie montags oder freitags statt (§52)', () => {
  const input = {
    config: testConfig(),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { VORMONTAGE: 10, HYDRO: 60 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  };
  const { result } = run(input);
  const hydro = result.allocations.filter((a) => a.opId === 'HYDRO');
  assert.ok(hydro.length > 0);
  for (const a of hydro) {
    assert.ok([2, 3, 4].includes(weekday(a.date)), `Hydro am ${a.date} (Wochentag ${weekday(a.date)}) ist unzulässig`);
  }
});

test('NoBo steuert die möglichen Hydrotage (§37/§38)', () => {
  const mk = (weekdays) => ({
    config: testConfig({ nobo: { weekdays, exceptions: {} } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { VORMONTAGE: 5, HYDRO: 100 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  });
  const diDo = run(mk([2, 4]));
  const diMiDo = run(mk([2, 3, 4]));
  for (const a of diDo.result.allocations.filter((x) => x.opId === 'HYDRO')) {
    assert.ok([2, 4].includes(weekday(a.date)));
  }
  assert.ok(cmpDate(diMiDo.result.projects[0].forecastFinish, diDo.result.projects[0].forecastFinish) < 0,
    'Ein zusätzlicher NoBo-Tag muss die Fertigstellung vorziehen');
  // NoBo am Dienstag entfernen -> Hydro verschiebt sich
  const nurDo = run(mk([4]));
  for (const a of nurDo.result.allocations.filter((x) => x.opId === 'HYDRO')) {
    assert.equal(weekday(a.date), 4);
  }
});

test('Orbital endet Freitag: Hydro frühestens am folgenden Dienstag (§52)', () => {
  const input = {
    config: testConfig({ planningDate: '2026-09-11' }), // Freitag
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { VORMONTAGE: 20, HYDRO: 5 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  };
  const { result } = run(input);
  const vor = result.projects[0].operations.find((o) => o.opId === 'VORMONTAGE');
  const hyd = result.projects[0].operations.find((o) => o.opId === 'HYDRO');
  assert.equal(vor.end, '2026-09-11');
  assert.equal(hyd.start, '2026-09-15'); // Dienstag der Folgewoche
  assert.ok(diffDays(vor.end, hyd.start) >= 3);
});

/* ------------------------------------------------------------------ *
 * Arbeitsfolge, Ueberlappung, Heftvorsprung
 * ------------------------------------------------------------------ */

test('Ende-Start-Abhängigkeit wird eingehalten', () => {
  const input = {
    config: testConfig(),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 40, ENTGRATEN: 40, BIEGEN: 40 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  };
  const { result } = run(input);
  const ops = Object.fromEntries(result.projects[0].operations.map((o) => [o.opId, o]));
  assert.ok(cmpDate(ops.ENTGRATEN.start, ops.SAEGEN.end) >= 0);
  assert.ok(cmpDate(ops.BIEGEN.start, ops.ENTGRATEN.end) >= 0);
});

test('Heften und Orbitalschweißen laufen überlappend, Vorsprung wird eingehalten (§9/§10)', () => {
  const input = {
    config: testConfig({ tacking: { minLeadHours: 5, targetLeadHours: 7.5, maxLeadHours: 10, enforceMaxLead: true } }),
    templates: {
      NEUBAU_FT40: {
        key: 'NEUBAU_FT40', label: 'T', validated: true,
        steps: [
          { opId: 'HEFTEN', hours: 80, predecessors: [], earliestStartWeeksBeforeDue: null, maxWorkers: null },
          { opId: 'ORBITAL', hours: 80, predecessors: [{ opId: 'HEFTEN', type: 'OVERLAP', leadHours: 5 }], earliestStartWeeksBeforeDue: null, maxWorkers: null },
        ],
      },
    },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  };
  const { result } = run(input);
  const ops = Object.fromEntries(result.projects[0].operations.map((o) => [o.opId, o]));
  // Beide Arbeitsgänge laufen an gemeinsamen Tagen
  const heftDays = new Set(result.allocations.filter((a) => a.opId === 'HEFTEN').map((a) => a.date));
  const orbDays = new Set(result.allocations.filter((a) => a.opId === 'ORBITAL').map((a) => a.date));
  const shared = [...heftDays].filter((d) => orbDays.has(d));
  assert.ok(shared.length > 0, 'Heften und Orbitalschweißen müssen parallel laufen können');
  // Orbital startet nicht vor Heften
  assert.ok(cmpDate(ops.ORBITAL.start, ops.HEFTEN.start) >= 0);
  // Orbital endet nicht vor Heften
  assert.ok(cmpDate(ops.ORBITAL.end, ops.HEFTEN.end) >= 0);
});

test('Mindestvorsprung wird tagesgenau eingehalten', () => {
  const input = {
    config: testConfig({
      tacking: { minLeadHours: 20, targetLeadHours: 25, maxLeadHours: 30, enforceMaxLead: true },
      workforce: { baseHeadcount: 1 },
    }),
    templates: {
      NEUBAU_FT40: {
        key: 'NEUBAU_FT40', label: 'T', validated: true,
        steps: [
          { opId: 'HEFTEN', hours: 100, predecessors: [], earliestStartWeeksBeforeDue: null, maxWorkers: null },
          { opId: 'ORBITAL', hours: 100, predecessors: [{ opId: 'HEFTEN', type: 'OVERLAP', leadHours: 20 }], earliestStartWeeksBeforeDue: null, maxWorkers: null },
        ],
      },
    },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  };
  const { result } = run(input);
  // Kumulierte Mengen je Tag prüfen: Orbital darf nie mehr erledigt haben als (Heften - 20) im gleichen Verhältnis
  let heft = 0; let orb = 0;
  const byDate = new Map();
  for (const a of result.allocations) {
    const e = byDate.get(a.date) ?? { HEFTEN: 0, ORBITAL: 0 };
    e[a.opId] = (e[a.opId] ?? 0) + a.units;
    byDate.set(a.date, e);
  }
  for (const [, v] of [...byDate.entries()].sort()) {
    heft += v.HEFTEN ?? 0;
    orb += v.ORBITAL ?? 0;
    if (heft < 100) {
      assert.ok(orb <= Math.max(0, heft - 20) + 0.05, `Orbital (${orb}) darf den Mindestvorsprung von 20 h nicht unterlaufen (Heften ${heft})`);
      assert.ok(heft - orb <= 30 + 0.05, `Maximalvorsprung überschritten: ${heft - orb}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Termine, Reihenfolge, Vorlaufzeiten
 * ------------------------------------------------------------------ */

test('Vorlaufzeiten: Neubau startet 3 Wochen, Umbau 4 Wochen vor Fertigstellung (§31/§32)', () => {
  const c = testConfig({ leadTimes: { materialWeeks: 4, startWeeks: { NEUBAU: 3, UMBAU: 4, WKP: 4, REPARATUR: 2, SONDER: 4 } } });
  const neubau = releaseInfo({ projectType: 'NEUBAU', dueDate: '2026-10-02' }, c);
  const umbau = releaseInfo({ projectType: 'UMBAU', dueDate: '2026-10-02' }, c);
  assert.equal(neubau.startGate, '2026-09-11');
  assert.equal(neubau.materialGate, '2026-09-04');
  assert.equal(neubau.release, '2026-09-11'); // Startregel bindet
  assert.equal(umbau.startGate, '2026-09-04');
  assert.equal(umbau.release, '2026-09-04');
});

test('Material erst T-4 Wochen: früherer Projektstart wird verhindert (§30)', () => {
  const c = testConfig({ leadTimes: { materialWeeks: 4, startWeeks: { NEUBAU: 12, UMBAU: 4, WKP: 4, REPARATUR: 2, SONDER: 4 } } });
  const info = releaseInfo({ projectType: 'NEUBAU', dueDate: '2026-10-02' }, c);
  assert.equal(info.release, '2026-09-04');
  assert.equal(info.driver, 'MATERIAL');
});

test('Vor der Startfreigabe wird nicht gearbeitet', () => {
  const input = {
    config: testConfig({ leadTimes: { materialWeeks: 2, startWeeks: { NEUBAU: 2, UMBAU: 2, WKP: 2, REPARATUR: 2, SONDER: 2 } } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 20 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-02' })],
  };
  const { result } = run(input);
  const first = result.allocations[0];
  assert.equal(result.projects[0].releaseDate, '2026-09-18');
  assert.ok(cmpDate(first.date, '2026-09-18') >= 0);
});

test('Termin vorziehen erhöht das Terminrisiko', () => {
  const spaet = run(simpleInput({ hours: 300, due: '2026-12-31' }));
  const frueh = run(simpleInput({ hours: 300, due: '2026-09-09' }));
  assert.equal(spaet.result.projects[0].status, PROJECT_STATUS.IN_TIME);
  assert.equal(frueh.result.projects[0].status, PROJECT_STATUS.LATE);
});

test('Verspätung wird erkannt, wenn der Termin vor dem Stichtag liegt und Rest offen ist (§50/§78)', () => {
  const input = simpleInput({ hours: 40, due: '2026-08-01' });
  const { result } = run(input);
  assert.equal(result.projects[0].status, PROJECT_STATUS.LATE);
  assert.ok(result.projects[0].lateDays > 0);
});

test('Fertig gemeldete Projekte erzeugen keinen Zukunftsaufwand (§42/§78)', () => {
  const input = simpleInput({ hours: 400, due: '2026-08-01' });
  input.projects[0].done = true;
  const { result } = run(input);
  assert.equal(result.projects[0].status, PROJECT_STATUS.DONE);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.projects[0].remainingManHours, 0);
});

test('Priorität ändern: Reihenfolge und Ergebnis ändern sich', () => {
  const mk = (prioA, prioB) => ({
    config: testConfig({ workforce: { baseHeadcount: 2 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 150 }) },
    projects: [
      createProject({ id: 'A', orderNo: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-30', priority: prioA, sequence: 10 }),
      createProject({ id: 'B', orderNo: 'B', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-30', priority: prioB, sequence: 20 }),
    ],
  });
  const first = run(mk('P1', 'P4'));
  const second = run(mk('P4', 'P1'));
  const fa = first.result.projects.find((p) => p.id === 'A');
  const sa = second.result.projects.find((p) => p.id === 'A');
  assert.ok(cmpDate(fa.forecastFinish, sa.forecastFinish) < 0, 'Höhere Priorität muss früher fertig werden');
});

test('Manuell fixierte Reihenfolge wird respektiert (§43/§45)', () => {
  const projects = [
    createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01', priority: 'P4', sequence: 10, sequenceLocked: true }),
    createProject({ id: 'B', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-20', priority: 'P1', sequence: 20 }),
  ];
  const cfg = testConfig();
  const ordered = orderProjects(projects, cfg);
  assert.equal(ordered[0].id, 'A', 'Fixiertes Projekt behält seine Position');
});

test('Reihenfolgeregel EDD sortiert nach Termin', () => {
  const projects = [
    createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01', priority: 'P1', sequence: 10 }),
    createProject({ id: 'B', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-20', priority: 'P4', sequence: 20 }),
  ];
  assert.equal(orderProjects(projects, testConfig({ sequencing: { rule: 'EDD' } }))[0].id, 'B');
  assert.equal(orderProjects(projects, testConfig({ sequencing: { rule: 'PRIORITY' } }))[0].id, 'A');
  assert.equal(orderProjects(projects, testConfig({ sequencing: { rule: 'MANUAL' } }))[0].id, 'A');
});

/* ------------------------------------------------------------------ *
 * Datenkonsistenz
 * ------------------------------------------------------------------ */

test('Projekt hinzufügen und löschen wirkt sich überall aus (§75/§76)', () => {
  const base = simpleInput({ hours: 100, due: '2026-10-30' });
  const one = run(base);
  const two = run({
    ...base,
    projects: [...base.projects, createProject({ id: 'T2', orderNo: 'T-2', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-30' })],
  });
  assert.equal(one.result.projects.length, 1);
  assert.equal(two.result.projects.length, 2);
  assert.ok(plannedHours(two.result) > plannedHours(one.result));
  const removed = run({ ...base, projects: [] });
  assert.equal(removed.result.projects.length, 0);
  assert.equal(removed.result.allocations.length, 0);
});

test('Deaktivierte Projekte werden nicht eingeplant', () => {
  const base = simpleInput({ hours: 100, due: '2026-10-30' });
  base.projects[0].active = false;
  const { result } = run(base);
  assert.equal(result.projects.length, 0);
});

test('Engine ist deterministisch: gleiche Eingabe, gleiches Ergebnis', () => {
  const input = simpleInput({ hours: 700, due: '2026-10-30' });
  const a = runSchedule(input);
  const b = runSchedule(input);
  assert.deepEqual(
    a.projects.map((p) => [p.id, p.forecastFinish, p.status, p.lateDays]),
    b.projects.map((p) => [p.id, p.forecastFinish, p.status, p.lateDays]),
  );
  assert.equal(a.allocations.length, b.allocations.length);
});

test('Engine verändert die Eingabedaten nicht (bis auf interne Sortierhilfen)', () => {
  const input = simpleInput({ hours: 300, due: '2026-10-30' });
  const before = JSON.stringify(input.templates);
  runSchedule(input);
  assert.equal(JSON.stringify(input.templates), before);
});

test('Reinigen kommt nur bei Wiederkehrern vor (§7)', () => {
  const templates = fullTemplates();
  const mk = (type, variant) => ({
    config: testConfig(),
    templates,
    projects: [createProject({ id: 'X', projectType: type, variant, dueDate: '2026-12-01' })],
  });
  const neubau = run(mk('NEUBAU', 'FT40'));
  const wkp = run(mk('WKP', null));
  assert.equal(neubau.result.allocations.some((a) => a.opId === 'REINIGEN'), false);
  assert.equal(wkp.result.allocations.some((a) => a.opId === 'REINIGEN'), true);
});

test('Arbeitsgangzeit ändern rechnet alle betroffenen Projekte neu (§8)', () => {
  const templates = fullTemplates();
  const mk = (orbitalHours) => {
    const t = JSON.parse(JSON.stringify(templates));
    t.NEUBAU_FT40.steps.find((s) => s.opId === 'ORBITAL').hours = orbitalHours;
    return {
      config: testConfig(),
      templates: t,
      projects: [
        createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01' }),
        createProject({ id: 'B', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01' }),
        createProject({ id: 'C', projectType: 'NEUBAU', variant: 'FT20', dueDate: '2026-12-01' }),
      ],
    };
  };
  const a = run(mk(90));
  const b = run(mk(105));
  const ha = a.result.projects.filter((p) => p.variant === 'FT40').reduce((s, p) => s + p.totalManHours, 0);
  const hb = b.result.projects.filter((p) => p.variant === 'FT40').reduce((s, p) => s + p.totalManHours, 0);
  assert.equal(Math.round(hb - ha), 2 * (105 - 90)); // 2 Projekte, Arbeitsinhalt in Mannstunden
  const ca = a.result.projects.find((p) => p.id === 'C').totalManHours;
  const cb = b.result.projects.find((p) => p.id === 'C').totalManHours;
  assert.equal(ca, cb, '20-ft-Projekte dürfen sich nicht ändern');
});
