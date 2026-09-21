/**
 * Tests der Belegungszeit je Arbeitsgang (Schichtbetrieb) und der Kennzahl
 * "Über Kapazität".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, template, run, createProject } from './helpers.js';
import { operatingHours, placesFor, dayCapacity, LIMITER } from '../capacity.js';
import { deadlineShortfall } from '../kpi.js';
import { runSchedule } from '../scheduler.js';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';

/* ------------------------------------------------------------------ *
 * Belegungszeit
 * ------------------------------------------------------------------ */

test('Belegungszeit: eigener Wert je Arbeitsgang hat Vorrang', () => {
  const cfg = testConfig({
    resources: {
      operatingHoursPerDay: 12,
      byOperation: { ORBITAL: { operatingHours: 22.5 }, HEFTEN: { operatingHours: null } },
    },
  });
  assert.equal(operatingHours(cfg, '2026-09-07', 7.5), 12, 'allgemeiner Wert');
  assert.equal(operatingHours(cfg, '2026-09-07', 7.5, 'ORBITAL'), 22.5, 'eigener Wert');
  assert.equal(operatingHours(cfg, '2026-09-07', 7.5, 'HEFTEN'), 12, 'null = allgemeiner Wert');
  assert.equal(operatingHours(cfg, '2026-09-07', 7.5, 'BEIZEN'), 12, 'ohne Eintrag der allgemeine Wert');
});

test('Belegungszeit ist nie kürzer als die Arbeitszeit einer Person', () => {
  const cfg = testConfig({ resources: { operatingHoursPerDay: 4, byOperation: { BEIZEN: { operatingHours: 2 } } } });
  assert.equal(operatingHours(cfg, '2026-09-07', 7.5), 7.5);
  assert.equal(operatingHours(cfg, '2026-09-07', 7.5, 'BEIZEN'), 7.5,
    'ein Platz ist mindestens so lange besetzt, wie gearbeitet wird');
});

test('Plätze: eigener Wert, sonst die bisherigen Einzelwerte', () => {
  const cfg = testConfig({
    resources: {
      heftPlaces: 2, orbitalMachinesActive: 6, hydroStations: null, beizStations: null,
      byOperation: { SAEGEN: { places: 1 }, HEFTEN: { places: 4 } },
    },
  });
  assert.equal(placesFor(cfg, 'SAEGEN'), 1, 'eigener Wert');
  assert.equal(placesFor(cfg, 'HEFTEN'), 4, 'eigener Wert schlägt heftPlaces');
  assert.equal(placesFor(cfg, 'ORBITAL'), 6);
  assert.equal(placesFor(cfg, 'BEIZEN'), null, 'ohne Angabe keine Begrenzung');
  assert.equal(placesFor(cfg, 'ENTGRATEN'), null);
});

test('Drei Schichten am Orbitalschweißen heben die Maschinengrenze an', () => {
  const einSchicht = testConfig({
    workforce: { baseHeadcount: 30 },
    resources: {
      operatingHoursPerDay: 7.5, orbitalMachines: 6, orbitalMachinesActive: 6,
      machinesPerWelder: 2, welders: { default: 8 },
    },
  });
  const dreiSchichten = testConfig({
    workforce: { baseHeadcount: 30 },
    resources: {
      operatingHoursPerDay: 7.5, orbitalMachines: 6, orbitalMachinesActive: 6,
      machinesPerWelder: 2, welders: { default: 8 },
      byOperation: { ORBITAL: { operatingHours: 22.5 } },
    },
  });
  const a = dayCapacity(einSchicht, '2026-09-07').byOp.ORBITAL;
  const b = dayCapacity(dreiSchichten, '2026-09-07').byOp.ORBITAL;
  assert.ok(b.capUnits > a.capUnits * 2.5, `3 Schichten müssen deutlich mehr zulassen (${a.capUnits} -> ${b.capUnits})`);
  assert.equal(a.limiter, LIMITER.ORBITAL_MACHINE, 'vorher begrenzen die Maschinen');
  assert.equal(b.limiter, LIMITER.ORBITAL_WELDER, 'danach die Schweißer');
});

test('Belegungszeit ohne zusätzliches Personal schafft keine Mannstunden', () => {
  const basis = { workforce: { baseHeadcount: 3 }, resources: { operatingHoursPerDay: 7.5, welders: { default: 3 } } };
  const kurz = dayCapacity(testConfig(basis), '2026-09-07');
  const lang = dayCapacity(testConfig({
    ...basis,
    resources: { ...basis.resources, byOperation: { ORBITAL: { operatingHours: 24 }, HEFTEN: { operatingHours: 24 } } },
  }), '2026-09-07');
  assert.equal(kurz.poolHours, lang.poolHours, 'der Mannstundenpool bleibt gleich');
  assert.ok(lang.byOp.ORBITAL.capUnits <= lang.poolHours,
    'kein Arbeitsgang kann mehr Mannstunden verbrauchen, als vorhanden sind');
});

test('Platzbegrenzung wirkt auch bei Arbeitsgängen ohne eigene Regel', () => {
  const input = {
    config: testConfig({
      workforce: { baseHeadcount: 20 },
      resources: { operatingHoursPerDay: 7.5, byOperation: { SAEGEN: { places: 1 } } },
    }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 60 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-18', priority: 'P1' })],
  };
  const res = runSchedule(input);
  const proTag = {};
  for (const a of res.allocations) proTag[a.date] = (proTag[a.date] ?? 0) + a.manHours;
  for (const [datum, stunden] of Object.entries(proTag)) {
    assert.ok(stunden <= 7.5 + 0.01, `${datum}: ${stunden} h – ein Platz kann nicht mehr leisten`);
  }
  const kap = dayCapacity(input.config, '2026-09-07');
  assert.equal(kap.byOp.SAEGEN.limiter, LIMITER.WORKPLACE);
});

test('Zwei Schichten an der Säge verdoppeln deren Tagesleistung', () => {
  const bau = (stunden) => ({
    config: testConfig({
      workforce: { baseHeadcount: 20 },
      resources: { operatingHoursPerDay: 7.5, byOperation: { SAEGEN: { places: 1, operatingHours: stunden } } },
    }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 60 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-18', priority: 'P1' })],
  });
  const ein = runSchedule(bau(7.5));
  const zwei = runSchedule(bau(15));
  const tage = (res) => new Set(res.allocations.map((a) => a.date)).size;
  assert.ok(tage(zwei) < tage(ein), `mit 2 Schichten weniger Tage (${tage(ein)} -> ${tage(zwei)})`);
});

/* ------------------------------------------------------------------ *
 * Kennzahl "Über Kapazität"
 * ------------------------------------------------------------------ */

test('Über Kapazität: 0, wenn die Kapazität bis zu den Terminen reicht', () => {
  const { result } = run({
    config: testConfig({ workforce: { baseHeadcount: 10 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 20 }) },
    projects: [createProject({ id: 'T1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-11-30', priority: 'P1' })],
  });
  const s = deadlineShortfall(result);
  assert.equal(s.hours, 0);
  assert.equal(s.untilDate, null);
});

test('Über Kapazität nennt Stundenzahl und Termin', () => {
  // 2 Mitarbeiter = 75 h je Woche. 600 h bis zum 02.10. sind nicht zu schaffen.
  const projects = Array.from({ length: 3 }, (_, i) => createProject({
    id: `P${i}`, orderNo: `P-${i}`, projectType: 'NEUBAU', variant: 'FT40',
    dueDate: '2026-10-02', priority: 'P1', sequence: i * 10,
  }));
  const { result } = run({
    config: testConfig({ workforce: { baseHeadcount: 2 } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 200 }) },
    projects,
  });
  const s = deadlineShortfall(result);
  assert.ok(s.hours >= 290, `es müssen deutlich Stunden fehlen, waren ${s.hours}`);
  assert.equal(s.untilDate, '2026-10-02');
  assert.ok(s.weekKey?.includes('W40'));
  assert.ok(s.demand > s.capacity);
  // Gegenprobe: die Zahl ist der Fehlbetrag genau zu diesem Termin
  assert.ok(Math.abs(s.hours - (s.demand - s.capacity)) < 0.02);
});

test('Über Kapazität ist termingebunden, nicht die Gesamtdifferenz', () => {
  // Über den ganzen Zeitraum reicht die Kapazität bei Weitem. Der frühe
  // Auftrag ist aber zu groß für die Zeit bis zu seinem Termin.
  const { result, kpis } = run({
    config: testConfig({ workforce: { baseHeadcount: 2 } }),
    templates: {
      NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 300 }),
      NEUBAU_FT20: template('NEUBAU_FT20', 'Klein', { SAEGEN: 20 }),
    },
    projects: [
      createProject({
        id: 'FRUEH', orderNo: 'FRUEH', projectType: 'NEUBAU', variant: 'FT40',
        dueDate: '2026-09-25', priority: 'P1', sequence: 10,
      }),
      createProject({
        id: 'SPAET', orderNo: 'SPAET', projectType: 'NEUBAU', variant: 'FT20',
        dueDate: '2027-02-26', priority: 'P3', sequence: 20,
      }),
    ],
  });
  const gesamtdifferenz = kpis.availableHours - kpis.openHours;
  const s = deadlineShortfall(result);
  assert.ok(gesamtdifferenz > 0, 'in Summe reicht die Kapazität');
  assert.ok(s.hours > 0, 'zum Termin reicht sie trotzdem nicht');
  assert.equal(kpis.shortfallHours, s.hours, 'die Kennzahl übernimmt genau diesen Wert');
});

test('Über Kapazität im Startdatenbestand ist plausibel', () => {
  const res = runSchedule(materialize(seedDataset(), 'BASELINE'));
  const s = deadlineShortfall(res);
  assert.ok(s.hours > 500 && s.hours < 10000, `plausibler Bereich, war ${s.hours}`);
  assert.ok(s.untilDate && s.weekKey, 'Termin und Kalenderwoche werden benannt');
  assert.equal(s.steps.length, res.projects.filter((p) => p.dueDate && p.remainingManHours > 0).length,
    'je Termin ein Vergleichspunkt');
});

test('Mehr Kapazität verringert den Überhang', () => {
  const bau = (mitarbeiter) => runSchedule({
    config: testConfig({ workforce: { baseHeadcount: mitarbeiter } }),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 200 }) },
    projects: Array.from({ length: 3 }, (_, i) => createProject({
      id: `P${i}`, projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-10-02', sequence: i * 10,
    })),
  });
  const wenig = deadlineShortfall(bau(2)).hours;
  const viel = deadlineShortfall(bau(10)).hours;
  assert.ok(viel < wenig, `mehr Personal = weniger Überhang (${wenig} -> ${viel})`);
});

test('Über Kapazität hält sich an den gewählten Zeitraum', () => {
  /*
   * FIX (gemeldet 21.09.2026 anhand eines Bildschirmfotos): "+1.932 h über
   * Kapazität" in der Kopfzeile änderte sich nicht, wenn im Feld "Zeitraum"
   * ein kürzeres Ende gewählt wurde - deadlineShortfall() suchte den
   * größten Fehlbetrag über ALLE Termine, auch weit hinter dem gewählten
   * Zeitraum. Ein Termin, der außerhalb des gewählten Fensters liegt, darf
   * dessen Kennzahl nicht mehr bestimmen.
   */
  const { result } = run({
    config: testConfig({ workforce: { baseHeadcount: 2 } }),
    templates: {
      NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 300 }),
      NEUBAU_FT20: template('NEUBAU_FT20', 'Klein', { SAEGEN: 20 }),
    },
    projects: [
      createProject({
        id: 'FRUEH', orderNo: 'FRUEH', projectType: 'NEUBAU', variant: 'FT20',
        dueDate: '2026-09-25', priority: 'P1', sequence: 10,
      }),
      createProject({
        id: 'SPAET', orderNo: 'SPAET', projectType: 'NEUBAU', variant: 'FT40',
        dueDate: '2027-02-26', priority: 'P3', sequence: 20,
      }),
    ],
  });
  const ohneFenster = deadlineShortfall(result);
  const mitFenster = deadlineShortfall(result, '2026-10-31');
  assert.ok(ohneFenster.untilDate > '2026-10-31',
    `der größte Fehlbetrag liegt ohne Fenster beim späten Termin (${ohneFenster.untilDate})`);
  assert.ok(mitFenster.untilDate === null || mitFenster.untilDate <= '2026-10-31',
    `mit Fenster darf kein Termin nach dem Fensterende genannt werden (${mitFenster.untilDate})`);
});
