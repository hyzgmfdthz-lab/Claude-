import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../defaults.js';
import { dayCapacity, dayKind, headcountFor, rampFactor, weldersFor, noboPresent, hydroWindowOpen, saturdayActive, placesFor, workersPerPlace, DAY_KIND, LIMITER } from '../capacity.js';
import { deepClone, round2 } from '../model.js';

const MO = '2026-09-07';
const SA = '2026-09-12';
const SO = '2026-09-13';

function cfg(mut = (c) => c) {
  const c = defaultConfig();
  c.planningDate = MO;
  c.productivity.global = 1;
  c.workforce.baseHeadcount = 10;
  // Startdaten der realen Planung fuer die Tests neutralisieren
  c.workforce.weekly = {};
  c.workforce.newHires = [];
  c.workforce.tempWorkers = [];
  // Zubehoerreserve gehoert nicht zur Grundformel - eigener Test unten
  c.workforce.reserveHoursPerWeek = 0;
  c.holidays = [];
  c.resources.operatingHoursPerDay = null;
  c.workforce.team.source = 'ZAHLEN';
  mut(c);
  return c;
}

test('Kapazität: Grundformel Mitarbeiter x Stunden x Produktivität', () => {
  const c = cfg((x) => { x.productivity.global = 0.85; });
  const d = dayCapacity(c, MO);
  // 10 MA * 7,5 h * 85 % = 63,75 h
  assert.equal(d.poolHours, 63.75);
  assert.equal(d.hoursPerEmployee, 7.5);
  assert.equal(d.kind, DAY_KIND.REGULAR);
});

test('Kapazität: Beispiel aus dem Lastenheft §19 (10 MA x 37,5 h x 85 %)', () => {
  const c = cfg((x) => { x.productivity.global = 0.85; });
  let week = 0;
  for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
    week += dayCapacity(c, d).poolHours;
  }
  assert.equal(Math.round(week * 100) / 100, 318.75);
});

test('Kapazität: Sonntag ohne Kapazität, Samstag nur wenn aktiviert', () => {
  const c = cfg();
  assert.equal(dayKind(c, SO), DAY_KIND.OFF);
  assert.equal(dayCapacity(c, SA).poolHours, 0);
  assert.equal(saturdayActive(c, SA), false);
  c.saturday.weeks['2026-W37'] = { enabled: true };
  assert.equal(saturdayActive(c, SA), true);
  assert.equal(dayKind(c, SA), DAY_KIND.SATURDAY);
});

test('Kapazität: Samstagsbesatz = 20 % der verfügbaren Mitarbeiter (§26)', () => {
  const c = cfg((x) => { x.workforce.baseHeadcount = 30; x.saturday.weeks['2026-W37'] = { enabled: true }; });
  const d = dayCapacity(c, SA);
  assert.equal(d.saturdayHeadcount, 6);          // 30 * 20 %
  assert.equal(d.poolHours, 36);                  // 6 MA * 6 h * 100 %
  const c40 = cfg((x) => { x.workforce.baseHeadcount = 40; x.saturday.weeks['2026-W37'] = { enabled: true }; });
  assert.equal(dayCapacity(c40, SA).saturdayHeadcount, 8);
});

test('Kapazität: Samstagsquote und manuelle Überschreibung (§27)', () => {
  const c = cfg((x) => { x.workforce.baseHeadcount = 30; x.saturday.quota = 0.4; x.saturday.weeks['2026-W37'] = { enabled: true }; });
  assert.equal(dayCapacity(c, SA).saturdayHeadcount, 12);
  c.saturday.weeks['2026-W37'].headcountOverride = 5;
  assert.equal(dayCapacity(c, SA).saturdayHeadcount, 5);
  assert.equal(dayCapacity(c, SA).poolHours, 30);
});

test('Kapazität: Überstunden erhöhen die Tageskapazität (§29)', () => {
  const base = dayCapacity(cfg(), MO).poolHours;
  const c = cfg((x) => { x.workforce.overtimePerEmployeeDefault = 5; });
  const withOt = dayCapacity(c, MO).poolHours;
  assert.equal(withOt - base, 10);               // 10 MA * 5 h / 5 Tage
});

test('Kapazität: Leiharbeiter und Einarbeitungskurve (§21/§22)', () => {
  assert.equal(rampFactor([0.4, 0.6, 0.8], 0), 0.4);
  assert.equal(rampFactor([0.4, 0.6, 0.8], 2), 0.8);
  assert.equal(rampFactor([0.4, 0.6, 0.8], 3), 1);
  const c = cfg((x) => {
    x.workforce.rampUp.temp = [0.5, 0.75];
    x.workforce.tempWorkers = [{ id: 'L1', label: 'Leih', count: 4, from: MO, to: null }];
  });
  assert.equal(headcountFor(c, MO).effective, 12);          // 10 + 4*0,5
  assert.equal(headcountFor(c, '2026-09-14').effective, 13); // Woche 2: 10 + 4*0,75
  assert.equal(headcountFor(c, '2026-09-21').effective, 14); // ab Woche 3: voll
  assert.equal(headcountFor(c, '2026-09-04').effective, 10); // vor Beginn
});

test('Kapazität: Abwesenheiten reduzieren die Kapazität', () => {
  const c = cfg((x) => { x.workforce.weekly['2026-W37'] = { absent: 3 }; });
  assert.equal(headcountFor(c, MO).effective, 7);
});

test('Kapazität: Orbital – Maschinen und Schweißer als getrennte Restriktionen (§13)', () => {
  // 6 Maschinen, 2 Schweißer, 1 Schweißer bedient 2 Maschinen -> 4 Maschinen nutzbar
  const c = cfg((x) => {
    x.resources.orbitalMachines = 6; x.resources.orbitalMachinesActive = 6;
    x.resources.welders = { default: 2, byWeekday: {}, byDate: {} };
    x.skills.ORBITAL.share = 1;
  });
  const d = dayCapacity(c, MO);
  assert.equal(d.resources.orbitalMachinesUsable, 4);
  // Arbeitsinhalt in Mannstunden: 2 Schweißer x 7,5 h
  assert.equal(d.byOp.ORBITAL.capUnits, 15);
  assert.equal(d.byOp.ORBITAL.limiter, LIMITER.ORBITAL_WELDER);
  // Maschinenstunden = Mannstunden x Maschinen je Schweißer
  assert.equal(d.byOp.ORBITAL.detail.machineHoursCapacity, 45);

  // 5 Schweißer, 6 Maschinen -> Maschinen limitieren (6/2 = 3 Schweißerplätze)
  const c2 = cfg((x) => {
    x.resources.orbitalMachines = 6; x.resources.orbitalMachinesActive = 6;
    x.resources.welders = { default: 5, byWeekday: {}, byDate: {} };
    x.skills.ORBITAL.share = 1;
  });
  const d2 = dayCapacity(c2, MO);
  assert.equal(d2.resources.orbitalMachinesUsable, 6);
  assert.equal(d2.byOp.ORBITAL.limiter, LIMITER.ORBITAL_MACHINE);
  assert.equal(d2.byOp.ORBITAL.capUnits, 3 * 7.5);
});

test('Kapazität: Mannstunden und Maschinenstunden bleiben getrennt (§54)', () => {
  const c = cfg((x) => {
    x.resources.orbitalMachinesActive = 6;
    x.resources.machinesPerWelder = 2;
    x.resources.welders = { default: 5, byWeekday: {}, byDate: {} };
  });
  const d = dayCapacity(c, MO).byOp.ORBITAL;
  assert.equal(d.capManHours, 22.5);                  // 3 Schweißer x 7,5 h
  assert.equal(d.detail.machineHoursCapacity, 45);    // 6 Maschinen x 7,5 h
  assert.equal(d.detail.machineHoursCapacity, d.capManHours * 2);
});

test('Kapazität: Betriebszeitfenster verlängert nur die Platzbelegung, nicht die Arbeitszeit', () => {
  const eng = cfg((x) => { x.resources.operatingHoursPerDay = 7.5; x.resources.heftPlaces = 2; x.resources.workersPerHeftPlace = 1; });
  const weit = cfg((x) => { x.resources.operatingHoursPerDay = 14; x.resources.heftPlaces = 2; x.resources.workersPerHeftPlace = 1; });
  assert.equal(dayCapacity(eng, MO).byOp.HEFTEN.capUnits, 15);
  assert.equal(dayCapacity(weit, MO).byOp.HEFTEN.capUnits, 28);
  // Der Mannstundenpool bleibt unverändert
  assert.equal(dayCapacity(eng, MO).poolHours, dayCapacity(weit, MO).poolHours);
});

test('Kapazität: Betreuungsstunden für neue Kräfte werden abgezogen', () => {
  const ohne = cfg();
  const mit = cfg((x) => {
    x.workforce.newHires = [{ id: 'N', label: 'Neu', count: 2, from: MO }];
    x.workforce.rampUp.mentoringHoursPerWeek = { temp: [5, 3, 1], hire: [5, 3, 1] };
  });
  const a = dayCapacity(ohne, MO);
  const b = dayCapacity(mit, MO);
  // 2 Neue x 0,4 Leistung x 7,5 h = 6 h brutto, abzüglich 2 x 5 h / 5 Tage = 2 h Betreuung
  assert.equal(b.mentoringHours, 2);
  assert.equal(round2(b.poolHours), round2(a.poolHours + 6 - 2));
});

test('Kapazität: Maschinenausfall senkt die Orbitalkapazität (§12)', () => {
  const base = cfg((x) => { x.resources.welders = { default: 5, byWeekday: {}, byDate: {} }; x.skills.ORBITAL.share = 1; });
  const before = dayCapacity(base, MO).byOp.ORBITAL.capUnits;
  const after = dayCapacity(cfg((x) => {
    x.resources.welders = { default: 5, byWeekday: {}, byDate: {} };
    x.resources.orbitalMachinesActive = 5; x.skills.ORBITAL.share = 1;
  }), MO).byOp.ORBITAL.capUnits;
  assert.ok(after < before, 'Weniger Maschinen müssen weniger Kapazität ergeben');
  assert.equal(round2(before - after), 3.75); // eine Maschine = eine halbe Schweißerstelle
});

test('Kapazität: Schweißer je Wochentag konfigurierbar (§14)', () => {
  const c = cfg((x) => { x.resources.welders = { default: 4, byWeekday: { 1: 5, 5: 3 }, byDate: { '2026-09-08': 2 } }; });
  assert.equal(weldersFor(c, '2026-09-07', DAY_KIND.REGULAR), 5);
  assert.equal(weldersFor(c, '2026-09-08', DAY_KIND.REGULAR), 2); // Tagesübersteuerung schlägt Wochentag
  assert.equal(weldersFor(c, '2026-09-09', DAY_KIND.REGULAR), 4); // Standard
  assert.equal(weldersFor(c, '2026-09-11', DAY_KIND.REGULAR), 3);
});

test('Kapazität: dritter Heftplatz erhöht die Heftkapazität (§15)', () => {
  const c2 = cfg((x) => { x.resources.heftPlaces = 2; x.resources.workersPerHeftPlace = 1; x.skills.HEFTEN.share = 1; });
  const c3 = cfg((x) => { x.resources.heftPlaces = 3; x.resources.workersPerHeftPlace = 1; x.skills.HEFTEN.share = 1; });
  const a = dayCapacity(c2, MO).byOp.HEFTEN.capUnits;
  const b = dayCapacity(c3, MO).byOp.HEFTEN.capUnits;
  assert.equal(a, 15);
  assert.equal(b, 22.5);
  assert.ok(b > a);
});

test('Kapazität: Hydro nur Di–Do und nur bei NoBo-Anwesenheit (§36/§37)', () => {
  const c = cfg((x) => { x.nobo.weekdays = [2, 4]; }); // NoBo nur Di und Do
  assert.equal(hydroWindowOpen(c, '2026-09-07'), false); // Montag
  assert.equal(hydroWindowOpen(c, '2026-09-08'), true);  // Dienstag
  assert.equal(hydroWindowOpen(c, '2026-09-11'), false); // Freitag
  assert.equal(dayCapacity(c, '2026-09-07').byOp.HYDRO.capUnits, 0);
  assert.equal(dayCapacity(c, '2026-09-07').byOp.HYDRO.limiter, LIMITER.HYDRO_WINDOW);
  // Mittwoch: Fenster offen, aber NoBo standardmäßig abwesend
  assert.equal(noboPresent(c, '2026-09-09'), false);
  assert.equal(dayCapacity(c, '2026-09-09').byOp.HYDRO.capUnits, 0);
  assert.equal(dayCapacity(c, '2026-09-09').byOp.HYDRO.limiter, LIMITER.NOBO);
  // Dienstag: NoBo anwesend
  assert.ok(dayCapacity(c, '2026-09-08').byOp.HYDRO.capUnits > 0);
  // NoBo-Ausnahme für einen konkreten Tag
  c.nobo.exceptions['2026-09-09'] = true;
  assert.ok(dayCapacity(c, '2026-09-09').byOp.HYDRO.capUnits > 0);
  c.nobo.exceptions['2026-09-08'] = false;
  assert.equal(dayCapacity(c, '2026-09-08').byOp.HYDRO.capUnits, 0);
});

test('Kapazität: Qualifikationsanteil begrenzt den Arbeitsgang (§18)', () => {
  // Ohne Platzgrenze zählt allein die Qualifikation: 75 h x 20 % = 15 h
  const c = cfg((x) => { x.skills.SAEGEN.share = 0.2; x.resources.enforcePlaces = false; });
  const d = dayCapacity(c, MO);
  assert.equal(d.poolHours, 75);
  assert.equal(d.byOp.SAEGEN.capUnits, 15);
  assert.equal(d.byOp.SAEGEN.limiter, LIMITER.SKILL);

  // Mit Platzgrenze ist der eine Sägeplatz zuerst voll (7,5 h)
  const mitPlatz = cfg((x) => { x.skills.SAEGEN.share = 0.2; x.resources.operatingHoursPerDay = 7.5; });
  const e = dayCapacity(mitPlatz, MO);
  assert.equal(e.byOp.SAEGEN.capUnits, 7.5);
  assert.equal(e.byOp.SAEGEN.limiter, LIMITER.WORKPLACE);
});

test('Kapazität: Feiertage sind arbeitsfrei', () => {
  const c = cfg((x) => { x.holidays = ['2026-09-08']; });
  assert.equal(dayCapacity(c, '2026-09-08').poolHours, 0);
  assert.equal(dayKind(c, '2026-09-08'), DAY_KIND.OFF);
});

test('Kapazität: Konfiguration wird nicht verändert (Seiteneffektfreiheit)', () => {
  const c = cfg();
  const snapshot = JSON.stringify(c);
  dayCapacity(c, MO);
  dayCapacity(c, SA);
  assert.equal(JSON.stringify(c), snapshot);
  void deepClone;
});

/* ------------------------------------------------------------------ *
 * Plaetze der Werkstatt (Auskunft der Abteilungsleitung 09/2026)
 * ------------------------------------------------------------------ */

test('Plätze: ein Sägeplatz, ein Entgratplatz, ein Biegeplatz', () => {
  const c = defaultConfig();
  assert.equal(placesFor(c, 'SAEGEN'), 1);
  assert.equal(placesFor(c, 'ENTGRATEN'), 1);
  assert.equal(placesFor(c, 'BIEGEN'), 1);
  assert.equal(placesFor(c, 'REINIGEN'), 1);
  assert.equal(placesFor(c, 'HYDRO'), 1, 'ein Prüfstand');
});

test('Plätze: Vormontage und Endkontrolle mit zwei Personen je Platz', () => {
  const c = defaultConfig();
  assert.equal(placesFor(c, 'VORMONTAGE'), 2);
  assert.equal(workersPerPlace(c, 'VORMONTAGE'), 2);
  assert.equal(placesFor(c, 'ENDKONTROLLE'), 2);
  assert.equal(workersPerPlace(c, 'ENDKONTROLLE'), 2);
  assert.equal(workersPerPlace(c, 'SAEGEN'), 1);
});

test('Platzgrenze begrenzt die Kapazität eines Arbeitsganges', () => {
  const eng = cfg((x) => {
    x.workforce.baseHeadcount = 10;
    x.resources.operatingHoursPerDay = 7.5;
  });
  const saegen = dayCapacity(eng, MO).byOp.SAEGEN;
  // 1 Platz x 1 Person x 7,5 h - nicht die Stunden aller zehn Mitarbeiter
  assert.ok(saegen.capUnits <= 7.6, `ein Sägeplatz erlaubt höchstens 7,5 h, waren ${saegen.capUnits}`);
  assert.equal(saegen.limiter, 'WORKPLACE');

  // Vormontage: zwei Plätze, je zwei Personen = viermal so viel
  const vor = dayCapacity(eng, MO).byOp.VORMONTAGE;
  assert.ok(vor.capUnits > saegen.capUnits * 3.5, `${vor.capUnits} gegen ${saegen.capUnits}`);
});

test('Platzgrenzen lassen sich für den Vergleich abschalten', () => {
  const mit = cfg((x) => { x.workforce.baseHeadcount = 10; });
  const ohne = cfg((x) => { x.workforce.baseHeadcount = 10; x.resources.enforcePlaces = false; });
  assert.ok(dayCapacity(ohne, MO).byOp.SAEGEN.capUnits > dayCapacity(mit, MO).byOp.SAEGEN.capUnits);
  assert.equal(placesFor(ohne, 'SAEGEN'), null);
  // Heftplätze und Maschinen wirken immer
  assert.equal(placesFor(ohne, 'HEFTEN'), mit.resources.heftPlaces);
  assert.equal(placesFor(ohne, 'ORBITAL'), mit.resources.orbitalMachinesActive);
});

test('Längere Belegungszeit hebt die Platzgrenze an (Schichtbetrieb)', () => {
  const einSchicht = cfg((x) => { x.workforce.baseHeadcount = 10; x.resources.operatingHoursPerDay = 7.5; });
  const dreiSchicht = cfg((x) => { x.workforce.baseHeadcount = 10; x.resources.operatingHoursPerDay = 22.5; });
  const a = dayCapacity(einSchicht, MO).byOp.SAEGEN.capUnits;
  const b = dayCapacity(dreiSchicht, MO).byOp.SAEGEN.capUnits;
  assert.ok(b > a * 2.5, `drei Schichten am selben Platz: ${a} -> ${b}`);
});
