/**
 * Robustheit, Grenzfaelle und Leistung.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, template, run, createProject } from './helpers.js';
import { runSchedule } from '../scheduler.js';
import { analyze } from '../index.js';
import { seedDataset } from '../seed.js';
import { validate } from '../validation.js';
import { dayCapacity } from '../capacity.js';
import { defaultConfig, defaultRoutingTemplates } from '../defaults.js';
import { resolveRouting } from '../routing.js';
import { createProject as mkProject } from '../model.js';

test('Grenzfall: keine Projekte', () => {
  const { result, kpis } = run({ config: testConfig(), templates: {}, projects: [] });
  assert.equal(result.projects.length, 0);
  assert.equal(kpis.otd, 100);
  assert.equal(kpis.openHours, 0);
});

test('Grenzfall: keine Kapazität (0 Mitarbeiter)', () => {
  const { result } = run({
    config: testConfig({ workforce: { baseHeadcount: 0 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 50 }) },
    projects: [createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' })],
  });
  assert.equal(result.allocations.length, 0);
  assert.equal(result.projects[0].status, 'VERSPAETET');
  assert.equal(result.projects[0].notCompletable, true);
});

test('Grenzfall: Projekt ohne Fertigstellungstermin', () => {
  const { result } = run({
    config: testConfig(),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 30 }) },
    projects: [createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: null })],
  });
  assert.equal(result.projects[0].status, 'OHNE_TERMIN');
  assert.ok(result.projects[0].forecastFinish);
});

test('Grenzfall: Arbeitsfolge ohne Stunden', () => {
  const { result } = run({
    config: testConfig(),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 0, HEFTEN: 0 }) },
    projects: [createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' })],
  });
  assert.equal(result.projects[0].status, 'FERTIG');
  assert.equal(result.allocations.length, 0);
});

test('Grenzfall: fehlende Arbeitsfolge führt nicht zum Absturz', () => {
  const { result } = run({
    config: testConfig(),
    templates: {},
    projects: [createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' })],
  });
  assert.equal(result.projects[0].missingTemplate, true);
  assert.equal(result.projects[0].totalManHours, 0);
});

test('Grenzfall: Zyklus in der Arbeitsfolge blockiert die Engine nicht', () => {
  const templates = {
    NEUBAU_FT40: {
      key: 'NEUBAU_FT40', label: 'Zyklus', validated: true,
      steps: [
        { opId: 'SAEGEN', hours: 10, predecessors: [{ opId: 'HEFTEN', type: 'FS' }] },
        { opId: 'HEFTEN', hours: 10, predecessors: [{ opId: 'SAEGEN', type: 'FS' }] },
      ],
    },
  };
  const t0 = Date.now();
  const { result } = run({
    config: testConfig({ horizonDays: 60 }),
    templates,
    projects: [createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' })],
  });
  assert.ok(Date.now() - t0 < 5000, 'Die Engine darf nicht hängen bleiben');
  assert.equal(result.projects[0].notCompletable, true);
});

test('Grenzfall: unsinnige Werte werden abgefangen', () => {
  const cfg = testConfig({
    productivity: { global: -1 },
    workforce: { baseHeadcount: -5 },
    resources: { orbitalMachinesActive: -2, heftPlaces: -1 },
  });
  const cap = dayCapacity(cfg, '2026-09-07');
  assert.ok(cap.poolHours >= 0);
  assert.ok(cap.byOp.HEFTEN.capUnits >= 0);
  assert.ok(cap.byOp.ORBITAL.capUnits >= 0);
});

test('Grenzfall: sehr grosse Stundenzahl bleibt beherrschbar', () => {
  const { result } = run({
    config: testConfig({ horizonDays: 120 }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'T', { SAEGEN: 1e6 }) },
    projects: [createProject({ id: 'A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-01' })],
  });
  assert.equal(result.projects[0].notCompletable, true);
  assert.ok(result.projects[0].openManHoursAfterHorizon > 900000);
});

test('Leistung: 60 Projekte werden in unter 2 Sekunden gerechnet', () => {
  const templates = defaultRoutingTemplates();
  const variants = ['FT20', 'FT30', 'FT40', 'FT45'];
  const projects = Array.from({ length: 60 }, (_, i) => mkProject({
    id: `P${i}`, orderNo: `X-${i}`, projectType: i % 5 === 0 ? 'UMBAU' : 'NEUBAU',
    variant: i % 5 === 0 ? null : variants[i % 4],
    dueDate: `2026-${String(10 + (i % 3)).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
    priority: `P${(i % 4) + 1}`, sequence: i * 10,
  }));
  const input = { config: defaultConfig(), templates, projects };
  const t0 = Date.now();
  const result = runSchedule(input);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `Zu langsam: ${ms} ms`);
  assert.equal(result.projects.length, 60);
  for (const d of result.daySeries) {
    assert.ok(d.poolUsed <= d.poolCapacity + 0.02);
  }
});

test('Leistung: vollständige Analyse des Startdatenbestands unter 300 ms', () => {
  const data = seedDataset();
  analyze(data, 'BASELINE');
  const t0 = Date.now();
  const a = analyze(data, 'BASELINE');
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `Zu langsam: ${ms} ms`);
  assert.equal(a.kpis.totalProjects, 37);
});

test('Stabilität: zehn aufeinanderfolgende Läufe liefern identische Ergebnisse', () => {
  const data = seedDataset();
  const reference = JSON.stringify(analyze(data, 'BASELINE').projects.map((p) => [p.id, p.forecastFinish, p.status]));
  for (let i = 0; i < 10; i++) {
    const now = JSON.stringify(analyze(data, 'BASELINE').projects.map((p) => [p.id, p.forecastFinish, p.status]));
    assert.equal(now, reference, `Lauf ${i + 1} weicht ab`);
  }
});

test('Stabilität: Startdatenbestand verändert sich durch die Analyse nicht', () => {
  const data = seedDataset();
  const before = JSON.stringify(data);
  analyze(data, 'BASELINE');
  analyze(data, 'BASELINE');
  assert.equal(JSON.stringify(data), before);
});

test('Datenprüfung läuft auch bei kaputten Daten durch', () => {
  const issues = validate({
    config: defaultConfig(),
    templates: defaultRoutingTemplates(),
    projects: [
      { id: 'A' },
      mkProject({ id: 'B', projectType: 'GIBTESNICHT', dueDate: 'kaputt', priority: 'P9' }),
    ],
  });
  assert.ok(issues.length > 0);
  assert.ok(issues.some((i) => i.code === 'PROJEKTART_UNGUELTIG'));
  assert.ok(issues.some((i) => i.code === 'TERMIN_UNGUELTIG'));
  assert.ok(issues.some((i) => i.code === 'PRIORITAET_UNGUELTIG'));
});

test('Fortschritt: 100 % bedeutet kein Restaufwand', () => {
  const p = mkProject({ projectType: 'NEUBAU', variant: 'FT40', progressMode: 'PERCENT', progressPercent: 100 });
  const r = resolveRouting(p, defaultRoutingTemplates(), defaultConfig());
  assert.equal(r.remainingManHours, 0);
});

test('Alle Startprojekte erhalten eine vollständige Auswertung', () => {
  const a = analyze(seedDataset(), 'BASELINE');
  for (const p of a.projects) {
    assert.ok(p.id && p.status, 'Status fehlt');
    assert.ok(Array.isArray(p.operations), 'Arbeitsgänge fehlen');
    assert.ok(a.rootCauses[p.id], 'Ursachenanalyse fehlt');
    assert.ok(Number.isFinite(p.totalManHours));
    assert.ok(Number.isFinite(p.remainingManHours));
    assert.ok(p.remainingManHours <= p.totalManHours + 0.01);
  }
});

test('Konfiguration mischen: ein null-Vorgabewert wirft nicht', async () => {
  const { deepMerge } = await import('../model.js');
  /*
   * Steht im Vorgabewert null ("noch nichts eingelesen") und kommt aus dem
   * Szenario ein Objekt, lief die Rechnung mit "Cannot use 'in' operator"
   * auf einen Fehler - typeof null ist ebenfalls 'object'. Der Steuerstand
   * blieb dann leer.
   */
  assert.deepEqual(deepMerge({ a: null }, { a: { from: 'x' } }), { a: { from: 'x' } });
  assert.deepEqual(deepMerge({ a: { from: 'x' } }, { a: null }), { a: { from: 'x' } },
    'ausdrueckliches null im Szenario loescht den Vorgabewert nicht');
  assert.deepEqual(deepMerge(null, { a: 1 }), { a: 1 });
  assert.deepEqual(deepMerge({ a: { b: 1 } }, { a: { c: 2 } }), { a: { b: 1, c: 2 } },
    'das normale Mischen bleibt unberuehrt');
});

test('Startdatenbestand rechnet mit den neuen Feldern fehlerfrei durch', async () => {
  const { seedDataset } = await import('../seed.js');
  const { analyze } = await import('../index.js');
  const ds = seedDataset();
  // Genau der Weg, der in der Oberflaeche einen leeren Steuerstand ergab
  const a = analyze(ds, ds.activeScenarioId);
  assert.ok(a.kpis.totalProjects > 0);
  assert.ok(a.plausibility.items.length > 0);
  assert.equal(a.config.workforce.attendanceImport, null, 'ohne Einlesen bleibt das Feld leer');
});
