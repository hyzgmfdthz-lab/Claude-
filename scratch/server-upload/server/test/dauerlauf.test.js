/**
 * Dauerlauf: eine lange Arbeitssitzung, die alle Funktionen nacheinander
 * benutzt - die bisherigen ebenso wie die neuen.
 *
 * Zweck: Das Zusammenspiel prüfen. Einzelne Funktionen sind in den übrigen
 * Tests geprüft; hier geht es darum, dass nichts auseinanderfällt, wenn
 * mehrere Personen über längere Zeit wirklich damit arbeiten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.js';
import { createApi } from '../api.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'megc-lauf-'));
}

/** Meldet ein Kuerzel an und setzt es als Bearbeiter. */
function anmelden(api, kuerzel, passwort) {
  const vorhanden = api.loginInfo(kuerzel).hasPassword;
  const s = api.login(vorhanden ? { user: kuerzel, password: passwort } : { user: kuerzel, newPassword: passwort });
  api.setActor(api.sessionUser(s.token).user);
  return s;
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

test('Dauerlauf: eine Woche Betrieb mit vier Personen', () => {
  const dir = tmpDir();
  const api = createApi(openStore(dir));

  /* ---------- Tag 1: Leitung richtet ein ---------- */
  const chef = anmelden(api, 'DOHE', 'Leitung2026');
  assert.equal(chef.user.admin, true);

  const neu = api.createUser({ id: 'PLAN', label: 'Planung' });
  assert.equal(neu.hasPassword, false);

  const start = api.analysis('ARBEITSSTAND');
  assert.equal(start.projects.length, 37);
  const otdStart = start.kpis.otd;

  api.saveState({ name: 'Ausgangslage', note: 'Stand bei Einführung' });

  /* ---------- Tag 1: Auftragspflege (bisherige Funktionen) ---------- */
  const angelegt = api.createProject({
    orderNo: 'WGC40-S99001', customer: 'Dauerlauf', projectType: 'NEUBAU',
    variant: 'FT40', dueDate: '2027-01-15', priority: 'P2',
  });
  assert.ok(angelegt.id);
  api.updateProject(angelegt.id, { customer: 'Dauerlauf GmbH', priority: 'P1' });
  const kopie = api.duplicateProject(angelegt.id);
  assert.notEqual(kopie.id, angelegt.id);
  api.deleteProject(kopie.id);
  assert.equal(api.state().projects.length, 38);

  const reihenfolge = api.state().projects.map((p) => p.id);
  api.reorderProjects([reihenfolge[3], ...reihenfolge.filter((x) => x !== reihenfolge[3])]);
  assert.equal(api.state().projects.find((p) => p.id === reihenfolge[3]).sequence, 10);

  /* ---------- Tag 2: Vorarbeiter simuliert ---------- */
  const vorarbeiter = anmelden(api, 'STWUE', 'Kollege2026');
  assert.equal(vorarbeiter.user.admin, false, 'nur die Verwaltung ist Verwaltung');
  assert.throws(() => api.createUser({ id: 'XX' }), /Verwaltung/);

  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 12 } } });
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { overtimePerEmployeeDefault: 2 } } });
  const nachHebeln = api.analysis('ARBEITSSTAND');
  assert.ok(nachHebeln.kpis.availableHours > start.kpis.availableHours, 'mehr Kapazität');

  const standVorarbeiter = api.saveState({
    name: 'Mit 12 h Belegung', note: 'Belegungszeit und Überstunden erhöht',
  });
  assert.equal(standVorarbeiter.createdBy, 'STWUE');

  /* ---------- Tag 2: Regeln ---------- */
  const satz = api.parseRule('Verschraubungen können nach dem Biegen schon gemacht werden');
  assert.equal(satz.ok, true);
  const regel = api.createRule(satz.rule);
  assert.ok(regel.id);
  const wirkung = api.ruleImpact(regel.id, 'ARBEITSSTAND');
  assert.ok(Number.isFinite(wirkung.mit.otd) && Number.isFinite(wirkung.ohne.otd));

  const satz2 = api.parseRule('Am Beizen dürfen höchstens 2 Mitarbeiter gleichzeitig arbeiten');
  const regel2 = api.createRule(satz2.rule);
  api.setRuleEnabled(regel2.id, false);
  assert.equal(api.rules('ARBEITSSTAND').rules.find((r) => r.id === regel2.id).activeHere, false);
  api.setRuleEnabled(regel2.id, true);

  /* ---------- Tag 3: Arbeitsfolgen und Arbeitsplätze ---------- */
  const teamleiter = anmelden(api, 'SVHE', 'Team2026');
  assert.equal(teamleiter.user.id, 'SVHE');

  const vorlage = api.state().templates.NEUBAU_FT40;
  const geaendert = api.updateTemplate('NEUBAU_FT40', {
    steps: vorlage.steps.map((s) => (s.opId === 'ORBITAL' ? { ...s, hours: s.hours + 5 } : s)),
  });
  assert.equal(geaendert.steps.find((s) => s.opId === 'ORBITAL').hours, vorlage.steps.find((s) => s.opId === 'ORBITAL').hours + 5);

  const plaetze = api.state().workplaces.map((w) => (w.id === 'HE03' ? { ...w, active: true } : w));
  api.updateWorkplaces(plaetze);
  assert.equal(api.state().workplaces.find((w) => w.id === 'HE03').active, true);

  /* ---------- Tag 3: Szenarien, Optimierer, Vergleich ---------- */
  const szenario = api.createScenario({ name: 'Mit Leiharbeitern' });
  mitLeihe(api, szenario.id, 4, '2026-10-05');
  api.setActiveScenario(szenario.id);
  api.setCurrentPlan(szenario.id);
  assert.equal(api.state().currentPlanScenarioId, szenario.id);

  const wirkungSzenario = api.impact(szenario.id, 'BASELINE');
  assert.ok(wirkungSzenario.delta, 'Wirkung gegenüber der Baseline');
  const vergleich = api.compare(['BASELINE', szenario.id]);
  assert.equal(vergleich.length, 2);
  // Vier neue plus die fuenf zugesagten Leiharbeiter der Mannschaft
  assert.equal(vergleich[1].tempWorkers, 9);

  const bedarf = api.requiredStaff(szenario.id, { maxStaff: 6 });
  assert.ok('needed' in bedarf);

  const vorschlaege = api.optimize(szenario.id, { maxRounds: 1 });
  assert.ok(Array.isArray(vorschlaege.proposals));
  if (vorschlaege.proposals.length > 0) {
    const uebernommen = api.applyProposal(szenario.id, {
      config: vorschlaege.proposals[0].config, asNewScenario: true, name: 'Aus Vorschlag',
    });
    assert.ok(uebernommen.id);
    api.deleteScenario(uebernommen.id);
  }

  /* ---------- Tag 4: Import und Export ---------- */
  const excel = api.exportWorkbook(szenario.id);
  assert.ok(excel.length > 3000, 'Excel-Export liefert eine Datei');
  const csv = api.exportCsv(szenario.id, 'projects');
  assert.ok(csv.split('\n').length > 30);
  assert.ok(api.exportComparison(['BASELINE', szenario.id]).length > 1000);
  assert.ok(api.importTemplate().length > 1000);

  const importiert = api.importProjects({
    format: 'csv',
    data: 'Auftrag;Kunde;Projektart;Variante;Fertigstellung\nWGC40-S99002;Import;Neubau;40 ft;15.02.2027\n',
    mode: 'merge',
  });
  assert.equal(importiert.created, 1);
  assert.ok(api.state().projects.some((p) => p.orderNo === 'WGC40-S99002'));

  /* ---------- Tag 4: Datenprüfung ---------- */
  const pruefung = api.validate(szenario.id);
  assert.ok(pruefung.summary.errors >= 0 && Array.isArray(pruefung.issues));

  /* ---------- Tag 5: Protokoll, Aufholen, Staende ---------- */
  const protokoll = api.changeLog(200);
  assert.ok(protokoll.length > 15, `Protokoll führt alles mit (${protokoll.length} Einträge)`);
  assert.ok(protokoll.every((e) => e.at && e.text));
  const personen = new Set(protokoll.map((e) => e.by));
  assert.ok(personen.has('DOHE') && personen.has('STWUE') && personen.has('SVHE'),
    `alle Bearbeiter erscheinen: ${[...personen].join(', ')}`);

  const zurueck = anmelden(api, 'DOHE', 'Leitung2026');
  const nachricht = api.catchUp(zurueck.token);
  assert.ok(nachricht.entries.length > 0, 'die Leitung sieht, was passiert ist');
  assert.ok(!nachricht.entries.some((e) => e.by === 'DOHE'), 'eigene Änderungen nicht');
  api.markSeen(zurueck.token);
  assert.equal(api.catchUp(zurueck.token).entries.length, 0);

  const staende = api.states();
  assert.ok(staende.length >= 3, `${staende.length} Stände`);
  assert.ok(staende.some((s) => s.kind === 'AUTO'), 'auch die Tagessicherung');

  /* ---------- Tag 5: zurück auf einen alten Stand ---------- */
  const ausgangslage = staende.find((s) => s.name === 'Ausgangslage');
  const vorherProjekte = api.state().projects.length;
  api.loadState(ausgangslage.id);
  assert.equal(api.state().projects.length, 37, 'der alte Stand ist wieder da');
  assert.notEqual(vorherProjekte, 37);
  assert.ok(api.users().length >= 7, 'die Kürzel bleiben (inkl. PLAN)');
  assert.ok(api.sessionUser(zurueck.token), 'und man bleibt angemeldet');
  assert.equal(Math.round(api.analysis('ARBEITSSTAND').kpis.otd), Math.round(otdStart),
    'die Kennzahlen entsprechen wieder dem Ausgangsstand');

  /* ---------- Sicherungen und Zurücksetzen ---------- */
  api.createBackup('Dauerlauf');
  assert.ok(api.backups().length > 0);
  api.resetAll();
  assert.equal(api.state().projects.length, 37);
  assert.ok(api.users().length >= 7);

  /* ---------- Neustart: alles wieder da? ---------- */
  const nachNeustart = createApi(openStore(dir));
  assert.ok(nachNeustart.users().some((u) => u.id === 'PLAN'), 'Kürzel überstehen den Neustart');
  assert.ok(nachNeustart.changeLog(5).length > 0, 'Protokoll ebenfalls');
  assert.ok(nachNeustart.states().length >= 3, 'Stände ebenfalls');
  assert.ok(nachNeustart.login({ user: 'DOHE', password: 'Leitung2026' }).token, 'Anmeldung ebenfalls');
});

test('Dauerlauf mit Dateiablage statt SQLite', () => {
  const dir = tmpDir();
  const api = createApi(openStore(dir, { forceFile: true }));
  const s = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  api.setActor(api.sessionUser(s.token).user);

  const stand = api.saveState({ name: 'Dateiablage', note: 'Prüfung ohne SQLite' });
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 15 } } });
  api.loadState(stand.id);

  const wieder = createApi(openStore(dir, { forceFile: true }));
  assert.equal(wieder.states().length >= 1, true);
  assert.ok(wieder.login({ user: 'KEMI', password: 'Kollege2026' }).token);
  assert.ok(wieder.changeLog(10).length > 0);
  assert.ok(fs.existsSync(path.join(dir, 'staende')), 'Stände liegen als Dateien vor');
});

test('Dauerlauf: 60 Änderungen hintereinander bleiben stabil', () => {
  const api = createApi(openStore(tmpDir()));
  api.setActor({ id: 'KEER' });
  let letzte = null;

  for (let i = 0; i < 60; i++) {
    const wert = 7 + (i % 8);
    api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: wert } } });
    const kpis = api.analysis('ARBEITSSTAND').kpis;
    assert.ok(Number.isFinite(kpis.otd) && kpis.otd >= 0 && kpis.otd <= 100, `Durchlauf ${i}: OTD ${kpis.otd}`);
    assert.ok(kpis.totalProjects === 37);
    if (wert === 7 && letzte !== null) {
      assert.equal(kpis.otd, letzte, 'gleiche Eingabe muss dasselbe Ergebnis liefern');
    }
    if (wert === 7) letzte = kpis.otd;
  }

  assert.ok(api.changeLog(500).length <= 500, 'das Protokoll wächst nicht unbegrenzt');
  assert.ok(api.revision().revision >= 60);
});
