/**
 * Tests der Schnittstelle, der Datenhaltung und des Excel-Imports/-Exports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.js';
import { createApi, importRows, exportSheets, comparisonRows } from '../api.js';
import { seedDataset } from '../../engine/index.js';
import { writeXlsx, readXlsx, writeCsv, readCsv, zip, unzip } from '../xlsx.js';
import { createServer } from '../server.js';

/**
 * Leiharbeiter ueber die MANNSCHAFT einplanen - der einzige Weg, auf dem
 * Personal in die Rechnung kommt (Vorgabe 17.09.2026). Die alten
 * Zahlenlisten wirken in dieser Betriebsart nicht mehr.
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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'megc-test-'));
}
function freshApi() {
  return createApi(openStore(tmpDir()));
}

/* ---------------- Datenhaltung ---------------- */

test('Datenhaltung: speichern, laden, Sicherungen', () => {
  const dir = tmpDir();
  const store = openStore(dir);
  assert.equal(store.load(), null);
  store.save({ hello: 'welt', projects: [1, 2] }, 'Erststand');
  assert.deepEqual(store.load(), { hello: 'welt', projects: [1, 2] });
  store.save({ hello: 'neu', projects: [] }, 'Zweitstand');
  const snaps = store.snapshots();
  assert.equal(snaps.length, 2);
  assert.equal(store.restore(snaps[1].id).hello, 'welt');
  store.close();

  // Erneutes Oeffnen liefert denselben Stand (Persistenz)
  const again = openStore(dir);
  assert.equal(again.load().hello, 'neu');
  again.close();
});

test('Datenhaltung: Rückfallebene Dateiablage funktioniert gleichwertig', () => {
  const dir = tmpDir();
  const store = openStore(dir, { forceFile: true });
  assert.equal(store.kind, 'file');
  const api = createApi(store);
  assert.ok(api.state().projects.length >= 11);
  const p = api.createProject({ orderNo: 'FILE-1', projectType: 'NEUBAU', variant: 'FT20', dueDate: '2026-12-01' });
  assert.ok(api.analysis('BASELINE').projects.some((x) => x.id === p.id));
  api.createBackup('Dateiablage');
  assert.ok(api.backups().length > 0);
  // Erneutes Oeffnen liefert denselben Stand
  const again = openStore(dir, { forceFile: true });
  assert.ok(again.load().projects.some((x) => x.orderNo === 'FILE-1'));
  assert.ok(fs.existsSync(path.join(dir, 'planung.json')));
});

test('Datenhaltung: Startdaten werden beim ersten Start angelegt', () => {
  const api = freshApi();
  const state = api.state();
  assert.ok(state.projects.length >= 11);
  assert.ok(state.scenarios.some((s) => s.isBaseline));
  assert.ok(Object.keys(state.templates).length >= 8);
  assert.ok(state.workplaces.length > 10);
});

/* ---------------- Projekte ---------------- */

test('Projekte: anlegen, ändern, duplizieren, löschen', async () => {
  const api = freshApi();
  const before = api.state().projects.length;

  const p = api.createProject({ orderNo: 'TEST-1', customer: 'Testkunde', projectType: 'NEUBAU', variant: 'FT30', dueDate: '2026-12-01' });
  assert.ok(p.id);
  assert.equal(api.state().projects.length, before + 1);
  assert.ok(api.analysis('BASELINE').projects.some((x) => x.id === p.id));

  api.updateProject(p.id, { priority: 'P1', dueDate: '2026-11-01' });
  assert.equal(api.state().projects.find((x) => x.id === p.id).priority, 'P1');

  const copy = api.duplicateProject(p.id);
  assert.notEqual(copy.id, p.id);
  assert.equal(api.state().projects.length, before + 2);

  api.deleteProject(copy.id);
  api.deleteProject(p.id);
  assert.equal(api.state().projects.length, before);
  assert.equal(api.analysis('BASELINE').projects.some((x) => x.id === p.id), false);
});

test('Projekte: Reihenfolge ändern wirkt auf die Planung', () => {
  const api = freshApi();
  const ids = api.state().projects.map((p) => p.id);
  api.updateScenario('BASELINE', { config: { sequencing: { rule: 'MANUAL' } } });
  const a = api.analysis('BASELINE');
  api.reorderProjects([...ids].reverse());
  const b = api.analysis('BASELINE');
  const first = ids[0];
  assert.notEqual(
    a.projects.find((p) => p.id === first).forecastFinish,
    b.projects.find((p) => p.id === first).forecastFinish,
  );
});

test('Projekte: IDs bleiben bei Umbenennung stabil', () => {
  const api = freshApi();
  const p = api.state().projects[0];
  const count = api.state().projects.length;
  api.updateProject(p.id, { name: 'Ganz anderer Name', orderNo: 'NEU-999' });
  assert.equal(api.state().projects.length, count);
  assert.equal(api.state().projects.filter((x) => x.id === p.id).length, 1);
});

/* ---------------- Szenarien ---------------- */

test('Szenarien: Baseline bleibt bei Szenarioänderungen unberührt', () => {
  const api = freshApi();
  const baseBefore = JSON.stringify(api.scenarioConfig('BASELINE'));
  const sc = api.createScenario({ name: 'Test', sourceId: 'BASELINE' });
  api.updateScenario(sc.id, { config: { productivity: { global: 0.95 } } });
  assert.equal(JSON.stringify(api.scenarioConfig('BASELINE')), baseBefore);
  assert.equal(api.scenarioConfig(sc.id).config.productivity.global, 0.95);
});

test('Szenarien: Optimierungsvorschlag ändert nichts ohne Freigabe (§44)', () => {
  const api = freshApi();
  const before = JSON.stringify(api.state());
  const r = api.optimize('BASELINE', { maxRounds: 2 });
  assert.ok(r.proposals.length > 0);
  assert.equal(JSON.stringify(api.state()), before, 'Der Optimierer darf nichts verändern');

  // Erst die ausdrueckliche Uebernahme legt ein Szenario an
  const target = api.applyProposal('BASELINE', {
    config: r.proposals[0].config, measures: r.proposals[0].measures,
    asNewScenario: true, name: 'Optimiert',
  });
  assert.notEqual(target.id, 'BASELINE');
  assert.equal(api.state().activeScenarioId, target.id);
  assert.equal(api.scenarioConfig('BASELINE').config.productivity.global, 0.9333);
});

test('Szenarien: Baseline kann nicht direkt mit Maßnahmen überschrieben werden', () => {
  const api = freshApi();
  const r = api.optimize('BASELINE', { maxRounds: 1 });
  assert.throws(() => api.applyProposal('BASELINE', { config: r.proposals[0].config, asNewScenario: false }),
    /Baseline/);
});

test('Szenarien: Vergleich liefert Kennzahlen je Szenario', () => {
  const api = freshApi();
  const sc = api.createScenario({ name: 'Mehr Personal' });
  mitLeihe(api, sc.id, 6, '2026-09-14');
  const cmp = api.compare(['BASELINE', sc.id]);
  assert.equal(cmp.length, 2);
  assert.ok(cmp[1].kpis.availableHours > cmp[0].kpis.availableHours);
  // Gezaehlt werden ALLE eingeplanten Leiharbeiter der Mannschaft: die fuenf
  // zugesagten plus die sechs neuen. Frueher stand hier die Anzahl aus der
  // Zahlenliste - die wirkt in dieser Betriebsart nicht mehr.
  assert.equal(cmp[1].tempWorkers, 11);
  assert.equal(cmp[0].tempWorkers, 5, 'die Baseline führt die fünf zugesagten Leiharbeiter');
});

test('Wirkungsanalyse: Personal hilft wenig, Schichtbetrieb viel', () => {
  const api = freshApi();
  const nurPersonal = api.createScenario({ name: 'Mehr Personal' });
  mitLeihe(api, nurPersonal.id, 8, '2026-09-14');
  const a = api.impact(nurPersonal.id, 'BASELINE');
  /*
   * Personal allein baut hier KEINE Verspaetung ab - es kostet sogar
   * welche. Saege, Entgraten und Biegen gibt es nur je einmal; mehr Leute
   * koennen dort nicht gleichzeitig arbeiten, binden aber Betreuung
   * (5/3/1 h je Woche) und leisten in den ersten Wochen 40/60/80 %.
   * Diese Aussage ist der eigentliche Wert der Wirkungsanalyse.
   */
  assert.ok(a.delta.totalLateDays >= 0,
    `Personal allein darf keine Verspätung abbauen, war ${a.delta.totalLateDays}`);
  assert.equal(a.delta.otd, 0, 'die Termintreue bleibt unverändert');

  // Erst die längere Belegungszeit macht die Plätze frei
  const mitSchicht = api.createScenario({ name: 'Personal und Schichten' });
  mitLeihe(api, mitSchicht.id, 8, '2026-09-14');
  api.updateScenario(mitSchicht.id, { config: { resources: { operatingHoursPerDay: 22.5 } } });
  const b = api.impact(mitSchicht.id, 'BASELINE');
  assert.ok(b.delta.totalLateDays < -100,
    `Personal plus Schichtbetrieb muss deutlich Verspätung abbauen, war ${b.delta.totalLateDays}`);
  assert.ok(b.delta.totalLateDays < a.delta.totalLateDays * 5,
    'der Schichtbetrieb bringt ein Vielfaches des Personals');
  assert.ok(Array.isArray(b.projectChanges));
  assert.ok(b.projectChanges.length > 0);
});

/* ---------------- Arbeitsfolgen ---------------- */

test('Arbeitsfolge ändern rechnet betroffene Projekte neu', () => {
  const api = freshApi();
  // Gesamtstunden-Übersteuerung entfernen, damit die Vorlage direkt wirkt
  for (const p of api.state().projects) {
    if (p.templateKey !== undefined) continue;
    api.updateProject(p.id, { totalHoursOverride: null });
  }
  const before = api.analysis('BASELINE').projects.filter((p) => p.templateKey === 'NEUBAU_FT40');
  assert.ok(before.length > 0);
  const tpl = api.state().templates.NEUBAU_FT40;
  const steps = tpl.steps.map((s) => (s.opId === 'ORBITAL' ? { ...s, hours: s.hours + 30 } : s));
  api.updateTemplate('NEUBAU_FT40', { steps });
  const after = api.analysis('BASELINE').projects.filter((p) => p.templateKey === 'NEUBAU_FT40');
  assert.equal(after.length, before.length);
  assert.equal(Math.round(after[0].totalManHours - before[0].totalManHours), 30);
});

/* ---------------- Excel / CSV ---------------- */

test('ZIP: schreiben und wieder lesen', () => {
  const data = Buffer.from('Ümläute und Sonderzeichen <>&"', 'utf8');
  const archive = zip([{ name: 'test.txt', data }]);
  const back = unzip(archive);
  assert.equal(back['test.txt'].toString('utf8'), data.toString('utf8'));
});

test('XLSX: Rundlauf mit mehreren Blättern, Zahlen und Sonderzeichen', () => {
  const sheets = [
    { name: 'Projekte', rows: [['Auftrag', 'Stunden', 'Kunde'], ['WGC40-S00440', 295.8, 'Koncar & Söhne <AG>'], ['WGC30-S00066', 0, '']] },
    { name: 'Kapazität', rows: [['KW', 'Wert'], ['2026-W37', 153]] },
  ];
  const buf = writeXlsx(sheets);
  const back = readXlsx(buf);
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'Projekte');
  assert.equal(back[0].rows[1][0], 'WGC40-S00440');
  assert.equal(back[0].rows[1][1], 295.8);
  assert.equal(back[0].rows[1][2], 'Koncar & Söhne <AG>');
  assert.equal(back[1].rows[1][1], 153);
});

test('CSV: Rundlauf mit Trennzeichen und Anführungszeichen', () => {
  const rows = [['A', 'B;mit Semikolon'], ['Text "zitiert"', 12.5]];
  const back = readCsv(writeCsv(rows));
  assert.equal(back[0][1], 'B;mit Semikolon');
  assert.equal(back[1][0], 'Text "zitiert"');
  assert.equal(back[1][1], '12,5');
});

test('Export: Arbeitsmappe enthält alle Auswertungen', () => {
  const api = freshApi();
  const buf = api.exportWorkbook('BASELINE');
  const sheets = readXlsx(buf);
  const names = sheets.map((s) => s.name);
  for (const n of ['Projekte', 'Arbeitsgänge', 'Kapazität je KW', 'Prozesse', 'Management', 'Datenprüfung']) {
    assert.ok(names.includes(n), `Blatt ${n} fehlt (vorhanden: ${names.join(', ')})`);
  }
  const projects = sheets[0].rows;
  assert.ok(projects.length >= 12);
  assert.equal(projects[0][0], 'Auftrag');
  assert.ok(projects.some((r) => r[0] === 'WGC40-S00440'));
});

test('Import: Projekte aus Excel übernehmen', () => {
  const api = freshApi();
  const before = api.state().projects.length;
  const buf = writeXlsx([{
    name: 'Projekte',
    rows: [
      ['Auftrag', 'Kunde', 'Projekt', 'Projektart', 'Variante', 'Fertigstellung', 'Prioritaet', 'Gesamtstunden'],
      ['WGC45-S00999', 'Neukunde', 'Neues MEGC', 'Neubau', '45 ft', '15.12.2026', 'P2', 400],
      ['WGC40-S00440', 'Koncar', 'Koncar MEGC 40 ft', 'Neubau', '40 ft', '30.09.2026', 'P1', ''],
    ],
  }]);
  const koncarVorher = api.state().projects.find((p) => p.orderNo === 'WGC40-S00440');
  const r = api.importProjects({ format: 'xlsx', data: buf.toString('base64'), mode: 'merge' });
  assert.equal(r.created, 1);
  assert.equal(r.updated, 1);
  assert.equal(api.state().projects.length, before + 1);
  const neu = api.state().projects.find((p) => p.orderNo === 'WGC45-S00999');
  assert.equal(neu.dueDate, '2026-12-15');
  assert.equal(neu.variant, 'FT45');
  assert.equal(neu.totalHoursOverride, 400);
  // Bestandsprojekt wurde aktualisiert, ID blieb stabil
  const koncar = api.state().projects.find((p) => p.orderNo === 'WGC40-S00440');
  assert.equal(koncar.id, koncarVorher.id);
  assert.equal(koncar.dueDate, '2026-09-30');
});

test('Import: korrigierter Termin ("Fertigstellung neu") hat Vorrang (§51)', () => {
  const dataset = { projects: [] };
  const rows = [
    ['Auftrag', 'Kunde', 'Fertigstellung', 'Fertigstellung neu'],
    ['A-1', 'Kunde', '01.10.2026', '15.10.2026'],
    ['A-2', 'Kunde', '02.10.2026', ''],
  ];
  const r = importRows(dataset, rows, 'merge');
  assert.equal(r.created, 2);
  assert.equal(dataset.projects[0].dueDate, '2026-10-15');
  assert.equal(dataset.projects[1].dueDate, '2026-10-02');
});

test('Import: CSV und Statusspalte', () => {
  const api = freshApi();
  const csv = writeCsv([
    ['Auftrag', 'Kunde', 'Fertigstellung', 'Status'],
    ['CSV-1', 'Kunde A', '01.11.2026', 'offen'],
    ['CSV-2', 'Kunde B', '01.11.2026', 'Fertig'],
  ]);
  const r = api.importProjects({ format: 'csv', data: csv, mode: 'merge' });
  assert.equal(r.created, 2);
  assert.equal(api.state().projects.find((p) => p.orderNo === 'CSV-2').done, true);
});

test('Import: Modus "ersetzen" entfernt nicht enthaltene Projekte', () => {
  const api = freshApi();
  const csv = writeCsv([['Auftrag', 'Kunde', 'Fertigstellung'], ['NUR-1', 'X', '01.11.2026']]);
  api.importProjects({ format: 'csv', data: csv, mode: 'replace' });
  assert.equal(api.state().projects.length, 1);
  assert.equal(api.state().projects[0].orderNo, 'NUR-1');
});

test('Export: Szenariovergleich als Tabelle', () => {
  const api = freshApi();
  const rows = comparisonRows(api.compare(['BASELINE']));
  assert.equal(rows[0][0], 'Kennzahl');
  assert.ok(rows.some((r) => r[0] === 'OTD %'));
});

test('Export: Arbeitsblätter enthalten die Ursachenanalyse', () => {
  const api = freshApi();
  const a = api.analysis('BASELINE');
  const sheets = exportSheets(a, api.dataset);
  const projectSheet = sheets[0];
  const header = projectSheet.rows[0];
  assert.ok(header.includes('Hauptursache'));
  assert.ok(header.includes('Prognose'));
});

/* ---------------- Sicherungen ---------------- */

test('Sicherung erstellen und zurückspielen', () => {
  const api = freshApi();
  const p = api.createProject({ orderNo: 'BACKUP-TEST', projectType: 'NEUBAU', variant: 'FT20', dueDate: '2026-12-01' });
  api.createBackup('Vor Änderung');
  api.deleteProject(p.id);
  assert.equal(api.state().projects.some((x) => x.orderNo === 'BACKUP-TEST'), false);
  const snaps = api.backups();
  const target = snaps.find((s) => s.label === 'Vor Änderung');
  api.restoreBackup(target.id);
  assert.equal(api.state().projects.some((x) => x.orderNo === 'BACKUP-TEST'), true);
});

test('Zurücksetzen stellt die Startdaten wieder her', () => {
  const api = freshApi();
  api.createProject({ orderNo: 'WEG', projectType: 'NEUBAU', variant: 'FT20', dueDate: '2026-12-01' });
  api.resetAll();
  assert.equal(api.state().projects.some((p) => p.orderNo === 'WEG'), false);
  assert.ok(api.state().projects.some((p) => p.orderNo === 'WGC40-S00440'));
});

/* ---------------- HTTP ---------------- */

test('HTTP: Oberfläche und Schnittstellen antworten', async () => {
  const { server } = createServer({ dataDir: tmpDir() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Ohne Anmeldung liefert die Schnittstelle nichts heraus
  const gesperrt = await fetch(`${base}/api/state`);
  assert.equal(gesperrt.status, 401);
  assert.equal((await gesperrt.json()).code, 'AUTH');

  const angemeldet = await (await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'DOHE', newPassword: 'Pruefung2026' }),
  })).json();
  assert.ok(angemeldet.token, 'Anmeldung muss einen Schlüssel liefern');
  const auth = { 'X-MEGC-Token': angemeldet.token };

  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes('Armaturenbau MEGC'));

  const css = await fetch(`${base}/css/app.css`);
  assert.equal(css.status, 200);

  const js = await fetch(`${base}/js/main.js`);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');

  const state = await (await fetch(`${base}/api/state`, { headers: auth })).json();
  assert.ok(state.projects.length > 0);

  const analysis = await (await fetch(`${base}/api/analysis?scenario=BASELINE`, { headers: auth })).json();
  assert.ok(analysis.kpis.totalProjects > 0);
  assert.ok(analysis.days.length > 0);

  const created = await (await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ orderNo: 'HTTP-1', projectType: 'NEUBAU', variant: 'FT20', dueDate: '2026-12-01' }),
  })).json();
  assert.ok(created.id);

  const del = await fetch(`${base}/api/projects/${created.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...auth }, body: '{}' });
  assert.equal(del.status, 200);

  // Downloads laufen ueber einen Link - dort steht der Schluessel in der Adresse
  const xlsx = await fetch(`${base}/api/export?scenario=BASELINE&format=xlsx&token=${encodeURIComponent(angemeldet.token)}`);
  assert.equal(xlsx.status, 200);
  assert.ok(xlsx.headers.get('content-disposition').includes('.xlsx'));
  assert.ok((await xlsx.arrayBuffer()).byteLength > 3000);

  // Vollstaendige Datensicherung als JSON (Nutzerauftrag 21.09.2026) - ueber HTTP, wie im Browser geklickt
  const json = await fetch(`${base}/api/export?scenario=BASELINE&format=json&token=${encodeURIComponent(angemeldet.token)}`);
  assert.equal(json.status, 200);
  assert.ok(json.headers.get('content-disposition').includes('.json'));
  const gesichert = await json.json();
  assert.ok(Array.isArray(gesichert.projects) && gesichert.projects.length > 0);

  const missing = await fetch(`${base}/api/gibtesnicht`, { headers: auth });
  assert.equal(missing.status, 404);

  const bad = await fetch(`${base}/api/projects/UNBEKANNT`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...auth }, body: '{}' });
  assert.equal(bad.status, 404);

  // Befunde bestaetigen ueber HTTP
  const plaus = (await (await fetch(`${base}/api/analysis?scenario=BASELINE`, { headers: auth })).json()).plausibility;
  const befund = plaus.items[0];
  const gesetzt = await fetch(`${base}/api/acks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ key: befund.key, level: befund.level, title: befund.title }),
  });
  assert.equal(gesetzt.status, 201);
  const liste = await (await fetch(`${base}/api/acks`, { headers: auth })).json();
  assert.equal(liste.length, 1);
  const weg = await (await fetch(`${base}/api/acks/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ key: befund.key }),
  })).json();
  assert.equal(weg.deleted, befund.key, '/api/acks/delete darf nicht als ID verstanden werden');

  const traversal = await fetch(`${base}/../server/server.js`);
  assert.ok([403, 404].includes(traversal.status), 'Pfadausbruch muss verhindert werden');

  await new Promise((r) => server.close(r));
});

/* ---------------- Befunde bestaetigen ---------------- */

test('Befund bestätigen: verschwindet aus der Zählung, bleibt in der Liste', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const vorher = api.analysis('BASELINE').plausibility;
  assert.ok(vorher.items.length > 0, 'im Startbestand gibt es Befunde');
  assert.equal(vorher.acknowledged, 0);

  const ziel = vorher.items[0];
  const eintrag = api.ackFinding({ key: ziel.key, level: ziel.level, title: ziel.title, note: 'Urlaube gepflegt' });
  assert.equal(eintrag.key, ziel.key);
  assert.equal(eintrag.user, 'DOHE', 'wer bestätigt hat, wird festgehalten');
  assert.ok(eintrag.at, 'wann bestätigt wurde, wird festgehalten');

  const nachher = api.analysis('BASELINE').plausibility;
  assert.equal(nachher.acknowledged, 1);
  assert.equal(nachher.open, vorher.open - 1);
  assert.equal(nachher.items.length, vorher.items.length, 'der Befund bleibt nachlesbar');
  assert.equal(nachher.items.find((i) => i.key === ziel.key).acknowledged, true);

  // Zweimal bestaetigen legt keinen zweiten Eintrag an
  api.ackFinding({ key: ziel.key, level: ziel.level, title: ziel.title });
  assert.equal(api.acks().length, 1);

  // Zuruecknehmen
  api.unackFinding(ziel.key);
  assert.equal(api.acks().length, 0);
  assert.equal(api.analysis('BASELINE').plausibility.acknowledged, 0);
});

test('Bestätigungen überstehen einen Neustart und lassen sich sammeln aufheben', () => {
  const dir = tmpDir();
  const api = createApi(openStore(dir));
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const items = api.analysis('BASELINE').plausibility.items.slice(0, 2);
  for (const i of items) api.ackFinding({ key: i.key, level: i.level, title: i.title });
  assert.equal(api.analysis('BASELINE').plausibility.acknowledged, 2);

  // Neu geoeffnet - dieselben Bestaetigungen
  const wieder = createApi(openStore(dir));
  wieder.login({ user: 'DOHE', password: 'Pruefung2026' });
  wieder.setActor({ id: 'DOHE' });
  assert.equal(wieder.acks().length, 2);
  assert.equal(wieder.analysis('BASELINE').plausibility.acknowledged, 2);

  assert.deepEqual(wieder.clearAcks(), { deleted: 2 });
  assert.equal(wieder.analysis('BASELINE').plausibility.acknowledged, 0);
});

test('Bestätigen ohne Kennung und Aufheben ohne Bestätigung werden abgewiesen', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  assert.throws(() => api.ackFinding({}), /Kennung/);
  assert.throws(() => api.unackFinding('GIBT-ES-NICHT'), /nicht bestätigt/);
});

/* ---------------- Mehraufwand ---------------- */

test('Mehraufwand: Maßnahme wird in ein Szenario übernommen, nie in den laufenden Plan', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });

  const m = api.mehraufwand('BASELINE');
  assert.ok(m.wochen.length === 13, `13 Wochen erwartet, waren ${m.wochen.length}`);
  assert.ok(m.stunden > 0, 'im Startbestand fehlen Stunden');
  assert.equal(m.massnahmen.length, 4, 'alle vier Wege werden geliefert');

  const szenarienVorher = api.state().scenarios.length;
  const ueber = m.massnahmen.find((x) => x.key === 'UEBERSTUNDEN');
  const ziel = api.applyMehraufwand('BASELINE', { patches: [ueber.patch], name: 'Mehraufwand: Überstunden' });
  assert.ok(ziel.id && ziel.id !== 'BASELINE', 'es entsteht ein eigenes Szenario');
  assert.equal(api.state().scenarios.length, szenarienVorher + 1);

  // Die Baseline bleibt unveraendert
  const baseline = api.scenarioConfig('BASELINE');
  const woche = m.wochen[0].weekKey;
  assert.ok(!(baseline.config.workforce.weekly?.[woche]?.overtimePerEmployee > 0),
    'der laufende Plan darf sich nicht ändern');

  // Im Szenario stehen die Überstunden, und die Verspätung geht zurück
  const szenario = api.scenarioConfig(ziel.id);
  assert.equal(szenario.config.workforce.weekly[woche].overtimePerEmployee, ueber.patch.wert);
  const vorher = api.analysis('BASELINE').kpis.totalLateDays;
  const nachher = api.analysis(ziel.id).kpis.totalLateDays;
  assert.ok(nachher < vorher, `${vorher} -> ${nachher} Verspätungstage`);
});

test('Mehraufwand: dasselbe Paket zweimal übernehmen legt kein zweites Szenario an', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const m = api.mehraufwand('BASELINE');
  const patches = m.paket.teile.map((t) => t.patch).filter(Boolean);
  const erst = api.applyMehraufwand('BASELINE', { patches, name: 'Mehraufwand: Paket' });
  const anzahl = api.state().scenarios.length;
  const zweit = api.applyMehraufwand('BASELINE', { patches, name: 'Mehraufwand: Paket' });
  assert.equal(zweit.id, erst.id);
  assert.equal(api.state().scenarios.length, anzahl);
});

test('Mehraufwand: ohne Maßnahme passiert nichts', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  assert.throws(() => api.applyMehraufwand('BASELINE', { patches: [] }), /keine Maßnahme/);
});

/* ---------------- Schichtplan ---------------- */

test('Schichtvorschlag: die Anwendung plant die Schichten und nennt, was dann noch fehlt', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });

  const v = api.schichtvorschlag('BASELINE');
  assert.ok(v.aenderungen.length > 0, 'im Startbestand gibt es Schichten zu planen');
  assert.ok(v.verspaetungNachher < v.verspaetungVorher,
    `${v.verspaetungVorher} -> ${v.verspaetungNachher} Verspätungstage`);
  // "Wenn dann immernoch Arbeitsplaetze fehlen sollen diese angezeigt werden."
  assert.ok(v.fehlendePlaetze.length > 0, 'was offen bleibt, muss benannt werden');
  // Wirkung auf den Einsatzplan: vorher standen Leute ohne Platz da
  assert.ok(v.leerlaufVorher.personentage > 0);
  assert.ok(v.leerlaufNachher.personentage < v.leerlaufVorher.personentage,
    `Leerlauf ${v.leerlaufVorher.personentage} -> ${v.leerlaufNachher.personentage} Personentage`);
});

test('Schichtplan: übernommen wird in ein Szenario, nie in den laufenden Plan', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });

  const v = api.schichtvorschlag('BASELINE');
  const vorher = api.state().scenarios.length;
  const ziel = api.applySchichten('BASELINE', { name: 'Schichtplan' });
  assert.ok(ziel.id && ziel.id !== 'BASELINE', 'es entsteht ein eigenes Szenario');
  assert.equal(api.state().scenarios.length, vorher + 1);

  // Die Baseline behaelt ihre Belegungszeiten
  const baseline = api.scenarioConfig('BASELINE');
  for (const a of v.aenderungen) {
    assert.notEqual(baseline.config.resources.byOperation?.[a.opId]?.operatingHours, a.stundenNach,
      `${a.name}: der laufende Plan darf sich nicht ändern`);
  }

  // Im Szenario stehen die geplanten Schichten - und die Verspätung sinkt
  const szenario = api.scenarioConfig(ziel.id);
  for (const a of v.aenderungen) {
    assert.equal(szenario.config.resources.byOperation[a.opId].operatingHours, a.stundenNach);
  }
  const nachher = api.analysis(ziel.id).kpis.totalLateDays;
  assert.equal(nachher, v.verspaetungNachher,
    'das Szenario muss genau das liefern, was der Vorschlag versprochen hat');
});

test('Schichtplan: zweimal übernehmen legt kein zweites Szenario an', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const erst = api.applySchichten('BASELINE', { name: 'Schichtplan' });
  const anzahl = api.state().scenarios.length;
  const zweit = api.applySchichten('BASELINE', { name: 'Schichtplan' });
  assert.equal(zweit.id, erst.id);
  assert.equal(api.state().scenarios.length, anzahl);
});

test('Schichtplan: läuft es schon so, wird nichts übernommen', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const ziel = api.applySchichten('BASELINE', { name: 'Schichtplan' });
  // Im uebernommenen Szenario ist nichts mehr zu planen.
  const nochmal = api.schichtvorschlag(ziel.id);
  assert.equal(nochmal.aenderungen.length, 0);
  assert.equal(nochmal.patch, null);
  assert.throws(() => api.applySchichten(ziel.id, {}), /schon so/);
});

/* ---------------- IST-Stand und SOLL-Stand ---------------- */

test('Der Weg IST → heute → SOLL: festlegen, vergleichen, übernehmen', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });

  assert.equal(api.reference('BASELINE'), null, 'ohne IST-Stand gibt es keinen Vergleich');
  assert.equal(api.target('BASELINE'), null, 'ohne SOLL-Stand gibt es kein Ziel');

  // 1. Heutigen Stand als IST fixieren - er bleibt unveraendert
  const ist = api.fixCurrentAsReference({ name: 'IST', note: 'Stand vor den Maßnahmen' });
  assert.equal(api.state().referenceStateId, ist.id);
  const istVergleich = api.reference('BASELINE');
  assert.ok(istVergleich.ist.otd != null);

  // 2. Maßnahme übernehmen - der Plan wird besser
  const m = api.mehraufwand('BASELINE');
  const ziel = api.applyMehraufwand('BASELINE', {
    patches: m.paket.teile.map((t) => t.patch).filter(Boolean), name: 'Paket',
  });

  // 3. Diesen Stand als SOLL festlegen
  const soll = api.fixCurrentAsTarget({ name: 'SOLL', note: 'Ziel mit Paket' });
  assert.equal(api.state().targetStateId, soll.id);
  assert.equal(api.state().currentPlanScenarioId, ziel.id,
    'das Szenario des SOLL-Standes ist zugleich der aktuelle Plan');
  const zielVergleich = api.target(ziel.id);
  assert.ok(zielVergleich.soll.otd != null);
  assert.ok(zielVergleich.erreicht, 'der Stand, aus dem der SOLL entstand, hält ihn auch ein');
  assert.ok(Array.isArray(zielVergleich.changes));

  // Der IST-Stand hat sich durch all das NICHT verändert
  assert.equal(api.reference(ziel.id).ist.otd, istVergleich.ist.otd);

  // 4. SOLL wird zum neuen IST, das Ziel ist wieder offen
  const uebernommen = api.promoteTargetToReference();
  assert.equal(uebernommen.referenceStateId, soll.id);
  assert.equal(api.state().referenceStateId, soll.id);
  assert.equal(api.state().targetStateId, null);
  assert.equal(api.target(ziel.id), null);
});

test('SOLL-Stand: derselbe Stand kann nicht IST und SOLL zugleich sein', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const ist = api.fixCurrentAsReference({ name: 'IST', note: 'Ausgangspunkt' });
  assert.throws(() => api.setTargetState(ist.id), /IST-Stand/);
  assert.throws(() => api.promoteTargetToReference(), /kein SOLL-Stand/);
  assert.throws(() => api.setTargetState('GIBT-ES-NICHT'), /nicht gefunden/);
});

test('Wird der SOLL-Stand gelöscht, gibt es kein Ziel mehr', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Pruefung2026' });
  api.setActor({ id: 'DOHE' });
  const soll = api.fixCurrentAsTarget({ name: 'SOLL', note: 'Ziel' });
  assert.equal(api.state().targetStateId, soll.id);
  api.deleteState(soll.id);
  assert.equal(api.state().targetStateId, null);
  assert.equal(api.target('BASELINE'), null);
});

test('Ein älterer Datenbestand bekommt die erledigte Arbeitsvorbereitung nachgereicht', () => {
  const dir = tmpDir();
  const store = openStore(dir);
  // Stand wie vor der Änderung: Aufträge ohne Eintrag zur Arbeitsvorbereitung
  const alt = seedDataset();
  for (const p of alt.projects) p.operations = (p.operations ?? []).filter((o) => o.opId !== 'AV');
  delete alt.meta.avErledigtBis;
  // Ein Auftrag ist von Hand anders geführt - der darf nicht überschrieben werden
  const handarbeit = alt.projects.find((p) => p.dueDate && p.dueDate <= '2026-12-31');
  handarbeit.operations.unshift({ opId: 'AV', status: 'OFFEN' });
  store.save(alt, 'Altbestand');

  const api = createApi(store);
  const projekte = api.state().projects;
  const spaet = projekte.filter((p) => p.dueDate && p.dueDate > '2026-12-31');
  const frueh = projekte.filter((p) => p.dueDate && p.dueDate <= '2026-12-31' && p.id !== handarbeit.id);
  assert.ok(frueh.length > 30, `es müssen viele Aufträge betroffen sein, waren ${frueh.length}`);
  for (const p of frueh) {
    const av = p.operations.find((o) => o.opId === 'AV');
    assert.ok(av && av.status === 'FERTIG', `${p.orderNo}: AV wurde nicht nachgereicht`);
  }
  for (const p of spaet) {
    assert.ok(!p.operations.some((o) => o.opId === 'AV' && o.status === 'FERTIG'),
      `${p.orderNo}: AV darf für spätere Termine nicht als erledigt gelten`);
  }
  const vonHand = projekte.find((p) => p.id === handarbeit.id);
  assert.equal(vonHand.operations.find((o) => o.opId === 'AV').status, 'OFFEN',
    'eine bewusste Angabe der Abteilungsleitung darf nicht überschrieben werden');

  // Zweiter Start ändert nichts mehr
  const wieder = createApi(openStore(dir));
  assert.equal(wieder.state().projects.find((p) => p.id === handarbeit.id)
    .operations.find((o) => o.opId === 'AV').status, 'OFFEN');
});

/**
 * "Wer wird gerechnet?" - die Antwort auf die Rueckfrage aus der Abteilung
 * ("Warum wird immer automatisch Personal geplant, das nicht in der
 * Mannschaftsliste ist?").
 */
test('Mannschaft: die Schnittstelle sagt mit Namen, wer gerechnet wird', () => {
  const api = freshApi();
  const g = api.team('ARBEITSSTAND').gerechnet;
  assert.equal(g.source, 'MANNSCHAFT');
  assert.equal(g.date, api.analysis('ARBEITSSTAND').planningDate);
  // Jede gerechnete Person hat ein Kuerzel - eine Summe ohne Namen waere
  // genau das, was niemand nachpruefen konnte.
  assert.ok(g.personen.length > 0);
  for (const p of g.personen) assert.match(p.id, /^[A-Z0-9-]+$/);
  assert.ok(Math.abs(g.factor - (g.stamm + g.leihe)) < 0.01,
    `${g.factor} muss Stamm (${g.stamm}) plus Leihe (${g.leihe}) sein`);
  // Die fuenf zugesagten Leiharbeiter sind benannt, damit die Oberflaeche
  // selbst eingeplante nicht als "nicht von dir" ausgeben kann.
  assert.equal(g.zugesagt.length, 5);
  assert.ok(g.zugesagt.includes('LEIHE-01') && g.zugesagt.includes('LEIHE-05'));
  // Freie Platzhalter stehen als "nicht eingeplant" da, nicht als Kopf
  assert.ok(g.nichtEingeplant.some((p) => p.kind === 'LEIHE' && !p.startDate));
});

test('Mannschaft: die alten Zahlenlisten erhöhen die gerechnete Besetzung nicht', () => {
  const api = freshApi();
  const vorher = api.team('ARBEITSSTAND').gerechnet;
  api.updateScenario('ARBEITSSTAND', {
    config: {
      workforce: {
        tempWorkers: [{ id: 'ALT', label: 'Altbestand', count: 4, from: '2026-09-01', to: null }],
      },
    },
  });
  const nachher = api.team('ARBEITSSTAND').gerechnet;
  assert.equal(nachher.factor, vorher.factor, 'die Zahlenliste darf nicht mitzählen');
  assert.equal(nachher.heads, vorher.heads);
  // Sie verschwindet aber auch nicht - sie steht getrennt daneben
  assert.equal(nachher.zusatz.temp, 4);
  assert.equal(nachher.zusatz.summe, 4);
  // Und die Pruefung meldet sie als Hinweis
  const befund = api.analysis('ARBEITSSTAND').plausibility.items
    .find((i) => i.code === 'ZAHLENLISTEN_OHNE_WIRKUNG');
  assert.ok(befund, 'die wirkungslosen Zahlenlisten müssen gemeldet werden');
  assert.equal(befund.value.zusatz, 4);
});

test('Mannschaft: eingetragene Leiharbeiter wirken und werden gezählt', () => {
  const api = freshApi();
  const vorher = api.analysis('ARBEITSSTAND').kpis.availableHours;
  mitLeihe(api, 'ARBEITSSTAND', 3, '2026-10-05');
  const nachher = api.analysis('ARBEITSSTAND').kpis.availableHours;
  assert.ok(nachher > vorher, `${vorher} -> ${nachher} Mannstunden`);
  const geplant = api.team('ARBEITSSTAND').people
    .filter((p) => p.kind === 'LEIHE' && p.startDate === '2026-10-05');
  assert.equal(geplant.length, 3);
  // Gezaehlt wird, was wirkt: fuenf zugesagte plus drei neue
  assert.equal(api.compare(['ARBEITSSTAND'])[0].tempWorkers, 8);
});
