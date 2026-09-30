/**
 * Tests der Schichtplanung der Arbeitsplaetze (engine/schichtplan.js).
 *
 * Vorgabe der Abteilungsleitung (18.09.2026): "Kein Platz frei ist keine
 * Option, plane dann an den Arbeitsplaetzen so die Schichten dass es
 * maximal effizient ist ... wenn dann immernoch Arbeitsplaetze fehlen
 * sollen diese angezeigt werden."
 *
 * Geprueft wird vor allem, dass der Vorschlag EHRLICH ist: Ein Vergleich
 * "vorher / nachher" darf nur die geplanten Schichten aendern und nichts
 * sonst. Genau daran ist die erste Fassung gescheitert (siehe Test
 * "Nullmassnahme").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';
import { runSchedule } from '../scheduler.js';
import { deepMerge } from '../model.js';
import { testConfig } from './helpers.js';
import {
  MAX_SCHICHTEN, SCHICHT_STUNDEN, schichtenAus, stundenFuer, schichtenJeArbeitsgang,
  eingestellteStunden, koepfeJeSchicht, gebrauchteSchichtkoepfe, mitSchichten,
  planeSchichten, fehlendePlaetze, wochenSchichten, schichtstandMachbar,
} from '../schichtplan.js';

function stand(mut = (c) => c) {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  input.config = mut(input.config) ?? input.config;
  return { input, result: runSchedule(input) };
}

const verspaetung = (r) => r.projects.reduce((a, p) => a + (p.lateDays || 0), 0);
const plane = (input, result) => planeSchichten(input, result,
  (config) => runSchedule({ ...input, config }));

/* ------------------------------------------------------------------ *
 * Umrechnung Stunden <-> Schichten
 * ------------------------------------------------------------------ */

test('Schichten und Stunden rechnen verlustfrei ineinander', () => {
  assert.equal(stundenFuer(1), SCHICHT_STUNDEN);
  assert.equal(stundenFuer(2), 15);
  assert.equal(stundenFuer(3), 22.5);
  // Mehr als drei Schichten gibt der Tag nicht her.
  assert.equal(stundenFuer(4), 22.5);
  assert.equal(schichtenAus(15), 2);
  assert.equal(schichtenAus(22.5), 3);
});

test('Eine versetzte Besetzung wird nicht heimlich zur ganzen Schicht', () => {
  /*
   * Der Fehler: `stundenFuer` hat die Schichtzahl gerundet. 12 h ergeben
   * 1,6 Schichten - daraus wurden 15 h, also 3 h Belegungszeit je Platz,
   * die niemand eingestellt hat.
   */
  assert.equal(schichtenAus(12), 1.6);
  assert.equal(stundenFuer(1.6), 12);
  assert.equal(stundenFuer(schichtenAus(12)), 12);
  assert.equal(stundenFuer(schichtenAus(18)), 18);
});

test('Die eingestellte Belegungszeit wird nicht mit der wirksamen verwechselt', () => {
  const { input } = stand();
  // Im Startdatenbestand stehen 7 h; gerechnet wird mit mindestens einer
  // Arbeitszeit (7,5 h). Die Anzeige braucht den eingestellten Wert.
  assert.equal(eingestellteStunden(input.config, 'SAEGEN'), 7);
  assert.equal(stundenFuer(schichtenJeArbeitsgang(input.config).SAEGEN), 7.5);
});

/* ------------------------------------------------------------------ *
 * Nullmassnahme: derselbe Schichtstand aendert nichts
 * ------------------------------------------------------------------ */

test('Nullmaßnahme: unveränderte Schichten ändern die Konfiguration nicht', () => {
  const { input } = stand();
  const gleich = mitSchichten(input.config, schichtenJeArbeitsgang(input.config));
  assert.deepEqual(gleich.resources.byOperation, input.config.resources.byOperation,
    'mitSchichten darf ohne Änderung keinen einzigen Eintrag anfassen');
});

test('Nullmaßnahme: unveränderte Schichten ändern das Ergebnis nicht', () => {
  // Der gemessene Fall: allgemein 12 h, also 1,6 Schichten je Arbeitsgang.
  // Vorher: 790 Verspätungstage in Wirklichkeit, 683 im internen Vergleich.
  const { input, result } = stand((c) => {
    const k = JSON.parse(JSON.stringify(c));
    k.resources.operatingHoursPerDay = 12;
    for (const op of Object.values(k.resources.byOperation ?? {})) delete op.operatingHours;
    return k;
  });
  const gleich = mitSchichten(input.config, schichtenJeArbeitsgang(input.config));
  const nachher = runSchedule({ ...input, config: gleich });
  assert.equal(verspaetung(nachher), verspaetung(result),
    'derselbe Schichtstand muss dieselbe Verspätung ergeben');
});

/* ------------------------------------------------------------------ *
 * Der Vorschlag selbst
 * ------------------------------------------------------------------ */

test('Der Schichtplan baut Verspätung ab', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  assert.equal(v.verspaetungVorher, verspaetung(result));
  assert.ok(v.verspaetungNachher < v.verspaetungVorher,
    `der Vorschlag muss Termine retten (${v.verspaetungVorher} -> ${v.verspaetungNachher})`);
  assert.ok(v.aenderungen.length > 0, 'im Startdatenbestand gibt es etwas zu planen');
  assert.ok(v.patch, 'ein Vorschlag mit Änderungen braucht einen Patch');
});

test('Jede geplante Schicht rettet mindestens einen Termin', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  for (const s of v.schritte) {
    if (!s.angewendet || s.grund === 'NICHT_MEHR_NOETIG') continue;
    assert.ok(s.verspaetungNachher <= s.verspaetungVorher - 1,
      `${s.name}: ${s.verspaetungVorher} -> ${s.verspaetungNachher} Tage rechtfertigt keine Schicht`);
  }
});

test('Jeder verworfene Schritt nennt seinen Grund', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  for (const s of v.schritte) {
    if (s.angewendet) continue;
    assert.ok(['OHNE_WIRKUNG', 'ZU_WENIG_SCHICHTFAEHIG'].includes(s.grund),
      `${s.name}: unbekannter Grund ${s.grund}`);
    if (s.grund === 'ZU_WENIG_SCHICHTFAEHIG') {
      assert.ok(s.gebraucht > s.vorhanden, 'die Zahlen müssen den Grund tragen');
    }
  }
});

test('Der Vorschlag bleibt bei höchstens drei Schichten', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  for (const [opId, n] of Object.entries(v.schichten)) {
    assert.ok(n <= MAX_SCHICHTEN + 0.001, `${opId}: ${n} Schichten`);
  }
});

test('Der Vorschlag verlangt nie mehr schichtfähige Leute als vorhanden', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  const gebraucht = gebrauchteSchichtkoepfe(v.schichten, mitSchichten(input.config, v.schichten));
  assert.ok(gebraucht <= v.schichtfaehig,
    `der Plan braucht ${gebraucht} schichtfähige Leute, es sind ${v.schichtfaehig}`);
});

test('Schichtstand ist nur machbar, wenn die BESTIMMTEN Personen dafür qualifiziert sind, '
  + 'nicht nur genug Köpfe insgesamt', () => {
  /*
   * Nutzerauftrag 27.09.2026 ("geh das an"): die alte Pruefung
   * (`gebrauchteSchichtkoepfe` gegen `faehig.capable`) zaehlte nur die
   * GESAMTZAHL schichtfaehiger Koepfe - ob dieselben Personen ueberhaupt
   * fuer die betroffenen Arbeitsgaenge qualifiziert sind, blieb
   * unberuecksichtigt. Konstruierter Beweisfall: zwei schichtfaehige
   * Personen, zwei Arbeitsgaenge mit je einem zusaetzlichen Kopf Bedarf
   * (macht zusammen genau 2 - die alte Pruefung haette das durchgehen
   * lassen) - aber BEIDE Personen sind nur fuer AV qualifiziert, fuer
   * BIEGEN qualifiziert niemand. Real ist das nicht machbar.
   */
  const config = testConfig({
    workforce: {
      baseHeadcount: 2,
      team: {
        source: 'MANNSCHAFT', enforceSkills: true,
        people: [
          { id: 'A', label: 'A', role: '', kind: 'STAMM', factor: 1, rate: null, shiftCapable: true,
            skills: { AV: true, BIEGEN: false }, absences: [], weeks: {}, pinnedOps: {},
            startDate: null, endDate: null, defaultActive: true, active: true, note: '' },
          { id: 'B', label: 'B', role: '', kind: 'STAMM', factor: 1, rate: null, shiftCapable: true,
            skills: { AV: true, BIEGEN: false }, absences: [], weeks: {}, pinnedOps: {},
            startDate: null, endDate: null, defaultActive: true, active: true, note: '' },
        ],
      },
    },
  });
  assert.equal(schichtstandMachbar({ AV: 2, BIEGEN: 2 }, config), false,
    'niemand ist für Biegen qualifiziert - trotz genug Köpfen insgesamt nicht machbar');
  assert.equal(schichtstandMachbar({ AV: 2, BIEGEN: 1 }, config), true,
    'ohne Biegen-Bedarf reicht eine der beiden Personen für AV aus');

  // Gegenprobe: qualifiziert eine Person auch für Biegen, wird derselbe Stand machbar.
  const config2 = JSON.parse(JSON.stringify(config));
  config2.workforce.team.people.find((p) => p.id === 'B').skills.BIEGEN = true;
  assert.equal(schichtstandMachbar({ AV: 2, BIEGEN: 2 }, config2), true,
    'sobald B auch Biegen darf, deckt A AV und B Biegen ab');
});

test('Der Patch enthält nur die geänderten Arbeitsgänge', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  const imPatch = Object.keys(v.patch.resources.byOperation);
  assert.deepEqual(imPatch.sort(), v.aenderungen.map((a) => a.opId).sort());
});

test('Das Übernehmen des Vorschlags ergibt genau die gerechnete Verspätung', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  // Uebernommen wird ueber `patch` (wochenweise) - nicht ueber `v.schichten`,
  // das ist nur noch der Spitzenwert je Arbeitsgang zur Anzeige.
  const angewendet = v.patch ? deepMerge(input.config, v.patch) : input.config;
  const nachher = runSchedule({ ...input, config: angewendet });
  assert.equal(verspaetung(nachher), v.verspaetungNachher,
    'was übernommen wird, muss dem gerechneten Vorschlag entsprechen');
});

/* ------------------------------------------------------------------ *
 * Was danach noch fehlt
 * ------------------------------------------------------------------ */

test('Was fehlt, wird in ganzen Plätzen benannt – und mit der echten Ursache', () => {
  const { input, result } = stand();
  const v = plane(input, result);
  assert.ok(v.fehlendePlaetze.length > 0, 'nach dem Plan bleibt im Startbestand etwas offen');
  for (const f of v.fehlendePlaetze) {
    assert.ok(f.name && f.stunden >= 5, `${f.name}: Kleinkram gehört nicht in die Liste`);
    assert.ok(Number.isInteger(f.plaetzeZusaetzlich),
      `${f.name}: ${f.plaetzeZusaetzlich} ist kein ganzer Platz`);
    assert.ok(f.text && f.text.length > 10, `${f.name}: ohne Klartext hilft der Eintrag nicht`);
    if (f.einheit === 'ANDERE_URSACHE') {
      assert.equal(f.plaetzeZusaetzlich, 0, 'hängt es nicht an Plätzen, werden keine gefordert');
      assert.ok(/begrenzt hier, nicht die Plätze/.test(f.text));
    }
  }
  // Der groesste Rueckstand muss dabei sein - genau das hat die erste
  // Fassung verschwiegen (Orbitalschweissen 305 h, Ursache "Mitarbeiter je
  // Auftrag"), waehrend sie Beizen und Saegen ausgewiesen hat.
  const groesste = [...v.fehlendePlaetze].sort((a, b) => b.stunden - a.stunden)[0];
  assert.equal(groesste, v.fehlendePlaetze[0],
    'die Liste muss beim größten Rückstand anfangen');
});

test('Beim Orbitalschweißen begrenzen die Schweißer, nicht die Maschinen', () => {
  const { input } = stand();
  const maschinen = Number(input.config.resources.orbitalMachinesActive
    ?? input.config.resources.orbitalMachines);
  const jeSchweisser = Number(input.config.resources.machinesPerWelder ?? 2);
  assert.equal(koepfeJeSchicht(input.config, 'ORBITAL_KEHLNAHT'),
    Math.floor(maschinen / jeSchweisser));
  assert.ok(koepfeJeSchicht(input.config, 'ORBITAL_KEHLNAHT') < maschinen,
    '"+13 Plätze" war genau dieser Fehler');
});

test('Ohne Rückstand fehlt auch kein Platz', () => {
  const { input } = stand();
  const leer = { projects: [], daySeries: [], blocked: [] };
  assert.deepEqual(fehlendePlaetze(input.config, leer, schichtenJeArbeitsgang(input.config)), []);
});

/* ------------------------------------------------------------------ *
 * Manuelle Schichtzuordnung (Nutzerauftrag 23.09.2026: "ich brauche noch
 * die Möglichkeit die Mitarbeiter KW weise in Schichten einzuplanen")
 * ------------------------------------------------------------------ */

test('Manuelle Schicht geht der automatischen Rotation vor', () => {
  const cfg = testConfig({ resources: { operatingHoursPerDay: 16 } });
  const personen = Array.from({ length: 8 }, (_, i) => ({ id: `P${i}`, shiftCapable: true, shiftWeeks: {} }));
  personen[0].shiftWeeks = { '2026-W40': 1 };
  personen[3].shiftWeeks = { '2026-W40': 1, '2026-W41': 2 };

  const wp = wochenSchichten(cfg, ['2026-W40', '2026-W41'], personen);
  assert.equal(wp.maxSchichten, 2, 'Testaufbau muss echten Mehrschichtbetrieb ergeben');
  assert.equal(wp.zuordnung['2026-W40'].P0, 1, 'manuelle Zuordnung gilt, auch wenn die Rotation Schicht 2 gewählt hätte');
  assert.equal(wp.zuordnung['2026-W40'].P3, 1);
  // Ohne eigenen Eintrag in KW41 rotiert P0 wieder automatisch
  assert.equal(wp.zuordnung['2026-W41'].P3, 2, 'die eigene Zuordnung für KW41 gilt');
  assert.ok(wp.zuordnung['2026-W41'].P0 != null, 'P0 bekommt in KW41 wieder eine Schicht aus der Rotation');

  // Jede Person erscheint in jeder Woche genau einmal - nichts geht verloren
  for (const wk of ['2026-W40', '2026-W41']) {
    assert.equal(Object.keys(wp.zuordnung[wk]).length, personen.length);
  }
});

test('Manuelle Schicht wirkt auch ohne echten Mehrschichtbetrieb', () => {
  /*
   * Bewusste Entscheidung: eine manuell gesetzte Schicht 2 gilt auch dann,
   * wenn in dieser Woche kein Arbeitsgang zweischichtig läuft - der
   * Einsatzplan erklärt in diesem Fall mit einem eigenen Grund, warum die
   * Person dort nichts zu tun bekommt (nicht stillschweigend ignorieren).
   */
  const cfg = testConfig();
  const personen = [
    { id: 'A', shiftCapable: true, shiftWeeks: { '2026-W40': 2 } },
    { id: 'B', shiftCapable: true, shiftWeeks: {} },
  ];
  const wp = wochenSchichten(cfg, ['2026-W40'], personen);
  assert.equal(wp.maxSchichten, 1, 'Testaufbau ist bewusst einschichtig');
  assert.equal(wp.zuordnung['2026-W40'].A, 2);
  assert.equal(wp.zuordnung['2026-W40'].B, 1);
});

test('Manuelle Schicht wird ignoriert, wenn die Person nicht schichtfähig ist', () => {
  const cfg = testConfig({ resources: { operatingHoursPerDay: 16 } });
  const personen = [
    { id: 'C', shiftCapable: false, shiftWeeks: { '2026-W40': 2 } },
    { id: 'D', shiftCapable: true, shiftWeeks: {} },
  ];
  const wp = wochenSchichten(cfg, ['2026-W40'], personen);
  assert.equal(wp.zuordnung['2026-W40'].C, 1, 'nicht schichtfähig bleibt immer Frühschicht');
});

/*
 * FIX (Nutzerfrage 30.09.2026): auf echten Daten landeten zwei liegen-
 * gebliebene Platzhalter-Kürzel ("LEIH TEST"/"LEIH TEST 2", Zeitanteil
 * factor:0) fast jede Woche in Schicht 3 - dort, wo laut "Schichten pro
 * Arbeitsgang" (Orbitalschweißen) real gearbeitet werden sollte. Sie
 * belegten die knappen Rotationsplätze, ohne selbst je etwas beizutragen
 * (factor:0 zählt überall sonst im Modell - z. B. teamOn() in team.js -
 * ausdrücklich mit null Kapazität).
 */
test('Personen mit Zeitanteil 0 (Karteileichen/Platzhalter) bekommen keine Schicht und blockieren keinen Rotationsplatz', () => {
  const cfg = testConfig({ resources: { operatingHoursPerDay: 16 } });
  const personen = [
    { id: 'REAL1', shiftCapable: true, factor: 1 },
    { id: 'REAL2', shiftCapable: true, factor: 1 },
    { id: 'GEIST1', shiftCapable: true, factor: 0 },
    { id: 'GEIST2', shiftCapable: true, factor: 0 },
  ];
  const wp = wochenSchichten(cfg, ['2026-W40'], personen);
  assert.equal(wp.maxSchichten, 2, 'Testaufbau muss echten Mehrschichtbetrieb ergeben');
  assert.equal(wp.zuordnung['2026-W40'].GEIST1, undefined,
    'Zeitanteil 0 zählt nirgends mit - keine Schicht, kein blockierter Rotationsplatz');
  assert.equal(wp.zuordnung['2026-W40'].GEIST2, undefined);
  assert.equal(Object.keys(wp.zuordnung['2026-W40']).length, 2,
    'nur die beiden echten Personen bekommen überhaupt eine Zuordnung');
});

/*
 * FIX (Nutzerfrage 30.09.2026, an echten Daten gefunden): grenzenRest[sn-1]
 * (das Ziel je Schicht minus schon manuell belegter Plätze) ist so
 * berechnet, dass es nie unter minZusammen faellt - das setzt aber
 * voraus, dass am Ende auch wirklich so viele NICHT manuell verplante
 * Personen uebrig sind. Waren (wie im echten Datenbestand) elf von zwoelf
 * schichtfaehigen Leuten eine Woche schon manuell auf Schicht 1/2 gesetzt,
 * blieb nur noch eine einzige freie Person fuer ein Zwei-Personen-Ziel in
 * Schicht 3 uebrig - und bekam die Schicht bisher trotzdem allein.
 */
test('Reicht der freie (nicht manuell verplante) Rest nicht für minZusammen, bleibt die Schicht unbesetzt statt eine Person allein zu schicken', () => {
  const cfg = testConfig({ resources: { operatingHoursPerDay: 22.5 } });
  const personen = [
    { id: 'A', shiftCapable: true, factor: 1, shiftWeeks: { '2026-W40': 1 } },
    { id: 'B', shiftCapable: true, factor: 1, shiftWeeks: { '2026-W40': 1 } },
    { id: 'C', shiftCapable: true, factor: 1, shiftWeeks: { '2026-W40': 1 } },
    // Einzige Person ohne manuelle Zuordnung - fuer sich allein zu wenig
    // fuer die Zwei-Personen-Regel in Schicht 3.
    { id: 'FREI', shiftCapable: true, factor: 1 },
  ];
  const wp = wochenSchichten(cfg, ['2026-W40'], personen);
  assert.equal(wp.maxSchichten, 3, 'Testaufbau muss echten Dreischichtbetrieb ergeben');
  assert.notEqual(wp.zuordnung['2026-W40'].FREI, 3,
    'FREI darf nicht allein in Schicht 3 landen - lieber Frühschicht als "keiner darf allein arbeiten" verletzen');
});
