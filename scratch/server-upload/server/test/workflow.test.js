/**
 * Durchgaengiger Bedienablauf laut Lastenheft §93.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.js';
import { createApi } from '../api.js';

function freshApi() {
  return createApi(openStore(fs.mkdtempSync(path.join(os.tmpdir(), 'megc-flow-'))));
}

/**
 * Leiharbeiter ueber die MANNSCHAFT einplanen - der einzige Weg, auf dem
 * Personal in die Rechnung kommt (Vorgabe 17.09.2026).
 */
function mitLeihe(api, scenarioId, anzahl, ab) {
  const cfg = api.scenarioConfig(scenarioId).config;
  const people = (cfg.workforce.team.people ?? []).map((p) => ({ ...p }));
  let offen = anzahl;
  for (const p of people) {
    if (offen === 0) break;
    if (p.kind !== 'LEIHE' || p.startDate) continue;
    p.startDate = ab;
    p.defaultActive = true;
    offen -= 1;
  }
  api.updateScenario(scenarioId, { config: { workforce: { team: { people } } } });
}

test('§93 Vollständiger Bedienablauf', () => {
  const api = freshApi();

  // 1./2. Aktuelle Planung ansehen
  const start = api.analysis('BASELINE');
  assert.ok(start.kpis.totalProjects >= 11);
  const otdStart = start.kpis.otd;

  // 3./4. Engpass und Ursache erkennen
  assert.ok(start.kpis.firstOverloadWeek, 'Es muss eine Überlastwoche erkannt werden');
  assert.ok(start.kpis.bottleneck?.label, 'Es muss ein Engpass benannt werden');
  assert.ok(start.bottleneckByOperation.length > 0);
  const spaet = start.projects.find((p) => p.status === 'VERSPAETET');
  assert.ok(spaet, 'Im Ausgangszustand muss es verspätete Projekte geben');
  assert.ok(start.rootCauses[spaet.id].text.includes('verspätet'));

  // 5. Baseline duplizieren
  const sc = api.createScenario({ name: 'Simulation', sourceId: 'BASELINE' });
  assert.notEqual(sc.id, 'BASELINE');

  // 6./7. Leiharbeiter in der Mannschaft einplanen und neu rechnen
  mitLeihe(api, sc.id, 3, '2026-09-28');
  const mitLeih = api.analysis(sc.id);

  // 8. Auswirkung sehen
  assert.ok(mitLeih.kpis.availableHours > start.kpis.availableHours);
  const impact1 = api.impact(sc.id, 'BASELINE');
  assert.ok(impact1.delta.availableHours > 0);

  // 9./10. Samstagsarbeit aktivieren
  api.updateScenario(sc.id, { config: { saturday: { weeks: { '2026-W41': { enabled: true }, '2026-W42': { enabled: true } } } } });
  const mitSamstag = api.analysis(sc.id);
  const kw = (a, key) => a.weeks.find((w) => w.weekKey === key);
  assert.ok(kw(mitSamstag, '2026-W41').capacity > kw(mitLeih, '2026-W41').capacity,
    'Samstagsarbeit muss die Wochenkapazität erhöhen');
  assert.ok(mitSamstag.kpis.availableHours > mitLeih.kpis.availableHours);
  assert.ok(mitSamstag.weeks.some((w) => w.weekKey === '2026-W41' && w.saturday));

  // 11./12. NoBo-Anwesenheit ändern
  api.updateScenario(sc.id, { config: { nobo: { weekdays: [2, 3, 4] } } });
  const mitNobo = api.analysis(sc.id);
  const hydroBlocked = (a) => a.bottleneckByOperation.find((b) => b.opId === 'HYDRO')?.manHours ?? 0;
  assert.ok(hydroBlocked(mitNobo) <= hydroBlocked(mitSamstag) + 0.01,
    'Ein zusätzlicher NoBo-Tag darf den Hydro-Engpass nicht vergrößern');

  // 13. Reihenfolge automatisch optimieren lassen
  const opt = api.optimize(sc.id, { objective: 'MAX_OTD', mode: 'proposals', maxRounds: 3 });
  assert.ok(opt.proposals.length > 0);
  const best = opt.proposals[0];
  assert.ok(best.kpisAfter.otd >= best.kpisBefore.otd);

  // 14. Mit der Baseline vergleichen
  const applied = api.applyProposal(sc.id, {
    config: best.config, measures: best.measures, asNewScenario: true, name: 'Maßnahmenpaket',
  });
  const cmp = api.compare(['BASELINE', sc.id, applied.id]);
  assert.equal(cmp.length, 3);
  assert.ok(cmp[2].kpis.otd >= cmp[0].kpis.otd);
  assert.ok(cmp[2].kpis.late <= cmp[0].kpis.late);

  // 15. Baseline ist unverändert geblieben
  const baselineNachher = api.analysis('BASELINE');
  assert.equal(baselineNachher.kpis.otd, otdStart);
  assert.equal(api.scenarioConfig('BASELINE').config.workforce.tempWorkers.length, 0);
  assert.equal((api.scenarioConfig('BASELINE').config.workforce.team.people ?? [])
    .filter((p) => p.kind === 'LEIHE' && p.startDate).length, 5,
  'die Baseline führt nur die fünf zugesagten Leiharbeiter');

  // Der Gesamtdatenbestand bleibt konsistent
  assert.equal(baselineNachher.projects.length, baselineNachher.gantt.length);
});

test('§45 Manuelles Vorziehen eines Projektes wirkt sich aus', () => {
  const api = freshApi();
  api.updateScenario('BASELINE', { config: { sequencing: { rule: 'MANUAL' } } });
  const before = api.analysis('BASELINE');
  const ids = api.state().projects.map((p) => p.id);
  const letztes = ids[ids.length - 1];

  api.reorderProjects([letztes, ...ids.slice(0, -1)]);
  const after = api.analysis('BASELINE');

  const vorher = before.projects.find((p) => p.id === letztes);
  const nachher = after.projects.find((p) => p.id === letztes);
  assert.ok(nachher.start <= vorher.start, 'Das vorgezogene Projekt muss früher starten');
  assert.notEqual(JSON.stringify(before.projects.map((p) => p.forecastFinish)),
    JSON.stringify(after.projects.map((p) => p.forecastFinish)),
    'Die Planung muss tatsächlich neu gerechnet werden');
});

test('§88 Überlast im Startdatenbestand wird nicht schöngerechnet', () => {
  const api = freshApi();
  // Massive Überlast erzeugen: Personal drastisch reduzieren
  api.updateScenario('BASELINE', { config: { workforce: { baseHeadcount: 2 } } });
  const a = api.analysis('BASELINE');
  assert.ok(a.kpis.late > 0, 'Bei massiver Überlast MUSS es verspätete Projekte geben');
  assert.ok(a.kpis.otd < 100);
  for (const d of a.days) {
    assert.ok(d.planned <= d.capacity + 0.02, `Tag ${d.date}: mehr verplant als vorhanden`);
  }
});

test('Alle Maßnahmentypen des Optimierers erzeugen gültige Konfigurationen', () => {
  const api = freshApi();
  // Engpaesse an mehreren Stellen erzeugen
  api.updateScenario('BASELINE', {
    config: {
      workforce: { baseHeadcount: 6 },
      resources: { heftPlaces: 1, workersPerHeftPlace: 1, welders: { default: 1, byWeekday: {} } },
    },
  });
  const r = api.optimize('BASELINE', { mode: 'proposals', maxRounds: 4 });
  assert.ok(r.proposals.length > 0);
  const types = new Set(r.proposals.flatMap((p) => p.measures.map((m) => m.type)));
  assert.ok(types.size >= 2, `Es sollten verschiedene Maßnahmentypen vorkommen: ${[...types]}`);
  for (const p of r.proposals) {
    assert.ok(p.config.productivity.global > 0);
    assert.equal(p.config.outsourcing.enabled, false);
    assert.ok(p.config.resources.heftPlaces <= p.config.resources.heftPlacesMax);
  }
});
