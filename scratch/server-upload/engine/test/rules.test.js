/**
 * Tests der Regeln der Abteilung.
 *
 * Geprueft wird beides: die Uebersetzung des Satzes in eine Regel UND die
 * Wirkung der Regel auf die Terminierung. Eine Regel, die nur "verstanden"
 * wird, aber nichts bewirkt, waere wertlos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRuleText, ruleSummary, checkRules, hasError, applyRules, emptyRule,
  ruleAppliesTo, findOperations, RULE_TYPES,
} from '../rules.js';
import { testConfig, template, createProject } from './helpers.js';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';
import { runSchedule } from '../scheduler.js';
import { weekday } from '../calendar.js';

/* ------------------------------------------------------------------ *
 * Satz -> Regel
 * ------------------------------------------------------------------ */

test('Arbeitsgänge werden im Satz erkannt – auch nach Sprachgebrauch der Abteilung', () => {
  assert.equal(findOperations('Verschraubungen prüfen')[0].opId, 'VORMONTAGE');
  assert.equal(findOperations('Doppelklemmring montieren')[0].opId, 'VORMONTAGE');
  assert.equal(findOperations('abdrücken')[0].opId, 'HYDRO');
  assert.equal(findOperations('tacken')[0].opId, 'HEFTEN');
  assert.equal(findOperations('zuschnitt')[0].opId, 'SAEGEN');
  // "schweißen" in "orbitalschweißen" darf nicht doppelt zaehlen
  const orb = findOperations('orbitalschweißen dauert lange');
  // Kehlnaht und Stumpfnaht Orbital teilen sich die allgemeinen Begriffe
  // ("orbitalschweißen", "schweißen", ...) - eine Regel ohne Nahtart soll
  // beide treffen, sie teilen sich ohnehin denselben Kapazitätstopf.
  assert.equal(orb.length, 2);
  assert.deepEqual(orb.map((o) => o.opId).sort(), ['ORBITAL_KEHLNAHT', 'ORBITAL_STUMPFNAHT']);
});

test('Beispiel 1 der Abteilung wird richtig übersetzt', () => {
  const r = parseRuleText('Verschraubungen können nach dem Biegen schon gemacht werden');
  assert.equal(r.ok, true);
  assert.equal(r.rule.type, 'REIHENFOLGE');
  assert.equal(r.rule.params.opId, 'VORMONTAGE');
  assert.equal(r.rule.params.afterOpId, 'BIEGEN');
  assert.equal(r.rule.params.mode, 'OVERLAP', '„schon" bedeutet überlappend');
  assert.ok(r.understood.length > 0);
});

test('Beispiel 2 der Abteilung wird richtig übersetzt', () => {
  const r = parseRuleText('Sägen, Entgraten und Biegen kann 8-10 Wochen vor dem Heften starten. Rohmaterial vorhanden');
  assert.equal(r.ok, true);
  assert.equal(r.rule.type, 'VORLAUF');
  assert.deepEqual(r.rule.params.opIds.sort(), ['BIEGEN', 'ENTGRATEN', 'SAEGEN']);
  assert.equal(r.rule.params.weeks, 10, 'bei einer Spanne gilt der größte Wert');
  assert.equal(r.rule.params.anchorOpId, 'HEFTEN');
  assert.equal(r.rule.params.ignoreMaterial, true, '„Rohmaterial vorhanden" muss erkannt werden');
});

test('Einzelwert ohne Spanne wird erkannt', () => {
  const r = parseRuleText('Sägen kann 6 Wochen vor dem Heften starten');
  assert.equal(r.ok, true);
  assert.equal(r.rule.params.weeks, 6);
  assert.ok(Number.isFinite(r.rule.params.weeks));
});

test('Weitere Satzformen', () => {
  const wochentage = parseRuleText('Hydroprüfung nur dienstags bis donnerstags');
  assert.equal(wochentage.rule.type, 'WOCHENTAGE');
  assert.deepEqual(wochentage.rule.params.weekdays, [2, 3, 4]);

  const grenze = parseRuleText('Am Beizen dürfen höchstens 2 Mitarbeiter gleichzeitig arbeiten');
  assert.equal(grenze.rule.type, 'GRENZE');
  assert.equal(grenze.rule.params.maxWorkers, 2);

  const folge = parseRuleText('Endkontrolle erst nach der Hydroprüfung');
  assert.equal(folge.rule.type, 'REIHENFOLGE');
  assert.equal(folge.rule.params.mode, 'FS');

  const parallel = parseRuleText('Reinigen kann parallel zur Endkontrolle laufen');
  assert.equal(parallel.rule.params.mode, 'PARALLEL');
});

test('Wochentage werden in jeder Schreibweise verstanden', () => {
  /** @type {{satz:string, opId:string, tage:number[]}[]} */
  const faelle = [
    { satz: 'hydroprüfung darf nur an Wochentagen di-Donnerstag gemacht werden', opId: 'HYDRO', tage: [2, 3, 4] },
    { satz: 'Hydroprüfung nur Di bis Do', opId: 'HYDRO', tage: [2, 3, 4] },
    { satz: 'Hydro darf nur dienstags, mittwochs und donnerstags gemacht werden', opId: 'HYDRO', tage: [2, 3, 4] },
    { satz: 'Endkontrolle findet nur an Donnerstagen statt', opId: 'ENDKONTROLLE', tage: [4] },
    { satz: 'Beizen nur Mo. - Mi.', opId: 'BEIZEN', tage: [1, 2, 3] },
    { satz: 'Das Beizen ist nur montags und freitags möglich', opId: 'BEIZEN', tage: [1, 5] },
    { satz: 'Keine Hydroprüfung am Freitag', opId: 'HYDRO', tage: [1, 2, 3, 4] },
    { satz: 'Beizen außer mittwochs', opId: 'BEIZEN', tage: [1, 2, 4, 5] },
  ];
  for (const { satz, opId, tage } of faelle) {
    const r = parseRuleText(satz);
    assert.equal(r.ok, true, `nicht verstanden: ${satz}`);
    assert.equal(r.rule.type, 'WOCHENTAGE', satz);
    assert.equal(r.rule.params.opId, opId, satz);
    assert.deepEqual(r.rule.params.weekdays, tage, satz);
  }
});

test('Wochentage: "Montage" und ähnliche Wörter sind keine Wochentage', () => {
  const r = parseRuleText('Die Doppelklemmring-Vormontage kommt nach dem Beizen');
  assert.equal(r.rule.type, 'REIHENFOLGE', 'in „Vormontage" steckt kein Montag');
});

test('Reihenfolge auch mit „vor" und „bevor"', () => {
  const vor = parseRuleText('Beizen kommt vor der Doppelklemmring-Vormontage');
  assert.equal(vor.rule.type, 'REIHENFOLGE');
  assert.equal(vor.rule.params.opId, 'VORMONTAGE');
  assert.equal(vor.rule.params.afterOpId, 'BEIZEN');

  const bevor = parseRuleText('Die Vormontage darf nicht beginnen, bevor gebeizt ist');
  assert.equal(bevor.rule.params.opId, 'VORMONTAGE');
  assert.equal(bevor.rule.params.afterOpId, 'BEIZEN');
});

test('Obergrenze auch mit Zahlwörtern und ohne „höchstens"', () => {
  /** @type {{satz:string, anzahl:number}[]} */
  const faelle = [
    { satz: 'Am Beizen dürfen nur zwei Mitarbeiter gleichzeitig arbeiten', anzahl: 2 },
    { satz: 'Höchstens drei Leute am Heften', anzahl: 3 },
    { satz: 'Am Entgraten maximal 2 Mitarbeiter', anzahl: 2 },
    { satz: 'Nicht mehr als 4 Personen am Orbitalschweißen', anzahl: 4 },
  ];
  for (const { satz, anzahl } of faelle) {
    const r = parseRuleText(satz);
    assert.equal(r.ok, true, satz);
    assert.equal(r.rule.type, 'GRENZE', satz);
    assert.equal(r.rule.params.maxWorkers, anzahl, satz);
  }
});

test('Vorlauf auch als „mit 8 Wochen Vorlauf"', () => {
  const r = parseRuleText('Sägen, Entgraten und Biegen mit 8 Wochen Vorlauf, Material ist vorhanden');
  assert.equal(r.rule.type, 'VORLAUF');
  assert.equal(r.rule.params.weeks, 8);
  assert.equal(r.rule.params.ignoreMaterial, true);
});

test('Auftragsreihenfolge aus Auftragsnummern', () => {
  const projects = [
    { id: 'P1', orderNo: 'WGC40-S00158' },
    { id: 'P2', orderNo: 'WGC20-S00188' },
  ];
  const r = parseRuleText('WGC40-S00158 soll vor WGC20-S00188 gefertigt werden', { projects });
  assert.equal(r.ok, true);
  assert.equal(r.rule.type, 'AUFTRAGSFOLGE');
  assert.equal(r.rule.params.beforeProjectId, 'P1');
  assert.equal(r.rule.params.afterProjectId, 'P2');
});

test('Unverständliche Sätze werden ehrlich zurückgewiesen', () => {
  const leer = parseRuleText('');
  assert.equal(leer.ok, false);

  const unsinn = parseRuleText('Wir sollten mehr Kaffee trinken');
  assert.equal(unsinn.ok, false);
  assert.ok(unsinn.issues[0].includes('Kein Arbeitsgang'));

  const halb = parseRuleText('Biegen');
  assert.equal(halb.ok, false);
  assert.ok(halb.understood[0].includes('Biegen'), 'was erkannt wurde, wird gesagt');
});

test('Jede Regelart hat eine Klartextbeschreibung', () => {
  for (const type of Object.keys(RULE_TYPES)) {
    const rule = emptyRule(type);
    const text = ruleSummary(rule, { projects: [{ id: null, orderNo: '–' }] });
    assert.ok(text.length > 10, `${type} braucht eine Beschreibung`);
    assert.ok(!text.includes('undefined'), `${type}: ${text}`);
  }
});

/* ------------------------------------------------------------------ *
 * Pruefung
 * ------------------------------------------------------------------ */

test('Widersprüchliche Regeln werden gemeldet', () => {
  const a = { ...emptyRule('REIHENFOLGE'), id: 'A', params: { opId: 'BIEGEN', afterOpId: 'HEFTEN', mode: 'FS' } };
  const b = { ...emptyRule('REIHENFOLGE'), id: 'B', params: { opId: 'HEFTEN', afterOpId: 'BIEGEN', mode: 'FS' } };
  const issues = checkRules([a, b]);
  assert.ok(hasError(issues.A), 'der Widerspruch muss als Fehler erscheinen');
  assert.ok(issues.A.some((i) => i.text.includes('Widerspruch')));
});

test('Kreis über mehrere Regeln wird erkannt', () => {
  const mk = (id, opId, afterOpId) => ({ ...emptyRule('REIHENFOLGE'), id, params: { opId, afterOpId, mode: 'FS' } });
  const issues = checkRules([
    mk('A', 'BIEGEN', 'HEFTEN'),
    mk('B', 'HEFTEN', 'BEIZEN'),
    mk('C', 'BEIZEN', 'BIEGEN'),
  ]);
  const fehler = Object.values(issues).flat().filter((i) => i.level === 'FEHLER');
  assert.ok(fehler.some((i) => i.text.includes('Kreis')), 'ein Kreis muss auffallen');
});

test('Unmögliche Angaben werden gemeldet', () => {
  const ohneTag = { ...emptyRule('WOCHENTAGE'), id: 'W', params: { opId: 'HYDRO', weekdays: [] } };
  assert.ok(hasError(checkRules([ohneTag]).W));

  const selbst = { ...emptyRule('REIHENFOLGE'), id: 'S', params: { opId: 'BIEGEN', afterOpId: 'BIEGEN', mode: 'FS' } };
  assert.ok(hasError(checkRules([selbst]).S));

  const ohneVorlauf = { ...emptyRule('VORLAUF'), id: 'V', params: { opIds: ['SAEGEN'], weeks: 0 } };
  assert.ok(hasError(checkRules([ohneVorlauf]).V));

  const ohneAuftrag = { ...emptyRule('GRENZE'), id: 'G', scope: { kind: 'PROJECT', projectIds: [] } };
  assert.ok(hasError(checkRules([ohneAuftrag]).G));
});

/* ------------------------------------------------------------------ *
 * Geltungsbereich
 * ------------------------------------------------------------------ */

test('Geltungsbereich steuert, für welche Aufträge eine Regel gilt', () => {
  const neubau40 = { id: 'P1', projectType: 'NEUBAU', variant: 'FT40' };
  const umbau20 = { id: 'P2', projectType: 'UMBAU', variant: 'FT20' };

  assert.equal(ruleAppliesTo({ scope: { kind: 'ALL' } }, neubau40), true);
  assert.equal(ruleAppliesTo({ scope: { kind: 'TYPE', projectTypes: ['NEUBAU'] } }, neubau40), true);
  assert.equal(ruleAppliesTo({ scope: { kind: 'TYPE', projectTypes: ['NEUBAU'] } }, umbau20), false);
  assert.equal(ruleAppliesTo({ scope: { kind: 'TYPE', projectTypes: [], variants: ['FT20'] } }, umbau20), true);
  assert.equal(ruleAppliesTo({ scope: { kind: 'PROJECT', projectIds: ['P2'] } }, umbau20), true);
  assert.equal(ruleAppliesTo({ scope: { kind: 'PROJECT', projectIds: ['P2'] } }, neubau40), false);
});

/* ------------------------------------------------------------------ *
 * Wirkung auf die Terminierung
 * ------------------------------------------------------------------ */

/** Kleiner Datensatz mit vollstaendiger Folge und reichlich Kapazitaet. */
function kleinerFall(rules = [], over = {}) {
  const config = testConfig({
    workforce: { baseHeadcount: 20 },
    leadTimes: { materialWeeks: 3, startWeeks: { NEUBAU: 3, UMBAU: 3, WKP: 3, REPARATUR: 3, SONDER: 3, PRUEFER: 3 } },
    ...over,
  });
  const input = {
    config,
    templates: {
      NEUBAU_FT40: template('NEUBAU_FT40', 'Test', {
        SAEGEN: 10, ENTGRATEN: 10, BIEGEN: 10, HEFTEN: 10, ORBITAL_KEHLNAHT: 10, BEIZEN: 10, VORMONTAGE: 10, HYDRO: 10, ENDKONTROLLE: 10,
      }),
    },
    projects: [createProject({
      id: 'T1', orderNo: 'T-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-18', priority: 'P1',
    })],
    rules,
  };
  applyRules(input);
  return input;
}

test('Vorlaufregel zieht den Start tatsächlich vor', () => {
  const ohne = runSchedule(kleinerFall([]));
  const regel = {
    ...emptyRule('VORLAUF'),
    id: 'V1',
    params: { opIds: ['SAEGEN', 'ENTGRATEN', 'BIEGEN'], weeks: 12, anchor: 'DUE', anchorOpId: null, ignoreMaterial: true },
  };
  const mit = runSchedule(kleinerFall([regel]));

  const startOhne = ohne.states[0].opState.SAEGEN.firstDate;
  const startMit = mit.states[0].opState.SAEGEN.firstDate;
  assert.ok(startMit < startOhne, `mit Regel muss früher begonnen werden (${startOhne} -> ${startMit})`);
  // Der Rest der Folge bleibt an die Auftragsfreigabe gebunden
  assert.equal(mit.states[0].opState.HEFTEN.firstDate >= ohne.states[0].release.release, true);
});

test('Vorlaufregel ohne Materialfreigabe bleibt an der Materialgrenze', () => {
  const regel = {
    ...emptyRule('VORLAUF'),
    id: 'V2',
    params: { opIds: ['SAEGEN'], weeks: 20, anchor: 'DUE', anchorOpId: null, ignoreMaterial: false },
  };
  const input = kleinerFall([regel]);
  const res = runSchedule(input);
  const st = res.states[0];
  assert.ok(st.opState.SAEGEN.releaseDate >= st.release.materialGate,
    'ohne ausdrückliche Materialfreigabe gilt weiter die Materialgrenze');
});

test('Reihenfolgeregel ändert die Abhängigkeit im Arbeitsplan', () => {
  const regel = {
    ...emptyRule('REIHENFOLGE'),
    id: 'R1',
    params: { opId: 'VORMONTAGE', afterOpId: 'BIEGEN', mode: 'OVERLAP', leadHours: 0 },
  };
  const input = kleinerFall([regel]);
  assert.deepEqual(input.projects[0].ruleOverrides.VORMONTAGE.predecessors,
    [{ opId: 'BIEGEN', type: 'OVERLAP', leadHours: 0 }]);

  const mit = runSchedule(input);
  const ohne = runSchedule(kleinerFall([]));
  assert.ok(mit.states[0].opState.VORMONTAGE.firstDate <= ohne.states[0].opState.VORMONTAGE.firstDate,
    'die Vormontage darf nicht später beginnen als vorher');
  assert.ok(mit.states[0].forecastFinish <= ohne.states[0].forecastFinish,
    'der Auftrag darf durch die Regel nicht später fertig werden');
});

test('Regel „parallel" hebt die Abhängigkeit auf', () => {
  const regel = {
    ...emptyRule('REIHENFOLGE'),
    id: 'R2',
    params: { opId: 'REINIGEN', afterOpId: 'ENDKONTROLLE', mode: 'PARALLEL', leadHours: null },
  };
  const res = runSchedule(kleinerFall([regel]));
  assert.ok(!res.allocations.some((x) => x.opId === 'REINIGEN'),
    'REINIGEN ist in dieser Vorlage nicht enthalten – die Regel darf nichts erfinden');

  // Auf einen vorhandenen Arbeitsgang angewendet, faellt die Abhaengigkeit weg
  const regel2 = { ...regel, params: { ...regel.params, opId: 'BEIZEN', afterOpId: 'ORBITAL_KEHLNAHT' } };
  const input2 = kleinerFall([regel2]);
  assert.deepEqual(input2.projects[0].ruleOverrides.BEIZEN.predecessors, []);
  const mit = runSchedule(input2);
  const ohne = runSchedule(kleinerFall([]));
  assert.ok(mit.states[0].opState.BEIZEN.firstDate <= ohne.states[0].opState.BEIZEN.firstDate,
    'ohne Abhängigkeit darf das Beizen nicht später beginnen');
});

test('Wochentagsregel verhindert Buchungen an anderen Tagen', () => {
  const regel = { ...emptyRule('WOCHENTAGE'), id: 'W1', params: { opId: 'BEIZEN', weekdays: [2] } };
  const input = kleinerFall([regel]);
  assert.deepEqual(input.config.operationWeekdays.BEIZEN, [2]);

  const res = runSchedule(input);
  const tage = res.allocations.filter((x) => x.opId === 'BEIZEN').map((x) => weekday(x.date));
  assert.ok(tage.length > 0, 'es muss gebeizt werden');
  assert.ok(tage.every((d) => d === 2), `Beizen nur dienstags, war: ${[...new Set(tage)]}`);
});

test('Obergrenze begrenzt die Stunden je Tag', () => {
  const regel = { ...emptyRule('GRENZE'), id: 'G1', params: { opId: 'SAEGEN', maxWorkers: 1 } };
  const input = kleinerFall([regel]);
  assert.equal(input.projects[0].ruleOverrides.SAEGEN.maxWorkers, 1);

  const res = runSchedule(input);
  const proTag = {};
  for (const a of res.allocations.filter((x) => x.opId === 'SAEGEN')) {
    proTag[a.date] = (proTag[a.date] ?? 0) + a.manHours;
  }
  const hoursPerDay = 37.5 / 5;
  for (const [date, h] of Object.entries(proTag)) {
    assert.ok(h <= hoursPerDay + 0.01, `${date}: ${h} h übersteigt einen Mitarbeiter`);
  }
});

test('Ausgeschaltete und fehlerhafte Regeln wirken nicht', () => {
  const aus = {
    ...emptyRule('WOCHENTAGE'), id: 'W2', enabled: false,
    params: { opId: 'BEIZEN', weekdays: [2] },
  };
  const input = kleinerFall([aus]);
  assert.equal(input.config.operationWeekdays?.BEIZEN, undefined);
  assert.equal(input.rulesApplied, undefined);

  const kaputt = { ...emptyRule('WOCHENTAGE'), id: 'W3', params: { opId: 'BEIZEN', weekdays: [] } };
  const input2 = kleinerFall([kaputt]);
  assert.equal(input2.config.operationWeekdays?.BEIZEN, undefined, 'fehlerhafte Regeln werden übersprungen');
  const res = runSchedule(input2);
  assert.ok(res.projects[0].forecastFinish, 'die Planung rechnet trotzdem durch');
});

test('Regel wirkt nur auf die ausgewählten Aufträge', () => {
  const projects = [
    createProject({ id: 'A', orderNo: 'A-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-18', sequence: 10 }),
    createProject({ id: 'B', orderNo: 'B-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-18', sequence: 20 }),
  ];
  const input = {
    config: testConfig(),
    templates: { NEUBAU_FT40: template('NEUBAU_FT40', 'Test', { SAEGEN: 10, HEFTEN: 10 }) },
    projects,
    rules: [{
      ...emptyRule('GRENZE'), id: 'G2',
      scope: { kind: 'PROJECT', projectIds: ['A'] },
      params: { opId: 'SAEGEN', maxWorkers: 1 },
    }],
  };
  applyRules(input);
  assert.equal(input.projects[0].ruleOverrides.SAEGEN.maxWorkers, 1);
  assert.equal(input.projects[1].ruleOverrides, undefined);
});

test('Regeln des Startdatenbestands: ohne Regeln bleibt alles wie bisher', () => {
  const ds = seedDataset();
  assert.deepEqual(ds.rules ?? [], [], 'ausgeliefert wird ohne Regeln');
  const input = materialize(ds, 'BASELINE');
  assert.deepEqual(input.rulesApplied.applied, []);
  assert.ok(input.projects.every((p) => p.ruleOverrides === undefined));
});

test('Eine Regel im echten Datenbestand rechnet durch und ist nachvollziehbar', () => {
  const ds = seedDataset();
  ds.rules = [parseRuleText('Verschraubungen können nach dem Biegen schon gemacht werden').rule];
  const input = materialize(ds, 'BASELINE');
  assert.equal(input.rulesApplied.applied.length, 1);
  const res = runSchedule(input);
  assert.equal(res.projects.length, 37);
  assert.ok(res.projects.every((p) => p.forecastFinish || p.notCompletable),
    'jeder Auftrag muss ein Ergebnis haben');
});
