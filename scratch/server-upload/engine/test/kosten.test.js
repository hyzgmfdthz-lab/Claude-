/**
 * Tests der Kostenrechnung.
 *
 * Grundlage sind die Angaben der Abteilungsleitung: Stundenlohn 19-26 EUR,
 * Arbeitgeberanteile Faktor 1,3, Mehrarbeit und Samstag je +35 %,
 * Spaetschicht 24 EUR je Schicht anteilig, Nachtschicht +40 %,
 * Leiharbeit 45-65 EUR als Rechnungssatz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../defaults.js';
import { hourlyCost, costRates, overtimeVersusTemp } from '../costs.js';
import { peopleOf } from '../team.js';

const STAMM = { kind: 'STAMM' };
const LEIHE = { kind: 'LEIHE' };

test('Kosten: Arbeitgeberanteile wirken auf den Lohn, nicht auf die Leiharbeit', () => {
  const c = defaultConfig();
  assert.equal(c.costs.employerFactor, 1.3);
  // 22,50 € Lohn × 1,3 = 29,25 €
  assert.equal(hourlyCost(c, STAMM, 'REGULAR'), 29.25);
  // Der Rechnungssatz der Leiharbeit bleibt unangetastet
  assert.equal(hourlyCost(c, LEIHE, 'REGULAR'), 55);
});

test('Kosten: Zuschläge nach den Angaben der Abteilung', () => {
  const c = defaultConfig();
  // +35 % auf den Lohn, dann Arbeitgeberfaktor: 22,50 × 1,3 × 1,35
  assert.equal(hourlyCost(c, STAMM, 'OVERTIME'), 39.49);
  assert.equal(hourlyCost(c, STAMM, 'SATURDAY'), 39.49);
  // Nacht: +40 %
  assert.equal(hourlyCost(c, STAMM, 'NIGHT'), 40.95);
  // Spätschicht: 24 € je 7,5-h-Schicht = 3,20 €/h, ebenfalls mit Faktor
  assert.equal(hourlyCost(c, STAMM, 'LATE'), 33.41);
  assert.ok(hourlyCost(c, STAMM, 'LATE') < hourlyCost(c, STAMM, 'NIGHT'));
});

test('Kosten: eigener Satz je Person schlägt den Vorgabewert', () => {
  const c = defaultConfig();
  const jaro = peopleOf(c).find((p) => p.id === 'JARO');
  jaro.rate = 26;
  assert.equal(hourlyCost(c, jaro, 'REGULAR'), 33.8, '26 € × 1,3');
  const leihe = peopleOf(c).find((p) => p.kind === 'LEIHE');
  leihe.rate = 45;
  assert.equal(hourlyCost(c, leihe, 'REGULAR'), 45, 'günstige Leihkraft ohne Aufschlag');
});

test('Kosten: Mehrarbeit gegen Leiharbeit – die Zahl für den Betriebsrat', () => {
  const c = defaultConfig();
  const v = overtimeVersusTemp(c);
  assert.equal(v.cheaper, 'OVERTIME');
  assert.equal(v.overtime, 39.49);
  assert.equal(v.temp, 55);
  assert.equal(v.difference, 15.51);
  assert.match(v.text, /Mehrarbeit ist mit 39.49/);

  // Am oberen Ende des Lohnbands und mit günstiger Leiharbeit kippt es
  const teuer = defaultConfig();
  teuer.costs.baseRate = 26;
  teuer.costs.tempRate = 45;
  const w = overtimeVersusTemp(teuer);
  assert.equal(w.cheaper, 'TEMP');
  assert.match(w.text, /Leiharbeit ist mit 45/);
});

test('Kosten: Übersicht nennt jede Art mit Erklärung', () => {
  const r = costRates(defaultConfig());
  assert.equal(r.currency, 'EUR');
  assert.equal(r.rows.length, 6);
  for (const z of r.rows) {
    assert.ok(z.label && z.note, 'jede Zeile mit Beschriftung und Erklärung');
    assert.ok(z.cost > 0);
  }
  assert.equal(r.rows.find((z) => z.key === 'TEMP').note.includes('enthalten'), true,
    'beim Leiharbeiter muss dranstehen, dass die Nebenkosten enthalten sind');
});

test('Kosten: ohne Arbeitgeberfaktor bleibt der Lohn stehen', () => {
  const c = defaultConfig();
  c.costs.employerFactor = 1;
  assert.equal(hourlyCost(c, STAMM, 'REGULAR'), 22.5);
  assert.equal(hourlyCost(c, STAMM, 'OVERTIME'), 30.38);
});

/* ------------------------------------------------------------------ *
 * Zubehoer und Kleinarbeiten
 * ------------------------------------------------------------------ */

test('Zubehör: die Reserve geht vor den Aufträgen von der Kapazität ab', async () => {
  const { dayCapacity, reserveHoursPerDay } = await import('../capacity.js');
  const ohne = defaultConfig();
  ohne.workforce.reserveHoursPerWeek = 0;
  const mit = defaultConfig();
  mit.workforce.reserveHoursPerWeek = 25;

  // Vorbelegt sind 18 h je Woche (Auskunft 09/2026: "12-24 Mannstunden ca.")
  assert.equal(defaultConfig().workforce.reserveHoursPerWeek, 18);
  assert.equal(defaultConfig().workforce.reserveHoursValidated, false,
    'die Spanne ist eine Schätzung und ausdrücklich zu validieren');
  assert.equal(reserveHoursPerDay(ohne), 0, 'auf 0 gestellt keine Reserve');
  assert.equal(reserveHoursPerDay(mit), 5, '25 h auf fünf Werktage');

  const a = dayCapacity(ohne, '2026-09-14');
  const b = dayCapacity(mit, '2026-09-14');
  assert.equal(b.reserveHours, 5);
  assert.equal(Math.round((a.poolHours - b.poolHours) * 100) / 100, 5,
    'die Tageskapazität sinkt um genau diese Stunden');
  assert.equal(a.poolGross, b.poolGross, 'die Bruttokapazität bleibt gleich – abgezogen wird sichtbar');
});

test('Zubehör: mehr Reserve bedeutet mehr Überhang', async () => {
  const { seedDataset } = await import('../seed.js');
  const { analyze } = await import('../index.js');
  const messe = (stunden) => {
    const ds = seedDataset();
    ds.scenarios.find((s) => s.id === 'BASELINE').config.workforce.reserveHoursPerWeek = stunden;
    const an = analyze(ds, 'BASELINE');
    return { kapazitaet: an.kpis.availableHours, ueberhang: an.kpis.shortfallHours ?? 0 };
  };
  const ohne = messe(0);
  const mit = messe(25);
  assert.ok(mit.kapazitaet < ohne.kapazitaet, 'die verfügbare Kapazität sinkt');
  assert.ok(mit.ueberhang > ohne.ueberhang, 'der Überhang steigt – der Plan wird ehrlicher');
});

test('Zubehör: am Samstag wird keine Reserve abgezogen', async () => {
  const { dayCapacity } = await import('../capacity.js');
  const c = defaultConfig();
  c.workforce.reserveHoursPerWeek = 25;
  c.saturday.enabledDefault = true;
  const samstag = dayCapacity(c, '2026-09-19');
  assert.equal(samstag.reserveHours, 0, 'Samstagsarbeit ist für Aufträge gedacht');
});
