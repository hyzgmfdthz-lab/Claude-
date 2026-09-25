/**
 * Tests der Plausibilitaetspruefung.
 *
 * Auftrag der Abteilungsleitung: "Die App sollte immer warnen wenn ihr
 * etwas komisch vorkommt oder nicht plausibel ist." Geprueft wird hier
 * beides: dass die Anwendung die typischen Denkfehler findet UND dass sie
 * bei einem saubere Stand nicht grundlos warnt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleInput, template, createProject } from './helpers.js';
import { pruefePlausibilitaet, wendeBestaetigungenAn, befundKey } from '../plausibilitaet.js';
import { runSchedule } from '../scheduler.js';
import { computeDemand, aggregateWeeks } from '../demand.js';
import { dashboardKpis } from '../kpi.js';
import { defaultTeam, mitZusatzPersonal } from '../team.js';
import { defaultHolidays } from '../defaults.js';
import { seedDataset, seedProjects, AV_ERLEDIGT_BIS } from '../seed.js';
import { analyze } from '../index.js';

/** Prueft einen Eingabedatensatz und gibt die Befunde als Karte zurueck. */
function pruefe(input) {
  const result = runSchedule(input);
  const demand = computeDemand(input, result.dates);
  const weeks = aggregateWeeks(result.daySeries, demand);
  const kpis = dashboardKpis(result, weeks);
  const pl = pruefePlausibilitaet(input, result, { kpis, weeks: Object.values(weeks) });
  /** @type {Record<string, any>} */
  const byCode = {};
  for (const i of pl.items) byCode[i.code] = i;
  return { pl, byCode, codes: pl.items.map((i) => i.code) };
}

/* ---------------- Besetzung ---------------- */

test('Plausibilität: ein Tag, an dem nur einer da wäre, wird gemeldet', () => {
  /*
   * Die Sicherheitsregel setzt einen solchen Tag auf 0 h (capacity.js).
   * Sichtbar war das nirgends - ein leerer Tag sah wie ein Rechenfehler
   * aus. Jetzt sagt die Anwendung, warum er leer ist.
   */
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  let n = 0;
  for (const p of c.workforce.team.people) {
    if (p.kind === 'STAMM') { n += 1; if (n > 1) { p.defaultActive = false; p.weeks = {}; } }
    else { p.defaultActive = false; p.startDate = null; p.weeks = {}; }
  }
  const { byCode } = pruefe(input);
  const b = byCode.ALLEIN_AM_TAG;
  assert.ok(b, 'die Anwendung muss auf die Sicherheitsregel hinweisen');
  assert.equal(b.level, 'WARNUNG');
  assert.match(b.text, /mindestens 2 Personen/);
  assert.match(b.text, /kein Rechenfehler/);
  assert.ok(b.value.tage.length > 0 && b.value.stunden > 0,
    'die verlorenen Stunden gehören dazu');
  assert.ok(b.hint && /zweiter Mann/.test(b.hint), 'die Abhilfe ist ein zweiter Mann');
});

test('Plausibilität: eine vollständige Mannschaft löst die Meldung nicht aus', () => {
  const input = simpleInput({ hours: 400 });
  input.config.workforce.team = defaultTeam();
  input.config.workforce.team.source = 'MANNSCHAFT';
  const { byCode } = pruefe(input);
  assert.equal(byCode.ALLEIN_AM_TAG, undefined,
    'ohne Alleintage darf die Anwendung nicht warnen');
});


test('Plausibilität: Sprung von der Tagesliste auf die Mannschaft wird gemeldet', () => {
  // Genug Arbeit, damit die Rechnung ueber den Messzeitraum hinausreicht
  const input = simpleInput({ hours: 900 });
  const c = input.config;
  // Messwerte gelten nur bis zum Stichtag - er liegt daher am Ende der Messreihe
  c.planningDate = '2026-09-18';
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  // Gemessen waren zuletzt 4 Leute da, die Mannschaft rechnet mit 8,5
  c.workforce.dailyAvailable = {};
  for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
    '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
    c.workforce.dailyAvailable[d] = 4;
  }
  const { byCode } = pruefe(input);
  const b = byCode.BESETZUNG_SPRUNG;
  assert.ok(b, 'der Unterschied wird gefunden');
  assert.equal(b.level, 'KRITISCH', 'mehr als zwei Mitarbeiter Unterschied ist kritisch');
  assert.match(b.text, /18\.09\.2026/, 'der letzte Messtag steht im Text');
  assert.ok(b.value.geplant > b.value.gemessen);
});

test('Plausibilität: gleiche Besetzung nach dem Messzeitraum meldet keinen Sprung', () => {
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.planningDate = '2026-09-18';
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  // Nur die Stammmannschaft, damit die Staerke konstant 8,5 bleibt -
  // die zugesagten Leiharbeiter wuerden sie planmaessig erhoehen
  for (const p of c.workforce.team.people) {
    if (p.kind === 'LEIHE') { p.defaultActive = false; p.startDate = null; }
  }
  c.workforce.dailyAvailable = {};
  for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
    '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
    c.workforce.dailyAvailable[d] = 8.5;
  }
  const { codes } = pruefe(input);
  assert.ok(!codes.includes('BESETZUNG_SPRUNG'), 'ohne Sprung keine Meldung');
});

test('Plausibilität: gepflegter Urlaub räumt die Urlaubswarnung ab', () => {
  const bauen = (mitUrlaub) => {
    const input = simpleInput({ hours: 400 });
    const c = input.config;
    c.workforce.team = defaultTeam();
    c.workforce.team.source = 'MANNSCHAFT';
    c.workforce.dailyAvailable = { '2026-09-07': 8.5, '2026-09-08': 8.5 };
    if (mitUrlaub) {
      c.workforce.team.people.find((p) => p.id === 'JARO').absences = [
        { from: '2026-10-05', to: '2026-10-16', kind: 'URLAUB' },
      ];
    }
    return pruefe(input);
  };
  assert.ok(bauen(false).codes.includes('URLAUB_UNGEPFLEGT'), 'ohne Urlaub wird gewarnt');
  assert.ok(!bauen(true).codes.includes('URLAUB_UNGEPFLEGT'), 'mit Urlaub nicht mehr');
});

test('Plausibilität: zugesagte Leiharbeiter ohne Einsatzende werden benannt', () => {
  const input = simpleInput({ hours: 400 });
  input.config.workforce.team = defaultTeam();
  input.config.workforce.team.source = 'MANNSCHAFT';
  const { byCode } = pruefe(input);
  const i = byCode.LEIHE_OHNE_ENDE;
  assert.ok(i, 'die fünf Zugesagten haben kein Ende hinterlegt');
  assert.equal(i.ids.length, 5);
  assert.match(i.text, /Leiharbeiter 1/);

  // Mit Einsatzende ist der Hinweis weg
  for (const p of input.config.workforce.team.people) {
    if (p.kind === 'LEIHE') p.endDate = '2026-12-31';
  }
  assert.ok(!pruefe(input).codes.includes('LEIHE_OHNE_ENDE'));
});

/* ---------------- Schichten ---------------- */

test('Plausibilität: ein Schichtmodell ohne genug schichtfähige Leute ist ein Hinweis, keine Sperre', () => {
  /*
   * FIX (Nutzervorgabe 23.09.2026): Die Meldung stand vorher als KRITISCH
   * da, obwohl sie mit einem hypothetischen Schichtmodell rechnet, nicht
   * mit der echten Terminierung (die ohnehin nur die Mannschaftsliste
   * verwendet). Jetzt ist es ein HINWEIS.
   */
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  // Alle Stammleute von der Schicht ausnehmen und drei Plaetze dreischichtig
  for (const p of c.workforce.team.people) p.shiftCapable = false;
  c.resources.byOperation = {
    SAEGEN: { operatingHours: 22.5, places: 1, workersPerPlace: 1 },
    HEFTEN: { operatingHours: 22.5, places: 2, workersPerPlace: 1 },
  };
  const { byCode } = pruefe(input);
  const i = byCode.SCHICHT_NICHT_BESETZBAR;
  assert.ok(i, 'ohne schichtfähige Leute meldet sich das Schichtmodell');
  assert.equal(i.level, 'HINWEIS');
  assert.equal(i.value.faehig, 0);
  assert.equal(i.value.gebraucht, 6, 'zwei zusätzliche Schichten auf drei Plätzen');
});

test('Plausibilität: einschichtiger Betrieb meldet keine Schichtprobleme', () => {
  const input = simpleInput({ hours: 400 });
  input.config.workforce.team = defaultTeam();
  input.config.resources.byOperation = { SAEGEN: { operatingHours: 7, places: 1, workersPerPlace: 1 } };
  const { codes } = pruefe(input);
  assert.ok(!codes.includes('SCHICHT_NICHT_BESETZBAR'));
  assert.ok(!codes.includes('NACHTSCHICHT'));
});

/* ---------------- Auftraege ---------------- */

test('Plausibilität: laut Lieferdatum fertige Aufträge ohne Haken werden gemeldet', () => {
  const projects = [
    createProject({
      id: 'A1', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40',
      dueDate: '2026-11-30', handoverDate: '2026-08-15',
    }),
    createProject({
      id: 'A2', orderNo: 'A-2', projectType: 'NEUBAU', variant: 'FT40',
      dueDate: '2026-11-30', handoverDate: '2027-02-01',
    }),
  ];
  const input = simpleInput({ hours: 60, projects });
  const { byCode } = pruefe(input);
  const i = byCode.FERTIG_LAUT_LIEFERDATUM;
  assert.ok(i, 'der Auftrag mit Lieferdatum in der Vergangenheit fällt auf');
  assert.deepEqual(i.ids, ['A1'], 'nur dieser eine');
  assert.match(i.text, /A-1/);
});

test('Plausibilität: Fehlteile ohne Liefertermin und ihr Anteil an den Verspätungen', () => {
  const projects = [];
  for (let n = 1; n <= 4; n++) {
    projects.push(createProject({
      id: `F${n}`, orderNo: `F-${n}`, projectType: 'NEUBAU', variant: 'FT40',
      dueDate: '2026-09-15', priority: 'P1', missingParts: true,
      missingPartsNote: 'Ventile fehlen',
    }));
  }
  const input = simpleInput({ hours: 300, projects });
  const { byCode } = pruefe(input);
  assert.ok(byCode.FEHLTEIL_OHNE_TERMIN, 'ohne erwarteten Liefertermin wird gewarnt');
  assert.equal(byCode.FEHLTEIL_OHNE_TERMIN.ids.length, 4);
  assert.ok(byCode.FEHLTEIL_ANTEIL, 'der Anteil an den Verspätungen wird benannt');
  assert.match(byCode.FEHLTEIL_ANTEIL.text, /Material/);
});

test('Plausibilität: Aufträge ohne Arbeitszeiten fallen auf', () => {
  const templates = { NEUBAU_FT40: template('NEUBAU_FT40', 'Leer', { SAEGEN: 0 }) };
  const input = simpleInput({ hours: 0 });
  input.templates = templates;
  const { byCode } = pruefe(input);
  assert.ok(byCode.ARBEITSPLAN_OHNE_ZEITEN, 'ein Auftrag ohne Stunden ist kein sauberer Plan');
});

/* ---------------- Kapazitaet und Daten ---------------- */

test('Plausibilität: fehlende Zubehörreserve und Produktivität über 100 %', () => {
  const input = simpleInput({ hours: 100, config: {
    workforce: { reserveHoursPerWeek: 0 },
    productivity: { global: 1.1 },
  } });
  const { byCode } = pruefe(input);
  assert.ok(byCode.ZUBEHOER_OHNE_RESERVE, 'ohne Reserve rechnet der Plan zu optimistisch');
  assert.equal(byCode.PRODUKTIVITAET_UEBER_100.level, 'KRITISCH');

  // Mit Reserve und plausibler Produktivität sind beide Befunde weg
  const sauber = simpleInput({ hours: 100, config: {
    workforce: { reserveHoursPerWeek: 18 },
    productivity: { global: 0.9333 },
  } });
  const codes = pruefe(sauber).codes;
  assert.ok(!codes.includes('ZUBEHOER_OHNE_RESERVE'));
  assert.ok(!codes.includes('PRODUKTIVITAET_UEBER_100'));
});

test('Plausibilität: Lücken in der Tagesliste werden benannt', () => {
  const input = simpleInput({ hours: 100, config: { planningDate: '2026-09-11' } });
  const c = input.config;
  c.workforce.dailyAvailable = {
    '2026-09-07': 8, '2026-09-08': 8, /* 09.09. fehlt */ '2026-09-10': 8, '2026-09-11': 8,
  };
  const { byCode } = pruefe(input);
  assert.ok(byCode.TAGESLISTE_LUECKE, 'der fehlende Mittwoch fällt auf');
  assert.match(byCode.TAGESLISTE_LUECKE.text, /1 Arbeitstage?/);
  assert.ok(byCode.TAGESLISTE_KORREKTUR, 'die Korrektur um 1 wird ausdrücklich genannt');
});

test('Plausibilität: Tageswerte nach dem Stichtag werden gemeldet und nicht verwendet', () => {
  const input = simpleInput({ hours: 400, config: { planningDate: '2026-09-09' } });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  c.workforce.dailyAvailable = {
    '2026-09-07': 4, '2026-09-08': 4, '2026-09-09': 4,
    // Diese liegen nach dem Stichtag - Vorausschau, keine Messung
    '2026-09-10': 4, '2026-09-11': 4, '2026-09-14': 4,
  };
  const { byCode } = pruefe(input);
  const i = byCode.TAGESLISTE_NACH_STICHTAG;
  assert.ok(i, 'die Anwendung sagt, dass sie diese Werte nicht verwendet');
  assert.match(i.title, /3 Tageswerte/);
  assert.match(i.text, /09\.09\.2026/);
});

test('Plausibilität: Feiertage werden gerechnet, nicht abgeschrieben', () => {
  const f = defaultHolidays(2026, 2028);
  // Karfreitag und Ostermontag ergeben sich aus dem Ostertermin
  assert.ok(f.includes('2026-04-03'), 'Karfreitag 2026');
  assert.ok(f.includes('2026-04-06'), 'Ostermontag 2026');
  assert.ok(f.includes('2027-03-26'), 'Karfreitag 2027 – in der ersten Fassung falsch');
  assert.ok(f.includes('2027-03-29'), 'Ostermontag 2027');
  assert.ok(f.includes('2028-04-14'), 'Karfreitag 2028');
  // Feste Feiertage in Nordrhein-Westfalen
  for (const d of ['2026-01-01', '2026-05-01', '2026-06-04', '2026-10-03', '2026-11-01',
    '2026-12-25', '2026-12-26']) {
    assert.ok(f.includes(d), `${d} fehlt`);
  }
  assert.ok(!f.includes('2027-04-02'), 'der falsche Karfreitag ist weg');
});

/* ---------------- Gesamtstand ---------------- */

test('Plausibilität: der Startdatenbestand wird vollständig geprüft', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  const pl = a.plausibility;
  assert.ok(pl, 'die Analyse liefert die Prüfung mit');
  assert.ok(pl.items.length > 0, 'im Startbestand gibt es etwas zu melden');
  assert.equal(pl.counts.KRITISCH + pl.counts.WARNUNG + pl.counts.HINWEIS, pl.items.length);
  assert.equal(pl.items[0].level, pl.worst, 'die dringendsten Befunde stehen oben');
  const codes = pl.items.map((i) => i.code);
  // Der Sprung von der Tagesliste (bis 02.10.) auf die Mannschaft ist real
  assert.ok(codes.includes('BESETZUNG_SPRUNG'));
  assert.ok(codes.includes('URLAUB_UNGEPFLEGT'));
  // Jeder Befund ist lesbar formuliert
  for (const i of pl.items) {
    assert.ok(i.title.length > 10, `${i.code}: Titel fehlt`);
    assert.ok(i.text.length > 30, `${i.code}: Text fehlt`);
    assert.ok(['KRITISCH', 'WARNUNG', 'HINWEIS'].includes(i.level));
    assert.ok(['Besetzung', 'Aufträge', 'Kapazität', 'Datenpflege'].includes(i.area));
  }
});

/* ------------------------------------------------------------------ *
 * Befunde bestaetigen ("Thema ist abgestellt, weg damit")
 * ------------------------------------------------------------------ */

test('Bestätigter Befund zählt nicht mehr mit, bleibt aber in der Liste', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  const pl = a.plausibility;
  const erster = pl.items[0];
  assert.ok(erster.key, 'jeder Befund hat eine wiedererkennbare Kennung');
  assert.equal(erster.acknowledged, false, 'ungeprüft ist nichts bestätigt');
  assert.equal(pl.open, pl.items.length);

  const nachher = wendeBestaetigungenAn(pl, [
    { key: erster.key, level: erster.level, user: 'DOHE', at: '2026-09-16T08:00:00.000Z' },
  ]);
  assert.equal(nachher.acknowledged, 1, 'genau ein Befund ist bestätigt');
  assert.equal(nachher.open, nachher.items.length - 1);
  assert.equal(nachher.items.length, pl.items.length, 'der Befund bleibt in der Liste stehen');
  const wieder = nachher.items.find((i) => i.key === erster.key);
  assert.equal(wieder.acknowledged, true);
  assert.equal(wieder.ack.user, 'DOHE');
  assert.equal(nachher.counts[erster.level], pl.counts[erster.level] - 1, 'die Ampel zählt ihn nicht mehr');
  assert.match(nachher.summary, /1 bestätigt/);
});

test('Wird ein bestätigter Befund dringender, meldet er sich wieder', () => {
  const items = [
    { code: 'X', key: 'X', level: 'KRITISCH', area: 'Besetzung', title: 'Test', text: 'Text', acknowledged: false, ack: null },
  ];
  const pl = { items, counts: {}, countsAll: {}, acknowledged: 0, worst: null, open: 1, summary: '' };
  // Bestätigt wurde er, als er nur ein Hinweis war
  const nachher = wendeBestaetigungenAn(pl, [{ key: 'X', level: 'HINWEIS', user: 'DOHE', at: '2026-09-01T00:00:00.000Z' }]);
  assert.equal(nachher.items[0].acknowledged, false, 'die alte Bestätigung deckt die höhere Stufe nicht ab');
  assert.equal(nachher.items[0].ack.reopened, true);
  assert.equal(nachher.open, 1);
});

test('Eine Bestätigung für einen anderen Befund lässt alles unverändert', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  const nachher = wendeBestaetigungenAn(a.plausibility, [{ key: 'GIBT-ES-NICHT', level: 'KRITISCH' }]);
  assert.equal(nachher.acknowledged, 0);
  assert.equal(nachher.open, nachher.items.length);
});

test('Befundkennung hängt an Prüfung und Betroffenen, nicht am Text', () => {
  assert.equal(befundKey('BESETZUNG_SPRUNG', null), 'BESETZUNG_SPRUNG');
  assert.equal(befundKey('OHNE_TERMIN', ['B', 'A']), 'OHNE_TERMIN#A+B', 'Reihenfolge der IDs ist egal');
  assert.equal(befundKey('OHNE_TERMIN', ['A', 'B']), befundKey('OHNE_TERMIN', ['B', 'A']));
});

/* ------------------------------------------------------------------ *
 * Arbeitsvorbereitung ist bis Ende 2026 erledigt
 * ------------------------------------------------------------------ */

test('AV ist für jeden Auftrag mit Termin bis 31.12.2026 erledigt', () => {
  const projekte = seedProjects();
  let geprueft = 0;
  for (const p of projekte) {
    const av = (p.operations ?? []).find((o) => o.opId === 'AV');
    if (p.dueDate && p.dueDate <= AV_ERLEDIGT_BIS) {
      assert.ok(av, `${p.orderNo}: AV fehlt`);
      assert.equal(av.status, 'FERTIG', `${p.orderNo}: AV müsste erledigt sein`);
      geprueft += 1;
    } else {
      assert.ok(!av || av.status !== 'FERTIG', `${p.orderNo}: AV darf nicht als erledigt gelten`);
    }
  }
  assert.ok(geprueft > 30, `es müssen viele Aufträge betroffen sein, waren ${geprueft}`);
});

test('Erledigte AV senkt die offene Arbeit, ohne den Arbeitsinhalt zu verfälschen', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  const p = a.projects.find((x) => x.orderNo === 'WGC40-S00446');
  const av = p.operations.find((o) => o.opId === 'AV');
  assert.ok(av, 'die Arbeitsvorbereitung steht im Arbeitsplan');
  assert.equal(av.remainingUnits, 0, 'sie ist nicht mehr offen');
  assert.ok(av.totalUnits > 0, 'die Stunden bleiben aber im Arbeitsinhalt stehen');
  assert.ok(p.remainingManHours < p.totalManHours);
});

test('Versetzte Besetzung (12 h) ist keine zweite Schicht', () => {
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  for (const p of c.workforce.team.people) p.shiftCapable = false;
  // 12 h heisst: 60 % laenger besetzt - nicht doppelt.
  c.resources.byOperation = {
    SAEGEN: { operatingHours: 12, places: 1, workersPerPlace: 1 },
    HEFTEN: { operatingHours: 12, places: 2, workersPerPlace: 1 },
  };
  const { byCode } = pruefe(input);
  const i = byCode.SCHICHT_NICHT_BESETZBAR;
  assert.ok(i, 'ohne schichtfähige Leute wird die längere Belegungszeit gemeldet');
  // 3 Plaetze x 0,6 = 1,8 -> aufgerundet 2. Die alte Rundung ergab 3.
  assert.equal(i.value.gebraucht, 2, 'zwölf Stunden dürfen nicht als zwei volle Schichten zählen');
  assert.ok(!/2 Schichten/.test(i.text), 'im Text steht "versetzte Besetzung", nicht "2 Schichten"');
  assert.match(i.text, /versetzte Besetzung 12 h/);
  assert.ok(!('NACHTSCHICHT' in byCode), 'zwölf Stunden sind keine Nachtschicht');
});

test('Die Schichtmeldung sagt, ob der Wert allgemein oder je Arbeitsgang gesetzt ist', () => {
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  for (const p of c.workforce.team.people) p.shiftCapable = false;
  // Nichts einzeln eingestellt - nur der allgemeine Wert steht auf 15 h
  c.resources.operatingHoursPerDay = 15;
  c.resources.byOperation = {
    SAEGEN: { places: 1, workersPerPlace: 1 },
    HEFTEN: { places: 2, workersPerPlace: 1 },
  };
  const { byCode } = pruefe(input);
  const i = byCode.SCHICHT_NICHT_BESETZBAR;
  assert.ok(i, 'auch der allgemeine Wert erzeugt den Befund');
  assert.match(i.text, /allgemeine Belegungszeit von 15 h – nicht einzeln eingestellt/);
  assert.match(i.hint, /Einstellungen → Parameter/);
  assert.equal(i.value.gebraucht, 3, 'drei Plätze, eine zusätzliche Schicht');
});

test('Kehlnaht und Stumpfnaht Orbital teilen sich einen Kapazitätstopf – kein doppelter Bedarf', () => {
  /*
   * Nutzermeldung (23.09.2026): "22 MA fehlen ... es muss nicht zwingend
   * jeder Arbeitsgang immer 2-schichtig laufen." Ein Teil der Ursache: Beide
   * Orbital-Arbeitsgänge teilen sich denselben Maschinen-/Schweißer-Pool
   * (capacityGroup 'ORBITAL', siehe wochenSchichten() in schichtplan.js) -
   * wurden hier aber als zwei völlig unabhängige Arbeitsgänge gezählt und
   * ihr Bedarf addiert, obwohl derselbe Schweißer beide bedient.
   */
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  for (const p of c.workforce.team.people) p.shiftCapable = false;
  // Kein eigener Platzeintrag - die Kapazität kommt aus dem globalen
  // orbitalMachinesActive (20 Maschinen, testConfig()) und
  // machinesPerWelder (Standard 2) -> 10 Schweißer gleichzeitig.
  c.resources.byOperation = {
    ORBITAL_KEHLNAHT: { operatingHours: 15 },
    ORBITAL_STUMPFNAHT: { operatingHours: 15 },
  };
  const { byCode } = pruefe(input);
  const i = byCode.SCHICHT_NICHT_BESETZBAR;
  assert.ok(i, 'ohne schichtfähige Leute wird die längere Belegungszeit gemeldet');
  assert.equal(i.value.gebraucht, 10,
    'Kehlnaht und Stumpfnaht teilen sich denselben Schweißer-Pool - der Bedarf darf nicht verdoppelt werden '
    + '(sonst wären es 20)');
});

test('Heften ohne eigenen Platzeintrag rechnet mit der wirklichen Heftplatzzahl, nicht mit dem Standardwert 1', () => {
  /*
   * Zweiter Teil derselben Ursache: Heften, Kehlnaht/Stumpfnaht Orbital und
   * Molchen haben keinen eigenen `places`-Eintrag (ihre Kapazität steckt in
   * eigenen Feldern wie `heftPlaces`) - fielen hier bisher still auf den
   * Standardwert 1 zurück, unabhängig von der wirklichen Platzzahl.
   */
  const input = simpleInput({ hours: 400 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  for (const p of c.workforce.team.people) p.shiftCapable = false;
  // Kein eigener Platzeintrag - die Kapazität kommt aus dem globalen
  // heftPlaces (10, testConfig()).
  c.resources.byOperation = { HEFTEN: { operatingHours: 15 } };
  const { byCode } = pruefe(input);
  const i = byCode.SCHICHT_NICHT_BESETZBAR;
  assert.ok(i);
  assert.equal(i.value.gebraucht, 10, 'zehn Heftplätze, nicht der frühere Standardwert 1');
});

test('Zahlenlisten neben der Mannschaft werden gemeldet und getrennt ausgewiesen', () => {
  const ds = seedDataset();
  const sz = ds.scenarios[0];
  // So sieht es aus, wenn ein Vorschlag aus "Was bringt wirklich etwas?"
  // uebernommen wurde: Anzahlen ohne Namen, zusaetzlich zur Mannschaft.
  sz.config.workforce.tempWorkers = [{ id: 'T', label: '+6 Leiharbeiter', count: 6, from: '2026-09-21', to: null }];
  sz.config.workforce.newHires = [{ id: 'H', label: '+5 Neueinstellungen', count: 5, from: '2026-09-21' }];
  const a = analyze(ds, sz.id);

  const i = a.plausibility.items.find((x) => x.code === 'ZAHLENLISTEN_OHNE_WIRKUNG');
  assert.ok(i, 'die Anwendung muss auf die wirkungslosen Altlisten hinweisen');
  assert.equal(i.value.zusatz, 11);
  assert.match(i.text, /gehen sie NICHT in die Rechnung ein/);
  assert.match(i.hint, /gehört in die Mannschaft/);

  /*
   * Und sie gehen wirklich nicht ein: Die Wochenuebersicht weist keinen
   * Zuschlag aus, weil in dieser Betriebsart nur die Mannschaft zaehlt.
   */
  const w = a.weeks.find((x) => x.weekKey === '2026-W44');
  assert.equal(w.avgExtraHeadcount, 0, 'die Zahlenlisten dürfen nicht mitgerechnet werden');
  assert.ok(w.avgHeadcount > 0);
});

test('Ohne Zahlenlisten gibt es weder Befund noch Zusatzausweis', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  assert.ok(!a.plausibility.items.some((x) => x.code === 'ZAHLENLISTEN_OHNE_WIRKUNG'));
  for (const w of a.weeks) {
    assert.equal(w.avgExtraHeadcount, 0, `${w.weekKey}: es gibt keine zusätzlichen Kräfte`);
  }
});

/*
 * Der Startdatenbestand ist der Fall, in dem mehr Personal NICHT hilft:
 * Die Plaetze begrenzen, nicht die Leute. Genau das hat die
 * Abteilungsleitung am 18.09.2026 eingefordert - vorher stand dort
 * "441 h fehlen, das sind rund 14 Mitarbeiter".
 */
test('Wenn die Plätze begrenzen, wird NICHT nach Personal gerufen', () => {
  const ds = seedDataset();
  const a = analyze(ds, ds.activeScenarioId);
  assert.equal(a.plausibility.items.find((x) => x.code === 'PERSONAL_FEHLT'), undefined,
    'die Mannschaft ist nicht auslastbar – Personal zu fordern wäre falsch');
  const i = a.plausibility.items.find((x) => x.code === 'MANNSCHAFT_NICHT_AUSLASTBAR');
  assert.ok(i, 'stattdessen muss die Anwendung sagen, dass Personal hier nicht hilft');
  assert.equal(i.area, 'Besetzung');
  // Seit die Orbital-Aushilfe (24.09.2026) etwas mehr Arbeit an den Maschinen
  // vorbeischleust, steigt die Poolauslastung leicht - entscheidend bleibt aber
  // (siehe oben), dass sie NICHT der Grund für den Pfad ist: poolGenutzt < poolKapazitaet.
  assert.ok(i.value.auslastung < 0.95, `Auslastung ${i.value.auslastung} müsste unter 95 % liegen`);
  assert.ok(i.value.poolGenutzt < i.value.poolKapazitaet);
  assert.match(i.text, /nicht an Leuten/);
  assert.match(i.hint, /nur danebenstehen/);
});

test('Fehlendes Personal: die Kopfzahl gilt für den Zeitraum bis zur engsten Woche', () => {
  /*
   * Ein Stand, in dem wirklich die LEUTE die Grenze sind: viel Arbeit,
   * keine Platzgrenzen, keine Begrenzung je Auftrag. Nur dann darf die
   * Anwendung nach Personal rufen.
   */
  const input = simpleInput({ hours: 4000 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  c.resources.enforcePlaces = false;
  c.resources.operatingHoursPerDay = 24;
  c.resources.byOperation = {};
  c.resources.orbitalMachines = 60;
  c.resources.orbitalMachinesActive = 60;
  c.resources.machinesPerWelder = 20;
  c.resources.hydroStations = 20;
  c.resources.beizStations = 20;
  c.resources.heftPlaces = 20;
  c.projectLimits.maxWorkersPerProject = 0;
  c.projectLimits.maxParallelProjects = 0;
  c.rules = [];

  const { byCode } = pruefe(input);
  const i = byCode.PERSONAL_FEHLT;
  assert.ok(i, 'wenn die Mitarbeiterstunden die Grenze sind, muss Personal gemeldet werden');
  assert.equal(byCode.MANNSCHAFT_NICHT_AUSLASTBAR, undefined,
    'beide Meldungen zugleich wäre widersprüchlich');
  assert.equal(i.area, 'Besetzung');
  assert.ok(i.value.koepfe > 0);
  assert.ok(i.value.wochen > 0, 'die Zahl gilt für einen Zeitraum, nicht für eine Woche');

  /*
   * Die Kernpruefung: Die Kopfzahl muss der fehlenden Arbeit GETEILT DURCH
   * die Wochen bis dahin entsprechen - nicht der Luecke einer einzigen
   * Woche. Genau dieser Fehler hat aus 441 h "14 Mitarbeiter" gemacht.
   */
  const jeKopf = c.workTime.regularHoursPerWeek * c.productivity.global;
  const erwartet = i.value.stunden / (i.value.wochen * jeKopf);
  assert.ok(Math.abs(i.value.koepfe - erwartet) < 0.15,
    `${i.value.koepfe} Köpfe gegen nachgerechnete ${erwartet.toFixed(2)} `
    + `(${i.value.stunden} h / ${i.value.wochen} Wochen / ${jeKopf.toFixed(1)} h)`);
  assert.match(i.hint, /ausschließlich unter Mannschaft/,
    'der Hinweis muss den einzigen Weg nennen');
  assert.match(i.text, /Bis KW/, 'die Meldung muss den Zeitraum nennen');
});

test('Die Personalmeldung nennt nie die Lücke einer einzelnen Woche als Kopfzahl', () => {
  /*
   * Gegenprobe zum gemeldeten Fall: Die schlimmste EINZELwoche ergibt eine
   * viel groessere Kopfzahl als der Bedarf ueber den Zeitraum. Die Meldung
   * darf nie die groessere nennen.
   */
  const input = simpleInput({ hours: 4000 });
  const c = input.config;
  c.workforce.team = defaultTeam();
  c.workforce.team.source = 'MANNSCHAFT';
  c.resources.enforcePlaces = false;
  c.resources.operatingHoursPerDay = 24;
  c.resources.byOperation = {};
  c.resources.orbitalMachines = 60;
  c.resources.orbitalMachinesActive = 60;
  c.resources.machinesPerWelder = 20;
  c.resources.hydroStations = 20;
  c.resources.beizStations = 20;
  c.resources.heftPlaces = 20;
  c.projectLimits.maxWorkersPerProject = 0;
  c.projectLimits.maxParallelProjects = 0;
  c.rules = [];

  const result = runSchedule(input);
  const demand = computeDemand(input, result.dates);
  const weeks = Object.values(aggregateWeeks(result.daySeries, demand));
  const kpis = dashboardKpis(result, aggregateWeeks(result.daySeries, demand));
  const pl = pruefePlausibilitaet(input, result, { kpis, weeks });
  const i = pl.items.find((x) => x.code === 'PERSONAL_FEHLT');
  if (!i) return;

  const jeKopf = c.workTime.regularHoursPerWeek * c.productivity.global;
  const schlimmsteWoche = weeks.reduce(
    (a, w) => Math.max(a, Math.max(0, (w.demand ?? 0) - (w.capacity ?? 0))), 0);
  const alteKopfzahl = schlimmsteWoche / jeKopf;
  assert.ok(i.value.koepfe <= alteKopfzahl + 0.01,
    `${i.value.koepfe} Köpfe dürfen nicht über der alten Einzelwochenrechnung `
    + `(${alteKopfzahl.toFixed(1)}) liegen`);
});

test('Die Zahlenlisten verändern die Besetzung der Mannschaft nicht mehr', () => {
  const ds = seedDataset();
  const ohne = analyze(ds, ds.activeScenarioId);
  const sz = ds.scenarios.find((s) => s.id === ds.activeScenarioId) ?? ds.scenarios[0];
  sz.config.workforce.tempWorkers = [{ id: 'T', label: '+9', count: 9, from: '2026-09-21', to: null }];
  sz.config.workforce.newHires = [{ id: 'H', label: '+9', count: 9, from: '2026-09-21' }];
  const mit = analyze(ds, sz.id);
  assert.equal(mit.kpis.availableHours, ohne.kpis.availableHours,
    'achtzehn Personen in den Zahlenlisten dürfen keine einzige Stunde erzeugen');

  // In der Rückfallebene (Wochenzahlen) wirken sie weiter - dort sind sie zu Hause
  sz.config.workforce.team.source = 'ZAHLEN';
  const zahlen = analyze(ds, sz.id);
  sz.config.workforce.tempWorkers = [];
  sz.config.workforce.newHires = [];
  const zahlenOhne = analyze(ds, sz.id);
  assert.ok(zahlen.kpis.availableHours > zahlenOhne.kpis.availableHours,
    'in der Rückfallebene bleiben die Zahlenlisten wirksam');
});

test('Zusätzliches Personal über die Mannschaft wirkt sofort', () => {
  const ds = seedDataset();
  const sz = ds.scenarios.find((s) => s.id === ds.activeScenarioId) ?? ds.scenarios[0];
  const vorher = analyze(ds, sz.id).kpis.availableHours;
  sz.config = mitZusatzPersonal(sz.config, 4, '2026-09-21');
  const nachher = analyze(ds, sz.id).kpis.availableHours;
  assert.ok(nachher > vorher, `${vorher} -> ${nachher} Stunden`);
  // LEIHE-03 war ohnehin fuer den 21.09. zugesagt - deshalb stehen dort
  // jetzt fuenf Kuerzel mit diesem Eintritt, vier davon neu.
  const leihe = sz.config.workforce.team.people
    .filter((p) => p.kind === 'LEIHE' && p.startDate === '2026-09-21');
  assert.equal(leihe.length, 5, 'die vier neuen stehen als Kürzel in der Mannschaft');
  const gesamt = sz.config.workforce.team.people
    .filter((p) => p.kind === 'LEIHE' && p.startDate).length;
  assert.equal(gesamt, 9, 'fünf zugesagte plus vier neue');
});
