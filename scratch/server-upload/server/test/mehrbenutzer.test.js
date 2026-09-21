/**
 * Tests des Mehrbenutzerbetriebs.
 *
 * Vier Personen (Leiter, Teamleiter, zwei Vorarbeiter) arbeiten gleichzeitig
 * mit einem Datenbestand auf einem Rechner im Netz. Es darf niemand die
 * Aenderung eines anderen unbemerkt ueberschreiben.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.js';
import { createApi } from '../api.js';
import { readXlsx } from '../xlsx.js';
import { createServer } from '../server.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'megc-multi-'));
}
function freshApi() {
  return createApi(openStore(tmpDir()));
}

test('Änderungsstand zählt bei jeder Änderung hoch', () => {
  const api = freshApi();
  const start = api.revision();
  assert.equal(typeof start.revision, 'number');

  api.setActor({ id: 'DOHE', admin: true });
  const p = api.createProject({ orderNo: 'MU-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01' });
  const nachAnlegen = api.revision();
  assert.ok(nachAnlegen.revision > start.revision, 'Anlegen muss den Änderungsstand erhöhen');
  assert.equal(nachAnlegen.changedBy, 'DOHE');
  assert.ok(nachAnlegen.changedAt, 'Zeitpunkt der Änderung muss festgehalten werden');

  api.setActor({ id: 'KEMI' });
  api.updateProject(p.id, { customer: 'Kunde' });
  const nachAendern = api.revision();
  assert.ok(nachAendern.revision > nachAnlegen.revision);
  assert.equal(nachAendern.changedBy, 'KEMI');

  // Lesen allein darf den Stand nicht veraendern
  api.state();
  api.analysis('BASELINE');
  assert.equal(api.revision().revision, nachAendern.revision);
});

test('Parameteränderung eines Kollegen ist am Änderungsstand erkennbar', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  const vorher = api.revision().revision;

  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 12 } } });
  const nachher = api.revision();
  assert.ok(nachher.revision > vorher);
  assert.equal(nachher.changedBy, 'DOHE');

  // Ein zweiter Benutzer sieht dieselbe Zahl und kann so neu laden
  const zweiter = api.revision();
  assert.equal(zweiter.revision, nachher.revision);
  assert.equal(zweiter.changedBy, 'DOHE');
});

test('Angaben zum Bearbeiter werden begrenzt und sind optional', () => {
  const api = freshApi();
  const lang = api.setActor({ id: 'x'.repeat(200) });
  assert.ok(lang.name.length <= 20);

  api.setActor(null);
  api.createProject({ orderNo: 'ANONYM', projectType: 'UMBAU', variant: 'FT20', dueDate: '2026-12-01' });
  assert.equal(api.revision().changedBy, '', 'ohne Anmeldung bleibt der Nachweis leer');
});

test('Der zuletzt Speichernde gewinnt – die Änderung des anderen bleibt sichtbar', () => {
  const api = freshApi();

  api.setActor({ id: 'SVHE' });
  const a = api.createProject({ orderNo: 'GLEICHZEITIG-A', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01' });
  const revA = api.revision().revision;

  api.setActor({ id: 'KEER' });
  const b = api.createProject({ orderNo: 'GLEICHZEITIG-B', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-02' });

  const nummern = api.state().projects.map((p) => p.orderNo);
  assert.ok(nummern.includes('GLEICHZEITIG-A'), 'die Änderung des ersten Benutzers darf nicht verloren gehen');
  assert.ok(nummern.includes('GLEICHZEITIG-B'));
  assert.ok(api.revision().revision > revA);
  assert.notEqual(a.id, b.id);
});

test('Änderungsstand übersteht das Neustarten des Servers', () => {
  const dir = tmpDir();
  const erste = createApi(openStore(dir));
  erste.setActor({ id: 'STWUE' });
  erste.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 11 } } });
  const rev = erste.revision();

  const zweite = createApi(openStore(dir));
  assert.equal(zweite.revision().revision, rev.revision);
  assert.equal(zweite.revision().changedBy, 'STWUE');
});

/** Meldet ein Kuerzel an und liefert die Kopfzeile fuer weitere Aufrufe. */
async function anmelden(base, user, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, newPassword: password }),
  });
  const data = await res.json();
  return { token: data.token, headers: { 'Content-Type': 'application/json', 'X-MEGC-Token': data.token } };
}

test('Netzbetrieb: Bearbeiter ergibt sich aus der Anmeldung', async () => {
  const { server } = createServer({ dataDir: tmpDir() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const kollege = await anmelden(base, 'KEMI', 'Kollege2026');
  const vorher = await (await fetch(`${base}/api/revision`, { headers: kollege.headers })).json();

  const angelegt = await (await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: kollege.headers,
    body: JSON.stringify({ orderNo: 'NETZ-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01' }),
  })).json();
  assert.ok(angelegt.id);

  const nachher = await (await fetch(`${base}/api/revision`, { headers: kollege.headers })).json();
  assert.ok(nachher.revision > vorher.revision, 'der Änderungsstand muss über das Netz erkennbar sein');
  assert.equal(nachher.changedBy, 'KEMI');

  // Ein zweites Kuerzel aendert denselben Auftrag
  const zweiter = await anmelden(base, 'SVHE', 'Zweiter2026');
  await fetch(`${base}/api/projects/${angelegt.id}`, {
    method: 'PUT',
    headers: zweiter.headers,
    body: JSON.stringify({ customer: 'Netzkunde' }),
  });
  const danach = await (await fetch(`${base}/api/revision`, { headers: zweiter.headers })).json();
  assert.equal(danach.changedBy, 'SVHE');

  // Abmelden macht den Schluessel sofort ungueltig
  await fetch(`${base}/api/logout`, { method: 'POST', headers: kollege.headers, body: '{}' });
  const gesperrt = await fetch(`${base}/api/state`, { headers: kollege.headers });
  assert.equal(gesperrt.status, 401);

  await new Promise((r) => server.close(r));
});

test('Netzbetrieb: ohne Anmeldung gibt es keine Daten', async () => {
  const { server } = createServer({ dataDir: tmpDir() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const pfad of ['/api/state', '/api/analysis', '/api/projects', '/api/states', '/api/users', '/api/changelog']) {
    const res = await fetch(`${base}${pfad}`);
    assert.equal(res.status, 401, `${pfad} muss ohne Anmeldung gesperrt sein`);
  }
  // Die Oberflaeche selbst muss geladen werden koennen (sonst kein Anmeldebild)
  assert.equal((await fetch(`${base}/`)).status, 200);

  await new Promise((r) => server.close(r));
});

test('Netzbetrieb: Personalbedarf ist über das Netz abrufbar', async () => {
  const { server } = createServer({ dataDir: tmpDir() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { headers } = await anmelden(base, 'DOHE', 'Leitung2026');

  const antwort = await fetch(`${base}/api/required-staff?scenario=BASELINE&maxStaff=6`, { headers });
  assert.equal(antwort.status, 200);
  const r = await antwort.json();
  assert.ok('needed' in r && 'solved' in r);
  assert.ok(r.base.late > 0, 'im Startdatenbestand gibt es verspätete Aufträge');
  if (!r.solved) assert.ok(r.bottleneck, 'wenn Personal nicht reicht, muss der Engpass benannt sein');

  await new Promise((r2) => server.close(r2));
});

/* ================================================================== *
 * Anmeldung
 * ================================================================== */

test('Erstanmeldung: Passwort wird selbst vergeben', () => {
  const api = freshApi();

  // Ohne Passwort fragt die Anwendung nach einem neuen - ohne Fehlermeldung
  const erst = api.login({ user: 'kemi' });
  assert.equal(erst.needsPassword, true);
  assert.equal(erst.user, 'KEMI');
  assert.equal(erst.token, undefined, 'ohne Passwort gibt es keine Sitzung');
  assert.ok(erst.hint.includes('KEMI'));

  // Zu kurzes Passwort wird abgelehnt
  assert.throws(() => api.login({ user: 'KEMI', newPassword: 'abc' }), /mindestens/);

  const s = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  assert.equal(s.user.id, 'KEMI');
  assert.equal(s.user.admin, false);
  assert.ok(s.token);
  assert.equal(api.sessionUser(s.token).user.id, 'KEMI');

  // Danach gilt das Passwort
  assert.throws(() => api.login({ user: 'KEMI', password: 'falsch' }), /stimmt nicht/);
  assert.ok(api.login({ user: 'KEMI', password: 'Kollege2026' }).token);

  // Unbekanntes Kürzel verrät nichts
  assert.throws(() => api.login({ user: 'GIBTESNICHT', password: 'x' }), /stimmt nicht/);
});

test('Kürzel wird unabhängig von Groß-/Kleinschreibung erkannt', () => {
  const api = freshApi();
  api.login({ user: 'SvHe', newPassword: 'Kollege2026' });
  assert.ok(api.login({ user: ' svhe ', password: 'Kollege2026' }).token);
});

test('Abgelaufene Anmeldungen gelten nicht mehr', () => {
  const api = freshApi();
  const s = api.login({ user: 'KEER', newPassword: 'Kollege2026' });
  assert.ok(api.sessionUser(s.token));

  // Ablauf künstlich vorziehen
  const sitzung = api.dataset.sessions.find((x) => x.userId === 'KEER');
  sitzung.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(api.sessionUser(s.token), null, 'nach Ablauf ist die Sitzung ungültig');
  assert.equal(api.dataset.sessions.some((x) => x.userId === 'KEER'), false, 'abgelaufene Sitzungen werden entfernt');
});

test('Abmelden beendet genau eine Sitzung', () => {
  const api = freshApi();
  const a = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  const b = api.login({ user: 'KEMI', password: 'Kollege2026' });
  api.logout(a.token);
  assert.equal(api.sessionUser(a.token), null);
  assert.ok(api.sessionUser(b.token), 'die zweite Anmeldung bleibt bestehen');
});

test('Passwort ändern beendet die übrigen Anmeldungen', () => {
  const api = freshApi();
  const a = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  const b = api.login({ user: 'KEMI', password: 'Kollege2026' });

  assert.throws(() => api.changePassword(a.token, { oldPassword: 'falsch', newPassword: 'Neues2026' }), /bisherige/);
  api.changePassword(a.token, { oldPassword: 'Kollege2026', newPassword: 'Neues2026' });

  assert.ok(api.sessionUser(a.token), 'die eigene Anmeldung bleibt');
  assert.equal(api.sessionUser(b.token), null, 'andere Anmeldungen werden beendet');
  assert.ok(api.login({ user: 'KEMI', password: 'Neues2026' }).token);
});

/* ================================================================== *
 * Benutzerverwaltung
 * ================================================================== */

test('Kürzel anlegen und Passwort zurücksetzen darf nur die Verwaltung', () => {
  const api = freshApi();
  const kollege = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  api.setActor(api.sessionUser(kollege.token).user);

  assert.throws(() => api.createUser({ id: 'NEU' }), /Verwaltung/);
  assert.throws(() => api.resetUserPassword('SVHE'), /Verwaltung/);
  assert.throws(() => api.deleteUser('SVHE'), /Verwaltung/);

  const chef = api.login({ user: 'DOHE', newPassword: 'Leitung2026' });
  api.setActor(api.sessionUser(chef.token).user);

  const neu = api.createUser({ id: 'mamu', label: 'M. Mustermann' });
  assert.equal(neu.id, 'MAMU');
  assert.equal(neu.hasPassword, false);
  assert.throws(() => api.createUser({ id: 'MAMU' }), /gibt es bereits/);
  assert.throws(() => api.createUser({ id: 'A' }), /2 bis 10/);
  assert.throws(() => api.createUser({ id: 'AB-CD' }), /2 bis 10/, 'Sonderzeichen sind nicht erlaubt');
  // Leerzeichen werden entfernt statt abgelehnt
  assert.equal(api.createUser({ id: 'st wu' }).id, 'STWU');

  // Zuruecksetzen: danach wird bei der naechsten Anmeldung neu vergeben
  api.resetUserPassword('KEMI');
  assert.equal(api.sessionUser(kollege.token), null, 'laufende Anmeldung wird beendet');
  assert.equal(api.login({ user: 'KEMI', password: 'Kollege2026' }).needsPassword, true,
    'nach dem Zurücksetzen wird ein neues Passwort verlangt');
  assert.ok(api.login({ user: 'KEMI', newPassword: 'Wieder2026' }).token);

  api.deleteUser('MAMU');
  assert.equal(api.users().some((u) => u.id === 'MAMU'), false);
});

test('Das letzte Kürzel der Verwaltung bleibt bestehen', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  assert.throws(() => api.deleteUser('DOHE'), /letzte Kürzel/);
});

test('Vollständige Datensicherung als JSON: nur die Verwaltung darf', () => {
  /*
   * Nutzerauftrag (21.09.2026): die Netzwerkversion soll denselben
   * "Datensicherung speichern"-Knopf haben wie die Einzeldatei-Fassung.
   * Der Export enthält Kürzel und Passwort-Hashes - deshalb nur Verwaltung.
   */
  const api = freshApi();
  const kollege = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  api.setActor(api.sessionUser(kollege.token).user);
  assert.throws(() => api.exportDataset(), /Verwaltung/);

  const chef = api.login({ user: 'DOHE', newPassword: 'Leitung2026' });
  api.setActor(api.sessionUser(chef.token).user);
  const json = api.exportDataset();
  const geladen = JSON.parse(json);
  assert.ok(Array.isArray(geladen.projects) && geladen.projects.length > 0);
  assert.ok(Array.isArray(geladen.scenarios) && geladen.scenarios.length > 0);
  assert.ok(Array.isArray(geladen.users) && geladen.users.some((u) => u.id === 'DOHE'));
});

/* ================================================================== *
 * Staende
 * ================================================================== */

test('Stand speichern: Notiz ist Pflicht, Stände sind für alle sichtbar', () => {
  const api = freshApi();
  api.setActor({ id: 'SVHE' });

  assert.throws(() => api.saveState({ name: 'Ohne Notiz', note: '' }), /worum es/);
  assert.throws(() => api.saveState({ name: '', note: 'Notiz' }), /Namen/);

  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 14 } } });
  const stand = api.saveState({ name: 'Mit 14 Leuten', note: 'Vorschlag fürs Personalgespräch' });
  assert.ok(stand.id);
  assert.equal(stand.createdBy, 'SVHE');
  assert.ok(stand.meta.otd >= 0 && stand.meta.projects > 0, 'Kennzahlen des Standes werden mitgeführt');

  // Ein Kollege sieht den Stand
  api.setActor({ id: 'KEMI' });
  const liste = api.states();
  assert.ok(liste.some((s) => s.id === stand.id));
  assert.equal(liste.find((s) => s.id === stand.id).mayDelete, false, 'löschen darf nur der Ersteller oder die Verwaltung');

  // Ansehen veraendert nichts
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 25 } } });
  const info = api.stateSummary(stand.id);
  assert.equal(info.config.workforce.baseHeadcount, 14);
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.workforce.baseHeadcount, 25);

  // Laden setzt den Arbeitsstand zurueck auf den Stand
  api.loadState(stand.id);
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.workforce.baseHeadcount, 14);

  // Der gespeicherte Stand bleibt unveraendert erhalten
  assert.ok(api.states().some((s) => s.id === stand.id));
});

test('Stand löschen: nur Ersteller oder Verwaltung', () => {
  const api = freshApi();
  api.setActor({ id: 'SVHE' });
  const stand = api.saveState({ name: 'Von SVHE', note: 'Test' });

  api.setActor({ id: 'KEMI' });
  assert.throws(() => api.deleteState(stand.id), /Löschen darf nur/);

  api.setActor({ id: 'DOHE', admin: true });
  api.deleteState(stand.id);
  assert.equal(api.states().some((s) => s.id === stand.id), false);

  api.setActor({ id: 'SVHE' });
  const eigener = api.saveState({ name: 'Eigener', note: 'Test' });
  api.deleteState(eigener.id);
  assert.equal(api.states().some((s) => s.id === eigener.id), false);
});

test('Anmeldungen überstehen das Laden eines Standes und das Zurücksetzen', () => {
  const api = freshApi();
  const chef = api.login({ user: 'DOHE', newPassword: 'Leitung2026' });
  api.setActor(api.sessionUser(chef.token).user);
  const stand = api.saveState({ name: 'Vor dem Zurücksetzen', note: 'Sicherung' });

  api.loadState(stand.id);
  assert.ok(api.sessionUser(chef.token), 'nach dem Laden bleibt man angemeldet');

  api.resetAll();
  assert.ok(api.sessionUser(chef.token), 'auch nach dem Zurücksetzen auf Startdaten');
  assert.ok(api.users().length >= 6, 'die Kürzel bleiben erhalten');
});

test('Täglich wird automatisch ein Stand gesichert', () => {
  const api = freshApi();
  api.setActor({ id: 'SVHE' });
  api.updateProject(api.state().projects[0].id, { customer: 'Test' });
  const auto = api.states().filter((s) => s.kind === 'AUTO');
  assert.equal(auto.length, 1, 'einmal je Tag');
  api.updateProject(api.state().projects[0].id, { customer: 'Test 2' });
  assert.equal(api.states().filter((s) => s.kind === 'AUTO').length, 1, 'nicht bei jeder Änderung');
});

/* ================================================================== *
 * Aenderungsprotokoll und Aufholen
 * ================================================================== */

test('Änderungsprotokoll nennt Person und Klartext', () => {
  const api = freshApi();
  api.setActor({ id: 'SVHE' });
  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 12 } } });
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 18 } } });

  const log = api.changeLog(10);
  assert.ok(log.length >= 2);
  assert.equal(log[0].by, 'SVHE');
  assert.ok(log[1].text.includes('Belegungszeit je Tag'), `Klartext erwartet, war: ${log[1].text}`);
  assert.ok(log[1].text.includes('12 h'));
  assert.ok(log[0].text.includes('Stammmitarbeiter'));
  assert.ok(log[0].at >= log[1].at, 'neueste Einträge zuerst');
});

test('Aufholen zeigt nur fremde Änderungen seit dem letzten Besuch', () => {
  const api = freshApi();
  const ich = api.login({ user: 'KEMI', newPassword: 'Kollege2026' });
  api.markSeen(ich.token);

  // Eigene Änderung zählt nicht
  api.setActor({ id: 'KEMI' });
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 11 } } });
  assert.equal(api.catchUp(ich.token).entries.length, 0);

  // Änderung eines Kollegen zählt
  api.setActor({ id: 'SVHE' });
  api.updateScenario('ARBEITSSTAND', { config: { resources: { heftPlaces: 3 } } });
  const nachricht = api.catchUp(ich.token);
  assert.equal(nachricht.entries.length, 1);
  assert.deepEqual(nachricht.people, ['SVHE']);
  assert.ok(nachricht.entries[0].text.includes('Heftplätze'));

  // Nach "Alles gelesen" ist es wieder ruhig
  api.markSeen(ich.token);
  assert.equal(api.catchUp(ich.token).entries.length, 0);
});

/* ================================================================== *
 * Aktueller Plan
 * ================================================================== */

test('Ein Szenario kann als aktueller Plan markiert werden', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  const szenario = api.createScenario({ name: 'Mit 3 Leiharbeitern' });

  api.setCurrentPlan(szenario.id);
  const state = api.state();
  assert.equal(state.currentPlanScenarioId, szenario.id);
  assert.equal(state.scenarios.find((s) => s.id === szenario.id).isCurrentPlan, true);
  assert.equal(state.scenarios.filter((s) => s.isCurrentPlan).length, 1, 'immer nur einer');

  api.setCurrentPlan(null);
  assert.equal(api.state().currentPlanScenarioId, null);
  assert.throws(() => api.setCurrentPlan('GIBTESNICHT'), /nicht gefunden/);
});

/* ================================================================== *
 * Altdaten
 * ================================================================== */

test('Datenbestand aus der Vorversion wird ergänzt, nicht beschädigt', () => {
  const dir = tmpDir();
  const store = openStore(dir);

  // Datenbestand, wie ihn die Fassung vor der Anmeldung geschrieben hat:
  // ohne users, sessions, changeLog, rules und ohne currentPlanScenarioId.
  const alt = createApi(openStore(tmpDir())).dataset;
  const ohneNeues = JSON.parse(JSON.stringify(alt));
  delete ohneNeues.users;
  delete ohneNeues.sessions;
  delete ohneNeues.changeLog;
  delete ohneNeues.rules;
  delete ohneNeues.currentPlanScenarioId;
  store.save(ohneNeues, 'Altbestand');

  const api = createApi(openStore(dir));
  assert.ok(api.users().length >= 6, 'die Kürzel werden angelegt');
  assert.ok(api.users().some((u) => u.admin), 'es gibt eine Verwaltung');
  assert.deepEqual(api.changeLog(5), []);
  assert.deepEqual(api.rules().rules, []);
  assert.equal(api.state().currentPlanScenarioId, null);

  // Die Planung selbst ist unverändert rechenbar
  assert.equal(api.analysis('BASELINE').projects.length, ohneNeues.projects.length);
  assert.ok(api.login({ user: 'DOHE', newPassword: 'Leitung2026' }).token);
});

test('Eine Sicherungsdatei ohne Kürzel sperrt niemanden aus', () => {
  const api = freshApi();
  api.login({ user: 'DOHE', newPassword: 'Leitung2026' });
  api.setActor({ id: 'DOHE', admin: true });

  const fremd = JSON.parse(JSON.stringify(api.dataset));
  delete fremd.users;
  fremd.projects = fremd.projects.slice(0, 3);

  api.replaceDataset(fremd);
  assert.equal(api.state().projects.length, 3, 'die Daten werden übernommen');
  assert.ok(api.users().length >= 6, 'die Kürzel der Installation bleiben');
  assert.ok(api.login({ user: 'DOHE', password: 'Leitung2026' }).token, 'Anmeldung weiter möglich');
});

/* ================================================================== *
 * Leeren von Sammelwerten
 * ================================================================== */

test('„Entfernen" leert Wochenwerte, Samstage und eigene Werte je Arbeitsgang wirklich', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });

  // Ausgangslage: Wochenwerte sind gepflegt
  const vorher = api.scenarioConfig('ARBEITSSTAND').config;
  assert.ok(Object.keys(vorher.workforce.weekly).length > 0);

  // Ein leeres Objekt im Patch darf NICHTS löschen (sonst wären Änderungen
  // an einem Teilbereich gefährlich) - dafür gibt es "clear".
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { weekly: {} } } });
  assert.ok(Object.keys(api.scenarioConfig('ARBEITSSTAND').config.workforce.weekly).length > 0,
    'ein leeres Objekt allein löscht nichts');

  api.updateScenario('ARBEITSSTAND', { clear: ['workforce.weekly'] });
  assert.equal(Object.keys(api.scenarioConfig('ARBEITSSTAND').config.workforce.weekly).length, 0,
    'mit clear sind die Wochenwerte weg');
  assert.ok(api.changeLog(1)[0].text.includes('Wochenwerte entfernt'));

  // Samstage
  api.updateScenario('ARBEITSSTAND', { config: { saturday: { weeks: { '2026-W40': { enabled: true }, '2026-W41': { enabled: true } } } } });
  assert.equal(Object.keys(api.scenarioConfig('ARBEITSSTAND').config.saturday.weeks).length, 2);
  api.updateScenario('ARBEITSSTAND', { config: { saturday: { enabledDefault: false } }, clear: ['saturday.weeks'] });
  assert.equal(Object.keys(api.scenarioConfig('ARBEITSSTAND').config.saturday.weeks).length, 0);

  // Eigene Werte je Arbeitsgang
  api.updateScenario('ARBEITSSTAND', { config: { resources: { byOperation: { ORBITAL: { operatingHours: 22.5 } } } } });
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.resources.byOperation.ORBITAL.operatingHours, 22.5);
  api.updateScenario('ARBEITSSTAND', { clear: ['resources.byOperation'] });
  assert.deepEqual(api.scenarioConfig('ARBEITSSTAND').config.resources.byOperation, {});
});

test('Die Mannschaft ist die Grundlage – Wochenzahlen wirken nicht mehr', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE' });
  const vorher = api.analysis('ARBEITSSTAND').kpis.availableHours;

  // Die alten Zahlenfelder dürfen die Rechnung nicht mehr verändern,
  // solange die Mannschaft die Grundlage ist - sonst gäbe es zwei
  // Wahrheiten und niemand wüsste, welche gilt.
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 30 } } });
  api.updateScenario('ARBEITSSTAND', { clear: ['workforce.weekly'] });
  assert.equal(api.analysis('ARBEITSSTAND').kpis.availableHours, vorher);

  // Wirksam ist die Mannschaft: zwei zusaetzliche Leiharbeiter fuer zwei
  // Wochen. Genommen werden Platzhalter - die fuenf zugesagten sind
  // ohnehin schon eingeplant.
  const team = api.team('ARBEITSSTAND');
  const leihe = team.people.filter((p) => p.kind === 'LEIHE' && !p.startDate).slice(0, 2);
  for (const p of leihe) { p.weeks = { '2026-W41': true, '2026-W42': true }; }
  const people = team.people.map((p) => leihe.find((l) => l.id === p.id) ?? p);
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { team: { people } } } });
  const nachher = api.analysis('ARBEITSSTAND').kpis.availableHours;
  assert.ok(nachher > vorher,
    `Leiharbeiter aus der Mannschaft müssen die Kapazität erhöhen (${vorher} -> ${nachher})`);

  // Und die Rückfallebene bleibt möglich
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { team: { source: 'ZAHLEN' } } } });
  assert.ok(api.analysis('ARBEITSSTAND').kpis.availableHours !== nachher,
    'mit den Zahlen als Grundlage rechnet die Anwendung wieder anders');
});

/* ================================================================== *
 * IST-Stand (Referenz): einmal fixieren, alles dagegen messen
 * ================================================================== */

test('IST-Stand: fixieren, Abweichung messen, aufheben', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });

  assert.equal(api.reference('ARBEITSSTAND'), null, 'ohne festgelegten IST-Stand gibt es keinen Vergleich');
  assert.equal(api.state().referenceStateId, null);

  // Ausgangszustand einfrieren
  const ist = api.fixCurrentAsReference({ name: 'IST 14.09.', note: 'Ausgangslage vor der Simulation' });
  assert.ok(ist.id);
  assert.equal(api.state().referenceStateId, ist.id);

  const gleich = api.reference('ARBEITSSTAND');
  assert.equal(gleich.state.id, ist.id);
  assert.equal(gleich.delta.otd, 0, 'ohne Änderung ist die Abweichung null');
  assert.equal(gleich.delta.late, 0);
  assert.deepEqual(gleich.projectChanges, [], 'ohne Änderung hat sich kein Auftrag verschoben');

  // Mehr Personal allein reicht nicht - der Engpass sind Maschinen,
  // Plätze und Belegungszeiten. Erst alles zusammen hebt die Termintreue.
  const team = api.team('ARBEITSSTAND');
  const people = team.people.map((p) => (p.kind === 'LEIHE'
    ? { ...p, weeks: {}, defaultActive: true }
    : p));
  api.updateScenario('ARBEITSSTAND', {
    config: {
      workforce: { team: { people } },
      resources: { orbitalMachinesActive: 12, welders: { default: 8 }, operatingHoursPerDay: 20, enforcePlaces: false },
      projectLimits: { maxParallelProjects: 8 },
    },
  });
  const besser = api.reference('ARBEITSSTAND');
  assert.equal(besser.ist.otd, gleich.ist.otd, 'der IST-Stand selbst ändert sich nie');
  assert.ok(besser.jetzt.otd > besser.ist.otd, `Termintreue muss steigen: ${besser.ist.otd} -> ${besser.jetzt.otd}`);
  assert.ok(besser.delta.otd > 0);
  assert.ok(besser.delta.late <= 0, 'weniger oder gleich viele verspätete Aufträge');
  assert.ok(besser.delta.availableHours > 0, 'mehr Leute = mehr Kapazität');
  assert.ok(besser.projectChanges.length > 0, 'die Verschiebungen müssen einzeln benannt sein');
  assert.equal(besser.istProjects, besser.jetztProjects);
  for (const c of besser.projectChanges) {
    assert.ok(c.orderNo, 'jede Veränderung nennt den Auftrag');
    assert.ok(['STATUS', 'TERMIN', 'NEU'].includes(c.change));
  }

  // Aufheben
  api.setReferenceState(null);
  assert.equal(api.state().referenceStateId, null);
  assert.equal(api.reference('ARBEITSSTAND'), null);
});

test('Urlaubsplanung einlesen: zugeordnete Zeilen werden echte Abwesenheit', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE' });

  // Kopfzeile, Nullzeile, Leerzeile und drei Personenzeilen - wie in der
  // Ursprungsdatei. Das Wochenende bleibt leer.
  const text = [
    '21.09.\t22.09.\t23.09.\t24.09.\t25.09.\t26.09.\t27.09.\t28.09.\t29.09.',
    '0,0\t0,0\t0,0\t0,0\t0,0\t0,0\t0,0\t0,0\t0,0',
    '\t\t\t\t\t\t\t\t',
    'T\tT\tT\tT\tT\t\t\tT\tT',
    'A\tA\tA\tA\tA\t\t\tT\tT',
    'T\tT\tDM\tDM\tDM\t\t\tT\tT',
  ].join('\n');

  const vorschau = api.parseAttendance(text, { year: 2026 });
  assert.equal(vorschau.from, '2026-09-21');
  assert.equal(vorschau.to, '2026-09-29');
  assert.equal(vorschau.rows.length, 3, 'Nullzeile und Leerzeile sind keine Personen');
  assert.deepEqual(vorschau.unknownCodes, [],
    'DM ist bekannt: Demontage in eine andere Abteilung');
  assert.equal(vorschau.rows[1].abwesend, 5);
  assert.equal(vorschau.rows[2].abwesend, 3, 'die drei DM-Tage zählen als abwesend');

  // Zeile 2 gehoert JARO, Zeile 3 bleibt offen
  const r = api.applyAttendance('ARBEITSSTAND', {
    text, year: 2026, mapping: { 2: 'JARO' }, replace: true,
  });
  assert.equal(r.assigned, 1);
  assert.equal(r.open, 2);
  assert.equal(r.absencesWritten, 1, 'die Urlaubswoche ist ein Zeitraum');

  const jaro = api.team('ARBEITSSTAND').people.find((p) => p.id === 'JARO');
  assert.deepEqual(jaro.absences, [
    { from: '2026-09-21', to: '2026-09-25', kind: 'URLAUB', note: 'Urlaubsplanung (A)' },
  ]);

  // Die offenen Zeilen stehen als Anzahl je Tag
  const geplant = api.scenarioConfig('ARBEITSSTAND').config.workforce.plannedAbsences;
  assert.equal(geplant['2026-09-23'], 1, 'der verliehene Mitarbeiter fehlt dem Armaturenbau');
  assert.equal(geplant['2026-09-21'], undefined, 'JAROs Urlaub steht bei ihm, nicht hier');
  assert.equal(geplant['2026-09-28'], undefined, 'an anwesenden Tagen steht nichts');

  const imp = api.scenarioConfig('ARBEITSSTAND').config.workforce.attendanceImport;
  assert.equal(imp.rows, 3);
  assert.equal(imp.assigned, 1);
  assert.equal(imp.by, 'DOHE');

  // Ein zweites Einlesen ersetzt den Zeitraum und verdoppelt nichts
  api.applyAttendance('ARBEITSSTAND', {
    text, year: 2026, mapping: { 2: 'JARO' }, replace: true,
  });
  assert.equal(api.team('ARBEITSSTAND').people.find((p) => p.id === 'JARO').absences.length, 1);

  // Dasselbe Kürzel zweimal ist ein Fehler
  assert.throws(() => api.applyAttendance('ARBEITSSTAND', {
    text, year: 2026, mapping: { 1: 'JARO', 2: 'JARO' },
  }), /zwei Zeilen/);
  assert.throws(() => api.applyAttendance('ARBEITSSTAND', {
    text, year: 2026, mapping: { 1: 'GIBTSNICHT' },
  }), /gibt es nicht/);
  assert.throws(() => api.parseAttendance(''), /keine Tabelle/);
});

test('IST-Stand: ein beliebiger gespeicherter Stand kann der IST-Stand sein', () => {
  const api = freshApi();
  api.setActor({ id: 'SVHE' });

  const wenig = api.saveState({ name: 'Ausgangslage', note: 'nur die zugesagten Leiharbeiter' });
  const imIst = api.team('ARBEITSSTAND').people
    .filter((p) => p.kind === 'LEIHE' && p.defaultActive).length;
  assert.equal(imIst, 5, 'im Ausgangsstand sind die fünf zugesagten Leiharbeiter eingeplant');

  // Alle 15 Leiharbeiter dauerhaft dazu
  const team = api.team('ARBEITSSTAND');
  const people = team.people.map((p) => (p.kind === 'LEIHE' ? { ...p, defaultActive: true } : p));
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { team: { people } } } });
  api.setReferenceState(wenig.id);

  const v = api.reference('ARBEITSSTAND');
  assert.equal(v.state.id, wenig.id);
  assert.equal(v.istConfig.workforce.team.people.filter((p) => p.kind === 'LEIHE' && p.defaultActive).length,
    imIst, 'der IST-Stand führt seine eigene Mannschaft mit – die zehn Platzhalter sind dort nicht aktiv');
  assert.ok(v.delta.availableHours > 0, `mehr Kapazität als im IST-Stand erwartet, war ${v.delta.availableHours}`);
  assert.ok(v.delta.otd >= 0);

  assert.throws(() => api.setReferenceState('STD-gibtesnicht'), /nicht gefunden/);
});

test('IST-Stand: gelöschter Stand blockiert die Anzeige nicht', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  const ist = api.fixCurrentAsReference({ name: 'IST', note: 'Ausgangslage' });
  assert.ok(api.reference('ARBEITSSTAND'));
  api.deleteState(ist.id);
  assert.equal(api.reference('ARBEITSSTAND'), null, 'ohne den Stand gibt es keinen Vergleich – aber auch keinen Fehler');
  assert.equal(api.state().referenceStateId, null, 'die Markierung wird mitgelöscht');
});

test('IST-Stand: Vergleich steht auch in der Excel-Mappe', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  api.fixCurrentAsReference({ name: 'IST', note: 'Ausgangslage' });
  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 22.5 } } });
  api.setActiveScenario('ARBEITSSTAND');

  const sheets = readXlsx(api.exportWorkbook('ARBEITSSTAND'));
  const blatt = sheets.find((s) => s.name === 'Vergleich IST');
  assert.ok(blatt, 'die Mappe muss ein Vergleichsblatt enthalten');
  const text = blatt.rows.map((r) => r.join('|')).join('\n');
  assert.ok(text.includes('Verspätung gesamt (Tage)'));
  assert.ok(text.includes('Geänderte Stellschrauben'));
  assert.ok(text.includes('Belegungszeit je Tag'), 'die geänderte Stellschraube muss benannt sein');

  // Ohne IST-Stand bleibt die Mappe wie bisher
  api.setReferenceState(null);
  assert.equal(readXlsx(api.exportWorkbook('ARBEITSSTAND')).some((s) => s.name === 'Vergleich IST'), false);
});

test('IST-Stand vergleicht Parameter, nicht Aufträge', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  api.fixCurrentAsReference({ name: 'IST', note: 'Ausgangslage' });

  // Ein neuer Auftrag gehört zu beiden Seiten - er ist kein Unterschied
  api.createProject({ orderNo: 'NEU-1', projectType: 'NEUBAU', variant: 'FT40', dueDate: '2026-12-01' });
  const v = api.reference('ARBEITSSTAND');
  assert.equal(v.delta.otd, 0, 'ohne geänderte Stellschraube bleibt der Vergleich neutral');
  assert.deepEqual(v.changes, [], 'es wurde keine Stellschraube verändert');

  // Erst eine geänderte Stellschraube erzeugt einen Unterschied
  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 22.5 } } });
  const w = api.reference('ARBEITSSTAND');
  assert.ok(w.delta.totalLateDays < 0, 'längere Belegungszeit muss Verspätung abbauen');
  assert.equal(w.changes.length, 1);
  assert.equal(w.changes[0].label, 'Belegungszeit je Tag');
  assert.ok(Array.isArray(w.istWeeks) && w.istWeeks.length > 0, 'die IST-Kapazitätslinie gehört dazu');
});

/* ================================================================== *
 * Versuchsverlauf, Schritt zurück und Schritt vor
 * ================================================================== */

test('Verlauf: jede Änderung wird mit ihrer Wirkung mitgeschrieben', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });

  assert.equal(api.history('ARBEITSSTAND').entries.length, 0);

  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 22.5 } } });
  const h1 = api.history('ARBEITSSTAND');
  assert.equal(h1.entries.length, 1);
  const e = h1.entries[0];
  assert.match(e.label, /Belegungszeit/);
  assert.equal(e.by, 'DOHE');
  assert.equal(e.mine, true);
  assert.equal(e.canUndo, true);
  assert.ok(e.kpis, 'die Kennzahlen nach der Änderung gehören dazu');

  // Zweite Änderung: die Wirkung wird gegen die erste gerechnet
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { overtimePerEmployeeDefault: 5 } } });
  const h2 = api.history('ARBEITSSTAND');
  assert.equal(h2.entries.length, 2);
  assert.match(h2.entries[0].label, /Überstunden/);
  assert.ok(h2.entries[0].effect, 'die Wirkung muss ausgewiesen sein');
  assert.equal(typeof h2.entries[0].effect.lateDays, 'number');
  // Neueste zuerst
  assert.ok(h2.entries[0].at >= h2.entries[1].at);
});

test('Verlauf: Schritt zurück und Schritt vor drehen genau eine Änderung', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  const vorher = api.scenarioConfig('ARBEITSSTAND').config.resources.operatingHoursPerDay;

  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 22.5 } } });
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.resources.operatingHoursPerDay, 22.5);
  assert.equal(api.state().history.canUndo, true);

  api.undo('ARBEITSSTAND');
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.resources.operatingHoursPerDay, vorher,
    'nach dem Schritt zurück steht der alte Wert wieder da');
  assert.equal(api.state().history.canRedo, true);

  api.redo('ARBEITSSTAND');
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.resources.operatingHoursPerDay, 22.5);

  api.undo('ARBEITSSTAND');
  assert.throws(() => api.undo('ARBEITSSTAND'), /keinen eigenen Schritt/);
});

test('Verlauf: fremde Änderungen werden nicht zurückgenommen', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 12 } } });

  api.setActor({ id: 'KEMI' });
  assert.throws(() => api.undo('ARBEITSSTAND'), /keinen eigenen Schritt/);

  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 15 } } });
  api.undo('ARBEITSSTAND');
  assert.equal(api.scenarioConfig('ARBEITSSTAND').config.workforce.baseHeadcount, 12,
    'KEMI nimmt nur die eigene Änderung zurück, DOHEs Wert bleibt');
});

test('Verlauf: auf einen früheren Versuch zurückspringen', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 12 } } });
  const ziel = api.history('ARBEITSSTAND').entries[0].id;
  api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: 20 } } });
  api.updateScenario('ARBEITSSTAND', { config: { resources: { heftPlaces: 3 } } });

  const r = api.jumpToHistory(ziel);
  assert.equal(r.undone, 2, 'zwei Schritte werden zurückgedreht');
  const cfg = api.scenarioConfig('ARBEITSSTAND').config;
  assert.equal(cfg.workforce.baseHeadcount, 12);
  assert.equal(cfg.resources.heftPlaces, 2, 'auch der Heftplatz ist wieder wie vorher');
});

test('Verlauf: Versuche benennen und bis zu drei vergleichen', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  const ids = [];
  for (const n of [10, 12, 14, 16]) {
    api.updateScenario('ARBEITSSTAND', { config: { workforce: { baseHeadcount: n } } });
    ids.push(api.history('ARBEITSSTAND').entries[0].id);
  }
  api.updateHistoryEntry(ids[0], { note: 'Variante A', pinned: null });
  assert.equal(api.history('ARBEITSSTAND').entries.find((e) => e.id === ids[0]).note, 'Variante A');

  for (const id of ids.slice(0, 3)) api.updateHistoryEntry(id, { note: null, pinned: true });
  assert.equal(api.history('ARBEITSSTAND').pinned.length, 3);
  assert.throws(() => api.updateHistoryEntry(ids[3], { note: null, pinned: true }), /höchstens drei/);
});

test('Verlauf: wirkungslose Versuche werden als solche erkannt', () => {
  const api = freshApi();
  api.setActor({ id: 'DOHE', admin: true });
  // Eine andere Reihenfolge aendert an diesem Auftragsbestand nichts
  api.updateScenario('ARBEITSSTAND', { config: { sequencing: { rule: 'EDD' } } });
  const e = api.history('ARBEITSSTAND').entries[0];
  assert.equal(e.withoutEffect, true, 'ohne Wirkung muss erkennbar sein');

  api.updateScenario('ARBEITSSTAND', { config: { resources: { operatingHoursPerDay: 22.5 } } });
  assert.equal(api.history('ARBEITSSTAND').entries[0].withoutEffect, false);
});
