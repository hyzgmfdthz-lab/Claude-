/**
 * Besondere Regressionstests aus dem Lastenheft.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, template, run, createProject, plannedHours } from './helpers.js';
import { PROJECT_STATUS } from '../model.js';
import { cmpDate } from '../calendar.js';
import { LIMITER } from '../capacity.js';
import { seedDataset } from '../seed.js';
import { analyze } from '../index.js';

test('§88 Künstlicher Überlastfall MUSS verspätete Projekte erzeugen', () => {
  // 10 Projekte a 400 h = 4000 h in 4 Wochen, Kapazität: 2 MA * 37,5 h = 300 h
  const projects = [];
  for (let i = 0; i < 10; i++) {
    projects.push(createProject({
      id: `OV${i}`, orderNo: `OV-${i}`, projectType: 'NEUBAU', variant: 'FT40',
      dueDate: '2026-10-05', priority: 'P1', sequence: i * 10,
    }));
  }
  const input = {
    config: testConfig({ workforce: { baseHeadcount: 2 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Überlast', { SAEGEN: 400 }) },
    projects,
  };
  const { result, kpis } = run(input);
  const late = result.projects.filter((p) => p.status === PROJECT_STATUS.LATE);
  assert.ok(late.length > 0, 'FEHLGESCHLAGEN: Bei massiver Überlast muss es verspätete Projekte geben!');
  assert.ok(kpis.otd < 100, 'OTD darf bei Überlast nicht 100 % sein');
  assert.ok(kpis.overloadHours > 0, 'Es müssen Überlaststunden ausgewiesen werden');
  // Kapazität darf nicht "schöngerechnet" werden
  const totalCap = result.daySeries.reduce((s, d) => s + d.poolCapacity, 0);
  assert.ok(plannedHours(result) <= totalCap + 0.1);
});

test('§3 Es werden niemals mehr Stunden verbraucht als vorhanden', () => {
  const projects = Array.from({ length: 6 }, (_, i) => createProject({
    id: `P${i}`, projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-18', priority: 'P1', sequence: i,
  }));
  const input = {
    config: testConfig({ workforce: { baseHeadcount: 4 }, workTime: { regularHoursPerWeek: 40 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 100 }) },
    projects,
  };
  const { result } = run(input);
  for (const d of result.daySeries) {
    assert.ok(d.poolUsed <= d.poolCapacity + 0.02, `Tag ${d.date}: ${d.poolUsed} h verplant, nur ${d.poolCapacity} h vorhanden`);
  }
  // 600 h Arbeit bei 160 h Wochenkapazität -> in Woche 1 höchstens 160 h
  const week1 = result.allocations.filter((a) => cmpDate(a.date, '2026-09-11') <= 0).reduce((s, a) => s + a.manHours, 0);
  assert.equal(Math.round(week1), 160);
});

test('§49 Reihenfolgetausch (Infraserv / PAK) rechnet wirklich neu', () => {
  const mk = (order) => ({
    config: testConfig({ workforce: { baseHeadcount: 2 }, sequencing: { rule: 'MANUAL', respectLocked: true } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 120 }) },
    projects: [
      createProject({ id: 'INFRASERV', orderNo: 'INFRASERV', name: 'Infraserv', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-16', priority: 'P2', sequence: order === 'IP' ? 10 : 20 }),
      createProject({ id: 'PAK', orderNo: 'PAK', name: 'PAK', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-16', priority: 'P2', sequence: order === 'IP' ? 20 : 10 }),
    ],
  });
  const a = run(mk('IP'));
  const b = run(mk('PI'));

  const ai = a.result.projects.find((p) => p.id === 'INFRASERV');
  const ap = a.result.projects.find((p) => p.id === 'PAK');
  const bi = b.result.projects.find((p) => p.id === 'INFRASERV');
  const bp = b.result.projects.find((p) => p.id === 'PAK');

  // Reihenfolge 1: Infraserv zuerst -> Infraserv früher fertig
  assert.ok(cmpDate(ai.forecastFinish, ap.forecastFinish) < 0, 'Infraserv muss zuerst fertig werden');
  // Reihenfolge 2: PAK zuerst -> PAK früher fertig
  assert.ok(cmpDate(bp.forecastFinish, bi.forecastFinish) < 0, 'PAK muss zuerst fertig werden');
  // Die Ergebnisse müssen sich tatsächlich unterscheiden (keine reine Statusverschiebung)
  assert.notEqual(ai.forecastFinish, bi.forecastFinish);
  assert.notEqual(ai.start, bi.start);
  // Auch die Arbeitsgangtermine ändern sich
  assert.notEqual(ai.operations[0].start, bi.operations[0].start);
  // Die Gesamtstunden bleiben identisch (nur die Verteilung ändert sich)
  assert.equal(plannedHours(a.result), plannedHours(b.result));
});

test('§76 Eine zentrale Projektquelle: Gantt und Projektliste sind immer identisch', () => {
  const data = seedDataset();
  const a = analyze(data, 'BASELINE');
  assert.equal(a.gantt.length, a.projects.length);
  assert.deepEqual(a.gantt.map((g) => g.id).sort(), a.projects.map((p) => p.id).sort());
  // Auch nach dem Hinzufügen eines Projektes
  data.projects.push(createProject({ id: 'NEU-1', orderNo: 'NEU-1', projectType: 'NEUBAU', variant: 'FT20', dueDate: '2026-12-01' }));
  const b = analyze(data, 'BASELINE');
  assert.equal(b.gantt.length, b.projects.length);
  assert.equal(b.projects.length, a.projects.length + 1);
  assert.ok(b.gantt.some((g) => g.id === 'NEU-1'));
});

test('§48/§77 Umbenennung erzeugt kein zweites Projekt (stabile IDs)', () => {
  const data = seedDataset();
  const before = analyze(data, 'BASELINE');
  void before;
  const p = data.projects.find((x) => x.orderNo === 'WGC40-S00132');
  p.name = 'WAG Wiederkehrer ISO (neu benannt)';
  p.customer = 'Westfalen AG';
  const after = analyze(data, 'BASELINE');
  assert.equal(after.projects.length, before.projects.length);
  assert.equal(after.projects.filter((x) => x.id === p.id).length, 1);
});

test('§34 Der Termin "Fertig" beeinflusst die Terminbewertung nicht', () => {
  const mk = (handover) => ({
    config: testConfig(),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 200 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-09-25', handoverDate: handover })],
  });
  const a = run(mk(null));
  const b = run(mk('2026-08-01'));
  assert.equal(a.result.projects[0].status, b.result.projects[0].status);
  assert.equal(a.result.projects[0].forecastFinish, b.result.projects[0].forecastFinish);
});

test('§17 Parallele Projekte ergeben sich aus den Ressourcen, nicht aus einem festen Wert', () => {
  const projects = Array.from({ length: 5 }, (_, i) => createProject({
    id: `P${i}`, projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30', priority: 'P1', sequence: i,
  }));
  const input = {
    config: testConfig({ workforce: { baseHeadcount: 20 }, projectLimits: { maxWorkersPerProject: 4, maxParallelProjects: 0 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 200 }) },
    projects,
  };
  const { result } = run(input);
  const maxParallel = Math.max(...result.daySeries.map((d) => d.activeProjects));
  // 20 MA / 4 MA je Projekt -> 5 Projekte gleichzeitig moeglich
  assert.equal(maxParallel, 5);

  // Weniger Personal -> weniger gleichzeitig bearbeitbare Projekte
  const limited = run({
    ...input,
    config: testConfig({ workforce: { baseHeadcount: 8 }, projectLimits: { maxWorkersPerProject: 4, maxParallelProjects: 0 } }),
  });
  assert.equal(limited.result.daySeries[0].activeProjects, 2); // 8 MA / 4 MA je Projekt
  assert.ok(limited.result.daySeries[0].activeProjects < result.daySeries[0].activeProjects);

  // "Hoechstens N Auftraege gleichzeitig" bremst zuerst, wird aber wieder
  // geoeffnet, solange nach dem normalen Durchlauf noch ungenutzte
  // Mannschaftszeit im Pool ist (WIP-Ausnahme, Nutzerentscheidung
  // 21.09.2026: "Grenze bei Leerlauf automatisch lockern - mit sichtbarem
  // Hinweis"). 20 MA / 4 MA je Projekt lassen 5 Projekte gleichzeitig zu,
  // die Grenze von 3 darf hier also nicht ungenutzte Kapazitaet blockieren.
  const softLimit = run({
    ...input,
    config: testConfig({ workforce: { baseHeadcount: 20 }, projectLimits: { maxWorkersPerProject: 4, maxParallelProjects: 3 } }),
  });
  const day0 = softLimit.result.daySeries[0];
  assert.equal(day0.activeProjects, 5,
    'freie Mannschaftszeit im Pool oeffnet die Grenze wieder, statt sie ungenutzt zu lassen');
  assert.ok(day0.wipAusnahmen?.some((a) => a.grund === LIMITER.PARALLEL_PROJECTS),
    'das Oeffnen der Grenze wird sichtbar vermerkt, nicht stillschweigend');
});

test('§16 Maximale Mitarbeiterzahl je Projekt begrenzt den Tagesfortschritt, solange der Pool wirklich knapp ist', () => {
  // Zwei Projekte teilen sich einen Pool, der von der Grenze tatsaechlich
  // ausgeschoepft wird (6 MA * 7,5 h = 45 h = 2 * 22,5 h bei Grenze 3).
  // Hier bleibt nach dem normalen Durchlauf kein Poolrest uebrig, die
  // WIP-Ausnahme greift also nicht - die Grenze bremst wie vorgesehen.
  const mk = (workers) => ({
    config: testConfig({ workforce: { baseHeadcount: 6 }, projectLimits: { maxWorkersPerProject: workers } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 300 }) },
    projects: [
      createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30', sequence: 0 }),
      createProject({ id: 'T2', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30', sequence: 1 }),
    ],
  });
  const three = run(mk(3));
  const six = run(mk(6));
  assert.equal(three.result.daySeries[0].wipAusnahmen, undefined,
    'der Pool ist ausgeschoepft, keine WIP-Ausnahme noetig');
  // Grenze 3: beide Projekte bekommen an Tag 1 ihren Anteil (22,5 h je Projekt).
  assert.equal(three.result.allocations.filter((a) => a.date === three.result.daySeries[0].date).length, 2,
    'bei enger Grenze laufen beide Projekte am ersten Tag parallel an');
  // Grenze 6: das erste Projekt nimmt sich den ganzen (knappen) Pool, das
  // zweite muss auf den naechsten Tag warten.
  assert.equal(six.result.daySeries[0].activeProjects, 1,
    'bei weiter Grenze zieht das erste Projekt den Pool an sich, das zweite startet spaeter');
  assert.ok(cmpDate(six.result.projects[0].forecastFinish, three.result.projects[0].forecastFinish) < 0,
    'das erste Projekt profitiert von der weiteren Grenze');
});

test('§16b WIP-Ausnahme (Nutzerentscheidung 21.09.2026): bei freiem Pool oeffnet sich die Mitarbeitergrenze', () => {
  // Nur ein Projekt, reichlich Personal - die Grenze "Mitarbeiter je
  // Auftrag" darf echte, sonst ungenutzte Mannschaftszeit nicht liegen
  // lassen. Die Ausnahme wird dabei sichtbar in wipAusnahmen vermerkt.
  const mk = (workers) => ({
    config: testConfig({ workforce: { baseHeadcount: 20 }, projectLimits: { maxWorkersPerProject: workers } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 300 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30' })],
  });
  const three = run(mk(3));
  const day0 = three.result.daySeries[0];
  assert.ok(day0.wipAusnahmen?.some((a) => a.grund === LIMITER.PROJECT_LIMIT),
    'das Oeffnen der Grenze wird sichtbar vermerkt, nicht stillschweigend');
  assert.equal(three.result.allocations[0].manHours, 150,
    'ungenutzte Mannschaftszeit (20 MA) wird trotz Grenze 3 genutzt, statt Leerlauf zu erzeugen');
});

/* ------------------------------------------------------------------ *
 * Fehlteile - Verspaetung ohne Kapazitaetsursache
 * ------------------------------------------------------------------ */

test('Fehlteile: Verspätung wird getrennt von der Kapazität ausgewiesen', () => {
  const dataset = seedDataset();
  const ohne = analyze(dataset, 'BASELINE').kpis;
  assert.equal(ohne.lateByMaterial, 0, 'ohne gemeldete Fehlteile keine Materialverspätung');
  assert.equal(ohne.lateByCapacity, ohne.late, 'dann geht alles auf die Kapazität');

  const mit = seedDataset();
  const ziel = mit.projects.find((p) => p.orderNo === 'WGC40-S00446');
  ziel.missingParts = true;
  ziel.missingPartsNote = 'Verschraubungen fehlen';
  const k = analyze(mit, 'BASELINE').kpis;
  assert.equal(k.missingPartsProjects, 1);
  assert.ok(k.lateByMaterial >= 1, 'die Verspätung zählt zum Material');
  assert.equal(k.lateByMaterial + k.lateByCapacity, k.late, 'beide Zahlen ergeben zusammen die Verspätungen');
  assert.ok(k.lateDaysByMaterial > 0 && k.lateDaysByMaterial <= k.totalLateDays);
});

test('Fehlteile: ein bekannter Liefertermin verschiebt den Arbeitsbeginn', () => {
  const dataset = seedDataset();
  const ziel = dataset.projects.find((p) => p.orderNo === 'WGC40-S00446');
  ziel.missingParts = true;
  ziel.materialAvailableFrom = '2026-11-20';
  const an = analyze(dataset, 'BASELINE');
  const p = an.projects.find((x) => x.orderNo === 'WGC40-S00446');
  assert.equal(p.missingParts, true);
  assert.ok(p.releaseDate >= '2026-11-20',
    `vor dem Liefertermin darf nicht gearbeitet werden, war ${p.releaseDate}`);
  assert.equal(p.lateByMaterial, true);
  assert.equal(an.rootCauses[p.id].releaseNote.includes('Material'), true);
});

test('Fehlteile: mehr Personal ändert an Materialverspätung nichts', () => {
  const bauen = (leute) => {
    const ds = seedDataset();
    const ziel = ds.projects.find((p) => p.orderNo === 'WGC40-S00446');
    ziel.missingParts = true;
    ziel.materialAvailableFrom = '2027-03-01';
    const cfg = ds.scenarios.find((s) => s.id === 'BASELINE').config;
    cfg.workforce.useDailyAvailable = false;
    cfg.workforce.team.source = 'ZAHLEN';
    cfg.workforce.weekly = {};
    cfg.workforce.baseHeadcount = leute;
    const an = analyze(ds, 'BASELINE');
    return an.projects.find((p) => p.orderNo === 'WGC40-S00446');
  };
  const wenig = bauen(8);
  const viel = bauen(30);
  assert.equal(wenig.lateByMaterial, true);
  assert.equal(viel.lateByMaterial, true);
  assert.equal(viel.releaseDate, wenig.releaseDate,
    'der früheste Arbeitsbeginn hängt am Material, nicht am Personal');
});
