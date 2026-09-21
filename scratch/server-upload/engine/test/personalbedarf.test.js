/**
 * Tests der Auswertungen, mit denen der Personalbedarf und die
 * Arbeitsplatzauslastung belegt werden (Fragen des Abteilungsleiters:
 * "Wofuer mehr Personal, warum genau, wo druckt der Schuh?").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, template, run, createProject } from './helpers.js';
import { missingStaffPerWeek, workplaceLoad, missingQualification } from '../kpi.js';
import { requiredAdditionalStaff } from '../optimizer.js';
import { defaultWorkplaces } from '../defaults.js';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';
import { weekKey } from '../calendar.js';
import { weekList } from '../demand.js';
import { runSchedule } from '../scheduler.js';
import { analyze } from '../index.js';

/** Wochen als sortierte Liste – so, wie die Auswertungen sie erhalten. */
function wochen(weeks) {
  return weekList(weeks);
}

/** Auftraege gleicher Groesse zum gleichen Termin. */
function load(count, hours, due = '2026-10-02', opId = 'SAEGEN') {
  const projects = Array.from({ length: count }, (_, i) => createProject({
    id: `L${i}`, orderNo: `L-${i}`, projectType: 'NEUBAU', variant: 'FT40',
    dueDate: due, priority: 'P1', sequence: i * 10,
  }));
  return {
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Last', { [opId]: hours }) },
    projects,
  };
}

/* ------------------------------------------------------------------ *
 * Fehlende Mitarbeiter je Kalenderwoche
 * ------------------------------------------------------------------ */

test('missingStaffPerWeek weist ohne Überlast keine fehlenden Mitarbeiter aus', () => {
  const input = { config: testConfig(), ...load(1, 50) };
  const { weeks } = run(input);
  const missing = missingStaffPerWeek(wochen(weeks), input.config);
  assert.equal(missing.length, wochen(weeks).length);
  assert.ok(missing.every((m) => m.missingStaff === 0 && m.missingHours === 0));
});

test('missingStaffPerWeek rechnet fehlende Stunden in Mitarbeiter um', () => {
  // 2 Mitarbeiter, 37,5 h/Woche, Produktivitaet 1 -> 75 h Kapazitaet je Woche
  const input = { config: testConfig({ workforce: { baseHeadcount: 2 } }), ...load(4, 300, '2026-09-18') };
  const { weeks } = run(input);
  const missing = missingStaffPerWeek(wochen(weeks), input.config);
  const first = missing.find((m) => m.missingHours > 0);
  assert.ok(first, 'in mindestens einer Woche müssen Stunden fehlen');
  // Gegenprobe: fehlende Stunden / (37,5 h * Produktivitaet), aufgerundet auf 0,1
  const week = wochen(weeks).find((w) => w.weekKey === first.weekKey);
  const erwartet = Math.ceil(((week.demand - week.capacity) / 37.5) * 10) / 10;
  assert.equal(first.missingStaff, erwartet);
  assert.ok(first.missingStaff > 0);
});

test('missingStaffPerWeek berücksichtigt die Produktivität', () => {
  const base = { ...load(4, 300, '2026-09-18') };
  const voll = run({ config: testConfig({ workforce: { baseHeadcount: 2 } }), ...base });
  const halb = run({ config: testConfig({ workforce: { baseHeadcount: 2 }, productivity: { global: 0.5 } }), ...base });
  const a = missingStaffPerWeek(wochen(voll.weeks), testConfig({ workforce: { baseHeadcount: 2 } }));
  const b = missingStaffPerWeek(wochen(halb.weeks), testConfig({ workforce: { baseHeadcount: 2 }, productivity: { global: 0.5 } }));
  const sum = (list) => list.reduce((s, m) => s + m.missingStaff, 0);
  assert.ok(sum(b) > sum(a), 'geringere Produktivität muss mehr fehlende Mitarbeiter ergeben');
});

/* ------------------------------------------------------------------ *
 * Auslastung je Arbeitsplatz und Woche
 * ------------------------------------------------------------------ */

test('workplaceLoad liefert je Arbeitsgang eine Zeile mit einer Zelle je Woche', () => {
  const input = { config: testConfig(), ...load(2, 60) };
  const { result, weeks } = run(input);
  const rows = workplaceLoad(result, defaultWorkplaces(), wochen(weeks));
  assert.ok(rows.length >= 8, `mindestens 8 Arbeitsplatzgruppen, waren ${rows.length}`);
  assert.equal(rows[0].opId, 'POOL', 'zuoberst stehen die Mitarbeiterstunden gesamt');
  for (const row of rows) {
    assert.equal(row.cells.length, wochen(weeks).length);
    if (!row.isPool) assert.ok(row.places > 0);
    assert.ok(row.cells.every((c) => c.utilization >= 0));
  }
  const saege = rows.find((r) => r.opId === 'SAEGEN');
  assert.ok(saege.totalHours > 0, 'die belegte Säge muss Stunden ausweisen');
});

test('workplaceLoad rechnet Orbitalschweißen in Maschinenstunden', () => {
  const input = {
    config: testConfig({ resources: { machinesPerWelder: 2, orbitalMachinesActive: 6, operatingHoursPerDay: 7 } }),
    ...load(1, 40, '2026-10-30', 'ORBITAL'),
  };
  const { result, weeks } = run(input);
  const rows = workplaceLoad(result, defaultWorkplaces(), wochen(weeks));
  const orbital = rows.find((r) => r.opId === 'ORBITAL');
  assert.equal(orbital.unit, 'Maschinenstunden');
  assert.equal(orbital.places, 6);
  // 40 Mannstunden * 2 Maschinen je Schweisser = 80 Maschinenstunden
  assert.ok(Math.abs(orbital.totalHours - 80) < 0.5, `erwartet 80, war ${orbital.totalHours}`);
});

test('workplaceLoad folgt der eingestellten Zahl der Heftplätze', () => {
  const input = { config: testConfig({ resources: { heftPlaces: 3, operatingHoursPerDay: 7 } }), ...load(1, 10, '2026-10-30', 'HEFTEN') };
  const { result, weeks } = run(input);
  const rows = workplaceLoad(result, defaultWorkplaces(), wochen(weeks));
  assert.equal(rows.find((r) => r.opId === 'HEFTEN').places, 3);
});

test('workplaceLoad weist Überlast über 100 Prozent aus', () => {
  // 1 Heftplatz, 7 h Belegung je Tag, aber sehr viel Heftarbeit und viele Leute
  const input = {
    config: testConfig({
      workforce: { baseHeadcount: 20 },
      resources: { heftPlaces: 1, workersPerHeftPlace: 20, operatingHoursPerDay: 2 },
    }),
    ...load(3, 200, '2026-10-30', 'HEFTEN'),
  };
  const { result, weeks } = run(input);
  const heften = workplaceLoad(result, defaultWorkplaces(), wochen(weeks)).find((r) => r.opId === 'HEFTEN');
  assert.ok(heften.peak > 100, `Spitzenauslastung muss über 100 % liegen, war ${heften.peak}`);
});

test('workplaceLoad des Startdatenbestands reicht an die Kapazitätsgrenze', () => {
  const dataset = seedDataset();
  const an = analyze(dataset, 'BASELINE');
  const rows = an.workplaceLoad;
  assert.ok(rows.length > 0);
  const orbital = rows.find((r) => r.opId === 'ORBITAL');
  // Die Auslastung rechnet mit derselben Belegungszeit wie die Terminierung:
  // mindestens so lange, wie ein Mitarbeiter arbeitet (7,5 h), auch wenn
  // 7 h eingestellt sind.
  assert.ok(orbital.peak >= 90, `Orbital muss nahe an die Grenze kommen, war ${orbital.peak}`);
  // Seit die Plaetze der Werkstatt in der Rechnung wirken, kann kein Platz
  // ueber 100 % kommen - die Ueberlast zeigt sich stattdessen als Arbeit,
  // die liegenbleibt.
  assert.ok(rows.every((r) => r.peak <= 100.5), 'kein Platz kann mehr leisten, als er kann');
  assert.ok(rows.some((r) => r.blockedHours > 100), 'die Überlast muss als liegengebliebene Arbeit sichtbar sein');
});

/* ------------------------------------------------------------------ *
 * Notwendige zusaetzliche Mitarbeiter
 * ------------------------------------------------------------------ */

test('requiredAdditionalStaff meldet 0, wenn alle Termine gehalten werden', () => {
  const input = { config: testConfig(), ...load(1, 50) };
  const r = requiredAdditionalStaff(input);
  assert.equal(r.needed, 0);
  assert.equal(r.solved, true);
  assert.equal(r.base.late, 0);
});

test('requiredAdditionalStaff findet die kleinste ausreichende Zahl', () => {
  // 8 Mitarbeiter fehlen: 4 Auftraege x 300 h bis KW38, nur 2 Mitarbeiter im Stamm
  const input = { config: testConfig({ workforce: { baseHeadcount: 2 } }), ...load(4, 300, '2026-10-16') };
  const r = requiredAdditionalStaff(input, { maxStaff: 30 });
  assert.equal(r.solved, true);
  assert.ok(r.needed > 0, 'es müssen Mitarbeiter fehlen');
  assert.ok(r.base.late > 0 && r.after.late === 0);
  assert.ok(r.fromWeek && r.fromDate, 'Startwoche und -datum müssen benannt werden');

  // Gegenprobe: mit einem Mitarbeiter weniger bleiben Termine offen
  const weniger = testConfig({ workforce: { baseHeadcount: 2 } });
  weniger.workforce.rampUp = { temp: [], hire: [], mentoringHoursPerWeek: { temp: [], hire: [] } };
  weniger.workforce.tempWorkers = [{
    id: 'GEGENPROBE', label: 'Gegenprobe', count: r.needed - 1, from: r.fromDate, to: null, skills: null,
  }];
  const probe = run({ ...input, config: weniger });
  assert.ok(probe.kpis.late > 0, `mit ${r.needed - 1} zusätzlichen Mitarbeitern muss noch etwas zu spät sein`);
});

test('requiredAdditionalStaff sagt ehrlich, wenn Personal allein nicht hilft', () => {
  // Eine einzige Orbitalmaschine: mehr Personal kann den Engpass nicht loesen.
  const input = {
    config: testConfig({
      resources: { orbitalMachines: 1, orbitalMachinesActive: 1, machinesPerWelder: 2, welders: { default: 1 }, operatingHoursPerDay: 7 },
    }),
    ...load(6, 200, '2026-09-25', 'ORBITAL'),
  };
  const r = requiredAdditionalStaff(input, { maxStaff: 20 });
  assert.equal(r.solved, false);
  assert.equal(r.needed, null);
  assert.equal(r.triedStaff, 20);
  assert.ok(/Orbital/i.test(r.bottleneck ?? ''), `Engpass muss benannt werden, war "${r.bottleneck}"`);
  assert.ok(r.note.includes('20'));
});

test('requiredAdditionalStaff rechnet ohne Einarbeitungsabschlag', () => {
  // Die Zahl soll den reinen Kapazitaetsbedarf zeigen, nicht die Einarbeitung.
  const input = { config: testConfig({ workforce: { baseHeadcount: 2 } }), ...load(4, 300, '2026-10-16') };
  const mitKurve = requiredAdditionalStaff(input, { maxStaff: 30 });
  const ohneKurve = requiredAdditionalStaff({
    ...input,
    config: testConfig({ workforce: { baseHeadcount: 2, rampUp: { temp: [], hire: [] } } }),
  }, { maxStaff: 30 });
  assert.equal(mitKurve.needed, ohneKurve.needed,
    'die Einarbeitungskurve darf die Bedarfszahl nicht verändern');
});

test('requiredAdditionalStaff bleibt beim Startdatenbestand belastbar', () => {
  const dataset = seedDataset();
  const r = requiredAdditionalStaff(materialize(dataset, 'BASELINE'), { maxStaff: 24 });
  // Aussage der Planung: Personal allein loest den Maschinenengpass nicht.
  assert.equal(r.solved, false);
  assert.ok(r.base.late > 0);
  assert.ok(r.bottleneck, 'der begrenzende Faktor muss benannt sein');
  assert.ok(r.evaluations >= 2 && r.evaluations <= 8, `Rechenaufwand begrenzt, waren ${r.evaluations}`);
});

/* ------------------------------------------------------------------ *
 * Auslastung: nur moegliche Tage zaehlen als Kapazitaet
 *
 * Hintergrund: Die Matrix rechnete frueher mit allen Werktagen. Die
 * Hydropruefung laeuft aber nur Di-Do und nur mit NoBo. Dadurch sah ein
 * ueberlasteter Arbeitsplatz harmlos aus, und eine Aenderung am
 * Wochentagsfenster blieb in der Auswertung wirkungslos.
 * ------------------------------------------------------------------ */

test('workplaceLoad zählt nur Tage, an denen der Arbeitsgang möglich ist', () => {
  const input = {
    config: testConfig({
      hydro: { allowedWeekdays: [2, 3, 4] },
      nobo: { weekdays: [2, 3, 4], exceptions: {} },
    }),
    ...load(1, 30, '2026-10-30', 'HYDRO'),
  };
  const { result, weeks } = run(input);
  const hydro = workplaceLoad(result, defaultWorkplaces(), wochen(weeks)).find((r) => r.opId === 'HYDRO');
  assert.ok(hydro, 'Hydro muss in der Matrix stehen');
  assert.ok(hydro.daysPerWeek <= 3.01, `höchstens 3 mögliche Tage je Woche, waren ${hydro.daysPerWeek}`);
  const volleWoche = hydro.cells.find((c) => c.days > 0);
  assert.ok(volleWoche.days <= 3, `höchstens 3 Tage je Woche, waren ${volleWoche.days}`);
});

test('workplaceLoad: mehr Hydrotage wirken nur zusammen mit dem NoBo', () => {
  const last = load(3, 400, '2026-11-27', 'HYDRO');
  const lauf = (hydroTage, noboTage) => {
    const r = run({
      config: testConfig({
        hydro: { allowedWeekdays: hydroTage },
        nobo: { weekdays: noboTage, exceptions: {} },
      }),
      ...last,
    });
    return workplaceLoad(r.result, defaultWorkplaces(), wochen(r.weeks)).find((x) => x.opId === 'HYDRO');
  };

  const eng = lauf([2, 3, 4], [2, 3, 4]);
  // Fenster geoeffnet, NoBo aber weiter nur Di-Do: keine Wirkung.
  const ohneNobo = lauf([1, 2, 3, 4, 5], [2, 3, 4]);
  // Fenster geoeffnet UND NoBo an allen Tagen: jetzt wirkt es.
  const weit = lauf([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);

  assert.equal(eng.cells[0].days, 3, 'Di-Do sind 3 mögliche Tage');
  assert.equal(ohneNobo.cells[0].days, eng.cells[0].days, 'ohne NoBo ändert das Wochentagsfenster nichts');
  assert.equal(ohneNobo.cells[0].capacityHours, eng.cells[0].capacityHours);
  assert.equal(weit.cells[0].days, 5, 'mit NoBo an allen Tagen sind es 5');
  assert.ok(weit.cells[0].capacityHours > eng.cells[0].capacityHours,
    `mehr mögliche Stunden erwartet: ${eng.cells[0].capacityHours} -> ${weit.cells[0].capacityHours}`);
  assert.ok(weit.cells.length < eng.cells.length, 'mit mehr Hydrotagen ist die Arbeit früher fertig');
});

test('workplaceLoad weist Gesamtauslastung und überlastete Wochen aus', () => {
  const input = {
    config: testConfig({
      workforce: { baseHeadcount: 20 },
      resources: { heftPlaces: 1, workersPerHeftPlace: 20, operatingHoursPerDay: 2 },
    }),
    ...load(3, 200, '2026-10-30', 'HEFTEN'),
  };
  const { result, weeks } = run(input);
  const heften = workplaceLoad(result, defaultWorkplaces(), wochen(weeks)).find((r) => r.opId === 'HEFTEN');
  assert.ok(heften.totalCapacityHours > 0);
  const erwartet = Math.round((heften.totalHours / heften.totalCapacityHours) * 1000) / 10;
  assert.ok(Math.abs(heften.totalUtilization - erwartet) < 0.2,
    `Gesamtauslastung muss Summe/Summe sein: ${heften.totalUtilization} statt ${erwartet}`);
  assert.equal(heften.overloadWeeks, heften.cells.filter((c) => c.utilization > 100.5).length);
  assert.ok(heften.overloadWeeks > 0, 'bei dieser Last muss es überlastete Wochen geben');
});

/* ------------------------------------------------------------------ *
 * Nicht einplanbare Stunden - der eigentliche Engpassbeweis
 * ------------------------------------------------------------------ */

test('workplaceLoad weist nicht einplanbare Stunden je Arbeitsgang aus', () => {
  const dataset = seedDataset();
  const an = analyze(dataset, 'BASELINE');
  const orbital = an.workplaceLoad.find((r) => r.opId === 'ORBITAL');
  // Der Engpass des Startdatenbestands ist das Orbitalschweissen. Die
  // Auslastung allein zeigt ihn nicht (sie liegt unter 100 %), die nicht
  // einplanbaren Stunden schon.
  assert.ok(orbital.blockedHours > 500,
    `beim Orbitalschweißen müssen viele Stunden liegenbleiben, waren ${orbital.blockedHours}`);
  assert.ok(orbital.blockedCause, 'die Hauptursache muss benannt sein');
  let summe = 0;
  for (const c of orbital.cells) summe += c.blockedHours;
  assert.equal(orbital.blockedHours, round(summe), 'Summe der Wochen muss die Gesamtzahl ergeben');
});

/*
 * Vorgabe der Abteilungsleitung (18.09.2026): "Die APP soll immer nur den
 * angewaehlten Zeitraum bewerten." Ohne Anwahl endet der Zeitraum an der
 * letzten Fertigstellung mit offener Arbeit - nicht am Rechenhorizont.
 */
test('Der angewählte Zeitraum bestimmt jede Auswertung', () => {
  const ds = seedDataset();
  const eng = analyze(ds, 'BASELINE');
  assert.equal(eng.range.to, eng.orderHorizon,
    'ohne Anwahl gilt der Auftragshorizont, nicht der Rechenhorizont');
  assert.ok(eng.range.to < eng.horizonEnd, 'und der liegt vor dem Rechenhorizont');
  for (const w of eng.weeks) {
    assert.ok(w.from <= eng.range.to, `Woche ${w.weekKey} liegt außerhalb des Zeitraums`);
  }

  // Ein weiterer Zeitraum muss MEHR bewerten - dieselben Zahlen, größeres Fenster
  const weit = analyze(ds, 'BASELINE', { to: eng.horizonEnd });
  assert.ok(weit.weeks.length > eng.weeks.length,
    `${weit.weeks.length} Wochen müssen mehr sein als ${eng.weeks.length}`);
  assert.ok(weit.kpis.availableHours > eng.kpis.availableHours,
    'im größeren Zeitraum steht mehr Kapazität');
  const o1 = eng.workplaceLoad.find((r) => r.opId === 'ORBITAL');
  const o2 = weit.workplaceLoad.find((r) => r.opId === 'ORBITAL');
  assert.ok(o2.totalCapacityHours > o1.totalCapacityHours,
    'auch das Belegungsgitter folgt dem Zeitraum');

  // Ein engerer Zeitraum muss WENIGER bewerten
  const kurz = analyze(ds, 'BASELINE', { to: '2026-10-31' });
  assert.ok(kurz.weeks.length < eng.weeks.length);
  assert.ok(kurz.kpis.availableHours < eng.kpis.availableHours);
  assert.equal(kurz.range.to, '2026-10-31');
  assert.ok(kurz.capacityDerivation.to <= '2026-10-31',
    'der Rechenweg der Kapazität endet ebenfalls dort');
});

test('workplaceLoad enthält die Zeile „Mitarbeiterstunden gesamt"', () => {
  const an = analyze(seedDataset(), 'BASELINE');
  const pool = an.workplaceLoad.find((r) => r.opId === 'POOL');
  assert.ok(pool, 'die Zeile muss es geben');
  assert.equal(pool.isPool, true);
  assert.ok(pool.totalCapacityHours > 0);
  // Sie muss zum Diagramm passen: Kapazität = Summe der Wochenkapazitäten
  const summe = round(an.weeks.reduce((a, w) => a + w.capacity, 0));
  assert.ok(Math.abs(pool.totalCapacityHours - summe) < 1,
    `Kapazität muss der Wochenübersicht entsprechen: ${pool.totalCapacityHours} statt ${summe}`);
});

test('missingQualification benennt die fehlende Qualifikation, nicht nur die Zahl', () => {
  const input = materialize(seedDataset(), 'BASELINE');
  const result = runSchedule(input);
  const fehlt = missingQualification(result, input.config);
  assert.ok(Array.isArray(fehlt));
  for (const e of fehlt) {
    assert.ok(e.name && e.opId, 'jede Zeile nennt den Arbeitsgang');
    assert.ok(e.hours > 0);
    assert.ok(e.missingStaff >= 0);
  }
  // Bei knappem Personal muss mindestens eine Qualifikation auftauchen
  const eng = materialize(seedDataset(), 'BASELINE');
  eng.config.workforce.team.source = 'ZAHLEN';
  eng.config.workforce.weekly = {};
  eng.config.workforce.baseHeadcount = 2;
  const engpass = missingQualification(runSchedule(eng), eng.config);
  assert.ok(engpass.length > 0, 'mit 2 Mitarbeitern muss Personal fehlen');
  assert.ok(engpass[0].missingStaff > 0);
});

function round(n) { return Math.round(n * 100) / 100; }

test('Stau: Warteschlange je Tag, Spitze und Tage getrennt ausgewiesen', () => {
  const ds = seedDataset();
  const input = materialize(ds, ds.activeScenarioId);
  const result = runSchedule(input);
  const a = analyze(ds, ds.activeScenarioId);

  /*
   * Das Belegungsgitter zaehlt je WOCHE des Zeitraums, nicht je Tag - eine
   * Randwoche gehoert ganz dazu. Der Vergleich muss dieselbe Menge bilden.
   */
  const imFenster = new Set(a.weeks.map((w) => w.weekKey));

  // Tageswerte selbst nachrechnen
  /** @type {Record<string, Record<string, number>>} */
  const proTag = {};
  for (const b of result.blocked) {
    if (b.info || !b.opId) continue;
    (proTag[b.opId] ??= {});
    proTag[b.opId][b.date] = (proTag[b.opId][b.date] ?? 0) + b.manHours;
  }

  for (const row of a.workplaceLoad) {
    if (row.isPool) {
      // Vor der Mannschaft steht keine Warteschlange - dort gibt es keinen Stau
      assert.equal(row.blockedPeak, null, 'die Poolzeile darf keinen Stau ausweisen');
      assert.equal(row.blockedDays, null);
      continue;
    }
    /*
     * Nur die Tage IM ZEITRAUM - die Auswertung endet am Auftragshorizont
     * (Vorgabe 18.09.2026). Ohne diese Grenze verglich der Test die Zahlen
     * des Fensters mit denen des ganzen Rechenhorizonts.
     */
    const tage = Object.fromEntries(Object.entries(proTag[row.opId] ?? {})
      .filter(([d]) => imFenster.has(weekKey(d))));
    const werte = Object.values(tage);
    assert.equal(row.blockedDays, werte.length, `${row.name}: Anzahl der Stautage`);
    const max = werte.length ? Math.max(...werte) : 0;
    assert.ok(Math.abs(row.blockedPeak - max) < 0.05,
      `${row.name}: größter Tag ${row.blockedPeak} gegen ${max}`);
    // Die Spitze ist eine Tagesgroesse - sie kann nie groesser sein als die Summe
    assert.ok(row.blockedPeak <= row.blockedHours + 0.05, `${row.name}: Spitze über der Summe`);
  }
});

test('Stau: die Summe ist Stunden mal Tage – nicht als Stunden lesbar', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  const hydro = a.workplaceLoad.find((r) => r.opId === 'HYDRO');
  assert.ok(hydro, 'die Hydroprüfung steht in der Auslastung');
  // Genau hier lag der Denkfehler: Die Summe liegt weit über den möglichen
  // Stunden des Arbeitsplatzes - als Stundenzahl wäre sie unmöglich.
  // (Schwelle 25.09.2026 von 0,8 auf 0,6 gesenkt: die Aushilfe an der
  // Hydroprüfung - Nutzeranforderung 25.09.2026 - hebt totalCapacityHours
  // an und senkt dadurch den Anteil legitim.)
  assert.ok(hydro.blockedHours > hydro.totalCapacityHours * 0.6,
    `die Summe über die Tage (${hydro.blockedHours}) liegt in der Größenordnung der möglichen `
    + `Belegungszeit (${hydro.totalCapacityHours}) oder darüber – als Stundenzahl unbrauchbar`);
  // Die ausgewiesene Spitze dagegen bleibt darunter und ist vorstellbar.
  assert.ok(hydro.blockedPeak < hydro.totalCapacityHours,
    `die größte Tagesschlange (${hydro.blockedPeak} h) muss unter der möglichen `
    + `Belegungszeit (${hydro.totalCapacityHours} h) liegen`);
});
