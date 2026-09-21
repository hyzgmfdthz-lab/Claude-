/**
 * Tests des Urlaubsplanung-Einlesers.
 *
 * Die Urlaubsplanung der Abteilung ist eine Tabelle mit den Kalendertagen
 * oben und je Person einer Zeile darunter. Sie wird eingelesen, nicht
 * abgetippt - eine verrutschte Spalte wuerde jemandem Urlaub erfinden.
 * Genau das pruefen diese Tests: Ausrichtung, unbekannte Kuerzel und die
 * Zurueckhaltung bei der Zuordnung.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendanceMatrix, absentPerDay, absentPerWeek, parseDay } from '../anwesenheitsmatrix.js';
import { defaultConfig } from '../defaults.js';
import { headcountFor } from '../capacity.js';
import { weekday } from '../calendar.js';

/**
 * Baut eine Matrix wie in der Ursprungsdatei: Kopfzeile mit Tagen, eine
 * Nullzeile, eine Leerzeile, dann die Personenzeilen. Wochenenden bleiben
 * leer.
 * @param {string[]} tage ISO-Daten
 * @param {Record<string,string>[]} zeilen Datum -> Kuerzel
 */
function matrix(tage, zeilen) {
  const kopf = tage.map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`);
  const zeilenText = zeilen.map((z) => tage.map((d) => z[d] ?? '').join('\t'));
  return [
    kopf.join('\t'),
    tage.map(() => '0,0').join('\t'),
    tage.map(() => '').join('\t'),
    ...zeilenText,
  ].join('\n');
}

/** Alle Tage eines Zeitraums. */
function tage(von, bis) {
  const out = [];
  const add = (s, n) => {
    const x = new Date(`${s}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  for (let d = von; d <= bis; d = add(d, 1)) out.push(d);
  return out;
}

/** Zeile: an Werktagen 'T', an den genannten Tagen 'A'. */
function zeile(alleTage, abwesend = [], sonder = {}) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const d of alleTage) {
    if (weekday(d) > 5) continue;
    out[d] = abwesend.includes(d) ? 'A' : 'T';
  }
  return { ...out, ...sonder };
}

test('Urlaubsplanung: Spalten werden tagegenau zugeordnet', () => {
  const t = tage('2026-09-15', '2026-10-02');
  const m = parseAttendanceMatrix(matrix(t, [
    zeile(t),
    zeile(t, ['2026-09-23']),
    zeile(t, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']),
  ]), { year: 2026 });

  assert.equal(m.from, '2026-09-15');
  assert.equal(m.to, '2026-10-02');
  assert.equal(m.dates.length, 18, 'alle Kalendertage stehen in der Kopfzeile');
  assert.equal(m.workdays, 14, 'davon 14 Arbeitstage');
  assert.equal(m.rows.length, 3, 'Nullzeile und Leerzeile sind keine Personen');

  // Die einzelne Abwesenheit liegt auf dem richtigen Tag
  assert.deepEqual(m.rows[1].absences, [
    { from: '2026-09-23', to: '2026-09-23', kind: 'URLAUB', code: 'A', days: 1 },
  ]);
  // Die Urlaubswoche ist EIN Zeitraum, nicht fünf Einträge
  assert.deepEqual(m.rows[2].absences, [
    { from: '2026-09-28', to: '2026-10-02', kind: 'URLAUB', code: 'A', days: 5 },
  ]);
  assert.equal(m.rows[0].abwesend, 0);
  assert.equal(m.warnings.length, 0, 'eine saubere Tabelle erzeugt keine Warnung');
});

test('Urlaubsplanung: ein Wochenende unterbricht den Urlaub nicht', () => {
  const t = tage('2026-09-15', '2026-09-30');
  // Donnerstag bis Dienstag durchgehend abwesend
  const m = parseAttendanceMatrix(matrix(t, [
    zeile(t, ['2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22']),
  ]), { year: 2026 });
  assert.deepEqual(m.rows[0].absences, [
    { from: '2026-09-17', to: '2026-09-22', kind: 'URLAUB', code: 'A', days: 4 },
  ]);
  assert.equal(m.rows[0].absences[0].days, 4, 'gezählt werden die Arbeitstage, nicht die Kalendertage');
});

test('Urlaubsplanung: DM ist bekannt – Demontage in eine andere Abteilung', () => {
  const t = tage('2026-09-15', '2026-09-25');
  // Auskunft der Abteilungsleitung: "DM = Demontage, der MA ist verliehen
  // in eine andere Abteilung". Fuer den Armaturenbau ist er damit weg.
  const m = parseAttendanceMatrix(matrix(t, [
    zeile(t, [], { '2026-09-17': 'DM', '2026-09-18': 'DM', '2026-09-21': 'DM' }),
  ]), { year: 2026 });
  assert.deepEqual(m.unknownCodes, [], 'DM muss nicht mehr erfragt werden');
  assert.equal(m.rows[0].unbekannt, 0);
  assert.equal(m.rows[0].abwesend, 3);
  assert.deepEqual(m.rows[0].absences, [
    { from: '2026-09-17', to: '2026-09-21', kind: 'VERLEIH', code: 'DM', days: 3 },
  ], 'eigene Art VERLEIH – das ist kein Urlaub');
  assert.equal(absentPerDay(m)['2026-09-17'], 1);
});

test('Urlaubsplanung: wirklich unbekannte Kürzel werden gemeldet, nicht geraten', () => {
  const t = tage('2026-09-15', '2026-09-25');
  const text = matrix(t, [
    zeile(t, [], { '2026-09-17': 'ZZ', '2026-09-18': 'ZZ', '2026-09-21': 'ZZ' }),
  ]);
  const ohne = parseAttendanceMatrix(text, { year: 2026 });
  assert.deepEqual(ohne.unknownCodes, [{ code: 'ZZ', count: 3, rows: [1] }]);
  assert.equal(ohne.rows[0].unbekannt, 3);
  assert.equal(ohne.rows[0].abwesend, 0, 'ohne Deutung zählt ZZ nicht als Abwesenheit');
  assert.equal(ohne.rows[0].absences.length, 0, 'und erzeugt keinen Zeitraum');
  assert.equal(absentPerDay(ohne)['2026-09-17'], 0);

  // Mit Deutung "abwesend" wirkt es
  const alsWeg = parseAttendanceMatrix(text, { year: 2026, codes: { ZZ: false } });
  assert.equal(alsWeg.unknownCodes.length, 0, 'gedeutete Kürzel sind nicht mehr unbekannt');
  assert.equal(alsWeg.rows[0].abwesend, 3);
  assert.equal(absentPerDay(alsWeg, { ZZ: false })['2026-09-17'], 1);

  // Mit Deutung "anwesend" ebenso klar
  const alsDa = parseAttendanceMatrix(text, { year: 2026, codes: { ZZ: true } });
  assert.equal(alsDa.rows[0].abwesend, 0);
  assert.equal(alsDa.rows[0].anwesend, 9);
});

test('Urlaubsplanung: verrutschte Spalten fallen auf', () => {
  const t = tage('2026-09-15', '2026-09-25');
  // Eintrag am Samstag - typisch fuer eine um einen Tag verschobene Zeile
  const m = parseAttendanceMatrix(matrix(t, [
    zeile(t, [], { '2026-09-19': 'T' }),
  ]), { year: 2026 });
  assert.equal(m.weekendFilled, 1);
  assert.ok(m.warnings.some((w) => /Samstag oder Sonntag/.test(w)),
    'die Anwendung meldet den Eintrag am Wochenende');
});

test('Urlaubsplanung: fehlende Tage in einer Zeile werden gemeldet', () => {
  const t = tage('2026-09-15', '2026-09-25');
  const voll = zeile(t);
  const lueckig = zeile(t);
  delete lueckig['2026-09-22'];
  delete lueckig['2026-09-23'];
  const m = parseAttendanceMatrix(matrix(t, [voll, lueckig]), { year: 2026 });
  assert.ok(m.warnings.some((w) => /andere Anzahl gepflegter Tage/.test(w)));
});

test('Urlaubsplanung: Abwesende je Tag und je Woche', () => {
  const t = tage('2026-09-21', '2026-09-25');
  const m = parseAttendanceMatrix(matrix(t, [
    zeile(t, ['2026-09-21', '2026-09-22']),
    zeile(t, ['2026-09-21']),
    zeile(t),
  ]), { year: 2026 });
  const jeTag = absentPerDay(m);
  assert.equal(jeTag['2026-09-21'], 2);
  assert.equal(jeTag['2026-09-22'], 1);
  assert.equal(jeTag['2026-09-23'], 0);
  const jeWoche = absentPerWeek(m);
  assert.equal(jeWoche['2026-W39'].personDays, 3, 'drei Personentage Abwesenheit');
  assert.equal(jeWoche['2026-W39'].days, 5);
});

test('Urlaubsplanung: Kopfzeile in verschiedenen Schreibweisen', () => {
  assert.equal(parseDay('15.09.', 2026), '2026-09-15');
  assert.equal(parseDay('15.9.', 2026), '2026-09-15');
  assert.equal(parseDay('15.09.2026', 2027), '2026-09-15', 'ein angegebenes Jahr schlägt die Vorgabe');
  assert.equal(parseDay('2026-09-15', 2026), '2026-09-15');
  assert.equal(parseDay('Summe', 2026), null);
  assert.equal(parseDay('31.02.', 2026), null, 'den 31. Februar gibt es nicht');
  assert.equal(parseDay('', 2026), null);
});

test('Urlaubsplanung: ohne Kopfzeile eine klare Fehlermeldung', () => {
  assert.throws(() => parseAttendanceMatrix('T\tT\tT\nA\tA\tA'), /Kopfzeile/);
  assert.throws(() => parseAttendanceMatrix('15.09.\t16.09.\t17.09.'), /keine Anwesenheitszeilen/);
});

test('Nicht zugeordnete Abwesende senken die Besetzung', () => {
  const c = defaultConfig();
  const voll = headcountFor(c, '2026-11-02').effective;
  c.workforce.plannedAbsences = { '2026-11-02': 3 };
  const mit = headcountFor(c, '2026-11-02');
  assert.equal(mit.plannedAbsent, 3);
  assert.equal(mit.effective, voll - 3, 'drei Abwesende mit Zeitanteil 1,0');
  assert.equal(mit.source, 'MANNSCHAFT');
});

test('Messwerte gelten nur bis zum Stichtag', () => {
  /*
   * Vorgabe der Abteilungsleitung (15.09.2026): "ab morgen Mannschaft -
   * sonst haengt die Zukunft an einer Liste, die niemand mehr pflegt."
   */
  const c = defaultConfig();
  c.planningDate = '2026-11-02';
  c.workforce.dailyAvailable = { '2026-10-30': 7, '2026-11-02': 7, '2026-11-03': 7 };
  c.workforce.plannedAbsences = { '2026-11-02': 3, '2026-11-03': 3 };

  const amStichtag = headcountFor(c, '2026-11-02');
  assert.equal(amStichtag.source, 'TAGESLISTE', 'am Stichtag gilt noch der Messwert');
  assert.equal(amStichtag.effective, 7);
  assert.equal(amStichtag.plannedAbsent, 0, 'der Messwert wird nicht zusätzlich gekürzt');

  const danach = headcountFor(c, '2026-11-03');
  assert.equal(danach.source, 'MANNSCHAFT', 'nach dem Stichtag rechnet die Mannschaft');
  assert.equal(danach.plannedAbsent, 3);
  assert.ok(danach.effective !== 7, 'der Vorschauwert der Liste wirkt nicht mehr');

  const davor = headcountFor(c, '2026-10-30');
  assert.equal(davor.source, 'TAGESLISTE');
});
