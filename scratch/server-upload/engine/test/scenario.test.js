import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset } from '../seed.js';
import { mitZusatzPersonal } from '../team.js';
import { materialize, duplicateScenario, resetScenario } from '../scenario.js';
import { analyze } from '../index.js';
import { optimize, proposeSolutions, evaluate, kpiDelta, projectStatusDiff, summarize, whatHelps } from '../optimizer.js';
import { runSchedule } from '../scheduler.js';
import { deepClone } from '../model.js';

test('Szenario: Baseline bleibt bei Duplikat unverändert (§69)', () => {
  const data = seedDataset();
  const baselineBefore = JSON.stringify(data.scenarios[0]);
  const copy = duplicateScenario(data, 'BASELINE', '+4 Leiharbeiter');
  copy.config = mitZusatzPersonal(copy.config, 4, '2026-09-28');
  copy.config.productivity.global = 0.95;
  assert.equal(JSON.stringify(data.scenarios[0]), baselineBefore, 'Die Baseline darf sich nicht verändern');
  assert.equal(data.scenarios.length, 4); // Baseline, S2, S3 + Kopie
  assert.notEqual(copy.id, 'BASELINE');
});

test('Szenario: Änderungen wirken sich messbar aus (§71)', () => {
  const data = seedDataset();
  const base = analyze(data, 'BASELINE');
  const copy = duplicateScenario(data, 'BASELINE', 'Mehr Personal');
  // Personal kommt ausschliesslich ueber die Mannschaft in die Rechnung -
  // die alten Zahlenlisten wirken dort nicht mehr.
  copy.config = mitZusatzPersonal(copy.config, 6, '2026-09-14');
  const scen = analyze(data, copy.id);
  assert.ok(scen.kpis.availableHours > base.kpis.availableHours);
  assert.ok(scen.kpis.otd >= base.kpis.otd);
  const delta = kpiDelta(base.kpis, scen.kpis);
  assert.ok(delta.availableHours > 0);
});

test('Szenario: Projektübersteuerungen ändern die zentrale Datenquelle nicht (§76)', () => {
  const data = seedDataset();
  const copy = duplicateScenario(data, 'BASELINE', 'Termin verschoben');
  const koncar = data.projects.find((p) => p.orderNo === 'WGC40-S00440');
  const originalDue = koncar.dueDate;
  copy.projectOverrides[koncar.id] = { dueDate: '2026-11-30' };
  const m = materialize(data, copy.id);
  assert.equal(m.projects.find((p) => p.id === koncar.id).dueDate, '2026-11-30');
  assert.equal(data.projects.find((p) => p.id === koncar.id).dueDate, originalDue);
  assert.equal(m.projects.length, data.projects.length);
});

test('Szenario: Reihenfolge-Übersteuerung wirkt (§45)', () => {
  const data = seedDataset();
  const copy = duplicateScenario(data, 'BASELINE', 'Reihenfolge getauscht');
  copy.config.sequencing.rule = 'MANUAL';
  const ids = data.projects.map((p) => p.id);
  copy.sequenceOverride = [...ids].reverse();
  const m = materialize(data, copy.id);
  const first = m.projects.find((p) => p.id === ids[ids.length - 1]);
  const last = m.projects.find((p) => p.id === ids[0]);
  assert.ok(first.sequence < last.sequence);
});

test('Szenario: Zurücksetzen stellt die Baseline-Parameter wieder her', () => {
  const data = seedDataset();
  const copy = duplicateScenario(data, 'BASELINE', 'Test');
  copy.config.productivity.global = 0.5;
  resetScenario(data, copy.id);
  assert.equal(copy.config.productivity.global, data.scenarios[0].config.productivity.global);
});

test('Optimierer: verbessert die Termintreue und liefert nachvollziehbare Maßnahmen (§67)', () => {
  const data = seedDataset();
  const input = materialize(data, 'BASELINE');
  const t0 = Date.now();
  const r = optimize(input, { objective: 'MAX_OTD' });
  const dauer = Date.now() - t0;
  assert.ok(r.measures.length > 0, 'Es müssen Maßnahmen vorgeschlagen werden');
  assert.ok(r.kpisAfter.otd > r.kpisBefore.otd, 'Die Termintreue muss steigen');
  assert.ok(r.kpisAfter.late < r.kpisBefore.late);
  /*
   * Budget 25.09.2026 von 20000 auf 25000 ms angehoben: die Aushilfe an
   * Endkontrolle/Entgraten/Hydro (Nutzeranforderung 25.09.2026) macht den
   * dritten Endkontrolle-Platz zu einer echten, zusaetzlichen Massnahme
   * (siehe "Zusätzlicher Arbeitsplatz..."-Test) - ein Kandidat mehr je
   * Optimierungsrunde. Per direktem Benchmark bestaetigt: runSchedule()
   * selbst wurde durch die Aushilfe NICHT langsamer (30 Laeufe alt vs neu
   * im Rahmen der Messschwankung). Dieses Testbudget schwankte in dieser
   * Sandbox schon vor der Aushilfe zwischen 18,98 s und 24,5 s.
   */
  assert.ok(dauer < 25000, `Optimierung zu langsam: ${dauer} ms`);
  for (const m of r.measures) {
    assert.ok(m.label && m.description, 'Jede Maßnahme braucht eine verständliche Beschreibung');
  }
});

test('Optimierer: Fremdvergabe wird niemals vorgeschlagen (§24)', () => {
  const data = seedDataset();
  const r = optimize(materialize(data, 'BASELINE'), { objective: 'MAX_OTD' });
  assert.equal(r.config.outsourcing.enabled, false);
  assert.equal(r.measures.some((m) => /fremd|extern/i.test(m.label + m.description)), false);
});

test('Optimierer: verändert die Ausgangsdaten nicht (nur Vorschlag, §44)', () => {
  const data = seedDataset();
  const snapshot = JSON.stringify(data);
  optimize(materialize(data, 'BASELINE'), { objective: 'MAX_OTD' });
  assert.equal(JSON.stringify(data), snapshot, 'Der Optimierer darf keine Daten verändern');
});

test('Optimierer: mehrere alternative Lösungsvarianten (§65)', () => {
  const data = seedDataset();
  const solutions = proposeSolutions(materialize(data, 'BASELINE'), { maxRounds: 3 });
  assert.ok(solutions.length >= 2, 'Es müssen mehrere Lösungswege angeboten werden');
  for (const s of solutions) {
    assert.ok(s.title && s.measures.length > 0);
    assert.ok(s.kpisAfter.late <= s.kpisBefore.late);
  }
  // Variante "Ohne Samstagsarbeit" darf keine Samstage enthalten
  const noSat = solutions.find((s) => s.title === 'Ohne Samstagsarbeit');
  if (noSat) assert.equal(noSat.measures.some((m) => m.type === 'SATURDAY'), false);
  const noStaff = solutions.find((s) => s.title === 'Ohne zusätzliches Personal');
  if (noStaff) assert.equal(noStaff.measures.some((m) => m.type === 'TEMP' || m.type === 'HIRE'), false);
});

test('Optimierer: erkennt engpassspezifische Maßnahmen (§66)', () => {
  // Reiner Heftplatz-Engpass: zusätzliche allgemeine Mitarbeiter helfen nicht
  const data = seedDataset();
  const input = materialize(data, 'BASELINE');
  input.config.resources.heftPlaces = 1;
  input.config.resources.workersPerHeftPlace = 1;
  input.config.workforce.baseHeadcount = 40;
  // Die Plaetze der Werkstatt hier ausblenden - geprueft wird der Heftplatz
  input.config.resources.byOperation = {};
  input.config.resources.hydroStations = null;
  input.config.resources.beizStations = null;
  const ev = evaluate(input);
  const causes = Object.fromEntries(ev.kpis.bottleneckRanking.map((c) => [c.cause, c.manHours]));
  assert.ok((causes.HEFTPLATZ ?? 0) > 0, 'Der Heftplatz muss als Engpass erkannt werden');
  const r = optimize(input, { objective: 'MAX_OTD' });
  assert.ok(r.measures.some((m) => m.type === 'HEFT_PLACE'), 'Ein zusätzlicher Heftplatz muss vorgeschlagen werden');
});

test('Optimierer: Statusvergleich zeigt Rot -> Grün Wechsel (§70/§71)', () => {
  const data = seedDataset();
  const input = materialize(data, 'BASELINE');
  const before = runSchedule(input);
  const r = optimize(input, { objective: 'MAX_OTD' });
  const after = runSchedule({ ...input, config: r.config });
  const diff = projectStatusDiff(before, after);
  assert.ok(diff.length > 0, 'Es müssen Statusänderungen sichtbar werden');
  assert.ok(diff.some((d) => d.from === 'VERSPAETET' && d.to !== 'VERSPAETET'));
  void summarize; void deepClone;
});

test('Analyse: Ergebnis enthält alle Auswertungsbausteine', () => {
  const data = seedDataset();
  const a = analyze(data, 'BASELINE');
  for (const key of ['kpis', 'projects', 'days', 'weeks', 'processBalance', 'orbital', 'rootCauses', 'validation', 'gantt']) {
    assert.ok(a[key], `Baustein ${key} fehlt`);
  }
  assert.ok(a.days.length > 0);
  assert.ok(a.weeks.length > 0);
  // 13 Arbeitsgaenge der Werkstatt (Orbitalschweissen aufgeteilt in Kehlnaht
  // und Stumpfnaht, dazu Handschweißen und Molchen) plus die Arbeitsvorbereitung
  assert.equal(a.processBalance.length, 14);
  assert.ok(a.orbital.machinesInstalled >= 1);
  assert.ok(a.orbital.machineHoursCapacity >= a.orbital.manHoursCapacity);
  for (const p of a.projects) {
    assert.ok(a.rootCauses[p.id], `Ursachenanalyse fehlt für ${p.id}`);
    assert.ok(typeof a.rootCauses[p.id].text === 'string' && a.rootCauses[p.id].text.length > 0);
  }
});

test('Leistung: eine vollständige Analyse dauert deutlich unter einer Sekunde (§89)', () => {
  const data = seedDataset();
  analyze(data, 'BASELINE'); // Aufwärmen
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) analyze(data, 'BASELINE');
  const avg = (Date.now() - t0) / 5;
  assert.ok(avg < 1000, `Analyse zu langsam: ${avg} ms`);
});

test('Szenarien der bisherigen Planung sind hinterlegt und wirken', () => {
  const data = seedDataset();
  const namen = data.scenarios.map((s) => s.id);
  assert.deepEqual(namen, ['BASELINE', 'SZN-S2', 'SZN-S3']);
  const base = analyze(data, 'BASELINE');
  const s2 = analyze(data, 'SZN-S2');
  const s3 = analyze(data, 'SZN-S3');
  // Jede Ausbaustufe muss die Gesamtverspätung verringern
  assert.ok(s2.kpis.totalLateDays < base.kpis.totalLateDays, 'S2 muss besser sein als der Regelbetrieb');
  assert.ok(s3.kpis.totalLateDays < s2.kpis.totalLateDays, 'S3 muss besser sein als S2');
  assert.ok(s3.kpis.maxLateDays < base.kpis.maxLateDays);
  // Der Arbeitsinhalt bleibt in allen Szenarien identisch
  assert.equal(s2.kpis.openHours, base.kpis.openHours);
  assert.equal(s3.kpis.openHours, base.kpis.openHours);
});

/* ------------------------------------------------------------------ *
 * "Was bringt wirklich etwas?" - jeder Hebel einzeln
 * ------------------------------------------------------------------ */

test('whatHelps rechnet jeden Hebel einzeln und sortiert nach Wirkung', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  const r = whatHelps(input);

  assert.ok(r.measures.length >= 5, `mindestens fünf Hebel erwartet, waren ${r.measures.length}`);
  assert.equal(r.before.late > 0, true, 'im Startdatenbestand sind Aufträge zu spät');

  // Sortierung: die größte Ersparnis steht oben
  for (let i = 1; i < r.measures.length; i++) {
    assert.ok(r.measures[i - 1].savedLateDays >= r.measures[i].savedLateDays,
      'nach gesparten Verspätungstagen sortiert');
  }

  const bester = r.measures[0];
  assert.ok(bester.savedLateDays > 0, 'der beste Hebel muss etwas bringen');
  assert.ok(bester.label && bester.description);
  assert.ok(bester.config, 'die fertige Einstellung muss mitkommen, damit sie übernommen werden kann');
  assert.ok(bester.bottleneckAfter !== undefined, 'der Engpass danach gehört dazu');

  // Je Art nur ein Eintrag - nicht fünf Varianten derselben Maßnahme
  const arten = r.measures.map((m) => m.type);
  assert.equal(arten.length, new Set(arten).size);

  // Hebel ohne Wirkung werden ausdrücklich benannt
  assert.ok(Array.isArray(r.withoutEffect));
});

test('whatHelps: Schichtbetrieb wirkt ein Vielfaches von zusätzlichem Personal', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  const r = whatHelps(input);
  const personal = r.measures.find((m) => m.type === 'TEMP');
  const fenster = r.measures.find((m) => m.type === 'WINDOW');
  assert.ok(personal, 'Leiharbeiter müssen als Hebel auftauchen');
  assert.ok(fenster, 'die Belegungszeit muss als Hebel auftauchen');
  /*
   * Personal hilft im Startbestand NICHT - es schadet sogar leicht.
   * Das ist kein Rechenfehler: Neue Kraefte leisten in den ersten Wochen
   * 40/60/80 % und binden 5/3/1 Stunden Betreuung der Stammmannschaft.
   * Solange die Plaetze der Werkstatt der Engpass sind, kostet das mehr,
   * als es bringt. Genau diese Aussage braucht der Personalantrag.
   */
  assert.ok(fenster.savedLateDays > Math.abs(personal.savedLateDays) * 5,
    `Belegungszeit ${fenster.savedLateDays} muss ein Vielfaches von Personal ${personal.savedLateDays} sein`);
  assert.ok(fenster.savedLateDays > 500, `die Belegungszeit muss deutlich wirken, war ${fenster.savedLateDays}`);

  // Ein schaedlicher Hebel wird ausdruecklich als solcher ausgewiesen und
  // nicht mit "ohne Wirkung" vermischt
  if (personal.savedLateDays < 0) {
    const schaden = r.harmful.find((x) => x.label === personal.label);
    assert.ok(schaden, 'ein schädlicher Hebel steht in harmful');
    assert.ok(schaden.lostLateDays > 0);
    assert.ok(!r.withoutEffect.includes(personal.label), 'schädlich ist nicht dasselbe wie wirkungslos');
  }
});

test('Zusätzlicher Arbeitsplatz wird nur vorgeschlagen, wo es ihn geben kann', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  const r = whatHelps(input);
  const plaetze = r.measures.filter((m) => m.type.startsWith('PLACE_'));
  /*
   * Vorgeschlagen wird ein zusaetzlicher Platz nur dort, wo es ihn geben
   * kann: ein zweiter Saegeplatz (Auskunft der Abteilung), ein zweiter
   * Vorgang in der Arbeitsvorbereitung (Schreibtischarbeit, kein
   * Werkstattplatz), Entgraten ("Engpass kann ggf. von Hand mitgeholfen
   * werden", Auskunft der Abteilungsleitung 09/2026) und ein weiterer
   * Vormontage-Platz ("Zusätzliche Plätze sind bei Heften, Vormontage
   * und Endkontrolle eine Möglichkeit", bestätigt 21.09.2026 - welcher der
   * drei genannten Plätze konkret vorgeschlagen wird, hängt vom
   * tagesgenauen Engpass ab und hat sich durch die Aufteilung des
   * Orbitalschweissens in Kehlnaht/Stumpfnaht verschoben, Nutzerauftrag
   * 23.09.2026). Fuer Biegen und Beizen steht ausdruecklich kein zweiter
   * Platz zur Verfuegung - sie duerfen hier nicht auftauchen.
   */
  assert.deepEqual(plaetze.map((m) => m.type).sort(),
    ['PLACE_AV', 'PLACE_ENTGRATEN', 'PLACE_SAEGEN', 'PLACE_VORMONTAGE']);
  const saege = plaetze.find((m) => m.type === 'PLACE_SAEGEN');
  assert.ok(saege.label.includes('Sägen'));
  assert.ok(saege.savedLateDays > 0, 'der zweite Sägeplatz muss Verspätung abbauen');
});
