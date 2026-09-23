/**
 * Nachrechenbarkeit der Stunden.
 *
 * Diese Pruefungen gehen auf eine Meldung der Abteilungsleitung vom
 * 18.09.2026 zurueck: "Die Zahlen und Rechnungen sind nicht logisch ...
 * laut der Engpassuebersicht habe ich belegt 3145 h und weitere 3286
 * koennen nicht eingeplant werden, das kann nicht passen."
 *
 * Der Vorwurf traf zu. Drei Dinge waren falsch:
 *   1. Die Engpasszahl summierte eine TAGESwarteschlange ueber alle
 *      Wartetage - Einheit "Stunden mal Tage", ausgegeben als Stunden.
 *   2. Die Kapazitaet zaehlte die Randwoche komplett, auch ueber den
 *      Termin hinaus.
 *   3. Kein Ausweis, welchen Zeitraum eine Stundenzahl abdeckt.
 *
 * Deshalb pruefen diese Tests nicht Zahlen gegen Zahlen, sondern
 * BILANZEN: Was gebucht wird, muss sich auf die Arbeitsinhalte
 * aufsummieren, und keine Wartemenge darf ueber der Arbeit liegen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDataset } from '../seed.js';
import { materialize } from '../scenario.js';
import { runSchedule } from '../scheduler.js';
import { analyze } from '../index.js';
import { bottleneckRanking, blockedByOperation, capacityDerivation } from '../kpi.js';
import { dayCapacity, headcountFor } from '../capacity.js';
import { cmpDate } from '../calendar.js';

function stand() {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  return { ds, input, result: runSchedule(input) };
}

/* ------------------------------------------------------------------ *
 * Engpass: jede Arbeit genau einmal
 * ------------------------------------------------------------------ */

test('Engpass: die wartende Arbeit ist keine Summe über die Wartetage', () => {
  const { result } = stand();
  const rang = bottleneckRanking(result);
  assert.ok(rang.length > 0, 'im Startdatenbestand muss es Engpässe geben');
  for (const e of rang) {
    // Die alte Zahl ist als queueHoursDays weiter nachlesbar - sie MUSS
    // deutlich groesser sein, sonst wird wieder ueber Tage summiert.
    assert.ok(e.queueHoursDays >= e.manHours,
      `${e.cause}: ${e.manHours} h dürfen nicht über der Tagessumme ${e.queueHoursDays} liegen`);
    assert.ok(e.days > 0, `${e.cause}: Wartetage fehlen`);
    assert.ok(e.peakHours > 0, `${e.cause}: größter Tageswert fehlt`);
    assert.ok(e.operations > 0, `${e.cause}: Anzahl der Arbeitsgänge fehlt`);
  }
  const top = rang[0];
  assert.ok(top.queueHoursDays > top.manHours * 2,
    `die alte Zahl (${top.queueHoursDays}) war ein Vielfaches der neuen (${top.manHours})`);
});

test('Engpass: die wartende Arbeit bleibt unter der offenen Arbeit', () => {
  const { result } = stand();
  const offen = result.projects.reduce((a, p) => a + (p.remainingManHours ?? 0), 0);
  for (const e of bottleneckRanking(result)) {
    assert.ok(e.manHours <= offen + 0.5,
      `${e.cause}: ${e.manHours} h wartende Arbeit über ${Math.round(offen)} h offener Arbeit`);
  }
});

test('Engpass je Arbeitsgang: keine Wartemenge über dem Arbeitsinhalt', () => {
  const { result } = stand();
  const stau = blockedByOperation(result);
  /** Offene Arbeit je Arbeitsgang */
  const offen = {};
  for (const p of result.projects) {
    for (const o of p.operations ?? []) {
      offen[o.opId] = (offen[o.opId] ?? 0)
        + Number(o.initialRemainingUnits ?? 0) * Number(o.manHourFactor ?? 1);
    }
  }
  for (const [opId, b] of Object.entries(stau)) {
    assert.ok(b.manHours <= (offen[opId] ?? 0) + 0.5,
      `${opId}: ${b.manHours} h warteten, offen sind aber nur ${Math.round(offen[opId] ?? 0)} h`);
    assert.ok(b.peakHours <= b.manHours + 0.5,
      `${opId}: größter Tag ${b.peakHours} h über der Gesamtmenge ${b.manHours} h`);
  }
});

/* ------------------------------------------------------------------ *
 * Stunden je Arbeitsgang: die Bilanz muss aufgehen
 * ------------------------------------------------------------------ */

test('Stunden je Arbeitsgang summieren sich auf die offene Arbeit der Aufträge', () => {
  const ds = seedDataset();
  const a = analyze(ds, 'BASELINE');
  const offenAuftraege = a.projects.reduce((x, p) => x + (p.remainingManHours ?? 0), 0);
  const offenGaenge = a.processBalance.reduce((x, r) => x + r.openManHours, 0);
  assert.ok(Math.abs(offenAuftraege - offenGaenge) < 1,
    `Aufträge ${Math.round(offenAuftraege)} h gegen Arbeitsgänge ${Math.round(offenGaenge)} h`);
  // Arbeitsinhalt muss ueber der offenen Arbeit liegen (Fortschritt ist ab)
  const inhalt = a.processBalance.reduce((x, r) => x + r.contentManHours, 0);
  assert.ok(inhalt >= offenGaenge - 0.5, `Inhalt ${inhalt} unter offen ${offenGaenge}`);
});

test('Orbitalschweißen: Stunden je Auftrag sind eine plausible Größe', () => {
  const ds = seedDataset();
  const a = analyze(ds, 'BASELINE');
  /*
   * Orbitalschweissen ist aufgeteilt in Kehlnaht und Stumpfnaht
   * (Nutzerauftrag 23.09.2026) - der Erfahrungswert der Abteilung ("je
   * Auftrag rund 90 h") gilt fuer BEIDE zusammen.
   */
  const kehl = a.processBalance.find((r) => r.opId === 'ORBITAL_KEHLNAHT');
  const stumpf = a.processBalance.find((r) => r.opId === 'ORBITAL_STUMPFNAHT');
  assert.ok(kehl && stumpf, 'Kehlnaht und Stumpfnaht Orbital müssen in der Buchung stehen');
  assert.ok(kehl.orders > 30, `nur ${kehl.orders} Aufträge mit Kehlnaht Orbital`);
  const jeAuftrag = (kehl.contentManHours + stumpf.contentManHours) / kehl.orders;
  // Erfahrungswert der Abteilungsleitung: "je Auftrag rund 90 h" (Daumenwert).
  // Die Arbeitsfolge liegt darunter - der Wert ist mit ihr abzugleichen,
  // deshalb hier nur eine weite Schranke gegen Rechenfehler.
  assert.ok(jeAuftrag > 20 && jeAuftrag < 200,
    `${jeAuftrag.toFixed(1)} h je Auftrag sind nicht plausibel`);
  assert.ok(kehl.plannedManHours <= kehl.openManHours + 0.5,
    'es darf nicht mehr eingeplant sein, als offen ist');
});

/* ------------------------------------------------------------------ *
 * Kapazitaet: Zeitraum und Rechenweg
 * ------------------------------------------------------------------ */

test('Kapazität: der Rechenweg ergibt genau die ausgewiesene Zahl', () => {
  const ds = seedDataset();
  const a = analyze(ds, 'BASELINE');
  const d = a.capacityDerivation;
  assert.ok(Math.abs(d.capacityHours - a.kpis.availableHours) < 1,
    `Rechenweg ${d.capacityHours} h gegen Kennzahl ${a.kpis.availableHours} h`);
  // Die Naeherung mit Mittelwerten darf nur wenig abweichen - sonst ist der
  // ausgewiesene Rechenweg nicht der, der wirklich gerechnet wird.
  assert.ok(Math.abs(d.deviation) < d.capacityHours * 0.02,
    `Näherung ${d.approxHours} weicht um ${d.deviation} h ab`);
  assert.ok(d.workDays > 0 && d.workDays < d.calendarDays,
    `${d.workDays} Arbeitstage bei ${d.calendarDays} Kalendertagen`);
  assert.ok(d.from && d.to, 'der Zeitraum muss benannt sein');
});

test('Kapazität: die Näherung hält auch mit Überstunden', () => {
  /*
   * Gemeldet am 18.09.2026: "Warum gibt es da so ein großes Defizit?"
   * Die Näherung rechnete jeden Tag mit der Regelarbeitszeit (7,5 h),
   * die Planung mit 8,3 h. Bei 4 h Überstunden je Woche fehlten dadurch
   * 943 h - und die Fußzeile schob es auf Feiertage und Urlaub.
   */
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  input.config.workforce.overtimePerEmployeeDefault = 4;
  const result = runSchedule(input);
  const d = capacityDerivation(input.config, result.daySeries, null);
  assert.ok(d.overtimeHours > 100,
    `bei 4 h je Woche müssen Überstunden ausgewiesen sein, waren ${d.overtimeHours} h`);
  assert.ok(d.regularHoursPerDay > d.hoursPerDay + 0.5,
    `${d.regularHoursPerDay} h je Tag gegen ${d.hoursPerDay} h Regelarbeitszeit`);
  assert.ok(Math.abs(d.deviation) < d.capacityHours * 0.01,
    `Näherung ${d.approxHours} h weicht um ${d.deviation} h von ${d.capacityHours} h ab`);
});

test('Kapazität: die Näherung hält auch mit Samstagsarbeit', () => {
  // Samstage zaehlen als Arbeitstag, laufen aber mit eigener Laenge (6 h)
  // und nur einem Teil der Mannschaft. In einem gemeinsamen Mittelwert
  // verschiebt das beide Seiten.
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  input.config.saturday = { ...(input.config.saturday ?? {}), enabledDefault: true };
  const result = runSchedule(input);
  const d = capacityDerivation(input.config, result.daySeries, null);
  assert.ok(d.saturdayDays > 0, 'die Samstage müssen als eigene Gruppe erscheinen');
  assert.ok(d.saturdayHoursPerDay < d.regularHoursPerDay,
    'ein Samstag ist kürzer als ein regulärer Tag');
  assert.ok(d.saturdayHeadcount < d.regularHeadcount,
    'am Samstag ist nur ein Teil der Mannschaft da');
  assert.ok(Math.abs(d.deviation) < d.capacityHours * 0.01,
    `Näherung ${d.approxHours} h weicht um ${d.deviation} h von ${d.capacityHours} h ab`);
});

test('Kapazität: die Posten des Rechenwegs ergeben zusammen die Näherung', () => {
  const ds = seedDataset();
  const input = materialize(ds, 'BASELINE');
  input.config.workforce.overtimePerEmployeeDefault = 4;
  input.config.saturday = { ...(input.config.saturday ?? {}), enabledDefault: true };
  const result = runSchedule(input);
  const d = capacityDerivation(input.config, result.daySeries, null);
  const summe = d.regularGrossHours + d.saturdayGrossHours - d.mentoringTotal - d.reserveTotal;
  assert.ok(Math.abs(summe - d.approxHours) < 1,
    `die ausgewiesenen Posten ergeben ${summe.toFixed(1)} h, die Näherung ${d.approxHours} h`);
  // Die Ueberstunden stecken IN den regulaeren Tagen, sie sind kein
  // zusaetzlicher Posten - sonst wuerde doppelt gezaehlt.
  assert.ok(d.overtimeHours < d.regularGrossHours,
    'die Überstunden sind Teil der regulären Tage, nicht ein Posten daneben');
  const ohneUeberstunden = d.regularHeadcount * d.hoursPerDay * d.regularProductivity * d.regularDays;
  assert.ok(Math.abs((ohneUeberstunden + d.overtimeHours) - d.regularGrossHours) < 1,
    'Regelarbeitszeit plus Überstunden muss die regulären Tage ergeben');
});

test('Kapazität: die Produktivität wird als Faktor geführt, nicht in Prozentpunkten', () => {
  // Der Anzeigefehler "1 %" entstand, weil der Faktor 0,9333 an einen
  // Prozentbaustein ging, der Prozentpunkte erwartet. Der Motor liefert
  // bewusst den Faktor - die Oberflaeche rechnet ihn um.
  const ds = seedDataset();
  const a = analyze(ds, 'BASELINE');
  const d = a.capacityDerivation;
  assert.ok(d.productivity > 0.5 && d.productivity <= 1.001,
    `Produktivität muss ein Faktor sein, war ${d.productivity}`);
  assert.ok(d.regularProductivity > 0.5 && d.regularProductivity <= 1.001);
  // Vier Stellen, sonst liegt die Naeherung um 0,36 % daneben
  assert.ok(Math.abs(d.productivity - 0.9333) < 0.0005,
    `0,9333 erwartet, war ${d.productivity}`);
});

test('Kapazität: es wird kein Tag nach dem letzten Termin mitgezählt', () => {
  const { input, result } = stand();
  const ds = seedDataset();
  const a = analyze(ds, 'BASELINE');
  const bis = a.kpis.availableHoursUntil;
  assert.ok(bis, 'das Kennzahlenfenster muss ein Ende haben');
  // Genau die Tage bis zum Termin, kein Tag darueber
  let summe = 0;
  for (const d of result.daySeries) {
    if (cmpDate(d.date, bis) > 0) continue;
    summe += d.poolCapacity ?? 0;
  }
  assert.ok(Math.abs(summe - a.kpis.availableHours) < 1,
    `taggenau ${Math.round(summe)} h gegen Kennzahl ${a.kpis.availableHours} h`);
  // Gegenprobe: die Wochensumme zaehlt die Randwoche ganz und liegt darueber
  const wochen = a.weeks.filter((w) => cmpDate(w.from, bis) <= 0)
    .reduce((x, w) => x + w.capacity, 0);
  assert.ok(wochen >= summe,
    'die Wochensumme darf nicht unter der taggenauen Summe liegen');
  void input;
});

test('Kapazität: die Tagesformel gilt für jeden einzelnen Arbeitstag', () => {
  const { input, result } = stand();
  const cfg = input.config;
  const d = capacityDerivation(cfg, result.daySeries, null);
  const stundenJeTag = Number(cfg.workTime.regularHoursPerWeek) / 5;
  const reserveJeTag = Number(cfg.workforce.reserveHoursPerWeek) / 5;
  let geprueft = 0;
  for (const tag of result.daySeries) {
    const kap = Number(tag.poolCapacity ?? 0);
    if (kap <= 0) continue;
    // Samstage rechnen mit eigener Besetzung und eigener Laenge - die
    // Formel gilt fuer die regulaeren Tage.
    if (tag.kind !== 'REGULAR') continue;
    // Vollstaendige Tagesformel: Betreuung neuer Kraefte geht mit ab.
    const betreuung = Number(tag.mentoringHours ?? 0);
    const erwartet = Number(tag.headcount) * stundenJeTag * Number(tag.productivity)
      - betreuung - reserveJeTag;
    assert.ok(Math.abs(kap - erwartet) < 0.05,
      `${tag.date}: ${kap} h gegen nachgerechnete ${erwartet.toFixed(2)} h `
      + `(${tag.headcount} MA x ${stundenJeTag} h x ${tag.productivity} `
      + `- ${betreuung} Betreuung - ${reserveJeTag} Reserve)`);
    geprueft++;
  }
  assert.ok(geprueft > 50, `nur ${geprueft} Tage geprüft`);
  assert.ok(d.workDays >= geprueft, 'der Rechenweg muss mindestens diese Tage kennen');
});

test('Kapazität: Wochenstunden mal Kalendertage ist genau der Fehler, vor dem gewarnt wird', () => {
  const ds = seedDataset();
  const a = analyze(ds, 'BASELINE');
  const d = a.capacityDerivation;
  // Die Handrechnung "Wochenstunden x Kalendertage" - so entstand die Zahl
  // 4525 h in der Rueckmeldung. Sie muss deutlich neben der Wahrheit liegen,
  // sonst warnt die Anwendung ohne Grund.
  const falsch = d.hoursPerWeek * d.calendarDays;
  assert.ok(Math.abs(falsch - d.capacityHours) > d.capacityHours * 0.2,
    'die Warnung vor dieser Handrechnung wäre sonst gegenstandslos');
  // Richtig ist: Arbeitstage, nicht Kalendertage
  assert.ok(d.workDays < d.calendarDays * 0.8,
    `${d.workDays} Arbeitstage bei ${d.calendarDays} Kalendertagen`);
});

/* ------------------------------------------------------------------ *
 * Niemand arbeitet allein - Arbeitsschutz, keine Stellschraube
 *
 * Vorgabe der Abteilungsleitung, am 18.09.2026 ausdruecklich bestaetigt:
 * "Gilt immer! Es darf aus Sicherheitsgruenden niemand alleine arbeiten.
 * Es muss immer ein 2. Mann dabei sein."
 * ------------------------------------------------------------------ */

test('Ein Tag mit nur einer Person erzeugt keine Kapazität', () => {
  const ds = seedDataset();
  const cfg = materialize(ds, 'BASELINE').config;
  const nurEiner = JSON.parse(JSON.stringify(cfg));
  let n = 0;
  for (const p of nurEiner.workforce.team.people) {
    if (p.kind === 'STAMM') {
      n += 1;
      if (n > 1) { p.defaultActive = false; p.weeks = {}; }
    } else {
      p.defaultActive = false; p.startDate = null; p.weeks = {};
    }
  }
  const h = headcountFor(nurEiner, '2026-09-21');
  assert.equal(h.heads, 1, 'genau eine Person ist da');
  assert.equal(h.alone, true, 'die Sicherheitsregel muss greifen');
  assert.equal(h.effective, 0, 'allein wird nicht gearbeitet');
  assert.ok(h.effectiveRaw > 0, 'ohne die Regel wäre Kapazität herausgekommen');
  assert.equal(dayCapacity(nurEiner, '2026-09-21').poolHours, 0,
    'der Tag darf keine Stunde hergeben');
});

test('Zwei Personen dürfen arbeiten – auch zwei Halbtagskräfte', () => {
  const ds = seedDataset();
  const cfg = materialize(ds, 'BASELINE').config;
  const zwei = JSON.parse(JSON.stringify(cfg));
  let n = 0;
  for (const p of zwei.workforce.team.people) {
    if (p.kind === 'STAMM') {
      n += 1;
      if (n > 2) { p.defaultActive = false; p.weeks = {}; } else { p.factor = 0.5; }
    } else {
      p.defaultActive = false; p.startDate = null; p.weeks = {};
    }
  }
  const h = headcountFor(zwei, '2026-09-21');
  assert.equal(h.heads, 2, 'zwei Köpfe');
  assert.equal(h.alone, false, 'zwei Personen sind zulässig');
  assert.ok(h.effective > 0, 'und sie dürfen arbeiten');
  // Gemessen wird an KOEPFEN, nicht an Zeitanteilen: 2 x 0,5 FTE = 1,0 FTE,
  // aber zwei Menschen - das ist zulaessig.
  assert.ok(h.effective <= 1.01, `1,0 FTE erwartet, waren ${h.effective}`);
  assert.ok(dayCapacity(zwei, '2026-09-21').poolHours > 0);
});

test('Die Mindestbesetzung ist einstellbar, aber standardmäßig zwei', () => {
  const ds = seedDataset();
  const cfg = materialize(ds, 'BASELINE').config;
  assert.equal(cfg.workforce.minZusammen, 2, 'Arbeitsschutz: zwei');
  // Ausgeschaltet (1) darf eine Person arbeiten - das ist aber nicht der
  // Startwert und wird in der Prüfung gemeldet.
  const aus = JSON.parse(JSON.stringify(cfg));
  aus.workforce.minZusammen = 1;
  let n = 0;
  for (const p of aus.workforce.team.people) {
    if (p.kind === 'STAMM') { n += 1; if (n > 1) { p.defaultActive = false; p.weeks = {}; } }
    else { p.defaultActive = false; p.startDate = null; p.weeks = {}; }
  }
  const h = headcountFor(aus, '2026-09-21');
  assert.equal(h.alone, false);
  assert.ok(h.effective > 0, 'mit minZusammen = 1 darf eine Person arbeiten');
});
